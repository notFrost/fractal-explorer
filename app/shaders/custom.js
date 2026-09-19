import { earlierGlsl } from '../formula.js';

export const CUSTOM_LIB = `
vec2 cdiv(vec2 a, vec2 b) { return vec2(dot(a, b), a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 cre(vec2 z) { return vec2(z.x, 0.0); }
vec2 cim(vec2 z) { return vec2(z.y, 0.0); }
vec2 cabs(vec2 z) { return vec2(length(z), 0.0); }
vec2 cconj(vec2 z) { return vec2(z.x, -z.y); }

vec2 cexp(vec2 z) { return exp(min(z.x, 60.0)) * vec2(cos(z.y), sin(z.y)); }
vec2 clog(vec2 z) { return vec2(0.5 * log(dot(z, z)), atan(z.y, z.x)); }

vec2 csqrt(vec2 z) {
  float r = length(z);
  if (r == 0.0) return vec2(0.0);
  return vec2(sqrt(0.5 * (r + z.x)), (z.y < 0.0 ? -1.0 : 1.0) * sqrt(0.5 * (r - z.x)));
}

vec2 cpowi(vec2 z, int n) {
  int k = n < 0 ? -n : n;
  vec2 r = vec2(1.0, 0.0);
  vec2 b = z;
  for (int s = 0; s < 7; s++) {
    if (k == 0) break;
    if ((k & 1) == 1) r = cmul(r, b);
    b = cmul(b, b);
    k >>= 1;
  }
  return n < 0 ? cdiv(vec2(1.0, 0.0), r) : r;
}

vec2 cpow(vec2 a, vec2 b) { return dot(a, a) == 0.0 ? vec2(0.0) : cexp(cmul(b, clog(a))); }

vec2 csin(vec2 z) { return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y)); }
vec2 ccos(vec2 z) { return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y)); }
vec2 ctan(vec2 z) { return cdiv(csin(z), ccos(z)); }
vec2 csinh(vec2 z) { return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y)); }
vec2 ccosh(vec2 z) { return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y)); }
vec2 ctanh(vec2 z) { return cdiv(csinh(z), ccosh(z)); }
`;

// A formula that reads zₙ₋₁ and behind it keeps those steps in variables of
// their own. The next z is worked out before any of them moves, and then each
// takes the value of the step in front of it, oldest first so nothing is
// overwritten while it is still needed.
const carry = (iter, depth) => [
  `    vec2 nz = ${iter};`,
  ...Array.from({ length: depth }, (_, at) => {
    const steps = depth - at;
    return `    ${earlierGlsl(steps)} = ${steps > 1 ? earlierGlsl(steps - 1) : 'z'};`;
  }),
  '    z = nz;',
].join('\n');

export const partsKey = ({ iter, seeds, earlier = [] }) =>
  [iter, ...seeds.map((s) => `${s.name}=${s.glsl}`), ...earlier].join('|');

function escapeLib({ iter, seeds, earlier = [] }) {
  const start = [
    ...seeds.map(({ name, glsl }) => `  vec2 ${name} = ${glsl};`),
    ...earlier.map((glsl, at) => `  vec2 ${earlierGlsl(at + 1)} = ${glsl};`),
  ].join('\n');
  return CUSTOM_LIB + `
float escape(vec2 p) {
${start}
  for (int n = 0; n < u_maxIter; n++) {
${earlier.length ? carry(iter, earlier.length) : `    z = ${iter};`}
    float zz = dot(z, z);
    if (!(zz < 1e4)) {
      float t = smoothT(n + 1, log(zz));
      return t > 0.0 ? t : float(n + 1);
    }
  }
  return 0.0;
}

vec2 pixelPoint() { return u_center + viewPixel() * u_px; }
`;
}

export function customBody(parts) {
  return escapeLib(parts) + `
void main() {
  outColor = shade(escape(pixelPoint()));
}`;
}

// The same orbit in grey: how far through the iteration budget the pixel got,
// with the points that never escape at full white. Whatever the formula, the
// fractal is then the bright part of the picture, which is what the framing
// survey reads back.
export function depthBody(parts) {
  return escapeLib(parts) + `
void main() {
  float e = escape(pixelPoint());
  float depth = e > 0.0 ? min(e / float(u_maxIter), 1.0) : 1.0;
  outColor = vec4(vec3(depth), 1.0);
}`;
}
