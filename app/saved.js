import { SETS, FLOAT_LOG_ZOOM } from './fractals.js';
import { SHADERS, COST } from './shaders/registry.js';
import { ORBITS } from './precision.js';

const STORE = 'saved-fractals';

const readableVar = (v) => v && typeof v === 'object'
  && typeof v.name === 'string' && typeof v.seed === 'string';

const readable = (f) => f && typeof f === 'object'
  && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.formula === 'string'
  && (f.vars === undefined || (Array.isArray(f.vars) && f.vars.every(readableVar)));

export function readSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(list) ? list.filter(readable) : [];
  } catch {
    return [];
  }
}

export function writeSaved(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    return null;
  } catch {
    return 'this browser would not store it';
  }
}

// Counts up rather than filling gaps, so a hash saved against a deleted
// fractal does not open a different one.
export function freeId(list) {
  const used = list.map((f) => Number(/^saved(\d+)$/.exec(f.id)?.[1] ?? 0));
  let n = Math.max(0, ...used) + 1;
  while (SETS[`saved${n}`]) n++;
  return `saved${n}`;
}

export function registerSet(id, { name, formula, home, edit }) {
  SETS[id] = { name, formula, custom: true, maxLogZoom: FLOAT_LOG_ZOOM, home, edit, bookmarks: [] };
  SHADERS[id] = { float: id };
  COST[id] = COST.custom;
  ORBITS[id] = ORBITS.custom;
}

export function unregisterSet(id) {
  delete SETS[id];
  delete SHADERS[id];
  delete COST[id];
  delete ORBITS[id];
}
