// Fixed-point BigInt arithmetic for the camera and the Mandelbrot reference
// orbit. A value v is stored as BigInt(round(v * 2^bits)).

const B60 = 2 ** 60;

// Bits of precision needed at a given zoom: pixel resolution plus a margin so
// float32 pixel deltas (24-bit mantissa) and rebasing stay accurate.
export function bitsFor(log2zoom) {
  return Math.max(64, Math.ceil(log2zoom) + 64);
}

export function fromDouble(v, bits) {
  if (!Number.isFinite(v)) return 0n;
  if (bits <= 52) return BigInt(Math.round(v * 2 ** bits));
  return BigInt(Math.round(v * 2 ** 52)) << BigInt(bits - 52);
}

// Approximate double from a fixed-point value; keeps the top 60 bits.
export function toDouble(b, bits) {
  if (bits <= 60) return Number(b) / 2 ** bits;
  return Number(b >> BigInt(bits - 60)) / B60;
}

export function rescale(b, fromBits, toBits) {
  if (toBits === fromBits) return b;
  return toBits > fromBits ? b << BigInt(toBits - fromBits) : b >> BigInt(fromBits - toBits);
}

// k × 2^e as a fixed-point BigInt at `bits`, for non-integer e ≥ 0 (e = bits - log2zoom).
export function scaledStep(k, e, bits) {
  if (k === 0) return 0n;
  const f = Math.floor(e);
  const r = k * 2 ** (e - f);
  if (f >= 52) return BigInt(Math.round(r * 2 ** 52)) << BigInt(f - 52);
  return BigInt(Math.round(r * 2 ** f));
}

export function toDecimal(b, bits, digits) {
  const neg = b < 0n;
  const a = neg ? -b : b;
  const B = BigInt(bits);
  const int = a >> B;
  const frac = a - (int << B);
  const scaled = (frac * 10n ** BigInt(digits) + (1n << (B - 1n))) >> B;
  let s = scaled.toString().padStart(digits, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${s ? '.' + s : ''}`;
}

export function parseDecimal(str, bits) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str.trim());
  if (!m) {
    const v = Number(str);
    return Number.isFinite(v) ? fromDouble(v, bits) : null;
  }
  const B = BigInt(bits);
  const frac = m[3] || '';
  let v = BigInt(m[2]) << B;
  if (frac) v += (BigInt(frac) << B) / 10n ** BigInt(frac.length);
  return m[1] ? -v : v;
}

// Camera: centre in fixed point, zoom as log2 (double, unbounded).
export class Camera {
  constructor(x = 0, y = 0, zoom = 100) {
    this.lz = Math.log2(zoom);
    this.bits = bitsFor(this.lz);
    this.x = typeof x === 'bigint' ? x : fromDouble(x, this.bits);
    this.y = typeof y === 'bigint' ? y : fromDouble(y, this.bits);
  }

  static fromStrings(xs, ys, zoomStr) {
    let lz;
    const p = /^2\^(-?[\d.]+)$/.exec(zoomStr);
    if (p) lz = Number(p[1]);
    else {
      const z = Number(zoomStr);
      if (!(z > 0)) return null;
      lz = Math.log2(z);
    }
    return Camera.fromDecimal(xs, ys, lz);
  }

  // Centre from decimal strings at a given log2 zoom. Null if either fails to parse.
  static fromDecimal(xs, ys, lz) {
    if (!Number.isFinite(lz)) return null;
    const bits = bitsFor(lz);
    const x = parseDecimal(xs, bits);
    const y = parseDecimal(ys, bits);
    if (x === null || y === null) return null;
    const c = new Camera(0, 0, 1);
    c.lz = lz;
    c.bits = bits;
    c.x = x;
    c.y = y;
    return c;
  }

  get zoom() { return 2 ** this.lz; }

  clone() {
    const c = new Camera(0, 0, 1);
    c.lz = this.lz;
    c.bits = this.bits;
    c.x = this.x;
    c.y = this.y;
    return c;
  }

  setLogZoom(lz) {
    const nb = bitsFor(lz);
    if (nb !== this.bits) {
      this.x = rescale(this.x, this.bits, nb);
      this.y = rescale(this.y, this.bits, nb);
      this.bits = nb;
    }
    this.lz = lz;
  }

  // Offset of k stage pixels in world units at the current zoom.
  step(k) {
    return scaledStep(k, this.bits - this.lz, this.bits);
  }

  pan(kx, ky) {
    this.x += this.step(kx);
    this.y += this.step(ky);
  }

  // Zoom by dlz keeping the world point sx, sy stage pixels from centre fixed.
  zoomAt(sx, sy, dlz) {
    const oldBits = this.bits;
    let bx = this.step(sx);
    let by = this.step(sy);
    this.setLogZoom(this.lz + dlz);
    bx = rescale(bx, oldBits, this.bits);
    by = rescale(by, oldBits, this.bits);
    this.x += bx - this.step(sx);
    this.y += by - this.step(sy);
  }

  // Stage-pixel offset of this centre from another camera's centre, at this zoom.
  offsetFrom(o) {
    const dx = this.x - rescale(o.x, o.bits, this.bits);
    const dy = this.y - rescale(o.y, o.bits, this.bits);
    const f = Math.floor(this.lz);
    const shift = this.bits - f - 60;
    const s = 2 ** (this.lz - f) / B60;
    const conv = (d) => Number(shift > 0 ? d >> BigInt(shift) : d << BigInt(-shift)) * s;
    return { x: conv(dx), y: conv(dy) };
  }

  xDouble() { return toDouble(this.x, this.bits); }
  yDouble() { return toDouble(this.y, this.bits); }

  digits() { return Math.ceil(this.bits * 0.30103) + 2; }
  xString() { return toDecimal(this.x, this.bits, this.digits()); }
  yString() { return toDecimal(this.y, this.bits, this.digits()); }
  zoomString() {
    if (this.lz >= 1000) return `2^${this.lz.toFixed(3)}`;
    return this.zoom.toExponential(5).replace(/\.?0+e/, 'e');
  }
}

// ---------- Reference orbits ----------
//
// Every orbit writes one RGBA32F texel per step into `out` (four floats). The
// first two channels are always Z_n; what the other two hold depends on the set.
// `cont` resumes an unescaped orbit where a previous call stopped.

const STRIDE = 4;

// Mandelbrot in double precision for shallow zooms. Texel: (Z, 0, 0).
export function referenceOrbitDouble(cx, cy, maxIter, out) {
  let zr = 0;
  let zi = 0;
  out[0] = 0;
  out[1] = 0;
  let n = 1;
  for (let i = 0; i < maxIter; i++) {
    const nr = zr * zr - zi * zi + cx;
    zi = 2 * zr * zi + cy;
    zr = nr;
    out[STRIDE * n] = zr;
    out[STRIDE * n + 1] = zi;
    n++;
    if (zr * zr + zi * zi > 1e10) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi };
}

// Mandelbrot in fixed point.
export function referenceOrbitBig(cx, cy, bits, maxIter, out, cont = null) {
  const B = BigInt(bits);
  const bail = 10_000_000_000n << (2n * B);
  let zr = cont ? cont.zr : 0n;
  let zi = cont ? cont.zi : 0n;
  let n = cont ? cont.len : 1;
  if (!cont) {
    out[0] = 0;
    out[1] = 0;
  }
  const shift = bits > 60 ? BigInt(bits - 60) : 0n;
  const div = bits > 60 ? B60 : 2 ** bits;
  while (n < maxIter + 1) {
    const rr = zr * zr;
    const ii = zi * zi;
    const nr = ((rr - ii) >> B) + cx;
    zi = ((zr * zi) >> (B - 1n)) + cy;
    zr = nr;
    out[STRIDE * n] = Number(zr >> shift) / div;
    out[STRIDE * n + 1] = Number(zi >> shift) / div;
    n++;
    if (zr * zr + zi * zi > bail) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi };
}

// Webb: z_{n+1} = z_n² + z_{n-1} with z_0 = c, z_{-1} = 0. Texel: (Z_n, Z_n − Z_0).
// The offset from the start is stored at full precision so that rebasing a
// pixel onto the start of the reference does not go through a float32
// subtraction of two nearly equal values.
export function webbOrbitDouble(cx, cy, maxIter, out) {
  let zr = cx;
  let zi = cy;
  let pr = 0;
  let pi = 0;
  out[0] = cx;
  out[1] = cy;
  out[2] = 0;
  out[3] = 0;
  let n = 1;
  for (let i = 0; i < maxIter; i++) {
    const nr = zr * zr - zi * zi + pr;
    const ni = 2 * zr * zi + pi;
    pr = zr;
    pi = zi;
    zr = nr;
    zi = ni;
    out[STRIDE * n] = zr;
    out[STRIDE * n + 1] = zi;
    out[STRIDE * n + 2] = zr - cx;
    out[STRIDE * n + 3] = zi - cy;
    n++;
    if (zr * zr + zi * zi > 1e10) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi, pr, pi };
}

export function webbOrbitBig(cx, cy, bits, maxIter, out, cont = null) {
  const B = BigInt(bits);
  const bail = 10_000_000_000n << (2n * B);
  const shift = bits > 60 ? BigInt(bits - 60) : 0n;
  const div = bits > 60 ? B60 : 2 ** bits;
  const f = (v) => Number(v >> shift) / div;
  let zr = cont ? cont.zr : cx;
  let zi = cont ? cont.zi : cy;
  let pr = cont ? cont.pr : 0n;
  let pi = cont ? cont.pi : 0n;
  let n = cont ? cont.len : 1;
  if (!cont) {
    out[0] = f(cx);
    out[1] = f(cy);
    out[2] = 0;
    out[3] = 0;
  }
  while (n < maxIter + 1) {
    const nr = ((zr * zr - zi * zi) >> B) + pr;
    const ni = ((zr * zi) >> (B - 1n)) + pi;
    pr = zr;
    pi = zi;
    zr = nr;
    zi = ni;
    out[STRIDE * n] = f(zr);
    out[STRIDE * n + 1] = f(zi);
    out[STRIDE * n + 2] = f(zr - cx);
    out[STRIDE * n + 3] = f(zi - cy);
    n++;
    if (zr * zr + zi * zi > bail) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi, pr, pi };
}

// Collatz: z ← 3z + 1 when floor|z| is odd, z / 2 when even. Both branches are
// affine, so 3z + 1 is exact in fixed point and z / 2 drops one bit. Two texels
// per step: (Z, log2 lo, log2 hi) and (parity, 0, 0, 0), where lo and hi are the
// distances from |Z| down to floor|Z| and up to ceil|Z|: the two radii at which
// a nearby pixel's parity differs from the reference's. They are stored as
// log2 so values far below float32 range survive the trip to the GPU.
//
// Two float32 habits of the direct shader are kept so the tiers agree: above
// 2^24 every float is an even integer, so the parity reads 0; between 2^23 and
// 2^24 the length rounds to the nearest integer before the floor.
const COLLATZ_STEPS = 500;
const LOG_INF = 1e6;

function isqrt(v) {
  if (v < 2n) return v;
  let x = 1n << BigInt((v.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + v / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// log2 of a fixed-point value; -LOG_INF for zero.
function log2Fixed(v, bits) {
  if (v <= 0n) return -LOG_INF;
  const bl = v.toString(2).length;
  const top = bl > 53 ? Number(v >> BigInt(bl - 53)) : Number(v) * 2 ** (53 - bl);
  return Math.log2(top) + (bl - 53) - bits;
}

export function collatzOrbitBig(cx, cy, bits, maxIter, out) {
  const B = BigInt(bits);
  const one = 1n << B;
  const half = one >> 1n;
  const overflow = 1_000_000_000_000_000n << B;   // |Z| ≥ 1e15, i.e. |Z|² ≥ 1e30
  const evenOnly = 1n << (B + 24n);
  const roundBand = 1n << (B + 23n);
  const shift = bits > 60 ? BigInt(bits - 60) : 0n;
  const div = bits > 60 ? B60 : 2 ** bits;
  const f = (v) => Number(v >> shift) / div;
  const steps = Math.min(maxIter, COLLATZ_STEPS);
  let zr = cx;
  let zi = cy;
  let n = 0;
  for (;;) {
    const r = isqrt(zr * zr + zi * zi);
    let parity;
    let lo;
    let hi;
    if (r >= evenOnly) {
      parity = 0;
      lo = -1n;
      hi = -1n;
    } else {
      const round = r >= roundBand;
      const k = (round ? r + half : r) >> B;
      parity = Number(k & 1n);
      // In the rounding band the boundaries sit at half-integers.
      lo = r - (k << B) + (round ? half : 0n);
      hi = one - lo;
    }
    const o = 2 * STRIDE * n;
    out[o] = f(zr);
    out[o + 1] = f(zi);
    out[o + 2] = lo < 0n ? LOG_INF : log2Fixed(lo, bits);
    out[o + 3] = hi < 0n ? LOG_INF : log2Fixed(hi, bits);
    out[o + 4] = parity;
    n++;
    if (r >= overflow) return { len: n, escaped: true };
    if (n > steps) return { len: n, escaped: false };
    if (parity) {
      zr = 3n * zr + one;
      zi = 3n * zi;
    } else {
      zr >>= 1n;
      zi >>= 1n;
    }
  }
}

// Per-set orbit functions, texels per step, and the iteration count a budget
// maps to (Collatz colours after two steps and gives up after 500).
export const ORBITS = {
  mandelbrot: { double: referenceOrbitDouble, big: referenceOrbitBig, stride: 1, iters: (n) => n },
  webb: { double: webbOrbitDouble, big: webbOrbitBig, stride: 1, iters: (n) => n },
  collatz: { double: null, big: collatzOrbitBig, stride: 2, iters: (n) => Math.min(n, COLLATZ_STEPS) },
};
