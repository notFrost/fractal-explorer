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
uniform sampler2D u_ref;   // reference orbit, RGBA32F, 1024 wide

out vec4 outColor;

// Pen colour from the original: hue (t + 90) mod 100 on a 0..100 wheel,
// brightness t * 5 clamped, full saturation. Inside points stay black.
vec3 palette(float t) {
  if (!(t > 0.0)) return vec3(0.0);
  float h = fract((t + 90.0) / 100.0);
  float v = clamp(t * 5.0, 0.0, 100.0) / 100.0;
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb * v;
}

vec2 csq(vec2 z) { return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// Smooth escape count for bailout |z|^2 > 1e4, given log(|z|^2).
float smoothT(int steps, float logzz) {
  return float(steps) + 1.0 - log2(0.5 * logzz);
}

vec4 refAt(int i) { return texelFetch(u_ref, ivec2(i & 1023, i >> 10), 0); }
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
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
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

const SOURCES = {
  mandelbrot: MANDELBROT,
  mandelbrotFE: MANDELBROT_FE,
  webb: WEBB,
  webbPert: WEBB_PERT,
  webbFE: WEBB_FE,
  collatz: COLLATZ,
  collatzPert: COLLATZ_PERT,
};

// Programs per set: `float` iterates directly (absent for Mandelbrot, which is
// always perturbed), `pert` carries float32 deltas, `fe` floatexp deltas.
const SHADERS = {
  mandelbrot: { pert: 'mandelbrot', fe: 'mandelbrotFE' },
  webb: { float: 'webb', pert: 'webbPert', fe: 'webbFE' },
  collatz: { float: 'collatz', pert: 'collatzPert', fe: 'collatzPert' },
};

// Relative cost of one pixel-iteration, for splitting frames into strips.
const COST = { mandelbrot: 1, mandelbrotFE: 5, webb: 1, webbPert: 1.5, webbFE: 6, collatz: 1, collatzPert: 8 };

const UNIFORMS = ['u_res', 'u_px', 'u_center', 'u_offset', 'u_pxm', 'u_pxe', 'u_maxIter', 'u_refLen', 'u_ref'];
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
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.setup(); });
    this.setup();
  }

  setup() {
    const gl = this.gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.programs = {};
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    for (const [name, body] of Object.entries(SOURCES)) {
      const fs = compile(gl, gl.FRAGMENT_SHADER, COMMON + body);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.programs[name] = { p, u: Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)])) };
    }
    // One fixed-size texture and one staging buffer, reused for every reference.
    // Sized for the longest orbit at one texel per step; Collatz uses two per
    // step but stops at 500.
    this.refRows = Math.ceil((MAX_ITER + 2) / REF_W);
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

  // ---------- Reference orbit cache ----------

  // Ensure the cached reference suits this view. Recomputes when the set
  // changes, the camera moved more than two screens from the reference, the
  // zoom needs more precision, or more iterations are needed than stored.
  ensureReference(view, iters, screenPx) {
    const { cam, set } = view;
    const orbit = ORBITS[set];
    const big = !orbit.double || cam.lz > BIG_LOG_ZOOM;
    const bits = big ? bitsFor(cam.lz) : 64;
    let ref = this.ref;
    let reuse = false;
    if (ref && ref.set === set && ref.big === big && ref.bits >= bits) {
      const o = cam.offsetFrom(ref.cam);
      if (Math.abs(o.x) <= 2 * screenPx && Math.abs(o.y) <= 2 * screenPx) reuse = true;
    }
    if (reuse && (ref.len > iters || ref.escaped)) return ref;

    const t0 = performance.now();
    if (reuse) {
      // Extend the stored orbit.
      const r = ref.big
        ? orbit.big(ref.cam.x, ref.cam.y, ref.bits, iters, this.refBuf, ref)
        : orbit.double(ref.cam.xDouble(), ref.cam.yDouble(), iters, this.refBuf);
      Object.assign(ref, r);
    } else {
      // Carry 64 spare bits so the orbit stays valid for 2^64 of further zoom.
      const c = cam.clone();
      if (big) c.setLogZoom(cam.lz + 64);
      const r = big
        ? orbit.big(c.x, c.y, c.bits, iters, this.refBuf)
        : orbit.double(c.xDouble(), c.yDouble(), iters, this.refBuf);
      ref = { set, cam: c, bits: big ? c.bits : 64, big, ...r };
    }
    ref.iters = iters;
    ref.cpuMs = performance.now() - t0;
    const rows = Math.ceil((ref.len * orbit.stride) / REF_W);
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
      gl.uniform1i(prog.u.u_refLen, ref.len);
      // pixel size = 2^-lz / scale, split into mantissa and exponent
      const e = Math.floor(-cam.lz);
      const m = 2 ** (-cam.lz - e) / scale;
      gl.uniform1f(prog.u.u_pxm, m);
      gl.uniform1i(prog.u.u_pxe, e);
      gl.uniform1f(prog.u.u_px, m * 2 ** e);
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
    gl.viewport(0, 0, w, h);
    gl.uniform2f(prog.u.u_res, w, h);
    gl.uniform1i(prog.u.u_maxIter, view.maxIter);
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
