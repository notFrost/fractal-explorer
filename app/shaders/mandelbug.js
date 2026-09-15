import { FE_LIB } from './common.js';

export const MANDELBUG = `
float escape(vec2 c) {
  vec2 z = vec2(0.0);
  for (int n = 0; n < u_maxIter; n++) {
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * (z.x + z.y) + c.y);
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
  }
  return 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

export const BUG_PERT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + d;
    d = vec2(t.x * d.x - t.y * d.y, 2.0 * (d.x + d.y)) + dc;
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

export const BUG_FE = FE_LIB + `
float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(vec2(t.x * d.m.x - t.y * d.m.y, 2.0 * (d.m.x + d.m.y)), d.e), dc);
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
