// The cities' bridges (dev\world\citybridges.py, built in Blender): the Neva's floating bridges, decks of timber on
// moored boats; the granite arches over the canals, some with their chain towers; the timber bridges on piles; the
// Ioannovsky bridge into the fortress. userData.deckAt(x, z): the deck's height there for the walker, or null.
import * as THREE from 'three';
import { loadInTurn } from './reveal.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';

const DIR = 'assets/world/cities/';

export function buildCityBridges(U, { base = '' } = {}) {
  const group = new THREE.Group(); group.name = 'citybridges';
  let decks = [];
  group.userData.deckAt = (x, z) => {
    for (const d of decks) {
      const rx = x - d.a[0], rz = z - d.a[1], s = rx * d.ux + rz * d.uz;
      if (s < 0 || s > d.L || Math.abs(-rx * d.uz + rz * d.ux) > d.w / 2) continue;
      const k = Math.min(d.deck.length - 2, Math.floor(s / d.step)), t = (s - k * d.step) / Math.max(1e-3, Math.min(d.step, d.L - k * d.step));
      return d.deck[k] + (d.deck[k + 1] - d.deck[k]) * Math.min(1, t);
    }
    return null;
  };
  fetch(base + DIR + 'city-bridges.json').then((r) => r.json()).then((J) => {
    decks = J.bridges.map((b) => { const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L = Math.hypot(dx, dz); return { ...b, ux: dx / L, uz: dz / L, L }; });
  }).catch(() => {});
  loadInTurn(base + DIR + 'city-bridges.glb').then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material.side = THREE.FrontSide;
      const nm = (o.material.name || '').toLowerCase();
      if (o.material.map && /granite/.test(nm)) parallax(o.material, { depth: 0.012, scale: 2.774 });
      else if (o.material.map && /timber|log/.test(nm)) parallax(o.material, { depth: 0.01, scale: 1.5 });
      receiveSun(o.material, U);
    });
    // (the bridges of each 800 m of a city as their own pieces, so those out of the view or out of reach are not drawn:
    // the file is both cities' bridges merged by material, and all 75,000 triangles of it had been drawn from anywhere
    // on the map - measured 11 Nov 2026)
    g.scene.updateMatrixWorld(true);
    const parts = [];
    g.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    for (const o of parts) for (const m of splitByCells(o, 800)) { if (m === o) { m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); } group.add(m); }
  }).catch(() => {});
  return group;
}

/** A mesh cut into pieces by where its triangles stand (cells of `cell` m, by each triangle's middle in the world),
 *  each piece with the mesh's own place, material and name, and its own bounds - so each is drawn only when it is in
 *  the view and within reach (farcull.js). The mesh must have been placed (updateMatrixWorld). */
export function splitByCells(mesh, cell) {
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
