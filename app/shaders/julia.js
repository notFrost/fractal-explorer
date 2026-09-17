import { FE_LIB } from './common.js';

export const JULIA = `
float escape(vec2 z) {
  for (int n = 0; n < u_maxIter; n++) {
    z = csq(z) + u_julia;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 z = u_center + viewPixel() * u_px;
  outColor = vec4(palette(escape(z)), 1.0);
}`;

export const JULIA_PERT = `
float escape(vec2 d0) {
  vec2 d = d0;
  int m = 0;
  bool crit = false;
  int split = u_ref2;
  int cLast = split - 1;
  int oLast = u_refLen - split - 1;
  for (int n = 0; n < u_maxIter; n++) {
    int base = crit ? 0 : split;
    vec2 Z = refAt(base + m).xy;
    d = cmul(2.0 * Z + d, d);
    m++;
    int last = crit ? cLast : oLast;
    vec2 z = refAt(base + min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; crit = true; }
  }
  return 0.0;
}

void main() {
  vec2 d0 = (viewPixel() + u_offset) * u_px;
  outColor = vec4(palette(escape(d0)), 1.0);
}`;

export const JULIA_FE = FE_LIB + `
float escape(FE d0) {
  FE d = d0;
  int m = 0;
  bool crit = false;
  int split = u_ref2;
  int cLast = split - 1;
  int oLast = u_refLen - split - 1;
  for (int n = 0; n < u_maxIter; n++) {
    int base = crit ? 0 : split;
    vec2 Z = refAt(base + m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = fe(cmul(t, d.m), d.e);
    m++;
    int last = crit ? cLast : oLast;
    FE z = feAdd(fe(refAt(base + min(m, last)).xy, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; crit = true; }
  }
  return 0.0;
}

void main() {
  vec2 px = viewPixel() + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;
