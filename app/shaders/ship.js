import { FE_LIB } from './common.js';

// Burning Ship as the original writes it: the imaginary part of c enters
// negated, which is z ← (|Re z| + i|Im z|)² + c̄. That conjugate is what stands
// the ship upright on a y-up stage, so it is kept rather than corrected.
export const BURNING_SHIP = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * abs(z.x) * abs(z.y) - c.y);
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

// Burning Ship by perturbation. The absolute values are the whole difficulty:
// |Z + d| − |Z| cannot be formed by subtracting two nearly equal floats, so it
// is taken by cases instead (the "diffabs" trick), which is exact. Write that
// difference for both parts as w, so the pixel's absolute value is exactly
// |Z| + w. Expanding the square then collapses to Mandelbrot's own shape:
//   d' = (2 |Z| + w) w + c̄ − C̄
// with the conjugate negating the imaginary offset. Z_0 = 0 as in Mandelbrot,
// so a rebase is d = z, m = 0.
export const SHIP_PERT = `
float diffabs(float X, float x) {
  if (X >= 0.0) return X + x >= 0.0 ? x : -(2.0 * X + x);
  return X + x > 0.0 ? 2.0 * X + x : -x;
}

float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  vec2 dcc = vec2(dc.x, -dc.y);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 w = vec2(diffabs(Z.x, d.x), diffabs(Z.y, d.y));
    d = cmul(2.0 * abs(Z) + w, w) + dcc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;

// The same recurrence with floatexp deltas. diffabs keeps the delta's own
// scale: a delta far below the reference component cannot reach past zero, so
// the sign of that component alone decides and the answer is ±x exactly.
// Otherwise the reference component is brought into the delta's scale, where
// it is at most 2^30 times the mantissa, and the cases are taken in float32.
export const SHIP_FE = FE_LIB + `
float diffabsScaled(float X, float m, int e) {
  if (X == 0.0) return abs(m);
  int gap = (((floatBitsToInt(X) >> 23) & 255) - 127) - e;   // log2|X| − e
  if (gap > 30) return X > 0.0 ? m : -m;
  float Xs = X * pow2(-e);
  if (X > 0.0) return Xs + m >= 0.0 ? m : -(2.0 * Xs + m);
  return Xs + m > 0.0 ? 2.0 * Xs + m : -m;
}

float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  FE dcc = FE(vec2(dc.m.x, -dc.m.y), dc.e);   // + c̄
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    FE w = FE(vec2(diffabsScaled(Z.x, d.m.x, d.e), diffabsScaled(Z.y, d.m.y, d.e)), d.e);
    vec2 t = 2.0 * abs(Z) + feToFloat(w);
    d = feAdd(fe(cmul(t, w.m), w.e), dcc);
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
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;
