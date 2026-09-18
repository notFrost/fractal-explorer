// Set metadata and the iteration budget.

export const MIN_LOG_ZOOM = Math.log2(10);
export const MAX_ITER = 100000;
export const MIN_ITER = 16;

// The original's stage was 360 pixels tall and zoom counts stage pixels to the
// world unit, so a view is this many world units tall whatever its size.
export const STAGE_HEIGHT = 360;

// Zoom thresholds for the precision tiers (log2).
export const FLOAT_LOG_ZOOM = Math.log2(1e6);   // beyond this Webb and Collatz switch from direct float32 to perturbation
export const BIG_LOG_ZOOM = 40;   // beyond this the reference orbit is computed in BigInt
export const FE_LOG_ZOOM = 90;    // beyond this pixel deltas carry their own exponent

// C is the set's parameter, not a coordinate: the pixel is z₀. Kept as the
// strings the user typed so the URL hash round-trips them exactly.
const JULIA_C = { re: '-0.74543', im: '0.11301' };

// A card's formula wraps where it must, and the escaped no-break spaces
// hold a pair of terms together over the break: `Re z` reads as one thing,
// where `Re` alone at the end of a line does not.
//
// `home` is where a set opens from the menu, and what its card thumbnail shows.
// `edit` is the same iteration written for the formula editor; a set that has
// none says under `unwritable` what stops it.
export const SETS = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z ← z² + c',
    home: { x: -0.7, y: 0, zoom: 135 },
    edit: { formula: 'Z_(n+1) = Z_(n)^2 + C', seedZ: '0', seedC: 'x+yi' },
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
    unwritable: 'Collatz picks one of two formulas each step, and the editor writes one.',
    bookmarks: [],
  },
  webb: {
    name: 'Webb',
    formula: 'zₙ₊₁ ← zₙ² + zₙ₋₁',
    home: { x: 0, y: 0, zoom: 100 },
    unwritable: 'Webb needs the term before last, and the editor carries only zₙ.',
    bookmarks: [],
  },
  julia: {
    name: 'Julia',
    formula: 'z ← z² + C',
    home: { x: 0, y: 0, zoom: 100 },
    c: JULIA_C,
    edit: { formula: 'Z_(n+1) = Z_(n)^2 + C', seedZ: 'x+yi', seedC: `${JULIA_C.re}+${JULIA_C.im}i` },
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
    formula: 'z ← (|Re\u00a0z|\u00a0+\u00a0i|Im\u00a0z|)² + c̄',
    // The original opens on the small ship below the main hull.
    home: { x: -1.7561482916191014, y: 0.029730420820441892, zoom: 3194.799993706228 },
    edit: { formula: '(|re(z)| + i|im(z)|)^2 + conj(c)', seedZ: '0', seedC: 'x+yi' },
    bookmarks: [{ x: 0, y: 0, zoom: 100 }],
  },
  perpendicularship: {
    name: 'Perpendicular Ship',
    formula: 'z ← (Re\u00a0z\u00a0−\u00a0i|Im\u00a0z|)² + c',
    home: { x: -0.5, y: 0.1, zoom: 115 },
    edit: { formula: '(re(z) - i|im(z)|)^2 + c', seedZ: '0', seedC: 'x+yi' },
    bookmarks: [{ x: -0.74, y: -0.764, zoom: 30000 }],
  },
  mandelbug: {
    name: 'MandelBug',
    formula: 'z ← Re(z²) + 2i(Re\u00a0z\u00a0+\u00a0Im\u00a0z) + c',
    // The bulk of the set. Everything outside it is the line Im c = −Re c,
    // where c is its own fixed point, running off to infinity.
    home: { x: -0.97, y: 0.97, zoom: 157 },
    edit: { formula: 're(z^2) + 2i(re(z) + im(z)) + c', seedZ: '0', seedC: 'x+yi' },
    bookmarks: [{ x: 0, y: 0, zoom: 100 }],
  },
  pacman: {
    name: 'Pacman',
    formula: 'z ← Re(z)² − Im(z²+c)² + Re(c) + i·Im(z²+c)',
    maxLogZoom: BIG_LOG_ZOOM,
    home: { x: -0.4, y: 0, zoom: 135 },
    edit: {
      formula: 're(z)^2 - im(z^2+c)^2 + re(c) + i*im(z^2+c)',
      seedZ: '0',
      seedC: 'x+yi',
    },
    bookmarks: [],
  },
  octopus: {
    name: 'The Octopus',
    formula: 'z ← (Re\u00a0z\u00a0+\u00a0Im\u00a0c\u00a0+\u00a0i(|Im\u00a0z|\u00a0−\u00a0Re\u00a0c))² + c',
    home: { x: 0.61, y: -0.53, zoom: 140 },
    edit: {
      formula: '(re(z) + im(c) + i(|im(z)| - re(c)))^2 + c',
      seedZ: '0',
      seedC: 'x+yi',
    },
    bookmarks: [],
  },
  custom: {
    name: 'Custom',
    formula: 'z ← z² + c',
    custom: true,
    maxLogZoom: FLOAT_LOG_ZOOM,
    home: { x: -0.7, y: 0, zoom: 135 },
    bookmarks: [],
  },
};

// What the zoom alone asks for, before the user's multiplier.
export function baseIterations(log2zoom) {
  return Math.min(50000, Math.max(200, Math.round(30 * log2zoom)));
}

// The most a set will run. Collatz stops at 500; the rest stop at MAX_ITER.
export const iterCeiling = (set) => Math.min(MAX_ITER, SETS[set]?.maxIter ?? MAX_ITER);

// Budget grows with zoom depth; the detail multiplier is the user's override.
export function iterationsFor(log2zoom, detail = 1, set = 'mandelbrot') {
  const wanted = Math.round(baseIterations(log2zoom) * detail);
  return Math.max(MIN_ITER, Math.min(iterCeiling(set), wanted));
}
