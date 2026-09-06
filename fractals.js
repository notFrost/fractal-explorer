// Set metadata plus the one piece of CPU math the GPU path still needs:
// the Mandelbrot reference orbit for perturbation rendering.

export const SETS = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z ← z² + c',
    // Perturbation + rebasing: zoom is limited by double precision of the centre.
    maxZoom: 1e15,
    bookmarks: [
      { x: 0.38, y: 0.1, zoom: 40000 },
      { x: 0.297364, y: -0.019193, zoom: 41018 },
      { x: -0.7436438870371587, y: 0.1318259042053119, zoom: 1e12 },
    ],
  },
  collatz: {
    name: 'Collatz',
    formula: 'z ← 3z + 1  or  z / 2',
    // Direct float32 iteration.
    maxZoom: 1e6,
    bookmarks: [],
  },
  webb: {
    name: 'Webb',
    formula: 'zₙ₊₁ ← zₙ² + zₙ₋₁',
    maxZoom: 1e6,
    bookmarks: [],
  },
};

export const MIN_ZOOM = 10;
export const MAX_ITER = 8000;

// Budget grows with zoom depth; the detail multiplier is the user's override.
export function iterationsFor(zoom, detail = 1) {
  const base = Math.min(4000, Math.max(200, Math.round(100 * Math.log10(zoom))));
  return Math.min(MAX_ITER, base * detail);
}

// Orbit of the centre point in doubles, written into `out` as interleaved
// (re, im) pairs. Entry 0 is Z_0 = 0, entry 1 is c. Stops one step after
// escaping so the shader always sees a huge final Z. Returns the entry count.
export function referenceOrbit(cx, cy, maxIter, out) {
  let zr = 0;
  let zi = 0;
  out[0] = 0;
  out[1] = 0;
  let n = 1;
  for (let i = 0; i < maxIter; i++) {
    const nr = zr * zr - zi * zi + cx;
    zi = 2 * zr * zi + cy;
    zr = nr;
    out[2 * n] = zr;
    out[2 * n + 1] = zi;
    n++;
    if (zr * zr + zi * zi > 1e10) break;
  }
  return n;
}
