import { FE_LIB } from './common.js';

export const COLLATZ = `
vec2 step_(vec2 z) {
  float parity = mod(floor(length(z)), 2.0);
  return parity > 0.5 ? vec2(3.0 * z.x + 1.0, 3.0 * z.y) : z * 0.5;
}

float escape(vec2 c) {
  vec2 z = step_(step_(c));
  float m2 = dot(z, z);
  float l = log2(0.5 * log(m2));
  if (isnan(l) || isinf(l)) l = 0.0;
  float fallback = min(m2 + 1.0 - l, 1e5);
  int steps = min(u_maxIter, 500) - 2;
  for (int n = 0; n < steps; n++) {
    z = step_(z);
    if (!(dot(z, z) < 1e30)) break;   // overflowed: parity is 0 forever after
  }
  return dot(z, z) > 25.0 ? fallback : 0.0;
}

void main() {
  vec2 c = u_center + (gl_FragCoord.xy - 0.5 * u_res) * u_px;
  outColor = vec4(palette(escape(c)), 1.0);
}`;

export const COLLATZ_PERT = FE_LIB + `
const float EVEN_ONLY = 16777216.0;   // float32 has only even integers above this

float pixelParity(vec2 P, FE d, float lo, float hi, float par) {
  vec2 df = feToFloat(d);
  if (dot(df, df) * 16.0 >= dot(P, P)) return mod(floor(length(P + df)), 2.0);
  FE num = feAdd(fe(vec2(2.0 * dot(P, d.m), 0.0), d.e), fe(vec2(dot(d.m, d.m), 0.0), 2 * d.e));
  if (num.e == EMIN) return par;
  float den = length(P + df) + length(P);
  FE dr = fe(vec2(num.m.x / den, 0.0), num.e);
  if (dr.e < -100) {
    // Far below float32: at most one boundary is in reach, compare in log2.
    float L = log2(abs(dr.m.x)) + float(dr.e);
    bool cross = (dr.m.x < 0.0 && L > lo) || (dr.m.x > 0.0 && L >= hi);
    return cross ? 1.0 - par : par;
  }
  float x = dr.m.x * pow2(dr.e);
  float n;
  if (x >= 0.0) { float h = exp2(hi); n = x < h ? 0.0 : 1.0 + floor(x - h); }
  else { float l = exp2(lo); n = -x <= l ? 0.0 : -1.0 - floor(-x - l); }
  return mod(par + n, 2.0);
}

float escape(FE dc) {
  FE d = dc;
  int m = 0;
  bool onRef = true;
  int steps = min(u_maxIter, 500);
  float fallback = 0.0;
  vec2 P = refAt(0).xy;
  for (int i = 0; i < steps; i++) {
    float lo, hi, par;
    if (onRef) {
      vec4 R = refAt(2 * m);
      P = R.xy;
      lo = R.z;
      hi = R.w;
      par = refAt(2 * m + 1).x;
    } else {
      // Off the reference: the base is float32, so are its boundary distances.
      float r = length(P);
      float k = floor(r);
      par = mod(k, 2.0);
      lo = log2(max(r - k, 1e-30));
      hi = log2(max(k + 1.0 - r, 1e-30));
      if (r >= EVEN_ONLY) { par = 0.0; lo = 1e6; hi = 1e6; }
    }
    float pp = pixelParity(P, d, lo, hi, par);
    if (pp > 0.5) {
      P = vec2(3.0 * P.x + 1.0, 3.0 * P.y);
      d = fe(3.0 * d.m, d.e);
    } else {
      P *= 0.5;
      d.e -= 1;
    }
    if (onRef) {
      if (pp == par && m + 1 < u_refLen) m++;
      else onRef = false;
    }
    vec2 z = P + feToFloat(d);
    float zz = dot(z, z);
    if (i == 1) {
      float l = log2(0.5 * log(zz));
      if (isnan(l) || isinf(l)) l = 0.0;
      fallback = min(zz + 1.0 - l, 1e5);
    }
    if (!(zz < 1e30)) break;
  }
  vec2 z = P + feToFloat(d);
  return dot(z, z) > 25.0 ? fallback : 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5 * u_res + u_offset;
  outColor = vec4(palette(escape(fe(px * u_pxm, u_pxe))), 1.0);
}`;
