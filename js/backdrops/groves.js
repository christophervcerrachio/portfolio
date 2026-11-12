// The birches on the hill: the two groves that frame the countryside, left and right, as the painting has them (set
// where the painter saw them); past the painting's edges the groves go on, a little thinner; and on round the hill a
// birch wood to either side, each with an opening in its middle where a path leads out (left, toward the Caucasus;
// right, toward the estate), and behind, a few trees either side of the way down to Petersburg. Every birch is a model
// made by my scene workflow (models.js: each grown from Klein's drawing, every limb a tube and every leaf its own),
// drawn in full near the camera and as its lighter copy further off: the visitor walks the hilltop now, so which copy
// follows the camera (and, zoomed in, the full copies reach as much further out). Only the birches the view can see are
// drawn; the sun's picture of them (sunshadow.js) has copies of its own, of those it takes in, so a birch out of view
// still throws its shade into it. Each trunk is solid: the walker goes round it (userData.solid).
import * as THREE from 'three';
import { placeCopies } from './models.js';
import { LANDMARKS } from './landmarks.js';
import { pathAt } from './paths.js';
import { FEATURES } from './features.js';

// where across the painting's frame each trunk stands (u), how far off (m), its height (m); young: the sapling model
const TREES = [
  // the left grove
  { u: 0.03, d: 9.5, h: 18.5 }, { u: 0.085, d: 14, h: 17.5 }, { u: 0.125, d: 11, h: 17 }, { u: 0.17, d: 17, h: 16.5 },
  { u: 0.205, d: 12.5, h: 15 }, { u: 0.055, d: 23, h: 18 }, { u: 0.15, d: 26, h: 16 }, { u: 0.245, d: 19, h: 13 },
  { u: 0.27, d: 9, h: 6.5, young: true }, { u: 0.215, d: 7, h: 5.5, young: true },
  // the right grove
  { u: 0.905, d: 9, h: 19.5 }, { u: 0.968, d: 8, h: 18.5 }, { u: 0.935, d: 16, h: 15 }, { u: 0.85, d: 20, h: 14 },
  { u: 0.8, d: 8.5, h: 6, young: true },
];
// and on past the painting's edges (u beyond 0..1: in what was painted on), thinning out, so the land shows between them
const MARGINS = [
  { u: -0.05, d: 13, h: 17.5 }, { u: -0.12, d: 21, h: 16 }, { u: -0.19, d: 15.5, h: 17 }, { u: -0.27, d: 24, h: 15 },
  { u: -0.09, d: 7.5, h: 6, young: true },
  { u: 1.05, d: 14, h: 17 }, { u: 1.13, d: 22, h: 15.5 }, { u: 1.22, d: 17, h: 16.5 }, { u: 1.3, d: 26, h: 15 },
  { u: 1.17, d: 7.5, h: 5.5, young: true },
];
// and behind the painter, to the left (x, z m): the sun stands behind the viewer, so these throw their shade onto the
// meadow in the first view
const BEHIND = [{ x: -9, z: 4, h: 17.5 }, { x: -14, z: 5.5, h: 16 }];
// the woods round the hill: where each runs (radians right of ahead), the opening in it (its middle, half-width), how
// many trees
const WOODS = [
  { a0: -2.2, a1: -0.98, gap: [LANDMARKS.caucasus, 0.24], n: 17 },
  { a0: 0.98, a1: 2.2, gap: [LANDMARKS.estate, 0.27], n: 17 },
  { a0: -2.62, a1: -2.2, n: 4 }, { a0: 2.2, a1: 2.62, n: 4 },
];
const NEAR = [120, 130];         // drawn in full nearer than this to the camera (and back to the light copy past the next): full copies far out
// how thick a trunk is at its foot (m, radius), for its height (and the walker's own half-width, kept clear of it)
const trunk = (h) => 0.028 * h ** 0.75;

/**
 * The birches on `ground` (countryside.js) from the loaded models ({ name: model }); U: the shared uniforms. Returns a
 * group whose userData.update(camera position, zoom) draws each in full or light, and userData.solid lists the trunks
 * ({ x, z, r }).
 */
export function placeTrees(ground, models, U, { tier = 'high', seed = 23, group = new THREE.Group() } = {}) {
  // no birches in this build (features.js): hand back the empty group with the same userData the caller expects
  if (!FEATURES.trees) { group.userData.trees = 0; group.userData.solid = []; group.userData.update = () => {}; return group; }
  let s = seed;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const birches = ['birch-0', 'birch-1', 'birch-2'].map((n) => models[n]).filter(Boolean), young = models['birch-young-0'] ?? birches[0];
  if (!birches.length) return group;
  // ---- where each stands
  const all = [];
  const add = (x, z, h, isYoung, k) => {
    const model = isYoung ? young : birches[k % birches.length];
    all.push({ x, z, y: ground.heightAt(x, z) - 0.08, yaw: rng() * Math.PI * 2, scale: h / model.height, h, model, near: false });
  };
  // (kept on the island: nothing stands past the meadow's edge, so no birch floats beyond the ground disc)
  [...TREES, ...MARGINS].forEach((t, i) => { const phi = ground.azimuthAt(t.u), d = Math.min(t.d, ground.meadowR(phi) * 0.9); add(d * Math.sin(phi), -d * Math.cos(phi), t.h, t.young, i); });
  BEHIND.forEach((t, i) => add(t.x, t.z, t.h, false, i + 1));
  let s2 = 57;
  const rng2 = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
  WOODS.forEach((W, wi) => {
    const trees = [];
    for (let k = 0, tries = 0; k < W.n && tries < 400; tries++) {
      const a = W.a0 + (W.a1 - W.a0) * rng2(), d = Math.min(9 + 24 * rng2() ** 1.3, ground.meadowR(a) * 0.9), young = rng2() < 0.18;
      // (the opening: clear on either side of the path out, all the way down)
      if (W.gap && Math.abs(a - W.gap[0]) < W.gap[1] + 0.6 / d) continue;
      // (not on top of one another, nor of those already standing, nor on a path)
      const x = d * Math.sin(a), z = -d * Math.cos(a);
      const near = (o) => Math.hypot(o.x - x, o.z - z) < (young || o.young ? 2.2 : 3.4);
      if (trees.some(near) || all.some((o) => Math.hypot(o.x - x, o.z - z) < 2.2) || pathAt(x, z) > 0.05) continue;
      trees.push({ x, z, young, h: young ? 5 + 2.5 * rng2() : 13 + 6 * rng2() });
      k++;
    }
    trees.forEach((t, i) => add(t.x, t.z, t.h, t.young, i + wi + 3));
  });
  // ---- the copies: for each model, room for every birch of it in full and in light (as many shown as stand near / far),
  // twice: the ones the camera draws, and the ones only the sun's picture draws (castOnly)
  const sets = new Map();
  for (const t of all) {
    if (!sets.has(t.model)) sets.set(t.model, { items: [], near: null, far: null });
    sets.get(t.model).items.push(t);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (const [model, S] of sets) {
    const nearOf = model.near ? 'near' : 'far', farOf = model.far ? 'far' : 'near';
    S.near = placeCopies(model, nearOf, S.items, U, { bough: 1.0 });
    S.far = placeCopies(model, farOf, S.items, U, { bough: 1.0 });
    S.nearSun = placeCopies(model, nearOf, S.items, U, { bough: 1.0, castOnly: true });
    S.farSun = placeCopies(model, farOf, S.items, U, { bough: 1.0, castOnly: true });
    group.add(S.near, S.far, S.nearSun, S.farSun);
    // (a ball round each birch, from both its copies' bounds, a little wider for the wind: what a view must take in to
    // see any of it)
    const box = new THREE.Box3();
    for (const part of [...(model.near ?? []), ...(model.far ?? [])]) {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox);
    }
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    for (const t of S.items) {
      q.setFromAxisAngle(up, t.yaw);
      t.ball = new THREE.Sphere(c.clone().multiplyScalar(t.scale).applyQuaternion(q).add(p.set(t.x, t.y, t.z)), r * t.scale + 0.6);
    }
  }
  // (each set of copies rewritten only when what it shows has changed)
  const show = (g, list) => {
    const was = g.userData.shown;
    if (was && was.length === list.length && was.every((it, i) => it === list[i])) return;
    g.userData.shown = list;
    g.children.forEach((mesh) => {
      list.forEach((it, i) => { q.setFromAxisAngle(up, it.yaw); sc.setScalar(it.scale); p.set(it.x, it.y, it.z); mesh.setMatrixAt(i, mtx.compose(p, q, sc)); });
      mesh.count = list.length;
      mesh.visible = list.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
  };
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  let last = null;
  /** Each frame: which copy of each birch (by how near the camera stands, `pos`, and how far zoomed in), and which are
   *  drawn: those whose ball the camera's view takes in (`cam`; all, without one), and for the sun's picture those its
   *  camera takes in (`sun`; none drawn there without one: the sun is in). */
  group.userData.update = (pos, zoom = 1, cam = null, sun = null) => {
    if (!last || Math.hypot(pos.x - last.x, pos.z - last.z) >= 0.5 || Math.abs(Math.log(zoom / last.zoom)) >= 0.05) {
      last = { x: pos.x, z: pos.z, zoom };
      const [inR, outR] = NEAR.map((d) => d * Math.max(1, zoom));
      for (const t of all) t.near = Math.hypot(t.x - pos.x, t.z - pos.z) < (t.near ? outR : inR);
    }
    for (const [camera, sunPass] of [[cam, false], [sun, true]]) {
      if (sunPass && !camera) continue;
      if (camera) { pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); }
      for (const S of sets.values()) {
        const near = [], far = [];
        for (const t of S.items) if (!camera || frustum.intersectsSphere(t.ball)) (t.near ? near : far).push(t);
        show(sunPass ? S.nearSun : S.near, near); show(sunPass ? S.farSun : S.far, far);
      }
    }
  };
  group.userData.update({ x: 0, z: 0 });
  group.userData.trees = all.length;
  group.userData.solid = all.map((t) => ({ x: t.x, z: t.z, r: trunk(t.h) }));
  return group;
}
