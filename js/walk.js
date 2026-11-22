// The site, as a walk: the countryside scene (backdrops/countryside.js), the full page, walked in the first person.
// A click takes the mouse (and starts the sound: a browser allows sound only after a click or a key); the mouse looks
// round; W A S D or the arrow keys walk, Shift sprints, Space jumps, C crouches, X lies prone (C and X again stand up);
// the wheel zooms in and out; Esc lets the mouse go. Where the browser will not take the mouse, moving it looks round.
// The walker holds a book (book.js): right click brings it up to the face - the places to travel to on its right page,
// the plate leaf on its left, a printer's hand moved over them with the mouse - and right click lowers it again.
// While the mouse is not taken, "Click to look around" shows in the middle (the only thing drawn over the scene); on a touch
// screen, one finger looks round and two pinch to zoom. The robot and God's arms (hero.js) are kept for later.
//
// For tests and stills: ?t=<seconds> shows that moment, ?still holds it; window.__walk is the scene and its controls.
// Dev only (remove with the free-cam): P copies the view's pose, then a box dragged round the problem; __walk.pose()
// reads the pose and __walk.goTo(pose) returns to it.
import { chooseTier, guessTier, rememberTier, step, TIERS, ORDER, STYLES } from './hardware.js';
import { setTextureCap } from './texcap.js';
import { useStyle } from './retro.js';
import { initDepth } from './depthmode.js';
import * as THREE from 'three';
import { CountrysideScene } from './backdrops/countryside.js';
import { windSound } from './sound.js';
import { makeFootsteps } from './footsteps.js';
import { groundLoaded } from './world/terrain.js';
import { setupArrivals, openArrivals, quietArrivals, compileView, compileShadow, arrivalsWaiting, arrivalsNear, arrivalsState, lastPump, arrive } from './world/arrive.js';
import { startLoading, makeLoading } from './loading.js';
import { makeBook } from './book.js';
import { makeBookOver } from './bookover.js';
import { makeControls } from './controls.js';
import * as report from './loadreport.js';

const LOOK = 0.0022;                                // radians the view turns for a pixel the mouse moves, zoomed out
const PITCH = [-1.1, 1.2];                          // how far the view can tip down and up, zoomed out (radians)
// (C and X switch the stance on and off as in DayZ; Space jumps, or stands up from a crouch or lying down)
const STANCE = { stand: { eye: 1.65, speed: 1 }, crouch: { eye: 1.05, speed: 0.45 }, prone: { eye: 0.32, speed: 0.18 } };
const JUMP = { v: 4.2, g: 9.81 };
const SPEED = { walk: 5.0, run: 12.0, ease: 9 };   // (8 Nov 2026: the pillars a few minutes' walk off: world.layout.json speeds)     // m/s; how fast a step comes up to speed and dies away (per s)
const KEYS = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump', KeyC: 'crouch', KeyX: 'prone',
  KeyQ: 'down', KeyE: 'up',        // (free-cam only: sink and rise — a dev tool, remove with it)
};

export async function initWalk(container, opts = {}) {
  const params = new URLSearchParams(location.search);
  const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;
  const still = params.has('still');
  // (?norise: everything in its place the moment it is in - for tests that measure where things stand)
  const noRise = params.has('norise') || frozenT !== null;
  const small = Math.min(innerWidth, innerHeight) < 640;
  const base = opts.base ?? '';

  const canvas = document.createElement('canvas');
  canvas.className = 'walk-canvas';
  canvas.tabIndex = 0;
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reverseDepthBuffer: true });
  initDepth(renderer);                                     // (the depth even to the horizon: depthmode.js)
  // (the machine's graphics settings: its chip, cores, memory and screen place it in a tier, which the first frames
  // check and the frame time keeps adjusting - hardware.js)
  // (?tune={"blocksMerge":0,...}: the tier's settings tried otherwise, for measuring them - a test's, never a visitor's)
  let tune = {}; try { tune = JSON.parse(params.get('tune') || '{}'); } catch { /* (none) */ }
  const gfxInfo = chooseTier(renderer.getContext()), GFX = { ...TIERS[gfxInfo.tier], ...tune };
  console.info('[gfx]', gfxInfo.tier, '-', gfxInfo.why, '-', gfxInfo.gpu);
  // (below the full look, an older machine's way of drawing - hardware.js STYLES, retro.js: its own number of lines
  // whatever the screen, its textures' filtering, its corners on the pixel grid; set before anything is made)
  const retro = useStyle(GFX.style ? STYLES[GFX.style] : null, canvas);
  // (the book at the screen's own resolution in every look: an older machine's picture is then drawn into the corner of a
  // canvas the screen's size and brought up to it by the page itself, the book laid over it - bookover.js; a still and
  // ?nobook, with no book, keep the canvas the look's own size, scaled up by the browser, as before)
  const overLow = !!retro && !still && !params.has('nobook');
  if (overLow) canvas.style.imageRendering = 'auto';
  renderer.setPixelRatio(retro && !overLow ? 1 : Math.min(devicePixelRatio || 1, retro ? 2 : GFX.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // (a graphics card thrown out, reset, or run out of memory: the walk's pictures, its programs and its buffers are
  // gone with the context and never come back on their own - it showed as a dead, black, silent page. The loss is
  // held (nothing drawn on the dead one), the walker stopped, the visitor told plainly; on the restored context the
  // page begins again, which is the one thing known to leave the picture whole. With this much of the card's memory
  // in use it is the fault a visitor is most likely to meet, and until now the site never spoke of it - the walk
  // simply went on drawing into a dead context)
  let gpuLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();                      // (held, so webglcontextrestored is asked for at all)
    if (gpuLost) return;
    gpuLost = true; live = false; last = null;
    try { book?.lower(); } catch { /* (the book's own pictures went with the context: nothing to lower) */ }
    try { controls?.show(false); } catch { /* (as above) */ }
    console.warn('[webgl] the graphics context was lost');
    if (document.getElementById('walk-gpu-lost')) return;
    const d = document.createElement('div');
    d.id = 'walk-gpu-lost';
    d.style.cssText = 'position:absolute;inset:0;z-index:99;display:grid;place-items:center;'
      + 'background:rgba(10,12,14,.92);color:#fff;text-align:center;padding:8vw;'
      + 'font:16px/1.6 system-ui,sans-serif;pointer-events:none';
    d.textContent = 'The graphics card was interrupted. The walk begins again in a moment.';
    container.appendChild(d);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[webgl] the graphics context came back: the walk begins again');
    setTimeout(() => location.reload(), 900);
  });
  // (a 360's picture finished with the film-like curve of its years - retro.js tone - the rest with the neutral one)
  renderer.toneMapping = retro?.tone === 'filmic' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  // (a laptop's built-in graphics holds its pictures in the machine's own memory: each kept no larger than the tier's
  // texMax, drawn down as it is read - texcap.js)
  setTextureCap(GFX.texMax);
  // (every texture filtered at the card's full anisotropy, 16 on most: textures seen at a glancing angle - the ground,
  // the ways, bark, planks - stay sharp into the distance. On a tier with `aniso` no texture is filtered past that,
  // whatever it asks for: three clamps each to what the card says it can do, so the card is made to say less - a
  // built-in chip pays for every tap)
  // (the card's own, kept for the book: its pictures are read as the full look reads them in every look - book.js)
  const cardAniso = renderer.capabilities.getMaxAnisotropy();
  if (GFX.aniso) renderer.capabilities.getMaxAnisotropy = () => Math.min(cardAniso, GFX.aniso);
  THREE.Texture.DEFAULT_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
  const stage = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();        // (the scene draws through its own camera; this one only shows it)

  // (the sky: ?sky=day or ?sky=evening holds one - evening.js; a still stays in the day unless asked)
  const s = new CountrysideScene({ id: 'countryside', name: 'Russian summer', quality: small ? 'low' : GFX.scene, gfx: GFX, retro, sound: windSound,
    sky: ['day', 'evening'].includes(params.get('sky')) ? params.get('sky') : null, still: frozenT !== null,
    horizon: '#c9d1d6', anchor: [0.5, 0.56], pitch: PITCH });
  stage.background = s.horizon;
  stage.add(s.group);
  s.setFade(1);
  // (the book over the picture at the screen's resolution, where the picture is smaller than the screen - bookover.js)
  const over = makeBookOver({ renderer, scene: s, low: overLow, smooth: overLow && STYLES[GFX.style].scaleUp === 'smooth' });
  // (what comes in once the walk has begun - world/arrive.js: made for the scene's own picture, rising into place)
  setupArrivals({ renderer, scene: s.land, camera: () => s.cam, target: () => s.rt, shadow: () => s.shadow, still: still || noRise,
    budget: GFX.style ? { ms: 4, tex: 8e6, geo: 5e6, compiles: 2 } : null,
    // (21 Nov 2026: the load radius capped. A visitor's world grows in within this of him and rises out of the ground
    //  as he comes to the rest; ?dev keeps the whole world in, because from high above the free-cam every house has to
    //  be there to judge a layout.)
    reach: new URLSearchParams(location.search).has('dev') ? Infinity : (GFX.reachNear ?? 3000) });
  // ---- the loading picture (index.html .walk-load, loading.js): the walk's own evening, its woods and landmarks rising
  // out of the ground as the first view's files come in. It lifts once that first view is in - the land and its
  // pictures, the woods, the sky - with its shaders made and a second of its frames run (and measured: below). The rest
  // - the villages, the bridges, the landmarks, the cities - is asked for only then, and each thing rises out of the
  // ground into its place as it arrives (world/arrive.js). Until v0.0.38 the walk waited under a grey veil for every
  // file of the whole world: 114 MB, half a minute on a first visit.
  let pending = 0, quietSince = performance.now();
  const ofetch = window.fetch.bind(window);
  window.fetch = (...a) => { pending++; return ofetch(...a).finally(() => { if (--pending === 0) quietSince = performance.now(); }); };
  const LM = THREE.DefaultLoadingManager, prevStart = LM.onStart, prevLoad = LM.onLoad;
  let managerBusy = false;
  LM.onStart = (...a) => { managerBusy = true; prevStart?.(...a); };
  LM.onLoad = (...a) => { managerBusy = false; quietSince = performance.now(); prevLoad?.(...a); };
  const loading = startLoading(document.querySelector('.walk-load'), { style: GFX.style ?? 'full', still, base });
  let framesSince = 0, veilUp = !still, gfxChecked = still, bench = null, benchLast = null;
  // (the look the walk was meant to open on, and the moment the loading picture is gone: nothing turns the view before it)
  let firstLook = null, stillUntil = 0;
  // (a place chosen in the book: the loading picture up over the walk while he is carried there - travel, below)
  let travelUp = false;
  const frozen = () => veilUp || travelUp || performance.now() < stillUntil;
  const veilStart = performance.now();
  // (the load's timeline in the console - "[load] <stage> <ms since the page began>" - so its slow parts can be found)
  // (and how much of it the page's own work held the browser up: its long tasks, summed)
  let busy = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) busy += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* (none) */ }
  const tl = (label) => { console.info('[load]', label, Math.round(performance.now()), 'busy', Math.round(busy)); loading?.stage(label); report.stage(label, busy); };
  let settledAt = null;
  function veilCheck(now) {
    if (!veilUp) return;
    // (the first view in: the scene built from its files, its programs made, the ground's close tiles laid)
    const settled = primed && s.ready && groundLoaded();
    framesSince = settled ? framesSince + 1 : 0;
    if (settled && settledAt === null) tl('first view in');
    // (once the first view is in and has drawn a second, every shader made, with every texture and model it will use;
    // then the picture lifts)
    // (the first frames once it is in, still under the picture, measured: far too slow for the tier guessed, and the
    // walk loads again a tier or two lower before anyone sees it - at most twice a visit; hardware.js. Nothing else is
    // being read then: the rest is asked for only once the picture has lifted)
    // (only while the page is in front and focused: a window behind others has its frames held to one a second by the
    // browser, which read as a machine at 1 fps - and dropped an RTX 5090 to the lowest tier in testing)
    const watched = document.visibilityState === 'visible' && document.hasFocus();
    if (!watched) benchLast = null;
    if (settled && !gfxChecked && watched) {
      if (benchLast !== null) {
        const d = now - benchLast;
        if (Math.abs(d - 1000) > 15) (bench ??= []).push(d);       // (not the browser's one-a-second hold)
      }
      benchLast = now;
      bench ??= [];
      if (bench.length >= 12) {
        gfxChecked = true;
        const med = bench.slice(2).sort((a, b) => a - b)[5];
        const steps = med > 250 ? 3 : med > 110 ? 2 : med > 55 ? 1 : 0;
        let tries = 0; try { tries = +sessionStorage.getItem('career-gfx-tries') || 0; } catch { /* (none) */ }
        const to = step(gfxInfo.tier, steps);
        if (steps && to !== gfxInfo.tier && !gfxInfo.forced && !gfxInfo.locked && tries < 2) {
          try { sessionStorage.setItem('career-gfx-tries', String(tries + 1)); } catch { /* (none) */ }
          rememberTier({ ...gfxInfo, tier: to, why: `measured ${Math.round(med)} ms a frame at ${gfxInfo.tier}` });
          console.info('[gfx]', Math.round(med), 'ms a frame at', gfxInfo.tier, '- loading again at', to);
          loading?.say('Adjusting the graphics to this computer…');
          location.reload(); return;
        }
        // (a remembered tier below what the parts suggest, and frames to spare: the next visit a tier higher, so a
        // machine that was only busy once is not held low for good)
        if (!gfxInfo.forced && !gfxInfo.locked) {
          const guessed = guessTier(renderer.getContext()).tier;
          if (med < 11 && ORDER.indexOf(gfxInfo.tier) > ORDER.indexOf(guessed)) rememberTier({ ...gfxInfo, tier: step(gfxInfo.tier, -1), why: `${Math.round(med)} ms a frame at ${gfxInfo.tier}: room to spare` });
          else rememberTier(gfxInfo);
        }
      }
    }
    settledAt = settled ? (settledAt ?? now) : null;
    // (v0.0.117: the walk opens as soon as it can, every other asset loaded as it is needed, one at a time, the look
    // unchanged, and what is not in yet rising out of the ground as it comes. The
    // picture lifts the moment the first view is in - the land, the sky, the hill's trees and the woods, their programs
    // made and their pictures on the card (prime) - and the machine's frames measured: a dozen frames, a second and a half
    // at most, at once in a window behind others. Everything else is asked for then, each piece on its own as its file
    // comes, rising out of the ground in its place within the walk's own share of a frame (world/arrive.js): nothing
    // loaded in bulk, nothing more under the picture. Before, the picture waited for a look all the way round, the
    // country places' models and the frames to settle - 5 to 19 s)
    if (!(settled && framesSince > 2 && (gfxChecked || !watched || now - settledAt > 1500))) return;
    // (and the book made ready under the picture - its programs and pictures, book.prime - so nothing of it is made in the
    // walk; a book still not in eight seconds after the view is, the walk opens without waiting for it)
    if (book && !book.primed && now - settledAt < 8000) return;
    // (the cities, their landmarks, their shaders: made here, under the picture, and the picture waits for them up to
    // CITY_WAIT ms - see CITY_WAIT above for why they moved out of the seconds after the lift)
    if (!cityWarm && now - settledAt < CITY_WAIT) {
      if (!cityWarmStarted) {
        cityWarmStarted = true; tl('cities: under the picture');
        s.loadRestFar();
        later().then(() => { cityWarm = true; }, () => { cityWarm = true; });
      }
      return;
    }
    {
        veilUp = false; tl('veil lifted'); held.clear(); opened = true; openedAt = now;
        controls?.show(true);
        open();
        // (the walk shown looking where it was meant to - the windmill, or where the walker looked before a change of
        // graphics - whatever reached the view meanwhile; and still nothing turns it until the picture has faded away
        // (loading.js: 1.3 s): the mouse moved while the picture was still going had turned the view before it was seen)
        if (firstLook) {
          const L = s.look;
          L.anchor = null; L.yaw = (+firstLook.yaw || 0) / DEG; L.pitch = (+firstLook.pitch || 0) / DEG; L.goal = [L.yaw, L.pitch];
          L.zoom = L.zoomGoal = Math.min(s.zoomMax, Math.max(1, +firstLook.zoom || 1)); s._lens();
        }
        stillUntil = performance.now() + 1400;
        // (the load's report kept: loadreport.js)
        const I = renderer.info;
        report.finish({ tier: gfxInfo.tier, busyS: +(busy / 1000).toFixed(1), card: { programs: I.programs?.length ?? null, textures: I.memory.textures, geometries: I.memory.geometries, draws: I.render.calls, triangles: I.render.triangles },
          // (the load's own frames by the percentiles, beside the card's book: medians hid the stalls - stats(), the
          // performance research of 19 Nov 2026, item 1)
          frameStats: (() => { const S = stats(); return { frames: S.frames, p50: S.p50, p95: S.p95, p99: S.p99, max: S.max, over50: S.over50, over100: S.over100 }; })() });
        loading?.done();
    }
  }
  let opened = false, openedAt = 0, doneAt = null, paceLast = null, paceMid = null;
  const pace = [];
  // (every shader the first view will draw made before the picture lifts, in the background and for the picture it is
  // drawn into (world/arrive.js compileView): a wood of a kind not yet seen, or the gold birches, coming into view had
  // stopped the frame for a fifth of a second while the card built its program)
  let warming = !still, primed = still;
  // (and before any of the first view is drawn at all: its programs made in the background - the sky's and its
  // clouds', the far land's, the land's, the sun's depth copies', the picture's own last pass. Until v0.0.38 the first
  // frame made them as it drew, one after another, and the page stood still for it - 12 s on a first visit with a
  // desktop card, the longest single wait of the load. Made in the background they are made side by side, and the
  // loading picture goes on moving. Nothing is drawn meanwhile (warming))
  async function prime() {
    tl('programs: start');
    try {
      s.prepare(renderer);
      await Promise.all([
        compileView(s.sky.marchScene, { camera: s.sky.ortho, scene: s.sky.marchScene, target: s.sky.rt }),
        compileView(s.skyScene, { camera: s.cam, scene: s.skyScene }),
        compileView(s.farScene, { camera: s.farCam ?? s.cam, scene: s.farScene }),
        compileView(s.land), compileShadow(s.land),
        renderer.compileAsync(stage, camera).catch(() => {}),
      ]);
    } catch (e) { console.warn('programs', e); }
    tl('programs: made');
    // (and every picture the first view's things can show - the woods' every kind and copy, the grass, the land's -
    // sent to the card now, one by one under the picture: they had gone up in a look all the way round, 3 s of the wait)
    try {
      const seen = new Set();
      for (const root of [s.land, s.skyScene, s.farScene]) root?.traverse((o) => {
        for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) {
          if (v?.isTexture && !seen.has(v) && v.image) { seen.add(v); renderer.initTexture(v); }
        }
        for (const m of [].concat(o.material ?? [])) for (const u of Object.values(m.uniforms ?? {})) {
          const v = u?.value;
          if (v?.isTexture && !v.isRenderTargetTexture && !seen.has(v) && v.image) { seen.add(v); renderer.initTexture(v); }
        }
      });
      tl('pictures: on the card ' + seen.size);
    } catch (e) { console.warn('pictures', e); }
    primed = true; warming = false;
  }
  // (once the picture has lifted: the rest asked for, the opening's wave set off, and the cities loaded)
  function open() {
    const at = s.freeCam.on ? s.freeCam.pos : s.at;
    openArrivals(at);
    quietArrivals(false);
    s.loadRest();
    // (asked for in this frame, not yet being read: the lift waits for the country places' models themselves, not for a
    // quiet moment before their reading has begun - v0.0.105 lifted 0.7 s before they were even asked for)
    (s.restNear ?? Promise.resolve()).then(() => { restNearIn = true; tl('near models in'); });
  }
  let restNearIn = false, waitNoted = false;
  // (the cities, once the walk has begun: loaded, their shaders made in the background, then into the scene -
  // countryside.js loadLater; what comes in of them rises in its place: world/arrive.js)
  let laterDone = false;
  // (the cities made and their shaders compiled before the picture lifts, not after it: a change of graphics in the
  // book loads the walk again, and since v0.0.141 the ~50 programs the cities need were made in the seconds after the
  // picture went away - frames of 70-160 ms, 30 of them over 100 ms in the first 3 s, measured 2026-11-21 (Full to
  // PS1). Their making is the same work either way; here the picture hides it. CITY_WAIT is the most it may hold the
  // picture past the first view being in; after that the walk opens and they stream as before.)
  let cityWarmStarted = false, cityWarm = false;
  const CITY_WAIT = 6000;
  async function later() {
    const groups = s.loadLater();
    if (!groups.length) { laterDone = true; return; }
    tl('cities: loading');
    await new Promise((res) => { const t = setInterval(() => { if (pending === 0 && !managerBusy && performance.now() - quietSince > 800) { clearInterval(t); res(); } }, 250); });
    tl('cities: in');
    try {
      const tmp = new THREE.Scene();
      for (const o of groups) tmp.add(o);
      // (and the furniture's tiles not yet near, which are out of the scene until they are)
      const spare = (s._later?.props?.userData.allTiles?.() ?? []).filter((t) => !t.parent);
      for (const t of spare) tmp.add(t);
      tmp.updateMatrixWorld(true);
      // (their programs, and their sun-shadow copies', made in the background: arrive.js. The cities' pieces then come
      // in a few MB a frame, each rising in its place.
      // Asked for a thing at a time, one frame each. The card is told about every program the things it is handed need
      // in the frame it is handed them (three's compileAsync waits for what renderer.compile already made), and the
      // card's own work is about 50 ms a program: asking for the whole city group at once made a frame of 2.1 seconds
      // in which the card was told about 42 programs, and asked for 19 at a time later, a frame of 177 ms. One thing
      // per frame makes the same programs, from the same shaders, with no frame standing between two of them for more
      // than one program's worth.)
      const items = groups.flatMap((g) => (g.children.length > 1 ? g.children.slice() : [g])).concat(spare);
      // (where each one belongs: a thing taken into the scene below has to be put back where it came from, or the
      //  group that owns it goes into the walk empty)
      const homes = items.map((it) => it.parent);
      const step = items.length > 28 ? Math.ceil(items.length / 28) : 1;
      for (let i = 0; i < items.length; i += step) {
        const one = new THREE.Scene();
        for (const it of items.slice(i, i + step)) { one.add(it); it.updateMatrixWorld(true); }
        try { await Promise.all([compileView(one), compileShadow(one)]); } catch (e) { console.warn('city programs', e); }
        for (const it of one.children.slice()) one.remove(it);
        await new Promise((r) => requestAnimationFrame(r));
      }
      items.forEach((it, i) => { if (homes[i]) homes[i].add(it); });
      for (const t of spare) tmp.remove(t);
      for (const o of groups) tmp.remove(o);
    } catch (e) { console.warn('cities', e); }
    report.timed('later: put in', () => s.addLater());
    laterDone = true;
    tl('cities: shown');
  }
  // (where the walk begins: on the open land by the windmill, the field before it, looking toward it and the evening sun -
  // the walker's own chosen place, 13 Nov 2026; degrees right of ahead and up, m)
  const SPAWN = { yaw: 318.67, pitch: 14.73, zoom: 1, x: 1068.76, z: -775.02 };
  tl('scene load: start');
  const loaded = s.load(base, tl).then(() => {
    tl('scene load: built'); s.setFree(true);
    if (!still) prime();
    // (the country places' and the estate's models: asked for as the picture lifts, not under it - v0.0.117)
    // (a change of graphics in the book loads the walk again: the walker put back where he stood, looking the way he looked)
    // (else the walk begins where it begins: SPAWN)
    let kept = null;
    try { kept = sessionStorage.getItem('career-pose'); if (kept) sessionStorage.removeItem('career-pose'); } catch { /* (none) */ }
    try {
      const p = kept ? JSON.parse(kept) : (still ? null : { ...SPAWN });
      if (p) { delete p.t; firstLook = p; setTimeout(() => goTo(p), 0); }
    } catch { /* (none) */ }
  });

  // ---- size: the scene's picture at the screen's own resolution, less if the frames come too slowly (below)
  const quality = { scale: GFX.scale, n: 0, sum: 0, skip: 120, good: 0, times: [], slow: 0, t0: 0 };
  function frame() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    if (retro) {
      // (an older machine's picture: its own lines, the canvas itself that small and scaled up by the page - or, with the
      // book, the canvas the screen's size and the picture in its corner, at least that many pixels: bookover.js)
      const [W, H] = retro.size(w, h);
      if (overLow) { renderer.setPixelRatio(Math.max(Math.min(devicePixelRatio || 1, 2), H / h, W / w)); renderer.setSize(w, h, false); }
      else renderer.setSize(W, H, false);
      s.resize(W, H);
    } else {
      renderer.setSize(w, h, false);
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      // (the screen's own size beside it: a picture drawn smaller is brought up to it edge by edge - backdrops/upscale.js)
      s.resize(Math.max(2, Math.round(buf.x * quality.scale)), Math.max(2, Math.round(buf.y * quality.scale)), buf.x, buf.y);
    }
    s.fit(0, 0, 1, w / h);
    quality.n = 0; quality.sum = 0; quality.skip = 60; quality.times.length = 0;
  }
  frame();
  new ResizeObserver(() => frame()).observe(container);

  // ---- sound: on from the first click or key, at the level it was made at
  let audio = null, steps = null;
  function startSound() {
    if (audio) { if (audio.ctx.state === 'suspended' && !document.hidden) audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC(), out = ctx.createGain();
    out.connect(ctx.destination);
    audio = { ctx, out };
    ctx.resume();
    s.startSound(ctx, out);
    steps = makeFootsteps(ctx, out, base);
  }
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
  });

  // ---- looking: the mouse moves the view at once (no easing), slower the further it is zoomed in
  // (not while the loading picture or the change of look's is up: the walk is shown looking where it was set to look -
  // the first view, at the windmill, or where the walker stood before the change - however the mouse moved meanwhile)
  function lookBy(dx, dy) {
    if (frozen()) return;
    const L = s.look, z = Math.max(1, L.zoom), M = L.limits;
    L.anchor = null;
    L.yaw += dx * LOOK / z;
    L.pitch = Math.min(M.pitch[1], Math.max(M.pitch[0], L.pitch - (dy * LOOK) / z));
    L.goal = [L.yaw, L.pitch];
  }
  // ---- the mouse. Three states, always one of them:
  //   captured  - the browser has given the page the mouse (pointer lock): moving it turns the view, no cursor, no edge;
  //               Esc lets it go (and nothing comes up: the menu Esc had brought up was taken away on 18 Nov 2026, and
  //               since v0.0.145 there are no graphics settings to show at all; the pane of the controls names Esc,
  //               marked once it is used).
  //   free      - not captured yet, or let go: the cursor shows, and a small "Click to look around" asks for a click (or any
  //               walking key) to capture it.
  //   refused   - this browser will not give the page the mouse (an embedded pane, a page that is not the focused
  //               window): moving the mouse turns the view all the same, no button held, the cursor hidden; it can only
  //               turn as far as the cursor can go before the window's edge, so a note says once where the mouse can be
  //               taken (Chrome, Edge).
  // A browser refuses a capture asked for just after Esc (about a second): the next click tries again.
  const locked = () => document.pointerLockElement === canvas;
  let refusals = 0, noted = false, everHeld = false;
  // (the note, the view-copy mark and the pose's units (below) are read by the keys and the mouse from the first
  // moment, the walk still loading: declared here, before any of them is listened for - declared further down, a key
  // pressed while loading had stopped on them unread)
  let note = null, marking = null, book = null;
  const DEG = 180 / Math.PI, r2 = (v) => Math.round(v * 100) / 100;
  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;padding:10px 18px;'
    + 'font:500 15px/1.3 system-ui,sans-serif;color:#fff;background:rgba(20,24,28,.55);border-radius:6px;'
    + 'pointer-events:none;transition:opacity .25s;opacity:0;text-align:center';
  container.appendChild(hint);
  // (the controls, told at the start of every visit: a pane at the foot of the view, each marked as it is first done -
  // controls.js; not on a touch screen, not in a still)
  const controls = !still && matchMedia('(pointer: fine)').matches ? makeControls({ container, fresh: params.has('controls') }) : null;
  function mouseState() {
    const refused = refusals >= 2 && !locked();
    canvas.style.cursor = locked() || refused ? 'none' : 'default';
    if (refused && !noted) {
      noted = true;
      hint.textContent = 'This window can\u2019t hold the mouse: open the page in Chrome or Edge to turn all the way round';
      hint.style.opacity = s.ready && !still ? '1' : '0';
      setTimeout(() => { hint.style.opacity = '0'; }, 4000);
      return;
    }
    if (refused) return;
    hint.textContent = 'Click to look around';
    hint.style.opacity = locked() || still || !s.ready || travelUp ? '0' : '1';
  }

  // (there is nothing to choose any more, and so nothing to leave and reload for: the drawing follows the machine -
  //  hardware.js chooseTier. The loading picture and the walk's rise are the same on every machine's class.)

  // ---- a place chosen in the book: the walk's own loading picture, in the look in force, comes up over the walk; under
  // it the book is lowered and the walker carried there, and it lifts once the place is in - its ground, everything
  // waiting to come in come, no file being read - or after TRAVEL.most s, the rest rising as it comes (18 Nov 2026: the
  // book's leaves had turned while he was carried there, the place coming in behind the book)
  const TRAVEL = { fade: 0.5, most: 10, near: 1500 };
  let trip = null;
  // (what the loading picture waits under: the ground, the arrivals that stand near the place - not the whole world's
  // queue, which held a travel for tiles on the far side of the map - no file being read)
  const nearWaiting = () => arrivalsNear(s.at.x, s.at.z, TRAVEL.near);
  const placeIn = () => groundLoaded() && nearWaiting() === 0 && pending === 0 && !managerBusy;
  function travel(p) {
    if (travelUp || leaving || !p) return;
    travelUp = true; held.clear(); vel.x = 0; vel.z = 0;
    controls?.show(false); mouseState();
    const look = GFX.style ?? 'full', html = window.__walkLoadHTML;
    let el = null, pic = null;
    if (html && !still) {
      const box = document.createElement('div'); box.innerHTML = html;
      el = box.firstElementChild;
      if (look !== 'full') el.dataset.style = look; else delete el.dataset.style;
      el.style.opacity = '0'; el.style.transition = `opacity ${TRAVEL.fade}s ease`;
      container.appendChild(el);
      el.getBoundingClientRect();
      el.style.opacity = '1';
      pic = makeLoading(el, { style: look, base });
    }
    trip = { p, el, pic, at: 0, most: 0, near: 0 };
    // (carried there once the picture covers the walk - its fade ended, or a moment after it should have: the jump not
    // seen, however slow the frames)
    let carried = false;
    const carry = () => {
      if (carried || !trip) return;
      carried = true;
      book?.lower();
      if (s.freeCam.on) s.exitFree();
      stance.now = 'stand';
      s.walkTo(p.at[0], p.at[1], true);
      const L = s.look; L.anchor = null; L.yaw = p.yaw / DEG; L.pitch = p.pitch / DEG; L.goal = [L.yaw, L.pitch]; L.zoom = L.zoomGoal = 1; s._lens();
      console.info('[book] to', p.id, p.at);
      trip.at = performance.now();
    };
    if (!el) { carry(); return; }
    const t0 = performance.now(), opaque = () => getComputedStyle(el).opacity === '1';
    el.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity' && opaque()) carry(); });
    const check = () => { if (carried || !trip) return; if (opaque() || document.hidden || performance.now() - t0 > 8000) carry(); else setTimeout(check, 200); };
    setTimeout(check, TRAVEL.fade * 1000 + 50);
  }
  function travelCheck(now) {
    if (!trip?.at) return;
    // (how far the place has come in: its ground first, then what waits to come in, against the most that waited)
    const w = nearWaiting(); trip.near = w; trip.most = Math.max(trip.most, w);
    trip.pic?.progress(groundLoaded() ? 0.5 + 0.45 * (1 - w / Math.max(1, trip.most)) : 0.3 * Math.min(1, (now - trip.at) / 3000));
    if (!placeIn() && now - trip.at < TRAVEL.most * 1000) return;
    // (lifted as the first picture lifts: faded over the walk, nothing turning the view until it has gone - loading.js)
    if (trip.el) { trip.el.style.opacity = ''; trip.el.style.transition = ''; }
    trip.pic?.done();
    trip = null; travelUp = false; held.clear(); stillUntil = now + 1400;
    controls?.show(!book?.up); mouseState();
  }

  function takeMouse() {
    if (locked() || still) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});      // (the refusal arrives as pointerlockerror, counted below)
    } catch { refusals++; mouseState(); }
  }
  // (let go with the page still in front - Esc; not a window gone behind another, nor the view's copy taking it: the
  // controls' pane marks Esc as done)
  document.addEventListener('pointerlockchange', () => {
    if (locked()) { refusals = 0; everHeld = true; } else { held.clear(); if (everHeld && !marking && document.hasFocus()) controls?.used('esc'); }
    mouseState();
  });
  // (a browser refuses a capture asked for within a second of Esc: a click at once after it - not a window that cannot
  // hold the mouse; the next press is taken)
  document.addEventListener('pointerlockerror', () => { if (!everHeld) refusals++; mouseState(); });
  // (captured: the raw movement, a jump of hundreds of pixels in one event ignored - some systems send one on capture)
  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    if (book?.up) { book.moveBy(e.movementX, e.movementY); return; }
    lookBy(e.movementX, e.movementY);
  });
  // ---- the book: right click brings it up to the face and lowers it again (not under the loading picture, not while
  // flying free); the browser's own menu never shows on the walk
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  function bookToggle() { if (!book?.loaded || frozen() || s.freeCam?.on) return; book.toggle(); controls?.used('book'); }
  // (one finger on a touch screen looks round, two pinch; with the mouse, a press captures it, or drags where refused)
  const pts = new Map();
  let pinch = null, tap = null;
  canvas.addEventListener('pointerdown', (e) => {
    startSound();
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { bookToggle(); return; }
      // (the book up: a click chooses the line under its cursor - with the mouse held, or where the free mouse is)
      if (e.button === 0 && book?.up) { if (!locked()) { book.pointAt(e.clientX, e.clientY); takeMouse(); } book.click(); return; }
      if (e.button !== 0 || locked()) return;
      takeMouse();
      mouseState();
      return;
    }
    // (a finger: a tap is told from a drag when it lifts)
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: s.look.zoomGoal }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      if (book?.up && !locked()) { book.pointAt(e.clientX, e.clientY); return; }
      if (!locked() && refusals >= 2) lookBy(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap = null;
    if (book?.up) return;                                 // (the book up: a finger does not turn the view)
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      zoomTo(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    } else if (pts.size === 1) lookBy(-dx, -dy);           // (dragging moves the scene with the finger)
  });
  const lift = (e) => {
    if (e.pointerType === 'mouse') return;
    if (pts.delete(e.pointerId) && pts.size < 2) pinch = null;
    // (a tap: on the book held low it comes up; up, a tap on a line chooses it, a tap off the book lowers it)
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId && performance.now() - tap.t < 400 && book?.loaded) {
      if (book.up) { book.pointAt(e.clientX, e.clientY); if (!book.click() && !book.onBook(e.clientX, e.clientY)) bookToggle(); }
      else if (book.onBook(e.clientX, e.clientY)) bookToggle();
    }
    tap = null;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  loaded.then(mouseState);
  mouseState();

  // ---- zooming: the wheel (or a trackpad's pinch), toward the middle of the view
  function zoomTo(z) { if (frozen()) return; const L = s.look; L.anchor = null; L.zoomGoal = Math.min(s.zoomMax, Math.max(1, z)); }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    startSound();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    zoomTo(s.look.zoomGoal * Math.min(2, Math.max(0.5, Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0018)))));
    if (!frozen()) controls?.used('zoom');
  }, { passive: false });

  // ---- walking: the keys held, a step easing up to speed and away, as far as the hill allows (countryside: walkTo)
  const held = new Set();
  document.addEventListener('keydown', (e) => {
    // (the free-cam has no key of its own since 21 Nov 2026: it is a dev tool, reached only by __walk.free or by a pose
    //  that says fly - the visitor's ways are walk, look, the book and the scroll. The old Z toggle came out, and its
    //  line came out of the "Getting about" pane with it.)
    // VIEW POSE (dev only; remove with the free-cam): P copies where the view is, to note a fault where it was seen.
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) { e.preventDefault(); copyPose(); return; }
    if (e.code === 'Escape' && marking) { endMark(); showNote('View copied, without a box.', 3000); return; }
    const k = KEYS[e.code];
    if (frozen()) { if (k) e.preventDefault(); return; } // (nothing moves under the loading picture, nor as it fades: lookBy)
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat && !s.freeCam?.on) {
      if (k === 'crouch') stance.now = stance.now === 'crouch' ? 'stand' : 'crouch';
      if (k === 'prone') stance.now = stance.now === 'prone' ? 'stand' : 'prone';
      if (k === 'jump') { if (stance.now !== 'stand') stance.now = 'stand'; else if (stance.y === 0) stance.vy = JUMP.v; }
    }
    held.add(k);
    if (k === 'fwd' || k === 'back' || k === 'left' || k === 'right') controls?.used('walk');
    startSound();
    if (!locked() && k !== 'jump') takeMouse();       // (a key is a gesture too: the mouse is taken, Esc lets it go)
  });
  document.addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k) held.delete(k); });
  addEventListener('blur', () => held.clear());
  const vel = { x: 0, z: 0 };
  // the body: its stance, the eye easing to that stance's height, and a jump's rise and fall
  const stance = { now: 'stand', eye: STANCE.stand.eye, y: 0, vy: 0 };
  function body(dt) {
    const goal = STANCE[stance.now].eye;
    stance.eye += (goal - stance.eye) * (1 - Math.exp(-dt * 8));
    if (stance.vy !== 0 || stance.y > 0) {
      stance.vy -= JUMP.g * dt; stance.y += stance.vy * dt;
      if (stance.y <= 0) { stance.y = 0; stance.vy = 0; steps?.land(underfoot()); }
    }
    s.stance = { eye: stance.eye, jump: stance.y };
  }
  function walk(dt) {
    const f = (held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0), r = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const n = Math.hypot(f, r) || 1, sp = (held.has('run') && stance.now === 'stand' ? SPEED.run : SPEED.walk) * STANCE[stance.now].speed, yaw = s.look.yaw;
    const tx = ((Math.sin(yaw) * f + Math.cos(yaw) * r) / n) * sp, tz = ((-Math.cos(yaw) * f + Math.sin(yaw) * r) / n) * sp;
    const k = 1 - Math.exp(-dt * SPEED.ease);
    vel.x += (tx - vel.x) * k; vel.z += (tz - vel.z) * k;
    if (!f && !r && Math.hypot(vel.x, vel.z) < 0.01) { vel.x = 0; vel.z = 0; return; }
    const before = { x: s.at.x, z: s.at.z }, at = s.walkTo(s.at.x + vel.x * dt, s.at.z + vel.z * dt);
    // (held back by a brow or a trunk: the step dies there instead of pressing on)
    if (dt > 0) { vel.x = (at.x - before.x) / dt; vel.z = (at.z - before.z) / dt; }
    // a footstep every stride (footsteps.js), on what is underfoot; none in the air
    stride += Math.hypot(at.x - before.x, at.z - before.z);
    // (a step every so many seconds at full speed, the stride that makes it: about 2 a second walking, 2.9 running, 1.6
    // crouched, 1.1 crawling)
    const run = held.has('run') && stance.now === 'stand';
    const every = stance.now === 'prone' ? 0.9 : stance.now === 'crouch' ? 0.62 : run ? 0.35 : 0.5;
    const len = (run ? SPEED.run : SPEED.walk) * STANCE[stance.now].speed * every;
    if (stride >= len && stance.y === 0) { stride = 0; steps?.step(underfoot(), { stance: stance.now, run }); }
  }
  // what is underfoot: a bridge's planks, a way's dirt (a town's cobbles), else the ground (terrain.js groundAt)
  let stride = 0;
  function underfoot() {
    const W = s.world, x = s.at.x, z = s.at.z;
    if (!W) return 'grass';
    if (s.bridges?.userData.deckAt(x, z) != null) return 'wood';
    const g = W.groundAt?.(x, z) ?? 'grass';
    if (g === 'water') return 'water';
    if (W.ways && W.ways.near(x, z) < 0.15) return g === 'town' ? 'cobble' : 'dirt';
    return { road: 'dirt', town: 'cobble' }[g] ?? g;
  }
  function fly(dt) {                                // FREE-CAM (dev only; remove with it): fly on the held keys
    const f = (held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0);
    const r = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const u = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
    s.flyFree(dt, f, r, u, held.has('run'));
  }

  // ---- the clock and the frames
  let clock = frozenT ?? 0, last = null, live = !still;
  // (every frame's length, kept to the last 20,000, and the most draws one frame ever made: __walk.stats() gives their
  // percentiles beside the card's own book (draws, triangles, programs, pictures, geometries), and the load's report
  // keeps them with it. The walk judged its frames by a running median alone, which cannot see the several second
  // freezes the complaint was about - a median of 9 ms and a 2 s stall read the same. The performance research of
  // 19 Nov 2026, item 1: measure before speeding up)
  const FPS = []; let maxCalls = 0;
  // (the card's book gathered over a whole frame: the walk draws its passes one after another (sky, the far land, the
  // sun's two, the land, its own last pass, the book), and the book counts only what the last of them drew - read
  // as it was it reported one draw and two triangles for a frame of a hundred thousand)
  renderer.info.autoReset = false;
  function stats(last) {
    const raw = (last && last < FPS.length) ? FPS.slice(FPS.length - last) : FPS;
    const T = raw.slice().sort((a, b) => a - b), at = (q) => (T.length ? +T[Math.min(T.length - 1, Math.floor(T.length * q))].toFixed(2) : null);
    const I = renderer.info;
    return { frames: T.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: T.length ? +T[T.length - 1].toFixed(1) : null,
      over33: T.filter((x) => x > 33).length, over50: T.filter((x) => x > 50).length, over100: T.filter((x) => x > 100).length,
      card: { draws: I.render.calls, mostDraws: maxCalls, triangles: I.render.triangles, programs: I.programs?.length ?? null,
        textures: I.memory.textures, geometries: I.memory.geometries },
      arrivals: { waiting: arrivalsWaiting(), near: arrivalsNear(s.at.x, s.at.z, TRAVEL.near), ...arrivalsState() } };
  }
  // (the frames that took long, for a look at what they carried - __walk.heavy: when (ms since the page began), the
  // whole frame, the scene's update, its own pictures (sky, sun, the land), the show pass, and what came in: arrive.js)
  const HEAVY = [];
  // (and the twenty slowest frames of the whole walk, however late they come: HEAVY stops at its first eighty, so a
  //  walk that stalls often keeps only its first eighty stalls - the several-second ones that come later, and the
  //  worst of all, were the ones nobody could read (19 Nov 2026: pcfreezetest.mjs could not see a 2.9 s frame))
  const WORST = [];
  function noteWorst(rec) {
    if (WORST.length < 20) { WORST.push(rec); WORST.sort((x, y) => y.ms - x.ms); return; }
    if (rec.ms > WORST[WORST.length - 1].ms) { WORST[WORST.length - 1] = rec; WORST.sort((x, y) => y.ms - x.ms); }
  }
  const frameRec = (a, b, c, d) => ({ at: Math.round(a), ms: +(d - a).toFixed(1), update: +(b - a).toFixed(1),
    pictures: +(c - b).toFixed(1), show: +(d - c).toFixed(1),
    came: { ...lastPump, ms: +lastPump.ms.toFixed(1), texMs: +lastPump.texMs.toFixed(1) } });
  function renderAt(t) {
    const a = performance.now();
    renderer.info.reset();                             // (the frame's draws gathered over every pass it makes - autoReset is off, above)
    s.update(t);
    const b = performance.now();
    s.prerender(renderer);
    const c = performance.now();
    if (over.low) over.showLow(() => renderer.render(stage, camera)); else renderer.render(stage, camera);
    over.book(book);
    if (renderer.info.render.calls > maxCalls) maxCalls = renderer.info.render.calls;   // (the busiest frame's draws, for __walk.stats)
    const d = performance.now();
    if (veilUp) report.frame(b - a, c - b, d - c, lastPump); else report.frameAfter(b - a, c - b, d - c, lastPump);
    if (s.ready && d - a > 24) {
      if (HEAVY.length < 80) HEAVY.push(frameRec(a, b, c, d));
      if (d - a > 100) noteWorst(frameRec(a, b, c, d));       // (the twenty slowest of the whole walk, whenever they come)
    }
  }
  function tick(now) {
    requestAnimationFrame(tick);
    if (!live || document.hidden) { last = null; return; }
    if (last !== null) { FPS.push(now - last); if (FPS.length > 20000) FPS.shift(); }   // (the frame's whole length, the walk's work and the wait alike)
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    // (once loaded: if two seconds of frames come, as a rule, slower than about 45 a second, draw the scene's picture
    // smaller; and back up to full size once a few such spells keep up with 60 again. By the median, so a load's
    // hitch never shrinks it for good: it had, and the picture stayed soft for the rest of the walk)
    if (last !== null && s.ready && document.hasFocus()) {
      if (quality.skip > 0) quality.skip--;
      else {
        (quality.times ??= []).push(now - last);
        quality.t0 ||= now;
        // (judged every 120 frames or every 1.5 s, whichever first: at a few frames a second the old 120 frames took
        // a minute a step; the step as big as the frame time asks, down to the tier's floor - hardware.js)
        if (quality.times.length >= 120 || (now - quality.t0 > 1500 && quality.times.length >= 6)) {
          const T = quality.times.sort((a, b) => a - b), med = T[T.length >> 1];
          // (the tail of a spell matters as much as its middle: walking forward the middle of the frames can be a
          //  comfortable 13 ms while one frame in ten takes sixty, and a spell judged by its middle alone says nothing
          //  is wrong. So a spell with many frames over 33 ms, and its ninety-fifth percentile beyond 45,
          //  shrinks the picture too - a smaller step than a slow middle asks for, and held longer before climbing
          //  back, so the two sizes do not flicker against each other every few seconds)
          const p95 = T[Math.min(T.length - 1, Math.floor(0.95 * T.length))];
          const manySlow = T.filter((v) => v > 33).length >= Math.max(6, T.length * 0.07);
          quality.times.length = 0; quality.t0 = now;
          if (med > 22 && quality.scale > GFX.minScale) {
            quality.scale = Math.max(GFX.minScale, quality.scale * Math.max(0.6, Math.min(0.9, Math.sqrt(18 / med)))); quality.good = 0; frame();
          } else if (manySlow && p95 > 45 && quality.scale > GFX.minScale) {
            quality.scale = Math.max(GFX.minScale, quality.scale * 0.92); quality.good = -9; frame();
          } else if (med < 17.5 && quality.scale < GFX.scale && ++quality.good >= 3) { quality.scale = Math.min(GFX.scale, quality.scale / 0.85); quality.good = 0; frame(); }
          else if (med >= 17.5) quality.good = 0;
          // (at the floor and still under 25 a second for a while: the next visit starts a tier lower)
          if (med > 40 && quality.scale <= GFX.minScale + 1e-3) {
            if (++quality.slow === 4 && !gfxInfo.forced && !gfxInfo.locked) {
              rememberTier({ ...gfxInfo, tier: step(gfxInfo.tier, 1), why: `${Math.round(med)} ms a frame at the lowest resolution of ${gfxInfo.tier}` });
              console.info('[gfx] still slow at', gfxInfo.tier, '- the next visit starts at', step(gfxInfo.tier, 1));
            }
          } else quality.slow = 0;
        }
      }
    }
    last = now;
    veilCheck(now);
    travelCheck(now);
    if (warming) return;                 // (nothing drawn or moved while the shaders are made: prime)
    clock += dt;
    if (s.ready) { if (s.freeCam.on) fly(dt); else { body(dt); walk(dt); } }
    book?.update(dt);
    // (the controls' pane not over the book while it is up - its left page's foot is where the pane stands: shown again
    // as the book is lowered)
    controls?.show(!veilUp && !travelUp && !book?.up);
    renderAt(clock);
  }
  renderAt(clock);
  requestAnimationFrame(tick);
  await loaded;
  // ---- the book, once the scene is in (none in a still: book.js; declared with the mouse's state, above)
  if (!still && !params.has('nobook')) {
    // (its pages at the full look's size in every look: the book is drawn at the screen's resolution - bookover.js)
    book = makeBook({ s, base, canvas, coarse: false, pageW: 1536, aniso: cardAniso,
      touch: matchMedia('(pointer: coarse)').matches,
      environment: () => s.environment(renderer),
      speed: () => Math.hypot(vel.x, vel.z),
      onTravel: (p) => travel(p),
    });
    // (in the scene's picture: the book in colour, or its depth alone where it is drawn again over the picture at the
    // screen's resolution - an older machine's look; the glove's cover kept wherever it is laid over the picture)
    s.viewmodel = (r, dt) => book.render(r, dt, { paint: !over.low, cover: over.low || !!s.up });
    book.ready.then(() => Promise.all([book.prime(renderer), over.compile()]));
  }
  container.classList.add('is-live');
  // (a still: no picture to lift - the rest comes in at once, in its place)
  if (still) { openArrivals(s.at); s.loadRest(); s.loadRestFar(); laterDone = true; }

  // ---- VIEW POSE (dev only; remove with the free-cam). pose() says where the view is: degrees right of ahead (yaw) and
  // up (pitch), the zoom, the clock, and where the eye stands (x, z on the hill) or flies (fly, x, y, z). goTo(pose)
  // puts the view back there exactly, so a fault is looked at again just as it was seen.
  function pose() {
    const L = s.look, p = { yaw: r2(L.yaw * DEG), pitch: r2(L.pitch * DEG), zoom: r2(L.zoom), t: Math.round(clock * 10) / 10 };
    if (s.freeCam.on) Object.assign(p, { fly: true, x: r2(s.freeCam.pos.x), y: r2(s.freeCam.pos.y), z: r2(s.freeCam.pos.z) });
    else Object.assign(p, { x: r2(s.at.x), z: r2(s.at.z) });
    return p;
  }
  function goTo(p) {
    if (typeof p === 'string') p = JSON.parse(p);
    if (!s.ready) return 'not ready';
    if (p.fly) { if (!s.freeCam.on) s.enterFree(); s.freeCam.pos.set(+p.x, +p.y, +p.z); }
    else { if (s.freeCam.on) s.exitFree(); if (p.x !== undefined) s.walkTo(+p.x, +p.z, true); }
    const L = s.look;
    L.anchor = null; L.yaw = (+p.yaw || 0) / DEG; L.pitch = (+p.pitch || 0) / DEG; L.goal = [L.yaw, L.pitch];
    L.zoom = L.zoomGoal = Math.min(s.zoomMax, Math.max(1, +p.zoom || 1)); s._lens();
    if (p.t !== undefined) clock = +p.t;
    renderAt(clock);
    return JSON.stringify(pose());
  }
  // P: the pose is copied at once; then a box may be dragged round the problem (the mouse is let go for it), and the
  // pose is copied again with the box as `mark` (fractions of the screen: left, top, right, bottom). Esc keeps it
  // without a box. `screen` says the size it was seen at, so the same picture can be made again.
  function showNote(msg, ms) {
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10;max-width:70vw;padding:6px 10px;border-radius:6px;'
        + 'white-space:pre-wrap;font:13px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.7);pointer-events:none';
      document.body.appendChild(note);
    }
    note.textContent = msg; note.style.display = 'block';
    clearTimeout(showNote.timer); showNote.timer = setTimeout(() => { note.style.display = 'none'; }, ms);
  }
  function publish(p, msg, ms = 6000) {
    const text = JSON.stringify(p);
    navigator.clipboard?.writeText(text).catch(() => {});
    showNote(`${msg}\n${text}`, ms);
  }
  function endMark() { if (marking) { marking.ov.remove(); marking.box.remove(); marking = null; } }
  function copyPose() {
    endMark();
    if (document.pointerLockElement) document.exitPointerLock();
    const p = { ...pose(), screen: [innerWidth, innerHeight] };
    publish(p, 'View copied. Now drag a box round the problem, or press Esc to keep the view without one.', 15000);
    const ov = document.createElement('div'), box = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:8;cursor:crosshair;background:rgba(0,0,0,.04)';
    box.style.cssText = 'position:fixed;z-index:9;display:none;border:2px dashed #ff3b30;pointer-events:none';
    document.body.append(ov, box);
    marking = { ov, box };
    let a = null;
    const draw = (e) => Object.assign(box.style, { left: Math.min(a[0], e.clientX) + 'px', top: Math.min(a[1], e.clientY) + 'px',
      width: Math.abs(e.clientX - a[0]) + 'px', height: Math.abs(e.clientY - a[1]) + 'px' });
    ov.addEventListener('pointerdown', (e) => { a = [e.clientX, e.clientY]; ov.setPointerCapture(e.pointerId); box.style.display = 'block'; draw(e); });
    ov.addEventListener('pointermove', (e) => { if (a) draw(e); });
    ov.addEventListener('pointerup', (e) => {
      if (!a) return;
      const W = innerWidth, H = innerHeight, f = (v) => Math.round(v * 1000) / 1000;
      const r = [Math.min(a[0], e.clientX) / W, Math.min(a[1], e.clientY) / H, Math.max(a[0], e.clientX) / W, Math.max(a[1], e.clientY) / H].map(f);
      if ((r[2] - r[0]) * W > 6 && (r[3] - r[1]) * H > 6) { p.mark = r; publish(p, 'View and box copied.'); }
      ov.remove(); marking = null; setTimeout(() => box.remove(), 2000);
    });
  }

  // The scene's own picture, straight from the renderer: drawn now and copied at once, so it works while the graphics
  // card is too busy for a browser screenshot, and shows exactly this moment. opts: maxWidth (1600), crop and box (the
  // mark: fractions left, top, right, bottom); box is outlined dashed red. Returns a data:image/png URL.
  function snapshot(opts = {}) {
    renderAt(clock);
    const src = renderer.domElement, W = src.width, H = src.height, c = opts.crop || [0, 0, 1, 1];
    const sx = c[0] * W, sy = c[1] * H, sw = Math.max(1, (c[2] - c[0]) * W), sh = Math.max(1, (c[3] - c[1]) * H);
    const k = Math.min(opts.crop ? 4 : 1, (opts.maxWidth || 1600) / sw);
    const out = document.createElement('canvas');
    out.width = Math.round(sw * k); out.height = Math.round(sh * k);
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    if (opts.box) {
      const b = opts.box, X = (v) => ((v * W - sx) * k), Y = (v) => ((v * H - sy) * k);
      g.setLineDash([10, 6]); g.lineWidth = 2; g.strokeStyle = '#ff3b30';
      g.strokeRect(X(b[0]), Y(b[1]), X(b[2]) - X(b[0]), Y(b[3]) - Y(b[1]));
    }
    return out.toDataURL('image/png');
  }

  const api = { scene: s, pose, goTo, snapshot, renderer, renderAt, frame, get time() { return clock; }, set time(t) { clock = t; },
    play() { live = true; }, pause() { live = false; }, lookBy, zoomTo,
    // (the leaving as a change of look does it, without the change: the choice kept in this browser is not touched -
    // a test then loads the page with ?gfx=)
    walkTo: (x, z, jump = true) => s.walkTo(x, z, jump), look: (yaw, pitch) => { s.look.anchor = null; s.look.yaw = yaw; s.look.pitch = pitch; s.look.goal = [yaw, pitch]; },
    free: () => (s.freeCam.on ? (s.exitFree(), false) : (s.enterFree(), true)), get freeCam() { return s.freeCam.on; },   // (dev free-cam)
    sound: startSound, get quality() { return quality.scale; }, gfx: { ...gfxInfo, settings: GFX },
    // (for tests: everything asked for is in, in its place and still - the cities loaded, no file being read, nothing
    // waiting to come in or rising)
    get allIn() { return s.ready && !veilUp && laterDone && pending === 0 && !managerBusy && arrivalsWaiting() === 0; },
    get arriving() { return arrivalsWaiting(); }, get arrivals() { return arrivalsState(); }, get heavy() { return HEAVY; }, get worst() { return WORST; },
    // (the frames' percentiles and the card's book: stats; a place's own arrivals: nearWaiting; and a test's way of
    //  asking for one arrival far off, to see whether a travel waits for it - the whole point of backlog item 3)
    stats, arrive, get nearWaiting() { return nearWaiting(); }, get travelUp() { return travelUp; },
    get book() { return book; },
    get controls() { return controls; } };
  window.__walk = api;
  window.__walkReady = true;
  return api;
}
