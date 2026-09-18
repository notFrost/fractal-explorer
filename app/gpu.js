import { MAX_ITER, STAGE_HEIGHT, FLOAT_LOG_ZOOM, BIG_LOG_ZOOM, FE_LOG_ZOOM } from './fractals.js';
import { bitsFor, ORBITS } from './precision.js';
import { VERT, COMMON, BLIT } from './shaders/common.js';
import { customBody, depthBody } from './shaders/custom.js';
import { SOURCES, SHADERS, COST } from './shaders/registry.js';

const UNIFORMS = ['u_res', 'u_px', 'u_center', 'u_offset', 'u_rot', 'u_pxm', 'u_pxe', 'u_maxIter', 'u_refLen', 'u_ref2', 'u_julia', 'u_ref', 'u_palette'];
const BLIT_UNIFORMS = ['u_src', 'u_dst', 'u_lo', 'u_hi'];
const REF_W = 1024;

// A pass costs its pixels times its iterations times the shader's weight.
// STRIP_BUDGET is what one draw call may spend before it runs long enough to
// trip the GPU watchdog.
const STRIP_BUDGET = 2e9;

// The weights in COST are relative, so what a unit of them costs in
// milliseconds belongs to the machine and to the shader: a perturbation pass
// runs an order of magnitude slower per unit than a float32 one. Every full
// pass that the timer extension reports is measured back into a rate per
// shader, and a shader with no measurement yet starts from SEED_RATE. Without
// the extension nothing is ever measured and the seed stands.
const SEED_RATE = 3e7;

// What a coarse pass aims to spend, in milliseconds. A view that draws in
// under this at full size gets no coarse pass at all.
const FRAME_MS = 12;

// How far down the coarse pass may shrink. Deep views cost more than any
// readable size can spend, and below this the picture says nothing about where
// the view is.
const COARSE_FLOOR = 1 / 16;

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
    this.rates = new Map();
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
    this.blit = this.link(BLIT, BLIT_UNIFORMS);
    this.passFbo = null;
    this.passTex = null;
    this.texW = 0;
    this.texH = 0;
    this.passW = this.canvas.width;
    this.passH = this.canvas.height;
    this.queries = [];
    this.timing = null;
    this.maxSide = Math.min(gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], 8192);
  }

  link(src, names = UNIFORMS) {
    const gl = this.gl;
    const fs = compile(gl, gl.FRAGMENT_SHADER, src);
    const p = gl.createProgram();
    gl.attachShader(p, this.vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
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

  // Which shader a view draws with and how many iterations it runs, worked
  // out from the camera alone. begin() takes the same route; picking a coarse
  // scale needs the answer before any GPU work starts.
  plan(view) {
    const shaders = SHADERS[view.set];
    const orbit = ORBITS[view.set];
    const iters = orbit.iters(view.maxIter);
    const deep = !shaders.float || this.forceDeep || view.cam.lz > FLOAT_LOG_ZOOM;
    if (!deep) return { name: shaders.float, iters, deep };
    const big = !orbit.double || view.cam.lz > BIG_LOG_ZOOM;
    return { name: big && view.cam.lz > FE_LOG_ZOOM ? shaders.fe : shaders.pert, iters, deep };
  }

  // The fraction of the canvas a first pass draws at: the largest one that
  // still fits a frame at the rate this shader has been running. 1 when the
  // whole picture already fits, so a cheap view draws once at full size and
  // pays nothing for the coarse pass.
  coarseScale(view) {
    const { name, iters } = this.plan(view);
    const full = this.canvas.width * this.canvas.height * iters * COST[name];
    const rate = this.rates.get(name) ?? SEED_RATE;
    let s = 1;
    while (s > COARSE_FLOOR && (full * s * s) / rate > FRAME_MS) s /= 2;
    return s;
  }

  // Where a coarse pass draws, kept at the size of that pass. texStorage2D
  // fixes a texture's size, so a change of size makes a new one.
  passTarget(w, h) {
    const gl = this.gl;
    this.passFbo ??= gl.createFramebuffer();
    if (this.passTex && this.texW === w && this.texH === h) return;
    if (this.passTex) gl.deleteTexture(this.passTex);
    this.passTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.passTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texW = w;
    this.texH = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.passFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.passTex, 0);
  }

  // Spreads the coarse pass over the whole canvas. The full-size pass then
  // draws straight onto the canvas strip by strip, so each band it finishes
  // replaces the blurred one under it and the rest of the picture stays up.
  present() {
    if (this.lost || !this.passTex) return;
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    const prog = this.blit;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.passTex);
    gl.uniform1i(prog.u.u_src, 0);
    gl.uniform2f(prog.u.u_dst, w, h);
    gl.uniform2f(prog.u.u_lo, 0.5 / this.texW, 0.5 / this.texH);
    gl.uniform2f(prog.u.u_hi, (this.texW - 0.5) / this.texW, (this.texH - 0.5) / this.texH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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

  // Sets a pass up and says how many strips it takes. `scale` is the fraction
  // of the canvas it covers: below 1 it draws into the offscreen target for
  // present() to spread, at 1 it draws straight onto the canvas.
  begin(view, fresh = true, scale = 1) {
    if (this.lost) return { strips: 0 };
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.width * scale));
    const h = Math.max(1, Math.round(this.canvas.height * scale));
    this.passW = w;
    this.passH = h;
    if (scale < 1) {
      this.passTarget(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.passFbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const { cam } = view;
    // Stage pixels to a pass pixel. A coarse pass has fewer of them across the
    // same view, which is the whole of what makes it cheap.
    const stage = h / STAGE_HEIGHT;
    const { name, iters, deep } = this.plan(view);
    let refCpuMs = 0;

    if (deep) {
      const ref = this.ensureReference(view, iters, Math.max(w, h) / stage);
      refCpuMs = ref.cpuMs;
      const o = cam.offsetFrom(ref.cam);
      const prog = this.programs[name];
      gl.useProgram(prog.p);
      gl.uniform2f(prog.u.u_offset, o.x * stage, o.y * stage);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.refTex);
      gl.uniform1i(prog.u.u_ref, 0);
      gl.uniform1i(prog.u.u_refLen, ref.texels ?? ref.len);
      gl.uniform1i(prog.u.u_ref2, ref.split ?? 0);
      const e = Math.floor(-cam.lz);
      const m = 2 ** (-cam.lz - e) / stage;
      gl.uniform1f(prog.u.u_pxm, m);
      gl.uniform1i(prog.u.u_pxe, e);
      gl.uniform1f(prog.u.u_px, m * 2 ** e);
      gl.uniform2f(prog.u.u_center, cam.xDouble(), cam.yDouble());
      this.tier = ref.big ? (cam.lz > FE_LOG_ZOOM ? 'fe' : 'big') : 'double';
    } else {
      const prog = this.programs[name];
      gl.useProgram(prog.p);
      gl.uniform1f(prog.u.u_px, 1 / (stage * cam.zoom));
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
    const cost = w * h * iters * COST[name];
    this.passName = name;
    this.passCost = cost;
    const strips = Math.max(1, Math.ceil(cost / STRIP_BUDGET));
    return { strips: Math.min(strips, h) };
  }

  drawStrip(i, n) {
    if (this.lost) return;
    const gl = this.gl;
    const w = this.passW;
    const h = this.passH;
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
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const name = this.passName;
    const cost = this.passCost;
    this.queries = [];
    this.timing = this.pollQueries(qs)
      .then((ms) => {
        if (ms > 0) this.rates.set(name, cost / ms);
        return ms;
      })
      .finally(() => { this.timing = null; });
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
