// A city's landmarks, each built to its measurements (landmark-models, in Blender) and placed where it stands: the
// file lists { name, glb, x, z, yaw, and maybe y, s } (dev\world\spb\landmarks.py writes Petersburg's; y: built at its
// height, as the fortress's walls and what stands on them; s: its size against the model's - Petersburg is laid from a
// plate drawn at 0.81 of true size, and the Winter Palace and the Admiralty stand on their drawings at the plate's
// scale, dev\world\spb\spb_fit.py: at their own they reached into the houses round them and into the Neva). The same treatment as the Kremlin's buildings (kremlin.js):
// white stone and brick in relief, gilt and glass that catch the sky, the sun's shadows.
// Each stands by its own outline (world/plans.js, plans.json): its floor on the highest ground along its outline when
// it has a plinth to run into the ground, on the lowest when it has none, so none hangs in the air and no door is under
// the ground; and the walker is kept out of the outline itself, not out of circles along its box.
import * as THREE from 'three';
import { firstSight } from './firstsight.js';
import { arrive } from './arrive.js';
import { gltfLoader } from '../gltf.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';
import { placeRing } from './plans.js';

const DIR = 'assets/world/landmarks/';
// (a small model placed many times over is drawn as copies of one, the copies of each quarter of QUARTER m together;
// a large one - a church of 57,000 triangles - stays its own piece, shown and hidden by itself)
const MANY = 6, SMALL = 6000, QUARTER = 900;
// The light copies (dev\world\landmarks_lod.py: <model>.lod.glb, listed in light.json - a twentieth of the triangles
// and small pictures): a machine that draws the walk as an older console did reads these and never the full models
// (hardware.js marks: 'light'). One list for every landmark file, asked for once.
let lightList = null;
export const lightCopies = (base = '') => (lightList ??= fetch(base + DIR + 'light.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

const stem = (glb) => glb.replace(/\.glb$/, '');
/** Where a landmark's floor line stands. On the highest ground along its outline, a step of its plinth showing, when
 *  its list says so ("ground": "max"); when its list says nothing and the model reaches a metre or more under its floor
 *  line all round (plans.json's foot), there too, but never higher than that footing reaches down to the lowest
 *  ground, so nothing of it hangs in the air; else on the lowest, sunk a little (a model made from a picture is not cut clean at
 *  its foot); or at the height its list gives it. The ground under it: the land, or the water's face where it stands
 *  over water (an exchange on its embankment, a bathing house on its pond). */
export function standAt(world, shape, b) {
  if (b.y !== undefined) return b.y;
  if (!shape) return world.heightAt(b.x, b.z) - 0.4;
  let lo = 1e9, hi = -1e9;
  const s = b.s ?? 1;
  for (const r of shape.rings) {
    const ring = placeRing(r, b.x, b.z, b.yaw ?? 0, s);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
      for (let k = 0; k < n; k++) {
        const x = p[0] + (q[0] - p[0]) * k / n, z = p[1] + (q[1] - p[1]) * k / n, w = world.waterAt ? world.waterAt(x, z) : null;
        let g = world.heightAt(x, z); if (w !== null && w > g) g = w;
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
    }
  }
  // (foot: plans.json's - how far the model reaches under its floor line all round its outline, not its lowest point:
  // a cathedral whose crypt stair goes ten metres down has no footing under its walls)
  const foot = Math.max(0, shape.foot ?? 0) * s;
  if (b.ground === 'max') return hi + 0.2;                                  // (its list's own wish, as it has stood)
  if (b.ground === undefined && foot >= 1.0) return Math.min(hi + 0.2, lo + foot - 0.1);
  return lo - 0.4;
}
/** A list's landmarks into the world's outlines (plans.js): done as the walk loads, before anything is set down
 *  beside them and before the woods plant a tree. */
export function planMarks(plans, shapes, group, list) {
  for (const b of list ?? []) plans.addShape(group + ':' + (b.name ?? stem(b.glb)), shapes[stem(b.glb)], b.x, b.z, b.yaw ?? 0, b.s ?? 1, { group });
}

// From afar a large model placed many times over is drawn as copies of one: each of its materials one draw for all its
// copies FAR m and more from the walker, where it had been one for each copy - Moscow's forty churches had been 290 of
// the 1,040 draws of the view the walk opens on, 7 km off (19 Nov 2026), 13 to 16 for each church. Nearer than FAR a
// copy is its own piece, shown and hidden by itself, as before. The same model, materials and places: the picture is
// the same. They throw no shadow from there: the sun's pictures reach a few hundred metres. Of the copies far off, only
// those inside the view are drawn, as each was by itself: the copies together stand over a whole city, which the view
// all but always meets, and drawn whole they had added 2.4 million triangles to a view of Petersburg 15 km off.
const FAR = 1500;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
function batchFar(group, glb, copies) {
  const batch = new THREE.Group(); batch.name = 'citymark-' + stem(glb) + '-far'; batch.visible = false; batch.matrixAutoUpdate = false;
  const ims = copies.meshes.map((o) => {
    const im = new THREE.InstancedMesh(o.geo, o.mat, copies.length);
    im.count = 0; im.matrixAutoUpdate = false; im.userData.noCast = true; im.userData.node = o.node;
    // (the copies drawn are those in the view already: three's own test of the whole is left out)
    im.frustumCulled = false;
    im.name = batch.name; im.renderOrder = o.order; batch.add(im);
    return im;
  });
  const fr = new THREE.Frustum(), vp = new THREE.Matrix4(), sph = new THREE.Sphere();
  group.add(batch);
  let key = '';
  const batches = (group.userData.farBatches ??= []);
  batches.push((pos, reach, cam) => {
    // (each copy in by now: near, its own piece within reach; far, in the batch within reach - and in the view)
    if (cam) fr.setFromProjectionMatrix(vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let k = '';
    for (const it of copies) {
      if (!it.ready) continue;
      const d = Math.hypot(it.b.x - pos.x, it.b.z - pos.z) - it.r;
      it.far = d >= FAR && d < reach && (!cam || fr.intersectsSphere(sph.set(sph.center.set(it.b.x, it.y + it.cy, it.b.z), it.r)));
      it.m.visible = firstSight(it.m, d < FAR && d < reach);   // (firstSight: spread the first draws - firstsight.js)
      if (it.far) k += it.b.name + ',';
    }
    batch.visible = k !== '';                     // (every frame: a machine's reach for landmarks hides it otherwise - farcull.js)
    if (k === key) return;
    key = k;
    const far = copies.filter((it) => it.far);
    for (const im of ims) {
      far.forEach((it, i) => {
        _m.compose(_p.set(it.b.x, it.y, it.b.z), _q.setFromAxisAngle(_up, it.b.yaw), _s.setScalar(it.b.s ?? 1)).multiply(im.userData.node);
        im.setMatrixAt(i, _m);
      });
      im.count = far.length; im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); im.computeBoundingBox?.();
    }
    batch.matrixWorldNeedsUpdate = true;          // (its part measured again: landparts.js)
  });
  group.userData.farBatch = (pos, reach, cam) => { for (const f of batches) f(pos, reach, cam); };
}

/** list: the file's buildings, already read (the walk reads every list as it loads); shapes: plans.json. */
export function buildCityMarks(world, U, { base = '', file, light = false, list = null, shapes = {} } = {}) {
  const group = new THREE.Group(); group.name = 'citymarks-' + file;
  const solid = []; group.userData.solid = solid;
  // (the models asked for once the walk is shown - group.userData.load, countryside.js loadRest: the first view's
  // files have the line to themselves)
  // (a promise: every model of the list read and handed to its arrival - countryside.js restNear waits for the estate's)
  let asked = null;
  group.userData.load = () => (asked ??= read());
  const read = () => Promise.all([list ? { buildings: list } : fetch(base + DIR + file).then((r) => r.json()), light ? lightCopies(base) : {}]).then(([K, LIGHT]) => {
    // (a model many buildings share - Moscow's forty churches in two designs, the spa towns' 239 houses in five - is
    // loaded once and its materials made ready once)
    const byGlb = new Map(), all = [];
    for (const b of K.buildings ?? []) { let l = byGlb.get(b.glb); if (!l) byGlb.set(b.glb, (l = [])); l.push(b); }
    for (const [glb, list] of byGlb) {
      const lite = LIGHT[glb.replace(/\.glb$/, '')] !== undefined;
      all.push(gltfLoader().loadAsync(base + DIR + (lite ? glb.replace(/\.glb$/, '.lod.glb') : glb)).then((g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh || o.material.userData.citymark) return;
          o.material.userData.citymark = true;
          o.material.side = THREE.FrontSide;
          const nm = (o.material.name || '').toLowerCase();
          // (the stone and brick in relief - not on a machine that draws light copies: its picture is 480 lines at most)
          if (light) { /* plain */ }
          else if (o.material.map && /brick/.test(nm)) parallax(o.material, { depth: 0.018, invert: true, scale: 2 });
          else if (o.material.map && /white|granite/.test(nm)) parallax(o.material, { depth: 0.01, scale: 2 });
          if (o.material.metalness > 0.5) { o.material.metalness = 0.72; o.material.envMapIntensity = 2.4; }
          else if (o.material.roughness < 0.2) o.material.envMapIntensity = 1.6;
          receiveSun(o.material, U);
        });
        g.scene.rotation.set(0, 0, 0); g.scene.position.set(0, 0, 0); g.scene.updateMatrixWorld(true);
        // (each on its own outline: plans.json's, of the model's own triangles)
        const shape = shapes[stem(glb)];
        const placed = list.map((b) => ({ b, y: standAt(world, shape, b) }));
        // (a house that stands many times over is drawn as copies of one: the spa towns' five houses had been 239
        // models of five or six meshes each, 950 draw calls from the wood east of Pyatigorsk for a fifth of a million
        // triangles - measured 11 Nov 2026. The copies of each quarter of 900 m together, so a town out of reach or
        // out of the view is not drawn: farcull.js)
        let tris = 0;
        g.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
        if (list.length >= MANY && tris <= SMALL) {
          const cells = new Map();
          for (const pl of placed) { const k = Math.floor(pl.b.x / QUARTER) + ',' + Math.floor(pl.b.z / QUARTER); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(pl); }
          const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
          // (each quarter's copies come in together - every part of the model at once - and rise: arrive.js)
          const byCell = new Map();
          g.scene.traverse((o) => {
            if (!o.isMesh) return;
            const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
            for (const [k, l] of cells) {
              const im = new THREE.InstancedMesh(geo, o.material, l.length);
              l.forEach((pl, i) => im.setMatrixAt(i, M.compose(P.set(pl.b.x, pl.y, pl.b.z), Q.setFromAxisAngle(UP, pl.b.yaw), S.setScalar(pl.b.s ?? 1))));
              im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
              im.matrixAutoUpdate = false;
              im.name = 'citymark-' + glb.replace(/\.glb$/, '') + '@' + k;
              (byCell.get(k) ?? byCell.set(k, []).get(k)).push(im);
            }
          });
          for (const list of byCell.values()) arrive(list, { parent: group });
          return;
        }
        // (a large model placed many times over - Moscow's forty parish churches, two designs of twenty - each copy its
        // own piece near the walker, and from afar every copy of it drawn together: farBatch)
        const copies = list.length >= MANY ? [] : null;
        if (copies) {
          // (its parts where they stand in the model, taken now, while it stands at the origin)
          const meshes = []; g.scene.traverse((o) => { if (o.isMesh) meshes.push({ geo: o.geometry, mat: o.material, node: o.matrixWorld.clone(), order: o.renderOrder }); });
          const bs = new THREE.Box3().setFromObject(g.scene).getBoundingSphere(new THREE.Sphere());
          // (its reach about a point over its base, however it is turned)
          copies.meshes = meshes; copies.r = bs.radius + Math.hypot(bs.center.x, bs.center.z); copies.cy = bs.center.y;
        }
        placed.forEach(({ b, y }, i) => {
          const m = i ? g.scene.clone(true) : g.scene;
          m.rotation.y = b.yaw;
          m.position.set(b.x, y, b.z);
          if (b.s !== undefined) m.scale.setScalar(b.s);
          m.name = 'citymark-' + b.name;
          const item = copies ? { b, y, m, r: copies.r * (b.s ?? 1), cy: copies.cy * (b.s ?? 1), ready: false, far: false } : null;
          if (item) copies.push(item);
          arrive(m, { parent: group }).then(() => { if (item) item.ready = true; });
        });
        if (copies) batchFar(group, glb, copies);
      }).catch(() => {}));
    }
    return Promise.all(all);
  }).catch(() => {});
  return group;
}
