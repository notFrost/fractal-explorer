import { MAX_ITER, STAGE_HEIGHT, FLOAT_LOG_ZOOM, BIG_LOG_ZOOM, FE_LOG_ZOOM } from './fractals.js';
import { bitsFor, ORBITS } from './precision.js';
import { VERT, COMMON } from './shaders/common.js';
import { customBody, depthBody } from './shaders/custom.js';
import { SOURCES, SHADERS, COST } from './shaders/registry.js';

const UNIFORMS = ['u_res', 'u_px', 'u_center', 'u_offset', 'u_rot', 'u_pxm', 'u_pxe', 'u_maxIter', 'u_refLen', 'u_ref2', 'u_julia', 'u_ref', 'u_palette'];
const REF_W = 1024;

const STRIP_BUDGET = 2e9;

const customKey = (parts) => (parts ? [parts.iter, ...parts.seeds.map((s) => `${s.name}=${s.glsl}`)].join('|') : null);

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
    this.palette = 0;
    this.customs = new Map();
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
    const customs = this.customs;
    this.customs = new Map();
    for (const [name, parts] of customs) this.setCustom(name, parts);
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
    this.depth = null;
    this.depthKey = null;
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

  setCustom(name, parts) {
    if (customKey(parts) === customKey(this.customs.get(name) ?? null)) return;
    const prog = parts && this.link(COMMON + customBody(parts));
    if (this.programs[name]) this.gl.deleteProgram(this.programs[name].p);
    if (prog) {
      this.programs[name] = prog;
      this.customs.set(name, parts);
    } else {
      delete this.programs[name];
      this.customs.delete(name);
    }
  }

  ensureReference(view, iters, screenPx) {
    const { cam, set } = view;
    const orbit = ORBITS[set];
    const big = !orbit.double || cam.lz > BIG_LOG_ZOOM;
    const bits = big ? bitsFor(cam.lz) : 64;
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
      const r = ref.big
        ? orbit.big(ref.cam.x, ref.cam.y, ref.bits, iters, this.refBuf, ref, p)
        : orbit.double(ref.cam.xDouble(), ref.cam.yDouble(), iters, this.refBuf, p);
      Object.assign(ref, r);
    } else {
      const c = cam.clone();
      if (big) c.setLogZoom(cam.lz + 64);
      const r = big
        ? orbit.big(c.x, c.y, c.bits, iters, this.refBuf, null, p)
        : orbit.double(c.xDouble(), c.yDouble(), iters, this.refBuf, p);
      ref = { set, pkey, cam: c, bits: big ? c.bits : 64, big, ...r };
    }
    ref.iters = iters;
    ref.cpuMs = performance.now() - t0;
    const rows = Math.ceil((ref.texels ?? ref.len * orbit.stride) / REF_W);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, REF_W, rows, gl.RGBA, gl.FLOAT, this.refBuf, 0);
    this.ref = ref;
    return ref;
  }

  begin(view, fresh = true) {
    if (this.lost) return { strips: 0 };
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const { cam } = view;
    const scale = h / STAGE_HEIGHT;
    const shaders = SHADERS[view.set];
    const iters = ORBITS[view.set].iters(view.maxIter);
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
      gl.uniform1i(prog.u.u_refLen, ref.texels ?? ref.len);
      gl.uniform1i(prog.u.u_ref2, ref.split ?? 0);
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
    const angle = view.angle ?? 0;
    gl.uniform2f(prog.u.u_rot, Math.cos(angle), Math.sin(angle));
    gl.viewport(0, 0, w, h);
    gl.uniform2f(prog.u.u_res, w, h);
    gl.uniform1i(prog.u.u_maxIter, view.maxIter);
    gl.uniform1i(prog.u.u_palette, this.palette | 0);
    this.refCpuMs = refCpuMs;
    if (fresh && !this.timing) {
      for (const q of this.queries) gl.deleteQuery(q);
      this.queries = [];
    }
    const strips = Math.max(1, Math.ceil((w * h * iters * COST[name]) / STRIP_BUDGET));
    return { strips: Math.min(strips, h) };
  }

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

  renderAll(view) {
    const { strips } = this.begin(view);
    for (let i = 0; i < strips; i++) this.drawStrip(i, strips);
  }

  // The frame on screen, RGBA bytes, rows bottom up. The context keeps its
  // drawing buffer, so this is the last frame drawn on it, and a dive reads
  // the picture rather than drawing one of its own.
  framePixels() {
    if (this.lost) return null;
    const { width: w, height: h } = this.canvas;
    const bytes = new Uint8Array(w * h * 4);
    this.gl.readPixels(0, 0, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bytes);
    return { bytes, w, h };
  }

  // One byte per pixel of how long that pixel's orbit lasts, for framing a
  // typed formula. It draws at the float tier, upright and in one call, on a
  // canvas sized to the survey, and reads the bytes straight back.
  depthMap(parts, cam, w, h, maxIter) {
    if (this.lost) return null;
    const gl = this.gl;
    const key = customKey(parts);
    if (key !== this.depthKey) {
      if (this.depth) gl.deleteProgram(this.depth.p);
      this.depth = this.link(COMMON + depthBody(parts));
      this.depthKey = key;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    const prog = this.depth;
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.u_res, w, h);
    gl.uniform1f(prog.u.u_px, STAGE_HEIGHT / (h * cam.zoom));
    gl.uniform2f(prog.u.u_center, cam.xDouble(), cam.yDouble());
    gl.uniform2f(prog.u.u_rot, 1, 0);
    gl.uniform1i(prog.u.u_maxIter, maxIter);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const bytes = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return bytes;
  }

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
