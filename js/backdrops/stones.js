// The stones along the paths' verges (paths.js): turned up by wheels and pushed aside by feet, half sunk in the turf
// where the grass meets the bare earth, a big one now and then. Real ones (the paths' own gravel is drawn into the
// ground: gravel.js), so they stand up out of it, hide what is behind them and throw their shadows when the sun is out.
// Each is a faceted lump (an icosahedron worn uneven), its own colour (pale limestone, grey, brown, a dark one), dirtier
// toward its foot, lichen on a few; all merged into one mesh, lit as the props are (models.js: windMaterial).
import * as THREE from 'three';
import { rockSkin } from '../world/rockskin.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pathVerges, pathAt } from './paths.js';
import { windMaterial, windDepth } from './models.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
// the stones' colours (and how many of each, by weight)
const KINDS = [[lin('#c9c1b0'), 3], [lin('#a29b8e'), 3], [lin('#8f7e68'), 2], [lin('#6f6a62'), 1.5], [lin('#b39a78'), 1.5], [lin('#57534d'), 0.6]];
const LICHEN = lin('#b8bb8e');

// smooth value noise in space, for the stones' worn shapes
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => h3(ix + a, iy + b, iz + d), m = (a, b, t) => a + (b - a) * t;
  return m(m(m(c(0, 0, 0), c(1, 0, 0), fx), m(c(0, 1, 0), c(1, 1, 0), fx), fy), m(m(c(0, 0, 1), c(1, 0, 1), fx), m(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

/** One stone, size m across, its middle at the origin: worn uneven, flat-faceted, coloured. */
export function stone(rng, size) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, o = rng() * 50;
  const sx = 0.9 + 0.45 * rng(), sy = 0.45 + 0.3 * rng(), sz = 0.75 + 0.35 * rng();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // (the same at every copy of a corner, so it stays whole)
    const k = 1 + 0.32 * (noise3(x * 1.6 + o, y * 1.6, z * 1.6) - 0.5) + 0.14 * (noise3(x * 4 + o, y * 4 + 3, z * 4) - 0.5);
    p.setXYZ(i, x * k * sx * size / 2, Math.max(y * k, -0.45) * sy * size / 2, z * k * sz * size / 2);
  }
  g.computeVertexNormals();
  let pick = rng() * KINDS.reduce((a, [, w]) => a + w, 0), base = KINDS[0][0];
  for (const [c, w] of KINDS) { if ((pick -= w) <= 0) { base = c; break; } }
  const lichen = rng() < 0.3, col = new Float32Array(p.count * 3), n = g.attributes.normal;
  for (let f = 0; f < p.count; f += 3) {
    const k = 0.86 + 0.24 * rng();
    for (let v = f; v < f + 3; v++) {
      const low = Math.min(1, Math.max(0, 0.5 - p.getY(v) / (sy * size)));       // (soiled toward its foot)
      let r = base.r * k, gg = base.g * k, b = base.b * k;
      const dirt = 0.55 * low; r = r * (1 - dirt) + 0.12 * dirt; gg = gg * (1 - dirt) + 0.1 * dirt; b = b * (1 - dirt) + 0.07 * dirt;
      if (lichen && n.getY(v) > 0.55 && noise3(p.getX(v) * 40, p.getY(v) * 40, p.getZ(v) * 40) > 0.55) { r = LICHEN.r; gg = LICHEN.g; b = LICHEN.b; }
      col.set([r, gg, b], v * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size * 6, uv.getY(i) * size * 3);
  return g;
}

/** Grain for the stones' faces: fine speckle, a few darker pits. */
function stoneMap() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 200 + 40 * Math.random() - (Math.random() < 0.04 ? 90 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The stones along the verges, on `ground` (countryside.js), lit by the shared uniforms U. */
export function placeStones(ground, U, { tier = 'high', seed = 41, base = '', world = null } = {}) {
  let s = seed;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geos = [], solid = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const v of pathVerges(rng, { step: tier === 'high' ? 0.5 : 0.85 })) {
    // (kept on the island: skip a verge stone whose spot is past the meadow's edge, so none hangs off the ground disc)
    if (Math.hypot(v.x, v.z) > ground.meadowR(Math.atan2(v.x, -v.z)) + 0.5) continue;
    if (rng() > 0.62) continue;
    // (just at the edge, or a little out into the grass)
    const out = -0.05 + 0.4 * rng() ** 1.6, x = v.x + v.nx * out, z = v.z + v.nz * out;
    // (none out on the world's ways, whose earth is wider than these old lines; those along the fringe stay.)
    if (world?.ways && world.ways.near(x, z) < -0.6) continue;
    const big = rng() < 0.09, size = big ? 0.17 + 0.2 * rng() : 0.05 + 0.11 * rng() ** 1.3;
    const g = stone(rng, size);
    const y = ground.heightAt(x, z) - size * (0.12 + 0.12 * rng()) - 0.02 * pathAt(x, z);
    q.setFromEuler(e.set((rng() - 0.5) * 0.35, rng() * Math.PI * 2, (rng() - 0.5) * 0.35));
    g.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    geos.push(g);
    if (size > 0.2) solid.push({ x, z, r: size * 0.55 });
  }
  const group = new THREE.Group();
  group.name = 'stones';
  if (!geos.length) return group;
  const geo = mergeGeometries(geos, false);
  geo.computeBoundingSphere();
  const mat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, map: stoneMap() }), { kind: 'body', height: 1, sway: 0, bough: 0, U });
  // (their faces: the rock skin, the 2k rock tile from three sides at two sizes, with its relief: world/rockskin.js)
  rockSkin(mat, { base, kind: 'granite', moss: 0.3, relief: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stones.verge';
  mesh.userData.depthMat = windDepth('body', { height: 1, sway: 0, bough: 0, U });
  group.add(mesh);
  group.userData.count = geos.length;
  group.userData.solid = solid;           // (the big ones: the walker steps round them)
  return group;
}
