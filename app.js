import { SETS, MIN_LOG_ZOOM, iterationsFor } from './fractals.js';
import { Camera } from './precision.js';
import { Renderer } from './gpu.js';

// ---------- State ----------

const state = {
  set: 'mandelbrot',
  cam: new Camera(0, 0, 100),
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

function fmtZoom(lz) {
  if (lz < Math.log2(1e5)) return Math.round(2 ** lz).toLocaleString() + '×';
  if (lz < 1000) return (2 ** lz).toExponential(2) + '×';
  return `10^${Math.round(lz * 0.30103)}×`;
}

function clampLogZoom(lz) {
  return Math.min(SETS[state.set].maxLogZoom, Math.max(MIN_LOG_ZOOM, lz));
}

// Deep zooms resolve hundreds of digits; the HUD shows the first 40 and keeps
// the full value in the tooltip and the URL.
function hudCoord() {
  const cam = state.cam;
  if (cam.lz < 40) return `${fmt(cam.xDouble())} ${cam.yDouble() < 0 ? '−' : '+'} ${fmt(Math.abs(cam.yDouble()))}i`;
  const cut = (s) => (s.length > 42 ? s.slice(0, 42) + '…' : s);
  const xs = cam.xString();
  const ys = cam.yString();
  return `${cut(xs)} ${ys.startsWith('-') ? '−' : '+'} ${cut(ys.replace(/^-/, ''))}i`;
}

function updateHud() {
  hud.c.textContent = hudCoord();
  hud.c.title = state.cam.lz < 40 ? '' : `${state.cam.xString()}\n${state.cam.yString()}`;
  hud.zoom.textContent = fmtZoom(state.cam.lz);
  hud.iter.textContent = String(iterationsFor(state.cam.lz, state.detail));
  hud.detail.textContent = String(state.detail);
}

// The URL is updated after input settles, never per frame.
let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (mode !== 'view') return;
    const c = state.cam;
    history.replaceState(null, '', `#${state.set}@${c.xString()},${c.yString()},${c.zoomString()}`);
  }, 300);
}

function readHash() {
  const m = location.hash.match(/^#(\w+)@([^,]+),([^,]+),([^,]+)$/);
  if (!m || !SETS[m[1]]) return false;
  const cam = Camera.fromStrings(m[2], m[3], m[4]);
  if (!cam) return false;
  state.set = m[1];
  state.cam = cam;
  return true;
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
let frameSeq = 0;

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}

function tierLabel() {
  switch (renderer.tier) {
    case 'double': return 'double';
    case 'big': return `${renderer.ref.bits}-bit`;
    case 'fe': return `${renderer.ref.bits}-bit + floatexp`;
    default: return 'float32';
  }
}

// One frame. Cheap frames are one draw call; deep frames are drawn in strips
// across successive animation frames so no draw call runs long enough to
// trip the GPU watchdog. A newer frame cancels the strips of the old one.
function render() {
  if (mode !== 'view' || !renderer) return;
  fitCanvas();
  state.cam.setLogZoom(clampLogZoom(state.cam.lz));
  const maxIter = iterationsFor(state.cam.lz, state.detail);
  const seq = ++frameSeq;
  const { strips } = renderer.begin({ set: state.set, cam: state.cam, maxIter });
  updateHud();
  scheduleHash();
  const size = `${canvas.width}×${canvas.height}`;
  const refNote = renderer.refCpuMs > 1 ? ` · ref ${Math.round(renderer.refCpuMs)} ms` : '';

  const label = tierLabel();
  const stripNote = strips > 1 ? ` · ${strips} strips` : '';
  const finish = () => {
    hud.status.textContent = `${size} · ${label}${stripNote}${refNote}`;
    renderer.gpuTime().then((ms) => {
      if (seq !== frameSeq || ms === null) return;
      hud.status.textContent = `${size} · ${label} · GPU ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms${stripNote}${refNote}`;
    });
  };

  let i = 0;
  const step = () => {
    if (seq !== frameSeq || mode !== 'view') return;
    // Uniforms may have been replaced by a thumbnail or export; re-issue them.
    if (i > 0) renderer.begin({ set: state.set, cam: state.cam, maxIter }, false);
    renderer.drawStrip(i, strips);
    i++;
    if (i < strips) {
      hud.status.textContent = `${size} · ${label} · strip ${i}/${strips}${refNote}`;
      requestAnimationFrame(step);
    } else {
      finish();
    }
  };
  step();
}

// Render at twice the screen size, download, then restore the view.
function savePng() {
  if (!renderer || mode !== 'view') return;
  const cap = renderer.maxSide;
  const scale = Math.min(2, cap / canvas.width, cap / canvas.height);
  const w = canvas.width;
  const h = canvas.height;
  const maxIter = iterationsFor(state.cam.lz, state.detail);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  hud.status.textContent = `rendering ${canvas.width}×${canvas.height} for download…`;
  renderer.renderAll({ set: state.set, cam: state.cam, maxIter });
  const c = state.cam;
  const name = `${state.set}_${c.xString().slice(0, 24)}_${c.yString().slice(0, 24)}_${c.zoomString()}x.png`;
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
  frameSeq++;
  requestRender();
}

// ---------- Continuous motion (keys held) ----------

const keys = new Set();
let motionLoop = false;
let lastTick = 0;

function startMotion() {
  if (motionLoop) return;
  motionLoop = true;
  lastTick = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  if (mode !== 'view' || !keys.size) {
    motionLoop = false;
    return;
  }
  const dt = Math.min(0.05, (now - lastTick) / 1000) || 0;
  lastTick = now;
  let moved = false;

  // Stage pixels per second, like the original's 10 px per loop.
  const fast = keys.has('shift') ? 2 : 1;
  const pan = 300 * fast * dt;
  let dx = 0;
  let dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx -= pan;
  if (keys.has('d') || keys.has('arrowright')) dx += pan;
  if (keys.has('w') || keys.has('arrowup')) dy += pan;
  if (keys.has('s') || keys.has('arrowdown')) dy -= pan;
  if (dx || dy) { state.cam.pan(dx, dy); moved = true; }

  const dlz = 2 * dt; // 4× per second
  if (keys.has('e')) { state.cam.setLogZoom(clampLogZoom(state.cam.lz + dlz)); moved = true; }
  if (keys.has('q')) { state.cam.setLogZoom(clampLogZoom(state.cam.lz - dlz)); moved = true; }

  if (moved) requestRender();
  requestAnimationFrame(tick);
}

// ---------- Keyboard ----------

const movementKeys = new Set(['a', 'd', 'w', 's', 'q', 'e', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
const STEP_LZ = Math.log2(1.2);

window.addEventListener('keydown', (e) => {
  if (mode !== 'view') return;
  const k = e.key.toLowerCase();
  if (movementKeys.has(k)) {
    e.preventDefault();
    if (keys.has(k)) return;
    keys.add(k);
    startMotion();
    // One discrete step on the tap; holding continues in tick().
    const pan = 10 * (e.shiftKey ? 2 : 1);
    if (k === 'a' || k === 'arrowleft') state.cam.pan(-pan, 0);
    if (k === 'd' || k === 'arrowright') state.cam.pan(pan, 0);
    if (k === 'w' || k === 'arrowup') state.cam.pan(0, pan);
    if (k === 's' || k === 'arrowdown') state.cam.pan(0, -pan);
    if (k === 'e') state.cam.setLogZoom(clampLogZoom(state.cam.lz + STEP_LZ));
    if (k === 'q') state.cam.setLogZoom(clampLogZoom(state.cam.lz - STEP_LZ));
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

// ---------- Pointer: drag, wheel, pinch ----------

// Stage-pixel offset of a client point from the canvas centre.
function stageOffset(px, py) {
  const dpr = canvas.width / canvas.clientWidth;
  const scale = canvas.height / 360;
  return {
    sx: (px * dpr - canvas.width / 2) / scale,
    sy: (canvas.height / 2 - py * dpr) / scale,
  };
}

// Zoom keeping the world point under (px, py) fixed.
function zoomAt(px, py, factor) {
  const { sx, sy } = stageOffset(px, py);
  const target = clampLogZoom(state.cam.lz + Math.log2(factor));
  state.cam.zoomAt(sx, sy, target - state.cam.lz);
  requestRender();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.pow(1.2, -e.deltaY / 100));
}, { passive: false });

const pointers = new Map();
let pinch = null;

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
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
    state.cam.pan(-((e.clientX - p.x) * dpr) / scale, ((e.clientY - p.y) * dpr) / scale);
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

// ---------- Buttons ----------

$('#detail-down').addEventListener('click', () => changeDetail(-1));
$('#detail-up').addEventListener('click', () => changeDetail(1));
$('#save').addEventListener('click', savePng);
$('#back').addEventListener('click', showMenu);
window.addEventListener('resize', () => { if (mode === 'view') requestRender(); });

// ---------- Screens ----------

function showViewer(set, view) {
  state.set = set;
  if (view) state.cam = new Camera(view.x, view.y, view.zoom);
  mode = 'view';
  document.body.classList.add('viewing');
  menu.hidden = true;
  viewer.hidden = false;
  $('#set-name').textContent = SETS[set].name;

  hud.bookmarks.replaceChildren(
    ...SETS[set].bookmarks.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bookmark';
      el.textContent = `${fmt(b.x)}${b.y < 0 ? ' − ' : ' + '}${fmt(Math.abs(b.y))}i @ ${fmtZoom(Math.log2(b.zoom))}`;
      el.addEventListener('click', () => {
        state.cam = new Camera(b.x, b.y, b.zoom);
        requestRender();
      });
      return el;
    }),
  );

  requestRender();
}

function showMenu() {
  keys.clear();
  frameSeq++;
  mode = 'menu';
  document.body.classList.remove('viewing');
  viewer.hidden = true;
  menu.hidden = false;
  clearTimeout(hashTimer);
  history.replaceState(null, '', location.pathname);
  renderCards();
}

// The GL canvas draws each thumbnail, then a 2D canvas on the card copies it.
function renderCards() {
  if (!renderer) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const home = new Camera(0, 0, 100);
  for (const card of document.querySelectorAll('.card')) {
    const c = card.querySelector('canvas');
    const cssW = c.clientWidth || 240;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssW * 0.75 * dpr);
    canvas.width = c.width;
    canvas.height = c.height;
    renderer.renderAll({ set: card.dataset.set, cam: home, maxIter: iterationsFor(home.lz) });
    c.getContext('2d').drawImage(canvas, 0, 0);
  }
}

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => showViewer(card.dataset.set, { x: 0, y: 0, zoom: 100 }));
}

// ---------- Boot ----------

window.__fx = { state, showViewer, showMenu, renderCards, render, renderer, iterationsFor, Camera };

if (readHash()) {
  showViewer(state.set);
} else {
  renderCards();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
