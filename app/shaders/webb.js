import { FE_LIB } from './common.js';

export const WEBB = `
float escape(vec2 c) {
  vec2 p = vec2(0.0);
  vec2 z = c;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 nz = csq(z) + p;
    p = z;
    z = nz;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + viewPixel() * u_px;
  outColor = shade(escape(c));
}`;
export const WEBB_PERT = `
float escape(vec2 dc) {
  vec2 d = dc;
  vec2 e = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R = refAt(0);
  vec2 P = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    vec2 nd = cmul(2.0 * R.xy + d, d) + e;
    e = d;
    d = nd;
    m++;
    P = R.xy;
    R = refAt(m);
    vec2 z = R.xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    vec2 w = R.zw + d;
    vec2 p = P + e;
    if (dot(w, w) + dot(p, p) < dot(d, d) + dot(e, e) || m >= last) {
      d = w;
      e = p;
      m = 0;
      R = refAt(0);
      P = vec2(0.0);
    }
  }
  return 0.0;
}

void main() {
  vec2 dc = (viewPixel() + u_offset) * u_px;
  outColor = shade(escape(dc));
}`;

export const WEBB_FE = FE_LIB + `
float escape(FE dc) {
  FE d = dc;
  FE e = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  vec4 R = refAt(0);
  vec2 P = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    vec2 t = 2.0 * R.xy + feToFloat(d);
    FE nd = feAdd(fe(cmul(t, d.m), d.e), e);
    e = d;
    d = nd;
    m++;
    P = R.xy;
    R = refAt(m);
    FE z = feAdd(fe(R.xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    FE w = feAdd(fe(R.zw, 0), d);
    FE p = feAdd(fe(P, 0), e);
    if (feLess(feAdd(feMag2(w), feMag2(p)), feAdd(feMag2(d), feMag2(e))) || m >= last) {
      d = w;
      e = p;
      m = 0;
      R = refAt(0);
      P = vec2(0.0);
    }
  }
  return 0.0;
}

void main() {
  vec2 px = viewPixel() + u_offset;
  outColor = shade(escape(fe(px * u_pxm, u_pxe)));
}`;
