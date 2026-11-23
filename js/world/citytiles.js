// The cities read a tile at a time. Both cities had come as a dozen files of 40-70 MB, all read when the walk began:
// 600 MB to fetch and 2 GB of the page's memory, whatever part of them the walker ever saw. Now each 400 m tile is its
// own small file (dev\world\tile_export.py: the houses h_<i>_<j>.glb, the yards and pavements g_<i>_<j>.glb, in
// assets/world/cities/<city>-tiles), without pictures - its materials by name, the pictures once in a small library
// file - and only the tiles within reach of the walker were in memory, read as he came near and let go behind him,
// plain coloured boxes beyond (<city>-tiles/far.glb). Since v0.0.92 every tile is read under the loading picture,
// nearest first, several at a time, shown through the gate (reveal.js), and kept: nothing comes in once the walk is
// shown. A tile is drawn within `show` m (the machine's setting; everywhere on the full tiers).
import { gltfLoader } from '../gltf.js';
import { gate, allowed } from './reveal.js';
import { arrivalsReach } from './arrive.js';
import { SPAN, superTile, superKeep, superBuild } from './supertiles.js';

const DIR = 'assets/world/cities/';
const MAX = 16;                           // (files being read at once, all cities and kinds together)
const wanted = new Set();                 // tiles asked for, not yet being read
let running = 0, eye = { x: 0, z: 0 };
// (read, and not yet on the card: each tile's triangles are held in the page until the card has them - decoded, a
// city's tiles are some gigabytes - so no more are read while AHEAD of them wait to go up)
const AHEAD = 48, up = new Set();

// (a tile is read once the walker is within the arrivals' reach of it - nearer, it can come in; farther, it waits there,
// arrive.js - and only the tiles read within that reach count against AHEAD. Since v0.0.142 capped the reach at 3 km,
// the first 48 tiles read from where the walk began had waited beyond it for good, ahead of every other, and no tile was
// read again wherever the walker went: after the book's travel the Kremlin's and Petersburg's houses never came, their
// fronts' mouldings built and kept waiting for them, 22 Nov 2026)
function next() {
  for (const t of up) if (!t.scene || t.scene.userData.risen) up.delete(t);
  const reach = arrivalsReach(), within = (t) => Math.hypot(t.x - eye.x, t.z - eye.z) <= reach;
  let ahead = 0;
  for (const t of up) if (within(t)) ahead++;
  while (running < MAX && wanted.size && ahead + running < AHEAD) {
    let best = null, bd = Infinity;
    for (const t of wanted) { const d = Math.hypot(t.x - eye.x, t.z - eye.z); if (d < bd) { bd = d; best = t; } }
    if (bd > reach) break;                // (the nearest still wanted lies beyond the reach: none is read yet)
    wanted.delete(best);
    if (best.state !== 1) continue;       // (no longer wanted: the walker went another way)
    running++;
    best.read().finally(() => { running--; next(); });
  }
}

/** The pictures' library of a set of tiles: { name: material }, each material dressed once by `dress(material)`. */
export function materialLibrary(url, dress) {
  return gltfLoader().loadAsync(url).then((g) => {
    const lib = new Map();
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.name && !lib.has(m.name)) { dress?.(m); lib.set(m.name, m); }
    });
    return lib;
  }).catch(() => new Map());
}

/**
 * One city's tiles of one kind ('h' houses, 'g' ground), all read at once and kept in `group`.
 * show: drawn within this of the camera (to the tile's edge).
 * library: a promise of { name: material }; each(mesh): the caller's own flags for a mesh as it comes in;
 * changed(): called when tiles came or went (the sun's pictures gather their casters again);
 * merge: a camera farther than this (m) from a super-tile draws it whole, its tiles joined material by material
 * (supertiles.js), in place of its tiles; 0: never.
 */
export function tileStream({ base = '', city, kind, show = Infinity, group, library = null, each = null, changed = null, standIn = null, merge = 0 }) {
  const tiles = new Map(), supers = new Map();
  let T = 400;
  const st = { ready: false, tiles, supers, loaded: 0, bytes: 0 };
  fetch(base + DIR + city + '-tiles/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((J) => {
    if (!J) { st.ready = true; return; }
    T = J.tile || 400;
    for (const [k, v] of Object.entries(J.tiles)) {
      if (!(kind in v)) continue;
      const [i, j] = k.split('_').map(Number);
      const t = { key: k, x: (i + 0.5) * T, z: (j + 0.5) * T, state: 0, scene: null, meshes: null, bytes: v[kind], shown: false };
      t.read = () => read(t);
      tiles.set(k, t);
      if (merge > 0) {
        const si = Math.floor(i / SPAN), sj = Math.floor(j / SPAN), sk = si + '_' + sj;
        let S = supers.get(sk);
        if (!S) supers.set(sk, (S = superTile(sk, si * SPAN * T, sj * SPAN * T, (si + 1) * SPAN * T, (sj + 1) * SPAN * T)));
        S.members.push(t); t.sup = S;
      }
    }
    st.ready = true;
  });
  async function read(t) {
    try {
      const [g, lib] = await Promise.all([gltfLoader().loadAsync(`${base}${DIR}${city}-tiles/${kind}_${t.key}.glb`), library]);
      if (t.state !== 1) { g.scene.traverse((o) => o.geometry?.dispose()); if (t.sup) t.sup.dropped = true; return; }
      g.scene.updateMatrixWorld(true);
      const meshes = [];
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const own = lib?.get(o.material?.name);
        if (own) { o.material.dispose?.(); o.material = own; }
        o.matrixAutoUpdate = false;
        each?.(o);
        // (its bounds as the file gives them: the model loader takes them from the file's own extents, never from
        // the triangles - a sum over every vertex of every mesh, the longest part of a tile's coming in)
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        // (its triangles copied for its super-tile while the page still has them: supertiles.js)
        if (t.sup) superKeep(t.sup, o);
        letGo(o.geometry);
        meshes.push(o);
      });
      g.scene.name = `${city}-${kind}-${t.key}`;
      g.scene.matrixAutoUpdate = false;
      // (the tile comes in whole, through the gate (reveal.js, arrive.js): its programs made in the background, its
      // pictures and triangles sent up within a frame's budget; and it rises out of the ground - unless its plain boxes
      // stood there already (standIn), when it takes their place where it stands)
      const scene = g.scene;
      scene.visible = false;
      gate(scene, t.x, t.z, { rise: () => !standIn?.(t.key), cancel: () => !scene.parent, batch: city + '-' + kind, wave: 1800 });
      t.scene = scene; t.meshes = meshes; t.state = 2; t.shown = false; up.add(t);
      group.add(scene);
      st.loaded++; st.bytes += t.bytes;
      changed?.();
    } catch { t.state = 3; }              // (not there: not asked for again)
  }
  // A super-tile joined once every one of its tiles is read (one a frame), and put in through the gate - nothing to
  // rise: it takes the place of tiles that stand there already.
  function join(S) {
    const scene = S.dropped ? null : superBuild(S, `${city}-${kind}-S${S.key}`);
    S.scene = scene ?? false;
    if (!scene) return;
    // (its joined arrays let go once the card has them, as the tiles' own: both cities' houses held twice in the
    // page's memory, 1.1 GB, otherwise)
    scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry) letGo(o.geometry); });
    scene.visible = false;
    gate(scene, S.cx, S.cz, { rise: () => false, cancel: () => !scene.parent, batch: city + '-' + kind + '-far', wave: 1800 });
    group.add(scene);
    changed?.();
  }
  /** Once a frame: every tile asked for (once), and each read in shown within `show` as the gate allows. */
  st.update = (pos) => {
    if (!st.ready) return;
    eye = pos;
    const half = T * 0.71;
    for (const t of tiles.values()) {
      if (t.state === 0) { t.state = 1; wanted.add(t); }
      else if (t.state === 2) {
        const want = show === Infinity || Math.hypot(t.x - pos.x, t.z - pos.z) - half < show;
        if (t.scene.userData.gate) t.scene.visible = allowed(t.scene, true) && want;   // (asked for wherever it stands)
        else t.scene.visible = want;
        t.shown = t.scene.visible;
      }
    }
    // (each super-tile drawn whole in its tiles' place while the camera is farther than `merge` from it and every tile
    // of it is shown and stands in its place - the very tiles, drawn together; else its tiles as they are)
    if (merge > 0) {
      let joined = false;
      for (const S of supers.values()) {
        if (S.scene === null) { if (!joined && S.members.every((t) => t.state >= 2)) { join(S); joined = true; } continue; }
        if (S.scene === false) continue;
        const dx = Math.max(0, S.x0 - pos.x, pos.x - S.x1), dz = Math.max(0, S.z0 - pos.z, pos.z - S.z1);
        const dy = pos.y === undefined ? 0 : Math.max(0, S.y0 - pos.y, pos.y - S.y1);
        let want = Math.hypot(dx, dy, dz) > merge;
        if (want) for (const t of S.members) if (t.state === 2 && !(t.shown && t.scene.userData.risen)) { want = false; break; }
        const on = want && allowed(S.scene, true);
        S.scene.visible = on;
        if (on) for (const t of S.members) if (t.state === 2) t.scene.visible = false;     // (t.shown stays: what stands on a tile waits for it)
      }
    }
    next();
  };
  /** How many of the tiles are not yet in and come in (the loading picture waits for none: walk.js). */
  st.pending = () => { if (!st.ready) return 1; let n = 0; for (const t of tiles.values()) if (t.state < 2 || (t.state === 2 && !t.scene.userData.risen)) n++; return n; };
  /** How many of the tiles within `r` m of (x, z) - and within `show`, where they are drawn - are not yet in and stood in
   *  their places: what a place travelled to waits for (walk.js). Those farther off come in after its picture has
   *  lifted (22 Nov 2026: the picture had waited for every tile being read, 3 km round). */
  st.pendingNear = (x, z, r) => {
    if (!st.ready) return 1;
    const half = T * 0.71, lim = Math.min(r, show);
    let n = 0;
    for (const t of tiles.values()) {
      if (t.state === 3 || Math.hypot(t.x - x, t.z - z) - half >= lim) continue;
      if (t.state < 2 || !t.scene.userData.risen) n++;
    }
    return n;
  };
  /** Whether the tile 'i_j' is in and all of it shown. */
  st.shown = (key) => tiles.get(key)?.shown === true;
  /** Whether the tile 'i_j' is shown and stands in its place: risen out of the ground, or shown where it stood (reveal.js). */
  st.risen = (key) => { const t = tiles.get(key); return t?.shown === true && t.scene?.userData.risen === true; };
  return st;
}

// A tile's triangles are held twice once they are drawn: on the graphics card, and in the page's own memory as they were
// read. Nothing reads them again (the walker is kept out of the houses by the built map, not by their triangles; a
// tile left behind is freed and read from its file when wanted again), so the page's copy is let go as soon as the
// card has its own: with thirty tiles in, 160 MB of the page's memory (11 Nov 2026) - on a laptop the same memory the
// card's copy is in.
const FREE = function () { this.array = null; };
export function letGo(geo) {
  for (const a of Object.values(geo.attributes)) (a.isInterleavedBufferAttribute ? a.data : a).onUploadCallback = FREE;
  if (geo.index) geo.index.onUploadCallback = FREE;
}
