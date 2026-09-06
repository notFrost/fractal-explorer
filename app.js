import { SETS, MIN_ZOOM, iterationsFor } from './fractals.js';
import { Renderer } from './gpu.js';

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
const hud = {
  c: $('#hud-c'),
  zoom: $('#hud-zoom'),
  iter: $('#hud-iter'),
  detail: $('#hud-detail'),
  status: $('#hud-status'),
  bookmarks: $('#bookmarks'),
};

let renderer = null;
let mode = 'menu';

try {
  renderer = new Renderer(canvas);
} catch (err) {
  $('#gpu-error').hidden = false;
  $('#gpu-error').textContent = `${err.message} This explorer renders on the GPU and needs WebGL2.`;
}

function fmt(n) {
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return n.toExponential(4);
  return n.toFixed(6).replace(/\.?0+$/, '') || '0';
}

function fmtZoom(z) {
  if (z >= 1e5) return z.toExponential(2) + '×';
  return Math.round(z).toLocaleString() + '×';
}

function clampZoom(z) {
  return Math.min(SETS[state.set].maxZoom, Math.max(MIN_ZOOM, z));
}

function updateHud() {
  const sign = state.y < 0 ? '−' : '+';
  hud.c.textContent = `${fmt(state.x)} ${sign} ${fmt(Math.abs(state.y))}i`;
  hud.zoom.textContent = fmtZoom(state.zoom);
  hud.iter.textContent = String(iterationsFor(state.zoom, state.detail));
  hud.detail.textContent = String(state.detail);
}

function writeHash() {
  history.replaceState(null, '', `#${state.set}@${state.x},${state.y},${state.zoom}`);
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

// ---------- Rendering ----------

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
let statusSeq = 0;

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}

function render() {
  if (mode !== 'view' || !renderer) return;
  fitCanvas();
  state.zoom = clampZoom(state.zoom);
  const maxIter = iterationsFor(state.zoom, state.detail);
  renderer.render({ ...state, maxIter });
  updateHud();
  writeHash();

  const seq = ++statusSeq;
  hud.status.textContent = `${canvas.width}×${canvas.height} · GPU`;
  renderer.gpuTime().then((ms) => {
    if (seq !== statusSeq || ms === null) return;
    hud.status.textContent = `${canvas.width}×${canvas.height} · GPU ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  });
}

// Render at twice the screen size, download, then restore the view.
function savePng() {
  if (!renderer) return;
  const cap = renderer.maxSide;
  const scale = Math.min(2, cap / canvas.width, cap / canvas.height);
  const w = canvas.width;
  const h = canvas.height;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  renderer.render({ ...state, maxIter: iterationsFor(state.zoom, state.detail) });
  const name = `${state.set}_${fmt(state.x)}_${fmt(state.y)}_${Math.round(state.zoom)}x.png`;
  hud.status.textContent = `rendering ${canvas.width}×${canvas.height} for download…`;
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    hud.status.textContent = `saved ${name}`;
  }, 'image/png');
  canvas.width = w;
  canvas.height = h;
  renderer.render({ ...state, maxIter: iterationsFor(state.zoom, state.detail) });
}

// ---------- Input ----------

const keys = new Set();
let lastTick = 0;

function tick(now) {
  if (mode !== 'view') return;
  if (!keys.size) return;
  const dt = Math.min(0.05, (now - lastTick) / 1000) || 0;
  lastTick = now;
  let moved = false;

  const fast = keys.has('shift') ? 2 : 1;
  const pan = (300 * fast * dt) / state.zoom;
  if (keys.has('a') || keys.has('arrowleft')) { state.x -= pan; moved = true; }
  if (keys.has('d') || keys.has('arrowright')) { state.x += pan; moved = true; }
  if (keys.has('w') || keys.has('arrowup')) { state.y += pan; moved = true; }
  if (keys.has('s') || keys.has('arrowdown')) { state.y -= pan; moved = true; }

  const zf = Math.pow(4, dt);
  if (keys.has('e')) { state.zoom = clampZoom(state.zoom * zf); moved = true; }
  if (keys.has('q')) { state.zoom = clampZoom(state.zoom / zf); moved = true; }

  if (moved) requestRender();
  requestAnimationFrame(tick);
}

const movementKeys = new Set(['a', 'd', 'w', 's', 'q', 'e', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);

window.addEventListener('keydown', (e) => {
  if (mode !== 'view') return;
  const k = e.key.toLowerCase();
  if (movementKeys.has(k)) {
    e.preventDefault();
    if (keys.has(k)) return;
    if (!keys.size) {
      lastTick = performance.now();
      requestAnimationFrame(tick);
    }
    keys.add(k);
    // One discrete step on the tap; holding continues in tick().
    const fast = e.shiftKey ? 2 : 1;
    const pan = (10 * fast) / state.zoom;
    if (k === 'a' || k === 'arrowleft') state.x -= pan;
    if (k === 'd' || k === 'arrowright') state.x += pan;
    if (k === 'w' || k === 'arrowup') state.y += pan;
    if (k === 's' || k === 'arrowdown') state.y -= pan;
    if (k === 'e') state.zoom = clampZoom(state.zoom * 1.2);
    if (k === 'q') state.zoom = clampZoom(state.zoom / 1.2);
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
  state.zoom = clampZoom(state.zoom * factor);
  state.x = wx - sx / state.zoom;
  state.y = wy - sy / state.zoom;
  requestRender();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.pow(1.2, -e.deltaY / 100));
}, { passive: false });

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
    state.x -= ((e.clientX - p.x) * dpr) / scale / state.zoom;
    state.y += ((e.clientY - p.y) * dpr) / scale / state.zoom;
    requestRender();
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && pinch.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.dist);
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
  keys.clear();
  mode = 'menu';
  viewer.hidden = true;
  menu.hidden = false;
  history.replaceState(null, '', location.pathname);
  renderCards();
}

// The GL canvas draws each thumbnail, then a 2D canvas on the card copies it.
function renderCards() {
  if (!renderer) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const card of document.querySelectorAll('.card')) {
    const c = card.querySelector('canvas');
    const cssW = c.clientWidth || 240;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssW * 0.75 * dpr);
    canvas.width = c.width;
    canvas.height = c.height;
    renderer.render({ set: card.dataset.set, x: 0, y: 0, zoom: 100, maxIter: iterationsFor(100) });
    c.getContext('2d').drawImage(canvas, 0, 0);
  }
}

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => showViewer(card.dataset.set, { x: 0, y: 0, zoom: 100 }));
}

// ---------- Boot ----------

window.__fx = { state, showViewer, showMenu, renderCards, renderer, iterationsFor };

if (readHash()) {
  showViewer(state.set);
} else {
  renderCards();
}
