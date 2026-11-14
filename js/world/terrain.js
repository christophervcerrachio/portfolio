// The world beyond the hilltop, as one land (stage B of career\tasks\2026-11-08-world-rebuild-plan.md): the height and
// cover pictures dev\world\build_world.py makes from world.layout.json (both cities, the river from Moscow to the Neva,
// the spa region and its mountains, Yasnaya Polyana, the open land between), drawn as a clipmap round the camera:
// rings of one grid, each twice the last's spacing, from 1 m at the feet to 6 km a step at the horizon. Each ring's
// outer cells ease into the next ring's shape (morphing), so there are no seams and nothing pops as the walker moves.
// The rings to 6 km draw with the near world; the rest, out to the main Caucasus range, in a pass of their own before
// it (countryside.js), so the depth buffer has the range it needs both near and far.
import * as THREE from 'three';
import { WAYS_GLSL } from './paths.js';
import { WIND_GLSL } from '../backdrops/wind-glsl.js';

export const CLIP = { n: 96, s0: 1, levels: 13, nearLevels: 8 };   // cells a side, the finest spacing (m), rings, rings drawn near

// ---- the same value noise as the shaders' (wind-glsl.js), for the fine relief the walker stands on ----
const fract = (v) => v - Math.floor(v);
function hash12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), e = hash12(ix + 1, iy + 1);
  return a + (b - a) * fx + (c + (e - c) * fx - a - (b - a) * fx) * fy;
}
// the fine relief over the 8 m picture: hummocks a few tens of cm high, none on water, roads or in a city
const fineCPU = (x, z) => (vnoise(x / 9, z / 9) - 0.5) * 0.45 + (vnoise(x / 23 + 7.1, z / 23 - 3.3) - 0.5) * 0.7;

// (read again, twice at most, if the browser could not decode it: seen once, 11 Nov 2026, on a page opened straight
// after another copy of itself - "The source image could not be decoded", one of the five 3584 px maps, and with it no
// walk at all. A machine short of memory for a moment is a laptop's ordinary state.)
async function pixels(url) {
  for (let k = 0; ; k++) {
    try {
      const blob = await (await fetch(url, k ? { cache: 'reload' } : undefined)).blob();
      return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    } catch (e) {
      if (k >= 2) throw e;
      await new Promise((res) => setTimeout(res, 500 * (k + 1)));
    }
  }
}
function readOpaque(bmp) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height).data;
}
// height.png / far.png: R,G = (h + 100) * 32; B = the water's surface (B / 2 - 20 m), 0 = none
function decode(rgba, n) {
  const h = new Float32Array(n * n), w = new Uint8Array(n * n);
  for (let i = 0, k = 0; i < n * n; i++, k += 4) { h[i] = (rgba[k] * 256 + rgba[k + 1]) / 32 - 100; w[i] = rgba[k + 2]; }
  return { h, w };
}
function bilinear(arr, n, u, v) {
  const x = Math.min(n - 1.001, Math.max(0, u * n - 0.5)), y = Math.min(n - 1.001, Math.max(0, v * n - 0.5));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * n + i;
  const a = arr[k], b = arr[k + 1], c = arr[k + n], d = arr[k + n + 1];
  return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
}
function floatTex(data, n, renderer) {
  const linear = !renderer || renderer.extensions.has('OES_texture_float_linear');
  const t = linear ? new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType)
    : new THREE.DataTexture(Uint16Array.from(data, (v) => THREE.DataUtils.toHalfFloat(v)), n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

/** The world's pictures and the CPU's view of them: heightAt(x, z) (with the hilltop's own shape near the spawn, from
 *  islandAt), waterAt(x, z) (its surface, or null), and the textures and uniforms the land is drawn with. */
export async function loadWorld(base, { renderer, island } = {}) {
  const dir = base + 'assets/world/';
  const json = await (await fetch(dir + 'world.json')).json();
  const [hb, fb, ca, cb, fl] = await Promise.all(['height.png', 'far.png', 'cover-a.png', 'cover-b.png', 'flow.png'].map((f) => pixels(dir + f)));
  const C = json.core, F = json.far;
  const core = decode(readOpaque(hb), C.px);
  const far = decode(readOpaque(fb), F.px);
  // the woods and roads, for placing the near trees (cover-a: R forest, A 1 - road)
  const covA = readOpaque(ca), forest = new Uint8Array(C.px * C.px), road = new Uint8Array(C.px * C.px);
  for (let i = 0, k = 0; i < forest.length; i++, k += 4) { forest[i] = covA[k]; road[i] = 255 - covA[k + 3]; }
  // the world is a circle (world.json circle): the core's detail inside it, the far land past its rim
  const CI = json.circle ?? { x: -2347, z: 882, r: 13900 }, RIM = 400;
  const inCircle = (x, z) => Math.hypot(x - CI.x, z - CI.z) < CI.r;
  const texel = (arr, x, z) => {
    if (!inCircle(x, z)) return 0;
    const i = Math.floor((x - C.x0) / C.span * C.px), j = Math.floor((z - C.z0) / C.span * C.px);
    return i < 0 || j < 0 || i >= C.px || j >= C.px ? 0 : arr[j * C.px + i] / 255;
  };
  const forestRaw = (x, z) => texel(forest, x, z), roadAt = (x, z) => texel(road, x, z);
  // (how much a place is open meadow, 0..1: not wood, not grain, not road, not town, not rock; as the grass reads it.
  // For the wildflowers, which grow everywhere the meadow does: meadow.js)
  // the water's flow (flow.png: rg - 0.5, times 6, m/s along x and z), for the bridges' icebreakers
  const flw = readOpaque(fl), flOk = flw.length === C.px * C.px * 4;
  const flowAt = (x, z) => {
    if (!flOk || !inCircle(x, z)) return [0, 0];
    const i = Math.floor((x - C.x0) / C.span * C.px), j = Math.floor((z - C.z0) / C.span * C.px);
    if (i < 0 || j < 0 || i >= C.px || j >= C.px) return [0, 0];
    const k = (j * C.px + i) * 4;
    return [(flw[k] / 255 - 0.5) * 6, (flw[k + 1] / 255 - 0.5) * 6];
  };
  const covB = readOpaque(cb), openM = new Uint8Array(C.px * C.px);
  const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0, k = 0; i < openM.length; i++, k += 4) {
    const v = 1 - sm(0.35, 0.75, covA[k] / 255) - sm(0.3, 0.6, covA[k + 1] / 255) - sm(0.3, 0.6, 1 - covA[k + 3] / 255)
      - sm(0.3, 0.42, covB[k] / 255) - sm(0.35, 0.7, 1 - covB[k + 3] / 255);   // (the town's paving: none of the meadow's flowers or tufts past its edge, terrain's townW)
    openM[i] = Math.round(255 * Math.min(1, Math.max(0, v)));
  }
  // copses and lone stands in the open land: clumps of wood a few hundred metres apart where the cover is open meadow,
  // never round the spawn. The same as COPSE_GLSL below.
  const chash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const cnoise = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = chash(i, j), b = chash(i + 1, j), c = chash(i, j + 1), d = chash(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  // (no copse in a village or on any other place the layout keeps open: the trees had stood in Pokrovskoe's street
  // and round its church. The same circles as build_world.py's keep_open, r * 1.05 to r * 1.5; uOpen below.)
  const OPEN = (json.pois ?? []).filter((P) => P.kind !== 'nymph_pond').slice(0, 12).map((P) => [P.at[0], P.at[1], P.r ?? 20]);
  const openKeep = (x, z) => { let k = 1; for (const [ox, oz, r] of OPEN) k = Math.min(k, sm(r * 1.05, r * 1.5, Math.hypot(x - ox, z - oz))); return k; };
  const copse = (x, z) => {
    const n = cnoise(x / 170, z / 170) * 0.7 + cnoise(x / 47 + 9.1, z / 47 - 3.3) * 0.3;
    return sm(0.6, 0.72, n) * sm(220, 400, Math.hypot(x, z)) * openKeep(x, z);
  };
  const meadowOpen = (x, z) => texel(openM, x, z);
  const meadowAt = (x, z) => meadowOpen(x, z) * (1 - copse(x, z));
  // (the towns' cover, closed over seams: no wood stands in a city - its trees had grown through the houses; the yards
  // and streets have their own trees, cityprops.js)
  const townM = new Uint8Array(C.px * C.px);
  for (let i = 0, k = 0; i < townM.length; i++, k += 4) townM[i] = covB[k];
  // (texel() gives 0..1 already: divided by 255 again here, the town had read as 0.004 at most, so no wood ever kept out of
  // a town by it - the trees on the towns' paving)
  const townAt = (x, z) => texel(townM, x, z);
  const coreRaw = (x, z) => bilinear(core.h, C.px, (x - C.x0) / C.span, (z - C.z0) / C.span);
  const farRaw = (x, z) => bilinear(far.h, F.px, (x - F.x0) / F.span, (z - F.z0) / F.span);
  const edge = (x, z) => {
    const u = (x - C.x0) / C.span, v = (z - C.z0) / C.span, e = Math.min(u, 1 - u, v, 1 - v);
    const c = (CI.r - Math.hypot(x - CI.x, z - CI.z)) / RIM;
    return Math.min(1, Math.max(0, e / 0.02), Math.max(0, c));
  };
  const coverAt = (x, z) => {          // (water, roads, cities: no fine relief there) from the water code alone on the CPU
    const i = Math.round((x - C.x0) / C.span * C.px - 0.5), j = Math.round((z - C.z0) / C.span * C.px - 0.5);
    if (i < 0 || j < 0 || i >= C.px || j >= C.px || !inCircle(x, z)) return 0;
    return core.w[j * C.px + i];
  };
  const codeBilinear = (x, z) => bilinear(core.w, C.px, (x - C.x0) / C.span, (z - C.z0) / C.span);
  // (the towns' ground, cover-b's red: no fine relief there either. The houses, their pavements and yards are laid on
  // the height picture itself (dev\world\cityhouses.py), and the half-metre of fine relief had put the town's setts
  // through the yards' gravel and over the pavements; and off from the town's very edge (0.05..0.3 of its cover, not
  // 0.2..0.6): where the cover thinned along a street the relief had come back as divots and bumps)
  const townF = new Float32Array(C.px * C.px);
  for (let i = 0, k = 0; i < townF.length; i++, k += 4) townF[i] = covB[k] / 255;
  const townBilinear = (x, z) => bilinear(townF, C.px, (x - C.x0) / C.span, (z - C.z0) / C.span);
  const landAt = (x, z) => {
    const e = edge(x, z);
    const h = e > 0 ? coreRaw(x, z) * e + (e < 1 ? farRaw(x, z) * (1 - e) : 0) : farRaw(x, z);
    return h + fineCPU(x, z) * smoothCPU(140, 320, Math.hypot(x, z)) * (1 - smoothCPU(0.5, 6, codeBilinear(x, z)))
      * (1 - smoothCPU(0.05, 0.3, townBilinear(x, z)));
  };
  // the hilltop: its own surface inside the meadow, then down its slope to the land over `descent` m
  const S = json.spawn, R0 = S.meadowR, D = S.descent;
  const rimAt = island ? (az) => island(Math.sin(az) * R0, -Math.cos(az) * R0) : () => 0;
  const heightAt = (x, z) => {
    const r = Math.hypot(x, z);
    if (island && r <= R0) return island(x, z);
    const land = landAt(x, z);
    if (!island || r >= R0 + D) return land;
    const rim = rimAt(Math.atan2(x, -z)), t = smoothCPU(0, 1, (r - R0) / D);
    return rim + (land - rim) * t;
  };
  const waterAt = (x, z) => {
    const u = (x - C.x0) / C.span, v = (z - C.z0) / C.span;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    const c = coverAt(x, z);
    return c ? c * 0.5 - 20 : null;
  };
  // the hilltop's surface baked round the spawn (the GPU can't run island()): 512 m at 1 m
  const SP = { span: 512, n: 512 };
  const spawnH = new Float32Array(SP.n * SP.n);
  for (let j = 0; j < SP.n; j++) for (let i = 0; i < SP.n; i++) {
    const x = ((i + 0.5) / SP.n - 0.5) * SP.span, z = ((j + 0.5) / SP.n - 0.5) * SP.span;
    spawnH[j * SP.n + i] = heightAt(x, z);
  }
  const tex = {
    height: floatTex(core.h, C.px, renderer), far: floatTex(far.h, F.px, renderer), spawn: floatTex(spawnH, SP.n, renderer),
    water: new THREE.DataTexture(core.w, C.px, C.px, THREE.RedFormat, THREE.UnsignedByteType),
    coverA: new THREE.Texture(ca), coverB: new THREE.Texture(cb), flow: new THREE.Texture(fl),
  };
  for (const k of ['water', 'coverA', 'coverB', 'flow']) {
    const t = tex[k];
    t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
    t.premultiplyAlpha = false; t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  }
  const uniforms = {
    uH: { value: tex.height }, uCore: { value: new THREE.Vector4(C.x0, C.z0, C.span, C.px) }, uCircle: { value: new THREE.Vector4(CI.x, CI.z, CI.r, RIM) },
    uFar: { value: tex.far }, uFarR: { value: new THREE.Vector4(F.x0, F.z0, F.span, F.px) },
    uSpawn: { value: tex.spawn }, uSpawnSpan: { value: SP.span },
    uWater: { value: tex.water }, uCovA: { value: tex.coverA }, uCovB: { value: tex.coverB }, uFlow: { value: tex.flow },
    uMeadowR: { value: R0 - 0.5 },
    // (the Kremlin's ground inside its wall, and Red Square: paved in granite setts; kremlin.js fills these in)
    uKrem: { value: Array.from({ length: 20 }, () => new THREE.Vector2()) }, uKremN: { value: 0 },
    uRed: { value: Array.from({ length: 4 }, () => new THREE.Vector2()) },
    uOpen: { value: Array.from({ length: 12 }, (_, i) => new THREE.Vector3(...(OPEN[i] ?? [0, 0, 0]))) },
  };
  const forestAt = (x, z) => Math.max(forestRaw(x, z), copse(x, z) * meadowOpen(x, z));
  // what the ground is at (x, z), for the footsteps (walk.js): the cover pictures as the land's shader reads them (A: R
  // forest, G field, B wet, A 1 - road; B: R town, A 1 - rock), and the water. One of 'grass', 'field', 'forest',
  // 'rock', 'road', 'town', 'shore', 'water'; the ways and the bridges are the walker's to add (they know them).
  const groundAt = (x, z) => {
    const w = waterAt(x, z);
    if (w !== null && w - landAt(x, z) > 0.02) return 'water';
    if (!inCircle(x, z)) return 'grass';
    const i = Math.floor((x - C.x0) / C.span * C.px), j = Math.floor((z - C.z0) / C.span * C.px);
    if (i < 0 || j < 0 || i >= C.px || j >= C.px) return 'grass';
    const k = (j * C.px + i) * 4;
    const forestV = Math.max(covA[k] / 255, copse(x, z) * meadowOpen(x, z)), fieldV = covA[k + 1] / 255, wetV = covA[k + 2] / 255;
    const roadV = 1 - covA[k + 3] / 255, townV = covB[k] / 255, rockV = 1 - covB[k + 3] / 255;
    if (rockV > 0.5) return townV > 0.5 || wetV > 0.6 ? 'rock' : 'field';   // (the bare hills are farmed: moreFields)
    if (townV > 0.5) return 'town';
    if (roadV > 0.5) return 'road';
    if (w !== null || wetV > 0.6) return 'shore';
    if (forestV > 0.5) return 'forest';
    if (fieldV > 0.5) return 'field';
    return 'grass';
  };
  return { json, heightAt, landAt, waterAt, flowAt, groundAt, forestAt, roadAt, meadowAt, townAt, tex, uniforms, core, coverAt, circle: CI, inCircle };
}
function smoothCPU(a, b, t) { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); }

// ---- the GPU's view of the same land ----
export const LAND_GLSL = /* glsl */`
#ifndef CANOPY_AT
#define CANOPY_AT 1650.0
#endif
uniform sampler2D uH; uniform vec4 uCore; uniform sampler2D uFar; uniform vec4 uFarR;
uniform sampler2D uSpawn; uniform float uSpawnSpan; uniform sampler2D uWater; uniform sampler2D uCovA; uniform sampler2D uCovB;
uniform float uMeadowR;
uniform vec3 uOpen[12];    // (the places kept open, x, z, r: no copse within r * 1.05 to r * 1.5; the CPU's openKeep)
uniform vec2 uKrem[20]; uniform float uKremN; uniform vec2 uRed[4];
// (inside the Kremlin's wall or on Red Square: 1, else 0; a point-in-polygon test, run only where the land is town)
float paved(vec2 p) {
  if (uKremN < 3.0) return 0.0;
  bool c = false; int n = int(uKremN);
  for (int i = 0; i < 20; i++) {
    if (i >= n) break;
    vec2 a = uKrem[i], b = uKrem[i == 0 ? n - 1 : i - 1];
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  bool r = false;
  for (int i = 0; i < 4; i++) {
    vec2 a = uRed[i], b = uRed[i == 0 ? 3 : i - 1];
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) r = !r;
  }
  return (c || r) ? 1.0 : 0.0;
}
float openKeep(vec2 p) { float k = 1.0; for (int i = 0; i < 12; i++) { if (uOpen[i].z > 0.0) k = min(k, smoothstep(uOpen[i].z * 1.05, uOpen[i].z * 1.5, length(p - uOpen[i].xy))); } return k; }
vec2 coreUV(vec2 p) { return (p - uCore.xy) / uCore.z; }
uniform vec4 uCircle;      // the world's round edge: centre x, z, radius, rim width (m)
float waterCodeRaw(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || length(uv * uCore.z + uCore.xy - uCircle.xy) > uCircle.z - uCircle.w * 0.5) ? 0.0 : textureLod(uWater, uv, 0.0).r * 255.0; }
float coreEdge(vec2 uv) { vec2 e = min(uv, 1.0 - uv); vec2 p = uv * uCore.z + uCore.xy;
  return min(clamp(min(e.x, e.y) / 0.02, 0.0, 1.0), clamp((uCircle.z - length(p - uCircle.xy)) / uCircle.w, 0.0, 1.0)); }
// the shore: 1 on the strip of sand and pebbles a few metres wide where the land meets the water and is not much above
// it, 0 elsewhere. The nearest water (its exact cells, not blended) found in rings round p: taps rings of 8 (n rings,
// out to 8.5 m).
float beachAt(vec2 p, float h, int rings) {
  float best = 99.0, lvl = -1e4;
  for (int k = 0; k < 3; k++) {
    if (k >= rings) break;
    float r = rings == 1 ? 5.5 : (k == 0 ? 2.5 : (k == 1 ? 5.0 : 8.5));
    for (int a = 0; a < 8; a++) {
      float an = float(a) * 0.7853982 + float(k) * 0.39;
      vec2 q = p + vec2(cos(an), sin(an)) * r, uv = coreUV(q);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0 || length(q - uCircle.xy) > uCircle.z - uCircle.w * 0.5) continue;
      float c = texelFetch(uWater, ivec2(uv * uCore.w), 0).r * 255.0;
      if (c > 0.5 && r < best) { best = r; lvl = c * 0.5 - 20.0; }
    }
    if (best < 90.0) break;
  }
  if (best > 90.0) return 0.0;
  return (1.0 - smoothstep(3.0, 9.0, best)) * (1.0 - smoothstep(0.4, 1.8, h - lvl));
}
// (the range's finer relief, for its light only: ridged noise at 700, 260 and 95 m, sharp crests and rounded gullies)
float mtRidge(vec2 q) { float r = 1.0 - abs(vnoise(q) * 2.0 - 1.0); return r * r; }
float mtRelief(vec2 p) { return mtRidge(p / 700.0 + 3.1) * 120.0 + mtRidge(p / 260.0 - 1.7) * 45.0 + mtRidge(p / 95.0 + 8.3) * 15.0; }
float fineH(vec2 p) { return (vnoise(p / 9.0) - 0.5) * 0.45 + (vnoise(p / 23.0 + vec2(7.1, -3.3)) - 0.5) * 0.7; }
// the land's height at p: the core where it reaches, the far land beyond; the hilltop's own surface round the spawn
float landH(vec2 p) {
  vec2 uv = coreUV(p); float e = coreEdge(uv);
  float h = textureLod(uFar, (p - uFarR.xy) / uFarR.z, 0.0).r;
  // (the main range's ridges and gullies, finer than the far picture's 128 m: its peaks had stood as one flat grey wall
  // along the horizon)
  // (the far picture's massif is flat-topped near 1950 m, 50 km across: the ridges here are what make it a range, crests
  // to ~3400 m, saddles ~1500 m, strongest where the massif is highest, none at its foot)
  float mt = smoothstep(900.0, 1900.0, h) * (1.0 - e);
  if (mt > 0.0) {
    float r0 = 1.0 - abs(vnoise(p / 6000.0 + 1.7) * 2.0 - 1.0);
    float r1 = 1.0 - abs(vnoise(p / 2300.0) * 2.0 - 1.0), r2 = 1.0 - abs(vnoise(p / 900.0 + 7.3) * 2.0 - 1.0);
    h += mt * (r0 * r0 * 900.0 + r1 * r1 * (250.0 + 350.0 * r0) + r2 * r2 * 160.0 - 520.0 + (vnoise(p / 330.0 - 3.1) - 0.5) * 90.0);
  }
  if (e > 0.0) h = mix(h, textureLod(uH, uv, 0.0).r, e);
  h += fineH(p) * smoothstep(140.0, 320.0, length(p)) * (1.0 - smoothstep(0.5, 6.0, waterCodeRaw(uv)))
    * (1.0 - smoothstep(0.05, 0.3, textureLod(uCovB, uv, 0.0).r));   // (none in the towns, from their very edge - no divots or bumps in the streets: as landAt on the CPU)
  vec2 s = p / uSpawnSpan + 0.5; vec2 es = min(s, 1.0 - s); float ws = clamp(min(es.x, es.y) / 0.06, 0.0, 1.0);
  if (ws > 0.0) h = mix(h, textureLod(uSpawn, s, 0.0).r, ws);
  return h;
}
// the ground's slope at p (rise over run), from the land's height 12 m either way
float slopeAt(vec2 p) {
  vec2 e1 = vec2(12.0, 0.0), e2 = vec2(0.0, 12.0);
  return length(vec2(landH(p + e1) - landH(p - e1), landH(p + e2) - landH(p - e2))) / 24.0;
}
// the woods' crowns, as a raised cover seen from afar (the near trees are real: woods.js), faded in past 1650 m, where
// the trees' pictures end (1800 m). It had sunk between 520 and 320 m, while the trees stood there anyway, so a wooded
// rise lost its top as the walker came on
// (copses in the open land: the same as the CPU's copse(); open meadow as meadowAt reads it)
float cHash(vec2 i) { return fract(sin(i.x * 127.1 + i.y * 311.7) * 43758.5453); }
float cNoise(vec2 q) { vec2 i = floor(q), f = fract(q); vec2 s = f * f * (3.0 - 2.0 * f);
  float a = cHash(i), b = cHash(i + vec2(1, 0)), c = cHash(i + vec2(0, 1)), d = cHash(i + vec2(1, 1));
  return a + (b - a) * s.x + (c - a) * s.y + (a - b - c + d) * s.x * s.y; }
float copseAt(vec2 p, vec4 A, vec4 B) {
  float open = clamp(1.0 - smoothstep(0.35, 0.75, A.r) - smoothstep(0.3, 0.6, A.g) - smoothstep(0.3, 0.6, 1.0 - A.a)
    - smoothstep(0.3, 0.6, B.r) - smoothstep(0.35, 0.7, 1.0 - B.a), 0.0, 1.0);
  float n = cNoise(p / 170.0) * 0.7 + cNoise(p / 47.0 + vec2(9.1, -3.3)) * 0.3;
  return smoothstep(0.6, 0.72, n) * smoothstep(220.0, 400.0, length(p)) * open * openKeep(p);
}
// (the copses' outline eased for their colour seen from afar only; the trees stand where copseAt says)
float copseSoft(vec2 p, vec4 A, vec4 B) {
  float open = clamp(1.0 - smoothstep(0.35, 0.75, A.r) - smoothstep(0.3, 0.6, A.g) - smoothstep(0.3, 0.6, 1.0 - A.a)
    - smoothstep(0.3, 0.6, B.r) - smoothstep(0.35, 0.7, 1.0 - B.a), 0.0, 1.0);
  float n = cNoise(p / 170.0) * 0.7 + cNoise(p / 47.0 + vec2(9.1, -3.3)) * 0.3;
  return smoothstep(0.54, 0.8, n) * smoothstep(220.0, 400.0, length(p)) * open * openKeep(p);
}
float forestAt(vec2 p) {
  vec2 uv = coreUV(p);
  if (coreEdge(uv) <= 0.0) return 0.0;
  vec4 A = textureLod(uCovA, uv, 0.0), B = textureLod(uCovB, uv, 0.0);
  return max(A.r, copseAt(p, A, B));
}
float canopyH(vec2 p, float dist) {
  // (the cover averaged over 24 m, so a wood's edge rises over some 30 m, never a cliff the rings would stair-step)
  float fa = 0.25 * (forestAt(p + vec2(12.0, 5.0)) + forestAt(p - vec2(12.0, 5.0)) + forestAt(p + vec2(-5.0, 12.0)) + forestAt(p + vec2(5.0, -12.0)));
  float f = smoothstep(0.35, 0.85, 0.5 * fa + 0.5 * forestAt(p));
  if (f <= 0.0) return 0.0;
  // (only where trees stand (woods.js plants none on water, a road or in a town): over the river and the cart road the
  // crowns had stood as mounds that sank as the walker came near; eased over some 20 m round each, as the cover)
  float bare = 0.0;
  for (int k = 0; k < 5; k++) {
    vec2 q = p + (k == 0 ? vec2(0.0) : vec2(k == 1 ? 10.0 : k == 2 ? -10.0 : 0.0, k == 3 ? 10.0 : k == 4 ? -10.0 : 0.0));
    vec2 u = coreUV(q);
    vec4 A = textureLod(uCovA, u, 0.0), B = textureLod(uCovB, u, 0.0);
    float b = max(max(step(0.5, waterCodeRaw(u)), smoothstep(0.15, 0.35, 1.0 - A.a)), smoothstep(0.3, 0.6, B.r));
    bare += b * (k == 0 ? 0.4 : 0.15);
  }
  f *= 1.0 - smoothstep(0.1, 0.5, bare);
  if (f <= 0.0) return 0.0;
  float crown = 0.55 + 0.45 * vnoise(p / 6.0) + 0.25 * vnoise(p / 2.3 + 4.1);
  return f * (11.0 + 7.0 * vnoise(p / 41.0)) * crown * smoothstep(CANOPY_AT, CANOPY_AT + 200.0, dist);
}
// the open fields of a village: furlongs some 250 m across, each ploughed its own way, each cut into the peasants'
// long narrow strips (12-30 m). Returns x: the crop (0 rye, 1 oats, 2 flax, 3 fallow), y: how far across its strip
// (0..1), z: the strip's number along, w: 1 on the grassy balks between furlongs. (terrain and grass agree on it)
// more farmland: the open meadow between the woods and the villages taken into fields in broad blocks a few hundred
// metres across, never in the woods, on roads, in towns, on rock or wet ground, and never round the spawn's own meadow.
// Read by the land and the grass alike.
float moreFields(vec2 p, vec4 A, vec4 B) {
  float open = (1.0 - smoothstep(0.12, 0.35, A.r)) * (1.0 - smoothstep(0.2, 0.5, 1.0 - A.a)) * (1.0 - smoothstep(0.15, 0.4, B.r))
    * (1.0 - smoothstep(0.2, 0.5, 1.0 - B.a)) * (1.0 - smoothstep(0.4, 0.7, A.b))
    * (1.0 - smoothstep(0.4, 0.7, B.g));   // (not in a park: Yasnaya Polyana's lawns and meadows were ploughed into strips)
  // (their edges eased over a wider band: a field's colour no longer stops dead on a bare hillside)
  float blocks = smoothstep(0.39, 0.53, vnoise(p / 620.0 + vec2(11.3, -4.7)) * 0.75 + vnoise(p / 170.0 - 2.2) * 0.25);
  float spawn = smoothstep(260.0, 420.0, length(p));
  // (and every bare hill and mountain taken in too, all of it, in the same strips: the rock cover, off the towns and
  // the wet ground)
  float bareHill = smoothstep(0.2, 0.55, 1.0 - B.a) * (1.0 - smoothstep(0.3, 0.6, B.r)) * (1.0 - smoothstep(0.4, 0.7, A.b));
  // (ploughed only where a plough could go: the gentle slopes. The steeper bare hillsides are grass and scrub, the
  // steepest rock (hillside()): the strips had climbed every slope in hard orange bands)
  if (bareHill > 0.0) bareHill *= 1.0 - smoothstep(0.07, 0.13, slopeAt(p));
  return max(open * blocks, bareHill) * spawn;
}
vec4 fieldStrip(vec2 p) {
  vec2 q = p + 60.0 * vec2(vnoise(p / 300.0), vnoise(p / 300.0 + 5.2)) - 30.0;
  vec2 fc = floor(q / 250.0);
  float fa = hash12(fc) * 3.14159, fw = mix(12.0, 30.0, hash12(fc + 17.0));
  float sAlong = dot(q, vec2(cos(fa), sin(fa))) / fw, sId = floor(sAlong);
  float k = hash12(vec2(sId, hash12(fc) * 97.0));
  float kind = k < 0.35 ? 0.0 : k < 0.6 ? 1.0 : k < 0.75 ? 2.0 : 3.0;
  vec2 fe = abs(fract(q / 250.0) - 0.5);
  return vec4(kind, fract(sAlong), sAlong, smoothstep(0.492, 0.498, max(fe.x, fe.y)));
}
float waterCode(vec2 p) { vec2 uv = coreUV(p); return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : textureLod(uWater, uv, 0.0).r * 255.0; }
`;

const CLIP_VERT = /* glsl */`
uniform float uScale; uniform vec2 uCenter; uniform float uHalf; uniform float uMode;
varying vec3 vW; varying float vDist; varying float vSun;
${WIND_GLSL}
//@LAND
// (the water's code at p, the highest of its four texels: read bilinear, a canal's code had fallen to half at its edges -
// half the water's level - and on the coarse rings far off, whose vertices lie metres apart, the narrow canals broke into
// ponds that came and went as the camera moved)
float waterMax(vec2 p) {
  vec2 uv = coreUV(p);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  ivec2 sz = textureSize(uWater, 0); vec2 f = uv * vec2(sz) - 0.5; ivec2 i = ivec2(floor(f));
  float m = 0.0;
  for (int a = 0; a < 2; a++) for (int b = 0; b < 2; b++) m = max(m, texelFetch(uWater, clamp(i + ivec2(a, b), ivec2(0), sz - 1), 0).r * 255.0);
  return m;
}
// (and over the ground a coarse vertex stands for: the four points half its spacing round it)
float waterFoot(vec2 p) {
  float m = waterMax(p);
  if (uScale > 5.0) { float r = uScale * 0.5;
    m = max(m, max(max(waterMax(p + vec2(r, 0.0)), waterMax(p - vec2(r, 0.0))), max(waterMax(p + vec2(0.0, r)), waterMax(p - vec2(0.0, r))))); }
  return m;
}
void main() {
  vec2 g = position.xz;
  // the outer cells ease into the next ring's shape: odd vertices slide onto their even neighbours
  float m = clamp((max(abs(g.x), abs(g.y)) - (uHalf - 10.0)) / 8.0, 0.0, 1.0);
  vec2 odd = mod(g, 2.0);
  vec2 p = uCenter + (g - odd * m) * uScale;
  float h = landH(p);
  if (uMode < 0.5) h += canopyH(p, length(p - cameraPosition.xz));
  if (uMode > 0.5) {            // the water: at its surface where there is water, tucked under the ground elsewhere
    float c = waterFoot(p);
    h = c > 0.5 ? c * 0.5 - 20.0 : h - 3.0;
  } else if (uScale > 5.0 && waterFoot(p) > 0.5) {
    // (a coarse vertex by the water takes the lowest ground round it, so the land drawn between it and the next never
    // bridges over a canal narrower than their spacing)
    float r = uScale * 0.5;
    h = min(h, min(min(landH(p + vec2(r, 0.0)), landH(p - vec2(r, 0.0))), min(landH(p + vec2(0.0, r)), landH(p - vec2(0.0, r)))));
  }
  vW = vec3(p.x, h, p.y);
  vSun = sunThrough(vW);
  vec4 mv = viewMatrix * vec4(vW, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const LAND_FRAG = /* glsl */`
uniform vec4 uInner;            // the finer ring's square (centre x, z, half side), drawn there instead of this
varying vec3 vW; varying float vDist; varying float vSun;
${WIND_GLSL}
//@LAND
uniform vec3 uGrassA; uniform vec3 uGrassB; uniform vec3 uField; uniform vec3 uFieldB; uniform vec3 uWood; uniform vec3 uRoad; uniform vec3 uTown; uniform vec3 uRoof;
uniform vec3 uRock; uniform vec3 uMud; uniform vec3 uBloom; uniform vec3 uFieldC; uniform vec3 uFallow; uniform vec3 uWoodB;
// the ground up close: ComfyUI's tiles of each ground (meadow, ploughed soil, forest floor, cart road, river bank, rock;
// GROUND below), each at its true size, two takes of it turned and shifted in patches so its repeats never line up;
// tinted to the land's colour there (the tile's own colour over its average), so near and far agree
uniform highp sampler2DArray uGT; uniform float uGOn; uniform float uGM[8]; uniform vec3 uGMean[8]; uniform float uGOk[8];
${WAYS_GLSL}
vec3 gTake(int L, vec2 p) {
  float m = uGM[L];
  vec3 a = texture(uGT, vec3(p / m, float(L))).rgb;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * p / (m * 1.29) + vec2(0.31, 0.57);
  vec3 b = texture(uGT, vec3(r, float(L))).rgb;
  return mix(a, b, smoothstep(0.38, 0.62, vnoise(p / (m * 2.6) + float(L) * 7.3)));
}
// (the changes across a pixel - of the place, dx and dz, and of the height, hx and hz - are worked out by the caller,
// where every pixel runs: main)
vec3 gBump(vec3 dx, vec3 dz, vec3 nrm, float hx, float hz, float k) {
  vec3 r1 = cross(dz, nrm), r2 = cross(nrm, dx);
  float det = dot(dx, r1);
  if (det == 0.0) return nrm;                     // (a piece of ground seen exactly edge on: no relief to show)
  vec3 g = sign(det) * (hx * r1 + hz * r2) * k;
  return normalize(abs(det) * nrm - g);
}
// parallax occlusion: the ground's tile seen at an angle shows its depth: the view ray marched down through the tile's
// own height (its light and dark: stones, clods and needles stand proud, cracks and hollows sink), ten steps and a
// refinement, the place it meets taken for the colour and the relief. Its depth in metres by the ground (uGDepth), only
// near the camera.
uniform float uGDepth[8];
float gHgt(int L, vec2 q) {
  vec3 t = gTake(L, q);
  return clamp(dot(t, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uGMean[L], vec3(0.2126, 0.7152, 0.0722)), 0.02) * 0.5, 0.0, 1.0);
}
vec2 gParallax(int L, vec2 p, vec3 V, float depth) {
  vec2 dir = -V.xz / max(V.y, 0.25) * depth;
  float stp = 0.1, dd = 0.0, h = gHgt(L, p), pd = 0.0, ph = h;
  for (int i = 0; i < 10; i++) {
    if (1.0 - h <= dd) break;
    pd = dd; ph = h; dd += stp; h = gHgt(L, p + dir * dd);
  }
  float a = (1.0 - ph) - pd, b = (1.0 - h) - dd;
  return p + dir * mix(pd, dd, clamp(a / (a - b + 1e-5), 0.0, 1.0));
}
void main() {
  vec2 p = vW.xz;
  if (uInner.z > 0.0 && max(abs(p.x - uInner.x), abs(p.y - uInner.y)) < uInner.z) discard;
  // (the hilltop is the land's too now, with the same ground and the same ways as everywhere: its own fan of ground in
  // meadow.js, with its gravel paths, is no longer drawn. uMeadowR stays for what else reads it.)
  float d = vDist;
  // the slope from the land's own height round the point, over a step that grows with distance
  float e = clamp(d * 0.004, 1.0, 24.0), cd = length(p - cameraPosition.xz);
  vec2 ex = vec2(e, 0.0), ez = vec2(0.0, e);
  float hx = landH(p + ex) + canopyH(p + ex, cd) - landH(p - ex) - canopyH(p - ex, cd);
  float hz = landH(p + ez) + canopyH(p + ez, cd) - landH(p - ez) - canopyH(p - ez, cd);
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
  vec2 uv = coreUV(p);
  vec4 A = vec4(0.0), B = vec4(0.0);
  if (coreEdge(uv) > 0.0) { A = textureLod(uCovA, uv, 0.0); B = textureLod(uCovB, uv, 0.0); }
  float A0r = A.r;
  // (no field under a wood or a copse: the trees stood in the crop before)
  if (coreEdge(uv) > 0.0) { A.r = max(A.r, copseAt(p, A, B)); A.g = max(A.g, moreFields(p, A, B)) * (1.0 - smoothstep(0.3, 0.55, A.r)); }
  float forest = A.r, field = A.g, wet = A.b, road = 1.0 - A.a, town = B.r, park = B.g, bloom = B.b, rock = 1.0 - B.a;
  if (coreEdge(uv) <= 0.0) { road = 0.0; rock = 0.0; }
  // the meadow green, mottled at several sizes, drier on the crests, lusher in the hollows and by the water
  float m1 = vnoise(p / 37.0), m2 = vnoise(p / 6.0 + 3.7), m3 = vnoise(p / 260.0 - 1.9);
  vec3 c = mix(uGrassA, uGrassB, clamp(m1 * 0.6 + m3 * 0.6 - 0.1, 0.0, 1.0));
  c *= 0.9 + 0.2 * m2;
  c = mix(c, uGrassA * 0.82, wet * 0.5);
  // the open fields in their strips: rye ripe, oats, flax in flower, a fallow strip here and there (fieldStrip)
  vec4 fs = fieldStrip(p);
  vec3 crop = fs.x < 0.5 ? uField : fs.x < 1.5 ? uFieldB : fs.x < 2.5 ? uFieldC : uFallow;
  crop *= 0.9 + 0.12 * vnoise(p / 2.5) + 0.06 * vnoise(p / 11.0);
  // (the furrows' lines faded where a strip is under a couple of pixels, so far fields don't shimmer)
  float px = fwidth(fs.z);
  float edge = smoothstep(0.0, 0.08, fs.y) * smoothstep(1.0, 0.92, fs.y);
  crop *= mix(1.0, 0.85 + 0.15 * edge, 1.0 - smoothstep(0.15, 0.5, px));
  // (and the strips' own crops blended to their mean where a strip is under a pixel: far off, each strip's colour
  // picked per pixel came out as stair-stepped streaks along the horizon)
  vec3 cropMean = (uField * 0.3 + uFieldB * 0.3 + uFieldC * 0.25 + uFallow * 0.15);
  crop = mix(crop, cropMean * (0.92 + 0.12 * vnoise(p / 400.0)), smoothstep(0.35, 1.2, px));
  float balk = fs.w;
  c = mix(c, mix(crop, c, balk), smoothstep(0.25, 0.6, field));
  c = mix(c, uGrassB * 1.08, park * 0.45);
  c = mix(c, c * vec3(1.05, 1.0, 1.15) + uBloom * 0.12 * step(0.82, vnoise(p * 1.3)), bloom * 0.6 * (1.0 - smoothstep(60.0, 300.0, d)));
  // the woods, their crowns seen from afar as a darker, knobbly cover
  float crowns = 0.7 + 0.5 * vnoise(p / 6.0) + 0.2 * vnoise(p / 2.3 + 4.1);
  // (the crowns: green birch, birch turning gold in drifts, the dark of spruce here and there)
  // (a wood seen from afar reads as a wood, not bare ground: green crowns in clumps a couple of trees across, lit and
  // shadowed; the turning birches in soft drifts of gold through the green, never a brown sheet; the spruce stands a
  // darker green with eased edges, not black blots, as a far wood on a hill had been)
  vec3 woodTone = mix(uWood, uWoodB, smoothstep(0.5, 0.85, vnoise(p / 90.0)) * 0.45 * (0.4 + 0.6 * smoothstep(0.3, 0.6, vnoise(p / 9.0))));
  woodTone = mix(woodTone, uWood * vec3(0.55, 0.75, 0.6), smoothstep(0.55, 0.9, vnoise(p / 140.0 + 3.3)) * 0.6);
  crowns *= 0.72 + 0.4 * vnoise(p / 22.0) + 0.15 * vnoise(p / 57.0 + 1.7);
  float fw2 = smoothstep(0.3, 0.7, forest);
  // (the crowns' dark eased in a little wider than the wood's own edge: no hard blot on a bare hillside)
  float forestSoft = coreEdge(uv) > 0.0 ? max(A0r, copseSoft(p, A, B)) : 0.0;
  c = mix(c, woodTone * crowns, smoothstep(0.18, 0.8, forestSoft) * smoothstep(CANOPY_AT, CANOPY_AT + 200.0, cd));
  c = mix(c, mix(c, uMud * 1.3, 0.35), fw2 * (1.0 - smoothstep(CANOPY_AT, CANOPY_AT + 200.0, cd)));   // (the floor under the near trees)
  // rock on the steep and the bare tops; mud under and beside the water
  // (the bare hills' and mountains' colours eased into one another a little: the bare cover half averaged with its
  // neighbours 36 m round, the steepness eased over a wider slope, and the seam frayed a touch so it is no airbrush)
  float rockSoft = rock;
  if (coreEdge(uv) > 0.0) {
    float o = 36.0 / uCore.z;
    float rs = 4.0 - textureLod(uCovB, uv + vec2(o, 0.0), 0.0).a - textureLod(uCovB, uv - vec2(o, 0.0), 0.0).a
      - textureLod(uCovB, uv + vec2(0.0, o), 0.0).a - textureLod(uCovB, uv - vec2(0.0, o), 0.0).a;
    rockSoft = mix(rock, rs * 0.25, 0.55);
  }
  float steep = smoothstep(0.45, 0.95, 1.0 - n.y);
  // (the bare cover is farmed on its gentle slopes (moreFields); the rest of a bare hill is a hillside of grass, drier and
  // goldener up high and on the crests, with dark clumps of scrub and juniper, and rock only where it is steep)
  float farmed = smoothstep(0.25, 0.6, field);
  float hillN = smoothstep(0.2, 0.55, rockSoft) * (1.0 - farmed) * (1.0 - smoothstep(0.3, 0.6, town));
  if (hillN > 0.0) {
    float dry = smoothstep(0.4, 0.75, vnoise(p / 210.0) * 0.55 + vnoise(p / 48.0 + 3.1) * 0.3 + vnoise(p / 11.0) * 0.15
      + clamp((vW.y - 40.0) / 500.0, -0.15, 0.25) + (1.0 - n.y) * 0.6);
    vec3 dryGrass = mix(mix(uFallow, uField, 0.4), uGrassB, 0.35) * vec3(1.0, 0.98, 0.88);
    vec3 hillC = mix(c, dryGrass * (0.88 + 0.16 * vnoise(p / 7.0)), dry * 0.5);
    float scrub = smoothstep(0.64, 0.8, vnoise(p / 13.0 + 7.7) * 0.7 + vnoise(p / 4.0) * 0.3) * (1.0 - 0.5 * dry);
    hillC = mix(hillC, uWood * vec3(0.8, 0.9, 0.8) * (0.85 + 0.2 * vnoise(p / 2.0)), scrub * 0.6);
    c = mix(c, hillC, hillN);
  }
  float rockFace = smoothstep(0.16, 0.4, 1.0 - n.y);
  float bare = max(rockSoft * 0.9 * (1.0 - farmed) * rockFace, steep * 0.7 * (1.0 - 0.6 * farmed));
  bare = clamp(bare + (vnoise(p / 23.0) - 0.5) * 0.5 * bare * (1.0 - bare), 0.0, 1.0);
  c = mix(c, uRock * (0.85 + 0.3 * vnoise(p / 4.0)), bare);
  float wc = waterCode(p);
  float under = wc > 0.5 ? smoothstep(0.0, 1.5, wc * 0.5 - 20.0 - vW.y + 0.4) : 0.0;
  c = mix(c, uMud, max(under, wet > 0.95 ? 0.6 : 0.0));
  // the beach: sand and pebbles a few metres up from the water's edge, the wet line darker; the shallows sandy too
  float beach = cd < 450.0 ? beachAt(p, vW.y, 3) * (1.0 - smoothstep(300.0, 450.0, cd)) : 0.0;
  float shallow = under * (1.0 - smoothstep(0.2, 1.2, wc * 0.5 - 20.0 - vW.y));
  // (a river beach as it is: grey-buff sand and fine shingle, darker and greyer where the water has wet it, mottled at
  // several sizes - not one flat orange)
  float wl_ = wc * 0.5 - 20.0;
  float sn = vnoise(p * 0.21) * 0.45 + vnoise(p * 0.9 + 4.1) * 0.35 + vnoise(p * 3.7 - 2.3) * 0.2;
  vec3 sand = mix(vec3(0.47, 0.45, 0.39), vec3(0.6, 0.57, 0.5), sn);
  sand = mix(sand, vec3(0.38, 0.37, 0.34), smoothstep(0.62, 0.8, vnoise(p * 0.45 + 9.7)) * 0.55);   // (shingle in drifts)
  float wetS = wc > 0.5 ? 1.0 - smoothstep(0.05, 0.55, vW.y - wl_ + (vnoise(p * 0.6) - 0.5) * 0.15) : 0.0;
  sand *= 1.0 - 0.32 * wetS;
  c = mix(c, sand, max(beach * 0.9, shallow * 0.7));
  // roads of beaten earth, towns of roofs and yards
  // (near the camera the ways are drawn sharp (paths.js): beaten earth, cobbles, ruts; far off, the road cover)
  vec3 wy = wayAt(p);
  float nearW = 1.0 - smoothstep(850.0, 1000.0, cd);   // (the ways' far picture reaches about a kilometre: paths.js)
  // (the earth's edge frayed: the turf creeping in and bare patches out, so where two ways meet, or a way meets the grass,
  // there is no drawn line, only worn ground)
  float fray = vnoise(p * 1.3) * 0.6 + vnoise(p * 4.1) * 0.4;
  float wyE = smoothstep(0.25, 0.75, wy.r + (fray - 0.5) * 0.18);   // (a soft, slightly ragged edge; the width stays the same)
  float roadV = mix(smoothstep(0.35, 0.75, road), clamp(wyE + wy.g, 0.0, 1.0), nearW);
  float cobV = wy.g * nearW;
  if (wc > 0.5) cobV *= smoothstep(wc * 0.5 - 20.0 + 0.62, wc * 0.5 - 20.0 + 0.72, vW.y);   // (the streets' setts too)
  roadV *= 1.0 - smoothstep(0.0, 0.25, under);   // (no way drawn on the bed under the water: the bridges carry them over)
  // (Moscow's streets beaten earth and sand, not setts - the period's pictures of its streets: setts only inside the
  // Kremlin and on Red Square. Moscow lies south of z -1200, Petersburg north of +1600)
  float earthT = (1.0 - smoothstep(-1400.0, -1000.0, p.y)) * (1.0 - paved(p));
  roadV = max(roadV, cobV * earthT); cobV *= 1.0 - earthT;
  // (the ways' earth colour, near and far alike)
  vec3 roadCol = uGOk[5] > 0.5 ? uGMean[5] * 0.82 : uRoad;   // (the trail tile's own colour, near and far alike)
  // (Moscow's streets the pale sandy earth of its pictures, mottled - packed sand, dust, a darker damp patch here and
  // there; the trail tile's own colour had read as dark grey asphalt in the evening light)
  vec3 earthMos = vec3(0.43, 0.34, 0.23) * (0.84 + 0.3 * vnoise(p * 0.31)) * (0.93 + 0.14 * vnoise(p * 2.3));
  earthMos *= 1.0 - 0.18 * smoothstep(0.66, 0.8, vnoise(p * 0.09 + 3.3));
  roadCol = mix(roadCol, earthMos, earthT);
  c = mix(c, roadCol * (0.9 + 0.2 * vnoise(p * 0.8)), roadV * (1.0 - cobV));
  c = mix(c, uTown * 0.95, cobV);
  // (the cities: their houses stand as models now (world/cityblocks.js), so the ground between them is the streets'
  // and the yards': setts, near and far, the Kremlin and Red Square with the rest)
  // (a country way that ran on into a city left a seam in the town's cover along its line, and its earth lay there as a
  // strip of dirt across the paving: the town closed over any seam narrower than some 20 m, the paving carried across
  // it)
  float townC = town;
  if (town < 0.7) {
    float tE = textureLod(uCovB, coreUV(p + vec2(11.0, 0.0)), 0.0).r, tW = textureLod(uCovB, coreUV(p - vec2(11.0, 0.0)), 0.0).r;
    float tN = textureLod(uCovB, coreUV(p + vec2(0.0, 11.0)), 0.0).r, tS = textureLod(uCovB, coreUV(p - vec2(0.0, 11.0)), 0.0).r;
    townC = max(town, max(min(tE, tW), min(tN, tS)));
  }
  // (a clear edge to the town, a few metres wide, frayed a little: no blotches of paving fading into the fields)
  float townW = smoothstep(0.44, 0.56, townC + (vnoise(p * 0.35) - 0.5) * 0.08);
  // (the paving ends at the platform's edge over the river: none under 0.7 m over the water, so the town stops at a
  // line and the beach runs on below it; dev\world\city_banks.py raised the platform)
  // (and not at a ruled line: the setts give out over a few tens of centimetres of the bank, unevenly, sand between the
  // last of them)
  // (from 0.15 to 0.6 m over the water: the quays behind the canals' walls stand a metre over it, and at 0.45..0.95 the
  // sand had come up through their paving)
  if (wc > 0.5) townW *= smoothstep(wc * 0.5 - 20.0 + 0.15, wc * 0.5 - 20.0 + 0.6, vW.y + (vnoise(p * 0.8) - 0.5) * 0.35 + (vnoise(p * 3.3) - 0.5) * 0.15);
  vec3 setts = (uGOk[6] > 0.5 ? uGMean[6] : uTown) * (0.92 + 0.12 * vnoise(p * 0.05));
  // (Moscow's streets, squares and yards of beaten earth and sand, as the period's pictures show them - Nikolskaya
  // street, a monastery's square, Strastnaya square: setts only inside the Kremlin and on Red Square. Petersburg's
  // paved. Moscow lies south of z -1200, Petersburg north of +1600)
  vec3 earthC = earthMos;
  c = mix(c, mix(setts, earthC, earthT), townW);
  roadV = max(roadV, townW * earthT);
  cobV = max(cobV, townW * (1.0 - earthT));
  // the ground up close, by what the land is here
  float hgt = 0.0;
  float nearK = uGOn * (1.0 - smoothstep(35.0, 150.0, cd)) * max(1.0 - smoothstep(0.25, 0.7, town), cobV);
  if (nearK > 0.001) {
    float wRoad = roadV * (1.0 - cobV), wRock = bare, wBank = max(max(under, wet > 0.95 ? 0.6 : 0.0), beach);
    float wWood = fw2, wField = smoothstep(0.25, 0.6, field) * (1.0 - balk);
    // (the woods' floor is never one carpet: bare dirt in patches, and drifts of fallen twigs, branches and cones)
    float dirtP = smoothstep(0.6, 0.78, vnoise(p / 11.0 + 5.3)) * 0.85 + smoothstep(0.7, 0.85, vnoise(p / 3.2 - 2.1)) * 0.4;
    float debrisP = smoothstep(0.5, 0.72, vnoise(p / 6.5 - 8.7)) * 0.9;
    wField = max(wField, wWood * min(dirtP, 1.0));
    float w[8]; w[0] = 1.0; w[1] = wField; w[2] = wWood; w[3] = wBank; w[4] = wRock; w[5] = wRoad; w[6] = cobV; w[7] = wWood * debrisP;
    // (the parallax: the ray marched through the ground that lies uppermost here, its place used for every layer)
    float pk = 1.0 - smoothstep(18.0, 40.0, cd);
    if (pk > 0.0) {
      int top = 0; float tw = 0.0;
      for (int L = 1; L < 8; L++) if (w[L] * uGOk[L] > 0.35) { top = L; tw = w[L]; }
      // (none on the ways' beaten earth: its march stepped into fine bands across the path, like a plank floor, at a
      // low look)
      if (top == 5) top = -1;
      vec3 V = normalize(cameraPosition - vW);
      if (top >= 0) p = mix(p, gParallax(top, p, V, uGDepth[top]), pk);
    }
    // (each layer laid over the ones before it, as the colour above was)
    vec3 tint = vec3(1.0); hgt = 0.0;
    for (int L = 0; L < 8; L++) {
      if (L > 0 && w[L] * uGOk[L] < 0.01) continue;
      vec3 t = gTake(L, p);
      // (the meadow keeps the land's own greens, varied by its tile; the others are their own ground, as drawn: needles,
      // soil, pebbles, rock, beaten earth, brought to the land's brightness there)
      vec3 rel = t / max(uGMean[L], vec3(0.02));
      float bright = dot(c, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uGMean[L], vec3(0.2126, 0.7152, 0.0722)), 0.02);
      if (L == 2 || L == 7) t = mix(vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), t, 0.75) * 0.82;   // (the needles in the woods' shade)
      vec3 own = t * clamp(bright, 0.6, 1.4) / max(c, vec3(0.02));
      // (the way's earth: ComfyUI's new trail tile (soft trodden soil, grit and pebbles, no lines), 3 m to a repeat,
      // its colour kept half and half with the land's earth so near and far agree)
      if (L == 5) own = mix(own, rel, 0.3 + 0.7 * earthT);   // (mostly the tile's own grey-brown: the land's earth tint had read orange; Moscow's streets their sandy earth, the tile's grain on it)
      if (L == 3) own = mix(own, rel, 0.5);
      if (L == 1) own = mix(own, rel, 0.7);   // (a field's soil keeps its strip's colour up close, the tile's grain on it: the strips never melt into one brown as the walker nears them)   // (the beach: the tile's pebbles over the sand's own colour, half and half)
      float wl = w[L] * uGOk[L];
      tint = L == 0 ? rel : mix(tint, own, wl);
      float lum = dot(t, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uGMean[L], vec3(0.2126, 0.7152, 0.0722)), 0.02);
      hgt = L == 0 ? lum : mix(hgt, lum, wl);
    }
    c = mix(c, c * clamp(tint, vec3(0.0), vec3(8.0)), nearK);
  }
  // the setts' lattice on past the close tiles: the cobble tile at its true size, its mipmaps fading it into its own mean
  // colour as it gets too fine to see, so the paving far off is the paving near, smaller
  float farCob = cobV * uGOk[6] * smoothstep(35.0, 150.0, cd);
  if (farCob > 0.001) {
    vec3 rc = texture(uGT, vec3(p / uGM[6], 6.0)).rgb / max(uGMean[6], vec3(0.02));
    c = mix(c, c * clamp(rc, vec3(0.3), vec3(2.0)), farCob);
  }
  if (nearK > 0.001) {
    // (the wheels' ruts: pressed in, darker, a little wet)
    // (none under the water: a way's ruts had drawn a dark line along the river's bed where a street crossed it)
    float rut = wy.b * nearW * (1.0 - cobV) * (1.0 - smoothstep(0.0, 0.25, under));
    // (a droshky's wheels: two pressed, darker, a little damp; the earth between them a touch lighter, worn by the hooves)
    c *= (1.0 - 0.42 * rut) * (1.0 + 0.06 * roadV * (1.0 - rut)); hgt -= rut * 1.2;
  }
  // the close tiles' relief, from how their height changes from one pixel to the next. The card works out such a change
  // by comparing a pixel with its neighbour in the block of four pixels it draws together, so the change is asked for
  // here, where every pixel runs, and the relief drawn only where all of the block worked the height out (inNear the
  // same across it). Asked inside the near ground's branch, at its edge - a ring 150 m round the walker - a pixel's
  // change had been taken against a neighbour that never worked the height out, and the ground's light came out black
  // in short dashes along it, seen once the 240-line pictures had no grass to hide them (12 and 13 Nov 2026)
  {
    float inNear = nearK > 0.001 ? 1.0 : 0.0;
    vec3 bdx = dFdx(vW), bdz = dFdy(vW);
    float bhx = dFdx(hgt), bhz = dFdy(hgt);
    // (and faded where the tile's grain is finer than a pixel: no speckle at a glancing look)
    float bumpK = 0.035 * nearK * (1.0 - smoothstep(0.04, 0.2, abs(bhx) + abs(bhz))) * (1.0 - min(fwidth(inNear), 1.0));
    if (bumpK > 0.0005) n = gBump(bdx, bdz, n, bhx, bhz, bumpK);
  }
  // the land further off, the hills and the mountains: the ground tiles laid on at a large scale as broad mottling (the
  // meadow's, and the rock's on the steep and the bare), and the small folds and hummocks of the ground in the relief,
  // fading in where the close tiles fade out
  float farK = smoothstep(60.0, 220.0, cd) * uGOn;
  if (farK > 0.0) {
    // (the meadow's mottling as broad soft patches of its own colour, not its tile blown up: laid 37 m large the tile's
    // blades and sticks had read as giant ones round the towns: the woods far off are patches of tone, so is this)
    float mpA = vnoise(p / 31.0 + 3.7) * 0.55 + vnoise(p / 9.0 - 1.3) * 0.25 + vnoise(p / 113.0) * 0.2;
    float mpB = vnoise(p / 211.0 + 0.37) * 0.7 + vnoise(p / 57.0 + 5.1) * 0.3;
    vec3 mg = vec3(0.86 + 0.28 * mpA) * mix(vec3(1.0), vec3(1.06, 1.02, 0.9), smoothstep(0.45, 0.75, mpA));
    vec3 mg2 = vec3(0.9 + 0.2 * mpB) * mix(vec3(1.0), vec3(0.95, 1.03, 0.97), smoothstep(0.5, 0.8, mpB));
    vec3 rg = texture(uGT, vec3(p / 29.0, 4.0)).rgb / max(uGMean[4], vec3(0.02));
    vec3 macro = mix(sqrt(mg * mg2), rg, bare);
    macro = mix(vec3(dot(macro, vec3(0.333))), macro, 0.6);
    // (none of the meadow's mottling on the cities' paving: far off it had laid brown blotches of grass over the setts;
    // the paving keeps its own even stone)
    macro = mix(macro, vec3(1.0), max(cobV, townW));   // (Moscow's earth streets too: no grass blotches on them)
    // (nor on the beaches, the shallows and the river's bed: the meadow's blades, laid 37 m large, read there as giant
    // sticks)
    float nearW_ = wc > 0.5 ? 1.0 - smoothstep(1.0, 2.5, vW.y - (wc * 0.5 - 20.0)) : 0.0;   // (any ground near a water's level)
    macro = mix(macro, vec3(1.0), clamp(max(max(under, nearW_), max(beach, wet > 0.95 ? 1.0 : 0.0)), 0.0, 1.0));
    c = mix(c, c * clamp(macro, vec3(0.55), vec3(1.5)), 0.6 * farK);
    float e2 = 4.0 + cd * 0.004;
    float f0 = vnoise(p / 23.0) * 0.65 + vnoise(p / 7.0) * 0.35;
    float fx = vnoise((p + vec2(e2, 0.0)) / 23.0) * 0.65 + vnoise((p + vec2(e2, 0.0)) / 7.0) * 0.35;
    float fz = vnoise((p + vec2(0.0, e2)) / 23.0) * 0.65 + vnoise((p + vec2(0.0, e2)) / 7.0) * 0.35;
    n = normalize(n + vec3(f0 - fx, 0.0, f0 - fz) * (2.2 / e2) * 4.0 * farK * (1.0 - 0.85 * cobV) * (1.0 - 0.7 * clamp(max(under, beach), 0.0, 1.0)) * (wc > 0.5 ? smoothstep(1.0, 2.5, vW.y - (wc * 0.5 - 20.0)) * 0.7 + 0.3 : 1.0));   // (the paving flat: no hummocks)
  }
  // the high mountains: alpine meadow low, then bare rock in bands and screes, snow above its line and in the gullies,
  // none on the steepest faces (the main range, tens of kilometres off; the KMV's own hills never reach it)
  if (vW.y > 800.0) {
    // (the range up close and far: ridges, spurs and gullies down every face, finer than the land's own grid can carry,
    // in the light as relief: the slopes had been smooth and grey)
    float mtw = smoothstep(850.0, 1500.0, vW.y) * (1.0 - coreEdge(uv));
    float gs = max(18.0, d * 0.0012);
    float D0 = mtRelief(p), Dx = mtRelief(p + vec2(gs, 0.0)), Dz = mtRelief(p + vec2(0.0, gs));
    n = normalize(vec3(n.x - (Dx - D0) / gs * 1.6 * mtw, n.y, n.z - (Dz - D0) / gs * 1.6 * mtw));
    float gully = 1.0 - smoothstep(0.25, 0.55, D0 / 180.0);       // (low in the relief: a gully or couloir)
    float sl = 1.0 - n.y;
    float rockW = clamp(smoothstep(1700.0, 2600.0, vW.y) * 0.9 + smoothstep(0.3, 0.6, sl) * 0.7, 0.0, 1.0) * smoothstep(900.0, 1500.0, vW.y);
    vec3 rockC = uRock * (0.75 + 0.4 * vnoise(p / 520.0)) * mix(vec3(1.0), vec3(0.86, 0.83, 0.8), smoothstep(0.45, 0.62, vnoise(vec2(p.x / 1400.0, vW.y / 90.0))));
    // (the rock's beds in bands across the faces, darker in the gullies, pale screes fanned below the cliffs)
    rockC *= 0.82 + 0.3 * vnoise(vec2(p.x / 300.0 + p.y / 900.0, vW.y / 26.0)) - 0.22 * gully * mtw;
    float scree = smoothstep(0.2, 0.38, sl) * (1.0 - smoothstep(0.45, 0.6, sl)) * smoothstep(0.55, 0.75, vnoise(p / 180.0 + 2.3));
    rockC = mix(rockC, vec3(0.62, 0.6, 0.56) * (0.9 + 0.2 * vnoise(p / 40.0)), scree * 0.6);
    // (the alpine grass on the gentler slopes below the rock: green-gold, browner on the spurs)
    vec3 alp = mix(uGrassA * vec3(0.9, 1.0, 0.85), vec3(0.42, 0.38, 0.24), smoothstep(0.45, 0.7, vnoise(p / 700.0)));
    c = mix(c, alp, smoothstep(950.0, 1300.0, vW.y) * (1.0 - smoothstep(0.32, 0.5, sl)) * (1.0 - rockW) * mtw);
    c = mix(c, rockC, rockW);
    // (the line set so the range's crests carry snow and its saddles and gullies do not)
    float line = 2620.0 + 320.0 * (vnoise(p / 3100.0) - 0.5);
    float snow = smoothstep(line - 150.0, line + 200.0, vW.y + (0.4 - sl) * 450.0 + gully * 260.0 * mtw) * (1.0 - smoothstep(0.62, 0.85, sl));
    c = mix(c, vec3(0.9, 0.93, 0.97) * (0.92 + 0.1 * vnoise(p / 260.0)), snow);
  }
  // (the cities' setts, near and far, a warm grey stone: the photograph's cool granite, under the evening sky's light in
  // the houses' shade, read as water from a distance)
  c *= mix(vec3(1.0), vec3(1.07, 1.0, 0.86), townW);
  vec3 lit = lightUp(c, n, 1.0, 0.0, vSun * treeShade(vW + n * 0.2 + uSunDir * 0.1));
  // (tens of kilometres off nothing is brighter than the air in front of it: rock faces catching the sun out there came
  // out as white dashes along the horizon under the clear day's light haze)
  lit = mix(lit, min(lit, uHaze * 1.04), smoothstep(18000.0, 60000.0, d));
  gl_FragColor = vec4(hazed(lit, d), 1.0);
}`;

// The water (researched 8 Nov 2026: depth-based absorption, flow-mapped normals in two phases, foam by depth and by
// the river's speed; the usual way real-time rivers are made, from the land's own height): its colour is what the
// water absorbs over its depth (the bed shows through the shallows, so the shore has no hard edge); the sky reflected
// by the Fresnel law; small waves carried along the river's flow (flow.png), roughened where it runs fast; a line of
// foam where it laps the shore, and white water through the rapids and below each fall.
const WATER_FRAG = /* glsl */`
uniform vec4 uInner;
varying vec3 vW; varying float vDist; varying float vSun;
${WIND_GLSL}
//@LAND
uniform vec3 uDeep; uniform vec3 uSkyTop; uniform sampler2D uFlow;
vec2 waveGrad(vec2 q) {
  float e = 0.35, c0 = vnoise(q);
  return vec2(c0 - vnoise(q + vec2(e, 0.0)), c0 - vnoise(q + vec2(0.0, e))) / e;
}
// the waves at p as a slope, carried along v (m/s): two copies half a cycle apart, each faded at its reset (flow mapping)
vec2 flowWaves(vec2 p, vec2 v, float sc) {
  float t = uTime * 0.35;
  float a = fract(t), b = fract(t + 0.5), wb = abs(a - 0.5) * 2.0;
  vec2 g0 = waveGrad((p - v * a * 2.86) * sc) + 0.5 * waveGrad((p - v * a * 2.86) * sc * 2.7 + 5.3);
  vec2 g1 = waveGrad((p - v * b * 2.86) * sc + 17.1) + 0.5 * waveGrad((p - v * b * 2.86) * sc * 2.7 + 23.9);
  return mix(g0, g1, wb) * sc;
}
void main() {
  vec2 p = vW.xz;
  if (uInner.z > 0.0 && max(abs(p.x - uInner.x), abs(p.y - uInner.y)) < uInner.z) discard;
  if (waterCode(p) < 0.5) discard;
  float depth = vW.y - landH(p);
  if (depth <= 0.0) discard;
  float d = vDist;
  vec2 uv = coreUV(p);
  vec4 fl = textureLod(uFlow, uv, 0.0);
  vec2 vel = (fl.xy - 0.5) * 6.0; float speed = length(vel); float white = fl.z;
  float fade = 1.0 - smoothstep(30.0, 1200.0, d);
  // the wind's ripples, calmer in the lee (cat's paws), and the flow's waves, rougher where it runs fast
  vec2 wd = uWindDir;
  vec2 w = 0.6 * waveGrad(p * 0.37 - wd * uTime * 0.45) * 0.37 + 0.4 * waveGrad(p * 1.3 - wd * uTime * 0.8 + 13.1) * 1.3 * 0.45;
  w *= 0.35 + 0.65 * smoothstep(0.25, 0.65, vnoise(p / 60.0 - wd * uTime * 0.05));
  w += flowWaves(p, vel, 0.6) * (0.15 + 0.5 * smoothstep(0.3, 2.0, speed)) + flowWaves(p, vel, 2.1) * 0.25 * smoothstep(0.8, 2.5, speed);
  // (far off the ripples still break the mirror a little: a river kilometres away is not a sheet of glass)
  float fadeN = 0.25 + 0.75 * fade;
  vec3 n = normalize(vec3(w.x * 0.34 * fadeN, 1.0, w.y * 0.34 * fadeN));
  vec3 v = normalize(cameraPosition - vW);
  float cosv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  // what the water lets through over its depth along the view (red first, then green): a peaty, green-brown river
  float path = depth / max(v.y, 0.2);
  vec3 through = exp(-path * vec3(0.95, 0.32, 0.38));
  vec3 body = uDeep * (0.6 + 0.4 * vSun);
  // (the sky it mirrors: seen across the water at a low angle that is the sky near the horizon, the haze's colour, not
  // the blue overhead; far off, a saturated blue line along the horizon otherwise)
  vec3 rfl = reflect(-v, n);
  // (the sky it mirrors, as the sky is: the haze at the horizon rising to the blue overhead, the sun's own glow round
  // where it stands - warm at evening - and, at the lowest angles, the far shore and its woods as a dark band: the rivers
  // had read as flat grey)
  float ry = max(rfl.y, 0.0);
  vec3 sky = mix(uHaze, uSkyTop, pow(clamp(ry * 1.4, 0.0, 1.0), 0.6));
  float sd = max(dot(normalize(rfl), uSunDir), 0.0);
  sky += uSunColor * (0.55 * pow(sd, 6.0) + 0.9 * pow(sd, 48.0)) * (0.6 + 0.4 * vSun);
  sky = mix(sky, uHaze * vec3(0.42, 0.47, 0.40), (1.0 - smoothstep(0.0, 0.045, ry)) * 0.75);
  vec3 hlf = normalize(uSunDir + v);
  float nh = max(dot(n, hlf), 0.0);
  // (the sun's path across the water: a sharp glitter on the ripples' faces and a broad sheen under it)
  vec3 spec = uSunColor * (pow(nh, 220.0) * 3.0 + pow(nh, 28.0) * 0.18) * vSun * treeShade(vW) * (0.35 + 0.65 * fade);
  // foam: a frothy line where the water laps the shore, and the white water of the rapids streaked along the flow
  vec2 along = speed > 0.05 ? vel / speed : wd;
  vec2 fq = vec2(dot(p, along) * 0.35 - uTime * speed * 0.35, dot(p, vec2(-along.y, along.x)) * 1.6);
  float froth = vnoise(fq * 2.0) * 0.6 + vnoise(fq * 5.0 + 3.1) * 0.4;
  float lap = vnoise(p * 2.3 + vec2(uTime * 0.25, 0.0)) * 0.6 + vnoise(p * 6.1 - uTime * 0.3) * 0.4;
  float shoreFoam = smoothstep(0.16, 0.02, depth) * smoothstep(0.5, 0.85, lap) * 0.4;
  // (foam only where it can be seen as foam: kilometres off its streaks are smaller than a pixel and flicker as white
  // dashes along the horizon)
  float foam = clamp(max(shoreFoam, white * smoothstep(0.55 - 0.35 * white, 0.9, froth) * 1.3), 0.0, 1.0) * (1.0 - smoothstep(600.0, 2500.0, d));
  float a = 1.0 - through.g;                                    // (how much of the bed is hidden)
  vec3 c = body * a * (1.0 - fres) + sky * fres + spec;
  float alpha = clamp(a * (1.0 - fres) + fres, 0.0, 1.0);
  vec3 foamCol = vec3(0.92, 0.94, 0.93) * (0.55 + 0.45 * vSun);
  c = mix(c, foamCol, foam); alpha = mix(alpha, 1.0, foam);
  // the haze over it, as over the land (premultiplied: the haze takes the water's share)
  float hz = 1.0 - exp(-d / uHazeDist);
  c = mix(c, uHaze * alpha, hz);
  gl_FragColor = vec4(c, alpha);
}`;

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

/** One grid, shared by every ring: (n + 1)^2 vertices at whole cells from -n/2 to n/2 (the shader scales and places it). */
function ringGeometry(n) {
  const g = new THREE.PlaneGeometry(n, n, n, n).rotateX(-Math.PI / 2);
  return g;
}

// The ground tiles, in the order the land's shader blends them (its layer), each covering m metres: meadow, ploughed
// soil, forest floor, river bank, rock, cart road, city cobbles. Seamless tiles from ComfyUI's material picture and make_tile.py
// (art\comfy\out\pass; detail-pass), at assets/world/ground/<name>.jpg.
export const GROUND = [['meadow', 1.5], ['field-soil', 2.0], ['forest-floor', 1.5], ['bank-pebbles', 2.0], ['rock', 2.0], ['road', 3.0], ['cobble', 2.0], ['forest-debris', 1.5]];
const WAYS_OFF = { uWayT: { value: null }, uWayC: { value: new THREE.Vector2(1e9, 1e9) }, uWaySpan: { value: 512 }, uWayT2: { value: null }, uWayC2: { value: new THREE.Vector2(1e9, 1e9) }, uWaySpan2: { value: 2048 } };
/** Whether the ground's close-up tiles are in (the page holds its veil until they are). */
export const groundLoaded = () => groundU.uGOn.value > 0.5;
const groundU = { uGT: { value: null }, uGOn: { value: 0 }, uGM: { value: GROUND.map((g) => g[1]) }, uGMean: { value: GROUND.map(() => new THREE.Vector3(0.5, 0.5, 0.5)) }, uGOk: { value: GROUND.map(() => 0) },
  // (each ground's depth for its parallax, m: grass and soil shallow, pebbles and rock deeper)
  uGDepth: { value: [0.025, 0.03, 0.04, 0.05, 0.07, 0.035, 0.04, 0.05] } };
// (asked for once, as early as the walk can: countryside.js starts it with the world's pictures)
let groundAsked = null;
export const preloadGround = (base = '') => (groundAsked ??= loadGround(base));
async function loadGround(base) {
  try {
    const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d', { willReadFrequently: true }), data = new Uint8Array(S * S * 4 * GROUND.length);
    for (let i = 0; i < GROUND.length; i++) {
      const img = new Image(); img.src = base + 'assets/world/ground/' + GROUND[i][0] + '.jpg';
      // (a tile not made yet: a plain mid grey in its place, the land's own colour showing through)
      try { await img.decode(); g.drawImage(img, 0, 0, S, S); groundU.uGOk.value[i] = 1; } catch { g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); }   // (and left out of the blend: uGOk)
      const px = g.getImageData(0, 0, S, S).data; data.set(px, i * S * S * 4);
      // (its average colour, in linear light, for tinting: the tile's own colour over it)
      let r = 0, gg = 0, b = 0;
      for (let k = 0; k < px.length; k += 64) { r += px[k]; gg += px[k + 1]; b += px[k + 2]; }
      const nS = px.length / 64, lin = (v) => Math.pow(v / nS / 255, 2.2);
      groundU.uGMean.value[i].set(lin(r), lin(gg), lin(b));
    }
    const t = new THREE.DataArrayTexture(data, S, S, GROUND.length);
    t.format = THREE.RGBAFormat; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = Math.max(8, THREE.Texture.DEFAULT_ANISOTROPY);
    t.needsUpdate = true;
    groundU.uGT.value = t; groundU.uGOn.value = 1;
  } catch (e) { /* (not there: the land as its cover colours alone) */ }
}

/** The land and its water, as rings round the camera. Returns { near, far, update(camPos) }: near (rings to 6 km) goes
 *  in the near world's scene, far (the rest) in the far pass. U: the landscape's uniforms (wind-glsl.js). */
export function buildLand(world, U, opts = {}) {
  // (a machine's coarser rings - hardware.js landN: fewer cells a side and one more ring, so they reach as far)
  const n = opts.n ?? CLIP.n, s0 = CLIP.s0, more = Math.round(Math.log2(CLIP.n / n));
  const levels = CLIP.levels + more, nearLevels = CLIP.nearLevels + more, waterTo = 9 + more;
  const CANOPY_DEF = opts.canopyAt ? `#define CANOPY_AT ${opts.canopyAt.toFixed(1)}\n` : '';
  preloadGround(opts.base ?? '');                           // (the ground tiles, once fetched: up close only)
  const geo = ringGeometry(n);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const looks = {
    uGrassA: { value: lin('#7a8c3c') }, uGrassB: { value: lin('#a7a656') }, uField: { value: lin('#d2b868') }, uFieldB: { value: lin('#b4ae5c') },
    uFieldC: { value: lin('#8fa36a') }, uFallow: { value: lin('#9a8a5e') },
    uWood: { value: lin('#4f6a34') }, uWoodB: { value: lin('#b0923e') }, uRoad: { value: lin('#a08565') }, uTown: { value: lin('#9a9184') }, uRoof: { value: lin('#86705c') },
    uRock: { value: lin('#8a8070') }, uMud: { value: lin('#5c5640') }, uBloom: { value: lin('#e8e0f0') },
    uDeep: { value: lin('#2c4a44') }, uSkyTop: { value: lin('#aab8c6') },
  };
  const near = new THREE.Group(), far = new THREE.Group();
  near.name = 'land-near'; far.name = 'land-far';
  const rings = [];
  for (let l = 0; l < levels; l++) {
    const scale = s0 * 2 ** l;
    const own = { uScale: { value: scale }, uCenter: { value: new THREE.Vector2() }, uHalf: { value: n / 2 }, uInner: { value: new THREE.Vector4(0, 0, 0, 0) } };
    const mk = (mode, frag) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, ...(world.uniforms.uWayT ? {} : WAYS_OFF), ...world.uniforms, ...looks, ...own, ...(mode ? {} : groundU), uMode: { value: mode } },
        // (where the land's painted crowns take over from the trees: as far as the machine draws them, hardware.js)
        vertexShader: CLIP_VERT.replace('//@LAND', CANOPY_DEF + LAND_GLSL),
        fragmentShader: frag.replace('//@LAND', CANOPY_DEF + LAND_GLSL),
      });
      if (mode) {        // (the water over the land: blended, premultiplied, not hiding what is behind it from depth)
        mat.transparent = true; mat.depthWrite = false;
        mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = mode ? 1 : 0;
      return mesh;
    };
    const land = mk(0, LAND_FRAG);
    const water = l <= waterTo ? mk(1, WATER_FRAG) : null;
    const g = l < nearLevels ? near : far;
    g.add(land); if (water) g.add(water);
    rings.push({ l, scale, own, land, water });
  }
  // (a ring's water is drawn only where it has some: its mesh lay 3 m under dry ground, every triangle of it sent to
  // the card for nothing - half the land's triangles anywhere away from a river. The water's cover in cells of 16
  // texels (128 m), summed, so any square is asked in four reads.)
  const C = world.json.core, WQ = 16, wn = Math.ceil(C.px / WQ), wsum = new Uint32Array((wn + 1) * (wn + 1));
  {
    const w = world.core.w, any = new Uint8Array(wn * wn);
    for (let j = 0; j < C.px; j++) { const row = j * C.px, cj = (j / WQ) | 0; for (let i = 0; i < C.px; i++) if (w[row + i]) any[cj * wn + ((i / WQ) | 0)] = 1; }
    for (let j = 0; j < wn; j++) for (let i = 0; i < wn; i++)
      wsum[(j + 1) * (wn + 1) + i + 1] = any[j * wn + i] + wsum[j * (wn + 1) + i + 1] + wsum[(j + 1) * (wn + 1) + i] - wsum[j * (wn + 1) + i];
  }
  const wetIn = (cx, cz, half) => {
    const m = C.span / C.px * WQ;
    const i0 = Math.max(0, Math.floor((cx - half - C.x0) / m) - 1), i1 = Math.min(wn, Math.floor((cx + half - C.x0) / m) + 2);
    const j0 = Math.max(0, Math.floor((cz - half - C.z0) / m) - 1), j1 = Math.min(wn, Math.floor((cz + half - C.z0) / m) + 2);
    if (i1 <= i0 || j1 <= j0) return false;
    return wsum[j1 * (wn + 1) + i1] - wsum[j0 * (wn + 1) + i1] - wsum[j1 * (wn + 1) + i0] + wsum[j0 * (wn + 1) + i0] > 0;
  };
  const update = (cam) => {
    let inner = null;
    for (const r of rings) {
      const step = 2 * r.scale;
      const cx = Math.floor(cam.x / step) * step, cz = Math.floor(cam.z / step) * step;
      r.own.uCenter.value.set(cx, cz);
      if (r.water) r.water.visible = wetIn(cx, cz, (n / 2 + 2) * r.scale);
      // the first ring of the far pass leaves the near pass's square to it
      if (inner) r.own.uInner.value.set(inner[0], inner[1], inner[2] - inner[3] * 0.25, 1);
      else r.own.uInner.value.set(0, 0, 0, 0);
      inner = [cx, cz, (n / 2) * r.scale, r.scale];
    }
  };
  return { near, far, update, rings };
}
