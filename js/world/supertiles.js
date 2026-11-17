// The houses' tiles drawn together from afar (16 Nov 2026). A tile of houses is some twenty meshes, one for each of its
// materials (each house front's colour, the roofs, the chimneys, the shops' fronts), and both cities are a thousand
// tiles: from over Moscow, or from the hilltop with Moscow on the horizon, 3,700 to 4,700 draws a frame for the houses
// alone, every one of them a call the page makes - a third of the frame's time on an RTX 5090, and the reason the walk
// went at 30 frames a second there. A super-tile is SPAN x SPAN tiles: as each tile is read its triangles are copied,
// material by material, into its super-tile's lists (before the card takes them and the page lets them go: citytiles.js
// letGo), and once every tile of it is read they are joined, each material's into one mesh. From afar the super-tile is
// drawn in its tiles' place - the same triangles, the same materials, a twentieth of the draws; near it, its tiles as
// they always were. The joined meshes are kept in the super-tile's own frame (its middle at their origin), so their
// numbers stay fine wherever they are drawn.
import * as THREE from 'three';

export const SPAN = 4;                   // (tiles a side of a super-tile: 1.6 km of 400 m tiles)

/** A super-tile's record: its rectangle in the world (x0..x1, z0..z1), its tiles, and its lists as they come in. */
export function superTile(key, x0, z0, x1, z1) {
  return { key, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, y0: Infinity, y1: -Infinity, members: [], lists: new Map(), shared: [], scene: null };
}

// (whether a matrix turns or scales, not only moves)
const turned = (e) => Math.abs(e[0] - 1) > 1e-7 || Math.abs(e[5] - 1) > 1e-7 || Math.abs(e[10] - 1) > 1e-7 || Math.abs(e[1]) > 1e-7 || Math.abs(e[2]) > 1e-7
  || Math.abs(e[4]) > 1e-7 || Math.abs(e[6]) > 1e-7 || Math.abs(e[8]) > 1e-7 || Math.abs(e[9]) > 1e-7;

/** An attribute's values as one plain array (an interleaved one read out of its buffer). */
function plain(a) {
  if (!a.isInterleavedBufferAttribute) return a.array.slice(0, a.count * a.itemSize);
  const n = a.count, k = a.itemSize, src = a.data.array, st = a.data.stride, off = a.offset;
  const out = new src.constructor(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = src[i * st + off + j];
  return out;
}

/** Mesh `o` of a tile (its matrixWorld its place in the world) kept for super-tile `S`: its triangles copied into the
 *  list of its material, in the super-tile's frame. What cannot be joined (an instanced mesh, more than one material, no
 *  index, a tangent to turn) is drawn with the super-tile as it is, its geometry shared. */
export function superKeep(S, o) {
  const geo = o.geometry, m = o.material, e = o.matrixWorld.elements, rot = turned(e);
  if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(m) || !geo.index || geo.groups.length > 1 || Object.keys(geo.morphAttributes).length
    || (rot && geo.attributes.tangent)) { S.shared.push(o); return; }
  const names = Object.keys(geo.attributes).sort();
  const sig = m.uuid + '|' + o.renderOrder + '|' + names.map((n) => { const a = geo.attributes[n]; return n + ':' + a.itemSize + (a.normalized ? 'n' : '') + ':' + (a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name; }).join(',');
  let L = S.lists.get(sig);
  if (!L) S.lists.set(sig, (L = { mat: m, names, sizes: names.map((n) => geo.attributes[n].itemSize), norm: names.map((n) => geo.attributes[n].normalized), items: [], verts: 0, idx: 0, from: o }));
  const n = geo.attributes.position.count, item = { n, a: {}, idx: geo.index.array.slice(0, geo.index.count) };
  const nm = rot ? new THREE.Matrix3().getNormalMatrix(o.matrixWorld).elements : null;
  for (const name of names) {
    const v = plain(geo.attributes[name]);
    if (name === 'position') {
      for (let i = 0; i < n; i++) {
        const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
        const wx = rot ? e[0] * x + e[4] * y + e[8] * z + e[12] : x + e[12];
        const wy = rot ? e[1] * x + e[5] * y + e[9] * z + e[13] : y + e[13];
        const wz = rot ? e[2] * x + e[6] * y + e[10] * z + e[14] : z + e[14];
        v[i * 3] = wx - S.cx; v[i * 3 + 1] = wy; v[i * 3 + 2] = wz - S.cz;
        if (wy < S.y0) S.y0 = wy; if (wy > S.y1) S.y1 = wy;
      }
    } else if (rot && name === 'normal') {
      for (let i = 0; i < n; i++) {
        const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
        const X = nm[0] * x + nm[3] * y + nm[6] * z, Y = nm[1] * x + nm[4] * y + nm[7] * z, Z = nm[2] * x + nm[5] * y + nm[8] * z, l = Math.hypot(X, Y, Z) || 1;
        v[i * 3] = X / l; v[i * 3 + 1] = Y / l; v[i * 3 + 2] = Z / l;
      }
    }
    item.a[name] = v;
  }
  L.items.push(item); L.verts += n; L.idx += item.idx.length;
}

/** Super-tile `S` joined: a group in its frame, a mesh for each list (and the shared ones as they are), made ready for
 *  the walk (matrices set); or null when there is nothing in it. Its lists let go. */
export function superBuild(S, name) {
  if (!S.lists.size && !S.shared.length) { S.lists = null; return null; }
  const g = new THREE.Group();
  g.name = name;
  g.position.set(S.cx, 0, S.cz);
  g.updateMatrix(); g.matrixAutoUpdate = false;
  for (const L of S.lists.values()) {
    const geo = new THREE.BufferGeometry();
    L.names.forEach((nm, j) => {
      const k = L.sizes[j], out = new L.items[0].a[nm].constructor(L.verts * k);
      let at = 0;
      for (const it of L.items) { out.set(it.a[nm], at); at += it.n * k; }
      geo.setAttribute(nm, new THREE.BufferAttribute(out, k, L.norm[j]));
    });
    const idx = L.verts > 65535 ? new Uint32Array(L.idx) : new Uint16Array(L.idx);
    let at = 0, base = 0;
    for (const it of L.items) { const s = it.idx; for (let i = 0; i < s.length; i++) idx[at + i] = s[i] + base; at += s.length; base += it.n; }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, L.mat);
    mesh.name = name + '.' + (L.mat.name || 'mesh');
    mesh.renderOrder = L.from.renderOrder;
    mesh.userData = { ...L.from.userData };
    mesh.matrixAutoUpdate = false;
    g.add(mesh);
  }
  // (what is drawn as it is: its own geometry, shared, placed in the super-tile's frame)
  const back = new THREE.Matrix4().makeTranslation(-S.cx, 0, -S.cz);
  for (const o of S.shared) {
    const c = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, o.material, o.count) : new THREE.Mesh(o.geometry, o.material);
    if (o.isInstancedMesh) { c.instanceMatrix = o.instanceMatrix; c.instanceColor = o.instanceColor; c.boundingSphere = null; }
    c.matrix.copy(o.matrixWorld).premultiply(back);
    c.matrixAutoUpdate = false; c.renderOrder = o.renderOrder; c.userData = { ...o.userData }; c.name = o.name;
    g.add(c);
  }
  g.updateMatrixWorld(true);
  S.lists = null; S.shared = [];
  return g;
}
