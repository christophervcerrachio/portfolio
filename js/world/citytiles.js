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

const DIR = 'assets/world/cities/';
const MAX = 6;                            // (files being read at once, all cities and kinds together)
const wanted = new Set();                 // tiles asked for, not yet being read
let running = 0, eye = { x: 0, z: 0 };
// (read, and not yet on the card: each tile's triangles are held in the page until the card has them - decoded, a
// city's tiles are some gigabytes - so no more are read while AHEAD of them wait to go up)
const AHEAD = 24, up = new Set();

function next() {
  for (const t of up) if (!t.scene || t.scene.userData.risen) up.delete(t);
  while (running < MAX && wanted.size && up.size + running < AHEAD) {
    let best = null, bd = Infinity;
    for (const t of wanted) { const d = Math.hypot(t.x - eye.x, t.z - eye.z); if (d < bd) { bd = d; best = t; } }
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
 * changed(): called when tiles came or went (the sun's pictures gather their casters again).
 */
export function tileStream({ base = '', city, kind, show = Infinity, group, library = null, each = null, changed = null, standIn = null }) {
  const tiles = new Map();
  let T = 400;
  const st = { ready: false, tiles, loaded: 0, bytes: 0 };
  fetch(base + DIR + city + '-tiles/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((J) => {
    if (!J) { st.ready = true; return; }
    T = J.tile || 400;
    for (const [k, v] of Object.entries(J.tiles)) {
      if (!(kind in v)) continue;
      const [i, j] = k.split('_').map(Number);
      const t = { key: k, x: (i + 0.5) * T, z: (j + 0.5) * T, state: 0, scene: null, meshes: null, bytes: v[kind], shown: false };
      t.read = () => read(t);
      tiles.set(k, t);
    }
    st.ready = true;
  });
  async function read(t) {
    try {
      const [g, lib] = await Promise.all([gltfLoader().loadAsync(`${base}${DIR}${city}-tiles/${kind}_${t.key}.glb`), library]);
      if (t.state !== 1) { g.scene.traverse((o) => o.geometry?.dispose()); return; }
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
    next();
  };
  /** How many of the tiles are not yet in and come in (the loading picture waits for none: walk.js). */
  st.pending = () => { if (!st.ready) return 1; let n = 0; for (const t of tiles.values()) if (t.state < 2 || (t.state === 2 && !t.scene.userData.risen)) n++; return n; };
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
