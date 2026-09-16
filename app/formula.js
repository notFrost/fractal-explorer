// Turns a typed iteration formula into a GLSL expression for the next z, and
// into the coloured token stream the editor paints behind the input. The same
// grammar reads the starting values of z and c, which speak x and y instead.

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

const names = (vars, strangers, message) => ({ vars, strangers: new Set(strangers), message });

const ITERATION = names(
  { z: 'z', c: 'c' },
  ['x', 'y'],
  'x and y are the point being checked, so they belong to the starting values of z and c',
);

const SEED = names(
  { x: 'vec2(p.x, 0.0)', y: 'vec2(p.y, 0.0)' },
  ['z', 'c'],
  'a starting value is built from x and y, not from z or c',
);

const MAX_LENGTH = 240;
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

const INDEX_SUBS = ['n', 'n+1'];
const INDEX = /(_\s*\(\s*n\s*\+\s*1\s*\)|_\s*\(\s*n\s*\)|_\s*n(?![a-z0-9]))/;

function normalize(src) {
  let s = String(src).trim().toLowerCase();
  s = s.replace(/[−–—‒]/g, '-').replace(/[·×∙]/g, '*').replace(/[÷∕]/g, '/');
  s = s.replace(BAR_ANY, '|');
  s = s.replace(/[{}[\]]/g, (ch) => BRACKETS[ch]);
  s = s.replace(/:=|[←→↦⟵⟶]/g, '=');
  s = s.replace(SUPER_RUN, (run) => `^(${[...run].map((ch) => SUPER[ch]).join('')})`);
  s = s.replace(SUB_RUN, (run) => `_(${[...run].map((ch) => SUB[ch]).join('')})`);
  s = s.replace(new RegExp(INDEX, 'g'), '');
  return s;
}

function rightHandSide(s) {
  const parts = s.split('=');
  if (parts.length > 2) fail('one = at most');
  if (parts.length === 2 && !parts[0].trim()) fail('there is nothing on the left of the =');
  const rhs = parts[parts.length - 1].trim();
  if (!rhs) fail('there is nothing to iterate');
  return rhs;
}

const LEX = /(\d+(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|([a-z]+)|([-+*/^(),|])|(\s+)|(.)/gy;

function lex(s) {
  const out = [];
  LEX.lastIndex = 0;
  while (LEX.lastIndex < s.length) {
    const at = LEX.lastIndex;
    const m = LEX.exec(s);
    if (!m) fail(`cannot read “${s[at]}”`);
    if (m[1]) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) out.push({ t: 'name', v: m[2] });
    else if (m[3]) out.push({ t: 'op', v: m[3] });
    else if (m[5]) fail(`cannot read “${m[5]}”`);
  }
  if (!out.length) fail('there is nothing to iterate');
  return out;
}

// Letters written side by side multiply, so x+yi reads as x + y·i. Only a run
// where every letter is known splits; anything else stays one name.
function letterValues(name, mode) {
  const parts = [...name].map((ch) => (
    mode.vars[ch] ? complex(mode.vars[ch]) : CONSTS[ch] ? CONSTS[ch]() : null
  ));
  return parts.every(Boolean) ? parts : null;
}

const splitsIntoLetters = (name, mode) =>
  name.length > 1 && [...name].every((ch) => mode.vars[ch] || CONSTS[ch] || mode.strangers.has(ch));

function compile(tokens, mode) {
  let i = 0;
  let nodes = 0;
  let openBars = 0;

  const peek = () => tokens[i];
  const grow = () => { if (++nodes > MAX_NODES) fail('that formula has too many terms'); };
  const eat = (v) => {
    const t = tokens[i];
    if (t && t.t === 'op' && t.v === v) { i++; return true; }
    return false;
  };

  const startsValue = (t) =>
    !!t && (t.t === 'num' || t.t === 'name'
      || (t.t === 'op' && (t.v === '(' || (t.v === '|' && openBars === 0))));

  function insideBrackets(parse) {
    const outer = openBars;
    openBars = 0;
    const v = parse();
    openBars = outer;
    return v;
  }

  function call(name, arg) {
    grow();
    return complex(`${FUNCS[name]}(${arg.code})`);
  }

  function sum(a, b, op) {
    grow();
    if (a.num !== null && b.num !== null) return real(op === '+' ? a.num + b.num : a.num - b.num);
    return complex(`(${a.code} ${op} ${b.code})`);
  }

  function product(a, b) {
    grow();
    if (a.num !== null && b.num !== null) return real(a.num * b.num);
    if (a.num !== null) return complex(`(${glslFloat(a.num)} * ${b.code})`);
    if (b.num !== null) return complex(`(${a.code} * ${glslFloat(b.num)})`);
    return complex(`cmul(${a.code}, ${b.code})`);
  }

  function quotient(a, b) {
    grow();
    if (b.num !== null) {
      if (b.num === 0) fail('division by zero');
      return a.num !== null ? real(a.num / b.num) : complex(`(${a.code} / ${glslFloat(b.num)})`);
    }
    return complex(`cdiv(${a.code}, ${b.code})`);
  }

  function power(a, b) {
    grow();
    if (b.num !== null && Number.isInteger(b.num) && Math.abs(b.num) <= 64) {
      if (b.num === 1) return a;
      if (b.num === 2) return complex(`csq(${a.code})`);
      return complex(`cpowi(${a.code}, ${b.num})`);
    }
    return complex(`cpow(${a.code}, ${b.code})`);
  }

  function expr(depth) {
    if (depth > MAX_DEPTH) fail('that formula nests too deeply');
    let a = term(depth + 1);
    for (;;) {
      if (eat('+')) a = sum(a, term(depth + 1), '+');
      else if (eat('-')) a = sum(a, term(depth + 1), '-');
      else return a;
    }
  }

  function term(depth) {
    let a = unary(depth);
    for (;;) {
      if (eat('*')) a = product(a, unary(depth + 1));
      else if (eat('/')) a = quotient(a, unary(depth + 1));
      else if (startsValue(peek())) a = product(a, unary(depth + 1));
      else return a;
    }
  }

  function unary(depth) {
    if (depth > MAX_DEPTH) fail('that formula nests too deeply');
    if (eat('+')) return unary(depth + 1);
    if (eat('-')) {
      const v = unary(depth + 1);
      grow();
      return v.num !== null ? real(-v.num) : complex(`(-${v.code})`);
    }
    const a = atom(depth);
    return eat('^') ? power(a, unary(depth + 1)) : a;
  }

  function atom(depth) {
    const t = peek();
    if (!t) fail('the formula stops early');
    if (t.t === 'num') { i++; return real(t.v); }
    if (t.t === 'name') {
      i++;
      const name = t.v;
      if (FUNCS[name]) {
        if (!eat('(')) fail(`${name} needs a bracket, as in ${name}(z)`);
        const arg = insideBrackets(() => expr(depth + 1));
        if (eat(',')) fail(`${name} takes one value`);
        if (!eat(')')) fail(`the bracket after ${name} is not closed`);
        return call(name, arg);
      }
      if (mode.vars[name]) return complex(mode.vars[name]);
      if (CONSTS[name]) return CONSTS[name]();
      if (mode.strangers.has(name)) fail(mode.message);
      const letters = name.length > 1 ? letterValues(name, mode) : null;
      if (letters) return letters.reduce((a, b) => product(a, b));
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
      return call('abs', inner);
    }
    fail(`“${t.v}” is out of place`);
  }

  const out = expr(0);
  if (i < tokens.length) fail(`“${tokens[i].v}” is out of place`);
  return out;
}

function parse(src, mode) {
  if (String(src).trim().length > MAX_LENGTH) fail('that formula is too long');
  const rhs = rightHandSide(normalize(src));
  if (rhs.includes('_')) fail('only zₙ and zₙ₊₁ are understood, not earlier terms like zₙ₋₁');
  return { glsl: compile(lex(rhs), mode).code, text: rhs };
}

export const parseFormula = (src) => parse(src, ITERATION);
export const parseSeed = (src) => parse(src, SEED);

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
    else if (m[3]) add(text, 'index');
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
      add(text, INDEX_SUBS.includes(plain) ? 'index' : 'bad');
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

export const formulaTokens = (src) => paint(src, ITERATION);
export const seedTokens = (src) => paint(src, SEED);
