import { FE_LIB } from './common.js';

// The square is taken of V = Re z − i|Im z|, which is z below the real axis and
// its conjugate above, so the map is the Mandelbrot's on one side and the
// Mandelbar's on the other.
export const PERP_SHIP = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = csq(vec2(z.x, -abs(z.y))) + c;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + viewPixel() * u_px;
  outColor = shade(escape(c));
}`;

// The delta is a square's, d ← (2V + v) v + dc, where v is the delta on V. Its
// real part is the delta's own, and its imaginary part is the Burning Ship's
// exact |Zi + di| − |Zi| negated, so nothing cancels.
export const PERP_PERT = `
float diffabs(float X, float x) {
  if (X >= 0.0) return X + x >= 0.0 ? x : -(2.0 * X + x);
  return X + x > 0.0 ? 2.0 * X + x : -x;
}

float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 v = vec2(d.x, -diffabs(Z.y, d.y));
    d = cmul(2.0 * vec2(Z.x, -abs(Z.y)) + v, v) + dc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (viewPixel() + u_offset) * u_px;
  outColor = shade(escape(dc));
}`;

export const PERP_FE = FE_LIB + `
float diffabsScaled(float X, float m, int e) {
  if (X == 0.0) return abs(m);
  int gap = (((floatBitsToInt(X) >> 23) & 255) - 127) - e;
  if (gap > 30) return X > 0.0 ? m : -m;
  float Xs = X * pow2(-e);
  if (X > 0.0) return Xs + m >= 0.0 ? m : -(2.0 * Xs + m);
  return Xs + m > 0.0 ? 2.0 * Xs + m : -m;
}

float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    FE v = FE(vec2(d.m.x, -diffabsScaled(Z.y, d.m.y, d.e)), d.e);
    vec2 t = 2.0 * vec2(Z.x, -abs(Z.y)) + feToFloat(v);
    d = feAdd(fe(cmul(t, v.m), v.e), dc);
    m++;
    FE z = feAdd(fe(refAt(min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 px = viewPixel() + u_offset;
  outColor = shade(escape(fe(px * u_pxm, u_pxe)));
}`;
