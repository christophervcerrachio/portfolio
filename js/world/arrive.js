// What comes into the walk after it has begun - a village, a bridge, a landmark, a city's skyline, a tile of its houses
// or of its yards, a street's furniture - is not drawn the moment its file is read. It comes in here, in turn, the
// nearest to the walker first:
//   1. its shaders made in the background (the browser's parallel compiling): the page goes on drawing meanwhile;
//   2. its pictures sent to the graphics card a few a frame;
//   3. its triangles let through within a frame's budget;
//   4. and then it rises out of the ground into its place.
// Before, each piece was drawn the frame it was read, and that frame waited for all of it: the card building its
// programs (on a first visit a city's first frame took 0.9 s), its pictures and its triangles all going up at once -
// the hitches of the walk's first minute.
// Nothing comes in before the walk is shown (openArrivals): what is read under the loading picture waits, and rises
// with the rest when the picture lifts, in a wave out from the walker - the nearest first.
//
// The programs are made for the picture they will be drawn into. three.js makes a different program for a material
// drawn into a picture of its own (the scene's: no tone mapping, linear colour) than for one drawn straight to the
// screen, and a different one again in the reversed depth: a program made for the screen is not the one the scene
// draws with, and the scene's own was then made at its first frame, in that frame. So every program here is made with
// the scene's picture bound (compileView) or the sun's (compileShadow).
import * as THREE from 'three';
import { depthMode } from '../depthmode.js';

const A = {
  renderer: null, scene: null, cam: () => null, target: () => null, shadow: null,
  open: false, still: false,
  queue: [], rising: [],
  sent: new Set(),                 // (pictures already on the card: their source's uuid)
  shadowMade: new Set(),           // (depth programs made: the depth material's uuid and the kind of object)
  // (a frame's share at sixty frames a second - less of it a frame on a faster screen, more on a slower, so the same
  // comes in each second whatever the screen: programs begun; pictures sent - for so many ms of the frame, and so
  // many bytes; triangles let through, in bytes: they go to the card as the next frame draws them. The bytes are an
  // allowance that fills frame by frame and is drawn on: a picture or a model larger than a frame's share still goes,
  // whole, and the frames after it send nothing until its bytes are paid for - so a large one is followed by frames
  // with time to spare, not by another)
  budget: { ms: 3, tex: 12e6, geo: 6e6, compiles: 3 },
  last: 0, texAllow: 0, geoAllow: 0,
  // the opening wave: what waits for the walk to be shown rises from the walker outward at this speed (m/s), the last
  // of it at most this long after the first (s)
  wave: { speed: 1400, most: 3.2 },
  far: 4500,                       // (m: past this a thing grows up from its foot rather than rising through the ground)
  sorted: 0,
};

/** As the walk begins. scene: what everything is drawn in (the lights, the fog); camera, target and shadow: functions
 *  giving the view's camera, the picture the scene is drawn into and the sun's near picture (a SunShadow: its depth
 *  programs), each once it exists; still: a still or a test - nothing rises. */
export function setupArrivals({ renderer, scene, camera, target, shadow = () => null, still = false, budget = null }) {
  Object.assign(A, { renderer, scene, cam: camera, target, shadow, still });
  if (budget) Object.assign(A.budget, budget);
}

/** The walk is shown: what has waited comes in now, rising in a wave out from `pos` (the walker). */
export function openArrivals(pos) {
  if (A.open) return;
  A.open = true;
  for (const a of A.queue) {
    const d = Math.hypot(a.x - pos.x, a.z - pos.z);
    a.delay = Math.max(a.delay, Math.min(A.wave.most, d / A.wave.speed));
  }
}
export const arrivalsOpen = () => A.open;

/** The view's programs for `obj` made in the background, as the scene will draw it: a promise, resolved when the
 *  card has them. o: { camera, scene } to make them as another scene draws them (the sky's, the far land's);
 *  target: the picture they are drawn into, where it is not the scene's own (the sky's panorama). */
export function compileView(obj, o = {}) {
  const r = A.renderer, rt = o.target ?? A.target?.(), cam = o.camera ?? A.cam?.();
  if (!r || !rt || !cam || !r.compileAsync) return Promise.resolve();
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  let p;
  try { p = r.compileAsync(obj, cam, o.scene ?? A.scene); } catch (e) { p = Promise.resolve(); console.warn('compile', e); } finally { r.setRenderTarget(prev); }
  return p.catch(() => {});
}

// (a stand-in of three corners for a mesh: the same attributes, the same material, the same kind of object - what a
// program is made from - and none of its triangles)
function standIn(o, material) {
  const g = new THREE.BufferGeometry();
  for (const [n, at] of Object.entries(o.geometry.attributes)) {
    const a = new Float32Array(at.itemSize * 3), get = [at.getX, at.getY, at.getZ, at.getW];
    for (let v = 0; v < Math.min(3, at.count); v++) for (let c = 0; c < at.itemSize; c++) a[v * at.itemSize + c] = get[c].call(at, v);
    g.setAttribute(n, new THREE.BufferAttribute(a, at.itemSize));
  }
  const c = o.isInstancedMesh ? new THREE.InstancedMesh(g, material, 1) : new THREE.Mesh(g, material);
  c.frustumCulled = false; c.matrixAutoUpdate = false;
  return c;
}

/** The sun's depth programs for whatever of `obj` throws a shadow, made in the background with the sun's own picture
 *  bound and its ordinary depth: a promise. */
export function compileShadow(obj) {
  const r = A.renderer, S = A.shadow?.();
  if (!r || !S?.depthOf || !r.compileAsync) return Promise.resolve();
  const stand = new THREE.Scene();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const dm = S.depthOf(o);
    if (!dm) return;
    const k = dm.uuid + (o.isInstancedMesh ? 'i' : '') + (o.isSkinnedMesh ? 's' : '');
    if (A.shadowMade.has(k)) return;
    A.shadowMade.add(k);
    stand.add(standIn(o, dm));
  });
  if (!stand.children.length) return Promise.resolve();
  const prev = r.getRenderTarget();
  r.setRenderTarget(S.rt);
  depthMode(r, false);
  let p;
  try { p = r.compileAsync(stand, S.cam, stand); } catch (e) { p = Promise.resolve(); console.warn('compile', e); } finally { depthMode(r, true); r.setRenderTarget(prev); }
  return p.catch(() => {}).then(() => stand.traverse((m) => m.geometry?.dispose?.()));
}

// ---- the pictures: each sent to the card once, a few a frame
const TEXKEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap'];
function texturesOf(list) {
  const out = new Set();
  const look = (m) => {
    if (!m) return;
    for (const k of TEXKEYS) if (m[k]?.isTexture) out.add(m[k]);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) out.add(u.value);
    for (const t of m.userData?.pictures ?? []) if (t?.isTexture) out.add(t);
  };
  for (const o of list) o.traverse((c) => { if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(look); });
  return [...out];
}
// (a material's shader may take pictures that are not among its own maps - the rooms behind a house front's windows:
// interiors.js lists them in the material's userData.pictures, and they come in with it)

const keyOf = (t) => t.source?.uuid ?? t.uuid;
function pictureReady(t) {
  const im = t.image;
  if (!im) return false;
  if (im.data) return true;
  if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) return im.complete && im.naturalWidth > 0;
  return (im.width ?? 0) > 0;
}
const pictureBytes = (t) => { const im = t.image; return im ? (im.width || 0) * (im.height || 0) * 4 * (t.generateMipmaps === false ? 1 : 1.33) : 0; };
// (already on the card: a picture something in view uses was sent when that was first drawn)
function onCard(t) {
  const p = A.renderer.properties?.get?.(t);
  return !!p && p.__webglTexture !== undefined && p.__version === t.version;
}

// A large picture goes up a strip at a time. Sent whole, a 2048 px picture holds the page 5 ms and one of 4096 px over
// 20 (measured in Chrome, 12 Nov 2026) - a dropped frame or three each on a fast screen, and the walk takes in some
// sixty such pictures in its first minute. So the card is first asked for the picture's room, with no pixels; its rows
// follow, a few MB at a time within the frame's share (three's copyTextureToTexture, given a strip of the picture's
// own rows), and its smaller copies are made with the last of them. Only a bitmap that goes up as it is - not turned
// over, its alpha not multiplied in - is sent so; any other picture goes whole.
const STRIP = 3.2e6;                 // (bytes of pixels to a strip)
const sBox = new THREE.Box2(), sAt = new THREE.Vector2(), sTo = new THREE.Vector2();
const upping = new Set();           // (pictures part of the way up: another thing that uses one waits for the rest of it)
function inStrips(t) {
  const im = t.image;
  return typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap && t.version > 0 && !t.flipY && !t.premultiplyAlpha
    && !t.isCompressedTexture && !t.isDataTexture && !t.isCubeTexture && !(t.mipmaps?.length > 0)
    && im.width * im.height * 4 > STRIP * 1.5 && typeof A.renderer.copyTextureToTexture === 'function';
}
/** The next strip of `a`'s first picture (a.upY: the rows already there). Returns the bytes sent; a.upY undefined
 *  once the whole picture is up. */
function sendStrip(a, t) {
  const im = t.image, w = im.width, h = im.height, r = A.renderer;
  if (a.upY === undefined) {
    // (its room on the card, and nothing in it yet)
    t.source.dataReady = false;
    try { r.initTexture(t); } finally { t.source.dataReady = true; }
    a.upY = 0; upping.add(keyOf(t));
  }
  const y1 = Math.min(h, a.upY + Math.max(16, Math.floor(STRIP / (w * 4)))), last = y1 >= h, mips = t.generateMipmaps;
  if (!last) t.generateMipmaps = false;
  try { r.copyTextureToTexture(t, t, sBox.set(sAt.set(0, a.upY), sTo.set(w, y1)), sAt); } finally { t.generateMipmaps = mips; }
  const b = w * (y1 - a.upY) * 4 * (mips ? 1.33 : 1);
  a.upY = last ? undefined : y1;
  if (last) upping.delete(keyOf(t));
  return b;
}

// ---- the triangles' weight
const counted = new WeakSet();
function bytesOf(list) {
  let b = 0;
  for (const root of list) root.traverse((m) => {
    const g = m.geometry;
    if (!g || counted.has(g)) return;
    counted.add(g);
    for (const a of Object.values(g.attributes)) b += a.array?.byteLength ?? a.data?.array?.byteLength ?? 0;
    if (g.index) b += g.index.array.byteLength;
    if (m.isInstancedMesh) b += m.instanceMatrix.array.byteLength;
  });
  return b;
}

/**
 * Bring `objs` (an object, or several that come in together: a bridge's deck and piers, a tile's meshes) into the walk.
 * opts:
 *   parent  the group they join when they come in (they are added to it then, not before)
 *   gate    they are in the scene already, hidden; their owner shows them once allowed (reveal.js)
 *   x, z    where they stand (else the middle of their bounds)
 *   rise    false: shown where they stand, at once (a closer copy taking a farther one's place); a function: asked
 *           when they are shown
 *   depth   how far below they start (m; else their own height and a little); dur: how long the rise takes (s)
 *   delay   s before the rise begins
 *   batch, wave   a name shared by the pieces of one thing (a city's skyline) and a speed (m/s): its pieces rise in a
 *           wave from the nearest, each the later the farther it is
 *   cancel  a function: true once they are no longer wanted at all (taken out before they came in)
 * Returns a promise, resolved once they stand in their place.
 */
export function arrive(objs, opts = {}) {
  const list = (Array.isArray(objs) ? objs : [objs]).filter(Boolean);
  return new Promise((res) => {
    if (!list.length) { res(); return; }
    let { x, z } = opts;
    if (x === undefined || z === undefined) {
      const box = new THREE.Box3();
      for (const o of list) { o.updateMatrixWorld(true); box.expandByObject(o); }
      const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      x = c.x; z = c.z;
    }
    A.queue.push({ list, parent: opts.parent ?? null, gate: !!opts.gate, x, z, rise: opts.rise ?? true, depth: opts.depth, dur: opts.dur,
      delay: opts.delay ?? 0, batch: opts.batch ?? null, wave: opts.wave ?? 2500, stage: 0, tex: null, bytes: -1, res, cancel: opts.cancel ?? null });
  });
}

/** How many are waiting to come in or still rising (tests: everything in once this is 0). */
export const arrivalsWaiting = () => A.queue.length + A.rising.length;

/** For tests: how many wait at each step (to be begun, shaders being made, pictures, triangles), how many are rising,
 *  and what the first few held at their pictures are waiting for. */
export function arrivalsState() {
  const steps = [0, 0, 0, 0];
  for (const a of A.queue) steps[Math.min(3, a.stage)]++;
  const held = A.queue.filter((a) => a.stage === 2 && a.tex?.length).slice(0, 4).map((a) => {
    const t = a.tex[0], im = t.image;
    return { of: a.list[0]?.name || a.list[0]?.type, picture: t.name || t.uuid.slice(0, 8),
      image: im ? `${im.constructor?.name} ${im.width ?? '?'}x${im.height ?? '?'}${im.src ? ' ' + String(im.src).slice(-70) : ''}${im.complete === false ? ' (coming)' : ''}` : 'none yet' };
  });
  return { open: A.open, waiting: A.queue.length, rising: A.rising.length, steps, held };
}

/** What the last frame's turn let in, for the walk's own record of its heavy frames (walk.js `heavy`): ms spent here,
 *  programs begun, pictures sent (how many, bytes, ms), things shown and their triangles' bytes. */
export const lastPump = { ms: 0, began: 0, tex: 0, texBytes: 0, texMs: 0, shown: 0, geo: 0, big: '' };

/** Once a frame, before the scene's places are worked out: the waiting let in by turns, the rising raised. */
export function pumpArrivals(pos, now = performance.now()) {
  raise(now);
  lastPump.ms = lastPump.began = lastPump.tex = lastPump.texBytes = lastPump.texMs = lastPump.shown = lastPump.geo = 0; lastPump.big = '';
  // (the frame's share by the clock: a frame of a 144 a second screen takes 0.4 of a sixtieth's, one of 30 a second 2)
  const k = Math.min(2.5, Math.max(0.3, (A.last ? now - A.last : 16.7) / 16.7));
  A.last = now;
  if (!A.open || !A.queue.length || !A.renderer) return;
  // (nearest first; sorted again every few frames, or when the walker has moved on)
  if (++A.sorted % 8 === 1) A.queue.sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z));
  let geo = 0, tex = 0, began = 0;
  const t0 = performance.now(), B = A.budget;
  A.texAllow = Math.min(B.tex * 2, A.texAllow + B.tex * k); A.geoAllow = Math.min(B.geo * 2, A.geoAllow + B.geo * k);
  for (const a of A.queue) {
    if (a.cancel?.()) {
      // (no longer wanted, with a picture part of the way up: that picture sent again, whole, when it is next used)
      if (a.upY !== undefined && a.tex?.[0]) { upping.delete(keyOf(a.tex[0])); a.tex[0].needsUpdate = true; a.upY = undefined; }
      a.stage = 9; a.res(); continue;
    }
    if (a.stage === 0) {
      // (a program's making is begun here and goes on in the background, but the beginning is the page's own work -
      // each material's shader written out: no more begun once this frame's time is spent)
      if (began >= Math.max(1, Math.round(B.compiles * k)) || (began > 0 && performance.now() - t0 > B.ms)) continue;
      began++; a.stage = 1;
      Promise.all(a.list.flatMap((o) => [compileView(o), compileShadow(o)])).then(() => { a.stage = 2; }, () => { a.stage = 2; });
      continue;
    }
    if (a.stage === 2) {
      a.tex ??= texturesOf(a.list).filter((t) => !A.sent.has(keyOf(t)));
      while (a.tex.length) {
        const t = a.tex[0];
        // (its file still coming: wait for it, ten seconds at most - by the clock, not by frames: at a few frames a
        // second six hundred frames were minutes)
        if (!pictureReady(t)) { if (now - (a.waitPic ??= now) < 10000) break; a.tex.shift(); continue; }
        if (A.sent.has(keyOf(t))) { a.tex.shift(); continue; }
        if (a.upY === undefined && upping.has(keyOf(t))) break;         // (another's, part of the way up: wait for it)
        if (a.upY === undefined && onCard(t)) { A.sent.add(keyOf(t)); a.tex.shift(); continue; }
        if (A.texAllow <= 0 || (tex > 0 && performance.now() - t0 > B.ms)) break;
        const u0 = performance.now();
        let b = 0, whole = true;
        try {
          if (inStrips(t)) { b = sendStrip(a, t); whole = a.upY === undefined; }
          else { b = pictureBytes(t); A.renderer.initTexture(t); }
        } catch { a.upY = undefined; upping.delete(keyOf(t)); whole = true; /* (drawn as it can be, then) */ }
        const du = performance.now() - u0;
        tex += b; A.texAllow -= b;
        lastPump.texMs += du;
        if (du > 8) lastPump.big += `${t.image?.width}x${t.image?.height} ${t.image?.constructor?.name ?? ''} ${du.toFixed(0)}ms; `;
        if (!whole) continue;              // (its next strip, if this frame has the time and the share for it)
        A.sent.add(keyOf(t)); a.tex.shift();
        lastPump.tex++;
      }
      if (a.tex.length) continue;
      a.stage = 3;
    }
    if (a.stage === 3) {
      if (a.bytes < 0) a.bytes = bytesOf(a.list);
      if (A.geoAllow <= 0 || (geo > 0 && performance.now() - t0 > B.ms * 2)) continue;
      geo += a.bytes; A.geoAllow -= a.bytes;
      show(a, pos, now);
      lastPump.shown++;
      if (a.bytes > 8e6) lastPump.big += `${a.list[0]?.name || a.list[0]?.type} ${(a.bytes / 1e6).toFixed(0)}MB; `;
    }
  }
  if (A.queue.some((a) => a.stage >= 4)) A.queue = A.queue.filter((a) => a.stage < 4);
  lastPump.ms = performance.now() - t0; lastPump.began = began; lastPump.texBytes = tex; lastPump.geo = geo;
}

const batches = new Map();
function show(a, pos, now) {
  a.stage = 4;
  for (const o of a.list) {
    if (a.gate) delete o.userData.gate;
    else if (a.parent && o.parent !== a.parent) a.parent.add(o);
  }
  const rise = typeof a.rise === 'function' ? a.rise() : a.rise;
  if (!rise || A.still) { a.res(); return; }
  // (a piece of a larger thing: later the farther it is from where the thing's first piece rose - a skyline rising
  // in a wave across the city, not all at once)
  if (a.batch) {
    const d = Math.hypot(a.x - pos.x, a.z - pos.z);
    let b = batches.get(a.batch);
    if (!b || now - b.t0 > 8000) batches.set(a.batch, (b = { t0: now, d0: d }));
    a.delay = Math.max(a.delay, Math.min(4, Math.max(0, (d - b.d0) / a.wave - (now - b.t0) / 1000)));
  }
  startRise(a, pos, now);
}

// ---- the rise
const box = new THREE.Box3(), mid = new THREE.Vector3();
const ease = (t) => 1 - Math.pow(1 - t, 3.2);          // (quick out of the ground, slowing into its place)
function startRise(a, pos, now) {
  box.makeEmpty();
  for (const o of a.list) { o.updateMatrixWorld(true); box.expandByObject(o); }
  if (box.isEmpty()) { a.res(); return; }
  const h = Math.max(0.3, box.max.y - box.min.y);
  box.getCenter(mid);
  const far = Math.hypot(mid.x - pos.x, mid.z - pos.z) > A.far;
  const rec = {
    a, t0: now + a.delay * 1000,
    dur: 1000 * (a.dur ?? Math.min(2.6, 0.85 + 0.21 * Math.sqrt(h))),
    depth: a.depth ?? Math.min(h + 0.6, 140), far, base: box.min.y,
    items: a.list.map((o) => ({ o, auto: o.matrixAutoUpdate, y: o.position.y, sy: o.scale.y, m: o.matrixAutoUpdate ? null : o.matrix.clone() })),
  };
  place(rec, 0);
  A.rising.push(rec);
}
// (each of its objects lowered by the same amount - or, far off, drawn up from its foot - in its parent's terms: the
// groups things stand in are at the world's origin)
function place(rec, e) {
  for (const it of rec.items) {
    const o = it.o;
    if (rec.far) {
      const k = Math.max(1e-3, e);
      if (it.auto) { o.scale.y = it.sy * k; o.position.y = rec.base + (it.y - rec.base) * k; }
      else { const E = o.matrix.copy(it.m).elements; E[1] *= k; E[5] *= k; E[9] *= k; E[13] = rec.base + (E[13] - rec.base) * k; o.matrixWorldNeedsUpdate = true; }
    } else {
      const off = -rec.depth * (1 - e);
      if (it.auto) o.position.y = it.y + off;
      else { o.matrix.copy(it.m); o.matrix.elements[13] += off; o.matrixWorldNeedsUpdate = true; }
    }
  }
}
function settle(rec) {
  for (const it of rec.items) {
    if (it.auto) { it.o.position.y = it.y; it.o.scale.y = it.sy; }
    else { it.o.matrix.copy(it.m); it.o.matrixWorldNeedsUpdate = true; }
  }
}
function raise(now) {
  if (!A.rising.length) return;
  let done = false;
  for (const rec of A.rising) {
    // (taken out of the walk while rising - a tile left behind: put back as it was, and done)
    const gone = !rec.items.some((it) => it.o.parent);
    const t = (now - rec.t0) / rec.dur;
    if (gone || t >= 1) { settle(rec); rec.done = true; done = true; rec.a.res(); continue; }
    place(rec, t <= 0 ? 0 : ease(t));
  }
  if (done) A.rising = A.rising.filter((r) => !r.done);
}

/** Everything still rising put in its place at once (a jump in the walk's time: a still, a test). */
export function settleAll() {
  for (const rec of A.rising) { settle(rec); rec.a.res(); }
  A.rising.length = 0;
}
