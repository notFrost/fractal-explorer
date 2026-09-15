import { FE_LIB } from './common.js';

// Julia: the same z² + C, but C is fixed and the pixel supplies z_0.
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
  vec2 z = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(z)), 1.0);
}`;

// Julia by perturbation. C is the same for every pixel, so the delta has no dc
// term: d ← (2Z + d) d, starting from the pixel's offset from the reference
// centre. The cancellation in that product happens when Z ≈ −d/2, that is when
// |z| ≈ |d| / 2 — the pixel's orbit passing closer to the origin than its own
// delta. Rebasing onto the centre orbit's start would be no help, since its
// Z_0 is the view centre rather than zero, so the texture carries a second
// orbit: the critical one, Z_0 = 0, at texels [0, u_ref2). A pixel rides the
// centre orbit at [u_ref2, u_refLen) until that first cancellation (or until
// the orbit runs out), then sets d = z and follows the critical orbit with
// Mandelbrot's rebasing, which is exact there because the orbit starts at 0.
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
  vec2 d0 = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
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
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;
