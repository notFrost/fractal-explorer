import { MAX_ITER, referenceOrbit } from './fractals.js';

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
uniform float u_px;        // world units per pixel
uniform vec2 u_center;     // camera centre, float32 (direct sets only)
uniform int u_maxIter;
uniform int u_refLen;
uniform sampler2D u_ref;   // Mandelbrot reference orbit, RG32F, 1024 wide

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

// Smooth escape count for bailout |z|^2 > 1e4.
float smoothT(int steps, float zz) {
  return float(steps) + 1.0 - log2(0.5 * log(zz));
}
`;

// Perturbation with Zhuoran-style rebasing. Pixel = reference + delta.
// delta_{n+1} = (2 Z_n + delta_n) delta_n + dc. When the pixel's orbit passes
// closer to the origin than its delta, restart against the reference's start.
const MANDELBROT = `
vec2 refAt(int i) { return texelFetch(u_ref, ivec2(i & 1023, i >> 10), 0).xy; }

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
    if (zz > 1e4) return smoothT(n + 1, zz);
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
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
    if (zz > 1e4) return smoothT(n + 1, zz);
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

const SOURCES = { mandelbrot: MANDELBROT, webb: WEBB, collatz: COLLATZ };
const REF_W = 1024;

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
    for (const [set, body] of Object.entries(SOURCES)) {
      const fs = compile(gl, gl.FRAGMENT_SHADER, COMMON + body);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.programs[set] = {
        p,
        u: Object.fromEntries(
          ['u_res', 'u_px', 'u_center', 'u_maxIter', 'u_refLen', 'u_ref'].map((n) => [n, gl.getUniformLocation(p, n)]),
        ),
      };
    }
    // One fixed-size texture and one staging buffer, reused for every frame.
    this.refRows = Math.ceil((MAX_ITER + 2) / REF_W);
    this.refBuf = new Float32Array(REF_W * this.refRows * 2);
    this.refTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, REF_W, this.refRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.refKey = '';
    this.refLen = 0;
    this.pendingQuery = null;
    this.timing = null;
    this.maxSide = Math.min(gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], 8192);
  }

  uploadReference(x, y, maxIter) {
    const key = `${x},${y},${maxIter}`;
    if (key === this.refKey) return;
    const len = referenceOrbit(x, y, maxIter, this.refBuf);
    const rows = Math.ceil(len / REF_W);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, REF_W, rows, gl.RG, gl.FLOAT, this.refBuf, 0);
    this.refKey = key;
    this.refLen = len;
  }

  // Draw one frame. view = { set, x, y, zoom, maxIter }. Size is the canvas size.
  render(view) {
    if (this.lost) return;
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const prog = this.programs[view.set];
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.u_res, w, h);
    gl.uniform1f(prog.u.u_px, 1 / ((h / 360) * view.zoom));
    gl.uniform2f(prog.u.u_center, view.x, view.y);
    gl.uniform1i(prog.u.u_maxIter, view.maxIter);
    if (view.set === 'mandelbrot') {
      this.uploadReference(view.x, view.y, view.maxIter);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.refTex);
      gl.uniform1i(prog.u.u_ref, 0);
      gl.uniform1i(prog.u.u_refLen, this.refLen);
    }

    let query = null;
    if (this.timer && !this.pendingQuery) {
      query = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.pendingQuery = query;
    }
  }

  // Resolves with GPU time in ms for the most recent timed frame, or null.
  // Single-flight: concurrent callers share one poll of the one live query.
  gpuTime() {
    if (this.timing) return this.timing;
    const q = this.pendingQuery;
    if (!q) return Promise.resolve(null);
    this.timing = this.pollQuery(q).finally(() => { this.timing = null; });
    return this.timing;
  }

  async pollQuery(q) {
    const gl = this.gl;
    let result = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 16));
      if (this.lost) return null;
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        result = disjoint ? null : ns / 1e6;
        break;
      }
    }
    gl.deleteQuery(q);
    this.pendingQuery = null;
    return result;
  }
}
