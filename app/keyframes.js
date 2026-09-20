// The animation model: the keyframes a movie passes through, and the camera
// at any moment between them.
//
// A keyframe is a whole view — centre, zoom, rotation, Julia's parameter where
// the set has one, and what a typed formula's own variables are held at. The
// centre is kept as the decimal strings the camera prints rather than as a
// double, so a keyframe taken at 10^300 is the point it was taken at.
//
// Two keyframes on one spot with a variable at 1 and then at 2 are a movie
// that stands still and watches the fractal change instead.

import { Camera, bitsFor, parseDecimal, scaleFixed } from './precision.js';
import { SETS, MIN_LOG_ZOOM } from './fractals.js';

const STORE = 'animations';
const SETTINGS_STORE = 'movie';

export const DEFAULT_SPAN = 3;
const DEFAULT_HOLD = 0;

// Shorter than a frame at any rate a movie is rendered at, so a span under
// this is a cut from one keyframe to the next rather than a move nobody sees.
const LEAST_SPAN = 1 / 240;

// ---------- Along a segment ----------

// Rotation and Julia's parameter cross a segment at an even pace. Zoom does
// not: the eye reads it as a rate of doubling, so log2 zoom is what runs
// evenly, and a zoom from 100× to 10^12 spends as long over each factor of two
// as over any other.
const lerp = (a, b, u) => a + (b - a) * u;

// Where the centre sits partway along a segment, as a share of the gap between
// the two keyframes measured off the deeper of them.
//
// A centre carried across at an even pace swings out of frame and back: at
// depth the distance left is thousands of screens wide and stays that way
// until the last instant, so the picture sits still and then lurches. What
// reads as steady is the other keyframe's offset *on screen* coming down at an
// even rate, so it walks in a straight line to the middle of the frame while
// the view closes on it. That is the fall a dive already takes, and it holds
// for a segment that pans as well as one that zooms.
//
// A centre `share × gap` from the deep keyframe stands `share × gap × 2^lz`
// pixels off it, so holding that product even in u gives the shares below.
// Zooming out is the same move played backwards rather than a different one:
// the picture leaves the middle of the frame at the rate it arrived.
//
// Both are measured off the deep end because the share there is a small number
// held to its own last digit, where one measured off the shallow end would be
// 1 − 10^-22 and lose every digit that says where the view is.
function crossing(u, dlz) {
  return dlz >= 0
    ? { inward: true, share: (1 - u) * 2 ** (-u * dlz) }
    : { inward: false, share: u * 2 ** ((1 - u) * dlz) };
}

// ---------- Keyframes ----------

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

const readC = (c) => (c && Number.isFinite(Number(c.re)) && Number.isFinite(Number(c.im))
  ? { re: String(c.re), im: String(c.im) }
  : null);

// A variable is kept as numbers rather than as the strings Julia's C keeps:
// nobody types one into a URL, and what the shader takes is a pair of floats.
const readValue = (v) => (v && Number.isFinite(Number(v.re)) && Number.isFinite(Number(v.im))
  ? { re: Number(v.re), im: Number(v.im) }
  : null);

function readValues(vars) {
  if (!vars || typeof vars !== 'object') return null;
  const out = {};
  for (const [name, v] of Object.entries(vars)) {
    const held = readValue(v);
    if (held) out[name] = held;
  }
  return Object.keys(out).length ? out : null;
}

const readable = (k) => k !== null && typeof k === 'object'
  && typeof k.x === 'string' && typeof k.y === 'string' && Number.isFinite(Number(k.lz));

function tidyKey(k) {
  return {
    x: k.x,
    y: k.y,
    lz: num(k.lz, MIN_LOG_ZOOM),
    angle: num(k.angle),
    julia: readC(k.julia),
    vars: readValues(k.vars),
    hold: Math.max(0, num(k.hold, DEFAULT_HOLD)),
    span: Math.max(0, num(k.span, DEFAULT_SPAN)),
  };
}

// The turn a keyframe records is the total turn, not the angle modulo a full
// one, so a span that means "a half turn clockwise" keeps meaning that. A
// captured angle takes the winding nearest the keyframe before it; a typed one
// is left as typed, so 720 spins twice.
function windNear(deg, near) {
  return deg + Math.round((near - deg) / 360) * 360;
}

export function keyFrom({ cam, angle, julia, vars }, before = null) {
  return tidyKey({
    x: cam.xString(),
    y: cam.yString(),
    lz: cam.lz,
    angle: before ? windNear(angle, before.angle) : angle,
    julia: julia ? { ...julia } : null,
    vars,
    hold: DEFAULT_HOLD,
    span: before ? before.span : DEFAULT_SPAN,
  });
}

// ---------- Easing ----------
//
// The ease runs over a whole run of movement rather than over each segment, so
// a run through six keyframes sets off once and settles once instead of
// stopping at every one of them. A hold ends a run. The view stands still there
// by request, so that is where the ease settles and sets off again.

export const EASINGS = [
  { key: 'steady', name: 'Steady', fn: (u) => u },
  { key: 'ends', name: 'Ease both ends', fn: (u) => u * u * (3 - 2 * u) },
  { key: 'in', name: 'Ease in', fn: (u) => u * u },
  { key: 'out', name: 'Ease out', fn: (u) => u * (2 - u) },
];

export const DEFAULT_EASING = 'steady';

export const easingByKey = (key) => EASINGS.find((e) => e.key === key) ?? EASINGS[0];

// ---------- The timeline ----------

// The path laid out in time: a stretch standing still at each keyframe that
// asks for one, and a stretch moving between each pair. The moving stretches
// between two holds make a run. `m0` and `m1` measure a stretch in its run's
// moving time alone, which is what the ease warps.
export function plan(keys, easingKey = DEFAULT_EASING) {
  const ease = easingByKey(easingKey).fn;
  const list = keys.map(tidyKey);
  const pieces = [];
  let t = 0;
  let run = null;
  for (const [at, key] of list.entries()) {
    if (key.hold > 0) {
      pieces.push({ move: false, from: at, t0: t, t1: t + key.hold });
      t += key.hold;
      run = null;
    }
    const span = at < list.length - 1 ? key.span : 0;
    if (span >= LEAST_SPAN) {
      run ??= { motion: 0 };
      pieces.push({ move: true, run, from: at, to: at + 1, t0: t, t1: t + span, m0: run.motion, m1: run.motion + span });
      t += span;
      run.motion += span;
    }
  }
  // Every centre is read once, at the width the deepest keyframe needs, and
  // the frames rescale down from there. Reading a hundred digits per frame
  // would cost more than the picture does at shallow zooms.
  const bits = bitsFor(Math.max(MIN_LOG_ZOOM, ...list.map((k) => k.lz)));
  const fixed = list.map((k) => ({
    x: parseDecimal(k.x, bits) ?? 0n,
    y: parseDecimal(k.y, bits) ?? 0n,
  }));
  return { keys: list, fixed, bits, pieces, total: t, ease };
}

const pieceAt = (pieces, t) => pieces.find((p) => t < p.t1) ?? pieces[pieces.length - 1];

// The view one keyframe stands for, off the centres the plan already parsed.
export const keyState = (p, at) => ({
  cam: Camera.fromFixed(p.fixed[at].x, p.fixed[at].y, p.bits, p.keys[at].lz),
  angle: p.keys[at].angle,
  julia: p.keys[at].julia,
  vars: p.keys[at].vars,
});

// A variable one keyframe holds and the other does not stands still: the pair
// says nothing about where it would go.
function crossVars(a, b, u) {
  if (!a || !b) return a ?? b;
  const out = { ...a, ...b };
  for (const [name, was] of Object.entries(a)) {
    if (b[name]) out[name] = { re: lerp(was.re, b[name].re, u), im: lerp(was.im, b[name].im, u) };
  }
  return out;
}

const cText = (v) => String(Number(v.toPrecision(12)));

// Where the view stands at time t: the camera, the turn, Julia's C, and what
// the formula's own variables are held at.
export function sample(p, t) {
  if (!p.keys.length) return null;
  if (!p.pieces.length) return keyState(p, 0);
  const piece = pieceAt(p.pieces, Math.max(0, Math.min(t, p.total)));
  if (!piece.move) return keyState(p, piece.from);

  // The ease moves a moment of the run's moving time to another moment of it,
  // which may land in a different segment than the one the clock is in. The
  // eased moment stays inside the run, so the view is on the keyframe when a
  // hold begins and still on it when the hold ends.
  const { motion } = piece.run;
  const eased = p.ease(Math.min(1, Math.max(0, (piece.m0 + (t - piece.t0)) / motion))) * motion;
  const seg = p.pieces.find((q) => q.run === piece.run && eased < q.m1) ?? piece;
  const u = seg.m1 > seg.m0 ? Math.min(1, Math.max(0, (eased - seg.m0) / (seg.m1 - seg.m0))) : 1;

  const a = p.keys[seg.from];
  const b = p.keys[seg.to];
  const lz = lerp(a.lz, b.lz, u);
  const { inward, share } = crossing(u, b.lz - a.lz);
  const deep = p.fixed[inward ? seg.to : seg.from];
  const shallow = p.fixed[inward ? seg.from : seg.to];
  const cam = Camera.fromFixed(
    deep.x + scaleFixed(shallow.x - deep.x, share),
    deep.y + scaleFixed(shallow.y - deep.y, share),
    p.bits,
    lz,
  );
  return {
    cam,
    angle: lerp(a.angle, b.angle, u),
    vars: crossVars(a.vars, b.vars, u),
    julia: a.julia && b.julia
      ? {
        re: cText(lerp(Number(a.julia.re), Number(b.julia.re), u)),
        im: cText(lerp(Number(a.julia.im), Number(b.julia.im), u)),
      }
      : a.julia ?? b.julia,
  };
}

// ---------- Storage ----------
//
// One animation per set, kept in this browser beside the saved fractals and
// the menu arrangement. A set the app no longer has is dropped on read, the
// way the menu arrangement drops an id it does not know.

// The editor's own set is whatever formula stands in its fields at the moment,
// so an animation stored against it would open on a different fractal the next
// time the editor rendered one. Its keyframes last as long as the viewer stays
// on that formula and no longer. A fractal saved to the menu has an id of its
// own and keeps its animation like any other set.
const TRANSIENT = 'custom';

const readAll = () => {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
};

export function readAnimation(set) {
  const stored = set === TRANSIENT ? null : readAll()[set];
  const keys = Array.isArray(stored?.keys) ? stored.keys.filter(readable).map(tidyKey) : [];
  return { keys, easing: easingByKey(stored?.easing).key };
}

export function writeAnimation(set, animation) {
  if (set === TRANSIENT) return null;
  const all = readAll();
  if (animation.keys.length) all[set] = animation;
  else delete all[set];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
    return null;
  } catch {
    return 'this browser would not store the animation';
  }
}

// Only the sets the app has. A saved fractal deleted while its animation was
// stored leaves the animation behind, and nothing can open it again.
export function prune() {
  const all = readAll();
  let changed = false;
  for (const set of Object.keys(all)) {
    if (!SETS[set]) {
      delete all[set];
      changed = true;
    }
  }
  if (changed) {
    try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* private mode */ }
  }
}

// Export settings belong to the person rather than to one fractal, so they sit
// apart from the keyframes and carry over from one animation to the next.
export function readSettings(defaults) {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORE) ?? '{}');
    return { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...defaults };
  }
}

export function writeSettings(settings) {
  try { localStorage.setItem(SETTINGS_STORE, JSON.stringify(settings)); } catch { /* private mode */ }
}

// ---------- Text ----------
//
// An animation travels as the JSON below, since a path of deep keyframes is
// far too long to ride in a link.

export function toText(set, animation) {
  return JSON.stringify({ fractal: set, easing: animation.easing, keys: animation.keys }, null, 1);
}

export function fromText(text) {
  let read;
  try {
    read = JSON.parse(text);
  } catch {
    return { error: 'that is not readable as JSON' };
  }
  const keys = Array.isArray(read?.keys) ? read.keys.filter(readable).map(tidyKey) : [];
  if (!keys.length) return { error: 'no keyframes in that' };
  return { set: typeof read.fractal === 'string' ? read.fractal : null, keys, easing: easingByKey(read.easing).key };
}
