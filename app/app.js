import { SETS, MIN_LOG_ZOOM, iterationsFor } from './fractals.js';
import { Camera } from './precision.js';
import { Renderer } from './gpu.js';
import { PALETTES, PALETTE_GROUPS, DEFAULT_PALETTE, paletteByKey } from './palettes.js';
import { parseFormula, parseSeed, formulaTokens, seedTokens, varGlsl, freeVarName, varNameError } from './formula.js';
import { frameCustom } from './framing.js';
import { pickSpot } from './dive.js';
import { readSaved, writeSaved, freeId, registerSet, unregisterSet } from './saved.js';

// ---------- State ----------

const state = {
  set: 'mandelbrot',
  cam: new Camera(0, 0, 100),
  detail: 1,
  // Degrees the view is turned anticlockwise. Rides in the URL as ?angle=.
  angle: 0,
  // Julia's parameter, kept as the strings the user typed so the hash
  // round-trips them exactly.
  julia: { ...SETS.julia.c },
  // Colourway key, see palettes.js. Rides in the URL as ?palette= and is
  // remembered per browser.
  palette: DEFAULT_PALETTE,
  formula: '',
  seedZ: '',
  seedC: '',
  vars: [],
};

const $ = (s) => document.querySelector(s);
const menu = $('#menu');
const cards = $('#cards');
const viewer = $('#viewer');
const canvas = $('#view');
const hud = {
  panel: $('.hud'),
  body: $('#hud-body'),
  toggle: $('#hud-toggle'),
  palettes: $('#palettes'),
  c: $('#hud-c'),
  zoom: $('#hud-zoom'),
  angle: $('#hud-angle'),
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
  rot: $('#goto-rot'),
  any: $('#goto-any'),
  error: $('#goto-error'),
};
const juliaUi = {
  panel: $('#julia-panel'),
  map: $('#julia-map'),
  re: $('#julia-re'),
  im: $('#julia-im'),
  presets: $('#julia-presets'),
  error: $('#julia-error'),
};
const setLabel = $('#set-c');
const backBtn = $('#back');
const editor = {
  page: $('#editor'),
  form: $('#editor-form'),
  error: $('#formula-error'),
  name: $('#fractal-name'),
  verb: $('#editor-verb'),
  saveHelp: $('#save-help'),
  input: { formula: $('#formula'), seedZ: $('#seed-z'), seedC: $('#seed-c') },
  ink: { formula: $('#formula-ink'), seedZ: $('#seed-z-ink'), seedC: $('#seed-c-ink') },
  seeds: $('#editor-seeds'),
  addVar: $('#add-var'),
  known: $('#formula-vars'),
};
const preview = {
  box: $('#preview'),
  canvas: $('#preview-canvas'),
  note: $('#preview-note'),
};

let renderer = null;
let mode = 'menu';

try {
  renderer = new Renderer(canvas);
} catch (err) {
  $('#gpu-error').hidden = false;
  $('#gpu-error').textContent = `${err.message} This explorer renders on the GPU and needs WebGL2.`;
  preview.box.hidden = true;
}

const iterNow = () => iterationsFor(state.cam.lz, state.detail, state.set);

// Everything a frame needs: which set, where, how hard, and Julia's C. The
// thumbnails and the Julia map pass no angle and stay upright.
const viewNow = (maxIter = iterNow()) => ({ set: state.set, cam: state.cam, maxIter, julia: state.julia, angle: radians(state.angle) });

// C as text, both for the URL and for the label above the HUD.
const juliaText = (c) => `${c.re} ${String(c.im).startsWith('-') ? '−' : '+'} ${String(c.im).replace(/^[-+]/, '')}i`;

// A pair of typed numbers, or null when either is unreadable.
function readC(re, im) {
  const ok = (s) => typeof s === 'string' && s.trim() !== '' && Number.isFinite(Number(s));
  return ok(re) && ok(im) ? { re: String(re).trim(), im: String(im).trim() } : null;
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

function clampLogZoom(lz, set = state.set) {
  return Math.min(SETS[set].maxLogZoom ?? Infinity, Math.max(MIN_LOG_ZOOM, lz));
}

// ---------- Turning the view ----------
//
// The angle is degrees anticlockwise, and only the screen turns. The centre,
// the reference orbit and the precision tiers are unchanged. The shader reads
// a pixel's offset along the plane's axes, so a move made in screen pixels
// passes through worldDelta on its way to the camera.

const DEGREE = Math.PI / 180;
const radians = (deg) => deg * DEGREE;
const normalisedAngle = (deg) => ((deg % 360) + 360) % 360;
const angleText = (deg) => String(Number(deg.toFixed(3)));

function setAngle(deg) {
  state.angle = normalisedAngle(deg);
  requestRender();
}

function worldDelta(sx, sy) {
  const c = Math.cos(radians(state.angle));
  const s = Math.sin(radians(state.angle));
  return { x: sx * c + sy * s, y: sy * c - sx * s };
}

// Stage pixels across the screen, turned onto the plane's axes for the camera.
function panBy(sx, sy) {
  const d = worldDelta(sx, sy);
  state.cam.pan(d.x, d.y);
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
  hud.angle.textContent = `${Number(state.angle.toFixed(1))}°`;
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
    // Julia carries its parameter in two extra fields: #julia@x,y,zoom,re,im
    const j = state.set === 'julia' ? `,${state.julia.re},${state.julia.im}` : '';
    const url = new URL(location.href);
    if (state.angle) url.searchParams.set('angle', angleText(state.angle));
    else url.searchParams.delete('angle');
    url.hash = `${state.set}@${c.xString()},${c.yString()},${c.zoomString()}${j}`;
    history.replaceState(null, '', url);
  }, 300);
}

function readHash() {
  const m = location.hash.match(/^#(\w+)@([^,]+),([^,]+),([^,]+)(?:,([^,]+),([^,]+))?$/);
  if (!m || !SETS[m[1]]) return false;
  if (m[1] === 'custom' && !hasCustom()) return false;
  const cam = Camera.fromStrings(m[2], m[3], m[4]);
  if (!cam) return false;
  state.set = m[1];
  state.cam = cam;
  state.julia = readC(m[5], m[6]) || { ...SETS.julia.c };
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
  const { strips } = renderer.begin(viewNow(maxIter));
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
    if (i > 0) renderer.begin(viewNow(maxIter), false);
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
  renderer.renderAll(viewNow(maxIter));
  const c = state.cam;
  const j = state.set === 'julia' ? `_C${state.julia.re}_${state.julia.im}i` : '';
  const pal = state.palette === DEFAULT_PALETTE ? '' : `_${state.palette}`;
  const rot = state.angle ? `_rot${angleText(state.angle)}` : '';
  const name = `${state.set}${j}_${c.xString().slice(0, 24)}_${c.yString().slice(0, 24)}_${c.zoomString()}x${rot}${pal}.png`;
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

function parseAngle(str) {
  const s = String(str).trim().replace(/[°º]$/, '').trim();
  if (!s) return 0;
  const deg = Number(s.replace(/[−–]/g, '-'));
  return Number.isFinite(deg) ? deg : NaN;
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const COMPLEX = new RegExp(`^(${NUM})\\s*([-+])\\s*(${NUM})\\s*i(?:\\s*@\\s*(.+))?$`, 'i');

// Julia links carry two extra fields for C. Saved sets join SETS as they load,
// so the pattern is rebuilt per read.
const linkPattern = () => new RegExp(
  `(${Object.keys(SETS).join('|')})@([^,\\s]+),([^,\\s]+),([^,\\s#]+)(?:,([^,\\s]+),([^,\\s#]+))?`,
  'i',
);

// Reads a share link or its hash, "x, y[, zoom]", or the HUD's "x ± yi [@ zoom]".
// Returns { set?, xs, ys, lz?, c? } with lz undefined when the text gives no zoom.
function parseLocation(text) {
  const t = String(text).trim().replace(/[−–]/g, '-');
  let m = linkPattern().exec(t);
  if (m) {
    const pal = /[?&]palette=(\w+)/i.exec(t);
    const rot = /[?&]angle=(-?[\d.]+)/i.exec(t);
    return {
      set: m[1].toLowerCase(),
      xs: m[2],
      ys: m[3],
      lz: parseZoom(m[4]),
      c: readC(m[5], m[6]),
      palette: pal?.[1],
      angle: rot ? Number(rot[1]) : 0,
    };
  }
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
  cancelDive();
  const lz = loc.lz === undefined ? state.cam.lz : loc.lz;
  if (!Number.isFinite(lz)) return 'could not read the zoom';
  const angle = loc.angle === undefined ? state.angle : loc.angle;
  if (!Number.isFinite(angle)) return 'could not read the rotation';
  const cam = Camera.fromDecimal(loc.xs, loc.ys, clampLogZoom(lz, loc.set));
  if (!cam) return 'could not read the coordinate';
  if (loc.c) state.julia = loc.c;
  else if (loc.set === 'julia' && state.set !== 'julia') state.julia = { ...SETS.julia.c };
  if (loc.palette && paletteByKey(loc.palette)) setPalette(loc.palette, { render: false });
  if (loc.set && loc.set !== state.set) showViewer(loc.set);
  else showJuliaUi();
  state.angle = normalisedAngle(angle);
  state.cam = cam;
  requestRender();
  return null;
}

function openGoto() {
  if (mode !== 'view') return;
  keys.clear();
  setHud(true);
  const c = state.cam;
  goto.x.value = c.xString();
  goto.y.value = c.yString();
  goto.zoom.value = c.zoomString();
  goto.rot.value = angleText(state.angle);
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
  const loc = any
    ? parseLocation(any)
    : { xs: goto.x.value, ys: goto.y.value, lz: parseZoom(goto.zoom.value), angle: parseAngle(goto.rot.value) };
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
hud.angle.addEventListener('click', openGoto);

// ---------- Folding the HUD away ----------

let hudOpen = true;

function setHud(open) {
  hudOpen = open;
  hud.body.hidden = !open;
  hud.panel.classList.toggle('collapsed', !open);
  hud.toggle.setAttribute('aria-expanded', String(open));
  hud.toggle.textContent = open ? '▾ hud' : '▸ hud';
  hud.toggle.title = open ? 'Hide the panel (H)' : 'Show the panel (H)';
  if (open) paintMap();
  else closeGoto();
}

hud.toggle.addEventListener('click', () => setHud(!hudOpen));

// ---------- Julia's parameter ----------

function showSetLabel() {
  const text = state.set === 'julia' ? `C = ${juliaText(state.julia)}`
    : SETS[state.set].custom ? SETS[state.set].formula
    : '';
  setLabel.textContent = text;
  setLabel.hidden = !text;
}

// The panel only means anything for Julia, so it is hidden everywhere else.
function showJuliaUi() {
  const on = state.set === 'julia';
  juliaUi.panel.hidden = !on;
  showSetLabel();
  if (!on) return;
  juliaUi.re.value = state.julia.re;
  juliaUi.im.value = state.julia.im;
  juliaUi.error.textContent = '';
  paintMap();
}

// Applies what is in the two inputs. Bad input keeps the old C and says so.
// Putting the old text back raises a second change event, so the unchanged
// case is left alone: only editing or a new C clears the message.
function applyJulia(re, im) {
  const c = readC(re, im);
  if (!c) {
    juliaUi.error.textContent = 'could not read that';
    juliaUi.re.value = state.julia.re;
    juliaUi.im.value = state.julia.im;
    return;
  }
  if (c.re === state.julia.re && c.im === state.julia.im) return;
  state.julia = c;
  showJuliaUi();
  requestRender();
}

const applyJuliaInputs = () => applyJulia(juliaUi.re.value, juliaUi.im.value);

for (const el of [juliaUi.re, juliaUi.im]) {
  el.addEventListener('change', applyJuliaInputs);
  el.addEventListener('input', () => { juliaUi.error.textContent = ''; });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyJuliaInputs();
    }
  });
}

juliaUi.presets.replaceChildren(
  ...SETS.julia.presets.map((p) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bookmark';
    el.textContent = p.name;
    el.title = `C = ${juliaText(p)}`;
    el.addEventListener('click', () => applyJulia(p.re, p.im));
    return el;
  }),
);

// ---------- The Mandelbrot map Julia's C is picked off ----------

// A C inside the Mandelbrot set gives a connected Julia set, a C outside gives
// dust, and the boundary between them gives the branching ones. The map to
// pick C off is therefore that set. A camera spans 360 / zoom down the canvas,
// so `span` is the world height: the whole set and a margin.
const MAP = { x: -0.75, y: 0, span: 2.7, detail: 4 };

// The map resolves about 0.018 of the plane per pixel, so five decimals is
// finer than a drag can aim and short enough to read back in the URL.
const mapText = (v) => String(Number(v.toFixed(5)));

const ACCENT = getComputedStyle(document.documentElement).getPropertyValue('--magenta').trim();

let mapImage = null;
let mapKey = '';

const mapPixel = (c, w, h) => ({
  px: w / 2 + (Number(c.re) - MAP.x) * (h / MAP.span),
  py: h / 2 - (Number(c.im) - MAP.y) * (h / MAP.span),
});

// Where a pointer event landed, in the plane. Offsets into the drawn box
// already leave out the border, the page scroll and the device ratio.
function mapC(e) {
  const map = juliaUi.map;
  const perPx = MAP.span / map.clientHeight;
  return {
    re: mapText(MAP.x + (e.offsetX - map.clientWidth / 2) * perPx),
    im: mapText(MAP.y + (map.clientHeight / 2 - e.offsetY) * perPx),
  };
}

// The viewer's GL canvas draws the map, as it draws the menu thumbnails, and a
// 2D canvas keeps the picture. Drawing costs a reference orbit the viewer then
// has to compute again, so it happens on a new colourway or size. A new C
// only moves the marker over the picture already drawn.
function drawMapImage(w, h) {
  const key = `${state.palette}|${w}×${h}`;
  if (mapKey === key) return true;
  if (!renderer) return false;
  const cam = new Camera(MAP.x, MAP.y, 360 / MAP.span);
  canvas.width = w;
  canvas.height = h;
  renderer.renderAll({ set: 'mandelbrot', cam, maxIter: iterationsFor(cam.lz, MAP.detail, 'mandelbrot') });
  mapImage ??= document.createElement('canvas');
  mapImage.width = w;
  mapImage.height = h;
  mapImage.getContext('2d').drawImage(canvas, 0, 0);
  mapKey = key;
  frameSeq++;
  requestRender();
  return true;
}

// A ring where C is. A C off the map leaves an arrowhead at the edge pointing
// towards it, rather than a ring clamped to an edge C is not on.
function drawMarker(ctx, w, h, dpr) {
  const { px, py } = mapPixel(state.julia, w, h);
  const x = Math.max(0, Math.min(w, px));
  const y = Math.max(0, Math.min(h, py));
  const r = 5 * dpr;
  const path = new Path2D();
  if (x === px && y === py) {
    path.arc(x, y, r, 0, 2 * Math.PI);
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      path.moveTo(x + ux * r * 1.7, y + uy * r * 1.7);
      path.lineTo(x + ux * r * 3, y + uy * r * 3);
    }
  } else {
    const a = Math.atan2(py - y, px - x);
    const tip = (k, d) => [x + Math.cos(a + k) * d, y + Math.sin(a + k) * d];
    path.moveTo(...tip(0, 0));
    path.lineTo(...tip(2.5, r * 2.2));
    path.lineTo(...tip(-2.5, r * 2.2));
    path.closePath();
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3.5 * dpr;
  ctx.stroke(path);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke(path);
}

function paintMap() {
  if (juliaUi.panel.hidden || !renderer) return;
  const map = juliaUi.map;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(map.clientWidth * dpr);
  const h = Math.round(map.clientHeight * dpr);
  // A folded HUD leaves the map without layout. It paints when the HUD opens.
  if (!w || !h) return;
  if (map.width !== w || map.height !== h) {
    map.width = w;
    map.height = h;
  }
  if (!drawMapImage(w, h)) return;
  const ctx = map.getContext('2d');
  ctx.drawImage(mapImage, 0, 0);
  drawMarker(ctx, w, h, dpr);
}

let picking = false;

const pickC = (e) => {
  const c = mapC(e);
  applyJulia(c.re, c.im);
};

juliaUi.map.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { juliaUi.map.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  juliaUi.map.focus();
  picking = true;
  pickC(e);
});

juliaUi.map.addEventListener('pointermove', (e) => { if (picking) pickC(e); });

for (const type of ['pointerup', 'pointercancel']) {
  juliaUi.map.addEventListener(type, () => { picking = false; });
}

// The arrows pan the view everywhere else, so the map keeps them from the
// window and moves C by one map pixel instead.
const NUDGE = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };

juliaUi.map.addEventListener('keydown', (e) => {
  const step = NUDGE[e.key.toLowerCase()];
  if (!step) return;
  e.preventDefault();
  e.stopPropagation();
  const d = (MAP.span / juliaUi.map.clientHeight) * (e.shiftKey ? 10 : 1);
  applyJulia(mapText(Number(state.julia.re) + step[0] * d), mapText(Number(state.julia.im) + step[1] * d));
});

// ---------- The formula editor ----------

const DEFAULTS = {
  formula: 'Z_(n+1) = Z_(n)^2 + C',
  seedZ: '0',
  seedC: 'x+yi',
};
const NEW_VAR_SEED = '0';
const VAR_SEED_HINT = 'x+yi';
const PREVIEW_MAX_PX = 640;
const PREVIEW_DELAY = 250;
const NEST_COLOURS = 6;

const FIELDS = [
  { key: 'formula', param: 'f', label: 'the formula', parse: parseFormula, tokens: formulaTokens },
  { key: 'seedZ', param: 'z', label: 'z₀', parse: parseSeed, tokens: seedTokens },
  { key: 'seedC', param: 'c', label: 'c', parse: parseSeed, tokens: seedTokens },
];
const SEED_FIELDS = FIELDS.slice(1);

let committed = null;

// The set the editor opened from, or null for a new fractal.
let openedFrom = null;

// The texts the fields take, dropped once they have them, so a trip out to
// Render and back keeps what was typed rather than reloading the set.
let opensWith = null;

const overwrites = () => (SETS[openedFrom]?.custom ? openedFrom : null);

const varRows = [];

const TOKEN_CLASS = {
  var: 'tok-var',
  num: 'tok-num',
  const: 'tok-const',
  func: 'tok-func',
  op: 'tok-op',
  assign: 'tok-assign',
  index: 'tok-index',
  bad: 'tok-bad',
};

function paintInto(ink, input, tokens) {
  ink.replaceChildren(...tokens.map((tok) => {
    const span = document.createElement('span');
    span.className = tok.depth === undefined
      ? TOKEN_CLASS[tok.kind] ?? ''
      : `tok-nest-${tok.depth % NEST_COLOURS}`;
    span.textContent = tok.text;
    return span;
  }));
  ink.scrollLeft = input.scrollLeft;
}

const varNames = () => varRows.map((row) => row.name.value.trim().toLowerCase());

function repaint() {
  const extras = varNames();
  for (const f of FIELDS) {
    const input = editor.input[f.key];
    paintInto(editor.ink[f.key], input, f.tokens(input.value, extras));
  }
  for (const row of varRows) {
    paintInto(row.ink, row.seed, seedTokens(row.seed.value, extras));
  }
  editor.known.textContent = ['z', 'c', 'x', 'y', ...extras.filter(Boolean)].join(' ');
}

function editorChanged() {
  editor.error.textContent = '';
  repaint();
  schedulePreview();
}

const editorTexts = () => ({
  ...Object.fromEntries(FIELDS.map((f) => [f.key, editor.input[f.key].value])),
  vars: varRows.map((row) => ({ name: row.name.value, seed: row.seed.value })),
});

const readVars = (texts) => (Array.isArray(texts.vars) ? texts.vars : []).map((v) => ({
  name: String(v.name ?? '').trim().toLowerCase(),
  seed: String(v.seed ?? '').trim(),
}));

function parseCustom(texts) {
  const vars = readVars(texts);
  const names = vars.map((v) => v.name);
  for (const [at, v] of vars.entries()) {
    const err = varNameError(v.name, names.filter((_, other) => other !== at));
    if (err) throw new Error(`variables: ${err}`);
  }
  const parsed = { vars: [] };
  for (const f of FIELDS) {
    try {
      parsed[f.key] = f.parse(String(texts[f.key] ?? '').trim(), names);
    } catch (err) {
      throw new Error(`${f.label}: ${err.message}`);
    }
  }
  for (const v of vars) {
    try {
      parsed.vars.push({ name: v.name, seed: parseSeed(v.seed, names) });
    } catch (err) {
      throw new Error(`${v.name}: ${err.message}`);
    }
  }
  return parsed;
}

const shaderParts = (parsed) => ({
  iter: parsed.formula.glsl,
  seeds: [
    ...parsed.vars.map((v) => ({ name: varGlsl(v.name), glsl: v.seed.glsl })),
    { name: 'c', glsl: parsed.seedC.glsl },
    { name: 'z', glsl: parsed.seedZ.glsl },
  ],
});

const DEFAULT_GLSL = Object.fromEntries(FIELDS.map((f) => [f.key, f.parse(DEFAULTS[f.key]).glsl]));

const usual = (parsed, field) => parsed[field.key].glsl === DEFAULT_GLSL[field.key];

function customLabel(parsed) {
  const parts = [`z ← ${parsed.formula.text}`];
  for (const f of SEED_FIELDS) {
    if (!usual(parsed, f)) parts.push(`${f.label} = ${parsed[f.key].text}`);
  }
  for (const v of parsed.vars) parts.push(`${v.name} = ${v.seed.text}`);
  return parts.join('  ·  ');
}

// Where a fractal of this kind usually sits: a Julia set, whose pixel is z₀
// under a fixed parameter, around the origin, and a parameter plane where the
// Mandelbrot set is. The survey measures the set itself and comes back to this
// only when it finds no extent to frame.
function usualHome(parsed) {
  const movesWithPixel = (glsl) => glsl.includes('p.');
  const parameterMoves = movesWithPixel(parsed.seedC.glsl)
    || movesWithPixel(parsed.formula.glsl)
    || parsed.vars.some((v) => movesWithPixel(v.seed.glsl));
  return !parameterMoves && movesWithPixel(parsed.seedZ.glsl)
    ? { x: 0, y: 0, zoom: 100 }
    : { x: -0.7, y: 0, zoom: 135 };
}

const customHome = (parsed, parts) => frameCustom(renderer, parts, usualHome(parsed));

function writeCustomUrl(texts, parsed) {
  const url = new URL(location.href);
  url.searchParams.set('f', texts.formula);
  for (const f of SEED_FIELDS) {
    if (usual(parsed, f)) url.searchParams.delete(f.param);
    else url.searchParams.set(f.param, texts[f.key]);
  }
  url.searchParams.delete('v');
  for (const v of texts.vars) url.searchParams.append('v', `${v.name}:${v.seed}`);
  history.replaceState(null, '', url);
}

const trimTexts = (texts) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f.key, String(texts[f.key] ?? '').trim()])),
  vars: readVars(texts),
});

function applyCustom(texts) {
  if (!renderer) return 'this browser has no WebGL2';
  const trimmed = trimTexts(texts);
  let parsed;
  try {
    parsed = parseCustom(trimmed);
  } catch (err) {
    return err.message;
  }
  const parts = shaderParts(parsed);
  try {
    renderer.setCustom('custom', parts);
  } catch {
    return 'the GPU would not compile that formula';
  }
  committed = { texts: trimmed, parts };
  Object.assign(state, trimmed);
  SETS.custom.formula = customLabel(parsed);
  SETS.custom.home = customHome(parsed, parts);
  writeCustomUrl(trimmed, parsed);
  return null;
}

const hasCustom = () => Boolean(renderer?.customs.has('custom'));

let previewTimer = 0;
let previewKey = '';

function drawPreview(parts, home) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = preview.canvas;
  const w = Math.min(PREVIEW_MAX_PX, Math.round((c.clientWidth || 320) * dpr));
  c.width = w;
  c.height = Math.round(w * 0.75);
  canvas.width = c.width;
  canvas.height = c.height;
  renderer.setCustom('custom', parts);
  const cam = new Camera(home.x, home.y, home.zoom);
  renderer.renderAll({ set: 'custom', cam, maxIter: iterationsFor(cam.lz, 1, 'custom') });
  c.getContext('2d').drawImage(canvas, 0, 0);
}

function updatePreview() {
  if (!renderer || mode !== 'editor') return;
  let parsed;
  try {
    parsed = parseCustom(editorTexts());
  } catch {
    preview.box.classList.add('stale');
    return;
  }
  const parts = shaderParts(parsed);
  const key = [parts.iter, ...parts.seeds.map((s) => `${s.name}=${s.glsl}`), state.palette].join('|');
  if (key !== previewKey) {
    try {
      drawPreview(parts, customHome(parsed, parts));
    } catch {
      preview.box.classList.add('stale');
      return;
    }
    previewKey = key;
    preview.note.textContent = customLabel(parsed);
  }
  preview.box.classList.remove('stale');
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, PREVIEW_DELAY);
}

function leaveEditor() {
  renderer?.setCustom('custom', committed?.parts ?? null);
  previewKey = '';
  openedFrom = null;
  showMenu();
}

function showEditor() {
  cancelDive();
  keys.clear();
  frameSeq++;
  mode = 'editor';
  document.body.classList.remove('viewing');
  viewer.hidden = true;
  menu.hidden = true;
  editor.page.hidden = false;
  clearTimeout(hashTimer);
  history.replaceState(null, '', location.pathname + location.search);
  for (const f of FIELDS) {
    editor.input[f.key].value = opensWith?.[f.key] ?? (state[f.key] || DEFAULTS[f.key]);
  }
  showVarRows(opensWith ? opensWith.vars ?? [] : state.vars ?? []);
  opensWith = null;
  editor.error.textContent = '';
  editor.name.placeholder = defaultName();
  editor.verb.textContent = openedFrom ? 'Edit' : 'Create';
  editor.saveHelp.textContent = overwrites()
    ? 'Save replaces it in the menu, under the name above.'
    : 'Save adds it to the menu under this name, and keeps it in this browser.';
  updatePreview();
  editor.input.formula.focus();
  editor.input.formula.select();
}

editor.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const err = applyCustom(editorTexts());
  if (err) {
    editor.error.textContent = err;
    return;
  }
  showViewer('custom', homeView('custom'));
});

for (const f of FIELDS) {
  const input = editor.input[f.key];
  input.addEventListener('input', editorChanged);
  input.addEventListener('scroll', () => { editor.ink[f.key].scrollLeft = input.scrollLeft; });
}

function editFractal(set) {
  openedFrom = set;
  opensWith = SETS[set].edit;
  editor.name.value = SETS[set].custom ? SETS[set].name : '';
  showEditor();
}

function makeVarRow({ name, seed }) {
  const cell = document.createElement('div');
  cell.className = 'editor-seed editor-var';

  const head = document.createElement('div');
  head.className = 'editor-var-head';
  const letter = document.createElement('input');
  letter.type = 'text';
  letter.className = 'input editor-var-name';
  letter.maxLength = 1;
  letter.spellcheck = false;
  letter.autocapitalize = 'off';
  letter.value = name;
  letter.title = 'Rename this variable';
  letter.setAttribute('aria-label', 'Variable letter');
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'editor-var-drop';
  drop.textContent = '×';
  head.append(letter, drop);

  const field = document.createElement('div');
  field.className = 'editor-field';
  const ink = document.createElement('div');
  ink.className = 'editor-ink';
  ink.setAttribute('aria-hidden', 'true');
  const value = document.createElement('input');
  value.type = 'text';
  value.className = 'input editor-input';
  value.spellcheck = false;
  value.autocapitalize = 'off';
  value.placeholder = VAR_SEED_HINT;
  value.setAttribute('aria-describedby', 'seed-help');
  value.value = seed;
  field.append(ink, value);
  cell.append(head, field);

  const row = { cell, name: letter, seed: value, ink };
  varRows.push(row);

  const describe = () => {
    const called = letter.value.trim() || 'this variable';
    value.setAttribute('aria-label', `Starting value of ${called}`);
    drop.title = `Delete ${called}`;
    drop.setAttribute('aria-label', `Delete ${called}`);
  };
  describe();

  letter.addEventListener('input', () => {
    letter.value = letter.value.toLowerCase().replace(/[^a-z]/g, '');
    describe();
    editorChanged();
  });
  value.addEventListener('input', editorChanged);
  value.addEventListener('scroll', () => { ink.scrollLeft = value.scrollLeft; });
  drop.addEventListener('click', () => dropVarRow(row));
  return cell;
}

function showVarRows(vars) {
  for (const row of varRows) row.cell.remove();
  varRows.length = 0;
  editor.seeds.append(...vars.map(makeVarRow));
  repaint();
}

function dropVarRow(row) {
  varRows.splice(varRows.indexOf(row), 1);
  row.cell.remove();
  editorChanged();
  editor.addVar.focus();
}

editor.addVar.addEventListener('click', () => {
  const name = freeVarName(varNames());
  if (!name) {
    editor.error.textContent = 'that is every letter the editor has to spare';
    return;
  }
  editor.seeds.append(makeVarRow({ name, seed: NEW_VAR_SEED }));
  editorChanged();
  const row = varRows[varRows.length - 1];
  row.name.focus();
  row.name.select();
});

$('#editor-cancel').addEventListener('click', leaveEditor);

$('#create').addEventListener('click', () => {
  openedFrom = null;
  opensWith = null;
  editor.name.value = '';
  showEditor();
});

// ---------- Saved fractals ----------

const savedFractals = readSaved();

function defaultName() {
  const taken = new Set(savedFractals.filter((f) => f.id !== openedFrom).map((f) => f.name));
  for (let n = savedFractals.length + 1; ; n++) {
    const name = `Fractal ${n}`;
    if (!taken.has(name)) return name;
  }
}

function registerFractal(fractal) {
  if (!renderer) return 'this browser has no WebGL2';
  let parsed;
  try {
    parsed = parseCustom(fractal);
  } catch (err) {
    return err.message;
  }
  const parts = shaderParts(parsed);
  try {
    renderer.setCustom(fractal.id, parts);
  } catch {
    return 'the GPU would not compile that formula';
  }
  registerSet(fractal.id, {
    name: fractal.name,
    formula: customLabel(parsed),
    home: customHome(parsed, parts),
    edit: trimTexts(fractal),
  });
  return null;
}

// The shader, the stored list and the card move together, so a save the
// browser refuses leaves the fractal as it was.
function saveFractal(fractal) {
  const at = savedFractals.findIndex((f) => f.id === fractal.id);
  const list = at < 0
    ? [...savedFractals, fractal]
    : savedFractals.map((f) => (f.id === fractal.id ? fractal : f));
  const err = registerFractal(fractal) || writeSaved(list);
  if (err) {
    if (at < 0) dropSavedSet(fractal.id);
    else registerFractal(savedFractals[at]);
    return err;
  }
  if (at < 0) {
    savedFractals.push(fractal);
    cards.append(makeCard(fractal.id));
  } else {
    savedFractals[at] = fractal;
    slotOf(fractal.id)?.replaceWith(makeCard(fractal.id));
  }
  return null;
}

function deleteSaved(id) {
  const at = savedFractals.findIndex((f) => f.id === id);
  if (at >= 0) {
    savedFractals.splice(at, 1);
    writeSaved(savedFractals);
  }
  dropSavedSet(id);
  $('#create').focus();
}

function dropSavedSet(id) {
  renderer?.setCustom(id, null);
  unregisterSet(id);
  slotOf(id)?.remove();
}

$('#editor-save').addEventListener('click', () => {
  const fractal = {
    id: overwrites() ?? freeId(savedFractals),
    name: editor.name.value.trim() || defaultName(),
    ...trimTexts(editorTexts()),
  };
  const err = saveFractal(fractal);
  if (err) {
    editor.error.textContent = err;
    return;
  }
  leaveEditor();
  cards.querySelector(`.card[data-set="${fractal.id}"]`)?.focus();
});

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
  if (dx || dy) { panBy(dx, dy); moved = true; }

  // A quarter turn a second, a half with Shift.
  const spin = 90 * fast * dt;
  let turn = 0;
  if (keys.has('z')) turn += spin;
  if (keys.has('x')) turn -= spin;
  if (turn) { state.angle = normalisedAngle(state.angle + turn); moved = true; }

  const dlz = 2 * dt; // 4× per second
  if (keys.has('e')) { state.cam.setLogZoom(clampLogZoom(state.cam.lz + dlz)); moved = true; }
  if (keys.has('q')) { state.cam.setLogZoom(clampLogZoom(state.cam.lz - dlz)); moved = true; }

  if (moved) requestRender();
  requestAnimationFrame(tick);
}

// ---------- Keyboard ----------

const movementKeys = new Set(['a', 'd', 'w', 's', 'q', 'e', 'z', 'x', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
const STEP_LZ = Math.log2(1.2);
const STEP_TURN = 5;

window.addEventListener('keydown', (e) => {
  if (mode === 'editor') {
    if (e.key === 'Escape') leaveEditor();
    return;
  }
  if (mode !== 'view') return;
  if (e.target.closest?.('input, textarea')) {
    if (e.key === 'Escape') closeGoto();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (movementKeys.has(k)) {
    e.preventDefault();
    cancelDive();
    if (keys.has(k)) return;
    keys.add(k);
    startMotion();
    // One discrete step on the tap; holding continues in tick().
    const pan = 10 * (e.shiftKey ? 2 : 1);
    if (k === 'a' || k === 'arrowleft') panBy(-pan, 0);
    if (k === 'd' || k === 'arrowright') panBy(pan, 0);
    if (k === 'w' || k === 'arrowup') panBy(0, pan);
    if (k === 's' || k === 'arrowdown') panBy(0, -pan);
    if (k === 'e') state.cam.setLogZoom(clampLogZoom(state.cam.lz + STEP_LZ));
    if (k === 'q') state.cam.setLogZoom(clampLogZoom(state.cam.lz - STEP_LZ));
    const turn = STEP_TURN * (e.shiftKey ? 2 : 1);
    if (k === 'z') state.angle = normalisedAngle(state.angle + turn);
    if (k === 'x') state.angle = normalisedAngle(state.angle - turn);
    requestRender();
    return;
  }
  if (k === ' ') { e.preventDefault(); savePng(); }
  if (k === 'escape') (goto.form.hidden ? leaveViewer : closeGoto)();
  if (k === '[') changeDetail(-1);
  if (k === ']') changeDetail(1);
  if (k === ',') stepPalette(-1);
  if (k === '.') stepPalette(1);
  if (k === 'h') setHud(!hudOpen);
  if (k === 'r') setAngle(0);
  if (k === 'g') { e.preventDefault(); openGoto(); }
  if (k === 'f') dive();
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
  const d = worldDelta(sx, sy);
  const target = clampLogZoom(state.cam.lz + Math.log2(factor));
  state.cam.zoomAt(d.x, d.y, target - state.cam.lz);
  requestRender();
}

// The angle of a client point about the centre of the canvas, anticlockwise.
// The centre itself has no bearing, so a turn that starts there waits until
// the pointer is clear of it.
function screenBearing(px, py) {
  const { sx, sy } = stageOffset(px, py);
  return Math.hypot(sx, sy) < 4 ? null : Math.atan2(sy, sx) / DEGREE;
}

// Bearings meet at half a turn. The jump across that seam is a whole turn,
// which normalisedAngle takes back out.
function turnBy(from, to) {
  if (from === null || to === null) return;
  setAngle(state.angle + to - from);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cancelDive();
  zoomAt(e.clientX, e.clientY, Math.pow(1.2, -e.deltaY / 100));
}, { passive: false });

const pointers = new Map();
let pinch = null;

// The bearing from one finger to the other, anticlockwise on screen.
const fingerBearing = (a, b) => Math.atan2(a.y - b.y, b.x - a.x) / DEGREE;

canvas.addEventListener('pointerdown', (e) => {
  cancelDive();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('dragging');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), bearing: fingerBearing(a, b) };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dpr = canvas.width / canvas.clientWidth;
  const scale = canvas.height / 360;
  if (pointers.size === 1) {
    // Shift turns the view instead, sweeping it about the centre.
    if (e.shiftKey) turnBy(screenBearing(p.x, p.y), screenBearing(e.clientX, e.clientY));
    else {
      panBy(-((e.clientX - p.x) * dpr) / scale, ((e.clientY - p.y) * dpr) / scale);
      requestRender();
    }
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && pinch.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.dist);
    const bearing = fingerBearing(a, b);
    if (d > 0) turnBy(pinch.bearing, bearing);
    pinch.dist = d;
    pinch.bearing = bearing;
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------- Diving into the picture ----------
//
// The button drops the view into a spot picked out of the frame on screen.
// dive.js does the picking; here is the fall.
//
// It falls five doublings, at the rate a held E key zooms, and the spot's
// offset across the screen runs down to nothing over the same time. So the
// spot drifts in a straight line to the middle of the screen while the view
// closes in on it, instead of swinging out and back as it would if the centre
// crossed the plane at an even pace.

const DIVE_GAIN = 5;
const DIVE_RATE = 2;

// A dive with next to no room left under it is not worth the trip.
const LEAST_GAIN = 0.5;

const stillFrames = window.matchMedia('(prefers-reduced-motion: reduce)');

let flight = null;

const cancelDive = () => { flight = null; };

// Stage-pixel offset of a point in the frame from the centre of the frame.
// The rows come back from the GPU bottom up, so its y already points up.
function frameOffset(px, py) {
  const scale = canvas.height / 360;
  return { sx: (px - canvas.width / 2) / scale, sy: (py - canvas.height / 2) / scale };
}

// The camera partway through a fall: on the spot, zoomed in by as much of the
// gain as has passed, then backed off by what is left of the spot's offset
// across the screen. Each frame is built from the camera the fall started at,
// so nothing accumulates.
function flightCamera(f, u) {
  const cam = f.from.clone();
  cam.pan(f.to.x, f.to.y);
  cam.setLogZoom(f.from.lz + u * f.gain);
  cam.pan(-(1 - u) * f.to.x, -(1 - u) * f.to.y);
  return cam;
}

function dive() {
  if (mode !== 'view' || !renderer) return;
  const gain = clampLogZoom(state.cam.lz + DIVE_GAIN) - state.cam.lz;
  if (gain < LEAST_GAIN) {
    hud.status.textContent = 'as deep as this set goes';
    return;
  }
  const frame = renderer.framePixels();
  const spot = frame && pickSpot(frame);
  if (!spot) return;
  const { sx, sy } = frameOffset(spot.x, spot.y);
  const f = { from: state.cam.clone(), to: worldDelta(sx, sy), gain };
  if (stillFrames.matches) {
    state.cam = flightCamera(f, 1);
    requestRender();
    return;
  }
  flight = f;
  const ms = (gain / DIVE_RATE) * 1000;
  const start = performance.now();
  // A second press starts a new fall, so this one stops as soon as it is no
  // longer the current one.
  const step = (now) => {
    if (flight !== f || mode !== 'view') return;
    const t = Math.min(1, (now - start) / ms);
    // Smoothstep, so the fall starts and ends at rest.
    state.cam = flightCamera(f, t * t * (3 - 2 * t));
    requestRender();
    if (t < 1) requestAnimationFrame(step);
    else flight = null;
  };
  requestAnimationFrame(step);
}

// ---------- Buttons ----------

$('#dive').addEventListener('click', dive);
$('#detail-down').addEventListener('click', () => changeDetail(-1));
$('#detail-up').addEventListener('click', () => changeDetail(1));
$('#save').addEventListener('click', savePng);
backBtn.addEventListener('click', leaveViewer);
window.addEventListener('resize', () => {
  if (mode !== 'view') return;
  paintMap();
  requestRender();
});

// ---------- Colourways ----------

const PALETTE_STORE = 'palette';

// Applies a colourway: shader, chips, URL and the browser's memory of it.
// The URL drops the parameter for the default so plain links stay short.
function setPalette(key, { render = true } = {}) {
  const p = paletteByKey(key);
  if (!p) return;
  state.palette = p.key;
  if (renderer) renderer.palette = p.index;
  for (const chip of hud.palettes.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.palette === p.key));
  }
  try { localStorage.setItem(PALETTE_STORE, p.key); } catch { /* private mode */ }
  const url = new URL(location.href);
  if (p.key === DEFAULT_PALETTE) url.searchParams.delete('palette');
  else url.searchParams.set('palette', p.key);
  history.replaceState(null, '', url);
  if (!render) return;
  if (mode === 'view') {
    paintMap();
    requestRender();
  } else {
    renderCards();
  }
}

function stepPalette(dir) {
  const i = PALETTES.findIndex((p) => p.key === state.palette);
  setPalette(PALETTES[(i + dir + PALETTES.length) % PALETTES.length].key);
}

// The link wins, then the browser's memory, then the default.
function initialPalette() {
  const fromLink = new URLSearchParams(location.search).get('palette');
  if (fromLink && paletteByKey(fromLink)) return fromLink;
  try {
    const stored = localStorage.getItem(PALETTE_STORE);
    if (stored && paletteByKey(stored)) return stored;
  } catch { /* private mode */ }
  return DEFAULT_PALETTE;
}

// The link's angle, or level.
function initialAngle() {
  const deg = parseAngle(new URLSearchParams(location.search).get('angle') ?? '');
  return Number.isFinite(deg) ? normalisedAngle(deg) : 0;
}

hud.palettes.replaceChildren(
  ...PALETTE_GROUPS.map(({ group, palettes }) => {
    const g = document.createElement('div');
    g.className = 'palette-group';
    const name = document.createElement('span');
    name.className = 'palette-group-name';
    name.textContent = group;
    const chips = document.createElement('div');
    chips.className = 'palette-chips';
    chips.append(...palettes.map((p) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.palette = p.key;
      chip.setAttribute('aria-pressed', 'false');
      chip.title = `${p.name} colourway`;
      const sw = document.createElement('i');
      sw.className = 'chip-swatch';
      sw.style.background = p.swatch;
      chip.append(sw, document.createTextNode(p.name));
      chip.addEventListener('click', () => setPalette(p.key));
      return chip;
    }));
    g.append(name, chips);
    return g;
  }),
);

// ---------- Screens ----------

// Bookmarks hold numbers for shallow spots and decimal strings for deep ones.
function bookmarkCamera(b) {
  if (typeof b.x === 'string') return Camera.fromDecimal(b.x, b.y, parseZoom(b.zoom));
  return new Camera(b.x, b.y, b.zoom);
}

function showViewer(set, view) {
  cancelDive();
  if (set === 'custom' && !hasCustom()) {
    showEditor();
    return;
  }
  state.set = set;
  if (view) state.cam = new Camera(view.x, view.y, view.zoom);
  mode = 'view';
  document.body.classList.add('viewing');
  menu.hidden = true;
  editor.page.hidden = true;
  viewer.hidden = false;
  closeGoto();
  $('#set-name').textContent = SETS[set].name;
  backBtn.textContent = set === 'custom' ? '← Formula' : '← Menu';
  backBtn.title = set === 'custom' ? 'Back to the formula (Esc)' : 'Back to menu (Esc)';
  showJuliaUi();

  hud.bookmarks.replaceChildren(
    ...SETS[set].bookmarks.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bookmark';
      const x = Number(b.x);
      const y = Number(b.y);
      el.textContent = `${fmt(x)}${y < 0 ? ' − ' : ' + '}${fmt(Math.abs(y))}i @ ${fmtZoom(parseZoom(b.zoom))}`;
      el.addEventListener('click', () => {
        cancelDive();
        state.cam = bookmarkCamera(b);
        requestRender();
      });
      return el;
    }),
  );

  requestRender();
}

function leaveViewer() {
  if (state.set === 'custom') showEditor();
  else showMenu();
}

function showMenu() {
  cancelDive();
  keys.clear();
  frameSeq++;
  mode = 'menu';
  document.body.classList.remove('viewing');
  viewer.hidden = true;
  editor.page.hidden = true;
  menu.hidden = false;
  clearTimeout(hashTimer);
  history.replaceState(null, '', location.pathname + location.search);
  renderCards();
}

// The GL canvas draws each thumbnail, then a 2D canvas on the card copies it.
// Each card shows the view its set opens at, Julia with its default C.
function renderCards() {
  if (!renderer) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const card of document.querySelectorAll('.card')) {
    const set = card.dataset.set;
    const h = SETS[set].home;
    const cam = new Camera(h.x, h.y, h.zoom);
    const c = card.querySelector('canvas');
    const cssW = c.clientWidth || 240;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssW * 0.75 * dpr);
    canvas.width = c.width;
    canvas.height = c.height;
    renderer.renderAll({ set, cam, maxIter: iterationsFor(cam.lz, 1, set), julia: SETS.julia.c });
    c.getContext('2d').drawImage(canvas, 0, 0);
  }
}

function slotOf(set) {
  return cards.querySelector(`.card[data-set="${set}"]`)?.closest('li');
}

function makeCard(set) {
  const li = document.createElement('li');
  li.className = 'card-slot';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.set = set;
  const thumb = document.createElement('canvas');
  thumb.className = 'thumb';
  thumb.width = 240;
  thumb.height = 180;
  thumb.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = SETS[set].name;
  const formula = document.createElement('span');
  formula.className = 'card-formula';
  formula.textContent = SETS[set].formula;
  card.append(thumb, name, formula);
  li.append(card, editControl(set), ...deleteControls(set, li));
  return li;
}

// Every card has one. A set whose iteration the editor cannot write is greyed,
// and says so rather than going quiet.
function editControl(set) {
  const { name, edit, unwritable } = SETS[set];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-tool card-edit';
  btn.textContent = 'Edit';
  btn.disabled = !edit;
  btn.title = edit ? `Edit ${name}` : unwritable;
  btn.setAttribute('aria-label', edit ? `Edit ${name}` : `Edit ${name}: ${unwritable}`);
  btn.addEventListener('click', () => editFractal(set));
  return btn;
}

// The × and the question that replaces it are siblings of the card, since a
// button cannot hold another one.
function deleteControls(set, slot) {
  const question = `Delete ${SETS[set].name}?`;
  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'card-tool card-delete';
  ask.title = question;
  ask.setAttribute('aria-label', question);
  ask.textContent = '×';

  const panel = document.createElement('div');
  panel.className = 'card-confirm';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', question);
  const text = document.createElement('p');
  text.className = 'card-confirm-text';
  text.textContent = question;
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn btn-accent';
  yes.textContent = 'Delete';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn';
  no.textContent = 'Cancel';
  const row = document.createElement('div');
  row.className = 'card-confirm-row';
  row.append(yes, no);
  panel.append(text, row);

  const open = (on) => {
    panel.hidden = !on;
    ask.hidden = on;
    slot.classList.toggle('asking', on);
    (on ? yes : ask).focus();
  };
  const close = () => open(false);
  ask.addEventListener('click', () => open(true));
  no.addEventListener('click', close);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  yes.addEventListener('click', () => deleteSaved(set));
  return [ask, panel];
}

function homeView(set) {
  const { x, y, zoom } = SETS[set].home;
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= 4 / 3) return { x, y, zoom };
  return { x, y, zoom: 2 ** clampLogZoom(Math.log2((zoom * aspect * 3) / 4), set) };
}

cards.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  state.julia = { ...SETS.julia.c };
  state.angle = 0;
  showViewer(card.dataset.set, homeView(card.dataset.set));
});

// ---------- Boot ----------

window.__fx = { state, dive, pickSpot, showViewer, showMenu, showEditor, editFractal, renderCards, render, renderer, iterationsFor, updatePreview, Camera, parseLocation, parseZoom, goTo, applyJulia, applyCustom, setPalette, savedFractals };

setPalette(initialPalette(), { render: false });
state.angle = initialAngle();

for (const card of cards.querySelectorAll('.card')) card.after(editControl(card.dataset.set));

for (const fractal of savedFractals) {
  if (!registerFractal(fractal)) cards.append(makeCard(fractal.id));
}

const params = new URLSearchParams(location.search);
if (params.get('f')) {
  applyCustom({
    ...Object.fromEntries(FIELDS.map((f) => [f.key, params.get(f.param) ?? DEFAULTS[f.key]])),
    vars: params.getAll('v').map((pair) => {
      const at = pair.indexOf(':');
      return at < 0 ? { name: pair, seed: '' } : { name: pair.slice(0, at), seed: pair.slice(at + 1) };
    }),
  });
}

if (readHash()) {
  showViewer(state.set);
} else {
  renderCards();
}
