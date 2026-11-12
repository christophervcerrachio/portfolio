// The loading picture (index.html .walk-load): the walk's own evening while its first view comes in. A sky drawn in
// ComfyUI, and in front of it the land and the things of the walk seen as one sees them against a sunset - its hills
// and woods, Moscow's and Petersburg's towers and domes, the birches, a wooden church, the estate's gate - each drawn
// in Blender from the walk's own models (dev/load: silhouettes_blender.py, frieze_compose.py). The land is there from
// the first moment; the rest rises out of the ground as the files come in, the far things first; when the first view
// is in, the picture fades and the walk is under it, its own things still rising into place (world/arrive.js).
// In an older machine's look (hardware.js STYLES) the picture is drawn at that machine's lines and colours.
//
// Everything that moves here moves by the browser's compositor (a transform, an opacity), so it keeps moving while
// the page's own work - reading the world, making its shaders - holds the page up.
//
// index.html starts it as the page opens (so it is there before the walk's code has even come in); walk.js then tells
// it how far the load has come:
//   startLoading(el, { style, still, idle, base }) -> { stage(label), say(text), done(), remove() }
//     style: 'full' or an older machine's name; still: none (?still - tests); idle: the browser cannot draw the walk -
//     the picture stays, everything risen, with no words. A second call returns the same picture (its style updated).

// (how far the load has come at each of the walk's stages: walk.js tl(), countryside.js load())
const STEPS = [
  ['scene load: start', 0.06], ['scene load: models', 0.24], ['scene load: world', 0.34],
  ['scene load: meadow, trees, stones', 0.42], ['scene load: land, woods', 0.48], ['scene load: built', 0.54],
  ['programs: made', 0.76], ['first view in', 0.84], ['shaders: start', 0.9], ['shaders: land compiled', 0.94],
  ['shaders: the look round drawn', 0.98], ['veil lifted', 1],
];
const STEP = new Map(STEPS);
// (each look's pictures: its lines for the whole screen - hardware.js STYLES)
const RES = { full: 'full', gamecube: '480', dreamcast: '480', n64: '240', ps1: '240' };

let C = null;

/** Start the loading picture in `el` (or return the one already started). */
export function startLoading(el, opts = {}) {
  if (C) { C.update(opts); return C; }
  if (!el) return null;
  C = make(el, opts);
  return C;
}

function make(el, { style = 'full', still = false, idle = false, base = '' }) {
  const dir = base + 'assets/load/';
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const words = el.querySelector('.walk-load-words'), bar = el.querySelector('.walk-load-bar i');
  let frieze = null, atlasIn = false, gone = false, doneAt = 0, lastRise = 0, timer = 0;
  // (before the walk's first word - its code still coming in - the picture creeps toward the models' stage, so the
  // first things rise while the page is still only reading files)
  let reached = 0, next = STEP.get('scene load: models'), since = performance.now(), shown = 0;
  const waiting = [];

  const api = {
    stage(label) {
      const p = STEP.get(label);
      if (p === undefined || p <= reached) return;
      reached = p; since = performance.now();
      next = STEPS.find(([, q]) => q > p)?.[1] ?? 1;
    },
    say(text) { if (words) words.textContent = text; },
    done() {
      if (gone || doneAt) return;
      doneAt = performance.now();
      tick(); clearInterval(timer);
      // (the picture fades over the walk, whose own things are rising under it)
      el.classList.add('is-done');
      setTimeout(remove, 1300);
    },
    remove,
    update(o) {
      if (o.style && o.style !== style) { style = o.style; el.dataset.style = style; dress(); }
      if (o.still) remove();
    },
  };

  function remove() {
    if (gone) return;
    gone = true; clearInterval(timer); el.remove(); C = null;
  }

  el.dataset.style = style;
  if (still) { remove(); return api; }
  if (reduce) el.classList.add('is-calm');
  if (idle) { el.classList.add('is-idle'); if (words) words.parentElement.hidden = true; }

  // ---- the land: each layer's hills and woods, rising first, far to near, once its picture is in
  const lands = [...el.querySelectorAll('.walk-load-land')];
  lands.forEach((land, k) => {
    const url = getComputedStyle(land).backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1];
    const up = () => setTimeout(() => land.classList.add('is-up'), idle ? 0 : 120 + k * 380);
    if (!url) { up(); return; }
    const img = new Image(); img.src = url;
    (img.decode ? img.decode() : Promise.resolve()).then(up, up);
  });

  // ---- the things: placed from frieze.json, rising in their turn
  fetch(dir + 'frieze.json').then((r) => (r.ok ? r.json() : null)).then((f) => {
    if (!f || gone) return;
    frieze = f;
    const rises = Object.fromEntries([...el.querySelectorAll('.walk-load-layer')].map((l) => [l.dataset.layer, l.querySelector('.walk-load-rise')]));
    for (const p of [...f.pieces].sort((a, b) => a.at - b.at)) {
      const d = document.createElement('div');
      d.className = 'walk-load-piece';
      p.el = d;
      rises[p.layer]?.appendChild(d);
      waiting.push(p);
    }
    dress();
    if (idle) { for (const p of waiting.splice(0)) p.el.classList.add('is-up'); }
  }).catch(() => { /* (the land and the sky alone) */ });

  /** Every thing's picture and size in the look in force: its part of that look's one picture of them all. */
  function dress() {
    if (!frieze) return;
    const res = RES[style] ?? 'full', A = frieze.atlas[res], k = frieze.ppu[res];
    const url = dir + A.src;
    atlasIn = false;
    const img = new Image(); img.src = url;
    (img.decode ? img.decode() : Promise.resolve()).then(() => { atlasIn = true; }, () => { atlasIn = true; });
    const u = (v) => `calc(${+(v / k).toFixed(5)} * var(--u))`;
    for (const p of frieze.pieces) {
      const [sx, sy, sw, sh] = p.sprite[res], s = p.el.style;
      s.left = `calc(50% + ${p.x} * var(--u))`; s.width = u(sw); s.height = u(sh);
      s.backgroundImage = `url("${url}")`; s.backgroundSize = `${u(A.w)} ${u(A.h)}`; s.backgroundPosition = `${u(-sx)} ${u(-sy)}`;
      // (taller things take longer to rise; in an older machine's look they rise a line or two at a time)
      s.setProperty('--d', (1.25 + 1.5 * Math.min(1, p.h / 0.32)).toFixed(2) + 's');
      s.setProperty('--n', String(Math.max(4, Math.round(p.h * (res === 'full' ? 240 : +res) / 2))));
    }
  }

  // ---- the load's progress: the last stage reached, creeping toward the next while the files come in
  function tick() {
    if (gone) return;
    const now = performance.now();
    const creep = reached + (next - reached) * 0.85 * (1 - Math.exp(-(now - since) / 4000));
    shown = doneAt ? 1 : Math.max(shown, creep);
    if (bar) bar.style.transform = `scaleX(${shown.toFixed(4)})`;
    // (one thing at a time, its turn come, a little apart; once the walk is in, what has not risen stays down: the
    // picture fades as it stands, rather than everything left bursting up as it goes)
    if (!doneAt && atlasIn && waiting.length && waiting[0].at <= shown && now - lastRise > 170) {
      waiting.shift().el.classList.add('is-up'); lastRise = now;
    }
  }
  if (!idle) timer = setInterval(tick, 60);
  return api;
}
