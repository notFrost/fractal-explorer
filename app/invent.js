// Where a formula comes from when nobody types one: a line drawn at random,
// or the line already in the field moved a step sideways.
//
// Both work on the tree formula.js parses into rather than on text, so what
// comes back always reads. Text put together at random would mostly not
// parse, and what did would rarely mean anything.
//
// A draw is not uniform over what the grammar can say. Escape-time fractals
// worth looking at are nearly all a power of z twisted somehow plus a
// parameter, so that is the shape most draws take. The rarer shapes, a
// second term, a quotient or a wave, sit behind it. Nothing here says
// whether a draw actually drew anything; framing.js measures that, and the
// caller draws several and keeps the best.

import {
  numeral, constant, variable, earlierZ, apply, bars, negate, plus, minus, times, over, power,
  branches, regrow, printFormula, MAX_LENGTH, MAX_EARLIER,
} from './formula.js';

const pick = (random, list) => list[Math.floor(random() * list.length)];
const chance = (random, odds) => random() < odds;

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const z = () => variable('z');
const c = () => variable('c');

// The line may keep earlier steps of the orbit, as Webb does, but a draw
// reaching eight of them back would be a formula nobody could read and eight
// starting values to fill in.
const FURTHEST_BACK = Math.min(2, MAX_EARLIER);

const backStep = (random) => earlierZ(1 + Math.floor(random() * FURTHEST_BACK));

// ---------- Drawing a formula ----------

// What the powered term is made of before it is raised, or after. Plain
// carries the weight: every twist is a departure from z² + c, and two
// departures at once mostly cancel into mush.
const PLAIN = (t) => t;
const CONJUGATE = (t) => apply('conj', t);
const SHIP = (t) => plus(bars(apply('re', t)), times(constant('i'), bars(apply('im', t)), true));
const PERPENDICULAR = (t) => minus(apply('re', t), times(constant('i'), bars(apply('im', t)), true));
const HALF_SHIP = (t) => plus(bars(apply('re', t)), times(constant('i'), apply('im', t), true));
const SIZE = (t) => bars(t);

const TWISTS = [
  PLAIN, PLAIN, PLAIN, PLAIN, PLAIN, PLAIN,
  CONJUGATE, CONJUGATE,
  SHIP, SHIP,
  PERPENDICULAR, PERPENDICULAR,
  HALF_SHIP,
  SIZE,
];

const POWERS = [2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8];
const SMALL_POWERS = [2, 2, 3, 3, 4];
const WEIGHTS = [0.25, 0.5, 0.75, 1.5, 2, 3];
const OFFSETS = [0.25, 0.5, 1, 2];
const WAVES = ['sin', 'cos', 'sinh', 'cosh', 'tan', 'exp'];
const STANDING_WAVES = ['cos', 'cosh', 'exp'];

const scaled = (random, term) => times(numeral(pick(random, WEIGHTS)), term, true);

// The power of z the orbit turns on. The twist goes inside it or around it,
// which is the difference between the Burning Ship and the Celtic.
function driver(random) {
  const twist = pick(random, TWISTS);
  const exponent = numeral(pick(random, POWERS));
  return chance(random, 0.5)
    ? power(twist(z()), exponent)
    : twist(power(z(), exponent));
}

const TAILS = [
  () => c(),
  () => c(),
  () => c(),
  () => c(),
  () => c(),
  () => c(),
  () => apply('conj', c()),
  () => negate(c()),
  () => times(constant('i'), c(), true),
  (random) => scaled(random, c()),
  (random) => power(c(), numeral(pick(random, SMALL_POWERS))),
];

const tail = (random) => pick(random, TAILS)(random);

const joined = (random) => (chance(random, 0.5) ? plus : minus);

function polynomial(random) {
  return plus(driver(random), tail(random));
}

function twoTerms(random) {
  const lesser = scaled(random, power(z(), numeral(pick(random, SMALL_POWERS))));
  return plus(joined(random)(driver(random), lesser), tail(random));
}

// A pole somewhere in the orbit. The divisor is always held off zero, since
// z starts there: c/z² is the best known of these and it is also the one that
// divides by nothing on the first step and takes the picture with it.
function quotient(random) {
  const divisor = joined(random)(
    power(z(), numeral(pick(random, SMALL_POWERS))),
    numeral(pick(random, OFFSETS)),
  );
  return chance(random, 0.5)
    ? plus(driver(random), over(c(), divisor))
    : plus(over(driver(random), divisor), c());
}

// Webb's shape: the step before last carried alongside the square. The pixel
// still enters through c, since a line that only reads earlier steps starts
// every orbit from the same pair of values.
function reachesBack(random) {
  const carried = chance(random, 0.5) ? backStep(random) : scaled(random, backStep(random));
  return plus(joined(random)(driver(random), carried), tail(random));
}

// A wave multiplied by the parameter has to be one that is not zero at zero,
// or an orbit starting at zero never leaves it. Added to a parameter, any of
// them will do.
function wave(random) {
  if (chance(random, 0.5)) return times(c(), apply(pick(random, STANDING_WAVES), z()));
  return plus(apply(pick(random, WAVES), pick(random, TWISTS)(z())), tail(random));
}

const SHAPES = [
  polynomial, polynomial, polynomial, polynomial,
  twoTerms, twoTerms,
  quotient, wave, reachesBack,
];

export const inventFormula = (random = Math.random) => pick(random, SHAPES)(random);

// ---------- Moving a formula one step ----------

function nodesOf(tree) {
  const out = [];
  const walk = (node, parent) => {
    out.push({ node, parent });
    for (const field of branches(node)) walk(node[field], node);
  };
  walk(tree, null);
  return out;
}

// The same walk, numbering the same way, with one node put through `change`.
function replaceAt(tree, target, change) {
  let seen = 0;
  const walk = (node) => {
    const here = seen++;
    const grown = regrow(node, branches(node).map((field) => walk(node[field])));
    return here === target ? change(grown) : grown;
  };
  return walk(tree);
}

const holds = (tree, name) =>
  nodesOf(tree).some(({ node }) => node.k === 'var' && node.name === name);

// An earlier step is the orbit too, so z^2 tweaked into zₙ₋₁^2 still moves.
const movesOrbit = (tree) =>
  holds(tree, 'z') || nodesOf(tree).some(({ node }) => node.k === 'earlier');

const wrappedIn = (parent, fn) => Boolean(parent) && parent.k === 'call' && parent.fn === fn;

const isExponent = (node, parent) => Boolean(parent) && parent.k === 'pow' && parent.b === node;

// An exponent one step along, in either direction, and now and then somewhere
// else entirely. 0 leaves a constant and 1 leaves a straight line, so neither
// is an exponent worth landing on.
function otherPower(was, random) {
  const choices = [was - 1, was + 1, was + 1, was + 2, -was, ...POWERS]
    .filter((n) => n !== was && n !== 0 && n !== 1 && Math.abs(n) <= 12);
  return pick(random, choices);
}

function otherNumber(was, random) {
  const choices = [was * 2, was / 2, -was, was + 0.5, was - 0.5, was + 1]
    .filter((n) => n !== was && n !== 0 && Math.abs(n) <= 100);
  return choices.length ? pick(random, choices) : was + 1;
}

const FAMILIES = [
  ['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh'],
  ['re', 'im'],
  ['exp', 'log', 'sqrt'],
];

const familyOf = (fn) => FAMILIES.find((family) => family.includes(fn));

const SPRIGS = [
  (random) => numeral(pick(random, OFFSETS)),
  (random) => scaled(random, backStep(random)),
  (random) => scaled(random, power(z(), numeral(pick(random, SMALL_POWERS)))),
  (random) => scaled(random, power(z(), numeral(pick(random, SMALL_POWERS)))),
];

const sprig = (random) => pick(random, SPRIGS)(random);

// One small change each, and each one leaves a formula that still reads. What
// a change cannot promise is that the picture survives it, so the caller
// tries a few and keeps whichever drew best.
const TWEAKS = [
  {
    fits: (node) => node.k === 'pow' && node.b.k === 'num' && Number.isInteger(node.b.v),
    change: (node, random) => power(node.a, numeral(otherPower(node.b.v, random))),
  },
  {
    fits: (node) => node.k === 'var' && node.name === 'z',
    change: (node, random) => power(node, numeral(pick(random, SMALL_POWERS))),
  },
  {
    fits: (node, parent) => !wrappedIn(parent, 'abs')
      && (node.k === 'var' || (node.k === 'call' && (node.fn === 're' || node.fn === 'im'))),
    change: (node) => bars(node),
  },
  {
    fits: (node) => node.k === 'call' && node.fn === 'abs',
    change: (node) => node.arg,
  },
  {
    fits: (node) => node.k === 'call' && node.fn === 'conj',
    change: (node) => node.arg,
  },
  {
    fits: (node, parent) => node.k === 'var' && !wrappedIn(parent, 'conj'),
    change: (node) => apply('conj', node),
  },
  {
    fits: (node) => ['add', 'mul', 'div', 'pow'].includes(node.k),
    change: (node, random) => joined(random)(node, sprig(random)),
  },
  {
    fits: (node) => node.k === 'add',
    change: (node, random) => (chance(random, 0.5) ? node.a : node.b),
  },
  {
    fits: (node) => node.k === 'add',
    change: (node) => (node.op === '+' ? minus : plus)(node.a, node.b),
  },
  {
    fits: (node) => node.k === 'call' && Boolean(familyOf(node.fn)),
    change: (node, random) =>
      apply(pick(random, familyOf(node.fn).filter((fn) => fn !== node.fn)), node.arg),
  },
  {
    fits: (node, parent) => node.k === 'num' && !isExponent(node, parent),
    change: (node, random) => numeral(otherNumber(node.v, random)),
  },
  {
    fits: (node) => node.k === 'var' && (node.name === 'z' || node.name === 'c'),
    change: (node) => variable(node.name === 'z' ? 'c' : 'z'),
  },
  {
    fits: (node) => node.k === 'earlier' && FURTHEST_BACK > 1,
    change: (node) => earlierZ(node.steps > 1 ? node.steps - 1 : 2),
  },
  {
    fits: (node, parent) => (node.k === 'pow' || node.k === 'call') && parent?.k !== 'mul',
    change: (node, random) => scaled(random, node),
  },
];

function stepped(tree, random) {
  const here = nodesOf(tree);
  for (const tweak of shuffled(TWEAKS, random)) {
    const spots = here.flatMap(({ node, parent }, at) => (tweak.fits(node, parent) ? [at] : []));
    if (spots.length) {
      return replaceAt(tree, pick(random, spots), (node) => tweak.change(node, random));
    }
  }
  return tree;
}

const ATTEMPTS = 12;

// Each tweak nests one more bracket at the spot it lands on, so pressing the
// button all afternoon walks the line towards the depth the parser stops
// reading at. Past this, the only tweaks that get through are the ones that
// leave the nesting where it is or take it back, such as a bar dropped, a
// term gone or an exponent changed. A line already deeper than this is
// never made deeper.
const DEEPEST = 12;

const deepest = (node) => 1 + Math.max(0, ...branches(node).map((field) => deepest(node[field])));

// A tweak that drops the last c leaves every pixel with the same orbit, and
// one that drops the last z, earlier steps and all, leaves no orbit at all. Either way there is
// nothing to look at, so the draw is taken again. Null when a dozen draws all
// came back to where they started.
export function tweakFormula(tree, random = Math.random) {
  const was = printFormula(tree);
  const room = Math.max(DEEPEST, deepest(tree));
  const needsC = holds(tree, 'c');
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let next = stepped(tree, random);
    if (chance(random, 0.4)) next = stepped(next, random);
    if (!movesOrbit(next) || (needsC && !holds(next, 'c')) || deepest(next) > room) continue;
    const line = printFormula(next);
    if (line !== was && line.length <= MAX_LENGTH) return next;
  }
  return null;
}
