import { FE_LIB } from './common.js';

// Perturbation with rebasing. Pixel = reference + delta.
// delta_{n+1} = (2 Z_n + delta_n) delta_n + dc. When the pixel's orbit passes
// closer to the origin than its delta, restart against the reference's start.
export const MANDELBROT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    d = cmul(2.0 * Z + d, d) + dc;
    m++;
    vec2 z = refAt(min(m, last)).xy + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res;
  if (inCardioidOrBulb(u_center + px * u_px)) {
    outColor = vec4(palette(0.0), 1.0);
    return;
  }
  outColor = vec4(palette(escape((px + u_offset) * u_px)), 1.0);
}`;

// Same algorithm with the delta carried as mantissa × 2^exponent so it can be
// far below float32 range. The reference stays plain float32 since |Z| ≤ 1e5.
export const MANDELBROT_FE = FE_LIB + `
float escape(FE dc) {
  FE d = FE(vec2(0.0), EMIN);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    vec2 t = 2.0 * Z + feToFloat(d);
    d = feAdd(fe(cmul(t, d.m), d.e), dc);
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
  if (inCardioidOrBulb(u_center)) {
    outColor = vec4(palette(0.0), 1.0);
    return;
  }
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;
