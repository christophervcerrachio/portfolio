// The cities read a tile at a time. Both cities had come as a dozen files of 40-70 MB, all read when the walk began:
// 600 MB to fetch and 2 GB of the page's memory, whatever part of them the walker ever saw. Now each 400 m tile is its
// own small file (dev\world\tile_export.py: the houses h_<i>_<j>.glb, the yards and pavements g_<i>_<j>.glb, in
// assets/world/cities/<city>-tiles), without pictures - its materials by name, the pictures once in a small library
// file - and only the tiles within reach of the walker are in memory: read nearest first, two at a time, shown through
// the gate (reveal.js), and let go again (their geometry freed) once he is `keep` m past their reach. Beyond the tiles
// read in, the houses show as plain coloured boxes (<city>-tiles/far.glb: one object a tile), each hidden while its own
// tile is in.
import * as THREE from 'three';
import { gltfLoader } from '../gltf.js';
import { gate, allowed, breathe } from './reveal.js';

const DIR = 'assets/world/cities/';
const MAX = 2;                            // (files being read at once, all cities and kinds together)
const wanted = new Set();                 // tiles asked for, not yet being read
let running = 0, eye = { x: 0, z: 0 };

function next() {
  while (running < MAX && wanted.size) {
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
 * One city's tiles of one kind ('h' houses, 'g' ground), kept in `group` while near.
 * near: read within this of the walker (to the tile's edge); keep: let go this much further out.
 * library: a promise of { name: material }; each(mesh): the caller's own flags for a mesh as it comes in;
 * changed(): called when tiles came or went (the sun's pictures gather their casters again).
 */
export function tileStream({ base = '', city, kind, near = 1200, keep = 300, group, library = null, each = null, changed = null, standIn = null }) {
  const tiles = new Map();
  let T = 400;
  const st = { ready: false, tiles, loaded: 0, bytes: 0 };
  fetch(base + DIR + city + '-tiles/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((J) => {
    if (!J) return;
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
      t.scene = scene; t.meshes = meshes; t.state = 2; t.shown = false;
      group.add(scene);
      st.loaded++; st.bytes += t.bytes;
      changed?.();
    } catch { t.state = 3; }              // (not there: not asked for again)
  }
  function drop(t) {
    for (const o of t.meshes) o.geometry.dispose();
    group.remove(t.scene);
    t.scene = null; t.meshes = null; t.state = 0; t.shown = false;
    st.loaded--; st.bytes -= t.bytes;
    changed?.();
  }
  /** Once a frame: ask for the tiles that have come within reach, let go those left behind, show what the gate allows. */
  st.update = (pos) => {
    if (!st.ready) return;
    eye = pos;
    const half = T * 0.71;
    for (const t of tiles.values()) {
      const d = Math.hypot(t.x - pos.x, t.z - pos.z) - half;
      if (t.state === 0 && d < near) { t.state = 1; wanted.add(t); }
      else if (t.state === 1 && d > near + keep) { t.state = 0; wanted.delete(t); }
      else if (t.state === 2) {
        if (d > near + keep) { drop(t); continue; }
        if (t.scene.userData.gate) t.scene.visible = allowed(t.scene, true);
        else t.scene.visible = true;
        t.shown = t.scene.visible;
      }
    }
    next();
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
function letGo(geo) {
  for (const a of Object.values(geo.attributes)) (a.isInterleavedBufferAttribute ? a.data : a).onUploadCallback = FREE;
  if (geo.index) geo.index.onUploadCallback = FREE;
}

// A city's far boxes are three quarters of a million triangles that stay in memory for the whole walk: kept small.
// No texture coordinates (the boxes have no picture), their colours as bytes, and each array let go once the card has
// it (the boxes are never read again: their bounds are taken first).
function slim(geo) {
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const col = geo.getAttribute('color');
  if (col && !(col.array instanceof Uint8Array)) {
    const n = col.count, a = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = Math.round(Math.min(1, Math.max(0, col.getX(i))) * 255);
      a[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, col.getY(i))) * 255);
      a[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, col.getZ(i))) * 255);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3, true));
  }
  letGo(geo);
}

/** The far view of a city's houses: one object a tile ('far_<i>_<j>'), drawn within `far` m, hidden while `inTile(key)`. */
export function farBoxes({ base = '', city, group, far = Infinity, inTile, dress = null }) {
  const boxes = [];
  const st = { boxes, update: () => {} };
  gltfLoader().loadAsync(`${base}${DIR}${city}-tiles/far.glb`).then((g) => {
    g.scene.updateMatrixWorld(true);
    let mat = null;
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!mat) { mat = o.material; mat.vertexColors = true; mat.side = THREE.FrontSide; mat.metalness = 0; mat.roughness = 0.9; dress?.(mat); }
      else if (o.material !== mat) { o.material.dispose?.(); o.material = mat; }
      o.matrixAutoUpdate = false;
      o.userData.noCast = true;           // (a far box throws no shadow: the sun's pictures reach a few hundred metres)
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
      boxes.push({ o, key: o.name.replace(/^far[._]/, ''), x: c.x, z: c.z, r: o.geometry.boundingSphere.radius });
      o.visible = false;
      o.userData.slimmed = false;
    });
    g.scene.name = 'far-' + city;
    group.add(g.scene);
    // (the boxes' colours made small and their copies in the page let go, a few at a time between frames; each then
    // comes in through the gate - the city's skyline rising out of the ground in a wave from its nearest edge:
    // arrive.js)
    (async () => {
      for (const b of boxes) { slim(b.o.geometry); gate(b.o, b.x, b.z, { batch: 'far-' + city, wave: 2200 }); b.o.userData.slimmed = true; await breathe(); }
    })();
  }).catch(() => {});
  st.update = (pos) => {
    for (const b of boxes) {
      if (!b.o.userData.slimmed) { b.o.visible = false; continue; }
      const want = !inTile(b.key) && (far === Infinity || Math.hypot(b.x - pos.x, b.z - pos.z) - b.r < far);
      b.o.visible = b.o.userData.gate ? allowed(b.o, want) : want;
    }
  };
  /** Whether the tile 'i_j''s box stands in the view now (a tile of houses coming in takes its place where it stands). */
  const byKey = new Map();
  st.visible = (key) => {
    if (!byKey.size) for (const b of boxes) byKey.set(b.key, b);
    const b = byKey.get(key);
    return !!b && b.o.visible;
  };
  return st;
}
