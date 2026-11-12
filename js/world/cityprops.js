// The cities' yards made gardens, and the furniture of their yards and streets: each yard's gravel, lawn, clipped hedge
// and flower beds (assets/world/cities/<city>-tiles/g_<i>_<j>.glb, dev\world\cityground.py, built in Blender), and its
// fountain, benches, lamps, trees and the iron gate of its passage (between two houses a rail from wall to wall, in a
// garden's wall two piers; each leaf a model of its own, opened as far as the wall beside it allows), with oil lamps
// along the centre's main streets (<city>-props.json, each [x, y, z, yaw(, scale along, scale up | model)]; the models
// assets/world/props/prop-*.glb, Blender). And the streets' pavements (in the same tiles: granite slabs, kerbs and
// posts in the centres, boardwalks beyond, from 1817 on Petersburg's main streets), the shops on their ground floors,
// sentry boxes at the bridges, the yards' firewood, barrels and (in Moscow) wells.
// The furniture is drawn in tiles of TILE m, only those within NEAR m of the camera: tens of thousands of benches and
// lamps, never all at once.
import * as THREE from 'three';
import { gltfLoader } from '../gltf.js';
import { tileStream } from './citytiles.js';
import { DefaultLoadingManager as LM } from 'three';
import { receiveSun } from '../backdrops/sunshadow.js';
import { placeCopies } from '../backdrops/models.js';
import { parallax } from './parallax.js';

const DIR = 'assets/world/cities/', PDIR = 'assets/world/props/';
const TILE = 160, NEAR = 600, TREE_NEAR = 700, FOOT_NEAR = 900, YARD_NEAR = 1400;
const KINDS = { fountain: 'prop-fountain', bench: 'prop-bench', lamp: 'prop-lamp', gate: 'prop-gate', 'gate-top': 'prop-gate-top', 'gate-side': 'prop-gate-side', 'gate-leaf': 'prop-gate-leaf', bollard: 'prop-bollard',
  sentry: 'prop-sentry', firewood: 'prop-firewood', barrel: 'prop-barrel', well: 'prop-well',
  stall: 'prop-stall', 'shop-bakery': 'prop-shop-bakery', 'shop-boots': 'prop-shop-boots', 'shop-grocer': 'prop-shop-grocer',
  // (Moscow's own: the mansions' porticos, one and two storeys, and the plank fences between the houses, grey and green
  // - dev\world\city_kits.py)
  // (the canals' cast iron: a railing bay between two pedestals and a gate of two leaves, stretched to the bay ([4]) -
  // dev\world\canals.py)
  railing: 'prop-railing', 'canal-gate': 'prop-canal-gate',
  'portico-1': 'prop-portico-1', 'portico-2': 'prop-portico-2', 'fence-grey': 'prop-fence-grey', 'fence-green': 'prop-fence-green' };

/** The parts of a model: each mesh's geometry with its node's transform applied, and its material. */
async function partsOf(url, U) {
  const g = await gltfLoader().loadAsync(url);
  g.scene.updateMatrixWorld(true);
  const parts = [];
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
    const mat = o.material;
    mat.side = THREE.FrontSide;
    if (mat.map) mat.map.anisotropy = 4;
    if (mat.metalness > 0.5) { mat.metalness = 0.6; mat.roughness = Math.max(0.45, mat.roughness ?? 0.5); }
    // (TRELLIS.2's models come with a half-gloss everywhere: painted wood, stone and cloth read as plastic; matt them)
    else if (!/glass/i.test(mat.name || '')) { mat.metalness = Math.min(mat.metalness ?? 0, 0.1); mat.roughness = Math.max(0.72, mat.roughness ?? 0.8); }
    if (/glass/i.test(mat.name || '')) { mat.emissive = new THREE.Color(0x3a2a10); }
    receiveSun(mat, U);
    parts.push({ geo, mat });
  });
  return parts;
}

/** The flower beds fade into the lawn under them: each corner of the bed's sheet carries how much bed it is (its vertex
 * colour, cityhouses.py beds()), and a noise in the world's own coordinates makes the border ragged, a metre or two of
 * soil and plants thinning into grass. Blended over the lawn, no depth written. */
function softBed(mat) {
  if (mat.userData.softBed) return;
  mat.userData.softBed = true;
  mat.vertexColors = true; mat.transparent = true; mat.depthWrite = false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBedW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vBedW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBedW;
float bedHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bedNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bedHash(i), bedHash(i + vec2(1, 0)), f.x), mix(bedHash(i + vec2(0, 1)), bedHash(i + vec2(1, 1)), f.x), f.y); }`)
      // (two samplings of the bed's picture, one turned and scaled, mixed by a slow noise: no repeat to be seen)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  { vec4 t1 = texture2D(map, vMapUv); vec4 t2 = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 1.17 + 0.37);
    diffuseColor *= mix(t1, t2, smoothstep(0.3, 0.7, bedNoise(vBedW.xz * 0.21 + 3.7))); }
#endif`)
      .replace('#include <color_fragment>', `{
  float n = bedNoise(vBedW.xz * 0.9) * 0.6 + bedNoise(vBedW.xz * 3.1 + 7.3) * 0.4;
  float a = smoothstep(0.3, 0.7, vColor.r + (n - 0.5) * 0.55);
  diffuseColor.a *= a;
  if (diffuseColor.a < 0.01) discard;
}`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|softBed';
  mat.needsUpdate = true;
}

/** A wall's picture drawn without its repeat showing: two samplings of it, the second larger and shifted, mixed by a
 * slow noise in the world's own coordinates - the garden walls' plaster had one broken patch every 2 m along every wall
 * (10 Nov 2026). */
function detile(mat) {
  if (mat.userData.detile) return;
  mat.userData.detile = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDtW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vDtW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vDtW;
float dtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dtNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dtHash(i), dtHash(i + vec2(1, 0)), f.x), mix(dtHash(i + vec2(0, 1)), dtHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  { vec4 t1 = texture2D(map, vMapUv); vec4 t2 = texture2D(map, vMapUv * 0.71 + vec2(0.37, 0.61));
    diffuseColor *= mix(t1, t2, smoothstep(0.35, 0.65, dtNoise(vec2(vDtW.x + vDtW.z, vDtW.y) * 0.45 + 3.7))); }
#endif`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|detile';
  mat.needsUpdate = true;
}

// How far each kind of furniture is drawn, of the machine's `near` (600 m on a graphics card): a bench, a barrel or a
// stack of firewood is a few pixels at 250 m, and each is thousands of triangles - drawn to 600 m they were most of the
// cities' furniture cost (10 Nov 2026: 19 million triangles a frame, and twice that again in the sun's pictures).
const REACH = { bench: 0.42, barrel: 0.35, firewood: 0.4, bollard: 0.42, well: 0.6, sentry: 0.7, 'window-box': 0.3, gate: 0.8, 'gate-top': 0.6, 'gate-side': 0.5, 'gate-leaf': 0.5, 'canal-gate': 0.8, railing: 0.75, lamp: 0.85,
  'fence-grey': 0.7, 'fence-green': 0.7 };   // (Moscow's yard fences: 130,000 pieces, a thin line at 400 m)

// The models that have a light copy (prop-<name>.lod.glb, dev\world\props\lod_blender.py: a tenth of the triangles,
// no pictures of its own - dressed in the full model's materials by name): drawn in place of the full one in every tile
// whose middle is further than `full` m (hardware.js propsFull).
// (the yard gate's parts have none: a few hundred triangles each)
const LIGHT = ['bench', 'lamp', 'railing', 'barrel', 'firewood', 'well', 'fountain', 'canal-gate', 'stall', 'portico-1', 'portico-2'];

export function buildCityProps(U, models = {}, { base = '', cities = ['spb', 'moscow'], heightAt = null, near = NEAR, footNear = FOOT_NEAR, yardNear = YARD_NEAR, addTrees = null, changed = null, full = 130 } = {}) {
  const group = new THREE.Group(); group.name = 'cityprops';
  const tiles = new Map();               // 'i,j' -> { g: Group, c: [x, z], trees: Group | null }
  const tileOf = (x, z) => {
    const i = Math.floor(x / TILE), j = Math.floor(z / TILE), k = i + ',' + j;
    let t = tiles.get(k);
    // (a tile is in the scene only while near the camera (update, below): out of it, not hidden - the scene's every
    // object is visited each frame for its place, hidden or not, and the cities' 4,700 tiles of furniture cost 30 ms)
    if (!t) { t = { g: new THREE.Group(), c: [(i + 0.5) * TILE, (j + 0.5) * TILE], trees: null, treeItems: [], lists: [], built: false }; t.g.matrixAutoUpdate = false; tiles.set(k, t); }
    return t;
  };
  // (one small copy of every model's every part, never in the scene: what the walk makes the furniture's shaders
  // from before any tile is built - allTiles, below)
  const samples = new THREE.Group(); samples.name = 'cityprops-samples';
  const sampled = new Set();
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const models_ = {};
  const streams = [];                     // the yards' and pavements' tiles, a city each (citytiles.js)
  const light_ = {};
  const ready = Promise.all(Object.entries(KINDS).map(async ([k, f]) => {
    models_[k] = await partsOf(base + PDIR + f + '.glb', U).catch(() => null);
    if (!models_[k] || !LIGHT.includes(k)) return;
    // (the light copy's geometry, in the full model's own materials: by name, or the model's first)
    light_[k] = await gltfLoader().loadAsync(base + PDIR + f + '.lod.glb').then((g) => {
      g.scene.updateMatrixWorld(true); const parts = [];
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const own = models_[k].find((p) => p.mat.name === o.material.name) ?? models_[k][0];
        parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: own.mat }); o.material.dispose?.();
      });
      return parts.length ? parts : null;
    }).catch(() => null);
  }));
  for (const city of cities) {
    // the yards' ground (gravel, lawn, hedges, beds, garden walls) and the pavements (granite slabs and kerbs in the
    // centres, boardwalks beyond), a 400 m tile at a time (citytiles.js: <city>-tiles/g_<i>_<j>.glb), their materials
    // from the city's library (<city>-ground-materials.glb). The two cities have them; the estate and the spa towns
    // only furniture.
    if (city === 'spb' || city === 'moscow') {
      const dress = (m) => {
        if (m.userData.dressed) return;
        m.userData.dressed = true;
        const nm = (m.name || '').toLowerCase();
        m.side = THREE.FrontSide; m.metalness = 0;
        m.roughness = Math.max(/footway|kerb|walk/.test(nm) ? 0.75 : 0.8, m.roughness ?? 0.9);
        if (m.map) m.map.anisotropy = /footway|kerb|walk/.test(nm) ? 8 : 4;
        if (m.map && /hedge/.test(nm)) parallax(m, { depth: 0.012, scale: 1.1 }); else if (m.map && /gravel/.test(nm)) parallax(m, { depth: 0.006, scale: 0.8 }); else if (/^bed/.test(nm)) softBed(m); else m.vertexColors = false;
        if (m.map && /gwall/.test(nm)) detile(m);
        receiveSun(m, U);
      };
      const url = base + DIR + city + '-ground-materials.glb';
      LM.itemStart(url);
      const library = gltfLoader().loadAsync(url).then((g) => {
        const lib = new Map();
        g.scene.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.name && !lib.has(m.name)) { dress(m); lib.set(m.name, m); } });
        g.scene.name = 'library-ground-' + city; g.scene.visible = false; g.scene.traverse((o) => { o.frustumCulled = false; o.userData.noCast = true; });
        group.add(g.scene);
        return lib;
      }).catch(() => new Map()).finally(() => LM.itemEnd(url));
      // (the flat ground - gravel, lawn, beds, pavements - throws no shadow; the hedges and the gardens' walls do)
      streams.push(tileStream({ base, city, kind: 'g', near: yardNear, group, library, changed,
        each: (o) => { if (!/hedge|gwall|coping/.test((o.material.name || '').toLowerCase())) o.userData.noCast = true; } }));
    }
    // (the porticos, from the city's houses (city_blender.py): Moscow's mansions only)
    const porticos = city === 'moscow' ? fetch(base + DIR + city + '-porticos.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : Promise.resolve({});
    Promise.all([fetch(base + DIR + city + '-props.json').then((r) => r.json()), ready, porticos]).then(([J, , P]) => {
      for (const [kind, list] of Object.entries({ ...J, portico: P.portico })) {
        if (kind === 'about' || !Array.isArray(list)) continue;
        // (the trees: drawn with the woods' own, their full copy near, their light copy and their card further off -
        // world/woods.js addTrees; without the woods, as before: in full, tile by tile)
        if (kind === 'tree') {
          if (addTrees) addTrees(list.map((it) => ({ x: it[0], y: it[1] ?? heightAt?.(it[0], it[2]) ?? 0, z: it[2], yaw: it[3], scale: it[4], kind: it[5] })));
          else for (const it of list) tileOf(it[0], it[2]).treeItems.push(it);
          continue;
        }
        // (the shops: one list, each naming its model: bakery, bootmaker, grocer; the porticos theirs, one or two
        // storeys; the fences grey or green, by the stretch they stand in - a whole gap's fence the same)
        const lists = kind === 'shop' ? list.reduce((m, it) => ((m[it[4]] ??= []).push(it), m), {})
          : kind === 'portico' ? list.reduce((m, it) => ((m[it[6]] ??= []).push(it), m), {})
          : kind === 'fence' ? list.reduce((m, it) => ((m[(Math.floor(it[0] / 12) * 7 + Math.floor(it[2] / 12) * 13) % 3 === 0 ? 'fence-green' : 'fence-grey'] ??= []).push(it), m), {})
          : { [kind]: list };
        for (const [k, l2] of Object.entries(lists)) place(k, l2);
      }
      // (a tile's furniture is only listed here; its meshes are made when the walker first comes near it and let go
      // when he has left - build and unbuild, below. Made all at once at the start, both cities' 4,700 tiles were
      // 160,000 instanced meshes that nothing drew: 225 MB of the page's memory (measured 11 Nov 2026), and the
      // longest single step of the load)
      function place(kind, list) {
        const parts = models_[kind];
        if (!parts) return;
        const lite = light_[kind], reach = REACH[kind] ?? 1;
        for (const it of list) {
          const t = tileOf(it[0], it[2]);
          let l = t.lists.find((e) => e.kind === kind && e.city === city);
          if (!l) { t.lists.push((l = { kind, city, items: [] })); if (reach < 1 || lite) t.lesser = true; }
          l.items.push(it);
        }
        if (!sampled.has(kind)) {
          sampled.add(kind);
          for (const part of [...parts, ...(lite ?? [])]) { const m = new THREE.InstancedMesh(part.geo, part.mat, 1); m.frustumCulled = false; m.userData.noCast = true; samples.add(m); }
        }
      }
    }).catch(() => {});
  }
  /** A tile's furniture made: one instanced mesh for each part of each model that stands in it (and of its light copy). */
  function build(t) {
    for (const { kind, city, items } of t.lists) {
      const parts = models_[kind], lite = light_[kind];
      for (const [part, lod] of [...parts.map((p) => [p, lite ? 0 : undefined]), ...(lite ?? []).map((p) => [p, 1])]) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, items.length);
        // (a y of null: on the ground where it stands - the estate's, laid out on its plan without heights)
        // (a fence piece stretched along its length to its stretch, a portico to its bays and storeys: [4] along, [5] up)
        items.forEach((it, n) => { q.setFromAxisAngle(up, it[3] ?? 0); sc.set(typeof it[4] === 'number' ? it[4] : 1, typeof it[5] === 'number' ? it[5] : 1, 1);
          mesh.setMatrixAt(n, mtx.compose(p.set(it[0], it[1] ?? heightAt?.(it[0], it[2]) ?? 0, it[2]), q, sc)); });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.name = city + '.' + kind;
        mesh.matrixAutoUpdate = false;                         // (it stays where it is made)
        mesh.userData.noCastFar = true;                        // (furniture shades the ground by it, in the sun's near picture only)
        mesh.userData.reach = REACH[kind] ?? 1;
        mesh.userData.lod = lod;                               // (0: the full model, 1: its light copy; undefined: the one there is)
        mesh.userData.prop = true;
        t.g.add(mesh);
      }
    }
    t.built = true;
  }
  function unbuild(t) {
    for (const m of [...t.g.children]) if (m.userData.prop) { t.g.remove(m); m.dispose(); }
    t.built = false;
  }
  // (the furniture's shaders are made from the samples before any tile is built - walk.js later)
  group.userData.allTiles = () => [samples];
  // (only the tiles near the camera are drawn; at most BUILD of them made in a frame, the nearest first, so coming into
  // a city is spread over a few frames)
  const BUILD = 6, todo = [];
  group.userData.update = (pos) => {
    for (const st of streams) st.update(pos);
    todo.length = 0;
    for (const t of tiles.values()) {
      const d = Math.hypot(t.c[0] - pos.x, t.c[1] - pos.z);
      const want = d < near;
      if (want && !t.built) { todo.push([d, t]); continue; }
      if (!want && t.built && d > near + TILE) unbuild(t);
      if (want && !t.g.parent) group.add(t.g);
      else if (!want && t.g.parent) group.remove(t.g);
      // (the small things of a tile in view, each to its own reach: REACH)
      // (and of a model with a light copy, the full one in the tiles close by, the light one beyond)
      if (want && t.lesser) for (const m of t.g.children) {
        const r = m.userData.reach, l = m.userData.lod;
        if (r === undefined) continue;
        m.visible = (r >= 1 || d < near * r + TILE * 0.5) && (l === undefined || (l === 0) === (d < full));
      }
      if (d < Math.max(near, TREE_NEAR * near / NEAR) && !t.trees && t.treeItems.length) {
        t.trees = new THREE.Group();
        const byKind = {};
        for (const it of t.treeItems) (byKind[it[5]] ??= []).push({ x: it[0], y: it[1] ?? heightAt?.(it[0], it[2]) ?? 0, z: it[2], yaw: it[3], scale: it[4] });
        for (const [k, items] of Object.entries(byKind)) {
          const m = models[k];
          if (m) t.trees.add(placeCopies(m, m.near ? 'near' : 'far', items, U, { shadow: true }));
        }
        t.g.add(t.trees);
      }
    }
    if (todo.length) {
      todo.sort((a, b) => a[0] - b[0]);
      for (const [d, t] of todo.slice(0, BUILD)) {
        build(t);
        if (t.lesser) for (const m of t.g.children) {
          const r = m.userData.reach, l = m.userData.lod;
          if (r !== undefined) m.visible = (r >= 1 || d < near * r + TILE * 0.5) && (l === undefined || (l === 0) === (d < full));
        }
        if (!t.g.parent) group.add(t.g);
      }
    }
  };
  return group;
}
