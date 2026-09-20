// Rendering an animation out, one whole frame at a time.
//
// The viewer draws for the eye: it shows a coarse pass while the view moves
// and sharpens once it stops, because a frame that took two seconds would be
// two seconds late. A movie has no such clock. Every frame here is drawn at
// full size and full depth, however long it takes, and only then handed to the
// encoder. A ten-second zoom to 10^300 can take an hour, and every frame of it
// is the picture the viewer would have settled on.
//
// The strips are the viewer's own: a frame too expensive for one draw call is
// split across animation frames so no call runs long enough for the driver to
// decide the GPU has hung.

import { iterationsFor } from './fractals.js';
import { sample } from './keyframes.js';
import { createGif, gifFps } from './encoders/gif.js';
import { createMp4, evenSide, canEncodeMp4 } from './encoders/mp4.js';

export { canEncodeMp4 };

const nextFrame = () => new Promise(requestAnimationFrame);

// Bits per pixel per frame. Fractal footage is detail from edge to edge with
// nothing for the encoder to skip, so even the low setting sits above what a
// camera would need at the same size.
const BITS_PER_PIXEL = { draft: 0.08, good: 0.16, best: 0.32 };

export const QUALITIES = [
  { key: 'draft', name: 'Draft' },
  { key: 'good', name: 'Good' },
  { key: 'best', name: 'Best' },
];

export const bitrateFor = (width, height, fps, quality) =>
  width * height * fps * (BITS_PER_PIXEL[quality] ?? BITS_PER_PIXEL.good);

export const frameCount = (total, fps) => Math.max(1, Math.round(total * fps));

// How many frames a format can honestly show a second. MP4 takes the rate as
// given; GIF counts delays in hundredths of a second and rounds to those.
export const trueFps = (format, fps) => (format === 'gif' ? gifFps(fps) : fps);

// The largest frame this GPU will draw, with H.264's even sides applied where
// the format needs them.
export function fitSize(maxSide, width, height, format) {
  const cap = maxSide || 8192;
  const scale = Math.min(1, cap / width, cap / height);
  const w = Math.max(16, Math.round(width * scale));
  const h = Math.max(16, Math.round(height * scale));
  return format === 'mp4' ? { width: evenSide(w), height: evenSide(h) } : { width: w, height: h };
}

// One frame, drawn to the end. False means the render was called off partway,
// and what is on the canvas is half a frame that nothing will use.
async function drawWhole(renderer, view, stopped) {
  const { strips } = renderer.begin(view, true, 1);
  for (let i = 0; i < strips; i++) {
    if (stopped()) return false;
    if (renderer.lost) throw new Error('the GPU dropped the drawing context');
    renderer.begin(view, false, 1);
    renderer.drawStrip(i, strips);
    await nextFrame();
  }
  return true;
}

// A rough seconds-remaining that does not swing on one slow frame. Each frame
// moves the estimate a fifth of the way to what it alone would predict.
function pace() {
  let mean = 0;
  let seen = 0;
  return {
    add(ms) {
      seen++;
      mean = seen === 1 ? ms : mean + (ms - mean) * 0.2;
    },
    left(frames) {
      return seen ? (mean * frames) / 1000 : null;
    },
  };
}

export async function record({
  renderer,
  canvas,
  set,
  animation,
  fps,
  width,
  height,
  format,
  quality = 'good',
  dither = true,
  detail = 1,
  loop = true,
  overlay = null,
  onFrame = null,
  onProgress = null,
  stopped = () => false,
}) {
  const frames = frameCount(animation.total, fps);
  const encoder = format === 'mp4'
    ? await createMp4({ width, height, fps, bitrate: bitrateFor(width, height, fps, quality) })
    : createGif({ width, height, fps, dither, loop });

  // The picture is copied through a 2D canvas whenever something is drawn over
  // it or the bytes themselves are wanted. Without either, the encoder reads
  // the GL canvas directly and the copy never happens.
  const needsPixels = format === 'gif';
  const sheet = needsPixels || overlay ? document.createElement('canvas') : null;
  let paper = null;
  if (sheet) {
    sheet.width = width;
    sheet.height = height;
    paper = sheet.getContext('2d', { willReadFrequently: needsPixels });
  }

  const was = { width: canvas.width, height: canvas.height };
  canvas.width = width;
  canvas.height = height;

  const clock = pace();
  let done = 0;
  try {
    for (let i = 0; i < frames; i++) {
      const at = performance.now();
      const view = sample(animation, i / fps);
      if (!view) break;
      onFrame?.(view);
      const drawn = await drawWhole(renderer, {
        set,
        cam: view.cam,
        maxIter: iterationsFor(view.cam.lz, detail, set),
        julia: view.julia ?? undefined,
        vars: view.vars ?? undefined,
        angle: (view.angle * Math.PI) / 180,
      }, stopped);
      if (!drawn) return null;

      if (paper) {
        paper.drawImage(canvas, 0, 0);
        overlay?.(paper, { width, height });
      }
      if (format === 'gif') encoder.add(paper.getImageData(0, 0, width, height).data);
      else await encoder.add(sheet ?? canvas, i);

      done = i + 1;
      clock.add(performance.now() - at);
      onProgress?.({ frame: done, frames, left: clock.left(frames - done), bytes: encoder.bytes });
      if (stopped()) return null;
    }
    if (!done) return null;
    return { blob: await encoder.finish(), frames: done };
  } catch (err) {
    encoder.cancel();
    throw err;
  } finally {
    canvas.width = was.width;
    canvas.height = was.height;
  }
}

// A name that says what the movie is of and how it was made, in the shape the
// screenshots already use.
export function movieName({ set, animation, width, height, fps, format }) {
  const deep = Math.max(...animation.keys.map((k) => k.lz));
  const zoom = deep >= 40 ? `_10e${Math.round(deep * 0.30103)}` : '';
  // GIF's rounded delay can land between whole rates, and a name that said 13
  // for a file that runs at 12.5 would be the only wrong thing about it.
  const rate = Number(trueFps(format, fps).toFixed(1));
  return `${set}${zoom}_${width}x${height}_${rate}fps.${format}`;
}
