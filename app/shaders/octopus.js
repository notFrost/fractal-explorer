import { FE_LIB } from './common.js';

export const OCTOPUS = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    vec2 w = vec2(z.x + c.y, abs(z.y) - c.x);
    z = csq(w) + c;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + viewPixel() * u_px;
  outColor = shade(escape(c));
}`;

// The texel carries W = (Re Z + Im C, |Im Z| − Re C) beside Z, since C itself
// never reaches the shader and W is what the square is taken of.
export const OCTOPUS_PERT = `
float diffabs(float X, float x) {
  if (X >= 0.0) return X + x >= 0.0 ? x : -(2.0 * X + x);
  return X + x > 0.0 ? 2.0 * X + x : -x;
}

float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R0 = refAt(0);
  vec4 R = R0;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 w = vec2(d.x + dc.y, diffabs(R.y, d.y) - dc.x);
    d = cmul(2.0 * R.zw + w, w) + dc;
    m++;
    vec4 Rn = refAt(min(m, last));
    vec2 z = Rn.xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; R = R0; } else { R = Rn; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (viewPixel() + u_offset) * u_px;
  outColor = shade(escape(dc));
}`;

export const OCTOPUS_FE = FE_LIB + `
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
  // dc enters w turned a quarter and negated, since Im c feeds the real part
  // of the square and Re c is taken off its imaginary part.
  FE dq = FE(vec2(dc.m.y, -dc.m.x), dc.e);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R0 = refAt(0);
  vec4 R = R0;
  for (int n = 0; n < u_maxIter; n++) {
    FE w = feAdd(FE(vec2(d.m.x, diffabsScaled(R.y, d.m.y, d.e)), d.e), dq);
    vec2 t = 2.0 * R.zw + feToFloat(w);
    d = feAdd(fe(cmul(t, w.m), w.e), dc);
    m++;
    vec4 Rn = refAt(min(m, last));
    FE z = feAdd(fe(Rn.xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; R = R0; } else { R = Rn; }
  }
  return 0.0;
}

void main() {
  vec2 px = viewPixel() + u_offset;
  outColor = shade(escape(fe(px * u_pxm, u_pxe)));
}`;
