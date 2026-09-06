// Escape-time functions ported from the PenguinMod project.
// Each returns 0 for "inside the set" and a smooth escape value otherwise.
// Scratch quirks kept on purpose: log is base 10, and NaN casts to 0.

const LOG10_2 = Math.log10(2);

function num(x) {
  return Number.isNaN(x) ? 0 : x;
}

// Scratch: log(log(sqrt(m2))) / log(2), with NaN -> 0 at each cast.
function smoothTerm(m2) {
  const r = num(Math.sqrt(m2));
  const l1 = num(Math.log10(r));
  const l2 = num(Math.log10(l1));
  return l2 / LOG10_2;
}

export function mandelbrot(cr, ci, maxIter) {
  // Main cardioid: skip the iteration entirely.
  const q = (cr - 0.25) * (cr - 0.25) + ci * ci;
  if (q * (q + cr - 0.25) < 0.25 * ci * ci) return 0;

  let zr = 0;
  let zi = 0;
  let steps = 0;
  while (steps < maxIter) {
    const zr2 = zr * zr;
    const zi2 = zi * zi;
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    steps++;
    const m2 = zr * zr + zi * zi;
    if (m2 > 4) return steps + 1 - smoothTerm(m2);
  }
  return 0;
}

// Complex parity: floor(|z|) mod 2. Odd -> 3z + 1, even -> z / 2.
// No early exit in the original; the color is decided after two steps
// and only used if the orbit is still outside radius 5 at the end.
export function collatz(cr, ci, maxIter) {
  let zr = cr;
  let zi = ci;

  const step = () => {
    const parity = num(Math.floor(Math.sqrt(zr * zr + zi * zi)) % 2);
    if (parity) {
      zr = zr * 3 + 1;
      zi = zi * 3;
    } else {
      zr = zr / 2;
      zi = zi / 2;
    }
  };

  step();
  step();
  const m2 = zr * zr + zi * zi;
  const fallback = m2 + 1 - smoothTerm(m2);

  for (let i = 0; i < maxIter - 2; i++) step();

  return zr * zr + zi * zi > 25 ? fallback : 0;
}

// Webb: z(n+1) = z(n)^2 + z(n-1), seeded with z(-1) = 0 and z(0) = c.
// The original breaks out before counting the escaping step.
export function webb(cr, ci, maxIter) {
  let pr = 0;
  let pi = 0;
  let zr = cr;
  let zi = ci;
  let steps = 0;
  let m2 = zr * zr + zi * zi;
  while (steps < maxIter) {
    const nr = zr * zr - zi * zi + pr;
    const ni = 2 * zr * zi + pi;
    pr = zr;
    pi = zi;
    zr = nr;
    zi = ni;
    m2 = zr * zr + zi * zi;
    if (m2 > 4) break;
    steps++;
  }
  if (m2 > 4) return steps + 1 - smoothTerm(m2);
  return 0;
}

export const SETS = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z ← z² + c',
    fn: mandelbrot,
    bookmarks: [
      { x: 0.38, y: 0.1, zoom: 40000 },
      { x: 0.297364, y: -0.019193, zoom: 41018 },
    ],
  },
  collatz: {
    name: 'Collatz',
    formula: 'z ← 3z + 1  or  z / 2',
    fn: collatz,
    bookmarks: [],
  },
  webb: {
    name: 'Webb',
    formula: 'zₙ₊₁ ← zₙ² + zₙ₋₁',
    fn: webb,
    bookmarks: [],
  },
};

// Iteration budget from the original: clamp(log10(zoom) * 25, 10, 200).
export function iterationsFor(zoom, detail = 1) {
  const base = Math.min(200, Math.max(10, Math.log10(zoom) * 25));
  return Math.round(base * detail);
}

// Pen color as the original set it: start from #0400ff (hue 242°, full
// saturation), then set hue to (t + 90) mod 100 on Scratch's 0..100 wheel
// and brightness to t * 5 clamped to 0..100. Inside points stay black.
export function colorOf(t, out, o) {
  if (t === 0 || Number.isNaN(t)) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    return;
  }
  let hue = (t + 90) % 100;
  if (hue < 0) hue += 100;
  const h6 = (hue / 100) * 6;
  const v = Math.min(100, Math.max(0, t * 5)) / 100;
  const i = Math.floor(h6);
  const f = h6 - i;
  const p = 0;
  const q = v * (1 - f);
  const u = v * f;
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0: r = v; g = u; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = u; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = u; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  out[o] = r * 255;
  out[o + 1] = g * 255;
  out[o + 2] = b * 255;
}
