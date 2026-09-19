// The animation timeline: the strip of keyframes under the viewer, the
// playback that runs between them, and the export that writes a file.
//
// Everything a keyframe holds is taken from the view on screen, so the way to
// build an animation is the way to explore: pan, zoom and turn until the
// picture is worth keeping, press + Keyframe, and go somewhere else. A typed
// formula's own variables are part of that view, so two keyframes on one spot
// with a variable moved between them are a movie that holds still and watches
// the fractal itself change. The panel owns no camera of its own; it asks the
// viewer for one and hands sampled ones back.

import {
  EASINGS, DEFAULT_EASING, easingByKey, DEFAULT_SPAN,
  keyFrom, plan, sample, keyState, readAnimation, writeAnimation, readSettings, writeSettings,
  toText, fromText,
} from './keyframes.js';
import { QUALITIES, frameCount, trueFps, fitSize, bitrateFor, movieName, canEncodeMp4 } from './movie.js';
import { formatZoom } from './precision.js';
import { valueText } from './formula.js';

const THUMB_W = 128;
const THUMB_H = 96;

// Enough thumbnails for a long timeline redrawn a few times over. Each one is
// a 128×96 picture, so the whole cache is under two megabytes.
const THUMB_CACHE = 96;

const FORMATS = [
  { key: 'mp4', name: 'MP4 (H.264)' },
  { key: 'gif', name: 'GIF' },
];

const SIZES = [
  { key: 'window', name: 'This window' },
  { key: '640x480', width: 640, height: 480 },
  { key: '854x480', width: 854, height: 480 },
  { key: '1280x720', width: 1280, height: 720 },
  { key: '1920x1080', width: 1920, height: 1080 },
  { key: '2560x1440', width: 2560, height: 1440 },
  { key: '3840x2160', width: 3840, height: 2160 },
];

const RATES = [12, 15, 24, 25, 30, 50, 60];
const DETAILS = [1, 2, 4, 8];

// Bytes a GIF frame runs to per pixel, from measuring the encoder on fractal
// frames. It is a guess by nature — LZW pays for detail — so the estimate it
// feeds says "roughly" and the render prints the real figure as it goes.
const GIF_BYTES_PER_PIXEL = { plain: 0.3, dithered: 0.55 };

const DEFAULTS = {
  format: 'mp4',
  size: '1280x720',
  fps: 30,
  quality: 'good',
  dither: true,
  detail: 1,
};

const $ = (s) => document.querySelector(s);

const seconds = (v) => `${Number(v.toFixed(2))}`;

function saying(left) {
  if (left === null || !Number.isFinite(left)) return 'working out how long';
  if (left < 90) return `about ${Math.max(1, Math.round(left))} s left`;
  if (left < 5400) return `about ${Math.round(left / 60)} min left`;
  return `about ${(left / 3600).toFixed(1)} h left`;
}

const size = (bytes) => (bytes < 1e6
  ? `${Math.round(bytes / 1e3)} kB`
  : bytes < 1e9 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e9).toFixed(2)} GB`);

const shortNum = (s) => (s.length > 13 ? `${s.slice(0, 13)}…` : s);

const coordText = (key) => `${shortNum(key.x)} ${key.y.startsWith('-') ? '−' : '+'} ${shortNum(key.y.replace(/^-/, ''))}i`;

// What the formula's own variables stand at on one keyframe, for a fractal
// that holds any. Nothing at all for one that does not, and the card is a row
// shorter.
function varsLine(vars) {
  const text = Object.entries(vars ?? {}).map(([name, v]) => `${name} = ${valueText(v)}`).join('  ');
  if (!text) return [];
  const el = document.createElement('span');
  el.className = 'tl-key-vars';
  el.textContent = text;
  return [el];
}

const signature = (key) =>
  [key.x, key.y, key.lz, key.angle, key.julia?.re, key.julia?.im, JSON.stringify(key.vars ?? null)].join('|');

function option(value, label) {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

function fill(select, items) {
  select.replaceChildren(...items.map((i) => option(i.value, i.label)));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // A movie can run to gigabytes and the browser writes it out of this blob,
  // so the handle stays alive well past the click that started the save.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function createStudio(hooks) {
  const panel = $('#timeline');
  const button = $('#animate');
  const list = $('#tl-keys');
  const empty = $('#tl-empty');
  const note = $('#tl-note');
  const scrub = $('#tl-scrub');
  const timeText = $('#tl-time');
  const playBtn = $('#tl-play');
  const ease = $('#tl-ease');
  const exportForm = $('#tl-export');
  const progress = $('#tl-progress');
  const bar = $('#tl-bar');
  const progressText = $('#tl-progress-text');
  const textbox = $('#tl-textbox');
  const json = $('#tl-json');
  const pick = {
    format: $('#tl-format'),
    size: $('#tl-size'),
    fps: $('#tl-fps'),
    quality: $('#tl-quality'),
    dither: $('#tl-dither'),
    detail: $('#tl-detail'),
  };
  const qualityField = $('#tl-quality-field');
  const ditherField = $('#tl-dither-field');
  const estimate = $('#tl-estimate');

  let set = null;
  let keys = [];
  let easing = DEFAULT_EASING;
  let timeline = plan([], easing);
  let at = 0;
  let open = false;
  let playing = false;
  let busy = false;
  let stopWanted = false;
  const settings = readSettings(DEFAULTS);
  const thumbs = new Map();
  const queue = [];
  let draining = false;

  const say = (text) => { note.textContent = text; };

  // ---------- Thumbnails ----------

  function paint(canvas, index) {
    const known = thumbs.get(signature(keys[index]));
    if (known) {
      canvas.getContext('2d').putImageData(known, 0, 0);
      return;
    }
    queue.push({ canvas, index, of: signature(keys[index]) });
    drain();
  }

  function drain() {
    // A thumbnail draws on the same GPU the viewer and the export are using,
    // so it waits until neither is asking for it.
    if (draining || !queue.length || busy || playing) return;
    draining = true;
    requestAnimationFrame(() => {
      draining = false;
      const job = queue.shift();
      // The list may have been rebuilt since the job was queued, which leaves
      // its canvas out of the document and its keyframe somewhere else.
      if (job && job.canvas.isConnected && keys[job.index] && signature(keys[job.index]) === job.of && !busy && !playing) {
        const image = hooks.thumb(viewAt(job.index), THUMB_W, THUMB_H);
        if (image) {
          job.canvas.getContext('2d').putImageData(image, 0, 0);
          if (thumbs.size >= THUMB_CACHE) thumbs.delete(thumbs.keys().next().value);
          thumbs.set(job.of, image);
        }
      }
      drain();
    });
  }

  // ---------- The model ----------

  // The view one keyframe stands for, built off the same parsed centres the
  // playback uses rather than read from its text again.
  const viewAt = (index) => keyState(timeline, index);

  function save() {
    const err = writeAnimation(set, { keys, easing });
    if (err) say(err);
  }

  // Everything downstream of the keyframes: the path they describe, the
  // scrubber's range, and what the export would cost.
  function rebuild() {
    timeline = plan(keys, easing);
    at = Math.min(at, timeline.total);
    scrub.max = String(Math.max(0.001, timeline.total));
    scrub.value = String(at);
    scrub.disabled = timeline.total <= 0 || busy;
    playBtn.disabled = timeline.total <= 0 || busy;
    $('#tl-render').disabled = timeline.total <= 0 || busy;
    $('#tl-add').disabled = busy;
    $('#tl-clear').disabled = busy || !keys.length;
    timeText.textContent = `${seconds(at)} / ${seconds(timeline.total)} s`;
    empty.hidden = keys.length > 0;
    updateEstimate();
  }

  // ---------- The keyframe cards ----------

  function card(key, index) {
    const li = document.createElement('li');
    li.className = 'tl-key';

    const thumb = document.createElement('canvas');
    thumb.className = 'tl-thumb';
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    thumb.setAttribute('aria-hidden', 'true');

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'tl-jump';
    jump.title = `Put the view on keyframe ${index + 1}`;
    jump.setAttribute('aria-label', `Go to keyframe ${index + 1}`);
    jump.append(thumb);
    jump.addEventListener('click', () => {
      stop();
      hooks.show(viewAt(index));
      say(`the view is on keyframe ${index + 1}`);
    });

    const head = document.createElement('div');
    head.className = 'tl-key-head';
    const number = document.createElement('span');
    number.className = 'tl-key-number';
    number.textContent = String(index + 1);
    const zoom = document.createElement('span');
    zoom.className = 'tl-key-zoom';
    zoom.textContent = formatZoom(key.lz);
    head.append(number, zoom);
    if (key.angle) {
      const turn = document.createElement('span');
      turn.className = 'tl-key-turn';
      turn.textContent = `${Number(key.angle.toFixed(1))}°`;
      head.append(turn);
    }

    const where = document.createElement('span');
    where.className = 'tl-key-where';
    where.textContent = coordText(key);
    where.title = `${key.x}\n${key.y}`;

    const last = index === keys.length - 1;
    const times = document.createElement('div');
    times.className = 'tl-key-times';
    times.append(
      timeField('hold', key.hold, 'Seconds to stand still on this keyframe', (v) => { key.hold = v; }),
      timeField('then', key.span, 'Seconds from here to the next keyframe', (v) => { key.span = v; }, last),
    );

    const tools = document.createElement('div');
    tools.className = 'tl-key-tools';
    tools.append(
      tool('◀', `Move keyframe ${index + 1} earlier`, () => move(index, -1), index === 0),
      tool('▶', `Move keyframe ${index + 1} later`, () => move(index, 1), last),
      tool('⟳', `Retake keyframe ${index + 1} where the view stands now`, () => retake(index)),
      tool('×', `Delete keyframe ${index + 1}`, () => drop(index), false, 'tl-drop'),
    );

    li.append(jump, head, where, ...varsLine(key.vars), times, tools);
    paint(thumb, index);
    return li;
  }

  function tool(glyph, title, run, disabled = false, extra = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tl-tool ${extra}`.trim();
    btn.textContent = glyph;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.disabled = disabled || busy;
    btn.addEventListener('click', run);
    return btn;
  }

  // The last keyframe has nowhere to go, so its span is greyed rather than
  // hidden: the column stays where the eye expects it down the strip.
  function timeField(label, value, title, apply, disabled = false) {
    const wrap = document.createElement('label');
    wrap.className = 'tl-key-time';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input';
    input.min = '0';
    input.max = '600';
    input.step = '0.5';
    input.value = String(Number(value.toFixed(2)));
    input.title = title;
    input.setAttribute('aria-label', title);
    input.disabled = disabled || busy;
    input.addEventListener('change', () => {
      const read = Number(input.value);
      const kept = Math.min(600, Math.max(0, Number.isFinite(read) ? read : 0));
      input.value = String(Number(kept.toFixed(2)));
      apply(kept);
      save();
      rebuild();
    });
    wrap.append(name, input);
    return wrap;
  }

  function redraw() {
    rebuild();
    list.replaceChildren(...keys.map((key, index) => card(key, index)));
  }

  // ---------- Editing ----------

  function add() {
    if (busy) return;
    const view = hooks.view();
    const before = keys[keys.length - 1] ?? null;
    keys.push(keyFrom(view, before));
    // The first keyframe on its own is a still. The second gives it somewhere
    // to go, and the span it inherits is what the gap becomes.
    if (keys.length === 1) keys[0].span = DEFAULT_SPAN;
    save();
    // The scrubber follows the new end, since that is where the view now is.
    at = Infinity;
    redraw();
    say(`keyframe ${keys.length} taken at ${formatZoom(keys[keys.length - 1].lz)}`);
    list.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }

  function retake(index) {
    const view = hooks.view();
    const taken = keyFrom(view, keys[index - 1] ?? null);
    keys[index] = { ...taken, hold: keys[index].hold, span: keys[index].span };
    save();
    redraw();
    say(`keyframe ${index + 1} retaken`);
  }

  function move(index, by) {
    const to = index + by;
    if (to < 0 || to >= keys.length) return;
    [keys[index], keys[to]] = [keys[to], keys[index]];
    save();
    redraw();
    say(`keyframe ${index + 1} is now keyframe ${to + 1}`);
    list.children[to]?.querySelector('.tl-tool:not([disabled])')?.focus();
  }

  function drop(index) {
    keys.splice(index, 1);
    save();
    redraw();
    say(keys.length ? `keyframe ${index + 1} deleted` : 'the animation is empty');
  }

  function clear() {
    if (!keys.length || busy) return;
    keys = [];
    save();
    redraw();
    say('cleared');
  }

  // ---------- Playing ----------

  function seek(t) {
    at = Math.max(0, Math.min(t, timeline.total));
    scrub.value = String(at);
    timeText.textContent = `${seconds(at)} / ${seconds(timeline.total)} s`;
    const view = sample(timeline, at);
    if (view) hooks.show(view);
  }

  function play() {
    if (playing || timeline.total <= 0 || busy) return;
    playing = true;
    setPlayLabel();
    if (at >= timeline.total) at = 0;
    const started = performance.now() - at * 1000;
    const step = (now) => {
      if (!playing) return;
      const t = (now - started) / 1000;
      if (t >= timeline.total) {
        seek(timeline.total);
        stop();
        return;
      }
      seek(t);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    setPlayLabel();
    drain();
  }

  function setPlayLabel() {
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
    playBtn.title = playing ? 'Pause' : 'Play the animation';
  }

  // ---------- Exporting ----------

  function chosenSize() {
    const found = SIZES.find((s) => s.key === settings.size) ?? SIZES[0];
    const raw = found.width ? found : hooks.screen();
    return fitSize(hooks.maxSide(), raw.width, raw.height, settings.format);
  }

  function updateEstimate() {
    if (!keys.length) {
      estimate.textContent = '';
      return;
    }
    const { width, height } = chosenSize();
    const frames = frameCount(timeline.total, settings.fps);
    const shown = trueFps(settings.format, settings.fps);
    const guess = settings.format === 'mp4'
      ? (bitrateFor(width, height, settings.fps, settings.quality) * timeline.total) / 8
      : width * height * frames * GIF_BYTES_PER_PIXEL[settings.dither ? 'dithered' : 'plain'];
    const rate = Math.abs(shown - settings.fps) > 0.05
      ? `${Math.round(shown * 10) / 10} fps (GIF rounds the delay)`
      : `${settings.fps} fps`;
    // The whole movie is held in memory until the last frame is in, since the
    // file cannot be written until its sizes are known.
    const heavy = guess > 8e8 ? ' · that is a lot to hold in memory at once' : '';
    // MP4's figure is what the encoder is asked to average, and detail this
    // dense routinely carries it past that; GIF's is a measured rate per pixel.
    // Either way the render prints the size it actually wrote.
    const weight = settings.format === 'mp4' ? `${size(guess)} at that bitrate` : `roughly ${size(guess)}`;
    estimate.textContent = `${frames} frames · ${width}×${height} · ${rate} · ${seconds(timeline.total)} s of video · ${weight}${heavy}`;
  }

  function showFormatFields() {
    const gif = settings.format === 'gif';
    qualityField.hidden = gif;
    ditherField.hidden = !gif;
  }

  function openExport() {
    if (!keys.length || busy) return;
    textbox.hidden = true;
    exportForm.hidden = false;
    showFormatFields();
    updateEstimate();
    pick.format.focus();
  }

  function showProgress(p) {
    bar.value = p.frame / p.frames;
    const pct = Math.round((p.frame / p.frames) * 100);
    progressText.textContent = `frame ${p.frame} / ${p.frames} · ${pct}% · ${saying(p.left)} · ${size(p.bytes)} so far`;
  }

  async function run() {
    if (busy || !keys.length) return;
    stop();
    const { width, height } = chosenSize();
    const format = settings.format;
    if (format === 'mp4' && !canEncodeMp4()) {
      say('this browser has no WebCodecs video encoder, so MP4 is out. GIF still works.');
      return;
    }
    busy = true;
    stopWanted = false;
    queue.length = 0;
    hooks.busy(true);
    exportForm.hidden = true;
    progress.hidden = false;
    bar.value = 0;
    progressText.textContent = 'starting…';
    lockCards();

    const started = performance.now();
    try {
      const result = await hooks.record({
        set,
        animation: timeline,
        fps: settings.fps,
        width,
        height,
        format,
        quality: settings.quality,
        dither: settings.dither,
        detail: settings.detail,
        onFrame: (view) => hooks.show(view),
        onProgress: showProgress,
        stopped: () => stopWanted,
      });
      if (!result) {
        say('the render was stopped, and nothing was saved');
      } else {
        const name = movieName({ set, animation: timeline, width, height, fps: settings.fps, format });
        download(result.blob, name);
        const took = Math.round((performance.now() - started) / 1000);
        say(`saved ${name} — ${result.frames} frames, ${size(result.blob.size)}, ${took < 90 ? `${took} s` : `${Math.round(took / 60)} min`} to render`);
      }
    } catch (err) {
      say(`the render stopped: ${err.message}`);
    } finally {
      busy = false;
      hooks.busy(false);
      progress.hidden = true;
      seek(at);
      redraw();
      drain();
    }
  }

  // A render owns the camera for its whole length, so nothing that would move
  // it is left live. rebuild() puts them back when the render is over.
  function lockCards() {
    for (const el of list.querySelectorAll('button, input')) el.disabled = true;
    for (const el of [$('#tl-add'), $('#tl-clear'), $('#tl-render'), playBtn, scrub]) el.disabled = true;
  }

  // ---------- Text ----------

  function toggleText() {
    if (!textbox.hidden) {
      textbox.hidden = true;
      return;
    }
    exportForm.hidden = true;
    textbox.hidden = false;
    json.value = toText(set, { keys, easing });
    json.focus();
    json.select();
  }

  function applyText() {
    const read = fromText(json.value);
    if (read.error) {
      say(read.error);
      return;
    }
    if (read.set && read.set !== set) {
      say(`that animation is for ${read.set}; open that fractal and paste it there`);
      return;
    }
    // Pasted keyframes have been nowhere near this set's zoom limit, and one
    // past it would ask a shader for a picture it cannot draw.
    keys = read.keys.map((k) => ({ ...k, lz: hooks.clampZoom(k.lz) }));
    easing = read.easing;
    ease.value = easing;
    save();
    redraw();
    textbox.hidden = true;
    say(`${keys.length} keyframes read`);
  }

  // ---------- Wiring ----------

  fill(ease, EASINGS.map((e) => ({ value: e.key, label: e.name })));
  fill(pick.format, FORMATS.map((f) => ({ value: f.key, label: f.name })));
  fill(pick.size, SIZES.map((s) => ({ value: s.key, label: s.name ?? `${s.width} × ${s.height}` })));
  fill(pick.fps, RATES.map((r) => ({ value: String(r), label: `${r}` })));
  fill(pick.quality, QUALITIES.map((q) => ({ value: q.key, label: q.name })));
  fill(pick.detail, DETAILS.map((d) => ({ value: String(d), label: `×${d}` })));

  if (!canEncodeMp4()) {
    const mp4 = pick.format.querySelector('option[value="mp4"]');
    mp4.disabled = true;
    mp4.textContent = 'MP4 — needs WebCodecs';
    if (settings.format === 'mp4') settings.format = 'gif';
  }

  pick.format.value = settings.format;
  pick.size.value = settings.size;
  pick.fps.value = String(settings.fps);
  pick.quality.value = settings.quality;
  pick.dither.checked = settings.dither;
  pick.detail.value = String(settings.detail);
  showFormatFields();

  const remember = (key, read) => (el) => {
    el.addEventListener('change', () => {
      settings[key] = read(el);
      writeSettings(settings);
      showFormatFields();
      updateEstimate();
    });
  };
  remember('format', (el) => el.value)(pick.format);
  remember('size', (el) => el.value)(pick.size);
  remember('fps', (el) => Number(el.value))(pick.fps);
  remember('quality', (el) => el.value)(pick.quality);
  remember('dither', (el) => el.checked)(pick.dither);
  remember('detail', (el) => Number(el.value))(pick.detail);

  ease.addEventListener('change', () => {
    easing = easingByKey(ease.value).key;
    save();
    rebuild();
    seek(at);
  });

  scrub.addEventListener('input', () => {
    stop();
    seek(Number(scrub.value));
  });

  $('#tl-add').addEventListener('click', add);
  playBtn.addEventListener('click', () => (playing ? stop() : play()));
  $('#tl-render').addEventListener('click', openExport);
  $('#tl-export-cancel').addEventListener('click', () => { exportForm.hidden = true; });
  exportForm.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $('#tl-stop').addEventListener('click', () => { stopWanted = true; progressText.textContent = 'stopping…'; });
  $('#tl-text').addEventListener('click', toggleText);
  $('#tl-apply').addEventListener('click', applyText);
  $('#tl-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json.value);
      say('copied');
    } catch {
      json.select();
      say('select the text and copy it');
    }
  });
  $('#tl-text-close').addEventListener('click', () => { textbox.hidden = true; });
  $('#tl-clear').addEventListener('click', clear);
  $('#tl-close').addEventListener('click', () => show(false));
  button.addEventListener('click', () => show(!open));

  // The panel stands over the picture, so the HUD and the control bar lift by
  // exactly as much as it takes. Its height follows the keyframes, the export
  // settings and the width of the window, so it is measured rather than named.
  const measure = new ResizeObserver(() => {
    document.body.style.setProperty('--timeline-h', open ? `${panel.offsetHeight}px` : '0px');
  });
  measure.observe(panel);

  function show(on) {
    if (busy && !on) {
      say('the render is still running; Stop it first');
      return;
    }
    open = on;
    panel.hidden = !on;
    button.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('timeline-open', on);
    document.body.style.setProperty('--timeline-h', on ? `${panel.offsetHeight}px` : '0px');
    if (!on) {
      stop();
      exportForm.hidden = true;
      textbox.hidden = true;
      return;
    }
    redraw();
    drain();
  }

  function load(next) {
    if (next === set) return;
    stop();
    set = next;
    const stored = readAnimation(set);
    keys = stored.keys;
    easing = stored.easing;
    ease.value = easing;
    at = 0;
    thumbs.clear();
    queue.length = 0;
    note.textContent = '';
    if (open) redraw();
    else timeline = plan(keys, easing);
  }

  return {
    get open() { return open; },
    get playing() { return playing; },
    get busy() { return busy; },
    get keyframes() { return keys.length; },
    show,
    toggle: () => show(!open),
    load,
    add: () => { if (!open) show(true); add(); },
    stopRender: () => { if (busy) { stopWanted = true; progressText.textContent = 'stopping…'; } },
  };
}
