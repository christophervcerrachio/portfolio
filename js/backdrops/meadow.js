// The hilltop meadow in 3D: the ground, every blade of grass (grass.js), every flower (flowers.js), each moved by the
// wind on the GPU (wind-glsl.js) and lit by a sun that comes and goes with the clouds. The visitor walks the hilltop
// now, so the meadow is laid out all the way round and follows the camera: the grass is grown round wherever it stands
// (dense and fine close by, thinner and wider further off); the flowers stand where they grow, in drifts and streaks
// along the hillside with a few strays between, each drawn in full near the camera and as its lighter copy further off,
// and only those toward the view (with room either side, so a turn never finds a gap). Dirt paths cross it (paths.js):
// no grass or flowers on them, their bare earth and ruts in the ground.
import * as THREE from 'three';
import { WIND_GLSL } from './wind-glsl.js';
import { buildSpecies, seeded } from './flowers.js';
import { pathAt, pathTexture, PATH_SPAN } from './paths.js';
import { gravelTexture, GRAVEL_TILE, GRAVEL_DEPTH, GRAVEL_GLSL } from './gravel.js';
const FLOWERS = 1.5;                // (the meadows' flowers, against the grass: raised 8 Nov 2026)
import { buildGrass, hillTexture } from './grass.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// how many flowers in all, and where they grow thickest: as thick out to 10 m from the hilltop's middle (where the
// visitor walks), thinning beyond
const TIERS = { high: 24000, low: 10500 };   // (x1.5 on 8 Nov 2026)
const thickAt = (r) => (r <= 10 ? 1 : (10 / r) ** 1.8);
// each species' share, how near the painter's spot it may grow (m: the tall ones keep out of the first view's
// foreground), and its streaks: how long their drifts run along the hillside (m), and how wide
const MIX = [
  { name: 'daisy', share: 1400, near: 1.3, streak: [7, 1.3] },
  { name: 'cornflower', share: 520, near: 1.4, streak: [5, 1.0] },
  { name: 'buttercup', share: 700, near: 1.3, streak: [8, 1.6] },
  { name: 'clover', share: 400, near: 1.5, streak: [3, 1.2] },
  { name: 'bellflower', share: 300, near: 1.5, streak: [4, 0.9] },
  { name: 'lupine', share: 170, near: 2.6, streak: [3, 1.4] },
  { name: 'fireweed', share: 90, near: 3.0, streak: [2.5, 1.5] },
];
const SHORTER = 0.68;            // the flowers stand this much of their full height (a meadow's, not a garden's)
const NEAR = [7.0, 8.0];         // drawn in full nearer than this to the camera (and back to the light copy past the next)
// which are drawn: those toward the view, out to SLACK (radians) past either side of it, chosen again each time the
// view turns TURN from where they were chosen (less than SLACK: whatever comes into view is there already); and all
// round within CLOSE (m) of the camera
const SLACK = 0.3, TURN = 0.12, CLOSE = 2.5;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

const GROUND_VERT = /* glsl */`
${WIND_GLSL}
varying vec3 vN; varying float vDist; varying vec2 vXZ; varying float vSun; varying vec3 vW;
void main() {
  vN = normal; vXZ = position.xz; vSun = sunThrough(position); vW = position;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const GROUND_FRAG = /* glsl */`
${WIND_GLSL}
uniform vec3 uSoil; uniform vec3 uMoss; uniform vec3 uDirt; uniform vec3 uDirtDark; uniform vec3 uStone; uniform sampler2D uPath; uniform float uPathSpan;
varying vec3 vN; varying float vDist; varying vec2 vXZ; varying float vSun; varying vec3 vW;
${GRAVEL_GLSL}
void main() {
  float n = vnoise(vXZ * 1.7) * 0.6 + vnoise(vXZ * 6.0) * 0.4;
  vec3 c = mix(uSoil, uMoss, n);
  vec3 pr = texture2D(uPath, vXZ / uPathSpan + 0.5).rgb;
  vec3 nrm = normalize(vN);
  float ao = 0.55, sunVis = 1.0;
  vec2 dx = dFdx(vXZ), dy = dFdy(vXZ);
  if (pr.r > 0.0) {
    // the paths: bare earth and gravel, with depth (gravel.js). (The fan's own normals face down: under the grass,
    // where it only ever showed in the gaps, that was its look; the paths are lit as the ground faces, up.)
    nrm = normalize(mix(nrm, nrm.y < 0.0 ? -nrm : nrm, pr.r));
    vec4 look = pathLook(vXZ, pr, dx, dy, normalize(cameraPosition - vW), vSun, nrm, sunVis);
    c = mix(c, look.rgb, pr.r);
    ao = mix(ao, look.a, pr.r);
  }
  gl_FragColor = vec4(hazed(lightUp(c, nrm, ao, 0.0, vSun * treeShade(vW + uSunDir * 0.05) * sunVis), vDist), 1.0);
}`;

const FLOWER_VERT = /* glsl */`
${WIND_GLSL}
attribute vec3 color; attribute float tint; attribute float bend;
attribute vec4 aRoot;     // x, y, z, yaw
attribute vec4 aShape;    // height, seed, give (how far the wind takes it), unused
attribute vec3 aTint;     // its petal colour
varying vec3 vN; varying vec3 vCol; varying float vThin; varying float vAo; varying float vDist; varying float vSun;
void main() {
  float c = cos(aRoot.w), s = sin(aRoot.w), H = aShape.x;
  vec3 p = position * H;
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vN = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  // (no flicker: a head farther than a dozen metres is a pixel or less, and a pixel-sized bright petal winks in and out
  // as the view moves. Far off each head is drawn wider, at least about a pixel and a half across, and its colour as
  // much softer as it is wider, so a field keeps its colour as a steady wash and no single flower sparkles)
  float dist0 = -(viewMatrix * vec4(aRoot.xyz, 1.0)).z;
  float px = max(dist0, 0.1) * 2.0 / (projectionMatrix[1][1] * 1100.0);   // (metres a pixel spans there)
  float head = max(H * 0.07, 0.01), grow = clamp(1.5 * px / head, 1.0, 6.0) * tint + (1.0 - tint);
  p.xz *= mix(1.0, grow, smoothstep(0.55, 0.9, bend));      // (before the wind: the head grows, not its sway)
  vec3 w = windAt(aRoot.xyz, aShape.y);
  float k = bend * bend * aShape.z;
  p.xz += w.xy * (H * k);
  p.y -= dot(w.xy, w.xy) * H * k * 0.4;
  float soft = 1.0 / mix(1.0, grow * grow, tint);
  vCol = mix(color, color * aTint, tint * mix(0.35, 1.0, soft));
  vCol *= mix(1.0, 0.85, (1.0 - soft) * tint);
  vThin = 0.35 + 0.5 * tint;
  vAo = mix(0.4, 1.0, smoothstep(0.0, 0.55, bend));
  vSun = sunThrough(aRoot.xyz) * treeShade4(aRoot.xyz + p + uSunDir * 0.08);
  vec4 mv = viewMatrix * vec4(aRoot.xyz + p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FLOWER_FRAG = /* glsl */`
${WIND_GLSL}
varying vec3 vN; varying vec3 vCol; varying float vThin; varying float vAo; varying float vDist; varying float vSun;
void main() {
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  gl_FragColor = vec4(hazed(lightUp(vCol, n, vAo, vThin, vSun), vDist), 1.0);
}`;

/** Instanced copies of `geo`, room for `count`, with the given per-copy attributes ({ name: itemSize }), none shown yet. */
function instanced(geo, attrs, count, material) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index;
  for (const [k, v] of Object.entries(geo.attributes)) g.setAttribute(k, v);
  for (const [k, size] of Object.entries(attrs)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(k, a);
  }
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

/** A radius drawn so that, over the ground, things fall `density(r)` thick (by the area of each ring). */
function radiusSampler(r0, r1, density) {
  const N = 800, cdf = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) { const r = r0 + (r1 - r0) * (k - 0.5) / N; cdf[k] = cdf[k - 1] + density(r) * r; }
  for (let k = 1; k <= N; k++) cdf[k] /= cdf[N];
  return (x) => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid; else hi = mid; }
    const f = (x - cdf[lo]) / Math.max(1e-9, cdf[hi] - cdf[lo]);
    return r0 + (r1 - r0) * (lo + f) / N;
  };
}

/**
 * The meadow on `ground` (countryside.js: heightAt(x, z), browR(phi), meadowR(phi) how far out it grows, patch(x, z) a
 * soft noise), lit and blown by the shared uniforms U. Its userData.update(camera position, view, zoom) moves the grass
 * with the camera and draws each flower in full or light by how near it is (view: the directions in sight, see grass.js).
 */
export function buildMeadow(ground, U, { tier = 'high', seed = 7, world, grass: grassOpt, flowers: flowerOpt } = {}) {
  const group = new THREE.Group(), rng = seeded(seed);
  const at = (phi, r) => { const x = r * Math.sin(phi), z = -r * Math.cos(phi); return [x, ground.heightAt(x, z), z]; };

  // ---- the ground: a fan of rings round the hilltop's middle, out past the brow all the way round
  const groundMat = new THREE.ShaderMaterial({ uniforms: { ...U, uSoil: { value: lin('#5d7226') }, uMoss: { value: lin('#90a843') },
    uDirt: { value: lin('#eedcbc') }, uDirtDark: { value: lin('#b39673') }, uStone: { value: lin('#e2d8c4') }, uPath: { value: pathTexture() }, uPathSpan: { value: PATH_SPAN },
    uGravel: { value: gravelTexture(tier === 'high' ? 1024 : 512) }, uGrTile: { value: GRAVEL_TILE }, uGrDepth: { value: GRAVEL_DEPTH } },
    defines: { POM_STEPS: tier === 'high' ? 32 : 10 },
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, side: THREE.DoubleSide });
  {
    const nA = tier === 'high' ? 480 : 300, nR = tier === 'high' ? 110 : 80, pos = [], idx = [];
    for (let i = 0; i <= nA; i++) {
      const phi = -Math.PI + (2 * Math.PI * i) / nA, R = ground.browR(phi) * 1.5;
      for (let j = 0; j <= nR; j++) pos.push(...at(phi, R * (j / nR) ** 1.5));
    }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nR; j++) {
      const a = i * (nR + 1) + j, b = a + nR + 1;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, groundMat);
    m.frustumCulled = false; m.name = 'ground';
    if (world) m.visible = false;           // (the world's land draws the hilltop's ground now, its ways with it: terrain.js)
    group.add(m);
  }

  // ---- the grass, round the camera
  const hill = hillTexture(ground);
  // (a machine's own meadow - hardware.js TIERS: grass { per, reach, rows, wide } or null: none, the ground painted;
  // flowers { reach, far, near, thin }. Neither given: the full look's.)
  let grass;
  if (grassOpt === null) { grass = new THREE.Group(); grass.name = 'grass'; grass.userData = { blades: 0, update: () => {} }; }
  else grass = buildGrass(ground, U, { tier, hill, world, opt: grassOpt });
  group.add(grass);
  group.userData.grass = grass.userData.blades;

  // ---- the flowers: each species in its own drifts and streaks, which run along the hillside (round the hilltop),
  // with a few strays between; where each grows is fixed, which copy is drawn (full or light) follows the camera
  const flowerMat = new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: FLOWER_VERT, fragmentShader: FLOWER_FRAG, side: THREE.DoubleSide });
  const reach = Math.max(...Array.from({ length: 64 }, (_, i) => ground.meadowR(-Math.PI + (2 * Math.PI * i) / 64)));
  const total = TIERS[tier] ?? TIERS.high, shares = MIX.reduce((t, m) => t + m.share, 0);
  const sets = [];                                  // per species and look: { items, near mesh, far mesh }
  // (with the world loaded, the flowers grow everywhere the meadow does, streamed round the camera)
  // (none at all - a picture of 240 lines: a flower there is a dark stem one pixel wide and no head, looked at 11 Nov 2026)
  if (flowerOpt === null) { group.userData.update = (p, view) => grass.userData.update(p, view); group.userData.flowers = () => 0; return group; }
  if (world) return worldFlowers(group, grass, ground, world, U, flowerMat, tier, rng, flowerOpt);
  MIX.forEach((sp, si) => {
    const models = buildSpecies(sp.name, 3, 11 + si);
    const sampleR = radiusSampler(0, reach, thickAt);
    const o1 = rng() * 100, o2 = rng() * 100, o3 = rng() * 100, ang = rng() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    // where this species grows: streaks (long one way, narrow the other, gently wandering) and pockets
    const field = (x, z) => {
      const wx = x + 3 * (ground.patch(x / 5 + o3, z / 5 - o2) - 0.5), wz = z + 3 * (ground.patch(x / 5 - o1, z / 5 + o3) - 0.5);
      const streak = ground.patch((wx * ca + wz * sa) / sp.streak[0] + o1, (-wx * sa + wz * ca) / sp.streak[1] + o2);
      const pocket = ground.patch(x / 2.2 + o3, z / 2.2 - o1);
      return Math.max(streak, pocket * 0.9);
    };
    const n = Math.round((total * sp.share) / shares), strays = Math.round(n * 0.06);
    const looks = [[], [], []];
    let made = 0, tries = 0;
    while (made < n && tries < n * 300) {
      tries++;
      const phi = -Math.PI + 2 * Math.PI * rng(), r = sampleR(rng());
      if (r < sp.near || r > ground.meadowR(phi)) continue;
      const [x, y, z] = at(phi, r);
      const f = field(x, z), keep = Math.pow(Math.min(1, Math.max(0, (f - 0.7) / 0.15)), 1.5);
      if (made >= strays && rng() > keep) continue;                               // (the first few are strays, anywhere)
      if (pathAt(x, z) > 0.15) continue;                                         // (none on the paths)
      const h = rng.range(...models.height) * SHORTER, v = Math.floor(rng() * 3) % 3;
      const t = rng.pick(models.tints), j = rng.range(0.92, 1.08);
      looks[v].push({ x, y, z, yaw: rng() * Math.PI * 2, h, s1: rng(), give: rng.range(0.7, 1.15), tint: [t.r * j, t.g * j, t.b * j], near: false });
      made++;
    }
    looks.forEach((items, v) => {
      if (!items.length) return;
      const attrs = { aRoot: 4, aShape: 4, aTint: 3 };
      const near = instanced(models.near[v], attrs, items.length, flowerMat), far = instanced(models.far[v], attrs, items.length, flowerMat);
      near.name = `${sp.name}-near-${v}`; far.name = `${sp.name}-far-${v}`;
      group.add(near, far);
      sets.push({ items, near, far });
    });
  });
  group.userData.flowers = sets.reduce((t, s) => t + s.items.length, 0);

  // ---- following the camera: the grass every frame; the flowers' copies once it has moved a little
  let last = null;
  const fill = (mesh, list) => {
    const g = mesh.geometry, R = g.attributes.aRoot.array, S = g.attributes.aShape.array, T = g.attributes.aTint.array;
    list.forEach((it, i) => {
      R[i * 4] = it.x; R[i * 4 + 1] = it.y; R[i * 4 + 2] = it.z; R[i * 4 + 3] = it.yaw;
      S[i * 4] = it.h; S[i * 4 + 1] = it.s1; S[i * 4 + 2] = it.give; S[i * 4 + 3] = 0;
      T[i * 3] = it.tint[0]; T[i * 3 + 1] = it.tint[1]; T[i * 3 + 2] = it.tint[2];
    });
    g.instanceCount = list.length;
    for (const a of [g.attributes.aRoot, g.attributes.aShape, g.attributes.aTint]) {
      a.clearUpdateRanges?.(); a.addUpdateRange?.(0, Math.max(1, list.length) * a.itemSize); a.needsUpdate = true;
    }
  };
  group.userData.update = (p, view, zoom = 1) => {
    grass.userData.update(p, view);
    const mid = view ? (view.az0 + view.az1) / 2 : 0, half = view ? (view.az1 - view.az0) / 2 : Math.PI;
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.4 && Math.abs(Math.log(zoom / last.zoom)) < 0.05
      && !view === !last.view && (!view || (Math.abs(wrap(mid - last.mid)) < TURN && Math.abs(half - last.half) < TURN))) return;
    last = { x: p.x, z: p.z, zoom, view: !!view, mid, half };
    // (zoomed in, the full copies reach as much further out)
    const [inR, outR] = capN ? NEAR.map((d) => d * Math.max(1, zoom)) : [0, 0];      // (no full models: every one a light one)
    const wide = half + SLACK;
    for (const S of sets) {
      const near = [], far = [];
      for (const it of S.items) {
        const dx = it.x - p.x, dz = it.z - p.z, d = Math.hypot(dx, dz);
        // (out of view: a flower's own breadth, and the wind's sway, taken as a metre)
        if (view && d > CLOSE && Math.abs(wrap(Math.atan2(dx, -dz) - mid)) > wide + Math.atan(1 / d)) { it.near = false; continue; }
        it.near = d < (it.near ? outR : inR);
        (it.near ? near : far).push(it);
      }
      fill(S.near, near); fill(S.far, far);
    }
  };
  return group;
}

// ---- the wildflowers over the whole world ----
// Each species has its own map of where it grows, at three sizes: whole fields of it (a hillside blue with cornflowers,
// white with camomile), patches a few tens of metres across, and streaks along the slope; with strays everywhere. Only
// on open meadow (not in the woods, the grain, a road, a town, on rock or in water) and never on a way. The world is cut
// into cells; each cell's flowers are fixed (from the cell's own seed), made when the camera comes near and dropped
// when it has gone; the nearest are drawn in full, the rest as their light copies.
const FCELL = 16;
const smf = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function worldFlowers(group, grass, ground, world, U, flowerMat, tier, rng, opt) {
  // (opt: a machine's own - how far round the walker they grow, the most of each kind and shape drawn as light and
  // as full models (near 0: every one a light model), and how many grow of the full look's)
  const R = opt?.reach ?? (tier === 'high' ? 120 : 80), capF = opt?.far ?? (tier === 'high' ? 6000 : 2500), capN = opt?.near ?? (tier === 'high' ? 1200 : 500);
  const THIN = opt?.thin ?? 1;
  const maxShare = Math.max(...MIX.map((m) => m.share));
  const species = MIX.map((sp, si) => {
    const models = buildSpecies(sp.name, 3, 11 + si);
    const o = [rng() * 500, rng() * 500, rng() * 500, rng() * 500], ang = rng() * Math.PI;
    const looks = [0, 1, 2].map((v) => {
      const attrs = { aRoot: 4, aShape: 4, aTint: 3 };
      const near = instanced(models.near[v], attrs, capN, flowerMat), far = instanced(models.far[v], attrs, capF, flowerMat);
      near.name = `${sp.name}-near-${v}`; far.name = `${sp.name}-far-${v}`;
      if (!capN) near.visible = false;
      group.add(near, far);
      return { items: [], near, far };
    });
    const w = 0.3 + 0.7 * sp.share / maxShare, ca = Math.cos(ang), sa = Math.sin(ang);
    const dens = (x, z) => {
      const field = smf(0.6, 0.76, ground.patch(x / 230 + o[0], z / 230 + o[1]));
      const patchy = smf(0.56, 0.74, ground.patch(x / 32 + o[2], z / 32 - o[0]));
      const streak = smf(0.6, 0.8, ground.patch((x * ca + z * sa) / (sp.streak[0] * 5) + o[1], (-x * sa + z * ca) / (sp.streak[1] * 5) + o[3]));
      // (inside a field, the field's own unevenness: thick and thin, never a carpet laid flat)
      const grain = 0.55 + 0.45 * ground.patch(x / 4 + o[3], z / 4 + o[2]);
      // (half as many flowers again, with the grass a third thinner)
      return ((2.2 * field + 0.9 * patchy + 0.5 * streak) * w * grain + 0.03 * w) * FLOWERS * THIN;
    };
    return { sp, models, looks, dens };
  });
  // (Streamed in 16 m cells round the walker. Each cell keeps its flowers packed, one Float32Array for each species and
  // look, PER floats a flower, and a byte each for whether it is drawn in full; nothing is made per flower or per frame,
  // so walking makes no garbage for the browser to stop and clear (it had stopped for up to a third of a second). New
  // cells are worked out a few a frame, nearest first.)
  const PER = 10;                                  // x, y, z, yaw, h, s1, give, r, g, b
  const cells = new Map(), queue = [], BUDGET_MS = 1.5;
  let scratch = new Float32Array(PER * 512);
  const make = (ci, cj) => {
    const r = seeded((((ci * 73856093) ^ (cj * 19349663)) >>> 0) % 2147483646 + 1);
    const cell = { i: ci, j: cj, lists: species.map(() => [null, null, null]), near: species.map(() => [null, null, null]) };
    for (let k = 0; k < 4; k++) r();             // (a small seed's first draws are alike: let them go)
    const x0 = ci * FCELL, z0 = cj * FCELL;
    // (open meadow at the cell's corners and middle: none of it, no flowers, and nothing more to work out)
    let open = 0;
    for (const [a, b] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) open = Math.max(open, world.meadowAt(x0 + a * FCELL, z0 + b * FCELL));
    species.forEach((S, si) => {
      const counts = [0, 0, 0], at = [[], [], []];
      if (open >= 0.05) {
        let dMax = 0;
        for (const [a, b] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) dMax = Math.max(dMax, S.dens(x0 + a * FCELL, z0 + b * FCELL));
        dMax = Math.min(3.0 * FLOWERS * THIN, dMax * 1.25 + 0.02 * THIN);
        const n = Math.round(FCELL * FCELL * dMax);
        if (scratch.length < n * PER) scratch = new Float32Array(n * PER * 2);
        let m = 0;
        const look = new Uint8Array(n);
        for (let k = 0; k < n; k++) {
          const x = x0 + r() * FCELL, z = z0 + r() * FCELL;
          if (r() * dMax > S.dens(x, z)) continue;
          if (r() > world.meadowAt(x, z)) continue;
          if (world.coverAt(x, z) > 0 || world.ways.near(x, z) < 0.7) continue;
          // (their full height and a little more: out in the world the grass stands knee to waist high, and a
          // meadow's flowers hold their heads above it)
          const h = r.range(...S.models.height) * 1.45, v = Math.floor(r() * 3) % 3, t = r.pick(S.models.tints), j = r.range(0.92, 1.08);
          const o = m * PER;
          scratch[o] = x; scratch[o + 1] = ground.heightAt(x, z); scratch[o + 2] = z; scratch[o + 3] = r() * Math.PI * 2;
          scratch[o + 4] = h; scratch[o + 5] = r(); scratch[o + 6] = r.range(0.7, 1.15);
          scratch[o + 7] = t.r * j; scratch[o + 8] = t.g * j; scratch[o + 9] = t.b * j;
          look[m] = v; counts[v]++; m++;
        }
        for (let v = 0; v < 3; v++) at[v] = new Float32Array(counts[v] * PER);
        const fillAt = [0, 0, 0];
        for (let k = 0; k < m; k++) { const v = look[k]; at[v].set(scratch.subarray(k * PER, k * PER + PER), fillAt[v]); fillAt[v] += PER; }
      }
      for (let v = 0; v < 3; v++) { cell.lists[si][v] = at[v] instanceof Float32Array ? at[v] : new Float32Array(0); cell.near[si][v] = new Uint8Array(cell.lists[si][v].length / PER); }
    });
    return cell;
  };
  // the cells in reach, nearest first (rebuilt when the walker has moved 8 m)
  let at = null, active = [];
  const want = (p) => {
    at = { x: p.x, z: p.z };
    const c0 = Math.floor((p.x - R) / FCELL), c1 = Math.floor((p.x + R) / FCELL), r0 = Math.floor((p.z - R) / FCELL), r1 = Math.floor((p.z + R) / FCELL);
    for (const [key, c] of cells) {              // (the cells left well behind are let go)
      if (Math.abs((c.i + 0.5) * FCELL - p.x) > R * 1.6 || Math.abs((c.j + 0.5) * FCELL - p.z) > R * 1.6) cells.delete(key);
    }
    active = []; queue.length = 0;
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
      const cx = (i + 0.5) * FCELL - p.x, cz = (j + 0.5) * FCELL - p.z, d2 = cx * cx + cz * cz;
      if (d2 > (R + FCELL) ** 2) continue;
      const key = i + ',' + j, c = cells.get(key);
      if (c) active.push({ c, d2 }); else queue.push({ i, j, key, d2 });
    }
    active.sort((a, b) => a.d2 - b.d2); queue.sort((a, b) => a.d2 - b.d2);
  };
  // (a few new cells a frame, nearest first, within a time budget; the very nearest at once so nothing pops at the feet)
  const fresh = [];                                // (the cells built this frame: update adds only theirs if nothing else changed)
  const build = () => {
    const t0 = performance.now();
    let built = 0;
    fresh.length = 0;
    while (queue.length && (queue[0].d2 < 40 * 40 || performance.now() - t0 < BUDGET_MS)) {
      const q = queue.shift(), c = make(q.i, q.j);
      cells.set(q.key, c);
      let k = active.length;                       // (into its place by distance)
      active.push({ c, d2: q.d2 });
      while (k > 0 && active[k - 1].d2 > q.d2) { active[k] = active[k - 1]; k--; }
      active[k] = { c, d2: q.d2 };
      fresh.push(c);
      built++;
    }
    return built;
  };
  const setCount = (mesh, n) => {
    const g = mesh.geometry;
    g.instanceCount = n;
    for (const a of [g.attributes.aRoot, g.attributes.aShape, g.attributes.aTint]) {
      a.clearUpdateRanges?.(); a.addUpdateRange?.(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true;
    }
  };
  const addCount = (mesh, n0, n) => {                // (the copies n0..n added: only those sent)
    if (n === n0) return;
    const g = mesh.geometry;
    g.instanceCount = n;
    for (const a of [g.attributes.aRoot, g.attributes.aShape, g.attributes.aTint]) {
      a.clearUpdateRanges?.(); a.addUpdateRange?.(n0 * a.itemSize, (n - n0) * a.itemSize); a.needsUpdate = true;
    }
  };
  const put = (mesh, k, L, o) => {
    const g = mesh.geometry, A = g.attributes.aRoot.array, S = g.attributes.aShape.array, T = g.attributes.aTint.array;
    A[k * 4] = L[o]; A[k * 4 + 1] = L[o + 1]; A[k * 4 + 2] = L[o + 2]; A[k * 4 + 3] = L[o + 3];
    S[k * 4] = L[o + 4]; S[k * 4 + 1] = L[o + 5]; S[k * 4 + 2] = L[o + 6]; S[k * 4 + 3] = 0;
    T[k * 3] = L[o + 7]; T[k * 3 + 1] = L[o + 8]; T[k * 3 + 2] = L[o + 9];
  };
  let last = null;
  group.userData.update = (p, view, zoom = 1) => {
    grass.userData.update(p, view);
    const regather = !at || Math.hypot(p.x - at.x, p.z - at.z) > 8;
    if (regather) want(p);
    const built = queue.length ? build() : 0;
    const mid = view ? (view.az0 + view.az1) / 2 : 0, half = view ? (view.az1 - view.az0) / 2 : Math.PI;
    const still = last && Math.hypot(p.x - last.x, p.z - last.z) < 0.4 && Math.abs(Math.log(zoom / last.zoom)) < 0.05
      && !view === !last.view && (!view || (Math.abs(wrap(mid - last.mid)) < TURN && Math.abs(half - last.half) < TURN));
    if (!regather && !built && still) return;
    const [inR, outR] = capN ? NEAR.map((d) => d * Math.max(1, zoom)) : [0, 0];      // (no full models: every one a light one)
    const wide = half + SLACK;
    // (nothing moved, only new cells came in: their flowers added after the ones drawn already, and only that part of
    // the buffers sent to the card - the same picture as counting all again while under the caps, which every frame of
    // a walk's streaming had done, 7-9 ms a frame; at a cap, all counted again so the nearest keep their places)
    if (!regather && built && still && last.full) {
      let fits = true;
      const adds = [];
      species.forEach((S, si) => S.looks.forEach((Lk, v) => {
        let nN = Lk.nN ?? 0, nF = Lk.nF ?? 0;
        const n0 = nN, f0 = nF;
        for (const c of fresh) {
          const L = c.lists[si][v], NR = c.near[si][v], n = NR.length;
          for (let k = 0; k < n; k++) {
            const o = k * PER, dx = L[o] - p.x, dz = L[o + 2] - p.z, d = Math.hypot(dx, dz);
            if (view && d > CLOSE && Math.abs(wrap(Math.atan2(dx, -dz) - mid)) > wide + Math.atan(1 / d)) { NR[k] = 0; continue; }
            NR[k] = d < (NR[k] ? outR : inR) ? 1 : 0;
            if (NR[k]) { if (nN < capN) put(Lk.near, nN++, L, o); else fits = false; }
            else if (nF < capF) put(Lk.far, nF++, L, o); else fits = false;
          }
        }
        adds.push([Lk, n0, nN, f0, nF]);
      }));
      if (fits) {
        for (const [Lk, n0, nN, f0, nF] of adds) { addCount(Lk.near, n0, nN); addCount(Lk.far, f0, nF); Lk.nN = nN; Lk.nF = nF; }
        return;
      }
    }
    last = { x: p.x, z: p.z, zoom, view: !!view, mid, half, full: true };
    species.forEach((S, si) => S.looks.forEach((Lk, v) => {
      let nN = 0, nF = 0;
      for (const { c } of active) {               // (nearest cells first: past the cap, the farthest go)
        const L = c.lists[si][v], NR = c.near[si][v], n = NR.length;
        for (let k = 0; k < n; k++) {
          const o = k * PER, dx = L[o] - p.x, dz = L[o + 2] - p.z, d = Math.hypot(dx, dz);
          if (view && d > CLOSE && Math.abs(wrap(Math.atan2(dx, -dz) - mid)) > wide + Math.atan(1 / d)) { NR[k] = 0; continue; }
          NR[k] = d < (NR[k] ? outR : inR) ? 1 : 0;
          if (NR[k]) { if (nN < capN) put(Lk.near, nN++, L, o); }
          else if (nF < capF) put(Lk.far, nF++, L, o);
        }
      }
      setCount(Lk.near, nN); setCount(Lk.far, nF);
      Lk.nN = nN; Lk.nF = nF;
    }));
  };
  group.userData.flowers = () => active.reduce((t, { c }) => t + c.lists.reduce((u, ls) => u + ls.reduce((w, L) => w + L.length / PER, 0), 0), 0);
  return group;
}
