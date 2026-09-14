// PROTOTYPE. Six colourways for the escape gradient, switchable on the live
// /app/ route via ?variant=<key>, with a floating bar at the bottom. The
// question: which 3–5 of these go into the app as palette options?
// Throwaway: lives on the prototype/colourways branch, not main.

export const VARIANTS = [
  { key: 'pen', name: 'Pen (current)', note: 'full-saturation hue wheel, the original', swatch: 'linear-gradient(90deg,#000,#0400ff 20%,#00ffff 35%,#00ff00 50%,#ffff00 65%,#ff0000 80%,#ff00ff 95%,#0400ff)' },
  { key: 'classic', name: 'Classic', note: 'navy → blue → white → orange → black, the Wikipedia look', swatch: 'linear-gradient(90deg,#000764,#206bcb 16%,#edffff 42%,#ffaa00 64%,#000200 86%,#000764)' },
  { key: 'ember', name: 'Ember', note: 'black → maroon → red-orange → amber → cream, folded', swatch: 'linear-gradient(90deg,#050000,#590808 12%,#d92e0a 25%,#ffb321 37%,#fff5d6 50%,#ffb321 63%,#d92e0a 75%,#590808 88%,#050000)' },
  { key: 'abyss', name: 'Abyss', note: 'deep sea → teal → sea green → foam → sand, folded', swatch: 'linear-gradient(90deg,#001219,#005f73 12%,#0a9396 25%,#94d2bd 37%,#e9d8a6 50%,#94d2bd 63%,#0a9396 75%,#005f73 88%,#001219)' },
  { key: 'ultraviolet', name: 'Ultraviolet', note: 'the site accents: pen blue → violet → magenta → pale pink', swatch: 'linear-gradient(90deg,#050014,#0400ff 20%,#7a00ff 45%,#ff2bd6 70%,#ffd6f5 90%,#050014)' },
  { key: 'ink', name: 'Ink', note: 'no hue: charcoal contour bands on paper', swatch: 'repeating-linear-gradient(90deg,#1f1e1a 0 6px,#ede8d9 6px 22px)' },
];

const CSS = `
.proto-bar {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
  z-index: 1000; display: flex; align-items: center; gap: 10px;
  padding: 8px 10px 8px 12px; border-radius: 999px;
  background: #fffbe6; color: #14121a; border: 2px solid #ff2bd6;
  box-shadow: 0 8px 30px rgba(0,0,0,.6);
  font: 13px/1.2 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  user-select: none;
}
.proto-bar b { font-weight: 700; }
.proto-bar .proto-tag { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #ff2bd6; }
.proto-bar button {
  width: 30px; height: 30px; border-radius: 50%; border: 1px solid #b9b3a0;
  background: #fff; color: #14121a; font: inherit; font-size: 16px; cursor: pointer;
}
.proto-bar button:hover { background: #ffe6f8; border-color: #ff2bd6; }
.proto-bar .proto-swatch { width: 120px; height: 14px; border-radius: 7px; border: 1px solid rgba(0,0,0,.25); }
.proto-bar .proto-label { display: flex; flex-direction: column; gap: 3px; min-width: 210px; }
.proto-bar .proto-note { color: #6b6680; font-size: 11px; }
.proto-bar .proto-keys { color: #6b6680; font-size: 11px; padding-left: 4px; border-left: 1px solid #ddd6c4; }
@media (max-width: 640px) { .proto-bar .proto-keys, .proto-bar .proto-note { display: none; } .proto-bar .proto-label { min-width: 0; } }
`;

function readVariant() {
  const v = new URLSearchParams(location.search).get('variant');
  if (v === null) return 0;
  const byKey = VARIANTS.findIndex((x) => x.key === v.toLowerCase());
  if (byKey >= 0) return byKey;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < VARIANTS.length ? n : 0;
}

// renderer: the app's Renderer, whose `palette` index the shader reads.
// onChange: re-render whatever screen is showing.
export function mountColourways({ renderer, onChange }) {
  if (!renderer) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const asked = new URLSearchParams(location.search).has('variant');
  if (!local && !asked) return; // stays out of the way of anyone who did not ask for it

  let i = readVariant();
  renderer.palette = i;

  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const bar = document.createElement('div');
  bar.className = 'proto-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Prototype colourway switcher');
  bar.innerHTML = `
    <span class="proto-tag">proto</span>
    <button type="button" class="proto-prev" title="Previous colourway ( , )" aria-label="Previous colourway">‹</button>
    <span class="proto-swatch"></span>
    <span class="proto-label"><b class="proto-name"></b><span class="proto-note"></span></span>
    <button type="button" class="proto-next" title="Next colourway ( . )" aria-label="Next colourway">›</button>
    <span class="proto-keys">, . cycle · 0–5 pick</span>`;
  document.body.append(bar);

  const name = bar.querySelector('.proto-name');
  const note = bar.querySelector('.proto-note');
  const swatch = bar.querySelector('.proto-swatch');

  function apply(next) {
    i = ((next % VARIANTS.length) + VARIANTS.length) % VARIANTS.length;
    const v = VARIANTS[i];
    renderer.palette = i;
    name.textContent = `${i} · ${v.name}`;
    note.textContent = v.note;
    swatch.style.background = v.swatch;
    const url = new URL(location.href);
    url.searchParams.set('variant', v.key);
    history.replaceState(null, '', url);
    onChange();
  }

  bar.querySelector('.proto-prev').addEventListener('click', () => apply(i - 1));
  bar.querySelector('.proto-next').addEventListener('click', () => apply(i + 1));

  // Arrow keys already pan the view, so the bar cycles on , and . instead.
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ',') apply(i - 1);
    else if (e.key === '.') apply(i + 1);
    else if (/^[0-5]$/.test(e.key)) apply(Number(e.key));
    else return;
    e.preventDefault();
  });

  // Paint the label without a second render: the caller renders on boot.
  const v = VARIANTS[i];
  name.textContent = `${i} · ${v.name}`;
  note.textContent = v.note;
  swatch.style.background = v.swatch;
}
