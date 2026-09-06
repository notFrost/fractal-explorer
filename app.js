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

// The URL is updated after input settles, never per frame.
let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (mode !== 'view') return;
    history.replaceState(null, '', `#${state.set}@${state.x},${state.y},${state.zoom}`);
  }, 300);
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
  renderer.render({ ...state, maxIter: iterationsFor(state.zoom, state.detail) });
  updateHud();
  scheduleHash();

  const seq = ++statusSeq;
  hud.status.textContent = `${canvas.width}×${canvas.height} · GPU`;
  renderer.gpuTime().then((ms) => {
    if (seq !== statusSeq || ms === null) return;
    hud.status.textContent = `${canvas.width}×${canvas.height} · GPU ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  });
}

// Render at twice the screen size, download, then restore the view.
function savePng() {
  if (!renderer || mode !== 'view') return;
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

// ---------- Continuous motion (keys held, joystick deflected) ----------

const keys = new Set();
const joy = { x: 0, y: 0, active: false };
let motionLoop = false;
let lastTick = 0;

function motionWanted() {
  return keys.size > 0 || joy.active;
}

function startMotion() {
  if (motionLoop) return;
  motionLoop = true;
  lastTick = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  if (mode !== 'view' || !motionWanted()) {
    motionLoop = false;
    return;
  }
  const dt = Math.min(0.05, (now - lastTick) / 1000) || 0;
  lastTick = now;
  let moved = false;

  // Stage pixels per second divided by zoom, like the original's 10 px per loop.
  const fast = keys.has('shift') ? 2 : 1;
  const pan = (300 * fast * dt) / state.zoom;
  if (keys.has('a') || keys.has('arrowleft')) { state.x -= pan; moved = true; }
  if (keys.has('d') || keys.has('arrowright')) { state.x += pan; moved = true; }
  if (keys.has('w') || keys.has('arrowup')) { state.y += pan; moved = true; }
  if (keys.has('s') || keys.has('arrowdown')) { state.y -= pan; moved = true; }

  const zf = Math.pow(4, dt);
  if (keys.has('e')) { state.zoom = clampZoom(state.zoom * zf); moved = true; }
  if (keys.has('q')) { state.zoom = clampZoom(state.zoom / zf); moved = true; }

  // Joystick: the original moved the camera by stick offset / (zoom × 3) per loop.
  if (joy.active && (joy.x || joy.y)) {
    state.x += (joy.x * 240 * dt) / state.zoom;
    state.y += (joy.y * 240 * dt) / state.zoom;
    moved = true;
  }

  if (moved) requestRender();
  requestAnimationFrame(tick);
}

// ---------- Keyboard ----------

const movementKeys = new Set(['a', 'd', 'w', 's', 'q', 'e', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);

window.addEventListener('keydown', (e) => {
  if (mode !== 'view') return;
  const k = e.key.toLowerCase();
  if (movementKeys.has(k)) {
    e.preventDefault();
    if (keys.has(k)) return;
    keys.add(k);
    startMotion();
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

// ---------- Pointer: drag, wheel, pinch ----------

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

function zoomCentre(factor) {
  zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
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

// ---------- Touch controls, after the original's mobile mode ----------
// Joystick bottom-right; zoom-in on the left edge with the screenshot button
// under it; zoom-out on the right edge. Buttons repeat while held.

const touchToggle = $('#touch-toggle');

function setTouch(on) {
  document.body.classList.toggle('touch', on);
  touchToggle.setAttribute('aria-pressed', String(on));
  localStorage.setItem('touch', on ? '1' : '0');
}

{
  const saved = localStorage.getItem('touch');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  setTouch(saved === null ? coarse : saved === '1');
}

touchToggle.addEventListener('click', () => setTouch(!document.body.classList.contains('touch')));

for (const btn of document.querySelectorAll('.tbtn[data-act]')) {
  const act = btn.dataset.act;
  let timer = 0;
  const fire = () => {
    if (act === 'zoom-in') zoomCentre(1.1);
    if (act === 'zoom-out') zoomCentre(1 / 1.1);
  };
  const stop = () => { clearInterval(timer); timer = 0; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (act === 'save') return savePng();
    if (act === 'detail-up') return changeDetail(1);
    if (act === 'detail-down') return changeDetail(-1);
    fire();
    stop();
    timer = setInterval(fire, 60);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

const joystick = $('#joystick');
const stick = joystick.querySelector('.stick');
let joyPointer = null;

function moveStick(e) {
  const r = joystick.getBoundingClientRect();
  const max = r.width * 0.3;
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx *= max / len;
    dy *= max / len;
  }
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
  joy.x = dx / max;
  joy.y = -dy / max;
}

joystick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { joystick.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  joyPointer = e.pointerId;
  joy.active = true;
  moveStick(e);
  startMotion();
});

joystick.addEventListener('pointermove', (e) => {
  if (e.pointerId === joyPointer) moveStick(e);
});

const releaseStick = (e) => {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  joy.active = false;
  joy.x = 0;
  joy.y = 0;
  stick.style.transform = '';
};
joystick.addEventListener('pointerup', releaseStick);
joystick.addEventListener('pointercancel', releaseStick);

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
  document.body.classList.add('viewing');
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
  joy.active = false;
  mode = 'menu';
  viewer.hidden = true;
  menu.hidden = false;
  document.body.classList.remove('viewing');
  clearTimeout(hashTimer);
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

window.__fx = { state, showViewer, showMenu, renderCards, render, renderer, iterationsFor, joy };

if (readHash()) {
  showViewer(state.set);
} else {
  renderCards();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
