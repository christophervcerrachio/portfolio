// The woods of the whole world, near the camera (stage B): wherever the world's cover says forest (cover-a.png, R),
// birches stand, each where the same hash puts it every time, in tiles of 64 m loaded round the camera. Within NEAR m
// each is drawn in full, out to FAR m as its lighter copy; past that the land's own raised crowns stand for them
// (terrain.js canopyH, faded in from 820 m). Uses the hilltop's birch models (countryside.js MODELS), lit and blown
// as theirs are (models.js placeCopies).
import * as THREE from 'three';
import { placeCopies } from '../backdrops/models.js';

// (the full copies out to 220 m, the light ones out to 900 m)
// (the impostors out to 1800 m, and the land's raised crowns only past that: the crowns had sunk between 1000 and 820 m
// in front of the walker, mounds dissolving into the ground; a card a tree costs little)
const TILE = 64, CELL = 6.5;
// (the full copies to NEAR m and the light ones to MID: 220 and 450 on a desktop's graphics card)
let NEAR = 220, MID = 450;
// (a tree's full copy throws its own shadow within SHADE m; from there to NEAR its light copy throws it for it, drawn
// into the sun's pictures alone: a twelfth of the triangles, and at 60 m no eye tells a leaf's shadow from a card's)
let SHADE = 60;
let FAR = 1800;                // (the machine's settings may draw them less far: hardware.js, buildWoods' far)
const CAP = { near: 3000, far: 7000, dist: 26000 };
// THE LADDER. A tree is drawn from one of five copies by how far off it stands, in bands outward from the walker, each
// [to (m), the copy drawn, the copy that throws its shadow (none: no shadow)]:
//   'full'     the close model: every leaf, every twig (48,000 to 125,000 triangles a tree)
//   'mid'      the close model's leaves one in three, each grown to cover what the three did, on the far model's trunk
//              and boughs (15,000 to 29,000): past a dozen metres no eye tells it from the full one
//   'light'    the far model (5,600 to 16,000; a conifer's crown one card in two)
//   'lighter'  the far model, one leaf card in three (2,700 to 9,500)
//   'card'     one picture of the tree, facing the eye (2)
// A desktop's card draws [60 full/full] [220 full/light] [450 light] and cards beyond, as it always has. A laptop cannot:
// measured live on 11 Nov 2026 in a wood, the trees alone were 86 million triangles a frame at 'medium' and 56 million at
// 'low', nearly all of it full copies out to 70 and 120 m and their shadows. Its ladders (hardware.js woods) keep the
// full copy for the trees it walks among and step down sooner: a tenth to a twentieth of the triangles.
// (a band that begins this far off throws its shadow into the sun's far picture alone: the near one reaches 30 m)
const SUN_NEAR = 90;
// (past MID m each tree is drawn from a lighter copy still: one leaf card in three, each half as large again, so the crown
// covers what it did with a third of the leaves; and the light and lighter copies cast no shadow, which only the nearer
// trees' fall inside the sun's pictures anyway: a hundred million triangles a frame had gone to the woods, twice)
// (an attribute's values one vertex after another. A packed model's normals come interleaved, four bytes a vertex for
// three numbers: read three a vertex, every thinned crown's leaves were lit by their neighbours' normals and the
// padding between them, and one pine leaf's came out (0, 0, 0) - no number in its light, nor in the cards drawn from
// it, which the Xbox 360's bloom spread into black squares over the woods, 12 Nov 2026)
function packed(a) {
  if (!a.isInterleavedBufferAttribute) return a.array;
  const D = a.data.array, s = a.data.stride, o = a.offset, k = a.itemSize, out = new D.constructor(a.count * k);
  for (let i = 0; i < a.count; i++) for (let q = 0; q < k; q++) out[i * k + q] = D[i * s + o + q];
  return out;
}

function thinCards(geo, keep = 3, grow = 1.6) {
  const per = geo.userData.leafVerts ?? 4, n = geo.attributes.position.count, cards = Math.floor(n / per);
  const map = new Int32Array(n).fill(-1);
  let m = 0;
  for (let c = 0; c < cards; c += keep) for (let j = 0; j < per; j++) map[c * per + j] = m++;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const k = attr.itemSize, src = packed(attr), dst = new src.constructor(m * k);
    for (let i = 0; i < n; i++) if (map[i] >= 0) for (let q = 0; q < k; q++) dst[map[i] * k + q] = src[i * k + q];
    out.setAttribute(name, new THREE.BufferAttribute(dst, k, attr.normalized));
  }
  // (each kept card grown about its middle)
  const P = out.attributes.position.array;
  for (let c = 0; c < m / per; c++) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < per; j++) { const o = (c * per + j) * 3; cx += P[o]; cy += P[o + 1]; cz += P[o + 2]; }
    cx /= per; cy /= per; cz /= per;
    for (let j = 0; j < per; j++) { const o = (c * per + j) * 3; P[o] = cx + (P[o] - cx) * grow; P[o + 1] = cy + (P[o + 1] - cy) * grow; P[o + 2] = cz + (P[o + 2] - cz) * grow; }
  }
  if (out.attributes.aLeafBase) {
    const B = out.attributes.aLeafBase.array;
    for (let i = 0; i < m; i++) { const b = (i - (i % per)) * 3; B[i * 3] = P[b]; B[i * 3 + 1] = P[b + 1]; B[i * 3 + 2] = P[b + 2]; }
  }
  if (geo.index) {
    const I = geo.index.array, idx = [];
    for (let t = 0; t < I.length; t += 3) if (map[I[t]] >= 0 && map[I[t + 1]] >= 0 && map[I[t + 2]] >= 0) idx.push(map[I[t]], map[I[t + 1]], map[I[t + 2]]);
    out.setIndex(idx);
  }
  out.userData = { ...geo.userData, leafDensity: undefined };
  out.computeBoundingSphere();
  return out;
}

// (a conifer's far parts: its bark clamped to a little above where the crown begins, its leaf cards grown by `grow`)
function crownedFar(parts, grow) {
  const leaves = parts.find((p) => p.kind === 'leaves');
  if (!leaves) return parts;
  leaves.geometry.computeBoundingBox();
  const b = leaves.geometry.boundingBox, cut = b.min.y + (b.max.y - b.min.y) * 0.3;
  return parts.map((p) => {
    if (p.kind === 'leaves') return { ...p, geometry: (p.geometry.userData.grown ??= thinCards(p.geometry, 2, grow)) };
    if (p.kind !== 'bark') return p;
    const g = p.geometry.clone(), P = g.attributes.position.array;
    for (let i = 1; i < P.length; i += 3) if (P[i] > cut) P[i] = cut;
    g.computeBoundingSphere(); g.userData = { ...p.geometry.userData };
    return { ...p, geometry: g };
  });
}

// (an impostor: a card standing up at the tree's root, turned to the camera about the vertical, its picture one of four
// views chosen by the tree's place; darker when the camera looks toward the sun, its lit side away)
const IMPOSTOR_VERT = /* glsl */`
uniform vec2 uSize; uniform float uBase; uniform vec3 uSunDir; uniform float uCols; uniform float uGut; uniform float uTime; uniform vec4 uRise;
varying vec2 vUv; varying float vShade;
void main() {
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float sc = length(instanceMatrix[0].xyz);
  vec3 toCam = cameraPosition - root; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float seed = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float view = floor(seed * uCols);
  vec3 p = root + right * (position.x * uSize.x * sc) + vec3(0.0, (position.y * uSize.y + uBase) * sc, 0.0);
  // (the opening: risen out of the ground with the trees drawn in full - wind-glsl.js riseAt, the same sum)
  if (uRise.w > 0.0) {
    float r = clamp(((uTime - uRise.z) * uRise.w - length(root.xz - uRise.xy) + seed * 30.0) / (uRise.w * 1.25), 0.0, 1.0);
    p.y -= pow(1.0 - r, 3.2) * (uSize.y * sc * 1.05 + 0.6);
  }
  // (each view drawn inside its column with an empty margin either side: uGut, a share of the column)
  vUv = vec2((view + uGut + (position.x + 0.5) * (1.0 - 2.0 * uGut)) / uCols, position.y);
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  vShade = mix(0.5, 1.0, dot(toCam, sunH) * 0.5 + 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const IMPOSTOR_FRAG = /* glsl */`
uniform sampler2D uTex; uniform float uMaxLod;
varying vec2 vUv; varying float vShade;
void main() {
  // (alpha lifted on the small mip levels, as the leaf cards': a far crown keeps its fill; and no level so small that a
  // pixel of it reaches past the margin into the next view's picture: that had drawn a far tree with a straight edge
  // down one side, half a crown)
  vec2 ts = vec2(textureSize(uTex, 0)); vec2 dx = dFdx(vUv * ts), dy = dFdy(vUv * ts);
  float mipL = min(max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)))), uMaxLod);
  vec4 c = textureLod(uTex, vUv, mipL);
  float a = c.a * (1.0 + mipL * 0.35);
  if (a < 0.5) discard;
  gl_FragColor = vec4(c.rgb / max(c.a, 1e-3) * vShade, 1.0);
}`;

const fract = (v) => v - Math.floor(v);
const hash = (x, y, s) => fract(Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453);
const sstep = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** world: loadWorld()'s; models: { 'birch-0': model, ... } (countryside.js). Returns a group with
 *  userData.update(cameraPos, camera) and userData.solidNear(x, z) (the trunks the walker goes round). */
export function buildWoods(world, models, U, { far, near, mid, ladder } = {}) {
  if (far) FAR = far;
  if (near) NEAR = near;
  if (mid) MID = Math.max(mid, NEAR + 20);
  SHADE = Math.min(SHADE, NEAR);
  // (the machine's own ladder, its cards beyond out to FAR; or the desktop's, from NEAR and MID)
  const BANDS = [...(ladder ?? [[SHADE, 'full', 'full'], [NEAR, 'full', 'light'], [MID, 'light']]), [FAR, 'card']]
    .map(([to, draw, cast]) => ({ to: Math.min(to, FAR), draw, cast: cast ?? null })).filter((b, i, a) => b.to > (i ? a[i - 1].to : 0));
  const NB = BANDS.length;
  BANDS.forEach((b, i) => {
    b.from = i ? BANDS[i - 1].to : 0; b.self = b.cast === b.draw;
    // (as many as could ever stand in it: the thickest wood is a tree to 85 in 100 of its 6.5 m squares, all the way
    // round; and the few hundred a city's park can add)
    const type = b.draw === 'card' ? CAP.dist : b.draw === 'full' || b.draw === 'mid' ? CAP.near : CAP.far;
    b.cap = Math.min(type, Math.ceil(1.15 * Math.PI * (b.to * b.to - b.from * b.from) / (CELL * CELL)) + 300);
  });
  const group = new THREE.Group();
  group.name = 'woods';
  const kinds = ['birch-0', 'birch-1', 'birch-2', 'birch-young-0', 'spruce-0', 'pine-0', 'oak-0'].filter((k) => models[k]);
  const birches = kinds.filter((k) => /^birch-\d/.test(k));
  if (!kinds.length) { group.userData.update = () => {}; group.userData.solidNear = () => []; return group; }
  const tiles = new Map();
  const tileTrees = (ti, tj) => {
    const key = ti + ',' + tj;
    let t = tiles.get(key);
    if (t) return t;
    t = [];
    const n = TILE / CELL;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gx = ti * n + i, gz = tj * n + j;
      const x = (gx + 0.15 + 0.7 * hash(gx, gz, 1)) * CELL, z = (gz + 0.15 + 0.7 * hash(gx, gz, 2)) * CELL;
      const f = sstep(0.3, 0.75, world.forestAt(x, z));
      if (f <= 0 || hash(gx, gz, 3) > f * 0.85) continue;
      if (Math.hypot(x, z) < 160 || world.roadAt(x, z) > 0.2 || world.waterAt(x, z) !== null) continue;
      // (none in a town, nor within 12 m of one: the houses stand there - terrain.js townAt)
      if (world.townAt && Math.max(world.townAt(x, z), world.townAt(x + 12, z), world.townAt(x - 12, z), world.townAt(x, z + 12), world.townAt(x, z - 12)) > 0.25) continue;
      if (world.ways && world.ways.near(x, z) < 1.2) continue;
      if (world.clearAt?.(x, z)) continue;                                  // (none in a building or the village street: pois.js)              // (none on a path: it winds between them)
      const edge = f < 0.6;                                 // (the young ones at the wood's edge)
      // the wood's kind by its stand (90 m): dark spruce stands, pine on the drier rises, an oak wood here and there,
      // birch through all of them and on its own (the mixed woods of central Russia, as DayZ's are mixed)
      const stand = hash(Math.floor(x / 90), Math.floor(z / 90), 9), r = hash(gx, gz, 5);
      const sp = stand < 0.32 ? (r < 0.75 ? 'spruce' : 'birch') : stand < 0.46 ? (r < 0.7 ? 'pine' : 'birch')
        : stand < 0.56 ? (r < 0.55 ? 'oak' : 'birch') : (r < 0.1 ? 'spruce' : 'birch');
      let kind = sp !== 'birch' && models[sp + '-0'] ? sp + '-0' : birches[Math.floor(hash(gx, gz, 10) * birches.length)];
      if (kind.startsWith('birch') && edge && hash(gx, gz, 4) < 0.5 && models['birch-young-0']) kind = 'birch-young-0';
      const H0 = { 'spruce-0': [16, 12], 'pine-0': [15, 9], 'oak-0': [11, 7] }[kind] ?? (edge ? [9, 8] : [15, 8]);
      const m = models[kind], h = H0[0] + H0[1] * hash(gx, gz, 6);
      // (early autumn, Pushkin's "golden" one: about two in five birches already turning, in drifts)
      const gold = kind.startsWith('birch') && hash(gx, gz, 8) < 0.25 + 0.45 * sstep(0.35, 0.75, fract(Math.sin(Math.floor(x / 90) * 12.9 + Math.floor(z / 90) * 78.2) * 437.5));
      const tree = { x, z, y: world.heightAt(x, z) - 0.1, yaw: hash(gx, gz, 7) * Math.PI * 2, scale: h / m.height, h, kind: gold ? kind + '|gold' : kind };
      // (its placing worked out once, here, and copied as it is into every part's list after)
      tree.m = new Float32Array(16);
      new THREE.Matrix4().compose(new THREE.Vector3(x, tree.y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.yaw),
        new THREE.Vector3(tree.scale, tree.scale, tree.scale)).toArray(tree.m);
      t.push(tree);
    }
    tiles.set(key, t);
    if (tiles.size > 4200) for (const k of tiles.keys()) { tiles.delete(k); if (tiles.size < 3600) break; }
    return t;
  };
  // (the trees that stand in a box of the land, as they are planted - for the audits, which measure every building
  // against the trees round it: dev\world\tools\world_dump.mjs)
  group.userData.treesIn = (x0, z0, x1, z1) => {
    const out = [];
    for (let tj = Math.floor(z0 / TILE); tj <= Math.floor(z1 / TILE); tj++) for (let ti = Math.floor(x0 / TILE); ti <= Math.floor(x1 / TILE); ti++)
      for (const t of tileTrees(ti, tj)) if (t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1) out.push({ x: t.x, y: t.y, z: t.z, h: t.h, scale: t.scale, kind: t.kind });
    return out;
  };
  // The cities' own trees (their yards', gardens' and parks': cityprops.js), drawn with the woods': the same full copy
  // near, light copy further, card far off, only those toward the view. They had each been drawn in full out to 700 m,
  // all round and into both of the sun's pictures: 40 to 120 million triangles a frame in a city (10 Nov 2026).
  const extra = new Map();                             // 'ti,tj' -> [tree]
  group.userData.addTrees = (items) => {
    const M4 = new THREE.Matrix4(), P3 = new THREE.Vector3(), Q4 = new THREE.Quaternion(), S3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    let n = 0, near = false;
    for (const it of items) {
      const kind = models[it.kind] ? it.kind : null;
      if (!kind || !kinds.includes(kind)) continue;
      const scale = it.scale ?? 1, tree = { x: it.x, z: it.z, y: it.y, yaw: it.yaw ?? 0, scale, h: models[kind].height * scale, kind };
      tree.m = new Float32Array(16);
      M4.compose(P3.set(tree.x, tree.y, tree.z), Q4.setFromAxisAngle(UP, tree.yaw), S3.set(scale, scale, scale)).toArray(tree.m);
      const key = Math.floor(tree.x / TILE) + ',' + Math.floor(tree.z / TILE);
      let l = extra.get(key); if (!l) extra.set(key, (l = []));
      l.push(tree); n++;
      if (last && Math.hypot(tree.x - last.x, tree.z - last.z) < FAR + TILE) near = true;
    }
    // (the lists made again at the next update - only if any of them stands within the trees' reach of the walker:
    // a city's trees come in a few thousand at a time, kilometres off, and each refill is the whole wood round him)
    if (near || !last) last = null;
    return n;
  };
  const sets = {}, TONES = { '': [1, 1, 1], gold: [1.75, 1.1, 0.18] };
  const allKinds = kinds.flatMap((k) => (k.startsWith('birch') ? [k, k + '|gold'] : [k]));
  const blanks = (n) => Array.from({ length: n }, () => ({ x: 0, y: -1e5, z: 0 }));
  for (const kk of allKinds) {
    const [k, tone = ''] = kk.split('|'), m = models[k], look = { leafGain: TONES[tone] };
    // (a pine's or spruce's light copies: the trunk stopped inside the crown and the crown's cards grown, so far off it
    // reads as a crown on a trunk, not a bare orange pole through the canopy; seen 8 Nov 2026 past the spawn)
    const conifer = /^(pine|spruce)/.test(k), farParts = m.far ?? m.near;
    // (one card in two, each grown 1.6x, for the conifers' 220-450 m copies; one in six past 450 m: their crowns of
    // 13,000 to 40,000 leaf corners each had made up most of the 86 million triangles a frame at the spawn)
    const farM = conifer ? { ...m, far: crownedFar(farParts, 1.6) } : m;
    const lighter = { ...m, far: (conifer ? farM.far : farParts).map((p) => (p.kind === 'leaves' ? { ...p, geometry: (p.geometry.userData.thin ??= thinCards(p.geometry)) } : p)) };
    // (the mid copy: the close leaves one in three, each grown by the root of three so the crown is as full as it was,
    // on the far copy's trunk and boughs - a birch's close bark alone is 24,000 triangles, its far bark 1,200)
    const midM = m.near && m.far ? { ...m, near: [...m.far.filter((p) => p.kind !== 'leaves'),
      ...m.near.filter((p) => p.kind === 'leaves').map((p) => ({ ...p, geometry: (p.geometry.userData.mid ??= thinCards(p.geometry, 3, Math.sqrt(3))) }))] } : m;
    const COPY = { full: [m, m.near ? 'near' : 'far'], mid: [midM, m.near ? 'near' : 'far'], light: [farM, farM.far ? 'far' : 'near'], lighter: [lighter, 'far'], card: [lighter, 'far'] };
    sets[kk] = BANDS.map((b) => {
      const [dm, dw] = COPY[b.draw], items = blanks(b.cap);
      // (the copies drawn: throwing their own shadow, or leaving it to the lighter copies drawn into the sun's pictures
      // alone, or throwing none)
      const draw = placeCopies(dm, dw, items, U, { bough: 1.0, look, shadow: b.self });
      draw.name = kk + '.' + b.draw + '-' + b.to;
      if (!b.self) for (const mesh of draw.children) mesh.userData.noCast = true;
      if (b.draw === 'mid') for (const mesh of draw.children) mesh.name = mesh.name.replace('.near.', '.mid.');
      // (far off, a leaf card's picture is shrunk until its alpha averages under the cut and the crown goes bare:
      // a lower cut for the light copies keeps their leaves)
      if (b.draw !== 'full' && b.draw !== 'mid') for (const mesh of draw.children) if (/leaves/.test(mesh.name)) { mesh.material.alphaTest = 0.12; mesh.material.needsUpdate = true; }
      // (a tone of its own program: three builds one program per cache key and its uniforms only once, so the gold copies
      // would otherwise be drawn with the green copies' leaf gain)
      if (tone) for (const mesh of draw.children) {
        const base = mesh.material.customProgramCacheKey?.() ?? '';
        mesh.material.customProgramCacheKey = () => base + '-' + tone;
      }
      let cast = null;
      if (b.cast && !b.self) {
        const [cm, cw] = COPY[b.cast];
        cast = placeCopies(cm, cw, items, U, { bough: 1.0, castOnly: true });
        cast.name = kk + '.' + b.cast + '-' + b.to + '.sun';
        // (too far off to shade the ground round the walker: the far picture alone - sunshadow.js noCastNear)
        if (b.from >= SUN_NEAR) for (const mesh of cast.children) { mesh.layers.set(2); mesh.userData.noCastNear = true; }
      }
      group.add(draw); if (cast) group.add(cast);
      return { draw, cast };
    });
  }
  // (Refilled when the walker has gone 4 m or the view has turned well away from where it last looked. It had refilled
  // on every frame the view turned at all - every frame the mouse moved - placing each tree once for each part of its
  // model, up to 900 m round: 200 ms at a time.)
  const fill = (g, list, cap, more) => {
    const n0 = Math.min(cap, list.length), n = more ? Math.min(cap, n0 + more.length) : n0;
    g.children.forEach((mesh) => {
      const A = mesh.instanceMatrix.array;
      for (let i = 0; i < n0; i++) A.set(list[i].m, i * 16);
      for (let i = n0; i < n; i++) A.set(more[i - n0].m, i * 16);
      mesh.count = n; mesh.visible = n > 0;
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges?.(); im.addUpdateRange?.(0, Math.max(1, n) * 16); im.needsUpdate = true;
    });
  };
  // (two lists a band: the trees toward the view, drawn; and those close behind it, which are not seen but whose shadows
  // fall forward into it - only their shadow copies drawn, where the band has them)
  const lists = {}, behind = {};
  for (const k of allKinds) { lists[k] = BANDS.map(() => []); behind[k] = BANDS.map(() => []); }
  const fwd = new THREE.Vector3();
  let last = null, nearList = [];
  const SLACK = 0.6, CLOSE = 30;                       // (radians beyond the view's sides; trees this near always drawn)
  group.userData.update = (pos, cam) => {
    let yaw = 0, half = Math.PI;
    if (cam) {
      cam.getWorldDirection(fwd); yaw = Math.atan2(fwd.x, -fwd.z);
      // (the view's half width from its own projection: the scene sets it directly, not by fov and aspect)
      const e = cam.projectionMatrix.elements, off = Math.abs(e[8]);
      half = Math.atan((1 + off) / Math.abs(e[0])) + Math.abs(fwd.y) * 0.8;   // (looking down: more of the ground round)
    }
    const wrapA = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
    const moved = !last || Math.hypot(pos.x - last.x, pos.z - last.z) > 4 || Math.abs(wrapA(yaw - last.yaw)) > SLACK * 0.5 || half > last.half + 0.05;
    if (!moved) return;
    last = { x: pos.x, z: pos.z, yaw, half };
    const wide = half + SLACK;
    for (const k of allKinds) for (let i = 0; i < NB; i++) { lists[k][i].length = 0; behind[k][i].length = 0; }
    nearList = [];
    const r = Math.ceil(FAR / TILE), ci = Math.floor(pos.x / TILE), cj = Math.floor(pos.z / TILE);
    for (let tj = cj - r; tj <= cj + r; tj++) for (let ti = ci - r; ti <= ci + r; ti++) {
      const dx = Math.max(0, Math.abs((ti + 0.5) * TILE - pos.x) - TILE / 2), dz = Math.max(0, Math.abs((tj + 0.5) * TILE - pos.z) - TILE / 2);
      if (Math.hypot(dx, dz) > FAR) continue;
      // (a whole tile out of the view's wedge, by the angle its corners span)
      const tcx = (ti + 0.5) * TILE - pos.x, tcz = (tj + 0.5) * TILE - pos.z, td = Math.hypot(tcx, tcz);
      if (cam && td > TILE && Math.abs(wrapA(Math.atan2(tcx, -tcz) - yaw)) > wide + Math.asin(Math.min(1, TILE * 0.75 / td))) continue;
      const own = tileTrees(ti, tj), more = extra.get(ti + ',' + tj);
      for (let q = 0, nq = own.length + (more ? more.length : 0); q < nq; q++) {
        const t = q < own.length ? own[q] : more[q - own.length];
        const ex = t.x - pos.x, ez = t.z - pos.z, d = Math.hypot(ex, ez);
        if (d > FAR) continue;
        if (d < 25) nearList.push(t);
        const off = cam && Math.abs(wrapA(Math.atan2(ex, -ez) - yaw)) > wide + Math.atan(t.h / d);
        if (off && d > CLOSE) continue;
        let b = 0;
        while (b < NB - 1 && d >= BANDS[b].to) b++;
        // (out of the view but close: drawn all the same where its own copy throws its shadow; else its shadow copy only)
        if (off && !BANDS[b].self) { if (BANDS[b].cast) behind[t.kind][b].push(t); } else lists[t.kind][b].push(t);
      }
    }
    for (const k of allKinds) for (let b = 0; b < NB; b++) {
      const s = sets[k][b];
      fill(s.draw, lists[k][b], BANDS[b].cap);
      if (s.cast) fill(s.cast, lists[k][b], BANDS[b].cap, behind[k][b]);
    }
  };
  // ---- the far trees as pictures (impostors): past MID m each tree is one card facing the camera, its picture drawn once
  // from the tree's own light copy, four ways round. The light copies there had been some 35 million triangles a frame,
  // most of the woods' cost (measured 8 Nov 2026 at the spawn: the woods 8-12 ms of a frame, vertex bound).
  group.userData.bake = (renderer, lights, fog = null) => {
    const COLS = 4, CW = 256, CH = 384, GUT = 32;   // (GUT px empty either side of each view: up to mip 4 none bleeds)
    const scene = new THREE.Scene();
    // (the land's own haze set here too - at these few metres it changes no pixel: with it the trees are drawn by the
    // very programs the land draws them with, made already; without, each kind's were made again here, for this
    // picture alone, while the first frame waited)
    scene.fog = fog;
    for (const l of lights) { const c = l.clone(); scene.add(c); if (c.isDirectionalLight) { c.position.set(-0.45, 0.6, 1).multiplyScalar(100); c.target.position.set(0, 0, 0); scene.add(c.target); } }
    const prevRT = renderer.getRenderTarget(), prevVP = new THREE.Vector4(), prevSc = new THREE.Vector4(), scOn = renderer.getScissorTest();
    renderer.getViewport(prevVP); renderer.getScissor(prevSc);
    const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), auto = renderer.autoClear;
    for (const kk of allKinds) {
      const [k, tone = ''] = kk.split('|'), m = models[k], look = { leafGain: TONES[tone] };
      const conifer = /^(pine|spruce)/.test(k), farParts = m.far ?? m.near;
      const src = { ...m, far: conifer ? crownedFar(farParts, 1.6) : farParts };
      // (the model's extent, from its far parts)
      const box = new THREE.Box3();
      for (const p of src.far) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
      const hw = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z) * 1.02, h0 = box.min.y, h1 = box.max.y;
      const Y = -2600;                             // (out of every shadow picture's reach: lit in the open)
      const cam = new THREE.OrthographicCamera(-hw, hw, h1 - h0, 0, 0.1, hw * 4);
      cam.updateProjectionMatrix();
      cam.position.set(0, Y + h0, hw * 2); cam.lookAt(0, Y + h0, 0); cam.updateMatrixWorld(true);
      // (its own picture, mipmapped as it is drawn: three makes the levels after each draw into it)
      const rt = new THREE.WebGLRenderTarget(CW * COLS, CH, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: true });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
      renderer.setScissorTest(true);
      for (let v = 0; v < COLS; v++) {
        const g = placeCopies(src, 'far', [{ x: 0, y: Y, z: 0, yaw: v * Math.PI / 2, scale: 1 }], U, { bough: 0, sway: 0, look });
        scene.add(g);
        renderer.setScissor(v * CW, 0, CW, CH); renderer.setViewport(v * CW, 0, CW, CH); renderer.clear();
        renderer.setViewport(v * CW + GUT, 0, CW - 2 * GUT, CH); renderer.render(scene, cam);
        scene.remove(g); g.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); });
      }
      renderer.setScissorTest(false);
      const tex = rt.texture;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: tex }, uSize: { value: new THREE.Vector2(hw * 2, h1 - h0) }, uBase: { value: h0 }, uSunDir: U.uSunDir, uCols: { value: COLS }, uTime: U.uTime, uRise: U.uRise,
          uGut: { value: GUT / CW }, uMaxLod: { value: Math.log2(GUT) - 1 } },
        vertexShader: IMPOSTOR_VERT, fragmentShader: IMPOSTOR_FRAG, side: THREE.DoubleSide,
      });
      const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      BANDS.forEach((b, i) => {
        if (b.draw !== 'card') return;
        const mesh = new THREE.InstancedMesh(quad, mat, b.cap);
        mesh.count = 0; mesh.frustumCulled = false; mesh.name = kk + '.impostor'; mesh.userData.noCast = true;
        const dist = sets[kk][i].draw;
        for (const c of [...dist.children]) { dist.remove(c); c.dispose?.(); }
        dist.add(mesh);
      });
    }
    renderer.setRenderTarget(prevRT); renderer.setViewport(prevVP); renderer.setScissor(prevSc); renderer.setScissorTest(scOn);
    renderer.setClearColor(prevClear, prevA); renderer.autoClear = auto;
    last = null;                                   // (refill at once, into the pictures)
  };
  group.userData.solidNear = () => nearList.map((t) => ({ x: t.x, z: t.z, r: (t.kind.startsWith('oak') ? 0.5 : 0.18) + t.h * 0.01 }));
  return group;
}
