// The complex plane over the picture: the real and imaginary axes, a grid at
// a round step, and the number each line stands for.
//
// A line is a whole multiple of 1, 2 or 5 × 10^d, found in the camera's own
// fixed point, so a grid at 10^-40 lands on the digits the HUD shows rather
// than on what a double could hold. That also makes every label exact: the
// multiple with its point moved d places, no rounding on the way.

import { STAGE_HEIGHT } from './fractals.js';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const INK = token('--ink');
const ACCENT = token('--magenta');
const MONO = token('--mono');

// CSS pixels: how far apart a grid step aims to land, the type the numbers are
// set in, how far they stand off their axis, and how far they keep from the
// edge of the screen.
const SPACING = 100;
const TYPE = 12;
const STANDOFF = 5;
const EDGE = 14;

// Past this many characters a label is cut to its last few digits.
const LONGEST = 12;
const TAIL = 6;

// A step chosen by pixels never gives more lines than a screen has room for;
// the cap is there so a camera in some unforeseen state cannot loop for ever.
const MOST_LINES = 200;

const LOG2 = Math.log10(2);
const NEAR = [Math.log10(1.5), Math.log10(3.5), Math.log10(7.5)];

const floorDiv = (a, b) => (a < 0n ? -((-a + b - 1n) / b) : a / b);
const ceilDiv = (a, b) => -floorDiv(-a, b);

// The 1, 2 or 5 × 10^d nearest a wanted step, taken from its log10 so a step
// of 10^-301 is chosen without a number that size ever existing.
function roundStep(log10) {
  const d = Math.floor(log10);
  const rest = log10 - d;
  if (rest < NEAR[0]) return { m: 1n, d };
  if (rest < NEAR[1]) return { m: 2n, d };
  if (rest < NEAR[2]) return { m: 5n, d };
  return { m: 1n, d: d + 1 };
}

// k × 10^d written out in full, with the minus sign the HUD uses.
function decimalText(k, d) {
  const negative = k < 0n;
  let digits = (negative ? -k : k).toString();
  if (d > 0) digits += '0'.repeat(d);
  if (d < 0) digits = digits.padStart(1 - d, '0');
  const text = d < 0 ? `${digits.slice(0, d)}.${digits.slice(d)}` : digits;
  return (negative ? '−' : '') + text;
}

const tidy = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

const shorten = (s) => (s.startsWith('−') ? '−…' : '…') + s.slice(-TAIL);

// One family of lines, a real part or an imaginary one held constant: where
// each sits in stage pixels off the centre, and the number it stands for. A
// grid finer than its numbers are short cuts them to their last digits, the
// ones that differ from line to line, since the HUD carries the whole
// coordinate anyway.
function family(cam, centre, reach, { m, d }, suffix) {
  const bits = BigInt(cam.bits);
  const pow = 10n ** BigInt(Math.abs(d));
  const den = d < 0 ? m << bits : (m * pow) << bits;
  const scaled = (v) => (d < 0 ? v * pow : v);
  const span = cam.step(reach);
  const first = ceilDiv(scaled(centre - span), den);
  const last = floorDiv(scaled(centre + span), den);
  if (last - first > BigInt(MOST_LINES)) return [];

  const found = [];
  for (let n = first; n <= last; n++) {
    const k = n * m;
    const value = d < 0 ? (k << bits) / pow : (k * pow) << bits;
    found.push({ k, offset: cam.toStage(value - centre) });
  }
  const texts = found.map((line) => decimalText(line.k, d));
  const long = texts.some((t) => t.length > LONGEST);
  return found.map((line, at) => ({
    offset: line.offset,
    axis: line.k === 0n,
    // Zero is written once, where the axes cross, so the two families do not
    // both put one there.
    text: line.k === 0n ? (suffix ? '' : '0') : (long ? shorten(texts[at]) : tidy(texts[at])) + suffix,
  }));
}

// Where the line enters and leaves the canvas, in the order `dir` runs. Null
// when it misses, which is what a line past the corner of a turned view does.
function ends(base, dir, width, height, pad) {
  let from = -Infinity;
  let to = Infinity;
  for (const [at, along, size] of [[base.x, dir.x, width], [base.y, dir.y, height]]) {
    if (Math.abs(along) < 1e-9) {
      if (at < pad || at > size - pad) return null;
      continue;
    }
    const a = (pad - at) / along;
    const b = (size - pad - at) / along;
    from = Math.max(from, Math.min(a, b));
    to = Math.min(to, Math.max(a, b));
  }
  if (!(to > from)) return null;
  const point = (t) => ({ x: base.x + dir.x * t, y: base.y + dir.y * t });
  return [point(from), point(to)];
}

const inside = (p, width, height, pad) => p.x >= pad && p.x <= width - pad && p.y >= pad && p.y <= height - pad;

// Lower on the screen for the real parts, further left for the imaginary
// ones, which is where they sit on a level view.
const LOWER = (a, b) => a.y > b.y;
const LEFTER = (a, b) => a.x < b.x;

export function drawPlane(ctx, { cam, angle, width, height, dpr }) {
  const stage = height / STAGE_HEIGHT;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Where a point lands on the canvas, from its offset in stage pixels along
  // the plane's axes. The turn is the shader's, taken the other way.
  const at = (sx, sy) => ({
    x: width / 2 + (sx * cos - sy * sin) * stage,
    y: height / 2 - (sx * sin + sy * cos) * stage,
  });
  // A turned view reaches further along the plane's axes than its own sides.
  const half = { x: width / (2 * stage), y: height / (2 * stage) };
  const reach = {
    x: Math.abs(cos) * half.x + Math.abs(sin) * half.y,
    y: Math.abs(sin) * half.x + Math.abs(cos) * half.y,
  };
  const step = roundStep(Math.log10((SPACING * dpr) / stage) - cam.lz * LOG2);
  const pad = EDGE * dpr;

  ctx.save();
  ctx.font = `${Math.round(TYPE * dpr)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Clear of the axis by half the label, whichever way the view is turned.
  const clear = (p, away, text) => {
    const wide = ctx.measureText(text).width / 2;
    const tall = (TYPE * dpr) / 2;
    const gap = STANDOFF * dpr + Math.abs(away.x) * wide + Math.abs(away.y) * tall;
    return { x: p.x + away.x * gap, y: p.y + away.y * gap };
  };

  const grid = new Path2D();
  const axes = new Path2D();
  const marks = [];
  const tags = [];
  const far = width + height;
  // Where the axes themselves are, in stage pixels off the centre.
  const zero = { x: cam.toStage(-cam.x), y: cam.toStage(-cam.y) };

  // A number sits on the axis it counts along, the way a plotted plane reads.
  // Where that axis has left the screen, which is most of any deep zoom, the
  // number goes to the end of its own line instead.
  const families = [
    {
      lines: family(cam, cam.x, reach.x, step, ''),
      run: { x: -sin, y: -cos },
      line: (o) => at(o, 0),
      cross: (o) => at(o, zero.y),
      away: { x: sin, y: cos },
      nearer: LOWER,
      name: 'Im',
    },
    {
      lines: family(cam, cam.y, reach.y, step, 'i'),
      run: { x: cos, y: -sin },
      line: (o) => at(0, o),
      cross: (o) => at(zero.x, o),
      away: { x: -cos, y: sin },
      nearer: LEFTER,
      name: 'Re',
    },
  ];

  for (const f of families) {
    for (const line of f.lines) {
      const from = f.line(line.offset);
      const path = line.axis ? axes : grid;
      path.moveTo(from.x - f.run.x * far, from.y - f.run.y * far);
      path.lineTo(from.x + f.run.x * far, from.y + f.run.y * far);
      const pair = ends(from, f.run, width, height, pad);
      if (!pair) continue;
      // An axis is named where it leaves the canvas the way it counts up.
      if (line.axis) tags.push({ at: pair[1], text: f.name });
      if (!line.text) continue;
      const on = clear(f.cross(line.offset), f.away, line.text);
      const edge = f.nearer(pair[0], pair[1]) ? pair[0] : pair[1];
      marks.push({ at: inside(on, width, height, pad) ? on : edge, text: line.text });
    }
  }

  // Each path is stroked twice, dark then light, so it reads on the black of
  // the interior as well as on a pale band of the gradient.
  const over = (path, dark, light, alpha) => {
    ctx.lineWidth = dark * dpr;
    ctx.strokeStyle = '#000';
    ctx.globalAlpha = 0.55;
    ctx.stroke(path);
    ctx.lineWidth = light * dpr;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = alpha;
    ctx.stroke(path);
  };

  over(grid, 2.5, 1, 0.32);
  over(axes, 4, 1.6, 0.9);

  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = '#000';
  ctx.globalAlpha = 1;
  const taken = [];
  ctx.fillStyle = ACCENT;
  for (const tag of tags) label(ctx, tag.at, tag.text, width, height, dpr, taken);
  ctx.fillStyle = INK;
  for (const mark of marks) label(ctx, mark.at, mark.text, width, height, dpr, taken);
  ctx.restore();
}

const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// A number centred on the point, nudged in so one at the edge stays whole, and
// dropped where it would land on a number already written: a turned view sends
// both families out of the same edge, and losing a number costs less than
// printing two over each other. The axis names go first and keep their places.
function label(ctx, at, text, width, height, dpr, taken) {
  const wide = ctx.measureText(text).width / 2 + 4 * dpr;
  const tall = (TYPE * dpr) / 2 + 2 * dpr;
  const pad = EDGE * dpr;
  const x = Math.min(Math.max(at.x, wide + pad), width - wide - pad);
  const y = Math.min(Math.max(at.y, tall + pad), height - tall - pad);
  const box = [x - wide, y - tall, x + wide, y + tall];
  if (taken.some((other) => hits(box, other))) return;
  taken.push(box);
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}
