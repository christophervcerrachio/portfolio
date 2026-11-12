// The countryside's models: made by my own ComfyUI scene workflow ("Make a scene": FLUX.2 Klein draws each object,
// TRELLIS.2 or the plant grower makes it 3D, it is fitted, cleaned and given a close copy and a far one;
// site-dev/comfy/countryside_scene_spec.json). Here they are loaded, copied many times over (instanced), lit by the
// scene's sun (as much as the clouds let through) and sky, and moved by the wind (wind-glsl.js): a plant bends from its
// root, more the higher up, leans with each gust as it passes, and each of a tree's leaves flutters on its stalk.
import * as THREE from 'three';
import { gltfLoader } from '../gltf.js';
import { WIND_GLSL } from './wind-glsl.js';
import { SHADOW_GLSL } from './sunshadow.js';
import { leafTexture, rebuildLeaves, addBarkScale, BARK_GLSL, BARK, SPECIES, speciesOf, speciesTex } from './birchlook.js';

/**
 * A model: { near, far } (each a list of parts: { geometry, material, kind: 'bark' | 'leaves' | 'body' }), its height
 * (m, as fitted), and what the workflow says of it (extras: sway, kind, size). Files: <name>.near.glb, <name>.far.glb
 * (either may be missing: a far-only model, a near-only one).
 */
export async function loadModel(base, name, { near = true, far = true } = {}) {
  const loader = gltfLoader(), out = { name, near: null, far: null, height: 1, extras: {} };
  const read = async (file) => {
    const gltf = await loader.loadAsync(base + file);
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse((o) => {
      if (o.userData?.object) out.extras = o.userData;
      if (!o.isMesh) return;
      const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const mname = o.material.name ?? '';
      const kind = /leaves/.test(mname) ? 'leaves' : /bark/.test(mname) ? 'bark' : 'body';
      if (kind === 'leaves') { rebuildLeaves(geometry, name.length * 31 + file.length, speciesOf(name)); addLeafBases(geometry); }
      if (kind === 'bark') addBarkScale(geometry);
      parts.push({ geometry, material: o.material, kind });
    });
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    out.height = Math.max(out.height, box.max.y);
    return parts;
  };
  const tasks = [];
  if (near) tasks.push(read(`${name}.near.glb`).then((p) => { out.near = p; }).catch(() => {}));
  if (far) tasks.push(read(`${name}.far.glb`).then((p) => { out.far = p; }).catch(() => {}));
  await Promise.all(tasks);
  return out.near || out.far ? out : null;
}

/** A tree's leaves come as little fans of six vertices (cards of four, far off), the first at the stalk: each vertex
 *  learns its leaf's stalk. */
function addLeafBases(g) {
  const p = g.attributes.position, n = p.count, base = new Float32Array(n * 3), per = g.userData.leafVerts ?? 6;
  for (let i = 0; i < n; i++) { const b = i - (i % per); base[i * 3] = p.getX(b); base[i * 3 + 1] = p.getY(b); base[i * 3 + 2] = p.getZ(b); }
  g.setAttribute('aLeafBase', new THREE.BufferAttribute(base, 3));
}

// The wind, worked into three.js's own materials: after the copy is placed, its vertices are moved in the world.
const WIND_VERT = /* glsl */`
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  mat4 placeM = modelMatrix * instanceMatrix;
#else
  mat4 placeM = modelMatrix;
#endif
vec4 wp = modelMatrix * mvPosition;
vec3 rootW = (placeM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float scaleW = length(placeM[1].xyz);
float Hm = uModelH * scaleW;                                  // this copy's height, in metres
vSunVis = sunThrough(rootW + vec3(0.0, Hm * 0.6, 0.0));       // (the clouds' shadow is far bigger than a tree)
float seedW = fract(sin(dot(rootW.xz, vec2(12.9898, 78.233))) * 43758.5453);
float riseW = riseAt(rootW.xz, seedW);                        // (the opening: risen out of the ground, wind-glsl.js)
float t = clamp((wp.y - rootW.y) / Hm, 0.0, 1.3);
// (a tree's own wind, slower than the grass's. The grass's wind flutters at a stem's pace and quickens in a gust; a
// trunk sways at a second or two a swing, bends well over in a gust and comes back slowly, its crown leaning, not
// shivering)
float g = gustAt(rootW);
float Lw = uWindLevel;
float swing = sin(uTime * (0.55 + 0.25 * seedW) + seedW * 37.0) + 0.45 * sin(uTime * (0.93 + 0.2 * seedW) + seedW * 11.0);
float lean = (0.03 + 0.03 * vnoise(rootW.xz * 0.02 + uWindDir * uTime * 0.12)) * Lw + 0.6 * g;
vec2 perpW = vec2(-uWindDir.y, uWindDir.x);
vec3 w = vec3(uWindDir * (lean + swing * (0.006 * Lw + 0.05 * g)) + perpW * swing * (0.004 * Lw + 0.03 * g), g);
float bendK = 1.9;                                          // (bendier: the crown carries the trunk's bend further over)
vec3 off = vec3(w.x, 0.0, w.y) * (Hm * t * t * uSway * bendK);
off.y -= dot(w.xy, w.xy) * Hm * t * t * uSway * bendK * 0.5;
// a crown's boughs move each their own way a little, more in a gust
// (each bough a slow sway of its own, a few metres across, no quick wobble)
float bough = (vnoise(wp.xz * 0.18 + vec2(wp.y * 0.12) + uTime * 0.3) - 0.5) * 2.0;
off += vec3(uWindDir.x, 0.1, uWindDir.y) * bough * t * t * uBough * Hm * (0.005 + 0.035 * g);   // (still between gusts; tossed in one)
#ifdef WIND_LEAVES
  // each leaf flutters on its stalk
  vec3 baseW = (placeM * vec4(aLeafBase, 1.0)).xyz;
  float ls = fract(sin(dot(baseW, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float a = (0.1 + 0.4 * g) * sin(uTime * (2.0 + 1.6 * ls) + ls * 40.0);   // (a leaf turns a little on its stalk; more in a gust)
  vec3 axis = normalize(vec3(sin(ls * 17.0), 0.35, cos(ls * 11.0)));
  vec3 rel = wp.xyz - baseW;
  #ifdef LEAF_GROW
    // (the close copy's leaves: a big crown's cards are few for its size, and small cards thin out to a few pixels, so
    // each grows a little with its model's sparseness past arm's length, and more with distance, so the crown stays as
    // full as the far copy)
    float dLeaf = length(baseW - cameraPosition);
    rel *= mix(1.0, uLeafGrow, smoothstep(3.0, 20.0, dLeaf)) * clamp(dLeaf / 70.0, 1.0, 2.4);
  #endif
  rel = rel * cos(a) + cross(axis, rel) * sin(a) + axis * dot(axis, rel) * (1.0 - cos(a));
  wp.xyz = baseW + rel;
#endif
wp.xyz += off;
wp.y -= (1.0 - riseW) * (Hm * 1.05 + 0.6);
vWPos = wp.xyz;
mvPosition = viewMatrix * wp;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * A material from the model, with the wind in it and the scene's look: kind 'bark' (a birch's, drawn at full
 * resolution: birchlook.js), 'leaves' (leaf cards, each its own green), 'body' (as made). U: the shared uniforms.
 */
export function windMaterial(src, { kind, height, sway = 0, bough = 1, U, look = {}, species = 'birch' }) {
  const m = src.clone(), T = speciesTex(species), S = SPECIES[species];
  const ownBark = kind === 'bark' && S && T.bark;           // (a spruce's, pine's or oak's own bark, once its tile is here)
  m.side = kind === 'leaves' || src.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide;
  if (kind === 'leaves' && look.cards) {
    m.map = T.leaf ?? leafTexture(); m.vertexColors = true; m.color.setRGB(1, 1, 1);
    m.alphaTest = 0.5; m.alphaToCoverage = true; m.roughness = 0.45; m.metalness = 0;
  }
  if (kind === 'bark') { m.roughness = 0.8; m.metalness = 0; }
  if (ownBark) m.defines = { ...(m.defines ?? {}), BARK_SPECIES: 1, ...(species === 'pine' ? { BARK_PINE: 1 } : {}), ...(species === 'oak' ? { BARK_OAK: 1 } : {}) };
  const spU = ownBark ? { uSpA: { value: T.bark }, uSpB: { value: T.bark2 ?? T.bark }, uSpTileA: { value: new THREE.Vector2(...S.tile) },
    uSpTileB: { value: new THREE.Vector2(...(S.tile2 ?? S.tile)) }, uSpHi: { value: 0.32 } } : {};
  const own = { uModelH: { value: height }, uSway: { value: sway * 0.55 }, uBough: { value: bough },
    uLeafGain: { value: new THREE.Vector3(...(look.leafGain ?? [1, 1, 1])) }, uLeafGrow: { value: look.leafGrow ?? 1 } };
  if (kind === 'leaves' && look.leafGrow) m.defines = { ...(m.defines ?? {}), LEAF_GROW: 1 };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, own, kind === 'bark' ? BARK : {}, spU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uModelH; uniform float uSway; uniform float uBough; uniform float uLeafGrow; varying float vSunVis; varying vec3 vWPos;\n${kind === 'leaves' ? 'attribute vec3 aLeafBase;' : ''}${kind === 'bark' ? 'attribute vec2 aBarkScale; attribute vec2 aWrap; varying vec2 vBarkScale; varying vec2 vWrap; varying float vHgt; varying float vHf; varying float vSeedB; varying vec2 vBarkUv;' : ''}`)
      .replace('#include <project_vertex>', WIND_VERT);
    if (kind === 'leaves') sh.vertexShader = '#define WIND_LEAVES\n' + sh.vertexShader;
    if (kind === 'bark') sh.vertexShader = sh.vertexShader.replace('vWPos = wp.xyz;', 'vWPos = wp.xyz; vBarkScale = aBarkScale * scaleW; vWrap = vec2(aWrap.x, aWrap.y * scaleW); vHgt = t * Hm; vHf = t; vSeedB = seedW; vBarkUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec3 uLeafGain; varying float vSunVis; varying vec3 vWPos;\nuniform vec3 uSunDir; uniform vec3 uSunColor;\n${SHADOW_GLSL}\n${kind === 'bark' ? 'varying vec2 vBarkScale; varying vec2 vWrap; varying float vHgt; varying float vHf; varying float vSeedB; varying vec2 vBarkUv;\n' + BARK_GLSL : ''}`)
      // the sun's light only where the clouds let it through and no birch stands in its way (the sky's light, the
      // hemisphere, is everywhere); a leaf with the sun behind it glows through
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  float sunHere = vSunVis * treeShade(vWPos + uSunDir * 0.12);
  reflectedLight.directDiffuse *= sunHere; reflectedLight.directSpecular *= sunHere;
  ${kind === 'leaves' ? 'reflectedLight.directSpecular *= 0.12; ' : ''}
  ${kind === 'leaves' ? 'reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * max(0.0, -dot(normal, normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz))) * 0.5 * sunHere;' : ''}`);
    if (kind === 'bark') sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  float barkRelief = 0.0;
  {
    float own = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));     // the model's own bark: its darkest marks are kept
    vec2 mb = vBarkUv * vBarkScale + vec2(vSeedB * 17.0, vSeedB * 71.0);      // metres round the limb, and along it
    gW = max(vWrap.x, 1e-3); gU = vBarkUv.x + fract(vSeedB * 7.13) * gW; gC = vBarkScale.x; gG = vWrap.y; gM = mb; gT = vHf;
#ifdef BARK_SPECIES
    diffuseColor.rgb = speciesBark(vHgt, barkRelief);
#else
    diffuseColor.rgb = birchBark(mb, vHgt, own, barkRelief);
#endif
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = barkBump(-vViewPosition, normal, vec2(dFdx(barkRelief), dFdy(barkRelief)) * 0.06, faceDirection);`);
    // (a leaf card's alpha, read from ever smaller mipmaps further off, averages down under the cut and the leaves
    // vanish, a crown going bare as it nears the swap or recedes. Each mip level down lifts the alpha back, so a card
    // covers what it did)
    if (kind === 'leaves') sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      { vec2 ts = vec2(textureSize(map, 0)); vec2 ddx = dFdx(vMapUv * ts), ddy = dFdy(vMapUv * ts);
        float mipL = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + mipL * 0.32)); }
      #endif
      diffuseColor.rgb = min(diffuseColor.rgb * uLeafGain, vec3(1.0));`);
  };
  m.customProgramCacheKey = () => `wind-${kind}${look.leafGrow ? '-grow' : ''}-${ownBark || (kind === 'leaves' && T.leaf) ? species : 'birch'}`;
  return m;
}

/** The same wind on a depth-only material: the copy as the sun sees it (sunshadow.js). */
export function windDepth(kind, { height, sway = 0, bough = 1, U, cards = false, species = 'birch' }) {
  const leafMap = speciesTex(species).leaf ?? leafTexture();
  const m = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, ...(kind === 'leaves' && cards ? { map: leafMap, alphaTest: 0.5 } : {}) });
  m.colorWrite = false;
  const own = { uModelH: { value: height }, uSway: { value: sway * 0.55 }, uBough: { value: bough } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = (kind === 'leaves' ? '#define WIND_LEAVES\n' : '') + sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uModelH; uniform float uSway; uniform float uBough; varying float vSunVis; varying vec3 vWPos;\n${kind === 'leaves' ? 'attribute vec3 aLeafBase;' : ''}`)
      .replace('#include <project_vertex>', WIND_VERT);
    // (a birch's crown is airy: two leaves in five let the sun through, so its shade is a dapple, not a blot)
    if (kind === 'leaves') {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vGap;')
        .replace('vWPos = wp.xyz;', 'vWPos = wp.xyz; vGap = step(0.6, fract(sin(dot(aLeafBase, vec3(12.9898, 78.233, 37.719))) * 43758.5453));');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGap;')
        .replace('void main() {', 'void main() {\n  if (vGap > 0.5) discard;');
      if (cards) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      { vec2 ts = vec2(textureSize(map, 0)); vec2 ddx = dFdx(vMapUv * ts), ddy = dFdy(vMapUv * ts);
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)))) * 0.32)); }
      #endif`);
    }
  };
  m.customProgramCacheKey = () => `wind-depth-${kind}${cards ? "-cards" : ""}`;   // (the map is a texture uniform: one program serves every species)
  return m;
}

/** Leaf area (m², one side) over the model's height squared: how full its crown reads. Worked out once a geometry. */
function leafDensity(g, height) {
  if (g.userData.leafDensity) return g.userData.leafDensity;
  const p = g.attributes.position.array, I = g.index ? g.index.array : null, n = I ? I.length : p.length / 3;
  let A = 0;
  for (let t = 0; t < n; t += 3) {
    const a = (I ? I[t] : t) * 3, b = (I ? I[t + 1] : t + 1) * 3, c = (I ? I[t + 2] : t + 2) * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    A += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  return (g.userData.leafDensity = A / (height * height) || 1.3);
}

/**
 * Copies of a model's close or far parts at `items` ([{ x, y, z, yaw, scale }]) as instanced meshes, in a group.
 */
export function placeCopies(model, which, items, U, { sway, bough = 1, look, shadow = false, castOnly = false } = {}) {
  const group = new THREE.Group(), parts = model[which] ?? model.near ?? model.far;
  if (!parts || !items.length) return group;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const part of parts) {
    const cards = !!part.geometry.attributes.color && part.kind === 'leaves';
    // (castOnly: copies drawn only into the sun's picture of the casters (sunshadow.js, layer 1), for their shade)
    const species = speciesOf(model.name ?? '');
    const depth = shadow || castOnly ? windDepth(part.kind, { height: model.height, sway: sway ?? model.extras.sway ?? 0, bough, U, cards, species }) : null;
    // (the close copy's leaves grow toward a full crown: by how sparse its cards are for its height, up to 1.6 times)
    const leafGrow = part.kind === 'leaves' && which === 'near' && model.far ? Math.min(1.6, Math.max(1, Math.sqrt(1.3 / leafDensity(part.geometry, model.height)))) : 0;
    const mat = castOnly ? depth : windMaterial(part.material, { kind: part.kind, height: model.height, sway: sway ?? model.extras.sway ?? 0, bough, U, look: { ...look, cards, leafGrow }, species });
    const mesh = new THREE.InstancedMesh(part.geometry, mat, items.length);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.yaw ?? 0); s.setScalar(it.scale ?? 1); p.set(it.x, it.y, it.z);
      mesh.setMatrixAt(i, mtx.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    if (depth) mesh.userData.depthMat = depth;
    if (castOnly) { mesh.layers.set(1); mesh.layers.enable(2); }      // (drawn only into the sun's two pictures: sunshadow.js)
    mesh.name = `${model.name}.${which}.${part.kind}${castOnly ? '.sun' : ''}`;
    group.add(mesh);
  }
  return group;
}
