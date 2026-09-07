// Set metadata and the iteration budget.

export const SETS = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z ← z² + c',
    bookmarks: [
      { x: 0.38, y: 0.1, zoom: 40000 },
      { x: 0.297364, y: -0.019193, zoom: 41018 },
      { x: -0.7436438870371587, y: 0.1318259042053119, zoom: 1e12 },
    ],
  },
  collatz: {
    name: 'Collatz',
    formula: 'z ← 3z + 1  or  z / 2',
    maxIter: 500,
    bookmarks: [],
  },
  webb: {
    name: 'Webb',
    formula: 'zₙ₊₁ ← zₙ² + zₙ₋₁',
    bookmarks: [],
  },
};

export const MIN_LOG_ZOOM = Math.log2(10);
export const MAX_ITER = 100000;

// Zoom thresholds for the precision tiers (log2).
export const FLOAT_LOG_ZOOM = Math.log2(1e6);   // beyond this Webb and Collatz switch from direct float32 to perturbation
export const BIG_LOG_ZOOM = 40;   // beyond this the reference orbit is computed in BigInt
export const FE_LOG_ZOOM = 90;    // beyond this pixel deltas carry their own exponent

// Budget grows with zoom depth; the detail multiplier is the user's override.
// Sets with their own ceiling (Collatz stops at 500) clamp to it.
export function iterationsFor(log2zoom, detail = 1, set = 'mandelbrot') {
  const base = Math.min(50000, Math.max(200, Math.round(30 * log2zoom)));
  return Math.min(MAX_ITER, SETS[set]?.maxIter ?? MAX_ITER, base * detail);
}
