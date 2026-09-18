// A GIF89a, written here from the RGBA of each frame.
//
// GIF holds 256 colours to a frame where a fractal frame has tens of
// thousands, so most of this file is choosing which 256 and which of them each
// pixel becomes. The rest is LZW, which is what GIF stores the result as.
//
// Every frame carries its own colour table. One table shared across a zoom
// would be chosen from the first frame and wrong by the last, since a zoom
// walks through the whole palette as the iteration counts climb.

// The colours are counted in a cube five bits to the channel. Finer than that
// costs more to clear each frame than it wins back, and a 256-colour table
// cannot resolve it anyway.
const CUBE = 5;
const SIDE = 1 << CUBE;
const BINS = SIDE ** 3;
const DROP = 8 - CUBE;

const binOf = (r, g, b) => (((r >> DROP) * SIDE + (g >> DROP)) * SIDE + (b >> DROP));
const binR = (bin) => ((bin / (SIDE * SIDE)) | 0) << DROP;
const binG = (bin) => (((bin / SIDE) | 0) % SIDE) << DROP;
const binB = (bin) => (bin % SIDE) << DROP;

const MOST_COLOURS = 256;

// GIF counts a delay in hundredths of a second, so a rate that does not divide
// 100 is rounded to one that does. Under two hundredths many players fall back
// to a tenth of a second, which would run the movie five times slow.
const gifDelay = (fps) => Math.max(2, Math.round(100 / fps));
export const gifFps = (fps) => 100 / gifDelay(fps);

// ---------- Choosing the colours ----------

// Median cut: one box holding every colour in the frame, split again and again
// across its longest side at the population midpoint, until there are as many
// boxes as the table has room for. Each box then contributes the average of
// the colours inside it, which is nearer to them than the box centre is.
class Palette {
  constructor() {
    this.count = new Float64Array(BINS);
    this.sum = [new Float64Array(BINS), new Float64Array(BINS), new Float64Array(BINS)];
    this.order = new Int32Array(BINS);
    this.nearest = new Int16Array(BINS);
    this.r = new Uint8Array(MOST_COLOURS);
    this.g = new Uint8Array(MOST_COLOURS);
    this.b = new Uint8Array(MOST_COLOURS);
    this.size = 0;
  }

  tally(rgba) {
    this.count.fill(0);
    for (const s of this.sum) s.fill(0);
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const bin = binOf(r, g, b);
      this.count[bin]++;
      this.sum[0][bin] += r;
      this.sum[1][bin] += g;
      this.sum[2][bin] += b;
    }
    let used = 0;
    for (let bin = 0; bin < BINS; bin++) {
      if (this.count[bin] > 0) this.order[used++] = bin;
    }
    return used;
  }

  // Population and the span of each channel over a stretch of the bin list.
  measure(lo, hi) {
    const low = [255, 255, 255];
    const high = [0, 0, 0];
    let people = 0;
    for (let at = lo; at < hi; at++) {
      const bin = this.order[at];
      people += this.count[bin];
      const channel = [binR(bin), binG(bin), binB(bin)];
      for (let c = 0; c < 3; c++) {
        if (channel[c] < low[c]) low[c] = channel[c];
        if (channel[c] > high[c]) high[c] = channel[c];
      }
    }
    let axis = 0;
    for (let c = 1; c < 3; c++) {
      if (high[c] - low[c] > high[axis] - low[axis]) axis = c;
    }
    return { lo, hi, people, axis, span: high[axis] - low[axis] };
  }

  // The bins of a box in order along its longest channel, cut where half its
  // pixels lie to either side. A box of one bin, or one colour repeated, has
  // nothing to cut.
  split(box) {
    if (box.hi - box.lo < 2 || box.span === 0) return null;
    const at = [binR, binG, binB][box.axis];
    this.order.subarray(box.lo, box.hi).sort((p, q) => at(p) - at(q));
    let seen = 0;
    let cut = box.lo;
    while (cut < box.hi - 1 && seen * 2 < box.people) {
      seen += this.count[this.order[cut]];
      cut++;
    }
    return [this.measure(box.lo, cut), this.measure(cut, box.hi)];
  }

  build(rgba, most) {
    const used = this.tally(rgba);
    const boxes = [this.measure(0, used)];
    // A box worth cutting is one that is both wide and busy; either alone
    // spends a colour on a corner of the picture nobody is looking at.
    const worth = (box) => box.people * box.span;
    while (boxes.length < most) {
      let pick = -1;
      for (const [at, box] of boxes.entries()) {
        if (box.span > 0 && box.hi - box.lo > 1 && (pick < 0 || worth(box) > worth(boxes[pick]))) pick = at;
      }
      if (pick < 0) break;
      const pair = this.split(boxes[pick]);
      if (!pair) break;
      boxes.splice(pick, 1, ...pair);
    }

    this.size = boxes.length;
    for (const [at, box] of boxes.entries()) {
      let people = 0;
      const total = [0, 0, 0];
      for (let i = box.lo; i < box.hi; i++) {
        const bin = this.order[i];
        people += this.count[bin];
        for (let c = 0; c < 3; c++) total[c] += this.sum[c][bin];
      }
      const mean = (c) => (people > 0 ? Math.round(total[c] / people) : 0);
      this.r[at] = mean(0);
      this.g[at] = mean(1);
      this.b[at] = mean(2);
    }
    this.nearest.fill(-1);
    return this.size;
  }

  // The table entry nearest a colour, kept per cube cell so the search over
  // 256 entries runs once for each cell the frame touches rather than once
  // for each pixel.
  index(r, g, b) {
    const bin = binOf(r, g, b);
    const known = this.nearest[bin];
    if (known >= 0) return known;
    let best = 0;
    let least = Infinity;
    for (let i = 0; i < this.size; i++) {
      const dr = r - this.r[i];
      const dg = g - this.g[i];
      const db = b - this.b[i];
      const d = dr * dr + dg * dg + db * db;
      if (d < least) {
        least = d;
        best = i;
      }
    }
    this.nearest[bin] = best;
    return best;
  }
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Straight nearest-colour, which keeps a flat area flat and bands a gradient.
function map(rgba, palette, out) {
  for (let i = 0, at = 0; i < rgba.length; i += 4, at++) {
    out[at] = palette.index(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
}

// Floyd and Steinberg: what a pixel loses to the nearest table entry is handed
// on to its neighbours, which trades a band for a grain. A fractal gradient
// crosses hundreds of levels over a few pixels, so the bands are wide and
// worth breaking up. The rows run alternately left and right so the error does
// not drift the same way down the whole picture.
function dither(rgba, width, height, palette, out) {
  const line = width * 3;
  let here = new Float32Array(line);
  let below = new Float32Array(line);
  for (let y = 0; y < height; y++) {
    below.fill(0);
    const rightward = y % 2 === 0;
    const stride = rightward ? 3 : -3;
    for (let step = 0; step < width; step++) {
      const x = rightward ? step : width - 1 - step;
      const at = y * width + x;
      const p = x * 3;
      const s = at * 4;
      const r = clamp(Math.round(rgba[s] + here[p]));
      const g = clamp(Math.round(rgba[s + 1] + here[p + 1]));
      const b = clamp(Math.round(rgba[s + 2] + here[p + 2]));
      const i = palette.index(r, g, b);
      out[at] = i;
      const er = r - palette.r[i];
      const eg = g - palette.g[i];
      const eb = b - palette.b[i];
      const ahead = p + stride;
      const behind = p - stride;
      if (ahead >= 0 && ahead < line) {
        here[ahead] += er * 0.4375;
        here[ahead + 1] += eg * 0.4375;
        here[ahead + 2] += eb * 0.4375;
        below[ahead] += er * 0.0625;
        below[ahead + 1] += eg * 0.0625;
        below[ahead + 2] += eb * 0.0625;
      }
      if (behind >= 0 && behind < line) {
        below[behind] += er * 0.1875;
        below[behind + 1] += eg * 0.1875;
        below[behind + 2] += eb * 0.1875;
      }
      below[p] += er * 0.3125;
      below[p + 1] += eg * 0.3125;
      below[p + 2] += eb * 0.3125;
    }
    const spent = here;
    here = below;
    below = spent;
  }
}

// ---------- LZW ----------

// The hash the GIF and Unix compress encoders have always used: 5003 slots,
// open addressing, and a stride that walks the table without repeating.
const HASH = 5003;
const TOP_CODE = 4096;

function compress(indices, minCodeSize, emit) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const keys = new Int32Array(HASH);
  const codes = new Int32Array(HASH);
  let bits = minCodeSize + 1;
  let ceiling = (1 << bits) - 1;
  let free = clearCode + 2;
  let held = 0;
  let heldBits = 0;
  let cleared = false;

  // A code is written low bit first, and the width it is written at follows
  // the table: the decoder widens its own the moment the table reaches the
  // next power of two, so the check belongs after the code rather than before.
  const put = (code) => {
    held |= code << heldBits;
    heldBits += bits;
    while (heldBits >= 8) {
      emit(held & 0xff);
      held >>>= 8;
      heldBits -= 8;
    }
    if (cleared) {
      bits = minCodeSize + 1;
      ceiling = (1 << bits) - 1;
      cleared = false;
    } else if (free > ceiling && bits < 12) {
      bits++;
      ceiling = bits === 12 ? TOP_CODE : (1 << bits) - 1;
    }
  };

  keys.fill(-1);
  put(clearCode);
  let run = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i];
    const key = (next << 12) + run;
    let slot = (next << 4) ^ run;
    if (keys[slot] === key) {
      run = codes[slot];
      continue;
    }
    if (keys[slot] >= 0) {
      const stride = slot === 0 ? 1 : HASH - slot;
      let found = false;
      do {
        slot -= stride;
        if (slot < 0) slot += HASH;
        if (keys[slot] === key) {
          run = codes[slot];
          found = true;
          break;
        }
      } while (keys[slot] >= 0);
      if (found) continue;
    }
    put(run);
    run = next;
    if (free < TOP_CODE) {
      codes[slot] = free++;
      keys[slot] = key;
    } else {
      // The flag is raised first so the width goes back to its narrowest at
      // the end of the clear code's own write, which is where the decoder
      // narrows its own.
      cleared = true;
      put(clearCode);
      keys.fill(-1);
      free = clearCode + 2;
    }
  }
  put(run);
  put(endCode);
  if (heldBits > 0) emit(held & 0xff);
}

// LZW output travels in blocks of at most 255 bytes, each behind its own
// length, and a zero length closes the run.
function blocks(indices, minCodeSize) {
  const out = [];
  let block = new Uint8Array(256);
  let at = 1;
  compress(indices, minCodeSize, (byte) => {
    block[at++] = byte;
    if (at === 256) {
      block[0] = 255;
      out.push(block);
      block = new Uint8Array(256);
      at = 1;
    }
  });
  if (at > 1) {
    block[0] = at - 1;
    out.push(block.subarray(0, at));
  }
  out.push(new Uint8Array([0]));
  return out;
}

// ---------- The file ----------

const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];

// A table holds a power of two entries, at least two, and the field naming its
// size counts the power rather than the entries.
const tablePower = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

export function createGif({ width, height, fps, dither: dithered = true, loop = true }) {
  const delay = gifDelay(fps);
  const parts = [
    ascii('GIF89a'),
    // No global table: every frame brings its own, so the screen descriptor
    // only says how big the picture is.
    Uint8Array.from([...le16(width), ...le16(height), 0x70, 0, 0]),
  ];
  if (loop) {
    parts.push(Uint8Array.from([0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0]));
  }
  const palette = new Palette();
  const indices = new Uint8Array(width * height);
  let bytes = parts.reduce((n, p) => n + p.length, 0);
  let frames = 0;
  let done = false;

  const keep = (part) => {
    parts.push(part);
    bytes += part.length;
  };

  return {
    get bytes() { return bytes; },
    get frames() { return frames; },

    add(rgba) {
      if (done) throw new Error('the GIF is already closed');
      const size = palette.build(rgba, MOST_COLOURS);
      if (dithered) dither(rgba, width, height, palette, indices);
      else map(rgba, palette, indices);

      const power = tablePower(size);
      const entries = 1 << power;
      const table = new Uint8Array(entries * 3);
      for (let i = 0; i < size; i++) {
        table[i * 3] = palette.r[i];
        table[i * 3 + 1] = palette.g[i];
        table[i * 3 + 2] = palette.b[i];
      }

      // Leave each frame on screen for the next to draw over: every frame here
      // is the whole picture and opaque, so nothing needs clearing between.
      keep(Uint8Array.from([0x21, 0xf9, 0x04, 0x04, ...le16(delay), 0, 0]));
      keep(Uint8Array.from([0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0x80 | (power - 1)]));
      keep(table);
      keep(Uint8Array.from([Math.max(2, power)]));
      for (const block of blocks(indices, Math.max(2, power))) keep(block);
      frames++;
    },

    finish() {
      if (!frames) throw new Error('no frames to write');
      done = true;
      keep(Uint8Array.from([0x3b]));
      return new Blob(parts, { type: 'image/gif' });
    },

    cancel() {
      done = true;
      parts.length = 0;
    },
  };
}
