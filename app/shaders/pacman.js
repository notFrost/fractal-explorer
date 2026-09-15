
export const PACMAN_PERT = `
const float TAU = 6.2831853071795864;
const float PI = 3.1415926535897932;
const float EXP_MAX = 30.0;

float log1p_(float x) { float u = 1.0 + x; return u == 1.0 ? x : x * log(u) / (u - 1.0); }
float expm1_(float x) { float u = exp(x); return u == 1.0 ? x : (u - 1.0) * x / log(u); }

vec2 cdiv(vec2 a, vec2 b) { return vec2(dot(a, b), a.y * b.x - a.x * b.y) / dot(b, b); }

vec2 clog1p(vec2 u) {
  return vec2(0.5 * log1p_(2.0 * u.x + u.x * u.x + u.y * u.y), atan(u.y, 1.0 + u.x));
}

vec2 cexpm1(vec2 w) {
  float wr = min(w.x, EXP_MAX);
  float s = sin(0.5 * w.y);
  return vec2(expm1_(wr) * cos(w.y) - 2.0 * s * s, exp(wr) * sin(w.y));
}

float smoothPac(int n, float prev, float zz) {
  float a = log(max(prev, 1e-20));
  float b = log(min(zz, 1e26));
  return float(n) + clamp((log(1e4) - a) / (b - a), 0.0, 1.0);
}

float escape(vec2 dc) {
  vec2 d = dc;
  int m = 1;
  int last = u_refLen - 1;
  float prev = 0.0;
  vec2 z = refAt(2).xy + d;
  float zz = dot(z, z);
  if (!(zz < 1e4)) return smoothPac(0, prev, zz);
  for (int n = 1; n < u_maxIter; n++) {
    vec4 A = refAt(2 * m);
    vec4 B = refAt(2 * m + 1);
    vec2 L = clog1p(cdiv(d, A.xy));
    L.y -= TAU * floor((A.w + L.y + PI) / TAU);
    vec2 W = cmul(A.xy, L) + cmul(d, A.zw + L);
    d = cmul(B.xy, cexpm1(W)) + dc;
    m++;
    int i = min(m, last);
    z = refAt(2 * i).xy + d;
    prev = zz;
    zz = dot(z, z);
    if (!(zz < 1e4)) return smoothPac(n, prev, zz);
    vec2 w = refAt(2 * i + 1).zw + d;
    if (dot(w, w) < dot(d, d) || m >= last) { d = w; m = 1; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * u_res + u_offset) * u_px;
  outColor = vec4(palette(escape(dc)), 1.0);
}`;
