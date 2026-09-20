// Turns a typed iteration formula into a GLSL expression for the next z, and
// into the coloured token stream the editor paints behind the input.

const SUPER = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', 'ⁿ': 'n', 'ᶻ': 'z', 'ᶜ': 'c', 'ⁱ': 'i',
};

const SUB = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', 'ₙ': 'n',
};

const SUPER_CHARS = Object.keys(SUPER).join('');
const SUB_CHARS = Object.keys(SUB).join('');
const BAR_CHARS = '|∣｜│❘';

const SUPER_RUN = new RegExp(`[${SUPER_CHARS}]+`, 'g');
const SUB_RUN = new RegExp(`[${SUB_CHARS}]+`, 'g');
const BAR_ANY = new RegExp(`[${BAR_CHARS}]`, 'g');

const BRACKETS = { '{': '(', '}': ')', '[': '(', ']': ')' };

const FUNCS = {
  abs: 'cabs', re: 'cre', im: 'cim', conj: 'cconj',
  exp: 'cexp', log: 'clog', ln: 'clog', sqrt: 'csqrt',
  sin: 'csin', cos: 'ccos', tan: 'ctan',
  sinh: 'csinh', cosh: 'ccosh', tanh: 'ctanh',
};

const names = (vars, reachesBack, strangers = [], message = '') =>
  ({ vars, reachesBack, strangers: new Set(strangers), message });

const PIXEL = { x: 'vec2(p.x, 0.0)', y: 'vec2(p.y, 0.0)' };

const VAR_LETTERS = [...'abdfghjklmnopqrstuvw'];
const SPOKEN_FOR = new Set(['z', 'c', 'x', 'y', 'i', 'e']);

export const varGlsl = (name) => `v_${name}`;

const iteration = (extras) => names(
  { ...PIXEL, z: 'z', c: 'c', ...Object.fromEntries(extras.map((n) => [n, varGlsl(n)])) },
  true,
);

const seed = (extras) => names(
  PIXEL,
  false,
  ['z', 'c', ...extras],
  'a starting value is built from x and y, not from another variable',
);

export const freeVarName = (taken) => VAR_LETTERS.find((ch) => !taken.includes(ch)) ?? null;

export function varNameError(name, others) {
  if (!/^[a-z]$/.test(name)) return 'a variable is named by one letter';
  if (SPOKEN_FOR.has(name)) return `“${name}” is already spoken for`;
  if (others.includes(name)) return `there are two variables called “${name}”`;
  return null;
}

export const MAX_LENGTH = 240;
const MAX_NODES = 400;
const MAX_DEPTH = 48;

export const FUNCTION_NAMES = Object.keys(FUNCS);

class FormulaError extends Error {}

const fail = (msg) => { throw new FormulaError(msg); };

function glslFloat(v) {
  if (!Number.isFinite(v)) fail('that number is out of range');
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

const real = (v) => ({ code: `vec2(${glslFloat(v)}, 0.0)`, num: v });
const complex = (code) => ({ code, num: null });

const CONSTS = {
  i: () => complex('vec2(0.0, 1.0)'),
  pi: () => real(Math.PI),
  e: () => real(Math.E),
};

// zₙ and zₙ₊₁ name the step the formula already writes, so the parser drops
// them. zₙ₋₁ and the ones behind it name a value the iteration has to keep, so
// the parser reads them and the editor asks for a starting value for each.
export const MAX_EARLIER = 8;

const EARLIER_INDEX = /_\s*\(\s*n\s*-\s*\d+\s*\)/;
const DROPPED_INDEX = /_\s*\(\s*n\s*\+\s*1\s*\)|_\s*\(\s*n\s*\)|_\s*n(?![a-z0-9])/;
const INDEX = new RegExp(`(${EARLIER_INDEX.source}|${DROPPED_INDEX.source})`);
const EVERY_EARLIER = new RegExp(EARLIER_INDEX, 'g');

const stepsBack = (text) => Number(/\d+/.exec(text)[0]);
const reachable = (steps) => steps >= 1 && steps <= MAX_EARLIER;

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const subscript = (n) => [...String(n)].map((d) => SUB_DIGITS[Number(d)]).join('');

export const earlierGlsl = (steps) => `z${steps}`;
export const earlierLabel = (steps) => `z₋${subscript(steps)}`;

function normalize(src) {
  let s = String(src).trim().toLowerCase();
  s = s.replace(/[−–—‒]/g, '-').replace(/[·×∙]/g, '*').replace(/[÷∕]/g, '/');
  s = s.replace(BAR_ANY, '|');
  s = s.replace(/[{}[\]]/g, (ch) => BRACKETS[ch]);
  s = s.replace(/:=|[←→↦⟵⟶]/g, '=');
  s = s.replace(SUPER_RUN, (run) => `^(${[...run].map((ch) => SUPER[ch]).join('')})`);
  s = s.replace(SUB_RUN, (run) => `_(${[...run].map((ch) => SUB[ch]).join('')})`);
  s = s.replace(EVERY_EARLIER, (run) => `_(n-${stepsBack(run)})`);
  s = s.replace(new RegExp(DROPPED_INDEX, 'g'), '');
  return s;
}

// The formula in the field before it parses, which is when the editor needs to
// know how many starting values to ask for.
export function earlierTerms(src) {
  let reach = 0;
  for (const [run] of normalize(src).split('=').pop().matchAll(EVERY_EARLIER)) {
    const steps = stepsBack(run);
    if (reachable(steps) && steps > reach) reach = steps;
  }
  return reach;
}

function rightHandSide(s) {
  const parts = s.split('=');
  if (parts.length > 2) fail('one = at most');
  if (parts.length === 2 && !parts[0].trim()) fail('there is nothing on the left of the =');
  const rhs = parts[parts.length - 1].trim();
  if (!rhs) fail('there is nothing to iterate');
  return rhs;
}

const LEX = /(\d+(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|([a-z]+)|(_\(n-\d+\))|([-+*/^(),|])|(\s+)|(.)/gy;

const INDEX_SHAPE = 'an index is written zₙ, zₙ₊₁ or zₙ₋₁';

function lex(s) {
  const out = [];
  LEX.lastIndex = 0;
  while (LEX.lastIndex < s.length) {
    const at = LEX.lastIndex;
    const m = LEX.exec(s);
    if (!m) fail(`cannot read “${s[at]}”`);
    if (m[1]) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) out.push({ t: 'name', v: m[2] });
    else if (m[3]) out.push({ t: 'earlier', v: stepsBack(m[3]) });
    else if (m[4]) out.push({ t: 'op', v: m[4] });
    else if (m[6]) fail(m[6] === '_' ? INDEX_SHAPE : `cannot read “${m[6]}”`);
  }
  if (!out.length) fail('there is nothing to iterate');
  return out;
}

function letterNodes(name, mode) {
  const parts = [...name].map((ch) => (
    mode.vars[ch] ? variable(ch) : CONSTS[ch] ? constant(ch) : null
  ));
  return parts.every(Boolean) ? parts : null;
}

const splitsIntoLetters = (name, mode) =>
  name.length > 1 && [...name].every((ch) => mode.vars[ch] || CONSTS[ch] || mode.strangers.has(ch));

// ---------- The tree a line reads into ----------

// The parser builds this and the GLSL comes off it, so invent.js can put a
// formula together and rearrange one without a grammar of its own. `tight` on
// a product and `bars` on an abs are how the line was written rather than
// what it means; the printer keeps them, so a formula comes back out in the
// notation it went in as.

export const numeral = (v) => ({ k: 'num', v });
export const constant = (name) => ({ k: 'const', name });
export const variable = (name) => ({ k: 'var', name });
export const earlierZ = (steps) => ({ k: 'earlier', steps });
export const apply = (fn, arg) => ({ k: 'call', fn, arg });
export const bars = (arg) => ({ k: 'call', fn: 'abs', arg, bars: true });
export const negate = (a) => ({ k: 'neg', a });
export const plus = (a, b) => ({ k: 'add', op: '+', a, b });
export const minus = (a, b) => ({ k: 'add', op: '-', a, b });
export const times = (a, b, tight = false) => ({ k: 'mul', a, b, tight });
export const over = (a, b) => ({ k: 'div', a, b });
export const power = (a, b) => ({ k: 'pow', a, b });

const BRANCHES = {
  call: ['arg'], neg: ['a'], add: ['a', 'b'], mul: ['a', 'b'], div: ['a', 'b'], pow: ['a', 'b'],
};

export const branches = (node) => BRANCHES[node.k] ?? [];

export const regrow = (node, kids) => ({
  ...node,
  ...Object.fromEntries(branches(node).map((field, at) => [field, kids[at]])),
});

// The tree, and how far back the line reaches, which the editor turns into
// one starting-value field per step.
function build(tokens, mode) {
  let i = 0;
  let nodes = 0;
  let openBars = 0;
  let reach = 0;

  const peek = () => tokens[i];
  const grow = (node) => {
    if (++nodes > MAX_NODES) fail('that formula has too many terms');
    return node;
  };
  const eat = (v) => {
    const t = tokens[i];
    if (t && t.t === 'op' && t.v === v) { i++; return true; }
    return false;
  };

  const eatIndex = () => {
    const t = tokens[i];
    if (t && t.t === 'earlier') { i++; return t.v; }
    return null;
  };

  const startsValue = (t) =>
    !!t && (t.t === 'num' || t.t === 'name' || t.t === 'earlier'
      || (t.t === 'op' && (t.v === '(' || (t.v === '|' && openBars === 0))));

  function insideBrackets(read) {
    const outer = openBars;
    openBars = 0;
    const v = read();
    openBars = outer;
    return v;
  }

  function reachBack(name, steps) {
    if (!mode.reachesBack) fail(mode.message);
    if (name !== 'z') fail(`only z keeps its earlier values, so “${name}” carries no index`);
    if (steps < 1) fail('zₙ₋₀ is zₙ itself');
    if (steps > MAX_EARLIER) fail(`the formula reaches ${MAX_EARLIER} steps back at most`);
    if (steps > reach) reach = steps;
    return grow(earlierZ(steps));
  }

  function expr(depth) {
    if (depth > MAX_DEPTH) fail('that formula nests too deeply');
    let a = term(depth + 1);
    for (;;) {
      if (eat('+')) a = grow(plus(a, term(depth + 1)));
      else if (eat('-')) a = grow(minus(a, term(depth + 1)));
      else return a;
    }
  }

  function term(depth) {
    let a = unary(depth);
    for (;;) {
      if (eat('*')) a = grow(times(a, unary(depth + 1)));
      else if (eat('/')) a = grow(over(a, unary(depth + 1)));
      else if (startsValue(peek())) a = grow(times(a, unary(depth + 1), true));
      else return a;
    }
  }

  function unary(depth) {
    if (depth > MAX_DEPTH) fail('that formula nests too deeply');
    if (eat('+')) return unary(depth + 1);
    if (eat('-')) return grow(negate(unary(depth + 1)));
    const a = atom(depth);
    return eat('^') ? grow(power(a, unary(depth + 1))) : a;
  }

  function atom(depth) {
    const t = peek();
    if (!t) fail('the formula stops early');
    if (t.t === 'num') { i++; return numeral(t.v); }
    if (t.t === 'earlier') fail('an index belongs to a value, as in zₙ₋₁');
    if (t.t === 'name') {
      i++;
      const name = t.v;
      const steps = eatIndex();
      if (steps !== null) return reachBack(name, steps);
      if (FUNCS[name]) {
        if (!eat('(')) fail(`${name} needs a bracket, as in ${name}(z)`);
        const arg = insideBrackets(() => expr(depth + 1));
        if (eat(',')) fail(`${name} takes one value`);
        if (!eat(')')) fail(`the bracket after ${name} is not closed`);
        return grow(apply(name, arg));
      }
      if (mode.vars[name]) return variable(name);
      if (CONSTS[name]) return constant(name);
      if (mode.strangers.has(name)) fail(mode.message);
      const letters = name.length > 1 ? letterNodes(name, mode) : null;
      if (letters) return letters.reduce((a, b) => grow(times(a, b, true)));
      if ([...name].some((ch) => mode.strangers.has(ch))) fail(mode.message);
      fail(`“${name}” is not a name this editor knows`);
    }
    if (t.t === 'op' && t.v === '(') {
      i++;
      const e = insideBrackets(() => expr(depth + 1));
      if (!eat(')')) fail('a bracket is not closed');
      return e;
    }
    if (t.t === 'op' && t.v === '|') {
      i++;
      if (!peek()) fail('a bar is not closed');
      openBars++;
      const inner = expr(depth + 1);
      if (!eat('|')) fail('a bar is not closed');
      openBars--;
      return grow(bars(inner));
    }
    fail(`“${t.v}” is out of place`);
  }

  const tree = expr(0);
  if (i < tokens.length) fail(`“${tokens[i].v}” is out of place`);
  return { tree, reach };
}

// ---------- The tree as GLSL ----------

// A branch of plain numbers folds to one number here rather than on every
// pixel of every step, and a whole-number exponent squares and multiplies
// instead of going through exp and log.

function addCode(a, b, op) {
  if (a.num !== null && b.num !== null) return real(op === '+' ? a.num + b.num : a.num - b.num);
  return complex(`(${a.code} ${op} ${b.code})`);
}

function mulCode(a, b) {
  if (a.num !== null && b.num !== null) return real(a.num * b.num);
  if (a.num !== null) return complex(`(${glslFloat(a.num)} * ${b.code})`);
  if (b.num !== null) return complex(`(${a.code} * ${glslFloat(b.num)})`);
  return complex(`cmul(${a.code}, ${b.code})`);
}

function divCode(a, b) {
  if (b.num !== null) {
    if (b.num === 0) fail('division by zero');
    return a.num !== null ? real(a.num / b.num) : complex(`(${a.code} / ${glslFloat(b.num)})`);
  }
  return complex(`cdiv(${a.code}, ${b.code})`);
}

function powCode(a, b) {
  if (b.num !== null && Number.isInteger(b.num) && Math.abs(b.num) <= 64) {
    if (b.num === 1) return a;
    if (b.num === 2) return complex(`csq(${a.code})`);
    return complex(`cpowi(${a.code}, ${b.num})`);
  }
  return complex(`cpow(${a.code}, ${b.code})`);
}

function emit(node, mode) {
  switch (node.k) {
    case 'num': return real(node.v);
    case 'const': return CONSTS[node.name]();
    case 'var': return complex(mode.vars[node.name]);
    case 'earlier': return complex(earlierGlsl(node.steps));
    case 'call': return complex(`${FUNCS[node.fn]}(${emit(node.arg, mode).code})`);
    case 'neg': {
      const a = emit(node.a, mode);
      return a.num !== null ? real(-a.num) : complex(`(-${a.code})`);
    }
    case 'add': return addCode(emit(node.a, mode), emit(node.b, mode), node.op);
    case 'mul': return mulCode(emit(node.a, mode), emit(node.b, mode));
    case 'div': return divCode(emit(node.a, mode), emit(node.b, mode));
    default: return powCode(emit(node.a, mode), emit(node.b, mode));
  }
}

const written = (rhs) => rhs.replace(EVERY_EARLIER, (run) => `ₙ₋${subscript(stepsBack(run))}`);

function parse(src, mode) {
  if (String(src).trim().length > MAX_LENGTH) fail('that formula is too long');
  const rhs = rightHandSide(normalize(src));
  const { tree, reach } = build(lex(rhs), mode);
  return { glsl: emit(tree, mode).code, text: written(rhs), earlier: reach, tree };
}

export const parseFormula = (src, extras = []) => parse(src, iteration(extras));
export const parseSeed = (src, extras = []) => parse(src, seed(extras));


// ---------- The tree as one pair of numbers ----------

// A starting value that never reads the pixel is the same pair of numbers
// everywhere in the picture and in every frame of a movie. The shader takes
// those as a uniform rather than working them out per pixel, which is what
// lets the timeline move a variable without recompiling anything. This works
// the pair out, and says null for a value built from x or y.
//
// The arithmetic matches CUSTOM_LIB's, down to the clamp on exp, so the number
// handed to the GPU is the one the GPU would have reached itself.

const pair = (re, im = 0) => ({ re, im });

const vAdd = (a, b) => pair(a.re + b.re, a.im + b.im);
const vSub = (a, b) => pair(a.re - b.re, a.im - b.im);
const vMul = (a, b) => pair(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);

function vDiv(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return pair((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

function vExp(a) {
  const r = Math.exp(Math.min(a.re, 60));
  return pair(r * Math.cos(a.im), r * Math.sin(a.im));
}

const vLog = (a) => pair(0.5 * Math.log(a.re * a.re + a.im * a.im), Math.atan2(a.im, a.re));

function vSqrt(a) {
  const r = Math.hypot(a.re, a.im);
  if (r === 0) return pair(0);
  return pair(Math.sqrt(0.5 * (r + a.re)), (a.im < 0 ? -1 : 1) * Math.sqrt(0.5 * (r - a.re)));
}

const vSin = (a) => pair(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
const vCos = (a) => pair(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
const vSinh = (a) => pair(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
const vCosh = (a) => pair(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));

const VALUE_FUNCS = {
  abs: (a) => pair(Math.hypot(a.re, a.im)),
  re: (a) => pair(a.re),
  im: (a) => pair(a.im),
  conj: (a) => pair(a.re, -a.im),
  exp: vExp, log: vLog, ln: vLog, sqrt: vSqrt,
  sin: vSin, cos: vCos, tan: (a) => vDiv(vSin(a), vCos(a)),
  sinh: vSinh, cosh: vCosh, tanh: (a) => vDiv(vSinh(a), vCosh(a)),
};

const CONST_VALUES = { i: pair(0, 1), pi: pair(Math.PI), e: pair(Math.E) };

function vPowInt(a, n) {
  let k = Math.abs(n);
  let r = pair(1);
  let b = a;
  while (k) {
    if (k & 1) r = vMul(r, b);
    b = vMul(b, b);
    k >>= 1;
  }
  return n < 0 ? vDiv(pair(1), r) : r;
}

function vPow(a, b) {
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) return vPowInt(a, b.re);
  return a.re === 0 && a.im === 0 ? pair(0) : vExp(vMul(b, vLog(a)));
}

// Null anywhere a branch reads the pixel, and null up the tree from there.
function valueOf(node) {
  const both = (fn) => {
    const a = valueOf(node.a);
    const b = valueOf(node.b);
    return a && b ? fn(a, b) : null;
  };
  switch (node.k) {
    case 'num': return pair(node.v);
    case 'const': return CONST_VALUES[node.name];
    case 'call': {
      const a = valueOf(node.arg);
      return a ? VALUE_FUNCS[node.fn](a) : null;
    }
    case 'neg': {
      const a = valueOf(node.a);
      return a ? pair(-a.re, -a.im) : null;
    }
    case 'add': return both(node.op === '+' ? vAdd : vSub);
    case 'mul': return both(vMul);
    case 'div': return both(vDiv);
    case 'pow': return both(vPow);
    default: return null;
  }
}

// Arithmetic that ran off the end — a division by a computed zero, a log of
// nothing — leaves no value for the shader to hold, so that starting value
// stays one the pixel works out for itself.
export function constantValue(tree) {
  const v = valueOf(tree);
  return v && Number.isFinite(v.re) && Number.isFinite(v.im) ? v : null;
}

const shortNumber = (v) => String(Number(v.toPrecision(12)));

// The pair written the way the editor's own fields are written, so a value
// shown in the HUD or carried in a link reads back as the line that made it.
export function valueText({ re, im }) {
  if (!im) return shortNumber(re);
  const mag = Math.abs(im) === 1 ? '' : shortNumber(Math.abs(im));
  return re ? `${shortNumber(re)}${im < 0 ? '-' : '+'}${mag}i` : `${im < 0 ? '-' : ''}${mag}i`;
}
// ---------- The tree as a line to type ----------

// What invent.js hands back to the field. A bracket goes in where precedence
// needs one and nowhere else, and a product written side by side keeps that
// form unless the halves would run together into one name or one number.
//
// A bar only opens where a value is due, so inside one the rules tighten. A
// bracket puts the count back to nothing, which is why the text inside one is
// spelt as if no bar were open.

const ATOM = 5;
const POW = 4;
const UNARY = 3;
const MUL = 2;
const ADD = 1;

const BINDS = {
  num: ATOM, const: ATOM, var: ATOM, earlier: ATOM, call: ATOM,
  pow: POW, neg: UNARY, mul: MUL, div: MUL, add: ADD,
};

const DIGIT_EDGE = /[0-9.]/;
const LETTER_EDGE = /[a-z]/;

// Two halves stand side by side as a product only where the join still reads
// as two things. Digit against digit makes one longer number and letter
// against letter one longer name; a sign at the front of the right half reads
// as the operator it looks like; and a bar, inside a bar, closes the one
// already open rather than opening its own.
function joinable(left, right, inBar) {
  if (/^[-+]/.test(right)) return false;
  if (inBar && right.startsWith('|')) return false;
  const ends = left[left.length - 1];
  const starts = right[0];
  return !((DIGIT_EDGE.test(ends) && DIGIT_EDGE.test(starts))
    || (LETTER_EDGE.test(ends) && LETTER_EDGE.test(starts)));
}

function spell(node, inBar) {
  switch (node.k) {
    case 'num': return String(node.v);
    case 'const': case 'var': return node.name;
    case 'earlier': return `z_(n-${node.steps})`;
    case 'call': return node.bars
      ? `|${write(node.arg, ADD, true)}|`
      : `${node.fn}(${write(node.arg, ADD, false)})`;
    case 'neg': return `-${write(node.a, UNARY, inBar)}`;
    case 'add': return addText(node, inBar);
    case 'mul': {
      const left = write(node.a, MUL, inBar);
      const right = write(node.b, UNARY, inBar);
      return node.tight && joinable(left, right, inBar) ? `${left}${right}` : `${left}*${right}`;
    }
    case 'div': return `${write(node.a, MUL, inBar)}/${write(node.b, UNARY, inBar)}`;
    default: return `${write(node.a, ATOM, inBar)}^${exponentText(node.b, inBar)}`;
  }
}

// A term that is itself negative reads as a subtraction rather than as a plus
// in front of a minus, so a tweak that turns 0.5 into -0.5 comes back as a
// line someone would have written. A minus at the front of a term carries
// over the whole of it, which is what lets the sign move to the operator.
// Terms added to a sum run on without brackets, since where they are added
// makes no difference; terms taken off one need them, since it does.
function addText(node, inBar) {
  const left = write(node.a, ADD, inBar);
  const right = write(node.b, node.op === '+' ? ADD : MUL, inBar);
  return right.startsWith('-')
    ? `${left} ${node.op === '+' ? '-' : '+'} ${right.slice(1)}`
    : `${left} ${node.op} ${right}`;
}

// A negative exponent is bracketed though it need not be: z^(-2) is what the
// power is, and z^-2 reads like a subtraction that lost its left side.
function exponentText(node, inBar) {
  const it = bare(node);
  return it.k === 'num' && it.v < 0 ? `(${it.v})` : write(it, POW, inBar);
}

// Nobody writes a coefficient of one, a coefficient of minus one is a sign,
// and a minus in front of a minus is neither. A tweak lands on these often
// enough that the line would fill up with them. The brackets are worked out
// after they go, so what is left keeps only the brackets it needs.
function bare(node) {
  if (node.k === 'neg' && node.a.k === 'neg') return bare(node.a.a);
  if (node.k === 'neg' && node.a.k === 'num') return numeral(-node.a.v);
  if (node.k !== 'mul' || node.a.k !== 'num' || Math.abs(node.a.v) !== 1) return node;
  return node.a.v === 1 ? bare(node.b) : negate(bare(node.b));
}

function write(node, binds, inBar) {
  const it = bare(node);
  const bracketed = BINDS[it.k] < binds;
  const text = spell(it, bracketed ? false : inBar);
  return bracketed ? `(${text})` : text;
}

export const printFormula = (node) => spell(bare(node), false);

// ---------- The same line, coloured ----------

const PAINT = new RegExp([
  /(\s+)/,
  /(\d+(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)/,
  INDEX,
  /([a-z]+)/,
  new RegExp(`([${SUPER_CHARS}]+)`),
  new RegExp(`([${SUB_CHARS}]+)`),
  /([({\[])/,
  /([)}\]])/,
  new RegExp(`([${BAR_CHARS}])`),
  /(:=|[=←→↦⟵⟶])/,
  /([-+*/^,−–—‒·×∙÷∕])/,
  /([\s\S])/,
].map((part) => part.source).join('|'), 'iy');

function nameKind(name, mode) {
  if (FUNCS[name]) return 'func';
  if (mode.vars[name]) return 'var';
  if (CONSTS[name]) return 'const';
  if (mode.strangers.has(name)) return 'bad';
  return 'unknown';
}

const superKind = (plain, mode) =>
  (/\d/.test(plain) ? 'num' : /[-+]/.test(plain) ? 'op' : nameKind(plain, mode));

// An index the iteration cannot keep is as wrong as an unclosed bracket, so
// zₙ₋₉ is red where zₙ₋₁ is dim.
const indexKind = (text) =>
  (EARLIER_INDEX.test(text) && !reachable(stepsBack(text)) ? 'bad' : 'index');

const plainIndex = (plain) => plain === 'n' || plain === 'n+1'
  || (/^n-\d+$/.test(plain) && reachable(stepsBack(plain)));

const inBar = (open) => open.length > 0 && BAR_CHARS.includes(open[open.length - 1].text);

function paint(src, mode) {
  const s = String(src);
  const out = [];
  const open = [];
  let wantsValue = true;

  const add = (text, kind, depth) => {
    const tok = { text, kind };
    if (depth !== undefined) tok.depth = depth;
    out.push(tok);
    return tok;
  };

  PAINT.lastIndex = 0;
  while (PAINT.lastIndex < s.length) {
    const at = PAINT.lastIndex;
    const m = PAINT.exec(s);
    if (!m) { add(s.slice(at), 'bad'); break; }
    const text = m[0];
    if (m[1]) add(text, 'plain');
    else if (m[2]) { add(text, 'num'); wantsValue = false; }
    else if (m[3]) add(text, indexKind(text));
    else if (m[4]) {
      const kind = nameKind(text.toLowerCase(), mode);
      if (kind === 'unknown' && splitsIntoLetters(text.toLowerCase(), mode)) {
        for (const ch of text) add(ch, nameKind(ch.toLowerCase(), mode));
      } else add(text, kind);
      wantsValue = kind === 'func';
    } else if (m[5]) {
      for (const ch of text) add(ch, superKind(SUPER[ch], mode));
      wantsValue = false;
    } else if (m[6]) {
      const plain = [...text].map((ch) => SUB[ch]).join('');
      add(text, plainIndex(plain) ? 'index' : 'bad');
    } else if (m[7]) {
      open.push(add(text, 'nest', open.length));
      wantsValue = true;
    } else if (m[8]) {
      if (open.length && !inBar(open)) { open.pop(); add(text, 'nest', open.length); }
      else add(text, 'bad');
      wantsValue = false;
    } else if (m[9]) {
      const closes = !wantsValue && inBar(open);
      if (closes) { open.pop(); add(text, 'nest', open.length); }
      else open.push(add(text, 'nest', open.length));
      wantsValue = !closes;
    } else if (m[10]) { add(text, 'assign'); wantsValue = true; }
    else if (m[11]) { add(text, 'op'); wantsValue = true; }
    else add(text, 'bad');
  }

  for (const tok of open) { tok.kind = 'bad'; delete tok.depth; }
  return out;
}

export const formulaTokens = (src, extras = []) => paint(src, iteration(extras));
export const seedTokens = (src, extras = []) => paint(src, seed(extras));
