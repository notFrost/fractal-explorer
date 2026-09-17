// Where a typed formula's fractal sits, so the editor's preview and the view
// Render opens on frame it instead of assuming the origin.
//
// A formula gives no closed form for its set's extent, so the survey measures
// it. It draws a small greyscale map of how long each pixel's orbit lasts,
// keeps the slowest of them, and takes their bounding box. Those pixels are
// the set and the filaments around it, whatever the formula. One box is only
// as tight as the view it was measured in, so the survey opens wide and closes
// in, measuring again at each step.

import { Camera } from './precision.js';
import { MIN_LOG_ZOOM, FLOAT_LOG_ZOOM, STAGE_HEIGHT, iterationsFor } from './fractals.js';

const WIDE = 128;
const HIGH = 96;
const ASPECT = WIDE / HIGH;

// Eight world units tall, which holds every set the built-in formulas draw.
// A set larger than that, or somewhere else, the passes below widen towards.
const OPENING_ZOOM = STAGE_HEIGHT / 8;

// At most this share of the picture is taken to be the fractal, so a set
// filling a corner is not lost in the background around it.
const SHARE = 0.02;

// Room left around the box, so a fit does not clip what it just measured and
// the next pass reads a box clear of the edges.
const PAD = 1.25;

const PASSES = 5;

// A fit this close to the view it was measured in has nothing left to gain.
const SETTLED = 0.2;

// The survey draws at the float tier, as the custom sets themselves do, so it
// cannot look closer than that tier holds, nor wider than the viewer allows.
const surveyCamera = (x, y, zoom) => new Camera(x, y, 2 ** Math.min(FLOAT_LOG_ZOOM, Math.max(MIN_LOG_ZOOM, Math.log2(zoom))));

// The grey level the slowest pixels begin at: the whitest level with anything
// in it, and then each level under it that the share still has room for. It
// stops short of the share rather than overshooting it, which is what keeps
// the reading out of the plateau of fast escapes behind the fractal. That
// plateau is one enormous level, and falling into it puts the box around the
// bailout radius instead of around the set.
function slowLevel(depth) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < WIDE * HIGH; i++) counts[depth[i * 4]]++;
  const most = Math.max(1, Math.round(WIDE * HIGH * SHARE));
  let level = 256;
  let seen = 0;
  while (level > 0 && seen === 0) {
    level--;
    seen += counts[level];
  }
  while (level > 0 && seen + counts[level - 1] <= most) {
    level--;
    seen += counts[level];
  }
  return level;
}

// The box those pixels cover, in world coordinates. `clipped` says it runs off
// the survey, so the fractal carries on past what was measured and the box is
// a lower bound rather than its extent.
function slowBox(depth, cam) {
  const level = slowLevel(depth);
  let left = WIDE;
  let right = -1;
  let bottom = HIGH;
  let top = -1;
  for (let row = 0; row < HIGH; row++) {
    for (let col = 0; col < WIDE; col++) {
      if (depth[(row * WIDE + col) * 4] < level) continue;
      if (col < left) left = col;
      if (col > right) right = col;
      if (row < bottom) bottom = row;
      if (row > top) top = row;
    }
  }
  const unit = STAGE_HEIGHT / (HIGH * cam.zoom);
  const worldX = (col) => cam.xDouble() + (col - WIDE / 2) * unit;
  const worldY = (row) => cam.yDouble() + (row - HIGH / 2) * unit;
  return {
    x0: worldX(left),
    x1: worldX(right + 1),
    y0: worldY(bottom),
    y1: worldY(top + 1),
    clipped: left === 0 || bottom === 0 || right === WIDE - 1 || top === HIGH - 1,
  };
}

function survey(renderer, parts, fallback) {
  let cam = surveyCamera(0, 0, OPENING_ZOOM);
  let home = fallback;
  for (let pass = 0; pass < PASSES; pass++) {
    const depth = renderer.depthMap(parts, cam, WIDE, HIGH, iterationsFor(cam.lz, 1, 'custom'));
    if (!depth) return home;
    const box = slowBox(depth, cam);
    const x = (box.x0 + box.x1) / 2;
    const y = (box.y0 + box.y1) / 2;
    if (box.clipped) {
      // A box against the edge gives a direction rather than a centre, so the
      // next pass moves to it and looks twice as wide. An unbounded set, z^z +
      // c among them, never closes, and the fallback beats the widest view
      // the app has.
      cam = surveyCamera(x, y, cam.zoom / 2);
      continue;
    }
    const span = Math.max(box.y1 - box.y0, (box.x1 - box.x0) / ASPECT);
    home = { x, y, zoom: STAGE_HEIGHT / (PAD * span) };
    if (Math.abs(Math.log2(home.zoom) - cam.lz) < SETTLED) break;
    cam = surveyCamera(home.x, home.y, home.zoom);
  }
  return home;
}

// The fallback stands in for a survey that found nothing to frame, and for one
// the GPU would not run at all: a lost context, or a formula the depth pass
// refuses to compile.
export function frameCustom(renderer, parts, fallback) {
  try {
    return survey(renderer, parts, fallback);
  } catch {
    return fallback;
  }
}
