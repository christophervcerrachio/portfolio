// The quays' streets and footways (v0.0.179; dev\world\quays179\quays_gen.py). The land is drawn from an 8 m grid, and
// behind every quay's wall it dips for 10 to 14 m (canals.py keeps the water deep right up to the wall): the quay's 8 m
// slab hid part of it, and past the slab's inner edge the street fell away to sand, and in places to the water itself.
// Here the street from the footway's kerb to the houses (or 14 m from the wall) is a surface of its own, drawn with the
// land's own shaders - its setts, its light and its shade, with no seam where it meets the land - and with the footways'
// tops it is the walker's floor: floorAt(x, z), the highest of them there, or null (countryside.js wraps the world's
// heightAt with it). The footways themselves are the embankments' models (cityblocks.js).
//
// <city>-quays.json: { cell, ztop, street: [{ i, j, v: [offset, points], t: [offset, triangles] }], floor: [...] } over
// <city>-quays.bin: each cell's points (Uint16 x, Int16 y, Uint16 z: x and z centimetres from the cell's corner less
// 50 m, y millimetres from ztop), then its triangles (Uint16 indices).
import * as THREE from 'three';

const DIR = 'assets/world/cities/';
const SUB = 8;                          // (m: the floor's lookup squares)

/** One cell's points and triangles, as the world has them: { pos (Float32Array x, y, z), index (Uint16Array) }. */
export function decodeCell(buf, c, cell, ztop) {
  const n = c.v[1], q = new Uint16Array(buf, c.v[0], n * 3), qs = new Int16Array(buf, c.v[0], n * 3);
  const ox = c.i * cell - 50, oz = c.j * cell - 50, pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { pos[k * 3] = ox + q[k * 3] / 100; pos[k * 3 + 1] = ztop + qs[k * 3 + 1] / 1000; pos[k * 3 + 2] = oz + q[k * 3 + 2] / 100; }
  return { pos, index: new Uint16Array(buf, c.t[0], c.t[1] * 3) };
}

/** The walker's floor over a set of decoded cells: floorAt(x, z) - the highest triangle over the point, or null. */
export function makeFloor(parts) {
  const grid = new Map();                // ('i,j' of SUB m) -> [[part, triangle], ...]
  parts.forEach(({ pos, index }, pi) => {
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const x0 = Math.min(pos[a], pos[b], pos[c]), x1 = Math.max(pos[a], pos[b], pos[c]);
      const z0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), z1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
      for (let i = Math.floor(x0 / SUB); i <= Math.floor(x1 / SUB); i++) for (let j = Math.floor(z0 / SUB); j <= Math.floor(z1 / SUB); j++) {
        const k = i + ',' + j; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(pi, t);
      }
    }
  });
  return (x, z) => {
    const l = grid.get(Math.floor(x / SUB) + ',' + Math.floor(z / SUB));
    if (!l) return null;
    let best = null;
    for (let k = 0; k < l.length; k += 2) {
      const { pos, index } = parts[l[k]], t = l[k + 1];
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      // (a hair's breadth over the edges: two triangles' shared edge is in both)
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
      const y = u * pos[a + 1] + v * pos[b + 1] + w * pos[c + 1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

/** The land's own look on a surface of given triangles: the finest ring's shaders - the vertex shader taking the points
 *  where they stand, the slope from the surface itself (the land's own, under it, is the dip's). Null if the land's
 *  shaders are not as this reads them. */
export function landPatchMaterial(land) {
  const m0 = land?.rings?.[0]?.land?.material;
  if (!m0) return null;
  const vs = m0.vertexShader, at = vs.lastIndexOf('void main() {');
  const slope = 'vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));';
  if (at < 0 || !m0.fragmentShader.includes(slope)) return null;
  return new THREE.ShaderMaterial({
    uniforms: { ...m0.uniforms, uInner: { value: new THREE.Vector4(0, 0, 0, 0) }, uScale: { value: 1 }, uCenter: { value: new THREE.Vector2() } },
    vertexShader: vs.slice(0, at) + 'void main() {\n  vW = position;\n  vSun = sunThrough(vW);\n  vec4 mv = viewMatrix * vec4(vW, 1.0);\n  vDist = -mv.z;\n  gl_Position = projectionMatrix * mv;\n}',
    fragmentShader: m0.fragmentShader.replace(slope, 'vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;'),
    defines: { ...(m0.defines ?? {}) }, glslVersion: m0.glslVersion,
  });
}

/** The quays of these cities: a promise of { group (the streets' surfaces, a mesh a cell), floorAt } or null. */
export function loadQuays(base, cities, land) {
  return Promise.all(cities.map((c) => Promise.all([
    fetch(base + DIR + c + '-quays.json').then((r) => (r.ok ? r.json() : null)),
    fetch(base + DIR + c + '-quays.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]).catch(() => [null, null]))).then((all) => {
    const mat = landPatchMaterial(land), group = new THREE.Group(), parts = [];
    group.name = 'quays';
    for (const [J, buf] of all) {
      if (!J || !buf) continue;
      for (const c of J.street) {
        const p = decodeCell(buf, c, J.cell, J.ztop); parts.push(p);
        if (!mat) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); g.setIndex(new THREE.BufferAttribute(p.index, 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat); m.name = 'quay-street'; m.matrixAutoUpdate = false;
        group.add(m);
      }
      for (const c of J.floor) parts.push(decodeCell(buf, c, J.cell, J.ztop));
    }
    if (!parts.length) return null;
    return { group, floorAt: makeFloor(parts) };
  });
}
