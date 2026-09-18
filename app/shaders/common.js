export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Puts a pass on the canvas under an affine map from canvas pixels to the
// pass's texels: u_org is the texel at the centre of the canvas, u_mx and u_my
// how far the read moves per pixel across and up. present() sets a map that
// spreads a coarse pass to size, reproject() one that also carries the move the
// camera has made since the pass was drawn.
export const BLIT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dst;
uniform vec2 u_org;
uniform vec2 u_mx;
uniform vec2 u_my;
out vec4 outColor;
void main() {
  vec2 q = gl_FragCoord.xy - 0.5 * u_dst;
  outColor = texture(u_src, u_org + u_mx * q.x + u_my * q.y);
}`;

export const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 u_res;
uniform float u_px;
uniform vec2 u_center;
uniform vec2 u_offset;
uniform vec2 u_rot;
uniform float u_pxm;
uniform int u_pxe;
uniform int u_maxIter;
uniform int u_refLen;
uniform int u_ref2;
uniform vec2 u_julia;
uniform sampler2D u_ref;
uniform int u_palette;

out vec4 outColor;

const float PERIOD = 100.0;

// A pixel's offset from the centre of the view, along the plane's axes rather
// than the screen's. u_rot is the cosine and sine of the view angle, and the
// turn back is its transpose.
vec2 viewPixel() {
  vec2 p = gl_FragCoord.xy - 0.5 * u_res;
  return vec2(p.x * u_rot.x + p.y * u_rot.y, p.y * u_rot.x - p.x * u_rot.y);
}

vec3 hsv(float h, float s, float v) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), rgb, s);
}

float penValue(float t) { return clamp(t * 5.0, 0.0, 100.0) / 100.0; }

vec3 penPalette(float t) {
  return hsv(fract((t + 90.0) / PERIOD), 1.0, penValue(t));
}

// Every hue at full saturation averages to half the value it is drawn at.
vec3 penMean(float t) { return vec3(0.5 * penValue(t)); }

struct Ramp { vec3 c0; vec3 c1; vec3 c2; vec3 c3; vec3 c4; vec4 pos; };

vec3 ramp5(Ramp r, float u) {
  if (u < r.pos.x) return mix(r.c0, r.c1, u / r.pos.x);
  if (u < r.pos.y) return mix(r.c1, r.c2, (u - r.pos.x) / (r.pos.y - r.pos.x));
  if (u < r.pos.z) return mix(r.c2, r.c3, (u - r.pos.y) / (r.pos.z - r.pos.y));
  if (u < r.pos.w) return mix(r.c3, r.c4, (u - r.pos.z) / (r.pos.w - r.pos.z));
  return mix(r.c4, r.c0, (u - r.pos.w) / (1.0 - r.pos.w));
}

// Both fract() and tri() cross the ramp at a steady rate, so each leg counts
// for its own length times the average of the two colours at its ends.
vec3 ramp5Mean(Ramp r) {
  return 0.5 * ((r.c0 + r.c1) * r.pos.x
    + (r.c1 + r.c2) * (r.pos.y - r.pos.x)
    + (r.c2 + r.c3) * (r.pos.z - r.pos.y)
    + (r.c3 + r.c4) * (r.pos.w - r.pos.z)
    + (r.c4 + r.c0) * (1.0 - r.pos.w));
}

float tri(float u) { return 1.0 - abs(2.0 * fract(u) - 1.0); }

Ramp classicRamp() {
  return Ramp(
    vec3(0.0, 0.027, 0.392), vec3(0.125, 0.42, 0.796), vec3(0.929, 1.0, 1.0),
    vec3(1.0, 0.667, 0.0), vec3(0.0, 0.008, 0.0),
    vec4(0.16, 0.42, 0.6425, 0.8575));
}

Ramp emberRamp() {
  return Ramp(
    vec3(0.02, 0.0, 0.0), vec3(0.35, 0.03, 0.03), vec3(0.85, 0.18, 0.04),
    vec3(1.0, 0.7, 0.13), vec3(1.0, 0.96, 0.84),
    vec4(0.25, 0.5, 0.75, 0.999));
}

Ramp abyssRamp() {
  return Ramp(
    vec3(0.0, 0.07, 0.1), vec3(0.0, 0.37, 0.45), vec3(0.04, 0.58, 0.59),
    vec3(0.58, 0.82, 0.74), vec3(0.91, 0.85, 0.65),
    vec4(0.25, 0.5, 0.75, 0.999));
}

Ramp ultravioletRamp() {
  return Ramp(
    vec3(0.02, 0.0, 0.08), vec3(0.016, 0.0, 1.0), vec3(0.48, 0.0, 1.0),
    vec3(1.0, 0.17, 0.84), vec3(1.0, 0.84, 0.96),
    vec4(0.2, 0.45, 0.7, 0.9));
}

const float BAND = 8.0;
const float BAND_EDGE = 0.08;
const vec3 INK_LINE = 0.12 * vec3(1.0, 0.97, 0.9);
const vec3 INK_PAGE = 0.93 * vec3(1.0, 0.97, 0.9);
const vec3 CHALK_LINE = 0.92 * vec3(0.9, 0.95, 1.0);
const vec3 CHALK_PAGE = 0.1 * vec3(0.9, 0.95, 1.0);

vec3 bandPalette(float t, vec3 line, vec3 page) {
  float band = fract(t / BAND);
  float edge = smoothstep(0.0, BAND_EDGE, band) * (1.0 - smoothstep(1.0 - BAND_EDGE, 1.0, band));
  return mix(line, page, edge);
}

// The two edges give back half their width each, leaving the page everywhere
// else.
vec3 bandMean(vec3 line, vec3 page) { return mix(line, page, 1.0 - BAND_EDGE); }

vec3 palette(float t) {
  if (!(t > 0.0)) return vec3(0.0);
  if (u_palette == 1) return ramp5(classicRamp(), fract(t / PERIOD));
  if (u_palette == 2) return ramp5(emberRamp(), tri(t / PERIOD) * 0.999);
  if (u_palette == 3) return ramp5(abyssRamp(), tri(t / PERIOD) * 0.999);
  if (u_palette == 4) return ramp5(ultravioletRamp(), fract(t / PERIOD));
  if (u_palette == 5) return bandPalette(t, INK_LINE, INK_PAGE);
  if (u_palette == 6) return bandPalette(t, CHALK_LINE, CHALK_PAGE);
  return penPalette(t);
}

vec3 paletteMean(float t) {
  if (u_palette == 1) return ramp5Mean(classicRamp());
  if (u_palette == 2) return ramp5Mean(emberRamp());
  if (u_palette == 3) return ramp5Mean(abyssRamp());
  if (u_palette == 4) return ramp5Mean(ultravioletRamp());
  if (u_palette == 5) return bandMean(INK_LINE, INK_PAGE);
  if (u_palette == 6) return bandMean(CHALK_LINE, CHALK_PAGE);
  return penMean(t);
}

float paletteCycle() { return (u_palette == 5 || u_palette == 6) ? BAND : PERIOD; }

// A pixel covers as much of the palette as the escape count crosses inside
// it, so one that crosses a whole cycle covers every colour the palette has.
// Its point sample is then one of those colours at random, and their mean is
// the honest answer.
vec4 shade(float t) {
  float cycles = fwidth(t) / paletteCycle();
  if (!(t > 0.0)) return vec4(0.0, 0.0, 0.0, 1.0);
  return vec4(mix(paletteMean(t), palette(t), 1.0 - smoothstep(0.0, 1.0, cycles)), 1.0);
}

vec2 csq(vec2 z) { return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

float smoothT(int steps, float logzz) {
  return float(steps) + 1.0 - log2(0.5 * logzz);
}

vec4 refAt(int i) { return texelFetch(u_ref, ivec2(i & 1023, i >> 10), 0); }

const float SKIN = 1e-5;

bool inCardioidOrBulb(vec2 c) {
  vec2 b = c + vec2(1.0, 0.0);
  if (dot(b, b) < 0.0625 - SKIN) return true;
  float x = c.x - 0.25;
  float q = x * x + c.y * c.y;
  return q * (q + x) < 0.25 * c.y * c.y - SKIN;
}
`;

export const FE_LIB = `
const int EMIN = -1000000;
struct FE { vec2 m; int e; };

float pow2(int k) {
  int h = k >> 1;
  return intBitsToFloat((h + 127) << 23) * intBitsToFloat((k - h + 127) << 23);
}

FE fe(vec2 v, int e) {
  float a = max(abs(v.x), abs(v.y));
  int ex = (floatBitsToInt(a) >> 23) & 255;
  if (ex == 0) return FE(vec2(0.0), EMIN);
  int k = ex - 126;
  return FE(v * pow2(-k), e + k);
}

vec2 feToFloat(FE a) {
  if (a.e < -120) return vec2(0.0);
  return a.m * pow2(min(a.e, 120));
}

FE feAdd(FE a, FE b) {
  if (a.e < b.e) { FE t = a; a = b; b = t; }
  int d = a.e - b.e;
  if (d > 60) return a;
  return fe(a.m + b.m * pow2(-d), a.e);
}

bool feLess(FE a, FE b) {
  if (a.e == EMIN) return b.e != EMIN;
  if (b.e == EMIN) return false;
  int d = clamp(a.e - b.e, -30, 30);
  return dot(a.m, a.m) * pow2(2 * d) < dot(b.m, b.m);
}

FE feMag2(FE a) { return fe(vec2(dot(a.m, a.m), 0.0), 2 * a.e); }
`;
