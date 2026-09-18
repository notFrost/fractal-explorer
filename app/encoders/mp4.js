// H.264 in an MP4, from WebCodecs and the boxes below.
//
// The browser encodes; nothing here touches a pixel. What it does is write the
// container: an ftyp, one mdat holding every sample end to end, and a moov
// describing them. The moov goes last because its sample table needs sizes and
// offsets that are not known until the last frame is in, and a player reads
// the file whole rather than streaming it.

const BRANDS = ['isom', 'iso2', 'avc1', 'mp41'];

// 90 kHz is the usual film and video timebase, and every frame rate the
// exporter offers divides it exactly, so no frame is a tick long or short.
const TIMESCALE = 90000;

// The identity matrix in 16.16 and 2.30, which is how tkhd and mvhd write "no
// rotation, no scale".
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

const U32_MAX = 0xffffffff;

export const canEncodeMp4 = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

// ---------- Bytes ----------

class Writer {
  constructor(size = 4096) {
    this.buf = new Uint8Array(size);
    this.at = 0;
  }

  room(n) {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
  }

  u8(v) {
    this.room(1);
    this.buf[this.at++] = v & 0xff;
    return this;
  }

  u16(v) {
    return this.u8(v >>> 8).u8(v);
  }

  u32(v) {
    return this.u16(v >>> 16).u16(v & 0xffff);
  }

  u64(v) {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0);
  }

  ascii(s) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
    return this;
  }

  zeros(n) {
    this.room(n);
    this.at += n;
    return this;
  }

  bytes(a) {
    this.room(a.length);
    this.buf.set(a, this.at);
    this.at += a.length;
    return this;
  }

  each(list, write) {
    for (const item of list) write(this, item);
    return this;
  }

  // A box's size is its own header plus everything inside it, so it is left
  // blank on the way in and filled in on the way out.
  open(type) {
    const at = this.at;
    this.u32(0).ascii(type);
    return at;
  }

  close(at) {
    const size = this.at - at;
    this.buf[at] = (size >>> 24) & 0xff;
    this.buf[at + 1] = (size >>> 16) & 0xff;
    this.buf[at + 2] = (size >>> 8) & 0xff;
    this.buf[at + 3] = size & 0xff;
    return this;
  }

  box(type, fill) {
    const at = this.open(type);
    fill(this);
    return this.close(at);
  }

  // A box whose first four bytes are a version and three flag bytes.
  full(type, version, flags, fill) {
    return this.box(type, (w) => {
      w.u32(((version & 0xff) << 24) | (flags & 0xffffff));
      fill(w);
    });
  }

  done() {
    return this.buf.subarray(0, this.at);
  }
}

// ---------- The header ----------

function ftyp() {
  return new Writer(64).box('ftyp', (w) => {
    w.ascii('isom').u32(512).each(BRANDS, (x, b) => x.ascii(b));
  }).done();
}

// Consecutive samples sharing a value, which is how stts and ctts are written.
function runs(values) {
  const out = [];
  for (const value of values) {
    const last = out[out.length - 1];
    if (last && last.value === value) last.count++;
    else out.push({ count: 1, value });
  }
  return out;
}

function avcSampleEntry(w, { width, height, description }) {
  w.box('avc1', (x) => {
    x.zeros(6).u16(1);
    x.u16(0).u16(0).zeros(12);
    x.u16(width).u16(height);
    // 72 dpi in 16.16, which every muxer writes and no player reads.
    x.u32(0x00480000).u32(0x00480000);
    x.u32(0).u16(1);
    // A 32-byte Pascal string for the encoder's name, left empty.
    x.zeros(32);
    x.u16(0x0018).u16(0xffff);
    x.box('avcC', (c) => c.bytes(description));
  });
}

function sampleTable(w, { width, height, description, sizes, delta, sync, offsets, dataStart }) {
  w.box('stbl', (x) => {
    x.full('stsd', 0, 0, (s) => {
      s.u32(1);
      avcSampleEntry(s, { width, height, description });
    });
    x.full('stts', 0, 0, (s) => {
      s.u32(1).u32(sizes.length).u32(delta);
    });
    if (sync.length && sync.length < sizes.length) {
      x.full('stss', 0, 0, (s) => {
        s.u32(sync.length).each(sync, (q, n) => q.u32(n));
      });
    }
    // A frame the encoder reordered is shown later than it is decoded, and the
    // gap between the two is what ctts carries. An encoder that reorders
    // nothing leaves the box out.
    if (offsets.some((o) => o !== 0)) {
      const list = runs(offsets);
      x.full('ctts', 0, 0, (s) => {
        s.u32(list.length).each(list, (q, r) => q.u32(r.count).u32(r.value));
      });
    }
    x.full('stsc', 0, 0, (s) => {
      s.u32(1).u32(1).u32(sizes.length).u32(1);
    });
    x.full('stsz', 0, 0, (s) => {
      s.u32(0).u32(sizes.length).each(sizes, (q, n) => q.u32(n));
    });
    // Every sample sits in one chunk, so there is one offset and it is the
    // start of the mdat payload. A file past 4 GiB still fits: the offset is
    // near the top of it, and sizes carry the rest.
    if (dataStart > U32_MAX) {
      x.full('co64', 0, 0, (s) => s.u32(1).u64(dataStart));
    } else {
      x.full('stco', 0, 0, (s) => s.u32(1).u32(dataStart));
    }
  });
}

function moov(track) {
  const { width, height, duration } = track;
  const w = new Writer(1024 + track.sizes.length * 8);
  w.box('moov', (m) => {
    m.full('mvhd', 0, 0, (x) => {
      x.u32(0).u32(0).u32(TIMESCALE).u32(duration);
      x.u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0);
      x.each(MATRIX, (q, v) => q.u32(v)).zeros(24).u32(2);
    });
    m.box('trak', (t) => {
      // enabled, in the movie, in the preview.
      t.full('tkhd', 0, 7, (x) => {
        x.u32(0).u32(0).u32(1).u32(0).u32(duration).u32(0).u32(0);
        x.u16(0).u16(0).u16(0).u16(0);
        x.each(MATRIX, (q, v) => q.u32(v));
        x.u32(width * 0x10000).u32(height * 0x10000);
      });
      t.box('mdia', (d) => {
        d.full('mdhd', 0, 0, (x) => {
          // 0x55c4 is 'und' packed five bits to the letter.
          x.u32(0).u32(0).u32(TIMESCALE).u32(duration).u16(0x55c4).u16(0);
        });
        d.full('hdlr', 0, 0, (x) => {
          x.u32(0).ascii('vide').zeros(12).ascii('VideoHandler').u8(0);
        });
        d.box('minf', (f) => {
          f.full('vmhd', 0, 1, (x) => x.u16(0).u16(0).u16(0).u16(0));
          f.box('dinf', (i) => {
            i.full('dref', 0, 0, (x) => {
              // One entry, flagged self-contained, so it names no file.
              x.u32(1).full('url ', 0, 1, () => {});
            });
          });
          sampleTable(f, track);
        });
      });
    });
  });
  return w.done();
}

// ---------- Choosing a codec ----------

// Each level caps the frame in macroblocks and the stream in macroblocks a
// second. The smallest that fits is the one to ask for: too low is refused,
// and too high tells a decoder to reserve more than the stream needs.
const LEVELS = [
  { idc: 0x1e, frame: 1620, rate: 40500 },
  { idc: 0x1f, frame: 3600, rate: 108000 },
  { idc: 0x20, frame: 5120, rate: 216000 },
  { idc: 0x28, frame: 8192, rate: 245760 },
  { idc: 0x2a, frame: 8704, rate: 522240 },
  { idc: 0x32, frame: 22080, rate: 589824 },
  { idc: 0x33, frame: 36864, rate: 983040 },
  { idc: 0x34, frame: 36864, rate: 2073600 },
  { idc: 0x3c, frame: 139264, rate: 4177920 },
  { idc: 0x3e, frame: 139264, rate: 16711680 },
];

// High, then Main, then Constrained Baseline: the first is the best picture
// per bit, and the others are there for a machine whose encoder has only them.
const PROFILES = [[0x64, 0x00], [0x4d, 0x40], [0x42, 0xe0]];

const hex2 = (v) => v.toString(16).padStart(2, '0');

function codecStrings(width, height, fps) {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const fits = LEVELS.find((l) => l.frame >= blocks && l.rate >= blocks * fps);
  const levels = [...new Set([fits?.idc, LEVELS[LEVELS.length - 1].idc].filter((v) => v !== undefined))];
  const out = [];
  for (const [profile, constraints] of PROFILES) {
    for (const level of levels) out.push(`avc1.${hex2(profile)}${hex2(constraints)}${hex2(level)}`);
  }
  return out;
}

async function pickConfig(base, width, height, fps) {
  const codecs = codecStrings(width, height, fps);
  // The rate mode and the latency hint are preferences rather than
  // requirements, so a machine that has neither is asked again without them
  // before the export is called off.
  const { bitrateMode, latencyMode, ...plain } = base;
  let refusal = null;
  for (const variant of [base, plain]) {
    for (const codec of codecs) {
      const config = { ...variant, codec };
      try {
        const { supported } = await VideoEncoder.isConfigSupported(config);
        if (supported) return config;
      } catch (err) {
        refusal = err;
      }
    }
  }
  throw new Error(refusal
    ? `this browser refused every H.264 setting: ${refusal.message}`
    : `this browser encodes no H.264 at ${width}×${height}`);
}

// ---------- The encoder ----------

// H.264 codes in 16×16 blocks and chroma is sampled two pixels at a time, so
// an odd side is either padded or refused depending on the encoder. Rounding
// down keeps the picture whole either way.
export const evenSide = (n) => Math.max(2, Math.floor(n / 2) * 2);

export async function createMp4({ width, height, fps, bitrate, gopSeconds = 2 }) {
  const delta = Math.round(TIMESCALE / fps);
  const config = await pickConfig({
    width,
    height,
    bitrate: Math.round(bitrate),
    framerate: fps,
    bitrateMode: 'variable',
    latencyMode: 'quality',
    // Length-prefixed NAL units with the parameter sets handed over on the
    // side, which is what an avcC box holds.
    avc: { format: 'avc' },
  }, width, height, fps);

  const chunks = [];
  const sizes = [];
  const sync = [];
  const times = [];
  let description = null;
  let failure = null;
  let bytes = 0;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !description) {
        description = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push(data);
      sizes.push(data.length);
      times.push(chunk.timestamp);
      if (chunk.type === 'key') sync.push(sizes.length);
      bytes += data.length;
    },
    error: (err) => { failure = err; },
  });
  encoder.configure(config);

  const gop = Math.max(1, Math.round(fps * gopSeconds));
  const microsPerFrame = 1e6 / fps;
  let closed = false;

  const check = () => {
    if (failure) throw new Error(`the encoder stopped: ${failure.message}`);
  };

  return {
    get bytes() { return bytes; },

    async add(source, index) {
      check();
      const frame = new VideoFrame(source, {
        timestamp: Math.round(index * microsPerFrame),
        duration: Math.round(microsPerFrame),
      });
      try {
        encoder.encode(frame, { keyFrame: index % gop === 0 });
      } finally {
        frame.close();
      }
      // The encoder runs on its own thread and a frame takes far longer to
      // draw than to code, so this queue only fills on a machine where it is
      // the drawing that is cheap.
      while (encoder.encodeQueueSize > 8 && !failure) {
        await new Promise((r) => setTimeout(r, 4));
      }
      check();
    },

    async finish() {
      check();
      await encoder.flush();
      encoder.close();
      closed = true;
      check();
      if (!description) throw new Error('the encoder gave no H.264 parameter sets');
      if (!sizes.length) throw new Error('the encoder produced no frames');

      // A reordered frame is shown after the one that follows it in the file,
      // and ctts holds the gap. Version 0 of that box counts forward only, so
      // the whole track slides up by the largest lead instead.
      const raw = times.map((t, i) => Math.round((t * TIMESCALE) / 1e6) - i * delta);
      const lift = Math.max(0, -Math.min(...raw));
      const offsets = raw.map((o) => o + lift);

      const payload = sizes.reduce((sum, n) => sum + n, 0);
      const head = ftyp();
      const large = payload + 8 > U32_MAX;
      const mdat = new Writer(16);
      if (large) mdat.u32(1).ascii('mdat').u64(payload + 16);
      else mdat.u32(payload + 8).ascii('mdat');
      const dataStart = head.length + mdat.at;

      const tail = moov({
        width,
        height,
        duration: sizes.length * delta,
        description,
        sizes,
        delta,
        sync,
        offsets,
        dataStart,
      });
      return new Blob([head, mdat.done(), ...chunks, tail], { type: 'video/mp4' });
    },

    cancel() {
      if (closed) return;
      closed = true;
      try { encoder.close(); } catch { /* already stopped */ }
    },
  };
}
