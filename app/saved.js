import { SETS, FLOAT_LOG_ZOOM } from './fractals.js';
import { SHADERS, COST } from './shaders/registry.js';
import { ORBITS } from './precision.js';

const STORE = 'saved-fractals';

const readable = (f) => f && typeof f === 'object'
  && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.formula === 'string';

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

export function freeId(list) {
  const taken = new Set(list.map((f) => f.id));
  for (let n = 1; ; n++) {
    const id = `saved${n}`;
    if (!taken.has(id) && !SETS[id]) return id;
  }
}

export function registerSet(id, { name, formula, home }) {
  SETS[id] = { name, formula, custom: true, maxLogZoom: FLOAT_LOG_ZOOM, home, bookmarks: [] };
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
