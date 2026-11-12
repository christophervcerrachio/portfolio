// The solid world beyond the island: one walkable land all the way to the horizon, so the visitor leaves the hilltop on
// foot and crosses a region to Petersburg behind and Moscow ahead, each laid out 1:1 with its map (city3d.js). The
// ground matches the island's own surface inside the meadow (so the grass sits on it exactly), then slopes off the hill
// to a plain that rolls gently, except flattened (noise suppressed) under each city so the city's own ground lies flat on
// it and along the river that links the two. Heights in metres, the camera's ground at the island's height; x right,
// z back (Moscow ahead is -z, Petersburg behind is +z). The cities sit close (compressed ~75%) but stay 1:1.
import * as THREE from 'three';
import { buildCity } from './city3d.js';
import { smooth, fbm, ridged } from './terrain.js';
import { FEATURES } from './features.js';

export const REGION = { walkR: 3500, plainDepth: 4, desc: 90, meadowR: 20 };

// the Moskva -> Neva: a river across the open gap between the two cities, bulging to the right past the island. It ends
// at each city's near edge (Moscow buildings start ~1.2 km ahead, Petersburg's ~1 km behind), so it reads as flowing into
// each. World x, z metres.
const RIVER = [
  [-100, -1500], [30, -1230], [90, -900], [130, -500], [150, -150],
  [170, 150], [130, 500], [100, 800], [80, 1000],
];
const RIVER_W = 80;          // bank half-width (metres): the channel floor to here, water a touch narrower
const WATER_Y = -1.5;        // water surface, just below the plain so it reads over its banks
const BED = -10;             // riverbed, metres below the plain

// the shortest distance from (x, z) to the river's centre line (a polyline)
function distRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx - x, pz = az + t * dz - z, d = Math.hypot(px, pz);
    if (d < best) best = d;
  }
  return best;
}

// ---- the Caucasus, to the left (east): green foothills rising, the spa resorts of Pyatigorsk and Kislovodsk, Mashuk
// and five-headed Beshtau standing out of the plain, and on the horizon the snowy main range with two-headed Elbrus.
// Compressed to the region's own scale (the old painted ring had Elbrus 45 km off; here the range sits just past the
// walk, so it reads as the far horizon to the left). Everything is gated by how far left one looks, so Moscow ahead and
// Petersburg behind (and the river between them) are untouched. x right, z back; azimuth deg clockwise from ahead.
const AT = (azDeg, r) => { const a = (azDeg * Math.PI) / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
const gauss = (deg, c, w) => Math.exp(-(((deg - c) / w) ** 2));   // how much the mountains show at this azimuth
const CAUC = {
  center: -90, width: 46,                              // the arc of sky the mountains fill (deg clockwise from ahead)
  foothill: [[1300, 3200, 40], [3200, 5200, 90]],      // [r0, r1, rise]: a gentle climb, so the peaks behind read over it
  mashuk: { az: -80, r: 2200, ht: 320, rad: 620 },     // the lone conical hill above Pyatigorsk
  beshtau: { az: -97, r: 2950, ht: 700, rad: 980,      // the five-headed massif above Kislovodsk
    heads: [[0, 0, 220, 470], [-560, 120, 180, 400], [470, -140, 160, 370], [-380, -260, 130, 320], [560, 260, 140, 320]] },
  range: { az: [-132, -54], r: 4100, depth: 1400, ht: 1600 },   // the snowy main range on the horizon
  elbrus: { az: -90, r: 4350, ht: 2000, rad: 1400, heads: [[-560, 0], [560, -120]] },   // two-headed, in front of it
  towns: [                                             // the two spa resorts, both within the walk (walkR 3500)
    { name: 'Pyatigorsk', az: -88, r: 1650, n: 46, spread: 250, park: 150, glLen: 58 },
    { name: 'Kislovodsk', az: -106, r: 2350, n: 40, spread: 300, park: 220, glLen: 66 },
  ],
};

// Yasnaya Polyana — Tolstoy's estate — to the right (west, az ~+90): the manor house with its white-columned portico,
// the park and its old oaks, a pond, and the writer's grave, a simple grass mound under the trees. This is the literary
// way off the hill (landmarks: "estate"). Localised to the right, so Moscow, Petersburg, the river and the Caucasus are
// untouched. x right, z back; azimuth deg clockwise from ahead.
const YAS = { az: 92, r: 2100, park: 300, pad: 560, rise: 55 };

// a gentle knoll the manor stands on (metres): 0 away from the right, so the rest of the world is untouched
function yasRise(x, z) {
  const [x0, z0] = AT(YAS.az, YAS.r), d = Math.hypot(x - x0, z - z0);
  return YAS.rise * Math.exp(-(d * d) / (2 * 900 * 900));
}

// the land's rise toward the Caucasus (metres): 0 away from the left, so the rest of the world is untouched
function caucHeight(x, z) {
  const r = Math.hypot(x, z), deg = (Math.atan2(x, -z) * 180) / Math.PI;
  const w = gauss(deg, CAUC.center, CAUC.width);
  if (w < 0.02) return 0;
  let h = 0;
  for (const [r0, r1, rise] of CAUC.foothill) h += rise * smooth(r0, r1, r);
  h += 28 * smooth(700, 2000, r) * (fbm(x / 900, z / 900) - 0.5) * 2;                 // the foothills' rolling
  const [mx, mz] = AT(CAUC.mashuk.az, CAUC.mashuk.r), ms = Math.hypot(x - mx, z - mz) / CAUC.mashuk.rad;
  if (ms < 1.25) h += CAUC.mashuk.ht * Math.pow(Math.max(0, 1 - ms * ms / 1.5625), 1.4) * (0.9 + 0.2 * ridged(x / 700, z / 700, 4));
  const [bx, bz] = AT(CAUC.beshtau.az, CAUC.beshtau.r), bs = Math.hypot(x - bx, z - bz) / CAUC.beshtau.rad;
  if (bs < 1.6) h += CAUC.beshtau.ht * Math.pow(Math.max(0, 1 - bs * bs / 2.56), 1.6);
  for (const [u, v, hh, rr] of CAUC.beshtau.heads) {
    const q = Math.hypot(x - (bx + u), z - (bz + v)) / rr;
    if (q < 1.5) h += hh * Math.pow(Math.max(0, 1 - q * q / 2.25), 2.4);
  }
  const ends = smooth(CAUC.range.az[0] - 6, CAUC.range.az[0] + 16, deg) * (1 - smooth(CAUC.range.az[1] - 16, CAUC.range.az[1] + 6, deg));
  if (ends > 0) {
    const crest = CAUC.range.r + 700 * (fbm(deg / 12, 7.7, 3) - 0.5) * 2, across = (r - crest) / CAUC.range.depth;
    if (across > -0.95 && across < 1.6) {
      const env = Math.pow(Math.max(0, 1 - Math.abs(across) / (across < 0 ? 0.95 : 1.6)), 1.1);
      h += ends * env * CAUC.range.ht * (0.35 + 0.75 * ridged(x / 2600 + 3.1, z / 2600 - 1.3, 7));
    }
  }
  const [ex, ez] = AT(CAUC.elbrus.az, CAUC.elbrus.r), es = Math.hypot(x - ex, z - ez) / CAUC.elbrus.rad;
  if (es < 1.4) {
    let m = es < 1 ? CAUC.elbrus.ht * Math.pow(1 - Math.pow(es, 1.5), 1.7) : 0;
    for (const [u, v] of CAUC.elbrus.heads) {
      const q = Math.hypot(x - (ex + u), z - (ez + v)) / 900;
      if (q < 1) m = Math.max(m, CAUC.elbrus.ht * Math.pow(1 - q * q, 1.3));
    }
    h = Math.max(h, m);
  }
  return h * w;
}

// a spa resort on the foothills: a level bench, a park, pastel villas with pitched roofs, a colonnaded gallery, and
// the parkland trees between them. `t` is a CAUC.towns entry with its world x, z and the pad's level (padY).
function spaTown(t) {
  const g = new THREE.Group(); g.position.set(t.x, t.padY, t.z);
  const lam = (hex) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  let s = (1234 + Math.round(t.az * 97) + t.r) | 0;
  const rng = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  // the park (the resorts are famous for their green parks)
  const park = new THREE.Mesh(new THREE.CircleGeometry(t.park, 28).rotateX(-Math.PI / 2), lam('#4c6b34'));
  park.position.y = 0.25; g.add(park);
  // the villas, set in a ring round the park: one instanced box, each given a size, a turn and a pastel colour
  const pastels = ['#efe6d2', '#e8c9a4', '#cdd8c0', '#e9d3c9', '#dfe6ea', '#f0e2b8', '#e3cfc0'];
  const roofs = ['#9c5b46', '#5f7d5a', '#7c6b57', '#8a8f96'];
  const bGeo = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D(), col = new THREE.Color();
  const villas = new THREE.InstancedMesh(bGeo, new THREE.MeshLambertMaterial(), t.n);
  const caps = new THREE.InstancedMesh(bGeo, new THREE.MeshLambertMaterial(), t.n);
  const solids = []; let placed = 0, tries = 0;
  while (placed < t.n && tries++ < t.n * 10) {
    const a = rng() * Math.PI * 2, rr = t.park + 18 + rng() * (t.spread - t.park);
    const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr, w = 10 + rng() * 15, d = 8 + rng() * 11, hh = 6 + rng() * 11;
    dummy.position.set(bx, hh / 2, bz); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.scale.set(w, hh, d); dummy.updateMatrix();
    villas.setMatrixAt(placed, dummy.matrix); villas.setColorAt(placed, col.set(pastels[(rng() * pastels.length) | 0]));
    dummy.position.y = hh + 0.35; dummy.scale.set(w * 1.08, 0.9, d * 1.08); dummy.updateMatrix();
    caps.setMatrixAt(placed, dummy.matrix); caps.setColorAt(placed, col.set(roofs[(rng() * roofs.length) | 0]));
    if (rr < t.park + 95) solids.push({ x: t.x + bx, z: t.z + bz, r: Math.max(w, d) * 0.6 });
    placed++;
  }
  villas.count = caps.count = placed; g.add(villas, caps);
  // the spa gallery: a long colonnaded building at the park's edge, the resort's signature
  const gl = new THREE.Group(), L = t.glLen;
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, 7, 9), lam('#efe4c8')); body.position.y = 3.5;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 1.5, 1, 11.5), lam('#5f7d5a')); roof.position.y = 7.7;
  gl.add(body, roof);
  const ncol = Math.max(6, Math.round(L / 5)), cGeo = new THREE.CylinderGeometry(0.5, 0.55, 6, 6), cMat = lam('#f3ecda');
  for (let i = 0; i < ncol; i++) { const c = new THREE.Mesh(cGeo, cMat); c.position.set(-L / 2 + (i + 0.5) * (L / ncol), 3, 5.6); gl.add(c); }
  const ga = Math.atan2(t.z, t.x) + Math.PI / 2;   // set the gallery facing the park from its near edge
  gl.position.set(-Math.cos(ga) * (t.park - 6), 0, -Math.sin(ga) * (t.park - 6)); gl.rotation.y = -ga;
  g.add(gl); solids.push({ x: t.x + gl.position.x, z: t.z + gl.position.z, r: L * 0.4 });
  // the parkland trees (poplars, lindens): instanced cones, taller where they stand in the park
  if (FEATURES.trees) {
    const nt = 40 + (t.park > 200 ? 18 : 0), trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2, 6), new THREE.MeshLambertMaterial(), nt);
    let tp = 0, tt = 0;
    while (tp < nt && tt++ < nt * 8) {
      const a = rng() * Math.PI * 2, rr = rng() * (t.park + 60), th = 6 + rng() * 8;
      dummy.position.set(Math.cos(a) * rr, th, Math.sin(a) * rr); dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(2.4 + rng() * 1.4, th, 2.4 + rng() * 1.4); dummy.updateMatrix();
      trees.setMatrixAt(tp, dummy.matrix); trees.setColorAt(tp, col.set(rng() < 0.3 ? '#3f5a2c' : '#4a6a34')); tp++;
    }
    trees.count = tp; g.add(trees);
  }
  return { group: g, solids };
}

// Tolstoy's estate: the manor house with its white-columned portico facing the hill, two service wings about a
// forecourt, the park with its old oaks and linden rows, a pond (the Goose Ponds), and the writer's grave — a simple
// grass mound under the trees, as it truly is (no monument). `c` is the estate entry with its world x, z and the bench
// level (padY). It faces the island, which lies toward local -x.
function manorEstate(c) {
  const g = new THREE.Group(); g.position.set(c.x, c.padY, c.z);
  const lam = (hex) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  let s = (90210 + Math.round(c.az * 97) + c.r) | 0;
  const rng = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const wall = '#e4d19b', trim = '#f2ead8', roofc = '#5f7d5a';
  const box = (w, h, d, hex, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(hex)); m.position.set(x, y, z); return m; };

  // the park lawn (manicured, a shade brighter than the wild plain)
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(c.park, 40).rotateX(-Math.PI / 2), lam('#5c7d3b'));
  lawn.position.y = 0.25; g.add(lawn);

  // the manor house: a two-storey block on a white plinth, a low green hipped roof, two chimneys
  g.add(box(19, 1.5, 47, trim, 10, 0.75, 0));                 // plinth
  g.add(box(18, 12, 46, wall, 10, 6.5, 0));                   // body
  g.add(box(19.5, 2.2, 47.5, roofc, 10, 13.4, 0));            // hipped roof
  g.add(box(15, 1.6, 40, roofc, 10, 15.0, 0));                // ridge
  g.add(box(2, 3, 2, '#8a5a4a', 10, 16.2, -14), box(2, 3, 2, '#8a5a4a', 10, 16.2, 14));   // chimneys
  // the belvedere on the roof ridge - the estate's signature silhouette: a white drum, a green dome and a spire
  const bel = new THREE.Group();
  const bbase = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), lam(trim)); bbase.position.y = 1.5; bel.add(bbase);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 3.4, 10), lam(trim)); drum.position.y = 4.6; bel.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(roofc)); dome.position.y = 6.2; bel.add(dome);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.4, 6), lam(trim)); spire.position.y = 8.6; bel.add(spire);
  bel.position.set(10, 15.6, 0); g.add(bel);
  // the portico facing the hill (local -x): six white columns, an entablature and a shallow pediment roof
  const pcol = new THREE.CylinderGeometry(0.5, 0.62, 10, 8);
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(pcol, lam(trim)); p.position.set(-1.2, 5, -18 + i * 7.2); g.add(p); }
  g.add(box(2.6, 1.4, 44, trim, -1.2, 10.7, 0));              // entablature
  g.add(box(4, 1.0, 45, roofc, -1.2, 11.9, 0));               // portico roof
  // two service wings framing the forecourt that faces the hill
  for (const zs of [-1, 1]) { g.add(box(12, 8, 16, wall, -6, 4, zs * 30)); g.add(box(13, 1, 17, roofc, -6, 8.4, zs * 30)); }
  // the forecourt (gravel) between the wings, toward the hill
  const court = new THREE.Mesh(new THREE.CircleGeometry(24, 24).rotateX(-Math.PI / 2), lam('#c9b48a'));
  court.scale.set(1.15, 1, 1.25); court.position.set(-20, 0.3, 0); g.add(court);

  // the estate's outbuildings and water, laid out after the museum's site plan: a long stable range with a red
  // roof, a glass-roofed greenhouse, a bathing house at the pond, the formal "Kliny" garden, and the two ponds
  const redroof = '#9c4a3a';
  g.add(box(46, 7, 12, wall, -20, 3.5, -78), box(47, 1.2, 13, redroof, -20, 7.4, -78));   // stables / carriage range
  g.add(box(20, 4, 8, trim, 150, 2, -40), box(21, 0.8, 9, '#bcd0cf', 150, 4.4, -40));     // greenhouse (glass roof)
  g.add(box(9, 5, 7, wall, 150, 2.5, 108), box(10, 1, 8, redroof, 150, 5.4, 108));        // bathing house at the pond
  // the formal "Kliny" garden: a green parterre cut by gravel walks, with taller clipped hedge rows forming the beds
  const par = new THREE.Mesh(new THREE.CircleGeometry(58, 4).rotateX(-Math.PI / 2), lam('#6b8c46'));
  par.rotation.y = Math.PI / 4; par.position.set(60, 0.32, 40); g.add(par);
  g.add(box(6, 0.12, 82, '#cbb27e', 60, 0.36, 40), box(82, 0.12, 6, '#cbb27e', 60, 0.36, 40));   // gravel walks
  const hedge = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam('#356030'), 60);
  let hp = 0;
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 4; cc++) {
    const bx = 34 + cc * 18, bz = 16 + r * 13;
    if (Math.hypot(bx - 60, bz - 40) > 44) continue;
    dummy.position.set(bx, 1.0, bz); dummy.rotation.set(0, 0, 0); dummy.scale.set(13, 1.9, 2.2); dummy.updateMatrix();
    hedge.setMatrixAt(hp++, dummy.matrix);
  }
  hedge.count = hp; g.add(hedge);
  // the two ponds (the Big Pond and the Lower Pond), each an ellipse ringed with an earthen bank
  if (FEATURES.ponds) {
    const water = () => new THREE.MeshPhongMaterial({ color: 0x4f89a6, specular: 0xaecbe0, shininess: 90, transparent: true, opacity: 0.95 });
    const pond = (rx, rz, x, z) => {
      const w = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), water()); w.scale.set(rx, 1, rz); w.position.set(x, 0.35, z); g.add(w);
      const bk = new THREE.Mesh(new THREE.RingGeometry(1, 1.16, 28).rotateX(-Math.PI / 2), lam('#6d5c3c')); bk.scale.set(rx, 1, rz); bk.position.set(x, 0.3, z); g.add(bk);
    };
    pond(46, 34, 120, 120); pond(30, 22, 40, 150);
  }

  // Tolstoy's grave: a simple grass mound in a quiet clearing under the oaks (no monument, as it truly is)
  const glade = new THREE.Mesh(new THREE.CircleGeometry(22, 24).rotateX(-Math.PI / 2), lam('#63823f'));
  glade.position.set(78, 0.3, -58); g.add(glade);
  const mound = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 8).scale(1, 0.5, 1.5), lam('#3f5a2c'));
  mound.position.set(78, 0.7, -58); g.add(mound);

  // the park trees: a tree-lined allée flanking the approach, then linden and poplar scattered round the park,
  // keeping clear of the house, the formal garden, the ponds, the stables, the orchard and the grave clearing
  if (FEATURES.trees) {
    const near = (a, b, x, z, r) => Math.hypot(a - x, b - z) < r;
    const nt = 90, trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2, 6), new THREE.MeshLambertMaterial(), nt);
    let tp = 0, tt = 0;
    const put = (px, pz, th, wide) => {
      dummy.position.set(px, th, pz); dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(wide, th, wide); dummy.updateMatrix();
      trees.setMatrixAt(tp, dummy.matrix); trees.setColorAt(tp, col.set(rng() < 0.35 ? '#38512a' : '#46682f')); tp++;
    };
    for (let k = 0; k < 8; k++) { const ax = -150 + k * 14; put(ax, -12, 8 + rng() * 5, 2.4 + rng() * 1.1); put(ax, 12, 8 + rng() * 5, 2.4 + rng() * 1.1); }   // the approach allée
    while (tp < nt && tt++ < nt * 12) {
      const a = rng() * Math.PI * 2, rr = c.park * 0.3 + rng() * (c.park * 0.72);
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
      if (px > -4 && px < 24 && Math.abs(pz) < 26) continue;                 // house
      if (near(px, pz, 60, 40, 80) || near(px, pz, 120, 120, 54) || near(px, pz, 40, 150, 38)) continue;  // garden, ponds
      if (near(px, pz, 78, -58, 26) || near(px, pz, -20, -78, 26)) continue;  // grave clearing, stables
      if (px < -30 && pz > 80) continue;                                     // orchard
      put(px, pz, 7 + rng() * 9, 2.6 + rng() * 1.4);
    }
    trees.count = tp; g.add(trees);
  }

  // the orchards (the Red Garden / Young Orchard): loose rows of round fruit trees on one side of the park
  if (FEATURES.trees) {
    const orch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial(), 40);
    let op = 0;
    for (let r = 0; r < 5; r++) for (let cc = 0; cc < 8; cc++) {
      const px = -150 + cc * 16 + (r % 2) * 6, pz = 90 + r * 14;
      if (Math.hypot(px, pz) > c.park - 24) continue;
      dummy.position.set(px, 2.6, pz); dummy.rotation.set(0, 0, 0); dummy.scale.set(2.6, 2.6, 2.6); dummy.updateMatrix();
      orch.setMatrixAt(op, dummy.matrix); orch.setColorAt(op, col.set('#4a6a34')); op++;
    }
    orch.count = op; g.add(orch);
  }

  // the old oaks: broad canopies on short trunks, two before the portico and three about the grave
  if (FEATURES.trees) {
    const oak = (x, z, r) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.22, r * 1.4, 6), lam('#5a4630'));
      t.position.set(x, r * 0.7, z); g.add(t);
      const cp = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), lam('#3f5a2c'));
      cp.scale.set(1.2, 0.85, 1.2); cp.position.set(x, r * 1.5, z); g.add(cp);
    };
    oak(-16, -20, 7); oak(-16, 20, 7); oak(66, -46, 8); oak(92, -66, 7.5); oak(80, -74, 7);
  }

  // the buildings the walker goes round (world-space circles, as the spa towns and the river banks)
  const solids = [];
  for (const dz of [-15, 0, 15]) solids.push({ x: c.x + 10, z: c.z + dz, r: 12 });
  solids.push({ x: c.x - 6, z: c.z - 30, r: 10 }, { x: c.x - 6, z: c.z + 30, r: 10 });
  solids.push({ x: c.x - 20, z: c.z - 78, r: 22 }, { x: c.x + 150, z: c.z + 108, r: 8 }, { x: c.x + 150, z: c.z - 40, r: 10 });
  return { group: g, solids };
}

// a plain of ground whose every vertex is the region's height, tinted by the land. It reaches just past the fog (so the
// edge dissolves into haze as the horizon) and is gridded fine enough (~18 m) to carve the river channel and show the
// land's relief and patches.
function plainMesh(heightAt, towns = [], half = 6000, n = 660) {
  const g = new THREE.PlaneGeometry(half * 2, half * 2, n, n).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const low = new THREE.Color('#5f7a3f'), high = new THREE.Color('#7e9148'), dry = new THREE.Color('#a89a5f'), forest = new THREE.Color('#3c4d2b');
  const rock = new THREE.Color('#6b6155'), snow = new THREE.Color('#eef2f4');
  const sstep = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z); pos.setY(i, y);
    const g = fbm(x / 700 + 3.1, z / 700 - 1.4);                 // grass tone
    const d = fbm(x / 520 + 12.0, z / 520 - 3.0);                // dry field
    const f = fbm(x / 380 - 8.0, z / 380 + 5.2);                 // copse of trees
    const c = low.clone().lerp(high, Math.min(1, Math.max(0, (y + 12) / 16)) * 0.8).lerp(dry, sstep(0.62, 0.84, d)).lerp(forest, FEATURES.copses ? sstep(0.6, 0.8, f) : 0);
    let green = 1; for (const t of towns) green = Math.min(green, smooth(t.park + 40, t.pad, Math.hypot(x - t.x, z - t.z)));   // the spa towns' parks stay green
    c.lerp(rock, smooth(300, 520, y) * green).lerp(snow, smooth(820, 1000, y) * green);   // the Caucasus: rock on the upper slopes, snow on the high ground
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// the water: a ribbon laid along the river's centre line at the water level
function riverMesh(halfW, y) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < RIVER.length; i++) {
    const [x, z] = RIVER[i], prev = RIVER[Math.max(0, i - 1)], next = RIVER[Math.min(RIVER.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const px = -dz, pz = dx;
    pos.push(x + px * halfW, y, z + pz * halfW, x - px * halfW, y, z - pz * halfW);
    uv.push(0, i, 1, i);
  }
  for (let i = 0; i < RIVER.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({ color: 0x4f89a6, specular: 0xaecbe0, shininess: 90, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  return new THREE.Mesh(g, mat);
}

/** Build the region on the island's ground. Returns { group, heightAt, cities, PLAIN_Y, solid } for the scene to add to
 *  `land` and to walk on. base is the site's asset base; cities read assets/cities/<place>/spec.json. */
export async function buildRegion(base, ground, opts = {}) {
  const islandH = ground.heightAt;
  const rimAt = (az) => islandH(Math.sin(az) * REGION.meadowR, -Math.cos(az) * REGION.meadowR);
  let minRim = Infinity; for (let i = 0; i < 96; i++) minRim = Math.min(minRim, rimAt(-Math.PI + 2 * Math.PI * i / 96));
  const PLAIN_Y = minRim - REGION.plainDepth;

  // the two cities at opposite ends, compressed ~75% but 1:1: Moscow ahead (az ~0), Petersburg behind (az ~180).
  // box is each city's building footprint in world metres [x0, z0, x1, z1] (from its boxes.bin): the land lies flat
  // inside it so the 1:1 buildings sit on it, and rolls gently outside.
  const cities = [
    { place: 'moscow', x: 0, z: -1625, turn: 0, box: [-3000, -12400, 3800, -1080] },
    { place: 'spb', x: 0, z: 1150, turn: Math.PI, box: [-2750, 830, 2500, 6150] },
  ];

  // the two spa resorts on the Caucasus foothills to the left, each on a level bench at the height of the land there
  const towns = CAUC.towns.map((t) => {
    const [x, z] = AT(t.az, t.r);
    return { ...t, x, z, pad: t.park + 240, padY: PLAIN_Y + caucHeight(x, z) };
  });

  // Yasnaya Polyana, Tolstoy's estate, on a knoll to the right (west), within the walk
  const [ex2, ez2] = AT(YAS.az, YAS.r);
  const estate = { name: 'Yasnaya Polyana', az: YAS.az, r: YAS.r, park: YAS.park, pad: YAS.pad, x: ex2, z: ez2 };
  estate.padY = PLAIN_Y + yasRise(ex2, ez2);
  const pads = towns.concat([estate]);

  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    if (r <= REGION.meadowR) return islandH(x, z);              // (the island's surface: the grass sits right on it)
    const rim = rimAt(Math.atan2(x, -z));
    const t = smooth(0, 1, (r - REGION.meadowR) / REGION.desc);
    let h = rim + (PLAIN_Y - rim) * t;                          // the slope off the hill to the plain
    // rolling, faded in past the meadow, kept flat under each city's footprint and along the river so those lie flat
    let cityMask = 1;
    for (const c of cities) {
      const [x0, z0, x1, z1] = c.box, m = 260;
      const inx = smooth(x0 - m, x0, x) * (1 - smooth(x1, x1 + m, x));
      const inz = smooth(z0 - m, z0, z) * (1 - smooth(z1, z1 + m, z));
      cityMask = Math.min(cityMask, 1 - inx * inz);
    }
    const rd = distRiver(x, z);
    const riverMask = FEATURES.rivers ? smooth(RIVER_W * 0.6, RIVER_W * 1.6, rd) : 1;
    h += (1 - Math.exp(-(r - REGION.meadowR) / 500)) * (fbm(x / 700, z / 700) - 0.5) * 16 * cityMask * riverMask;
    // the Caucasus to the left: the land rises to Mashuk, Beshtau and the snowy range; the spa towns sit on level benches
    h += caucHeight(x, z) + yasRise(x, z);
    for (const t of pads) { const d = Math.hypot(x - t.x, z - t.z); const m = 1 - smooth(t.pad * 0.6, t.pad, d); if (m > 0) h = h * (1 - m) + t.padY * m; }
    // the river's channel: floor BED below the plain at the centre, back up to the land at the banks (only where the
    // centre line runs, i.e. across the gap; the cities lie beyond its ends, so no channel runs among their buildings)
    const bank = FEATURES.rivers ? 1 - smooth(0, RIVER_W, rd) : 0;
    h = h * (1 - bank) + (PLAIN_Y + BED) * bank;
    return h;
  }

  const group = new THREE.Group();
  group.add(plainMesh(heightAt, pads));
  if (FEATURES.rivers) group.add(riverMesh(RIVER_W * 0.92, PLAIN_Y + WATER_Y));

  const built = [];
  for (const c of cities) {
    const city = await buildCity(base, `assets/cities/${c.place}/spec.json`, { shadows: false, ground: false });
    c.y = heightAt(c.x, c.z);
    city.group.position.set(c.x, c.y + 0.15, c.z);
    city.group.rotation.y = c.turn;
    group.add(city.group);
    built.push({ place: c.place, boxes: city.boxes });
  }

  // the banks: keep the walker out of the water (circles sampled along the channel)
  const solid = [];
  for (let i = 0; FEATURES.rivers && i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1], len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(len / 40));
    for (let s = 0; s < steps; s++) { const t = s / steps; solid.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: RIVER_W * 0.85 }); }
  }

  // the spa resorts on the Caucasus foothills to the left, and the near villas the walker goes round
  for (const t of towns) {
    const town = spaTown(t);
    group.add(town.group);
    for (const s of town.solids) solid.push(s);
  }

  // Yasnaya Polyana: the manor, its park and pond, and Tolstoy's grave; the near buildings the walker goes round
  const est = manorEstate(estate);
  group.add(est.group);
  for (const s of est.solids) solid.push(s);

  return { group, heightAt, cities, towns, estate, PLAIN_Y, built, solid };
}
