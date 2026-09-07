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

// ---------- Mandelbrot reference orbit ----------

// Double-precision orbit for shallow zooms. Writes (re, im) pairs into out.
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
    out[2 * n] = zr;
    out[2 * n + 1] = zi;
    n++;
    if (zr * zr + zi * zi > 1e10) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi };
}

// Fixed-point orbit. `cont` resumes a previous unescaped orbit.
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
    out[2 * n] = Number(zr >> shift) / div;
    out[2 * n + 1] = Number(zi >> shift) / div;
    n++;
    if (zr * zr + zi * zi > bail) return { len: n, escaped: true };
  }
  return { len: n, escaped: false, zr, zi };
}
