// The cities' bridges (dev\world\citybridges.py, built in Blender): the Neva's floating bridges, decks of timber on
// moored boats; the granite arches over the canals, some with their chain towers; the timber bridges on piles; the
// Ioannovsky bridge into the fortress. userData.deckAt(x, z): the deck's height there for the walker (on a stone
// bridge's footways their kerb's height over the roadway), or null; stoneAt(x, z): whether that deck is stone;
// parapetStop(x0, z0, x1, z1): where a step from x0, z0 to x1, z1 stops at a stone bridge's parapet, or null.
import * as THREE from 'three';
import { loadInTurn, breathe } from './reveal.js';
import { arrive } from './arrive.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';

const DIR = 'assets/world/cities/';

export function buildCityBridges(U, { base = '' } = {}) {
  const group = new THREE.Group(); group.name = 'citybridges';
  let decks = [];
  const deckOf = (x, z) => {
    for (const d of decks) {
      const rx = x - d.a[0], rz = z - d.a[1], s = rx * d.ux + rz * d.uz, o = -rx * d.uz + rz * d.ux;
      if (s < 0 || s > d.L || Math.abs(o) > d.w / 2) continue;
      const k = Math.min(d.deck.length - 2, Math.floor(s / d.step)), t = (s - k * d.step) / Math.max(1e-3, Math.min(d.step, d.L - k * d.step));
      return [d, d.deck[k] + (d.deck[k + 1] - d.deck[k]) * Math.min(1, t) + (d.kerb !== undefined && Math.abs(o) > d.kerb ? d.up : 0)];
    }
    return null;
  };
  group.userData.deckAt = (x, z) => deckOf(x, z)?.[1] ?? null;
  group.userData.stoneAt = (x, z) => { const q = deckOf(x, z); return !!q && q[0].inner !== undefined; };
  // (a stone bridge's parapets (inner: their inner faces from the deck's middle, m): a step from its deck stops a body's
  // half-width short of them, a step from beside it at their outer faces)
  group.userData.parapetStop = (x0, z0, x1, z1) => {
    for (const d of decks) {
      if (d.inner === undefined) continue;
      const s1 = (x1 - d.a[0]) * d.ux + (z1 - d.a[1]) * d.uz;
      if (s1 < -0.3 || s1 > d.L + 0.3) continue;
      const o0 = -(x0 - d.a[0]) * d.uz + (z0 - d.a[1]) * d.ux, o1 = -(x1 - d.a[0]) * d.uz + (z1 - d.a[1]) * d.ux;
      const lim = d.inner - 0.3, out = d.w / 2 + 0.3;
      let to = null;
      if (Math.abs(o0) <= lim + 1e-3 && Math.abs(o1) > lim) to = Math.sign(o1) * lim;
      else if (Math.abs(o0) >= out - 1e-3 && Math.abs(o1) < out && Math.sign(o0) === Math.sign(o1)) to = Math.sign(o1) * out;
      if (to !== null) { const k = to - o1; return [x1 - d.uz * k, z1 + d.ux * k]; }
    }
    return null;
  };
  // (the cities' bridges, and those on the high roads where they run into a river short of a city's streets:
  // city-bridges-roads, citybridges.py's roads)
  for (const name of ['city-bridges', 'city-bridges-roads']) {
    fetch(base + DIR + name + '.json').then((r) => r.json()).then((J) => {
      decks = decks.concat(J.bridges.map((b) => { const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L = Math.hypot(dx, dz); return { ...b, ux: dx / L, uz: dz / L, L }; }));
    }).catch(() => {});
    loadInTurn(base + DIR + name + '.glb').then(async (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material.side = THREE.FrontSide;
        const nm = (o.material.name || '').toLowerCase();
        if (o.material.map && /granite/.test(nm)) parallax(o.material, { depth: 0.012, scale: 2.774 });
        // (the gilded balls on the Politseysky's obelisks and the Anichkov's towers: as the Kremlin's gilt)
        if (o.material.metalness > 0.5) { o.material.metalness = 0.72; o.material.envMapIntensity = 2.4; }
        else if (o.material.map && /timber|log/.test(nm)) parallax(o.material, { depth: 0.01, scale: 1.5 });
        receiveSun(o.material, U);
      });
      // (the bridges of each 800 m of a city as their own pieces, so those out of the view or out of reach are not drawn:
      // the file is both cities' bridges merged by material, and all 75,000 triangles of it had been drawn from anywhere
      // on the map - measured 11 Nov 2026)
      g.scene.updateMatrixWorld(true);
      const parts = [];
      g.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
      // (cut a few thousand triangles at a time between frames; each piece then comes in and rises out of the water, the
      // nearest first: arrive.js)
      for (const o of parts) for (const m of await splitByCells(o, 800, breathe)) {
        if (m === o) { m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); }
        arrive(m, { parent: group, batch: 'city-bridges', wave: 2200 });
      }
    }).catch(() => {});
  }
  return group;
}

/** A mesh cut into pieces by where its triangles stand (cells of `cell` m, by each triangle's middle in the world),
 *  each piece with the mesh's own place, material and name, and its own bounds - so each is drawn only when it is in
 *  the view and within reach (farcull.js). The mesh must have been placed (updateMatrixWorld). With `pause` (reveal.js
 *  breathe), awaited every so many triangles, and the pieces come as a promise. */
export function splitByCells(mesh, cell, pause = null) {
  if (pause) return splitAsync(mesh, cell, pause);
  const g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const P = g0.attributes.position, nT = P.count / 3, buckets = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  if (Object.values(g0.attributes).some((at) => at.isInterleavedBufferAttribute)) return [mesh];
  for (let t = 0; t < nT; t++) {
    a.fromBufferAttribute(P, 3 * t).add(b.fromBufferAttribute(P, 3 * t + 1)).add(c.fromBufferAttribute(P, 3 * t + 2)).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    const k = Math.floor(a.x / cell) + ',' + Math.floor(a.z / cell);
    let l = buckets.get(k); if (!l) buckets.set(k, (l = [])); l.push(t);
  }
  const out = [];
  for (const [k, list] of buckets) {
    const g = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(g0.attributes)) {
      const n = at.itemSize, arr = new at.array.constructor(list.length * 3 * n);
      list.forEach((t, i) => { for (let v = 0; v < 3 * n; v++) arr[i * 3 * n + v] = at.array[t * 3 * n + v]; });
      g.setAttribute(name, new THREE.BufferAttribute(arr, n, at.normalized));
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mesh.material);
    m.name = (mesh.name || 'part') + '@' + k; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
    m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld);
    out.push(m);
  }
  if (g0 !== mesh.geometry) g0.dispose();
  return out;
}

// (the same, a few thousand triangles at a time, the frame given back between)
async function splitAsync(mesh, cell, pause) {
  const g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  if (Object.values(g0.attributes).some((at) => at.isInterleavedBufferAttribute)) return [mesh];
  await pause();
  const P = g0.attributes.position, nT = P.count / 3, buckets = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < nT; t++) {
    a.fromBufferAttribute(P, 3 * t).add(b.fromBufferAttribute(P, 3 * t + 1)).add(c.fromBufferAttribute(P, 3 * t + 2)).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    const k = Math.floor(a.x / cell) + ',' + Math.floor(a.z / cell);
    let l = buckets.get(k); if (!l) buckets.set(k, (l = [])); l.push(t);
    if ((t & 4095) === 4095) await pause();
  }
  const out = [];
  for (const [k, list] of buckets) {
    const g = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(g0.attributes)) {
      const n = at.itemSize, arr = new at.array.constructor(list.length * 3 * n);
      list.forEach((t, i) => { for (let v = 0; v < 3 * n; v++) arr[i * 3 * n + v] = at.array[t * 3 * n + v]; });
      g.setAttribute(name, new THREE.BufferAttribute(arr, n, at.normalized));
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mesh.material);
    m.name = (mesh.name || 'part') + '@' + k; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
    m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld);
    out.push(m);
    await pause();
  }
  return out;
}
