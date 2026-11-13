// How the birches look up close: their leaves and their bark, at full resolution.
//
// Leaves: the scene workflow grows each leaf as a little fan of six points (its stalk first). Each fan is opened out
// into a card the shape of a birch leaf (the leaf drawn here once: pointed, doubly serrated, its midrib and veins), and
// each leaf gets its own green (from a birch's summer greens), darker the deeper it hangs inside the crown.
// Bark: drawn in the shader, so it is sharp at any distance: chalk-white papery bands, short dark lenticels across the
// trunk, black marks (the model's own, and rough bands), the dark, fissured bark at the foot of the trunk, with relief
// that catches the light. Its size is real: each ring of the trunk knows its radius.
import * as THREE from 'three';
import { loadPictureAsync } from '../texcap.js';

let leafTex = null;
/** The birch leaf, drawn once: stalk at the bottom centre, tip at the top centre; alpha outside it. */
export function leafTexture() {
  if (leafTex) return leafTex;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // the outline: half-width along the midrib (0 at the stalk's end .. 1 at the tip), a birch's: widest a third of the
  // way up, drawn out to a long point, its margin doubly serrated
  const stalk = 0.1, half = (t) => {
    if (t < stalk) return 0.018;
    const u = (t - stalk) / (1 - stalk);
    let w = 0.44 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.18) ** 0.62), 1.05) * (1 - 0.35 * u);
    if (u > 0.8) w *= Math.max(0, (1 - u) / 0.2) ** 0.8;
    const big = (u * 11) % 1, small = (u * 33) % 1;
    return Math.max(0, w * (1 - 0.07 * big - 0.03 * small) * (u > 0.02 ? 1 : u / 0.02));
  };
  const X = (x) => S * (0.5 + x), Y = (t) => S * (1 - (0.01 + 0.98 * t));
  const path = new Path2D(), N = 160;
  path.moveTo(X(0), Y(0));
  for (let i = 0; i <= N; i++) { const t = i / N; path.lineTo(X(-half(t)), Y(t)); }
  for (let i = N; i >= 0; i--) { const t = i / N; path.lineTo(X(half(t)), Y(t)); }
  path.closePath();
  // the blade: lighter along the midrib, a little darker at the margin
  const grd = g.createLinearGradient(X(-0.45), 0, X(0.45), 0);
  grd.addColorStop(0, '#b8b8b8'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#b0b0b0');
  g.fillStyle = grd;
  g.fill(path);
  g.save(); g.clip(path);
  // a soft mottle
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 6;
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,90,90'},0.05)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // the midrib and the veins: straight, paired, running out toward the teeth
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineCap = 'round';
  g.lineWidth = 3; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(0.97)); g.stroke();
  g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let k = 0; k < 8; k++) {
    const t0 = stalk + 0.06 + k * 0.095, t1 = t0 + 0.13;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(0), Y(t0)); g.lineTo(X(s * half(t1) * 0.92), Y(t1)); g.stroke(); }
  }
  g.restore();
  // the stalk below the blade
  g.strokeStyle = '#8a8a7a'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(stalk + 0.02)); g.stroke();
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return leafTex;
}

// a birch's summer greens (sunlit, fresh, mid, deep), as the leaves are tinted
const GREENS = ['#a7c45a', '#8db24a', '#78a03f', '#5f8834', '#6f9a3c'].map((h) => new THREE.Color(h).convertSRGBToLinear());

/**
 * Open each leaf's fan (six points: the stalk, then round the outline) into a card the leaf texture fits: the stalk
 * at the middle of the card's foot, the tip at the middle of its head; each leaf its own green, darker deep in the crown.
 */
export function rebuildLeaves(geo, seed = 1, species = 'birch') {
  const PAL = SPECIES[species] ? SPECIES[species].greens.map((h) => new THREE.Color(h).convertSRGBToLinear()) : GREENS, cardW = SPECIES[species]?.cardW ?? 1;
  const P = geo.attributes.position, n = P.count;
  if (n % 6 && n % 4 === 0) return quadLeaves(geo, seed, PAL);
  if (n % 6) return;
  const leaves = n / 6;
  geo.userData.leafVerts = 6;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const v = Array.from({ length: 6 }, () => new THREE.Vector3()), axis = new THREE.Vector3(), across = new THREE.Vector3(), nrm = new THREE.Vector3(), d = new THREE.Vector3();
  // how far out the crown reaches at each height (for the leaves' depth in it)
  const BINS = 14, rad = Array.from({ length: BINS }, () => []);
  let ymin = Infinity, ymax = -Infinity;
  for (let k = 0; k < leaves; k++) { const y = P.getY(6 * k); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const bin = (y) => Math.min(BINS - 1, Math.max(0, Math.floor(((y - ymin) / Math.max(1e-6, ymax - ymin)) * BINS)));
  for (let k = 0; k < leaves; k++) { const i = 6 * k; rad[bin(P.getY(i))].push(Math.hypot(P.getX(i), P.getZ(i))); }
  const reach = rad.map((r) => { if (!r.length) return 1; r.sort((a, b) => a - b); return Math.max(0.3, r[Math.floor(r.length * 0.9)]); });
  let s = seed * 9973 + 7;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const UVS = [[0.5, 0], [0, 0], [0, 1], [0.5, 1], [1, 1], [1, 0]];
  for (let k = 0; k < leaves; k++) {
    const i0 = 6 * k;
    for (let j = 0; j < 6; j++) v[j].fromBufferAttribute(P, i0 + j);
    let tip = 3, far = 0;
    for (let j = 1; j < 6; j++) { const L = v[j].distanceTo(v[0]); if (L > far) { far = L; tip = j; } }
    axis.subVectors(v[tip], v[0]).normalize();
    across.subVectors(v[2], v[4]); across.addScaledVector(axis, -across.dot(axis));
    if (across.lengthSq() < 1e-10) across.set(axis.y, -axis.x, 0);
    across.normalize();
    let W = 0;
    for (let j = 1; j < 6; j++) W = Math.max(W, Math.abs(d.subVectors(v[j], v[0]).dot(across)));
    W = Math.max(W * 2.1, far * 0.58) * 0.88 * cardW;
    const L = far * 0.95;
    nrm.crossVectors(across, axis).normalize();
    const corners = [[0, 0], [-0.5, 0], [-0.5, 1], [0, 1], [0.5, 1], [0.5, 0]];
    for (let j = 0; j < 6; j++) {
      const [a, b] = corners[j], o = i0 + j;
      d.copy(v[0]).addScaledVector(across, a * W).addScaledVector(axis, b * L);
      pos.set([d.x, d.y, d.z], o * 3);
      nor.set([nrm.x, nrm.y, nrm.z], o * 3);
      uv.set(UVS[j], o * 2);
    }
    // its green, and how deep in the crown it hangs (the inner leaves are in the others' shade)
    const c = PAL[Math.floor(rng() * PAL.length)].clone().multiplyScalar(0.86 + 0.3 * rng());
    const depth = Math.min(1, Math.hypot(v[0].x, v[0].z) / reach[bin(v[0].y)]);
    const top = (v[0].y - ymin) / Math.max(1e-6, ymax - ymin);
    c.multiplyScalar((0.42 + 0.58 * THREE.MathUtils.smoothstep(depth, 0.25, 0.95)) * (0.88 + 0.16 * top));
    for (let j = 0; j < 6; j++) col.set([c.r, c.g, c.b], (i0 + j) * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

// The far copy's leaves are already cards of four (two triangles each): the leaf texture laid over each, stalk at the
// middle of its first edge, and each its own green, darker inside the crown.
function quadLeaves(geo, seed, PAL = GREENS) {
  const P = geo.attributes.position, n = P.count, leaves = n / 4, uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  geo.userData.leafVerts = 4;
  let s = seed * 7919 + 3;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let ymin = Infinity, ymax = -Infinity, rmax = 0.3;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, P.getY(i)); ymax = Math.max(ymax, P.getY(i)); rmax = Math.max(rmax, Math.hypot(P.getX(i), P.getZ(i))); }
  const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let k = 0; k < leaves; k++) {
    const i0 = 4 * k;
    const c = PAL[Math.floor(rng() * PAL.length)].clone().multiplyScalar(0.86 + 0.3 * rng());
    const x = P.getX(i0), y = P.getY(i0), z = P.getZ(i0), depth = Math.hypot(x, z) / rmax, top = (y - ymin) / Math.max(1e-6, ymax - ymin);
    c.multiplyScalar((0.5 + 0.5 * THREE.MathUtils.smoothstep(depth, 0.15, 0.85)) * (0.88 + 0.16 * top));
    for (let j = 0; j < 4; j++) { uv.set(UVS[j], (i0 + j) * 2); col.set([c.r, c.g, c.b], (i0 + j) * 3); }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * How big the bark's texture coordinates are on the limb: metres per unit of u (round it) and of v (along it), at each
 * point (aBarkScale), from the triangles round it, so the bark can be drawn at its real size whatever the limb's girth.
 */
export function addBarkScale(geo) {
  const P = geo.attributes.position, UV = geo.attributes.uv, I = geo.index, n = P.count;
  if (!UV) return;
  const su = new Float32Array(n), sv = new Float32Array(n), w = new Float32Array(n);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3();
  const tris = I ? I.count / 3 : n / 3, at = (k) => (I ? I.getX(k) : k);
  for (let t = 0; t < tris; t++) {
    const a = at(3 * t), b = at(3 * t + 1), c = at(3 * t + 2);
    p0.fromBufferAttribute(P, a); p1.fromBufferAttribute(P, b); p2.fromBufferAttribute(P, c);
    const d1x = UV.getX(b) - UV.getX(a), d1y = UV.getY(b) - UV.getY(a), d2x = UV.getX(c) - UV.getX(a), d2y = UV.getY(c) - UV.getY(a);
    const det = d1x * d2y - d2x * d1y;
    if (Math.abs(det) < 1e-9) continue;
    e1.subVectors(p1, p0); e2.subVectors(p2, p0);
    du.copy(e1).multiplyScalar(d2y).addScaledVector(e2, -d1y).multiplyScalar(1 / det);
    dv.copy(e2).multiplyScalar(d1x).addScaledVector(e1, -d2x).multiplyScalar(1 / det);
    const lu = du.length(), lv = dv.length();
    if (!(lu < 50 && lv < 50)) continue;
    for (const k of [a, b, c]) { su[k] += lu; sv[k] += lv; w[k] += 1; }
  }
  const out = new Float32Array(n * 2);
  let lu = 0.2, lv = 0.4;
  for (let k = 0; k < n; k++) { if (w[k]) { lu = su[k] / w[k]; lv = sv[k] / w[k]; } out[2 * k] = lu; out[2 * k + 1] = lv; }
  geo.setAttribute('aBarkScale', new THREE.BufferAttribute(out, 2));
  // each limb (a piece of the mesh joined by its triangles): how many units of u go once round it (its texture
  // coordinates wrap there) and its girth at its thickest (m), for bark that meets itself round the limb
  const par = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let t = 0; t < tris; t++) { const a = find(at(3 * t)), b = find(at(3 * t + 1)), c = find(at(3 * t + 2)); par[b] = a; par[find(c)] = a; }
  const umax = new Map(), girth = new Map();
  for (let k = 0; k < n; k++) { const r = find(k); umax.set(r, Math.max(umax.get(r) ?? 0, UV.getX(k))); }
  for (let k = 0; k < n; k++) { const r = find(k), W = umax.get(r); girth.set(r, Math.max(girth.get(r) ?? 0, out[2 * k] * (W > 0.05 ? (Math.abs(W - Math.round(W)) < 0.05 ? Math.round(W) : W) : 1))); }
  const wrap = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const r = find(k); let W = umax.get(r);
    W = W > 0.05 ? (Math.abs(W - Math.round(W)) < 0.05 ? Math.round(W) : W) : 1;
    wrap[2 * k] = W; wrap[2 * k + 1] = girth.get(r);
  }
  geo.setAttribute('aWrap', new THREE.BufferAttribute(wrap, 2));
}

// ---- the other trees of the woods: spruce, pine and oak, each with its own bark and its own foliage ----
// Their bark: seamless tiles drawn in ComfyUI (the material template, then make_tile.py; art\comfy\out\pass), each
// covering SPECIES[sp].tile metres (round, along; set by eye against the trunk's girth up close); a pine's turns from the dark furrowed plates at its foot to thin
// orange flakes higher up. Their foliage: a ComfyUI picture of a spruce shoot, a pine's tuft of needles, an oak leaf,
// cut out (dev\world\species\cutout.py), laid on each leaf card as the birch's drawn leaf is; the picture is already
// green, so each leaf's tint (greens) is a light one that only varies it a little.
export const SPECIES = {
  spruce: { bark: 'spruce-bark.jpg', tile: [0.3, 0.55], leaf: 'leaf-spruce.png', greens: ['#e6ecdc', '#d4dccb', '#f2f2e6', '#c6d0bc', '#dce6d0'], cardW: 1.35 },
  pine: { bark: 'pine-bark-low.jpg', bark2: 'pine-bark-high.jpg', tile: [0.4, 0.8], tile2: [0.28, 0.56], leaf: 'leaf-pine.png', greens: ['#f0f0dc', '#e2e8cc', '#fff8e4', '#d6dcc0', '#eaf0d4'], cardW: 1.5 },
  oak: { bark: 'oak-bark.jpg', tile: [0.32, 0.55], leaf: 'leaf-oak.png', greens: ['#f2f2e2', '#dfe6c8', '#fff4d8', '#d2dab8', '#f4e8c0'], cardW: 1.0 },
  // (the cities' park trees, 13 Nov 2026 - dev\world\parks.py; their pictures loaded with them, once the cities come in:
  // loadLateSpecies)
  lime: { bark: 'lime-bark.jpg', tile: [0.4, 0.4], leaf: 'leaf-lime.png', greens: ['#eef2dc', '#e0e8c8', '#f6f6e0', '#d6e0bc', '#eaf0d0'], cardW: 0.9, late: true },
  maple: { bark: 'maple-bark.jpg', tile: [0.4, 0.4], leaf: 'leaf-maple.png', greens: ['#f2f4dc', '#e4ecc8', '#fff8dc', '#dce4bc', '#f4ecc4'], cardW: 1.2, late: true },
  poplar: { bark: 'poplar-bark.jpg', tile: [0.45, 0.45], leaf: 'leaf-poplar.png', greens: ['#eef4dc', '#e2eccc', '#f4f8e4', '#d8e4c0', '#eaf2d6'], cardW: 0.85, late: true },
  lilac: { bark: 'lilac-bark.jpg', tile: [0.18, 0.18], leaf: 'leaf-lilac.png', greens: ['#e6ecd4', '#d8e2c4', '#eef0dc', '#ccd8b8', '#e2e8cc'], cardW: 0.8, late: true },
};
export const speciesOf = (name) => (/^spruce/.test(name) ? 'spruce' : /^pine/.test(name) ? 'pine' : /^oak/.test(name) ? 'oak'
  : /^lime/.test(name) ? 'lime' : /^maple/.test(name) ? 'maple' : /^poplar/.test(name) ? 'poplar' : /^lilac/.test(name) ? 'lilac' : 'birch');
const spTex = {};
/** Loads the woods' bark tiles and leaf pictures (assets/countryside/species/); what is missing is drawn as a birch's. */
export async function loadSpecies(base, late = false) {
  const get = async (f, alpha) => {
    try {
      const t = await loadPictureAsync(base + 'assets/countryside/species/' + f, { cap: false });
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      if (!alpha) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      return t;
    } catch { return null; }
  };
  await Promise.all(Object.entries(SPECIES).filter(([, S]) => !S.late || late).map(async ([sp, S]) => {
    if (spTex[sp]) return;
    spTex[sp] = { bark: await get(S.bark), bark2: S.bark2 ? await get(S.bark2) : null, leaf: await get(S.leaf, true) };
  }));
}
/** The park trees' bark and leaves (SPECIES' late ones), asked for once the cities come in. */
let lateIn = null;
export const loadLateSpecies = (base) => (lateIn ??= loadSpecies(base, true));
export const speciesTex = (sp) => spTex[sp] ?? {};

// the bark, drawn: (albedo, and a height for its relief) at a point m metres round and along the limb, h m above the
// ground, with the model's own texture's lightness (its marks) and a seed for this tree
// The bark's tile (once fetched: the scene loads it, uBarkOn 0..1): my ComfyUI painting of a birch trunk, unrolled and
// made to repeat both ways (site-dev/countryside/bark.py), uBarkTile metres round and along
export const BARK = { uBarkTex: { value: null }, uBarkTile: { value: new THREE.Vector2(0.2309, 0.5961) }, uBarkOn: { value: 0 } };
export async function loadBark(base) {
  try {
    const t = await loadPictureAsync(base + 'assets/countryside/bark.webp', { cap: false });
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    BARK.uBarkTex.value = t; BARK.uBarkOn.value = 1;
  } catch { /* (not there: the bark as drawn in code) */ }
}

export const BARK_GLSL = /* glsl */`
uniform sampler2D uBarkTex; uniform vec2 uBarkTile; uniform float uBarkOn;
float bh21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bh21(i), bh21(i + vec2(1, 0)), f.x), mix(bh21(i + vec2(0, 1)), bh21(i + vec2(1, 1)), f.x), f.y); }
// (Round the limb the bark must meet itself, or a seam shows where its texture coordinates wrap: noise is taken on the
// limb's own circle, gU of gW turns (vWrap.x) round it, gC metres for each unit of u; a texture repeats a whole number
// of times round each limb (its girth at its thickest, vWrap.y, so the count is the same all along it).)
float gU, gW, gC, gG; vec2 gM;
float bh31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float bn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bh31(i), bh31(i + vec3(1, 0, 0)), f.x), mix(bh31(i + vec3(0, 1, 0)), bh31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bh31(i + vec3(0, 0, 1)), bh31(i + vec3(1, 0, 1)), f.x), mix(bh31(i + vec3(0, 1, 1)), bh31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float bnm(vec2 fr, float off) {
  float th = 6.2831853 * gU / gW, R = gW * gC * fr.x / 6.2831853;
  return bn3(vec3(cos(th) * R + off, sin(th) * R - off * 0.37, gM.y * fr.y + off * 1.7)); }
float turnTiles(float tileM) { return gU / gW * max(1.0, floor(gG / tileM + 0.5)); }
float turnCells(float cellM) { return gU / gW * max(1.0, floor(gW * gC / cellM + 0.5)); }
// the painted bark at m (metres round, along): the tile, and again mirrored and shifted, taken in turn in patches a
// half metre or so across, so that its repeats never line up round a trunk
vec3 barkPhoto(vec2 m) {
  // (rows up the trunk with wavy edges, each turned its own way round, so the tile's rows never show as bands)
  float v = m.y / uBarkTile.y + 0.45 * (bnm(vec2(2.5, 0.35), 4.0) - 0.5), row = floor(v);
  vec2 uv = vec2(turnTiles(uBarkTile.x) + fract(sin(row * 91.7) * 43758.5), v);
  float v2 = v * 0.93 + 0.29 + 0.3 * (bnm(vec2(1.9, 0.5), 8.0) - 0.5), row2 = floor(v2);
  vec2 uv2 = vec2(-turnTiles(uBarkTile.x) + fract(sin(row2 * 47.3) * 23421.6), v2);
  float k = smoothstep(0.35, 0.65, bnm(vec2(1.7, 0.6), 5.0));
  return mix(texture2D(uBarkTex, uv).rgb, texture2D(uBarkTex, uv2).rgb, k);
}
vec3 birchBark(vec2 m, float h, float own, out float relief) {
  // the white: a bright chalk, clouded faintly warm and cool, in thin papery bands that peel across the trunk
  float cloud = bnm(vec2(2.2, 0.9), 0.0) * 0.6 + bnm(vec2(7.0, 2.6), 0.0) * 0.4;
  float bands = bnm(vec2(2.2, 42.0), 0.0) * 0.6 + bnm(vec2(5.0, 115.0), 0.0) * 0.4;
  vec3 white = mix(vec3(0.68, 0.67, 0.63), vec3(0.84, 0.83, 0.79), cloud);
  white = mix(white, vec3(0.80, 0.72, 0.68), 0.28 * smoothstep(0.62, 0.85, bnm(vec2(1.1, 0.5), 7.0)));   // a peachy cast
  white *= 0.9 + 0.13 * bands;
  // lenticels: dark dashes across the trunk, two to nine centimetres long, a few millimetres tall, in loose bands
  vec2 cs = vec2(0.095, 0.03), q = vec2(turnCells(cs.x), m.y / cs.y + 0.25 * sin(turnCells(0.7) * 6.2831853 + bnm(vec2(3.0), 0.0) * 4.0)), id = floor(q), f = fract(q);
  float r = bh21(id + 3.7);
  float len = 0.35 + 0.6 * fract(r * 7.31), tk = 0.08 + 0.13 * fract(r * 3.17), cx = 0.5 + (fract(r * 5.71) - 0.5) * (1.0 - len);
  float lx = abs(f.x - cx) / (len * 0.5), ly = abs(f.y - 0.5) / tk;
  float lent = step(r, 0.3 + 0.35 * bnm(vec2(1.5, 4.0), 0.0)) * (1.0 - smoothstep(0.6, 1.0, lx)) * (1.0 - smoothstep(0.4, 1.0, ly));
  // black marks: ragged patches drawn out across the trunk (torn at their edges, finer and finer), and now and then a
  // broad black band part way round
  float rough = bnm(vec2(3.5, 6.0), 3.0) * 0.5 + bnm(vec2(11.0, 24.0), 0.0) * 0.3 + bnm(vec2(38.0, 85.0), 0.0) * 0.2;
  float mark = smoothstep(0.645, 0.67, rough) * 0.95;
  mark = max(mark, smoothstep(0.72, 0.745, bnm(vec2(0.8, 2.2), 9.0) * 0.7 + bnm(vec2(9.0, 20.0), 0.0) * 0.2 + bnm(vec2(40.0, 90.0), 0.0) * 0.1) * 0.95);
  mark = max(mark, (1.0 - smoothstep(0.02, 0.05, own)) * 0.5);
  // the foot of the trunk: grey bark split by deep dark cracks, up to a half metre or a metre, fading up into the
  // white raggedly; between the cracks the ridges are grey, with the white showing through more the higher they go
  float foot = 0.45 + 0.6 * bnm(vec2(1.4, 0.0), 1.7);
  float base = (1.0 - smoothstep(foot - 0.35, foot + 0.3, h)) * 0.9;
  float fis = bnm(vec2(16.0, 2.2), 0.0) * 0.7 + bnm(vec2(40.0, 6.0), 0.0) * 0.3;
  vec3 c = white;
  // (each lenticel its own darkness, and a fine grain over all of the bark)
  c = mix(c, vec3(0.08, 0.07, 0.065) * (1.0 + 2.2 * fract(r * 13.7)), lent * (0.75 + 0.2 * fract(r * 2.9)));
  c *= 0.93 + 0.1 * bnm(vec2(140.0, 60.0), 0.0);
  relief = -lent * 0.5 + bands * 0.25;
  // the painted bark in place of the drawn white and its lenticels, once it is here (its own darks sunk a little)
  if (uBarkOn > 0.0) {
    vec3 p = barkPhoto(m) * mix(0.96, 1.04, cloud);
    c = mix(c, p, uBarkOn);
    relief = mix(relief, (dot(p, vec3(0.2126, 0.7152, 0.0722)) - 0.62) * 1.4, uBarkOn);
  }
  // (a mark is the bark gone black, its grain still in it)
  c = mix(c, c * vec3(0.07, 0.065, 0.06) + vec3(0.012, 0.011, 0.01) * (0.6 + bnm(vec2(34.0), 0.0)), mark);
  float crack = 1.0 - smoothstep(0.38, 0.6, fis);
  vec3 ridge = mix(vec3(0.24, 0.225, 0.2) * (0.8 + 0.4 * bnm(vec2(9.0, 3.0), 0.0)), c, 0.4 * clamp(h / max(foot, 0.1), 0.0, 1.0));
  c = mix(c, mix(ridge, vec3(0.045, 0.04, 0.036), crack), base);
  relief += -mark * 0.35 + base * (fis - 0.55) * 2.0;
  return c;
}
// the other trees' bark, from their tiles: a whole number of tiles round each limb, two takes of the tile (the second
// mirrored and shifted) in patches so its repeats never line up, darker in the furrows; a pine's turns from the
// furrowed plates at its foot to orange flakes from a third of the way up. Relief from the tile's light and dark.
uniform sampler2D uSpA; uniform sampler2D uSpB; uniform vec2 uSpTileA; uniform vec2 uSpTileB; uniform float uSpHi; float gT;
vec3 spTake(sampler2D t, vec2 tile) {
  // (the rows of tiles up the trunk: their edges wavy, each row turned its own way round the trunk, so no band shows)
  float v = gM.y / tile.y + 0.45 * (bnm(vec2(2.5, 0.35), 4.0) - 0.5);
  float row = floor(v), sh = fract(sin(row * 91.7) * 43758.5);
  vec2 uv = vec2(turnTiles(tile.x) + sh, v);
  float v2 = v * 0.93 + 0.41 + 0.3 * (bnm(vec2(1.9, 0.5), 8.0) - 0.5), row2 = floor(v2);
  vec2 uv2 = vec2(-turnTiles(tile.x) + fract(sin(row2 * 47.3) * 23421.6), v2);
  float k = smoothstep(0.3, 0.7, bnm(vec2(1.3, 0.9), 11.0));
  return mix(texture2D(t, uv).rgb, texture2D(t, uv2).rgb, k);
}
vec3 speciesBark(float h, out float relief) {
  vec3 c = spTake(uSpA, uSpTileA);
#ifdef BARK_PINE
  float up = smoothstep(uSpHi - 0.08, uSpHi + 0.12, gT + (bnm(vec2(0.9, 0.7), 3.0) - 0.5) * 0.18);
  c = mix(c, spTake(uSpB, uSpTileB), up);
#endif
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= 0.9 + 0.2 * bnm(vec2(2.0, 0.8), 5.0);
#ifdef BARK_OAK
  // (moss on the oak's foot, more on one side)
  float moss = (1.0 - smoothstep(0.3, 1.6, h)) * smoothstep(0.35, 0.7, bnm(vec2(3.0, 2.0), 7.0) + 0.25 * cos(6.2831853 * gU / gW));
  c = mix(c, vec3(0.16, 0.22, 0.07) * (0.7 + 0.6 * bnm(vec2(30.0, 30.0), 2.0)), moss * 0.85);
#endif
  relief = (l - 0.3) * 2.6;
  return c;
}
// (three.js's own bump-mapping, which a material without a bump map leaves out)
vec3 barkBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)), vSigmaY = normalize(dFdy(surf_pos.xyz)), vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`;
