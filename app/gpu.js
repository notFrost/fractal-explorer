import { MAX_ITER, FLOAT_LOG_ZOOM, BIG_LOG_ZOOM, FE_LOG_ZOOM } from './fractals.js';
import { bitsFor, ORBITS } from './precision.js';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 u_res;        // canvas size in pixels
uniform float u_px;        // world units per pixel (float tiers)
uniform vec2 u_center;     // camera centre, float32 (direct sets only)
uniform vec2 u_offset;     // camera minus reference centre, in pixels (perturbation tiers)
uniform float u_pxm;       // pixel size mantissa (floatexp tier)
uniform int u_pxe;         // pixel size exponent (floatexp tier)
uniform int u_maxIter;
uniform int u_refLen;
uniform int u_ref2;        // where Julia's second reference orbit starts
uniform vec2 u_julia;      // Julia's parameter C (direct tier only)
uniform sampler2D u_ref;   // reference orbit, RGBA32F, 1024 wide
uniform int u_palette;     // which colourway palette() draws, see palettes.js

out vec4 outColor;

// Colourways. Each takes the smooth escape count t and cycles on the
// original's period of 100, so they differ only in hue. u_palette picks one;
// the indices are listed in palettes.js. Inside points stay black in all.
const float PERIOD = 100.0;

vec3 hsv(float h, float s, float v) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), rgb, s);
}

// 0. Pen: hue (t + 90) mod 100 on a 0..100 wheel, brightness t * 5 clamped.
vec3 penPalette(float t) {
  float h = fract((t + 90.0) / PERIOD);
  float v = clamp(t * 5.0, 0.0, 100.0) / 100.0;
  return hsv(h, 1.0, v);
}

// Gradient through five stops at positions pos; u in [0, 1). Wraps back to
// the first stop so cycling has no seam.
vec3 ramp5(float u, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec4 pos) {
  if (u < pos.x) return mix(c0, c1, u / pos.x);
  if (u < pos.y) return mix(c1, c2, (u - pos.x) / (pos.y - pos.x));
  if (u < pos.z) return mix(c2, c3, (u - pos.y) / (pos.z - pos.y));
  if (u < pos.w) return mix(c3, c4, (u - pos.z) / (pos.w - pos.z));
  return mix(c4, c0, (u - pos.w) / (1.0 - pos.w));
}

// Triangle wave: 0 → 1 → 0 over one period, so an open-ended ramp cycles without a seam.
float tri(float u) { return 1.0 - abs(2.0 * fract(u) - 1.0); }

// 1. Classic: the Ultra Fractal default that the well-known Wikipedia
// Mandelbrot renders use. Navy → blue → white → orange → near black.
vec3 classicPalette(float t) {
  return ramp5(fract(t / PERIOD),
    vec3(0.0, 0.027, 0.392), vec3(0.125, 0.42, 0.796), vec3(0.929, 1.0, 1.0),
    vec3(1.0, 0.667, 0.0), vec3(0.0, 0.008, 0.0),
    vec4(0.16, 0.42, 0.6425, 0.8575));
}

// 2. Ember: black → maroon → red-orange → amber → cream, folded so it burns
// up and cools back down each period.
vec3 emberPalette(float t) {
  float u = tri(t / PERIOD) * 0.999;
  return ramp5(u,
    vec3(0.02, 0.0, 0.0), vec3(0.35, 0.03, 0.03), vec3(0.85, 0.18, 0.04),
    vec3(1.0, 0.7, 0.13), vec3(1.0, 0.96, 0.84),
    vec4(0.25, 0.5, 0.75, 0.999));
}

// 3. Abyss: deep sea to sand. Ink blue → teal → sea green → foam → sand, folded.
vec3 abyssPalette(float t) {
  float u = tri(t / PERIOD) * 0.999;
  return ramp5(u,
    vec3(0.0, 0.07, 0.1), vec3(0.0, 0.37, 0.45), vec3(0.04, 0.58, 0.59),
    vec3(0.58, 0.82, 0.74), vec3(0.91, 0.85, 0.65),
    vec4(0.25, 0.5, 0.75, 0.999));
}

// 4. Ultraviolet: the site's own accents. Pen blue #0400ff → violet →
// magenta #ff2bd6 → pale pink, cycling, with a dark trough between cycles.
vec3 ultravioletPalette(float t) {
  return ramp5(fract(t / PERIOD),
    vec3(0.02, 0.0, 0.08), vec3(0.016, 0.0, 1.0), vec3(0.48, 0.0, 1.0),
    vec3(1.0, 0.17, 0.84), vec3(1.0, 0.84, 0.96),
    vec4(0.2, 0.45, 0.7, 0.9));
}

// 5. Ink: no hue at all. Charcoal contour bands on paper, like a line-printer
// plot. Each band of eight iterations fades in and out so edges stay soft.
vec3 inkPalette(float t) {
  float band = fract(t / 8.0);
  float edge = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.92, 1.0, band));
  float shade = mix(0.12, 0.93, edge);
  return shade * vec3(1.0, 0.97, 0.9);
}

// 6. Chalk: Ink inverted. Pale contour lines on slate, same eight-iteration bands.
vec3 chalkPalette(float t) {
  float band = fract(t / 8.0);
  float edge = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.92, 1.0, band));
  float shade = mix(0.92, 0.1, edge);
  return shade * vec3(0.9, 0.95, 1.0);
}

vec3 palette(float t) {
  if (!(t > 0.0)) return vec3(0.0);
  if (u_palette == 1) return classicPalette(t);
  if (u_palette == 2) return emberPalette(t);
  if (u_palette == 3) return abyssPalette(t);
  if (u_palette == 4) return ultravioletPalette(t);
  if (u_palette == 5) return inkPalette(t);
  if (u_palette == 6) return chalkPalette(t);
  return penPalette(t);
}

vec2 csq(vec2 z) { return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// Smooth escape count for bailout |z|^2 > 1e4, given log(|z|^2).
float smoothT(int steps, float logzz) {
  return float(steps) + 1.0 - log2(0.5 * logzz);
}

vec4 refAt(int i) { return texelFetch(u_ref, ivec2(i & 1023, i >> 10), 0); }

const float SKIN = 1e-5;  // wider than float32 error near the boundary

bool inCardioidOrBulb(vec2 c) {
  vec2 b = c + vec2(1.0, 0.0);
  if (dot(b, b) < 0.0625 - SKIN) return true;
  float x = c.x - 0.25;
  float q = x * x + c.y * c.y;
  return q * (q + x) < 0.25 * c.y * c.y - SKIN;
}
`;

// Floating point with its own exponent, for deltas far below float32 range.
// The mantissa is a vec2 normalised so max(|m.x|, |m.y|) is in [0.5, 1).
const FE_LIB = `
const int EMIN = -1000000;
struct FE { vec2 m; int e; };

// 2^k for |k| up to about 250, built from two exponent-field constructions.
float pow2(int k) {
  int h = k >> 1;
  return intBitsToFloat((h + 127) << 23) * intBitsToFloat((k - h + 127) << 23);
}

// Normalise. Denormals count as zero.
FE fe(vec2 v, int e) {
  float a = max(abs(v.x), abs(v.y));
  int ex = (floatBitsToInt(a) >> 23) & 255;
  if (ex == 0) return FE(vec2(0.0), EMIN);
  int k = ex - 126;
  return FE(v * pow2(-k), e + k);
}

vec2 feToFloat(FE a) {
  if (a.e < -120) return vec2(0.0);
  return a.m * pow2(min(a.e, 120));
}

FE feAdd(FE a, FE b) {
  if (a.e < b.e) { FE t = a; a = b; b = t; }
  int d = a.e - b.e;
  if (d > 60) return a;
  return fe(a.m + b.m * pow2(-d), a.e);
}

bool feLess(FE a, FE b) {
  if (a.e == EMIN) return b.e != EMIN;
  if (b.e == EMIN) return false;
  int d = clamp(a.e - b.e, -30, 30);
  return dot(a.m, a.m) * pow2(2 * d) < dot(b.m, b.m);
}

// |a|² as a scalar FE (in .x).
FE feMag2(FE a) { return fe(vec2(dot(a.m, a.m), 0.0), 2 * a.e); }
`;

// Perturbation with rebasing. Pixel = reference + delta.
// delta_{n+1} = (2 Z_n + delta_n) delta_n + dc. When the pixel's orbit passes
// closer to the origin than its delta, restart against the reference's start.
const MANDELBROT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    d = cmul(2.0 * Z + d, d) + dc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res;
  if (inCardioidOrBulb(u_center + px * u_px)) {
    outColor = vec4(palette(0.0), 1.0);
    return;
  }
  outColor = vec4(palette(escape((px + u_offset) * u_px)), 1.0);
}`;

// Same algorithm with the delta carried as mantissa × 2^exponent so it can be
// far below float32 range. The reference stays plain float32 since |Z| ≤ 1e5.
const MANDELBROT_FE = FE_LIB + `
float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(cmul(t, d.m), d.e), dc);
    m++;
    FE z = feAdd(fe(refAt(min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  if (inCardioidOrBulb(u_center)) {
    outColor = vec4(palette(0.0), 1.0);
    return;
  }
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

const WEBB = `
float escape(vec2 c) {
  vec2 p = vec2(0.0);
  vec2 z = c;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 nz = csq(z) + p;
    p = z;
    z = nz;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

// Webb by perturbation. The recurrence has two terms, so the pixel carries a
// delta on each: z = Z + d, and the previous value p = P + e.
// d_{n+1} = (2 Z_n + d_n) d_n + e_n, e_{n+1} = d_n.
// The map has no critical point, so the delta never loses precision the way
// Mandelbrot's does near the origin; rebasing is still needed so pixels can
// outlive the reference. A rebase moves the pixel onto the reference's start
// state (Z_0, 0). The offset Z_n − Z_0 comes from the texture at full precision.
const WEBB_PERT = `
float escape(vec2 dc) {
  vec2 d = dc;
  vec2 e = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R = refAt(0);      // Z_m, Z_m − Z_0
  vec2 P = vec2(0.0);     // Z_{m−1}
  for (int n = 0; n < u_maxIter; n++) {
    vec2 nd = cmul(2.0 * R.xy + d, d) + e;
    e = d;
    d = nd;
    m++;
    P = R.xy;
    R = refAt(m);
    vec2 z = R.xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    vec2 w = R.zw + d;
    vec2 p = P + e;
    if (dot(w, w) + dot(p, p) < dot(d, d) + dot(e, e) || m >= last) {
      d = w;
      e = p;
      m = 0;
      R = refAt(0);
      P = vec2(0.0);
    }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;

const WEBB_FE = FE_LIB + `
float escape(FE dc) {
  FE d = dc;
  FE e = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R = refAt(0);
  vec2 P = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    vec2 t = 2.0 * R.xy + feToFloat(d);
    FE nd = feAdd(fe(cmul(t, d.m), d.e), e);
    e = d;
    d = nd;
    m++;
    P = R.xy;
    R = refAt(m);
    FE z = feAdd(fe(R.xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    FE w = feAdd(fe(R.zw, 0), d);
    FE p = feAdd(fe(P, 0), e);
    if (feLess(feAdd(feMag2(w), feMag2(p)), feAdd(feMag2(d), feMag2(e))) || m >= last) {
      d = w;
      e = p;
      m = 0;
      R = refAt(0);
      P = vec2(0.0);
    }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

// Complex parity: floor(|z|) mod 2. Odd -> 3z + 1, even -> z / 2.
// Colour is fixed after two steps, shown only if the orbit ends outside radius 5.
const COLLATZ = `
vec2 step_(vec2 z) {
  float parity = mod(floor(length(z)), 2.0);
  return parity > 0.5 ? vec2(3.0 * z.x + 1.0, 3.0 * z.y) : z * 0.5;
}

float escape(vec2 c) {
  vec2 z = step_(step_(c));
  float m2 = dot(z, z);
  float l = log2(0.5 * log(m2));
  if (isnan(l) || isinf(l)) l = 0.0;
  float fallback = min(m2 + 1.0 - l, 1e5);
  int steps = min(u_maxIter, 500) - 2;
  for (int n = 0; n < steps; n++) {
    z = step_(z);
    if (!(dot(z, z) < 1e30)) break;   // overflowed: parity is 0 forever after
  }
  return dot(z, z) > 25.0 ? fallback : 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

// Collatz by perturbation. Both branches are affine, so while a pixel takes
// the reference's branch its delta is exact: d ← 3d or d/2. All the precision
// goes into the parity test. |P + d| − |P| is computed without cancellation as
// (2 Re(P̄ d) + |d|²) / (|P + d| + |P|) and compared, in log2, against the
// distances from |P| to the integer radii either side (two texels per step:
// (Z, log2 lo, log2 hi) and (parity)). A pixel that takes the other branch
// leaves the reference and carries on from its own float32 base, keeping the
// exact delta alongside so pixels that left together still tell apart.
const COLLATZ_PERT = FE_LIB + `
const float EVEN_ONLY = 16777216.0;   // float32 has only even integers above this

// Parity of floor|P + d|, given the base's parity and the log2 distances from
// |P| down and up to the nearest boundaries. Precise for any |d| below |P| / 4:
// the radius change is formed without cancellation, so a delta of 0.03 on a
// base of 1e5 still lands on the right side of a boundary float32 cannot see.
float pixelParity(vec2 P, FE d, float lo, float hi, float par) {
  vec2 df = feToFloat(d);
  if (dot(df, df) * 16.0 >= dot(P, P)) return mod(floor(length(P + df)), 2.0);
  FE num = feAdd(fe(vec2(2.0 * dot(P, d.m), 0.0), d.e), fe(vec2(dot(d.m, d.m), 0.0), 2 * d.e));
  if (num.e == EMIN) return par;
  float den = length(P + df) + length(P);
  FE dr = fe(vec2(num.m.x / den, 0.0), num.e);
  if (dr.e < -100) {
    // Far below float32: at most one boundary is in reach, compare in log2.
    float L = log2(abs(dr.m.x)) + float(dr.e);
    bool cross = (dr.m.x < 0.0 && L > lo) || (dr.m.x > 0.0 && L >= hi);
    return cross ? 1.0 - par : par;
  }
  float x = dr.m.x * pow2(dr.e);
  float n;
  if (x >= 0.0) { float h = exp2(hi); n = x < h ? 0.0 : 1.0 + floor(x - h); }
  else { float l = exp2(lo); n = -x <= l ? 0.0 : -1.0 - floor(-x - l); }
  return mod(par + n, 2.0);
}

float escape(FE dc) {
  FE d = dc;
  int m = 0;
  bool onRef = true;
  int steps = min(u_maxIter, 500);
  float fallback = 0.0;
  vec2 P = refAt(0).xy;
  for (int i = 0; i < steps; i++) {
    float lo, hi, par;
    if (onRef) {
      vec4 R = refAt(2 * m);
      P = R.xy;
      lo = R.z;
      hi = R.w;
      par = refAt(2 * m + 1).x;
    } else {
      // Off the reference: the base is float32, so are its boundary distances.
      float r = length(P);
      float k = floor(r);
      par = mod(k, 2.0);
      lo = log2(max(r - k, 1e-30));
      hi = log2(max(k + 1.0 - r, 1e-30));
      if (r >= EVEN_ONLY) { par = 0.0; lo = 1e6; hi = 1e6; }
    }
    float pp = pixelParity(P, d, lo, hi, par);
    if (pp > 0.5) {
      P = vec2(3.0 * P.x + 1.0, 3.0 * P.y);
      d = fe(3.0 * d.m, d.e);
    } else {
      P *= 0.5;
      d.e -= 1;
    }
    if (onRef) {
      if (pp == par && m + 1 < u_refLen) m++;
      else onRef = false;
    }
    vec2 z = P + feToFloat(d);
    float zz = dot(z, z);
    if (i == 1) {
      float l = log2(0.5 * log(zz));
      if (isnan(l) || isinf(l)) l = 0.0;
      fallback = min(zz + 1.0 - l, 1e5);
    }
    if (!(zz < 1e30)) break;
  }
  vec2 z = P + feToFloat(d);
  return dot(z, z) > 25.0 ? fallback : 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

// Julia: the same z² + C, but C is fixed and the pixel supplies z_0.
const JULIA = `
float escape(vec2 z) {
  for (int n = 0; n < u_maxIter; n++) {
    z = csq(z) + u_julia;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 z = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(z)), 1.0);
}`;

// Julia by perturbation. C is the same for every pixel, so the delta has no dc
// term: d ← (2Z + d) d, starting from the pixel's offset from the reference
// centre. The cancellation in that product happens when Z ≈ −d/2, that is when
// |z| ≈ |d| / 2 — the pixel's orbit passing closer to the origin than its own
// delta. Rebasing onto the centre orbit's start would be no help, since its
// Z_0 is the view centre rather than zero, so the texture carries a second
// orbit: the critical one, Z_0 = 0, at texels [0, u_ref2). A pixel rides the
// centre orbit at [u_ref2, u_refLen) until that first cancellation (or until
// the orbit runs out), then sets d = z and follows the critical orbit with
// Mandelbrot's rebasing, which is exact there because the orbit starts at 0.
const JULIA_PERT = `
float escape(vec2 d0) {
  vec2 d = d0;
  int m = 0;
  bool crit = false;
  int split = u_ref2;
  int cLast = split - 1;
  int oLast = u_refLen - split - 1;
  for (int n = 0; n < u_maxIter; n++) {
    int base = crit ? 0 : split;
    vec2 Z = refAt(base + m).xy;
    d = cmul(2.0 * Z + d, d);
    m++;
    int last = crit ? cLast : oLast;
    vec2 z = refAt(base + min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; crit = true; }
  }
  return 0.0;
}

void main() {
  vec2 d0 = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(d0)), 1.0);
}`;

const JULIA_FE = FE_LIB + `
float escape(FE d0) {
  FE d = d0;
  int m = 0;
  bool crit = false;
  int split = u_ref2;
  int cLast = split - 1;
  int oLast = u_refLen - split - 1;
  for (int n = 0; n < u_maxIter; n++) {
    int base = crit ? 0 : split;
    vec2 Z = refAt(base + m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = fe(cmul(t, d.m), d.e);
    m++;
    int last = crit ? cLast : oLast;
    FE z = feAdd(fe(refAt(base + min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; crit = true; }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

// Burning Ship as the original writes it: the imaginary part of c enters
// negated, which is z ← (|Re z| + i|Im z|)² + c̄. That conjugate is what stands
// the ship upright on a y-up stage, so it is kept rather than corrected.
const BURNING_SHIP = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * abs(z.x) * abs(z.y) - c.y);
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

// Burning Ship by perturbation. The absolute values are the whole difficulty:
// |Z + d| − |Z| cannot be formed by subtracting two nearly equal floats, so it
// is taken by cases instead (the "diffabs" trick), which is exact. Write that
// difference for both parts as w, so the pixel's absolute value is exactly
// |Z| + w. Expanding the square then collapses to Mandelbrot's own shape:
//   d' = (2 |Z| + w) w + c̄ − C̄
// with the conjugate negating the imaginary offset. Z_0 = 0 as in Mandelbrot,
// so a rebase is d = z, m = 0.
const SHIP_PERT = `
float diffabs(float X, float x) {
  if (X >= 0.0) return X + x >= 0.0 ? x : -(2.0 * X + x);
  return X + x > 0.0 ? 2.0 * X + x : -x;
}

float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  vec2 dcc = vec2(dc.x, -dc.y);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 w = vec2(diffabs(Z.x, d.x), diffabs(Z.y, d.y));
    d = cmul(2.0 * abs(Z) + w, w) + dcc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;

// The same recurrence with floatexp deltas. diffabs keeps the delta's own
// scale: a delta far below the reference component cannot reach past zero, so
// the sign of that component alone decides and the answer is ±x exactly.
// Otherwise the reference component is brought into the delta's scale, where
// it is at most 2^30 times the mantissa, and the cases are taken in float32.
const SHIP_FE = FE_LIB + `
float diffabsScaled(float X, float m, int e) {
  if (X == 0.0) return abs(m);
  int gap = (((floatBitsToInt(X) >> 23) & 255) - 127) - e;   // log2|X| − e
  if (gap > 30) return X > 0.0 ? m : -m;
  float Xs = X * pow2(-e);
  if (X > 0.0) return Xs + m >= 0.0 ? m : -(2.0 * Xs + m);
  return Xs + m > 0.0 ? 2.0 * Xs + m : -m;
}

float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  FE dcc = FE(vec2(dc.m.x, -dc.m.y), dc.e);   // + c̄
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    FE w = FE(vec2(diffabsScaled(Z.x, d.m.x, d.e), diffabsScaled(Z.y, d.m.y, d.e)), d.e);
    vec2 t = 2.0 * abs(Z) + feToFloat(w);
    d = feAdd(fe(cmul(t, w.m), w.e), dcc);
    m++;
    FE z = feAdd(fe(refAt(min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

// MandelBug: Mandelbrot with a bug in the imaginary part. 2·Zr·Zi was written
// 2(Zr + Zi), so Zr' = Zr² − Zi² + Cr but Zi' = 2(Zr + Zi) + Ci.
const MANDELBUG = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * (z.x + z.y) + c.y);
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

// MandelBug by perturbation. With z = Z + d and c = C + dc, expanding gives
//   dr' = 2 Zr dr + dr² − 2 Zi di − di² + dcr = Re[(2Z + d) d] + dcr
//   di' = 2 (dr + di) + dci
// The real part is Mandelbrot's own; the imaginary part is linear, so it is
// exact whatever the scale. Nothing cancels beyond Mandelbrot's near-origin
// case, and Z_0 = 0, so Zhuoran rebasing carries over unchanged: when the
// pixel's orbit passes closer to the origin than its delta, set d = z, m = 0.
const BUG_PERT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + d;
    d = vec2(t.x * d.x - t.y * d.y, 2.0 * (d.x + d.y)) + dc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;

// The same recurrence with floatexp deltas. Both parts keep the delta's own
// exponent: the quadratic part multiplies the mantissa by 2Z + d in float32,
// the linear part is a mantissa sum at the same scale.
const BUG_FE = FE_LIB + `
float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(vec2(t.x * d.m.x - t.y * d.m.y, 2.0 * (d.m.x + d.m.y)), d.e), dc);
    m++;
    FE z = feAdd(fe(refAt(min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;

const PACMAN_PERT = `
const float TAU = 6.2831853071795864;
const float PI = 3.1415926535897932;
const float EXP_MAX = 30.0;

float log1p_(float x) { float u = 1.0 + x; return u == 1.0 ? x : x * log(u) / (u - 1.0); }
float expm1_(float x) { float u = exp(x); return u == 1.0 ? x : (u - 1.0) * x / log(u); }

vec2 cdiv(vec2 a, vec2 b) { return vec2(dot(a, b), a.y * b.x - a.x * b.y) / dot(b, b); }

vec2 clog1p(vec2 u) {
  return vec2(0.5 * log1p_(2.0 * u.x + u.x * u.x + u.y * u.y), atan(u.y, 1.0 + u.x));
}

vec2 cexpm1(vec2 w) {
  float wr = min(w.x, EXP_MAX);
  float s = sin(0.5 * w.y);
  return vec2(expm1_(wr) * cos(w.y) - 2.0 * s * s, exp(wr) * sin(w.y));
}

float smoothPac(int n, float prev, float zz) {
  float a = log(max(prev, 1e-20));
  float b = log(min(zz, 1e26));
  return float(n) + clamp((log(1e4) - a) / (b - a), 0.0, 1.0);
}

float escape(vec2 dc) {
  vec2 d = dc;
  int m = 1;
  int last = u_refLen - 1;
  float prev = 0.0;
  vec2 z = refAt(2).xy + d;
  float zz = dot(z, z);
  if (!(zz < 1e4)) return smoothPac(0, prev, zz);
  for (int n = 1; n < u_maxIter; n++) {
    vec4 A = refAt(2 * m);
    vec4 B = refAt(2 * m + 1);
    vec2 L = clog1p(cdiv(d, A.xy));
    L.y -= TAU * floor((A.w + L.y + PI) / TAU);
    vec2 W = cmul(A.xy, L) + cmul(d, A.zw + L);
    d = cmul(B.xy, cexpm1(W)) + dc;
    m++;
    int i = min(m, last);
    z = refAt(2 * i).xy + d;
    prev = zz;
    zz = dot(z, z);
    if (!(zz < 1e4)) return smoothPac(n, prev, zz);
    vec2 w = refAt(2 * i + 1).zw + d;
    if (dot(w, w) < dot(d, d) || m >= last) { d = w; m = 1; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;

const CUSTOM_LIB = `
vec2 cdiv(vec2 a, vec2 b) { return vec2(dot(a, b), a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 cre(vec2 z) { return vec2(z.x, 0.0); }
vec2 cim(vec2 z) { return vec2(z.y, 0.0); }
vec2 cabs(vec2 z) { return vec2(length(z), 0.0); }
vec2 cconj(vec2 z) { return vec2(z.x, -z.y); }

vec2 cexp(vec2 z) { return exp(min(z.x, 60.0)) * vec2(cos(z.y), sin(z.y)); }
vec2 clog(vec2 z) { return vec2(0.5 * log(dot(z, z)), atan(z.y, z.x)); }

vec2 csqrt(vec2 z) {
  float r = length(z);
  if (r == 0.0) return vec2(0.0);
  return vec2(sqrt(0.5 * (r + z.x)), (z.y < 0.0 ? -1.0 : 1.0) * sqrt(0.5 * (r - z.x)));
}

vec2 cpowi(vec2 z, int n) {
  int k = n < 0 ? -n : n;
  vec2 r = vec2(1.0, 0.0);
  vec2 b = z;
  for (int s = 0; s < 7; s++) {
    if (k == 0) break;
    if ((k & 1) == 1) r = cmul(r, b);
    b = cmul(b, b);
    k >>= 1;
  }
  return n < 0 ? cdiv(vec2(1.0, 0.0), r) : r;
}

vec2 cpow(vec2 a, vec2 b) { return dot(a, a) == 0.0 ? vec2(0.0) : cexp(cmul(b, clog(a))); }

vec2 csin(vec2 z) { return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y)); }
vec2 ccos(vec2 z) { return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y)); }
vec2 ctan(vec2 z) { return cdiv(csin(z), ccos(z)); }
vec2 csinh(vec2 z) { return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y)); }
vec2 ccosh(vec2 z) { return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y)); }
vec2 ctanh(vec2 z) { return cdiv(csinh(z), ccosh(z)); }
`;

function customBody(expr) {
  return CUSTOM_LIB + `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = ${expr};
    float zz = dot(z, z);
    if (!(zz < 1e4)) {
      float t = smoothT(n + 1, log(zz));
      return t > 0.0 ? t : float(n + 1);
    }
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;
}

const SOURCES = {
  mandelbrot: MANDELBROT,
  mandelbrotFE: MANDELBROT_FE,
  webb: WEBB,
  webbPert: WEBB_PERT,
  webbFE: WEBB_FE,
  collatz: COLLATZ,
  collatzPert: COLLATZ_PERT,
  julia: JULIA,
  juliaPert: JULIA_PERT,
  juliaFE: JULIA_FE,
  ship: BURNING_SHIP,
  shipPert: SHIP_PERT,
  shipFE: SHIP_FE,
  bug: MANDELBUG,
  bugPert: BUG_PERT,
  bugFE: BUG_FE,
  pacman: PACMAN_PERT,
};

// Programs per set: `float` iterates directly (absent for Mandelbrot, which is
// always perturbed), `pert` carries float32 deltas, `fe` floatexp deltas.
const SHADERS = {
  mandelbrot: { pert: 'mandelbrot', fe: 'mandelbrotFE' },
  webb: { float: 'webb', pert: 'webbPert', fe: 'webbFE' },
  collatz: { float: 'collatz', pert: 'collatzPert', fe: 'collatzPert' },
  julia: { float: 'julia', pert: 'juliaPert', fe: 'juliaFE' },
  burningship: { float: 'ship', pert: 'shipPert', fe: 'shipFE' },
  mandelbug: { float: 'bug', pert: 'bugPert', fe: 'bugFE' },
  pacman: { pert: 'pacman', fe: 'pacman' },
  custom: { float: 'custom' },
};

// Relative cost of one pixel-iteration, for splitting frames into strips.
const COST = {
  mandelbrot: 1, mandelbrotFE: 5,
  webb: 1, webbPert: 1.5, webbFE: 6,
  collatz: 1, collatzPert: 8,
  julia: 1, juliaPert: 1, juliaFE: 5,
  ship: 1.2, shipPert: 2, shipFE: 7,
  bug: 1, bugPert: 1, bugFE: 5,
  pacman: 8,
  custom: 4,
};

const UNIFORMS = ['u_res', 'u_px', 'u_center', 'u_offset', 'u_pxm', 'u_pxe', 'u_maxIter', 'u_refLen', 'u_ref2', 'u_julia', 'u_ref', 'u_palette'];
const REF_W = 1024;

// Pixel-iterations per draw call. Keeps each call well under GPU watchdog limits.
const STRIP_BUDGET = 2e9;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is not available in this browser.');
    this.lost = false;
    this.palette = 0; // colourway index, see palettes.js
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.setup(); });
    this.setup();
  }

  setup() {
    const gl = this.gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.programs = {};
    this.vs = compile(gl, gl.VERTEX_SHADER, VERT);
    for (const [name, body] of Object.entries(SOURCES)) {
      this.programs[name] = this.link(COMMON + body);
    }
    if (this.customExpr) {
      const expr = this.customExpr;
      this.customExpr = null;
      this.setCustom(expr);
    }
    // One fixed-size texture and one staging buffer, reused for every reference.
    // Room for two full-length orbits, which is what Julia stores; Collatz uses
    // two texels per step but stops at 500.
    this.refRows = Math.ceil((2 * MAX_ITER + 4) / REF_W);
    this.refBuf = new Float32Array(REF_W * this.refRows * 4);
    this.refTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, REF_W, this.refRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.ref = null;
    this.queries = [];
    this.timing = null;
    this.maxSide = Math.min(gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], 8192);
  }

  link(src) {
    const gl = this.gl;
    const fs = compile(gl, gl.FRAGMENT_SHADER, src);
    const p = gl.createProgram();
    gl.attachShader(p, this.vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, u: Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)])) };
  }

  setCustom(expr) {
    if (expr === this.customExpr && this.programs.custom) return;
    const prog = this.link(COMMON + customBody(expr));
    if (this.programs.custom) this.gl.deleteProgram(this.programs.custom.p);
    this.programs.custom = prog;
    this.customExpr = expr;
  }

  // ---------- Reference orbit cache ----------

  // Ensure the cached reference suits this view. Recomputes when the set
  // changes, the camera moved more than two screens from the reference, the
  // zoom needs more precision, or more iterations are needed than stored.
  ensureReference(view, iters, screenPx) {
    const { cam, set } = view;
    const orbit = ORBITS[set];
    const big = !orbit.double || cam.lz > BIG_LOG_ZOOM;
    const bits = big ? bitsFor(cam.lz) : 64;
    // Julia's orbits depend on C as well as on the centre, so C keys the cache.
    const p = view.julia;
    const pkey = set === 'julia' ? `${p.re},${p.im}` : '';
    let ref = this.ref;
    let reuse = false;
    if (ref && ref.set === set && ref.pkey === pkey && ref.big === big && ref.bits >= bits) {
      const o = cam.offsetFrom(ref.cam);
      if (Math.abs(o.x) <= 2 * screenPx && Math.abs(o.y) <= 2 * screenPx) reuse = true;
    }
    if (reuse && (ref.len > iters || ref.escaped)) return ref;

    const t0 = performance.now();
    if (reuse) {
      // Extend the stored orbit.
      const r = ref.big
        ? orbit.big(ref.cam.x, ref.cam.y, ref.bits, iters, this.refBuf, ref, p)
        : orbit.double(ref.cam.xDouble(), ref.cam.yDouble(), iters, this.refBuf, p);
      Object.assign(ref, r);
    } else {
      // Carry 64 spare bits so the orbit stays valid for 2^64 of further zoom.
      const c = cam.clone();
      if (big) c.setLogZoom(cam.lz + 64);
      const r = big
        ? orbit.big(c.x, c.y, c.bits, iters, this.refBuf, null, p)
        : orbit.double(c.xDouble(), c.yDouble(), iters, this.refBuf, p);
      ref = { set, pkey, cam: c, bits: big ? c.bits : 64, big, ...r };
    }
    ref.iters = iters;
    ref.cpuMs = performance.now() - t0;
    // An orbit that does not fill len × stride texels reports its own footprint.
    const rows = Math.ceil((ref.texels ?? ref.len * orbit.stride) / REF_W);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, REF_W, rows, gl.RGBA, gl.FLOAT, this.refBuf, 0);
    this.ref = ref;
    return ref;
  }

  // ---------- Drawing ----------

  // Prepare uniforms for a frame. view = { set, cam, maxIter }. `fresh` marks
  // the first call of a frame; later calls re-issue uniforms between strips.
  // Returns { strips } — the number of draw calls a full frame needs.
  begin(view, fresh = true) {
    if (this.lost) return { strips: 0 };
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const { cam } = view;
    const scale = h / 360;
    const shaders = SHADERS[view.set];
    const iters = ORBITS[view.set].iters(view.maxIter);
    // forceDeep is a debugging switch: perturbation at any zoom, to diff against the float path.
    const deep = !shaders.float || this.forceDeep || cam.lz > FLOAT_LOG_ZOOM;
    let name;
    let refCpuMs = 0;

    if (deep) {
      const ref = this.ensureReference(view, iters, Math.max(w, h) / scale);
      refCpuMs = ref.cpuMs;
      const tier = ref.big ? (cam.lz > FE_LOG_ZOOM ? 'fe' : 'big') : 'double';
      name = tier === 'fe' ? shaders.fe : shaders.pert;
      const o = cam.offsetFrom(ref.cam);
      const prog = this.programs[name];
      gl.useProgram(prog.p);
      gl.uniform2f(prog.u.u_offset, o.x * scale, o.y * scale);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.refTex);
      gl.uniform1i(prog.u.u_ref, 0);
      // Julia spans both stored orbits, so it counts texels rather than steps.
      gl.uniform1i(prog.u.u_refLen, ref.texels ?? ref.len);
      gl.uniform1i(prog.u.u_ref2, ref.split ?? 0);
      // pixel size = 2^-lz / scale, split into mantissa and exponent
      const e = Math.floor(-cam.lz);
      const m = 2 ** (-cam.lz - e) / scale;
      gl.uniform1f(prog.u.u_pxm, m);
      gl.uniform1i(prog.u.u_pxe, e);
      gl.uniform1f(prog.u.u_px, m * 2 ** e);
      gl.uniform2f(prog.u.u_center, cam.xDouble(), cam.yDouble());
      this.tier = tier;
    } else {
      name = shaders.float;
      const prog = this.programs[name];
      gl.useProgram(prog.p);
      gl.uniform1f(prog.u.u_px, 1 / (scale * cam.zoom));
      gl.uniform2f(prog.u.u_center, cam.xDouble(), cam.yDouble());
      this.tier = 'float';
    }
    const prog = this.programs[name];
    if (view.julia) gl.uniform2f(prog.u.u_julia, Number(view.julia.re), Number(view.julia.im));
    gl.viewport(0, 0, w, h);
    gl.uniform2f(prog.u.u_res, w, h);
    gl.uniform1i(prog.u.u_maxIter, view.maxIter);
    gl.uniform1i(prog.u.u_palette, this.palette | 0);
    this.refCpuMs = refCpuMs;
    // Timing belongs to one frame: drop queries a cancelled frame left behind.
    if (fresh && !this.timing) {
      for (const q of this.queries) gl.deleteQuery(q);
      this.queries = [];
    }
    const strips = Math.max(1, Math.ceil((w * h * iters * COST[name]) / STRIP_BUDGET));
    return { strips: Math.min(strips, h) };
  }

  // Draw strip i of n. Each strip gets its own timer query; gpuTime() sums them.
  drawStrip(i, n) {
    if (this.lost) return;
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const y0 = Math.floor((h * i) / n);
    const y1 = Math.floor((h * (i + 1)) / n);
    if (n > 1) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, y0, w, y1 - y0);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    let query = null;
    if (this.timer && !this.timing) {
      query = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.queries.push(query);
    }
    if (n > 1) gl.disable(gl.SCISSOR_TEST);
  }

  // Draw a whole frame synchronously (thumbnails, PNG export).
  renderAll(view) {
    const { strips } = this.begin(view);
    for (let i = 0; i < strips; i++) this.drawStrip(i, strips);
  }

  // Resolves with total GPU time in ms for the queries issued so far in the
  // current frame, or null. Single-flight: concurrent callers share one poll.
  gpuTime() {
    if (this.timing) return this.timing;
    if (!this.queries.length) return Promise.resolve(null);
    const qs = this.queries;
    this.queries = [];
    this.timing = this.pollQueries(qs).finally(() => { this.timing = null; });
    return this.timing;
  }

  async pollQueries(qs) {
    const gl = this.gl;
    let result = null;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 16));
      if (this.lost) return null;
      if (qs.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) {
        const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
        let ns = 0;
        for (const q of qs) ns += gl.getQueryParameter(q, gl.QUERY_RESULT);
        result = disjoint ? null : ns / 1e6;
        break;
      }
    }
    for (const q of qs) gl.deleteQuery(q);
    return result;
  }
}
