// How the menu is arranged: the order the cards sit in, and the folders some
// of them are filed under. Kept in this browser beside the saved fractals, so
// it survives a reload but does not travel with a link.

const STORE = 'library';

// An entry is a set id, or a folder holding set ids. Folders hold no folders.
const readableFolder = (e) => e !== null && typeof e === 'object'
  && typeof e.id === 'string' && typeof e.name === 'string'
  && Array.isArray(e.items) && e.items.every((i) => typeof i === 'string');

const readable = (e) => typeof e === 'string' || readableFolder(e);

export function readLayout() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(list) ? list.filter(readable) : [];
  } catch {
    return [];
  }
}

export function writeLayout(layout) {
  try {
    localStorage.setItem(STORE, JSON.stringify(layout));
    return null;
  } catch {
    return 'this browser would not store the arrangement';
  }
}

// A stored arrangement goes stale: a saved fractal is deleted, an update
// brings a new built-in set, a formula fails to compile on this GPU. So the
// arrangement is read against the sets the app actually has. An id it does not
// know is dropped, an id filed twice keeps its first place, and a set the
// arrangement never mentions joins the end in the order `known` gives.
export function reconcile(layout, known) {
  const unplaced = new Set(known);
  const place = (id) => unplaced.delete(id);
  const out = [];
  for (const entry of layout) {
    if (typeof entry === 'string') {
      if (place(entry)) out.push(entry);
    } else {
      out.push({ ...entry, open: entry.open !== false, items: entry.items.filter(place) });
    }
  }
  out.push(...known.filter((id) => unplaced.has(id)));
  return out;
}

// Ids count up rather than filling the gap a removed folder leaves, so a
// folder's fold state never lands on a later folder.
export function freeFolderId(layout) {
  const used = layout.map((e) => Number(/^folder(\d+)$/.exec(e?.id ?? '')?.[1] ?? 0));
  return `folder${Math.max(0, ...used) + 1}`;
}

export function freeFolderName(layout) {
  const taken = new Set(layout.filter((e) => typeof e !== 'string').map((e) => e.name));
  for (let n = 1; ; n++) {
    const name = `Folder ${n}`;
    if (!taken.has(name)) return name;
  }
}
