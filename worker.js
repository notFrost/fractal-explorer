import { SETS, colorOf } from './fractals.js';

// One task = a horizontal band of the canvas. Blocks of `step` pixels are
// sampled once at their centre and filled flat, matching the original's
// "pen size 1.5 × quality" dots at quality 10.
self.onmessage = (e) => {
  const t = e.data;
  const { w, rows, y0, h, step, scale, zoom, camX, camY, maxIter } = t;
  const fn = SETS[t.set].fn;
  const buf = new Uint8ClampedArray(w * rows * 4);
  const halfW = w / 2;
  const halfH = h / 2;
  const half = step / 2;

  for (let y = 0; y < rows; y += step) {
    const sy = (halfH - (y0 + y + half)) / scale;
    const ci = sy / zoom + camY;
    const yEnd = Math.min(y + step, rows);
    for (let x = 0; x < w; x += step) {
      const sx = (x + half - halfW) / scale;
      const cr = sx / zoom + camX;
      const v = fn(cr, ci, maxIter);
      const xEnd = Math.min(x + step, w);
      const first = (y * w + x) * 4;
      colorOf(v, buf, first);
      buf[first + 3] = 255;
      for (let yy = y; yy < yEnd; yy++) {
        const rowBase = yy * w * 4;
        for (let xx = x; xx < xEnd; xx++) {
          const o = rowBase + xx * 4;
          buf[o] = buf[first];
          buf[o + 1] = buf[first + 1];
          buf[o + 2] = buf[first + 2];
          buf[o + 3] = 255;
        }
      }
    }
  }

  self.postMessage({ id: t.id, y0, rows, w, buf: buf.buffer }, [buf.buffer]);
};
