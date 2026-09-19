import { FE_LIB } from './common.js';

export const MANDELBROT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  vec2 Z0 = refAt(0).xy;
  vec2 Z = Z0;
  for (int n = 0; n < u_maxIter; n++) {
    d = cmul(2.0 * Z + d, d) + dc;
    m++;
    vec2 Zn = refAt(min(m, last)).xy;
    vec2 z = Zn + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; Z = Z0; } else { Z = Zn; }
  }
  return 0.0;
}

void main() {
  vec2 px = viewPixel();
  bool inside = inCardioidOrBulb(u_center + px * u_px);
  outColor = shade(inside ? 0.0 : escape((px + u_offset) * u_px));
}`;

export const MANDELBROT_FE = FE_LIB + `
float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  vec2 Z0 = refAt(0).xy;
  vec2 Z = Z0;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(cmul(t, d.m), d.e), dc);
    m++;
    vec2 Zn = refAt(min(m, last)).xy;
    FE z = feAdd(fe(Zn, 0), d);
    if (z.e >= 6) {
      float zz = dot(z.m, z.m) * pow2(2 * min(z.e, 60));
      if (zz > 1e4) return smoothT(n + 1, log(zz));
    }
    if (feLess(z, d) || m >= last) { d = z; m = 0; Z = Z0; } else { Z = Zn; }
  }
  return 0.0;
}

void main() {
  if (inCardioidOrBulb(u_center)) {
    outColor = shade(0.0);
    return;
  }
  vec2 px = viewPixel() + u_offset;
  outColor = shade(escape(fe(px * u_pxm, u_pxe)));
}`;
