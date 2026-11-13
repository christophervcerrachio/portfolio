// The site, as a walk: the countryside scene (backdrops/countryside.js), the full page, walked in the first person.
// A click takes the mouse (and starts the sound: a browser allows sound only after a click or a key); the mouse looks
// round; W A S D or the arrow keys walk, Shift sprints, Space jumps, C crouches, X lies prone (C and X again stand up);
// the wheel zooms in and out; Esc lets the mouse go. Where the browser will not take the mouse, moving it looks round.
// While the mouse is not taken, "Click to look around" shows in the middle (the only thing drawn over the scene); on a touch
// screen, one finger looks round and two pinch to zoom. The robot and God's arms (hero.js) are kept for later.
//
// For tests and stills: ?t=<seconds> shows that moment, ?still holds it; window.__walk is the scene and its controls.
// Dev only (remove with the free-cam): P copies the view's pose, then a box dragged round the problem; __walk.pose()
// reads the pose and __walk.goTo(pose) returns to it.
import { chooseTier, guessTier, rememberTier, keepChoice, step, TIERS, ORDER, STYLES, CHOICES, choiceOf } from './hardware.js';
import { setTextureCap } from './texcap.js';
import { useStyle } from './retro.js';
import { initDepth } from './depthmode.js';
import * as THREE from 'three';
import { CountrysideScene } from './backdrops/countryside.js';
import { windSound } from './sound.js';
import { makeFootsteps } from './footsteps.js';
import { groundLoaded } from './world/terrain.js';
import { setupArrivals, openArrivals, departAll, compileView, compileShadow, arrivalsWaiting, arrivalsState, lastPump } from './world/arrive.js';
import { startLoading } from './loading.js';

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
  const gfxInfo = chooseTier(renderer.getContext()), GFX = TIERS[gfxInfo.tier];
  console.info('[gfx]', gfxInfo.tier, '-', gfxInfo.why, '-', gfxInfo.gpu);
  // (below the full look, an older machine's way of drawing - hardware.js STYLES, retro.js: its own number of lines
  // whatever the screen, its textures' filtering, its corners on the pixel grid; set before anything is made)
  const retro = useStyle(GFX.style ? STYLES[GFX.style] : null, canvas);
  renderer.setPixelRatio(retro ? 1 : Math.min(devicePixelRatio || 1, GFX.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
  if (GFX.aniso) { const most = renderer.capabilities.getMaxAnisotropy(); renderer.capabilities.getMaxAnisotropy = () => Math.min(most, GFX.aniso); }
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
  // (what comes in once the walk has begun - world/arrive.js: made for the scene's own picture, rising into place)
  setupArrivals({ renderer, scene: s.land, camera: () => s.cam, target: () => s.rt, shadow: () => s.shadow, still: still || noRise,
    budget: GFX.style ? { ms: 4, tex: 8e6, geo: 5e6, compiles: 2 } : null });
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
  const veilStart = performance.now();
  // (the load's timeline in the console - "[load] <stage> <ms since the page began>" - so its slow parts can be found)
  // (and how much of it the page's own work held the browser up: its long tasks, summed)
  let busy = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) busy += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* (none) */ }
  const tl = (label) => { console.info('[load]', label, Math.round(performance.now()), 'busy', Math.round(busy)); loading?.stage(label); };
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
    // (in for a second and a couple of frames drawn, then the shaders (a window behind others gets a frame a second)
    settledAt = settled ? (settledAt ?? now) : null;
    if (((framesSince > 2 && now - settledAt > 1000) || framesSince > 60 || now - veilStart > 30000) && !warmed && !warming) { prewarm(); return; }
    if (warmed) {
      veilUp = false; tl('veil lifted');
      loading?.done();
      open();
    }
  }
  // (every shader the first view will draw made before the picture lifts, in the background and for the picture it is
  // drawn into (world/arrive.js compileView): a wood of a kind not yet seen, or the gold birches, coming into view had
  // stopped the frame for a fifth of a second while the card built its program)
  let warmed = false, warming = !still, primed = still;
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
    primed = true; warming = false;
  }
  // (once the picture has lifted: the rest asked for, the opening's wave set off, and the cities loaded)
  function open() {
    const at = s.freeCam.on ? s.freeCam.pos : s.at;
    openArrivals(at);
    // (the woods rise out of the ground in a wave from the walker: wind-glsl.js riseAt; off again once it has passed
    // the farthest tree)
    if (!still && !noRise) {
      s.U.uRise.value.set(at.x, at.z, clock, 450);
      const off = () => { if (s.U.uRise.value.w <= 0) return; if (clock - s.U.uRise.value.z > 7.5) s.U.uRise.value.w = 0; else setTimeout(off, 500); };
      setTimeout(off, 7000);
    }
    s.loadRest();
    later();
  }
  // (the cities, once the walk has begun: loaded, their shaders made in the background, then into the scene -
  // countryside.js loadLater; what comes in of them rises in its place: world/arrive.js)
  let laterDone = false;
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
      // in a few MB a frame, each rising in its place)
      await Promise.all([compileView(tmp), compileShadow(tmp)]);
      for (const t of spare) tmp.remove(t);
      for (const o of groups) tmp.remove(o);
    } catch (e) { console.warn('cities', e); }
    s.addLater();
    laterDone = true;
    tl('cities: shown');
  }
  async function prewarm() {
    warming = true; tl('shaders: start');
    try {
      await Promise.all([
        compileView(s.skyScene, { camera: s.cam, scene: s.skyScene }).then(() => tl('shaders: sky compiled')),
        compileView(s.farScene, { camera: s.farCam ?? s.cam, scene: s.farScene }).then(() => tl('shaders: far compiled')),
        Promise.all([compileView(s.land), compileShadow(s.land)]).then(() => tl('shaders: land compiled')),
      ]);
      // (and a look all the way round, drawn in full, so what changes with the view - the woods' near and far copies,
      // the rivers' - and every picture it shows is on the card now too)
      s.land.updateMatrixWorld();
      const L = s.look, keep = [L.yaw, L.pitch, L.goal[0], L.goal[1]];
      for (let k = 0; k < 12; k++) {
        L.yaw = L.goal[0] = (k / 12) * Math.PI * 2; L.pitch = L.goal[1] = k % 2 ? -0.25 : 0.05;
        renderAt(clock); await new Promise((r) => setTimeout(r, 0));
      }
      [L.yaw, L.pitch, L.goal[0], L.goal[1]] = keep;
      tl('shaders: the look round drawn');
    } catch (e) { console.warn('prewarm', e); }
    warming = false; warmed = true;
  }
  tl('scene load: start');
  const loaded = s.load(base, tl).then(() => {
    tl('scene load: built'); s.setFree(true);
    if (!still) prime();
    // (a change of graphics in the menu loads the walk again: the walker put back where he stood, looking the way he looked)
    try {
      const kept = sessionStorage.getItem('career-pose');
      if (kept) { sessionStorage.removeItem('career-pose'); const p = JSON.parse(kept); delete p.t; setTimeout(() => goTo(p), 0); }
    } catch { /* (none) */ }
  });

  // ---- size: the scene's picture at the screen's own resolution, less if the frames come too slowly (below)
  const quality = { scale: GFX.scale, n: 0, sum: 0, skip: 120, good: 0, times: [], slow: 0, t0: 0 };
  function frame() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    if (retro) {
      // (an older machine's picture: its own lines, the canvas itself that small and scaled up by the page)
      const [W, H] = retro.size(w, h);
      renderer.setSize(W, H, false); s.resize(W, H);
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
  function lookBy(dx, dy) {
    const L = s.look, z = Math.max(1, L.zoom), M = L.limits;
    L.anchor = null;
    L.yaw += dx * LOOK / z;
    L.pitch = Math.min(M.pitch[1], Math.max(M.pitch[0], L.pitch - (dy * LOOK) / z));
    L.goal = [L.yaw, L.pitch];
  }
  // ---- the mouse. Three states, always one of them:
  //   captured  - the browser has given the page the mouse (pointer lock): moving it turns the view, no cursor, no edge;
  //               Esc lets it go.
  //   free      - not captured yet, or let go: the cursor shows, and a small "Click to look around" asks for a click (or any
  //               walking key) to capture it.
  //   refused   - this browser will not give the page the mouse (an embedded pane, a page that is not the focused
  //               window): moving the mouse turns the view all the same, no button held, the cursor hidden; it can only
  //               turn as far as the cursor can go before the window's edge, so a note says once where the mouse can be
  //               taken (Chrome, Edge).
  // A browser refuses a capture asked for just after Esc (about a second): the next click tries again.
  const locked = () => document.pointerLockElement === canvas;
  let refusals = 0, noted = false, everHeld = false, menuOpen = false;
  // (the note, the view-copy mark and the pose's units (below) are read by the keys, the mouse and the menu from the
  // first moment, the walk still loading: declared here, before any of them is listened for - declared further down,
  // an Esc while loading had stopped on them unread, and the menu never came up)
  let note = null, marking = null;
  const DEG = 180 / Math.PI, r2 = (v) => Math.round(v * 100) / 100;
  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;padding:10px 18px;'
    + 'font:500 15px/1.3 system-ui,sans-serif;color:#fff;background:rgba(20,24,28,.55);border-radius:6px;'
    + 'pointer-events:none;transition:opacity .25s;opacity:0;text-align:center';
  container.appendChild(hint);
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
    hint.style.opacity = locked() || still || !s.ready || menuOpen ? '0' : '1';
  }

  // ---- the menu. Esc lets the mouse go and the menu comes up: whose page this is, Resume, and how the picture is
  // drawn - Full, or one of the older machines' ways (hardware.js CHOICES). A choice is kept for this browser and the
  // walk loads again where the walker stands. It is a pane of glass over the scene (index.html .walk-menu): the scene
  // shows through it, blurred, and a click on the scene beside it resumes as it always did. It comes up while the walk
  // is still loading too (over the loading picture), and the newest choice is the one kept: a heavy look's load is not
  // waited out to choose another, and a second choice made while the page is going still counts (until 12 Nov 2026 the
  // menu came up only once the walk was in, and every choice was greyed out until the next page had loaded)
  const menu = document.createElement('div');
  menu.className = 'walk-menu'; menu.hidden = true;
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Menu');
  const mine = choiceOf(guessTier(renderer.getContext()).tier), nowIs = choiceOf(gfxInfo.tier);
  menu.innerHTML = `<div class="walk-menu-pane">
    <h1>Christopher Cerrachio</h1>
    <button type="button" class="walk-menu-resume">Resume</button>
    <fieldset>
      <legend>Graphics</legend>
      ${CHOICES.map((c) => `<label class="walk-menu-choice"><input type="radio" name="walk-gfx" value="${c.id}"${c.id === nowIs ? ' checked' : ''}>
        <span class="walk-menu-name">${c.name}${c.id === mine ? '<small>this computer\u2019s</small>' : ''}</span>
        <span class="walk-menu-about">${c.about}</span></label>`).join('')}
    </fieldset>
    <p class="walk-menu-note" aria-live="polite">A change loads the walk again, where you stand.</p>
  </div>`;
  container.appendChild(menu);
  const menuNote = menu.querySelector('.walk-menu-note'), resumeBtn = menu.querySelector('.walk-menu-resume');
  let leaving = false;
  function showMenu(on) {
    on = !!on && !still;
    if (on === menuOpen) return;
    menuOpen = on; menu.hidden = !on;
    if (on) { held.clear(); resumeBtn.focus({ preventScroll: true }); } else canvas.focus({ preventScroll: true });
    mouseState();
  }
  resumeBtn.addEventListener('click', () => { startSound(); takeMouse(); if (refusals >= 2) showMenu(false); });
  menu.addEventListener('change', (e) => {
    const id = e.target?.value;
    if (!id || (id === nowIs && !leaving)) return;
    // (kept for this browser; where the walker stands and looks kept for the page that loads next - unless the place
    // from the last change is still waiting to be put back, this page not yet in: that one; the address's own ?gfx=
    // dropped, so the choice is what the next page reads)
    keepChoice(id, renderer.getContext());
    try {
      if (!sessionStorage.getItem('career-pose')) sessionStorage.setItem('career-pose', JSON.stringify(pose()));
      sessionStorage.removeItem('career-gfx-tries');
    } catch { /* (none) */ }
    menuNote.textContent = 'Loading the walk again\u2026';
    if (leaving) return;
    leaving = true;
    const u = new URL(location.href); u.searchParams.delete('gfx');
    const go = () => { if (u.href === location.href) location.reload(); else location.replace(u.href); };
    if (still || noRise || !s.ready || veilUp) { setTimeout(go, 60); return; }
    leave().then(go, go);
  });
  // (a change of look: everything that has come in goes back into the ground in a wave from the walker - the woods by
  // their shader, the rest by world/arrive.js departAll - the land left bare; that picture kept for the page that loads
  // next, which shows it while the walk comes in again under it (index.html, the held picture), then lifts it as
  // everything rises in the new look. The load's own stalls are under that picture, not in the walk)
  async function leave() {
    showMenu(false);
    const at = s.freeCam.on ? s.freeCam.pos : s.at;
    // (the woods' wave by the page's own clock, not the walk's: the walk's holds a slow frame to a tenth of a second)
    const SPEED = 5000, t0 = performance.now();
    s.U.uRise.value.set(at.x, at.z, clock, -SPEED);
    const woodsDown = new Promise((r) => {
      const step = () => {
        const e = (performance.now() - t0) / 1000;
        s.U.uRise.value.z = clock - e;
        if (e > 5200 / SPEED + 0.7) r(); else requestAnimationFrame(step);   // (the far woods' edge, and a tree's own 0.6 s)
      };
      step();
    });
    await Promise.race([Promise.all([departAll(at), woodsDown]), new Promise((r) => setTimeout(r, 4000))]);
    await new Promise((r) => requestAnimationFrame(() => {
      try {
        renderAt(clock);
        // (taken in the same turn as the frame is drawn: the card's picture is still there then)
        const k = Math.min(1, 1600 / canvas.width), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = !retro;
        g.drawImage(canvas, 0, 0, c.width, c.height);
        sessionStorage.setItem('career-held', JSON.stringify({ src: c.toDataURL('image/jpeg', 0.86), px: !!retro, t: Date.now() }));
      } catch { /* (no picture kept: the loading picture, as before) */ }
      r();
    }));
  }
  function takeMouse() {
    if (locked() || still) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});      // (the refusal arrives as pointerlockerror, counted below)
    } catch { refusals++; mouseState(); }
  }
  document.addEventListener('pointerlockchange', () => {
    if (locked()) { refusals = 0; everHeld = true; showMenu(false); } else { held.clear(); if (everHeld && !marking) showMenu(true); }
    mouseState();
  });
  // (a browser refuses a capture asked for within a second of Esc: with the menu up that is Resume pressed at once -
  // not a window that cannot hold the mouse; the next press is taken)
  document.addEventListener('pointerlockerror', () => { if (!everHeld) refusals++; mouseState(); });
  // (captured: the raw movement, a jump of hundreds of pixels in one event ignored - some systems send one on capture)
  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    lookBy(e.movementX, e.movementY);
  });
  // (one finger on a touch screen looks round, two pinch; with the mouse, a press captures it, or drags where refused)
  const pts = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    startSound();
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'mouse') {
      if (e.button !== 0 || locked()) return;
      takeMouse();
      mouseState();
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: s.look.zoomGoal }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      if (!locked() && refusals >= 2) lookBy(e.movementX || 0, e.movementY || 0);
      return;
    }
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
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  loaded.then(mouseState);
  mouseState();

  // ---- zooming: the wheel (or a trackpad's pinch), toward the middle of the view
  function zoomTo(z) { const L = s.look; L.anchor = null; L.zoomGoal = Math.min(s.zoomMax, Math.max(1, z)); }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    startSound();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    zoomTo(s.look.zoomGoal * Math.min(2, Math.max(0.5, Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0018)))));
  }, { passive: false });

  // ---- walking: the keys held, a step easing up to speed and away, as far as the hill allows (countryside: walkTo)
  const held = new Set();
  document.addEventListener('keydown', (e) => {
    // FREE-CAM (dev only; remove with it): Z toggles flying; the second Z sets the walker down where the camera is.
    if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      e.preventDefault();
      if (s.ready) { if (s.freeCam.on) { s.exitFree(); vel.x = 0; vel.z = 0; } else s.enterFree(); }
      return;
    }
    // VIEW POSE (dev only; remove with the free-cam): P copies where the view is, to note a fault where it was seen.
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) { e.preventDefault(); copyPose(); return; }
    if (e.code === 'Escape' && marking) { endMark(); showNote('View copied, without a box.', 3000); return; }
    if (e.code === 'Escape' && !locked() && !e.repeat) { showMenu(!menuOpen); return; }
    if (menuOpen) return;                              // (the menu's own keys: Tab, the arrows, Enter)
    const k = KEYS[e.code];
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat && !s.freeCam?.on) {
      if (k === 'crouch') stance.now = stance.now === 'crouch' ? 'stand' : 'crouch';
      if (k === 'prone') stance.now = stance.now === 'prone' ? 'stand' : 'prone';
      if (k === 'jump') { if (stance.now !== 'stand') stance.now = 'stand'; else if (stance.y === 0) stance.vy = JUMP.v; }
    }
    held.add(k);
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
  // (the frames that took long, for a look at what they carried - __walk.heavy: when (ms since the page began), the
  // whole frame, the scene's update, its own pictures (sky, sun, the land), the show pass, and what came in: arrive.js)
  const HEAVY = [];
  function renderAt(t) {
    const a = performance.now();
    s.update(t);
    const b = performance.now();
    s.prerender(renderer);
    const c = performance.now();
    renderer.render(stage, camera);
    const d = performance.now();
    if (d - a > 24 && s.ready && HEAVY.length < 80) HEAVY.push({ at: Math.round(a), ms: +(d - a).toFixed(1), update: +(b - a).toFixed(1), pictures: +(c - b).toFixed(1), show: +(d - c).toFixed(1), came: { ...lastPump, ms: +lastPump.ms.toFixed(1), texMs: +lastPump.texMs.toFixed(1) } });
  }
  function tick(now) {
    requestAnimationFrame(tick);
    if (!live || document.hidden) { last = null; return; }
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
          quality.times.length = 0; quality.t0 = now;
          if (med > 22 && quality.scale > GFX.minScale) {
            quality.scale = Math.max(GFX.minScale, quality.scale * Math.max(0.6, Math.min(0.9, Math.sqrt(18 / med)))); quality.good = 0; frame();
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
    if (warming) return;                 // (nothing drawn or moved while the shaders are made: prewarm)
    clock += dt;
    if (s.ready) { if (s.freeCam.on) fly(dt); else { body(dt); walk(dt); } }
    renderAt(clock);
  }
  renderAt(clock);
  requestAnimationFrame(tick);
  await loaded;
  container.classList.add('is-live');
  // (a still: no picture to lift - the rest comes in at once, in its place)
  if (still) { openArrivals(s.at); s.loadRest(); laterDone = true; }

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
    leave: () => leave().then(() => !!sessionStorage.getItem('career-held')),
    walkTo: (x, z, jump = true) => s.walkTo(x, z, jump), look: (yaw, pitch) => { s.look.anchor = null; s.look.yaw = yaw; s.look.pitch = pitch; s.look.goal = [yaw, pitch]; },
    free: () => (s.freeCam.on ? (s.exitFree(), false) : (s.enterFree(), true)), get freeCam() { return s.freeCam.on; },   // (dev free-cam)
    sound: startSound, get quality() { return quality.scale; }, gfx: { ...gfxInfo, settings: GFX },
    // (for tests: everything asked for is in, in its place and still - the cities loaded, no file being read, nothing
    // waiting to come in or rising)
    get allIn() { return s.ready && !veilUp && laterDone && pending === 0 && !managerBusy && arrivalsWaiting() === 0; },
    get arriving() { return arrivalsWaiting(); }, get arrivals() { return arrivalsState(); }, get heavy() { return HEAVY; } };
  window.__walk = api;
  window.__walkReady = true;
  return api;
}
