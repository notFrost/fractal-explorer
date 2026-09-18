// The menu's grid of cards. Everything under #cards belongs here: a card per
// set, the folders they can be filed under, and the drag that moves both.
// Thumbnails are painted by whoever owns the GL canvas, through repaint.

import { SETS } from './fractals.js';
import { readLayout, writeLayout, reconcile, freeFolderId, freeFolderName } from './library.js';

// Pixels of travel before a press on a grip becomes a drag, rather than a
// click that happened to wander.
const LIFT = 4;

// How near the window edge a drag scrolls the page, and how fast.
const EDGE = 96;
const EDGE_SPEED = 16;

const SVG_NS = 'http://www.w3.org/2000/svg';

const isFolder = (el) => el.classList.contains('folder');
const isOpen = (folder) => folder.querySelector('.folder-fold').getAttribute('aria-expanded') === 'true';
const folderName = (folder) => folder.querySelector('.folder-name').value;

// `custom` is the editor's own set, rendered from whatever is in the fields.
// It has no card, so it is not part of the arrangement either.
const menuSets = () => Object.keys(SETS).filter((id) => id !== 'custom');

export function createGrid({ list, note, deletable, onOpen, onEdit, onDelete, repaint }) {
  const say = (text) => { note.textContent = text; };

  // ---------- Building ----------

  function cardSlot(set) {
    const li = document.createElement('li');
    li.className = 'card-slot';
    li.dataset.item = set;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.set = set;
    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    thumb.width = 240;
    thumb.height = 180;
    thumb.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = SETS[set].name;
    const formula = document.createElement('span');
    formula.className = 'card-formula';
    formula.textContent = SETS[set].formula;
    card.append(thumb, name, formula);
    card.addEventListener('click', () => onOpen(set));

    // The card is transformed for its wobble, which lifts it into the same
    // painting layer as the tools over it, so the tools come after it.
    li.append(card, grip(li, SETS[set].name), editControl(set));
    if (deletable(set)) li.append(...deleteControls(set, li));
    return li;
  }

  // Every card has one. A set whose iteration the editor cannot write is
  // greyed, and says why rather than going quiet.
  function editControl(set) {
    const { name, edit, unwritable } = SETS[set];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-tool card-edit';
    btn.textContent = 'Edit';
    btn.disabled = !edit;
    btn.title = edit ? `Edit ${name}` : unwritable;
    btn.setAttribute('aria-label', edit ? `Edit ${name}` : `Edit ${name}: ${unwritable}`);
    btn.addEventListener('click', () => onEdit(set));
    return btn;
  }

  // The × and the question that replaces it are siblings of the card, since a
  // button cannot hold another one.
  function deleteControls(set, slot) {
    const question = `Delete ${SETS[set].name}?`;
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'card-tool card-delete';
    ask.title = question;
    ask.setAttribute('aria-label', question);
    ask.textContent = '×';

    const panel = document.createElement('div');
    panel.className = 'card-confirm';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', question);
    const text = document.createElement('p');
    text.className = 'card-confirm-text';
    text.textContent = question;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn-accent';
    yes.textContent = 'Delete';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn';
    no.textContent = 'Cancel';
    const row = document.createElement('div');
    row.className = 'card-confirm-row';
    row.append(yes, no);
    panel.append(text, row);

    const open = (on) => {
      panel.hidden = !on;
      ask.hidden = on;
      slot.classList.toggle('asking', on);
      (on ? yes : ask).focus();
    };
    const close = () => open(false);
    ask.addEventListener('click', () => open(true));
    no.addEventListener('click', close);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    yes.addEventListener('click', () => onDelete(set));
    return [ask, panel];
  }

  function folderSlot({ id, name, open, items }) {
    const li = document.createElement('li');
    li.className = 'folder';
    li.dataset.item = id;

    const head = document.createElement('div');
    head.className = 'folder-head';

    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'folder-fold';
    fold.setAttribute('aria-controls', `${id}-items`);

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'folder-name';
    label.value = name;
    label.maxLength = 40;
    label.spellcheck = false;
    label.title = 'Rename the folder';
    label.setAttribute('aria-label', `Folder name: ${name}`);

    const count = document.createElement('span');
    count.className = 'folder-count';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'card-tool folder-remove';
    remove.textContent = '×';

    const inner = document.createElement('ul');
    inner.className = 'cards folder-cards';
    inner.id = `${id}-items`;
    inner.setAttribute('aria-label', `Fractals in ${name}`);
    inner.append(...items.map(cardSlot));

    const handle = grip(li, `the ${name} folder`);
    head.append(handle, fold, label, count, remove);
    li.append(head, inner);

    // The name rides in four labels, so a rename refreshes all of them.
    const relabel = () => {
      const now = label.value;
      label.setAttribute('aria-label', `Folder name: ${now}`);
      inner.setAttribute('aria-label', `Fractals in ${now}`);
      setHandleLabel(handle, `the ${now} folder`);
      remove.title = `Remove ${now}. Its fractals go back on the menu.`;
      remove.setAttribute('aria-label', remove.title);
      fold.title = isOpen(li) ? `Fold ${now} away` : `Open ${now}`;
      fold.setAttribute('aria-label', fold.title);
    };

    const setOpen = (on) => {
      fold.setAttribute('aria-expanded', String(on));
      fold.textContent = on ? '▾' : '▸';
      inner.hidden = !on;
      li.classList.toggle('folded', !on);
      relabel();
    };

    setOpen(open);

    fold.addEventListener('click', () => {
      const now = !isOpen(li);
      setOpen(now);
      save();
      if (now) repaint();
    });

    // A blank name would leave nothing to grab or read, so it goes back to
    // what it was called.
    let called = name;
    label.addEventListener('change', () => {
      label.value = label.value.trim() || called;
      called = label.value;
      relabel();
      save();
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });

    // Removing a folder is not removing what is in it: the cards take the
    // folder's own place in the menu, so nothing moves far.
    remove.addEventListener('click', () => {
      const spilled = [...inner.children];
      const at = [...list.children].indexOf(li);
      li.replaceWith(...spilled);
      save();
      // The folder's grid is inset from the menu's, so the cards it held come
      // out a size wider and are drawn again.
      repaint();
      say(`${called} removed. ${spilled.length ? 'Its fractals are back on the menu.' : ''}`.trim());
      focusNear(at);
    });

    return li;
  }

  // The drag handle. It is a button so it can be tabbed to and stepped with
  // the arrow keys; the pointer drag hangs off it as well.
  function grip(slot, what) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-tool card-grip';
    setHandleLabel(btn, what);

    const icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '14');
    icon.setAttribute('height', '14');
    icon.setAttribute('aria-hidden', 'true');
    for (const [cx, cy] of [[5.5, 3.5], [10.5, 3.5], [5.5, 8], [10.5, 8], [5.5, 12.5], [10.5, 12.5]]) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dot.setAttribute('r', '1.5');
      dot.setAttribute('fill', 'currentColor');
      icon.append(dot);
    }
    btn.append(icon);

    btn.addEventListener('pointerdown', (e) => beginDrag(slot, btn, e));
    btn.addEventListener('keydown', (e) => {
      const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      step(slot, dir);
      btn.focus();
    });
    return btn;
  }

  function setHandleLabel(btn, what) {
    btn.title = `Move ${what}`;
    btn.setAttribute('aria-label', `Move ${what}. Drag it, or step it with the arrow keys.`);
  }

  // ---------- Reading the grid back ----------

  const slotOf = (set) => list.querySelector(`.card-slot[data-item="${set}"]`);

  // The grid is the arrangement. A move rewrites the DOM and this reads it
  // back, so the two cannot drift apart.
  function layoutFromDom() {
    return [...list.children].map((li) => {
      if (!isFolder(li)) return li.dataset.item;
      return {
        id: li.dataset.item,
        name: folderName(li),
        open: isOpen(li),
        items: [...li.querySelector('.folder-cards').children].map((c) => c.dataset.item),
      };
    });
  }

  function countFolders() {
    for (const folder of list.querySelectorAll('.folder')) {
      const n = folder.querySelector('.folder-cards').children.length;
      folder.querySelector('.folder-count').textContent = n === 1 ? '1 fractal' : n ? `${n} fractals` : 'empty';
    }
  }

  function save() {
    countFolders();
    const err = writeLayout(layoutFromDom());
    if (err) say(err);
  }

  function announce(slot) {
    const kin = [...slot.parentElement.children];
    const what = isFolder(slot) ? `The ${folderName(slot)} folder` : SETS[slot.dataset.item].name;
    const folder = slot.parentElement === list ? null : slot.closest('.folder');
    const where = folder ? ` in ${folderName(folder)}` : '';
    say(`${what}: ${kin.indexOf(slot) + 1} of ${kin.length}${where}.`);
  }

  // Focus after something leaves the top level, so the keyboard is not left
  // on nothing.
  function focusNear(at) {
    const kin = [...list.children];
    const near = kin[at] ?? kin[at - 1];
    (near?.querySelector('.card-grip') ?? list.querySelector('.card'))?.focus();
  }

  // ---------- Stepping with the keyboard ----------

  // One position along the grid, in reading order. A card at the edge of a
  // folder steps out of it, and one beside an open folder steps in, so the
  // arrows reach every place a drag can. A folded folder is stepped over
  // whole: filing into one you cannot see would lose the card and the focus.
  function step(slot, dir) {
    const back = dir < 0;
    const put = (target) => target[back ? 'before' : 'after'](slot);
    const sib = back ? slot.previousElementSibling : slot.nextElementSibling;
    const from = slot.parentElement;

    if (isFolder(slot)) {
      if (!sib) return;
      put(sib);
    } else if (slot.parentElement !== list) {
      put(sib ?? slot.closest('.folder'));
    } else if (!sib) {
      return;
    } else if (isFolder(sib) && isOpen(sib)) {
      const inner = sib.querySelector('.folder-cards');
      if (back) inner.append(slot);
      else inner.prepend(slot);
    } else {
      put(sib);
    }

    announce(slot);
    save();
    // A folder's grid is inset from the menu's, so a card only needs drawing
    // again when it crosses between the two. Held arrow keys repeat, and a
    // repaint on each would redraw every card on the menu.
    if (slot.parentElement !== from) repaint();
  }

  // ---------- Dragging with a pointer ----------

  let drag = null;

  // The rest of the drag is followed on the window rather than on the grip.
  // A drag moves the slot the grip is in, and moving an element takes any
  // pointer capture with it, so a captured grip would go deaf halfway.
  function beginDrag(slot, handle, e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    handle.focus();
    drag = { slot, handle, from: slot.parentElement, id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, ghost: null, edge: 0 };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  // The lifted slot stays where it is, dimmed, and is itself the gap the drop
  // will fill; what follows the pointer is a copy. A cloned canvas comes up
  // blank, so each thumbnail is painted across.
  function lift() {
    const { slot } = drag;
    const r = slot.getBoundingClientRect();
    const ghost = slot.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-item');
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    const from = slot.querySelectorAll('canvas');
    ghost.querySelectorAll('canvas').forEach((c, i) => {
      c.width = from[i].width;
      c.height = from[i].height;
      if (c.width && c.height) c.getContext('2d').drawImage(from[i], 0, 0);
    });
    document.body.append(ghost);
    document.body.classList.add('dragging');
    slot.classList.add('lifted');
    drag.ghost = ghost;
    requestAnimationFrame(driftEdge);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < LIFT) return;
      lift();
    }
    drag.px = e.clientX;
    drag.py = e.clientY;
    drag.ghost.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
    drag.edge = e.clientY < EDGE ? -1 : e.clientY > window.innerHeight - EDGE ? 1 : 0;
    dropAt(e.clientX, e.clientY);
  }

  // Held near an edge the page keeps scrolling, with no pointer movement to
  // drive it. The ghost is positioned in the window rather than the page, so
  // it stays under the pointer while the grid slides past.
  function driftEdge() {
    if (!drag?.ghost) return;
    if (drag.edge) {
      window.scrollBy(0, drag.edge * EDGE_SPEED);
      dropAt(drag.px, drag.py);
    }
    requestAnimationFrame(driftEdge);
  }

  const before = (slot, target) => {
    if (target.previousElementSibling === slot) return;
    target.before(slot);
  };
  const after = (slot, target) => {
    if (target.nextElementSibling === slot) return;
    target.after(slot);
  };

  // Where the slot would land if the pointer let go here. It moves there now,
  // so the grid shows the answer rather than promising it.
  function dropAt(x, y) {
    const { slot } = drag;
    const under = document.elementFromPoint(x, y);
    if (!under || slot.contains(under)) return;

    const card = under.closest('.card-slot');
    const folder = under.closest('.folder');

    if (isFolder(slot)) {
      // A folder holds no folders, so it lands between top-level entries: the
      // one under the pointer, or the folder a card under it is filed in.
      const top = folder ?? (card?.parentElement === list ? card : null);
      if (top && top !== slot) {
        const r = top.getBoundingClientRect();
        (y < r.top + r.height / 2 ? before : after)(slot, top);
      } else if (under.closest('.cards') === list) {
        list.append(slot);
      }
      return;
    }

    if (card && card !== slot) {
      // Reading order runs across the row, so the half of the card the
      // pointer is on decides which side of it the slot goes.
      const r = card.getBoundingClientRect();
      (x < r.left + r.width / 2 ? before : after)(slot, card);
      return;
    }
    if (folder) {
      // Anywhere else on a folder files it in, folded away or not.
      const inner = folder.querySelector('.folder-cards');
      if (slot.parentElement !== inner) inner.append(slot);
      return;
    }
    if (under.closest('.cards') === list && slot.parentElement !== list) list.append(slot);
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { slot, handle, ghost, from } = drag;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    drag = null;
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove('dragging');
    slot.classList.remove('lifted');
    announce(slot);
    save();
    if (slot.parentElement !== from) repaint();
    // Moving the slot took the grip out of the document and back, which drops
    // the focus that was on it. The drop hands it back, so the arrow keys
    // carry on from where the card landed.
    handle.focus();
  }

  // ---------- The menu as it stands ----------

  list.replaceChildren(...reconcile(readLayout(), menuSets())
    .map((e) => (typeof e === 'string' ? cardSlot(e) : folderSlot(e))));
  countFolders();

  return {
    // A newly saved fractal joins the end of the menu, outside any folder.
    add(set) {
      list.append(cardSlot(set));
      save();
    },
    remove(set) {
      slotOf(set)?.remove();
      save();
    },
    // An edited fractal keeps its place, and its card is rebuilt around the
    // new name and formula.
    replace(set) {
      slotOf(set)?.replaceWith(cardSlot(set));
    },
    focus(set) {
      const slot = slotOf(set);
      if (!slot) return;
      const folder = slot.closest('.folder');
      if (folder && !isOpen(folder)) folder.querySelector('.folder-fold').click();
      slot.querySelector('.card').focus();
    },
    addFolder() {
      const layout = layoutFromDom();
      const name = freeFolderName(layout);
      const li = folderSlot({ id: freeFolderId(layout), name, open: true, items: [] });
      list.append(li);
      save();
      say(`${name} added. Drag a fractal onto it, or step one in with the arrow keys.`);
      const label = li.querySelector('.folder-name');
      label.focus();
      label.select();
    },
  };
}
