import { SETS, iterationsFor } from './fractals.js';

// ---------- Worker pool (pull model: idle workers fetch the next band) ----------

class RenderPool {
  constructor(size) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs = new Map();
    for (let i = 0; i < size; i++) {
      const w = new Worker('./worker.js', { type: 'module' });
      w.onmessage = (e) => this.onResult(w, e.data);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  // tasks: array of band descriptors sharing one job id.
  run(id, tasks, onBand) {
    let remaining = tasks.length;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    this.jobs.set(id, {
      onBand,
      tick: () => {
        remaining--;
        if (remaining === 0) {
          this.jobs.delete(id);
          resolve(true);
        }
      },
      cancel() { resolve(false); },
    });
    for (const t of tasks) this.queue.push(t);
    this.pump();
    return done;
  }

  cancel(id) {
    this.queue = this.queue.filter((t) => t.id !== id);
    const job = this.jobs.get(id);
    if (job) {
      job.cancel();
      this.jobs.delete(id);
    }
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      w.postMessage(this.queue.shift());
    }
  }

  onResult(w, msg) {
    this.idle.push(w);
    const job = this.jobs.get(msg.id);
    if (job) {
      job.onBand(msg);
      job.tick();
    }
    this.pump();
  }
}

let poolInstance = null;
function getPool() {
  if (!poolInstance) poolInstance = new RenderPool(Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2)));
  return poolInstance;
}
let jobSeq = 0;

// Render one frame into ctx as a sequence of passes (block sizes).
// Returns a handle with cancel(); `done` resolves true if every pass finished.
function renderInto(ctx, view, passes, onProgress) {
  const id = ++jobSeq;
  const { width: w, height: h } = ctx.canvas;
  const scale = h / 360;
  let cancelled = false;

  const runPass = (step, maxIter) => {
    const rows = Math.max(step, Math.ceil(24 / step) * step);
    const tasks = [];
    for (let y0 = 0; y0 < h; y0 += rows) {
      tasks.push({
        id, set: view.set, w, h, y0, rows: Math.min(rows, h - y0), step, scale,
        zoom: view.zoom, camX: view.x, camY: view.y, maxIter,
      });
    }
    return getPool().run(id, tasks, (band) => {
      const img = new ImageData(new Uint8ClampedArray(band.buf), band.w, band.rows);
      ctx.putImageData(img, 0, band.y0);
    });
  };

  const done = (async () => {
    const t0 = performance.now();
    for (const p of passes) {
      if (cancelled) return false;
      const ok = await runPass(p.step, p.iter);
      if (!ok) return false;
      onProgress?.(p, performance.now() - t0);
    }
    return true;
  })();

  return {
    done,
    cancel() {
      cancelled = true;
      getPool().cancel(id);
    },
  };
}

// ---------- State ----------

const state = {
  set: 'mandelbrot',
  x: 0,
  y: 0,
  zoom: 100,
  detail: 1,
};

const $ = (s) => document.querySelector(s);
const menu = $('#menu');
const viewer = $('#viewer');
const canvas = $('#view');
const ctx = canvas.getContext('2d', { alpha: false });
const hud = {
  c: $('#hud-c'),
  zoom: $('#hud-zoom'),
  iter: $('#hud-iter'),
  detail: $('#hud-detail'),
  status: $('#hud-status'),
  bookmarks: $('#bookmarks'),
};

let current = null;
let mode = 'menu';

function fmt(n) {
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return n.toExponential(4);
  return n.toFixed(6).replace(/\.?0+$/, '') || '0';
}

function fmtZoom(z) {
  if (z >= 1e5) return z.toExponential(2) + '×';
  return Math.round(z).toLocaleString() + '×';
}

function updateHud() {
  const sign = state.y < 0 ? '−' : '+';
  hud.c.textContent = `${fmt(state.x)} ${sign} ${fmt(Math.abs(state.y))}i`;
  hud.zoom.textContent = fmtZoom(state.zoom);
  hud.iter.textContent = String(iterationsFor(state.zoom, state.detail));
  hud.detail.textContent = String(state.detail);
}

function writeHash() {
  const h = `#${state.set}@${state.x},${state.y},${state.zoom}`;
  history.replaceState(null, '', h);
}

function readHash() {
  const m = location.hash.match(/^#(\w+)@([-\d.e+]+),([-\d.e+]+),([\d.e+]+)$/);
  if (!m || !SETS[m[1]]) return false;
  state.set = m[1];
  state.x = Number(m[2]);
  state.y = Number(m[3]);
  state.zoom = Number(m[4]);
  return Number.isFinite(state.x) && Number.isFinite(state.y) && state.zoom > 0;
}

// ---------- Viewer rendering ----------

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

let renderQueued = false;

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  // Coalesce bursts of input into one render per turn of the event loop.
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}

function render() {
  if (mode !== 'view') return;
  fitCanvas();
  current?.cancel();
  const iter = iterationsFor(state.zoom, state.detail);
  const passes = [
    { step: 8, iter },
    { step: 2, iter },
    { step: 1, iter },
  ];
  hud.status.textContent = 'rendering…';
  const view = { ...state };
  current = renderInto(ctx, view, passes, (p, ms) => {
    if (p.step === 1) {
      hud.status.textContent = `${canvas.width}×${canvas.height} in ${Math.round(ms)} ms`;
    }
  });
  updateHud();
  writeHash();
}

// Full-quality render to an offscreen canvas at the on-screen size, then download.
async function savePng() {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const octx = off.getContext('2d', { alpha: false });
  const iter = iterationsFor(state.zoom, state.detail);
  hud.status.textContent = 'rendering for download…';
  const job = renderInto(octx, { ...state }, [{ step: 1, iter }]);
  const ok = await job.done;
  if (!ok) return;
  const name = `${state.set}_${fmt(state.x)}_${fmt(state.y)}_${Math.round(state.zoom)}x.png`;
  off.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    hud.status.textContent = `saved ${name}`;
  }, 'image/png');
}

// ---------- Input ----------

const keys = new Set();
let lastTick = 0;

function tick(now) {
  if (mode !== 'view') return;
  const dt = Math.min(0.05, (now - lastTick) / 1000) || 0;
  lastTick = now;
  let moved = false;

  // Pan in stage pixels per second, divided by zoom, like the original.
  const fast = keys.has('shift') ? 2 : 1;
  const pan = (300 * fast * dt) / state.zoom;
  if (keys.has('a') || keys.has('arrowleft')) { state.x -= pan; moved = true; }
  if (keys.has('d') || keys.has('arrowright')) { state.x += pan; moved = true; }
  if (keys.has('w') || keys.has('arrowup')) { state.y += pan; moved = true; }
  if (keys.has('s') || keys.has('arrowdown')) { state.y -= pan; moved = true; }

  const zf = Math.pow(3, dt); // 1.2 per original loop, about 3× per second here
  if (keys.has('e')) { state.zoom *= zf; moved = true; }
  if (keys.has('q')) { state.zoom /= zf; moved = true; }

  if (moved) requestRender();
  requestAnimationFrame(tick);
}

function startTicking() {
  lastTick = performance.now();
  requestAnimationFrame(tick);
}

const movementKeys = new Set(['a', 'd', 'w', 's', 'q', 'e', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);

window.addEventListener('keydown', (e) => {
  if (mode !== 'view') return;
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (movementKeys.has(k)) {
    e.preventDefault();
    if (keys.has(k)) return;
    if (!keys.size) startTicking();
    keys.add(k);
    // One discrete step on the tap, as the original did per loop; holding continues in tick().
    const fast = e.shiftKey ? 2 : 1;
    const pan = (10 * fast) / state.zoom;
    if (k === 'a' || k === 'arrowleft') state.x -= pan;
    if (k === 'd' || k === 'arrowright') state.x += pan;
    if (k === 'w' || k === 'arrowup') state.y += pan;
    if (k === 's' || k === 'arrowdown') state.y -= pan;
    if (k === 'e') state.zoom *= 1.2;
    if (k === 'q') state.zoom /= 1.2;
    requestRender();
    return;
  }
  if (k === ' ') { e.preventDefault(); savePng(); }
  if (k === 'escape') showMenu();
  if (k === '[') changeDetail(-1);
  if (k === ']') changeDetail(1);
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function changeDetail(dir) {
  const steps = [1, 2, 4, 8];
  const i = Math.max(0, Math.min(steps.length - 1, steps.indexOf(state.detail) + dir));
  state.detail = steps[i];
  requestRender();
}

// Zoom keeping the world point under (px, py) fixed.
function zoomAt(px, py, factor) {
  const dpr = canvas.width / canvas.clientWidth;
  const scale = canvas.height / 360;
  const sx = (px * dpr - canvas.width / 2) / scale;
  const sy = (canvas.height / 2 - py * dpr) / scale;
  const wx = sx / state.zoom + state.x;
  const wy = sy / state.zoom + state.y;
  state.zoom *= factor;
  state.x = wx - sx / state.zoom;
  state.y = wy - sy / state.zoom;
  requestRender();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.pow(1.2, -e.deltaY / 100);
  zoomAt(e.clientX, e.clientY, f);
}, { passive: false });

// Drag to pan, pinch to zoom.
const pointers = new Map();
let pinch = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('dragging');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dpr = canvas.width / canvas.clientWidth;
  const scale = canvas.height / 360;
  if (pointers.size === 1) {
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    state.x -= (dx * dpr) / scale / state.zoom;
    state.y += (dy * dpr) / scale / state.zoom;
    requestRender();
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && pinch.dist > 0) {
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.dist);
    }
    pinch.dist = d;
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// Touch bar: hold to repeat.
for (const btn of document.querySelectorAll('.tbtn')) {
  let timer = null;
  const act = btn.dataset.act;
  const fire = () => {
    if (act === 'zoom-in') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.1);
    if (act === 'zoom-out') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.1);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (act === 'detail-up') return changeDetail(1);
    if (act === 'detail-down') return changeDetail(-1);
    fire();
    timer = setInterval(fire, 60);
  });
  const stop = () => { clearInterval(timer); timer = null; };
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
}

$('#save').addEventListener('click', savePng);
$('#back').addEventListener('click', showMenu);

window.addEventListener('resize', () => { if (mode === 'view') requestRender(); });

// ---------- Screens ----------

function showViewer(set, view) {
  state.set = set;
  if (view) {
    state.x = view.x;
    state.y = view.y;
    state.zoom = view.zoom;
  }
  mode = 'view';
  menu.hidden = true;
  viewer.hidden = false;
  $('#set-name').textContent = SETS[set].name;

  hud.bookmarks.replaceChildren(
    ...SETS[set].bookmarks.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bookmark';
      el.textContent = `${fmt(b.x)}${b.y < 0 ? ' − ' : ' + '}${fmt(Math.abs(b.y))}i @ ${fmtZoom(b.zoom)}`;
      el.addEventListener('click', () => {
        state.x = b.x;
        state.y = b.y;
        state.zoom = b.zoom;
        requestRender();
      });
      return el;
    }),
  );

  requestRender();
}

function showMenu() {
  current?.cancel();
  current = null;
  keys.clear();
  mode = 'menu';
  viewer.hidden = true;
  menu.hidden = false;
  history.replaceState(null, '', location.pathname);
  renderCards();
}

function renderCards() {
  for (const card of document.querySelectorAll('.card')) {
    const set = card.dataset.set;
    const c = card.querySelector('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = c.clientWidth || 240;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssW * 0.75 * dpr);
    const cctx = c.getContext('2d', { alpha: false });
    renderInto(cctx, { set, x: 0, y: 0, zoom: 100 }, [{ step: 1, iter: iterationsFor(100) }]);
  }
}

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => showViewer(card.dataset.set, { x: 0, y: 0, zoom: 100 }));
}

// ---------- Boot ----------

window.__fx = { state, showViewer, showMenu, renderCards, renderInto, getPool, iterationsFor };
if (readHash()) {
  showViewer(state.set);
} else if (!location.search.includes('norender')) {
  renderCards();
}
