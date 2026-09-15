// Set metadata and the iteration budget.

// `home` is where a set opens from the menu, and what its card thumbnail shows.
export const SETS = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z ← z² + c',
    // The set runs from -2 to 0.47, so the origin is not its middle.
    home: { x: -0.7, y: 0, zoom: 135 },
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
    home: { x: 0, y: 0, zoom: 100 },
    bookmarks: [],
  },
  webb: {
    name: 'Webb',
    formula: 'zₙ₊₁ ← zₙ² + zₙ₋₁',
    home: { x: 0, y: 0, zoom: 100 },
    bookmarks: [],
  },
  julia: {
    name: 'Julia',
    formula: 'z ← z² + C',
    home: { x: 0, y: 0, zoom: 100 },
    // C is the set's parameter, not a coordinate: the pixel is z₀. Kept as the
    // strings the user typed so the URL hash round-trips them exactly.
    c: { re: '-0.74543', im: '0.11301' },
    presets: [
      { name: "Douady's Rabbit", re: '-0.123', im: '0.745' },
      { name: 'Tree-Like Spiral', re: '-0.7', im: '0.27' },
      { name: 'Elongated Tendrils', re: '-0.8', im: '0.156' },
      { name: 'Seashell', re: '-0.4', im: '0.6' },
    ],
    bookmarks: [],
  },
  burningship: {
    name: 'Burning Ship',
    formula: 'z ← (|Re z| + i|Im z|)² + c̄',
    // The original opens on the small ship below the main hull.
    home: { x: -1.7561482916191014, y: 0.029730420820441892, zoom: 3194.799993706228 },
    bookmarks: [{ x: 0, y: 0, zoom: 100 }],
  },
  mandelbug: {
    name: 'MandelBug',
    formula: 'z ← Re(z²) + 2i(Re z + Im z) + c',
    // The bulk of the set. Everything outside it is the line Im c = −Re c,
    // where c is its own fixed point, running off to infinity.
    home: { x: -0.97, y: 0.97, zoom: 157 },
    bookmarks: [{ x: 0, y: 0, zoom: 100 }],
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
