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
const goto = {
  form: $('#goto'),
  x: $('#goto-x'),
  y: $('#goto-y'),
  zoom: $('#goto-zoom'),
  any: $('#goto-any'),
  error: $('#goto-error'),
};

let renderer = null;
let mode = 'menu';

try {
  renderer = new Renderer(canvas);
} catch (err) {
  $('#gpu-error').hidden = false;
  $('#gpu-error').textContent = `${err.message} This explorer renders on the GPU and needs WebGL2.`;
}

const iterNow = () => iterationsFor(state.cam.lz, state.detail, state.set);

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
  return Math.max(MIN_LOG_ZOOM, lz);
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
  hud.c.title = state.cam.lz < 40 ? 'Edit the coordinate (G)' : `${state.cam.xString()}\n${state.cam.yString()}`;
  hud.zoom.textContent = fmtZoom(state.cam.lz);
  hud.iter.textContent = String(iterNow());
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
  const maxIter = iterNow();
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
  const maxIter = iterNow();
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

// ---------- Go to a location ----------

// log2 zoom from "1e12", "2^1000", "10^301", "40,000×" or "1.5e3x". NaN if unreadable.
function parseZoom(str) {
  const s = String(str).trim().toLowerCase().replace(/[×x]$/, '').replace(/(\d),(?=\d{3}\b)/g, '$1').trim();
  let m;
  if ((m = /^2\^(-?[\d.]+)$/.exec(s))) return Number(m[1]);
  if ((m = /^10\^(-?[\d.]+)$/.exec(s))) return Number(m[1]) * Math.log2(10);
  const z = Number(s);
  return z > 0 ? Math.log2(z) : NaN;
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const COMPLEX = new RegExp(`^(${NUM})\\s*([-+])\\s*(${NUM})\\s*i(?:\\s*@\\s*(.+))?$`, 'i');

// Reads a share link or its hash, "x, y[, zoom]", or the HUD's "x ± yi [@ zoom]".
// Returns { set?, xs, ys, lz? } with lz undefined when the text gives no zoom.
function parseLocation(text) {
  const t = String(text).trim().replace(/[−–]/g, '-');
  let m = /(mandelbrot|collatz|webb)@([^,\s]+),([^,\s]+),([^,\s#]+)/i.exec(t);
  if (m) return { set: m[1].toLowerCase(), xs: m[2], ys: m[3], lz: parseZoom(m[4]) };
  m = COMPLEX.exec(t);
  if (m) return { xs: m[1], ys: m[2] + m[3].replace(/^[-+]/, ''), lz: m[4] ? parseZoom(m[4]) : undefined };
  const parts = t.split(/[,\s;]+/).filter(Boolean);
  if (parts.length === 2 || parts.length === 3) {
    return { xs: parts[0], ys: parts[1], lz: parts[2] ? parseZoom(parts[2]) : undefined };
  }
  return null;
}

// Moves the camera. Returns an error string, or null when it went.
function goTo(loc) {
  const lz = loc.lz === undefined ? state.cam.lz : loc.lz;
  if (!Number.isFinite(lz)) return 'could not read the zoom';
  const cam = Camera.fromDecimal(loc.xs, loc.ys, clampLogZoom(lz));
  if (!cam) return 'could not read the coordinate';
  if (loc.set && loc.set !== state.set) showViewer(loc.set);
  state.cam = cam;
  requestRender();
  return null;
}

function openGoto() {
  if (mode !== 'view') return;
  keys.clear();
  const c = state.cam;
  goto.x.value = c.xString();
  goto.y.value = c.yString();
  goto.zoom.value = c.zoomString();
  goto.any.value = '';
  goto.error.textContent = '';
  goto.form.hidden = false;
  goto.any.focus();
}

function closeGoto() {
  goto.form.hidden = true;
  goto.any.blur();
}

goto.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const any = goto.any.value.trim();
  const loc = any ? parseLocation(any) : { xs: goto.x.value, ys: goto.y.value, lz: parseZoom(goto.zoom.value) };
  const err = loc ? goTo(loc) : 'could not read that';
  if (err) {
    goto.error.textContent = err;
    return;
  }
  closeGoto();
});
$('#goto-cancel').addEventListener('click', closeGoto);
hud.c.addEventListener('click', openGoto);
hud.zoom.addEventListener('click', openGoto);

// A coordinate pasted anywhere in the viewer goes straight there.
window.addEventListener('paste', (e) => {
  if (mode !== 'view' || e.target.closest?.('input, textarea')) return;
  const loc = parseLocation(e.clipboardData?.getData('text') || '');
  if (!loc) return;
  e.preventDefault();
  const err = goTo(loc);
  if (err) hud.status.textContent = `pasted text: ${err}`;
});

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
  if (e.target.closest?.('input, textarea')) {
    if (e.key === 'Escape') closeGoto();
    return;
  }
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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ') { e.preventDefault(); savePng(); }
  if (k === 'escape') (goto.form.hidden ? showMenu : closeGoto)();
  if (k === '[') changeDetail(-1);
  if (k === ']') changeDetail(1);
  if (k === 'g') { e.preventDefault(); openGoto(); }
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

// Bookmarks hold numbers for shallow spots and decimal strings for deep ones.
function bookmarkCamera(b) {
  if (typeof b.x === 'string') return Camera.fromDecimal(b.x, b.y, parseZoom(b.zoom));
  return new Camera(b.x, b.y, b.zoom);
}

function showViewer(set, view) {
  state.set = set;
  if (view) state.cam = new Camera(view.x, view.y, view.zoom);
  mode = 'view';
  document.body.classList.add('viewing');
  menu.hidden = true;
  viewer.hidden = false;
  closeGoto();
  $('#set-name').textContent = SETS[set].name;

  hud.bookmarks.replaceChildren(
    ...SETS[set].bookmarks.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bookmark';
      const x = Number(b.x);
      const y = Number(b.y);
      el.textContent = `${fmt(x)}${y < 0 ? ' − ' : ' + '}${fmt(Math.abs(y))}i @ ${fmtZoom(parseZoom(b.zoom))}`;
      el.addEventListener('click', () => {
        state.cam = bookmarkCamera(b);
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
    renderer.renderAll({ set: card.dataset.set, cam: home, maxIter: iterationsFor(home.lz, 1, card.dataset.set) });
    c.getContext('2d').drawImage(canvas, 0, 0);
  }
}

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => showViewer(card.dataset.set, { x: 0, y: 0, zoom: 100 }));
}

// ---------- Boot ----------

window.__fx = { state, showViewer, showMenu, renderCards, render, renderer, iterationsFor, Camera, parseLocation, parseZoom, goTo };

if (readHash()) {
  showViewer(state.set);
} else {
  renderCards();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
