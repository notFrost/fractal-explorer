// The colourways. `index` is the branch palette() takes in the shader, so the
// order there and here must agree. `swatch` is the chip's CSS background.

export const PALETTES = [
  {
    key: 'pen', index: 0, group: 'Original', name: 'Pen',
    swatch: 'linear-gradient(90deg,#000,#0400ff 20%,#00ffff 35%,#00ff00 50%,#ffff00 65%,#ff0000 80%,#ff00ff 95%,#0400ff)',
  },
  {
    key: 'classic', index: 1, group: 'Original', name: 'Classic',
    swatch: 'linear-gradient(90deg,#000764,#206bcb 16%,#edffff 42%,#ffaa00 64%,#000200 86%,#000764)',
  },
  {
    key: 'abyss', index: 3, group: 'Colorful', name: 'Abyss',
    swatch: 'linear-gradient(90deg,#001219,#005f73 12%,#0a9396 25%,#94d2bd 37%,#e9d8a6 50%,#94d2bd 63%,#0a9396 75%,#005f73 88%,#001219)',
  },
  {
    key: 'ember', index: 2, group: 'Colorful', name: 'Ember',
    swatch: 'linear-gradient(90deg,#050000,#590808 12%,#d92e0a 25%,#ffb321 37%,#fff5d6 50%,#ffb321 63%,#d92e0a 75%,#590808 88%,#050000)',
  },
  {
    key: 'ultraviolet', index: 4, group: 'Colorful', name: 'Ultraviolet',
    swatch: 'linear-gradient(90deg,#050014,#0400ff 20%,#7a00ff 45%,#ff2bd6 70%,#ffd6f5 90%,#050014)',
  },
  {
    key: 'ink', index: 5, group: 'Monochrome', name: 'Ink',
    swatch: 'repeating-linear-gradient(90deg,#1f1e1a 0 5px,#ede8d9 5px 18px)',
  },
  {
    key: 'chalk', index: 6, group: 'Monochrome', name: 'Chalk',
    swatch: 'repeating-linear-gradient(90deg,#e6ecf5 0 5px,#171a20 5px 18px)',
  },
];

export const DEFAULT_PALETTE = 'pen';

export const paletteByKey = (key) => PALETTES.find((p) => p.key === String(key).toLowerCase()) || null;

// Group names in display order, each with its palettes in display order.
export const PALETTE_GROUPS = [...new Set(PALETTES.map((p) => p.group))].map((group) => ({
  group,
  palettes: PALETTES.filter((p) => p.group === group),
}));
