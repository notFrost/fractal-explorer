export const PACMAN_PERT = `
float escape(vec2 dc) {
  vec2 d = vec2(0.0);
  int m = 0;
  int last = u_refLen - 1;
  for (int n = 0; n < u_maxIter; n++) {
    vec2 Z = refAt(m).xy;
    m++;
    vec2 Zn = refAt(min(m, last)).xy;
    float di = 2.0 * (Z.x * d.y + Z.y * d.x + d.x * d.y) + dc.y;
    float dr = d.x * (2.0 * Z.x + d.x) - di * (2.0 * Zn.y + di) + dc.x;
    d = vec2(dr, di);
    vec2 z = Zn + d;
    float zz = dot(z, z);
    if (zz > 1e4) return smoothT(n + 1, log(zz));
    if (zz < dot(d, d) || m >= last) { d = z; m = 0; }
  }
  return 0.0;
}

void main() {
  vec2 dc = (viewPixel() + u_offset) * u_px;
  outColor = shade(escape(dc));
}`;
