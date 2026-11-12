// The stones on the ways: pebbles all over a path's earth, hand-sized stones here and there, a few bigger rocks kicked
// to its edges, all real and lit, with the rock skin and their shadows. Laid round the camera from the ways themselves
// (paths.js: near(x, z), negative on a way), in 8 m cells each with its own seed, so a stone is always where it was.
import * as THREE from 'three';
import { stone } from '../backdrops/stones.js';
import { rockSkin } from './rockskin.js';
import { receiveSun } from '../backdrops/sunshadow.js';

const CELL = 8, R = 70;
const KINDS = [
  // size range (m across), how many to a square metre of way, where (on the way: -1 its middle .. 0 its edge .. +x beyond)
  // (the pebbles and the gravel are in the way's own baked surface now: wayribbons.js)
  { name: 'hand', size: [0.06, 0.13], per: 0.3, from: -1.0, to: 0.3, cap: 2600 },
  { name: 'rock', size: [0.14, 0.3], per: 0.05, from: -1.0, to: 0.35, cap: 700 },
];

export function buildWayStones(world, U, { base = '' } = {}) {
  const group = new THREE.Group(); group.name = 'way-stones';
  const ways = world.ways;
  if (!ways) { group.userData.update = () => {}; return group; }
  let s0 = 11;
  const rng0 = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
  // a few shapes of each kind at unit size, copied
  const mat = receiveSun(rockSkin(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), { base, kind: 'granite', moss: 0.15, relief: 0.6 }), U);
  const sets = KINDS.map((K) => {
    const meshes = [0, 1, 2, 3].map(() => {
      const m = new THREE.InstancedMesh(stone(rng0, 1), mat, K.cap);
      m.count = 0; m.frustumCulled = false; m.name = 'way-' + K.name;
      group.add(m);
      return m;
    });
    return { K, meshes };
  });
  const cells = new Map();
  const make = (ci, cj) => {
    let s = ((((ci * 73856093) ^ (cj * 19349663)) >>> 0) % 2147483646) + 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 4; k++) r();
    const out = KINDS.map(() => []);
    // (no way within the cell: nothing to work out)
    if (ways.near((ci + 0.5) * CELL, (cj + 0.5) * CELL) > CELL) return out;
    KINDS.forEach((K, ki) => {
      const n = Math.round(CELL * CELL * K.per * 0.5);
      for (let i = 0; i < n; i++) {
        const x = (ci + r()) * CELL, z = (cj + r()) * CELL, d = ways.near(x, z);
        if (d > 3) continue;
        // (none out on the way's earth, only along its fringe)
        if (d < -0.6) continue;
        // (how far across: -1 the middle of a 2.6 m track .. 0 its edge; the edge and the verge get more of the big ones)
        const across = d / 1.3;
        if (across < K.from || across > K.to) continue;
        // (the stones thin out toward the fringes)
        if (K.name !== 'pebble' && r() > 1.0 - 0.6 * Math.max(0, across + 0.6)) continue;
        if (K.name !== 'rock' && across > 0 && r() < across / K.to) continue;
        const size = K.size[0] + (K.size[1] - K.size[0]) * r() ** 1.6;
        const y = world.heightAt(x, z) - size * (0.18 + 0.15 * r());
        out[ki].push({ x, y, z, size, yaw: r() * 6.283, tilt: (r() - 0.5) * 0.5, v: Math.floor(r() * 4) % 4 });
      }
    });
    return out;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let at = null;
  group.userData.update = (cam) => {
    if (at && Math.hypot(cam.x - at.x, cam.z - at.z) < 6) return;
    at = { x: cam.x, z: cam.z };
    for (const key of cells.keys()) {
      const [i, j] = key.split(',').map(Number);
      if (Math.abs((i + 0.5) * CELL - cam.x) > R * 1.8 || Math.abs((j + 0.5) * CELL - cam.z) > R * 1.8) cells.delete(key);
    }
    const lists = sets.map(() => [[], [], [], []]);
    for (let i = Math.floor((cam.x - R) / CELL); i <= Math.floor((cam.x + R) / CELL); i++)
      for (let j = Math.floor((cam.z - R) / CELL); j <= Math.floor((cam.z + R) / CELL); j++) {
        const dx = (i + 0.5) * CELL - cam.x, dz = (j + 0.5) * CELL - cam.z;
        if (dx * dx + dz * dz > (R + CELL) ** 2) continue;
        const key = i + ',' + j;
        let c = cells.get(key);
        if (!c) { c = make(i, j); cells.set(key, c); }
        c.forEach((list, ki) => { for (const it of list) lists[ki][it.v].push(it); });
      }
    sets.forEach((S, ki) => S.meshes.forEach((m, v) => {
      const list = lists[ki][v], n = Math.min(list.length, S.K.cap);
      for (let k = 0; k < n; k++) {
        const it = list[k];
        q.setFromEuler(e.set(it.tilt, it.yaw, it.tilt * 0.6));
        m.setMatrixAt(k, m4.compose(p.set(it.x, it.y, it.z), q, sc.setScalar(it.size)));
      }
      m.count = n; m.instanceMatrix.needsUpdate = true;
    }));
  };
  return group;
}
