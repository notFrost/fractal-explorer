// Where a dive lands: a random point in the frame on screen, drawn towards
// whatever detail is in it.
//
// A point picked evenly over the frame would nearly always land in the black
// of the interior or the flat wash behind the set, and a zoom there ends on
// one colour. What holds up under a zoom is the boundary, so the pick is
// weighted by how much the picture changes from one pixel to the next. Flat
// regions score nothing, a band of colour shifts a level or two, and the
// filaments along the boundary swing the width of the palette. Squaring that
// weight leaves the filaments the likely pick even where they cover a
// fraction of the frame.
//
// The frame read is the one already on screen, so the spot is one the viewer
// can see and the press costs no render.

// About this many pixels are scored, whatever size the canvas is.
const SAMPLES = 40000;

// The share of the frame left out around the edge. A spot inside it has its
// surroundings on screen, and the fall towards it stays a short move.
const MARGIN = 0.1;

const luma = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

// What a pixel is worth is how far the pixels either side of it stand apart,
// across and up. Those neighbours are the ones next to it whatever the
// sampling step, so this reads the finest detail the frame holds.
function change(px, w, i) {
  return Math.abs(luma(px, i + 4) - luma(px, i - 4))
    + Math.abs(luma(px, i + w * 4) - luma(px, i - w * 4));
}

// The frame arrives from the GPU as RGBA bytes with its rows bottom up, and
// the spot comes back in those same coordinates. One pass keeps a running
// total of the weight and replaces the pick in proportion to it, which draws
// from the whole frame without holding a score per pixel. A frame with no
// change in it anywhere, deep inside the set or far outside it, has no spot to
// prefer, and the draw is even over it. Null if the frame is too small to read
// neighbours in.
export function pickSpot({ bytes, w, h }, random = Math.random) {
  const x0 = Math.max(1, Math.round(w * MARGIN));
  const y0 = Math.max(1, Math.round(h * MARGIN));
  const x1 = w - x0;
  const y1 = h - y0;
  if (x1 <= x0 || y1 <= y0) return null;
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / SAMPLES)));
  let total = 0;
  let spot = null;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const weight = change(bytes, w, (y * w + x) * 4) ** 2;
      if (!weight) continue;
      total += weight;
      if (random() * total < weight) spot = { x, y };
    }
  }
  return spot ?? { x: x0 + random() * (x1 - x0), y: y0 + random() * (y1 - y0) };
}
