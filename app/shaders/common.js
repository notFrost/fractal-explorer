
export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const COMMON = `#version 300 es
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
export const FE_LIB = `
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
