import { MAX_ITER, BIG_LOG_ZOOM, FE_LOG_ZOOM } from './fractals.js';
import { bitsFor, referenceOrbitDouble, referenceOrbitBig } from './precision.js';

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
uniform sampler2D u_ref;   // reference orbit, RG32F, 1024 wide

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

vec2 refAt(int i) { return texelFetch(u_ref, ivec2(i & 1023, i >> 10), 0).xy; }
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
    vec2 Z = refAt(m);
    d = cmul(2.0 * Z + d, d) + dc;
    m++;
    vec2 z = refAt(min(m, last)) + d;
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
const MANDELBROT_FE = `
const int EMIN = -1000000;
struct FE { vec2 m; int e; };

// 2^k for |k| up to about 250, built from two exponent-field constructions.
float pow2(int k) {
  int h = k >> 1;
  return intBitsToFloat((h + 127) << 23) * intBitsToFloat((k - h + 127) << 23);
}

// Normalise so max(|m.x|, |m.y|) is in [0.5, 1). Denormals count as zero.
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

float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m);
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(cmul(t, d.m), d.e), dc);
    m++;
    FE z = feAdd(fe(refAt(min(m, last)), 0), d);
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

const SOURCES = { mandelbrot: MANDELBROT, mandelbrotFE: MANDELBROT_FE, webb: WEBB, collatz: COLLATZ };
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
    this.refRows = Math.ceil((MAX_ITER + 2) / REF_W);
    this.refBuf = new Float32Array(REF_W * this.refRows * 2);
    this.refTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, REF_W, this.refRows);
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

  // Returns the tier in use: 'double', 'big' or 'fe'.
  static tierFor(lz) {
    if (lz > FE_LOG_ZOOM) return 'fe';
    if (lz > BIG_LOG_ZOOM) return 'big';
    return 'double';
  }

  // Ensure the cached reference suits this camera. Recomputes when the set
  // changes, the camera moved more than two screens from the reference, the
  // zoom needs more precision, or more iterations are needed than stored.
  ensureReference(cam, maxIter, screenPx) {
    const bits = cam.lz > BIG_LOG_ZOOM ? bitsFor(cam.lz) : 64;
    let ref = this.ref;
    let reuse = false;
    if (ref && ref.bits >= bits && ref.big === cam.lz > BIG_LOG_ZOOM) {
      const o = cam.offsetFrom(ref.cam);
      if (Math.abs(o.x) <= 2 * screenPx && Math.abs(o.y) <= 2 * screenPx) reuse = true;
    }
    if (reuse && (ref.len > maxIter || ref.escaped)) return ref;

    const t0 = performance.now();
    if (reuse) {
      // Extend the stored orbit.
      const r = ref.big
        ? referenceOrbitBig(ref.cam.x, ref.cam.y, ref.bits, maxIter, this.refBuf, ref)
        : referenceOrbitDouble(ref.cam.xDouble(), ref.cam.yDouble(), maxIter, this.refBuf);
      Object.assign(ref, r);
    } else {
      // Carry 64 spare bits so the orbit stays valid for 2^64 of further zoom.
      const big = cam.lz > BIG_LOG_ZOOM;
      const c = cam.clone();
      if (big) c.setLogZoom(cam.lz + 64);
      const r = big
        ? referenceOrbitBig(c.x, c.y, c.bits, maxIter, this.refBuf)
        : referenceOrbitDouble(c.xDouble(), c.yDouble(), maxIter, this.refBuf);
      ref = { cam: c, bits: big ? c.bits : 64, big, maxIter, ...r };
    }
    ref.maxIter = maxIter;
    ref.cpuMs = performance.now() - t0;
    const rows = Math.ceil(ref.len / REF_W);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, REF_W, rows, gl.RG, gl.FLOAT, this.refBuf, 0);
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
    let name = view.set;
    let cost = 1;
    let refCpuMs = 0;

    if (view.set === 'mandelbrot') {
      const tier = Renderer.tierFor(cam.lz);
      const ref = this.ensureReference(cam, view.maxIter, Math.max(w, h) / scale);
      refCpuMs = ref.cpuMs;
      const o = cam.offsetFrom(ref.cam);
      if (tier === 'fe') { name = 'mandelbrotFE'; cost = 5; }
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
    const strips = Math.max(1, Math.ceil((w * h * view.maxIter * cost) / STRIP_BUDGET));
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
