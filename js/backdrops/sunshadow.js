// The sun's shadows on the hilltop: where the birches stand between the sun and the meadow (their trunks, their boughs,
// every fluttering leaf), the grass, the flowers and the trees themselves are shaded. While the sun is out, a depth
// picture of the birches as the sun sees them is drawn each frame (the leaves move, so their dapple moves); everything
// on the hilltop reads it (SHADOW_GLSL). Under the cloud there is no sun to cast them, and nothing is drawn.
import * as THREE from 'three';
import { depthMode } from '../depthmode.js';

export const SHADOW_GLSL = /* glsl */`
uniform sampler2D uSunShadow; uniform mat4 uSunShadowM; uniform float uSunShadowOn; uniform float uSunShadowTexel;
uniform sampler2D uSunShadow2; uniform mat4 uSunShadowM2; uniform float uSunShadowOn2; uniform float uSunShadowTexel2;
uniform vec2 uSunShadowB;
// (where p falls in a picture: its uv, its depth, and 0..1 how far inside the picture's edge it is)
vec4 sunPic(mat4 M, vec3 p) {
  vec4 s = M * vec4(p, 1.0); vec3 c = s.xyz / s.w * 0.5 + 0.5;
  float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
  return vec4(c, c.z >= 1.0 ? 0.0 : smoothstep(0.0, 0.04, e));
}
// the far picture: everything solid within a few hundred metres (the houses, the woods, the rocks), coarser
float farShade(vec3 p, float taps) {
  if (uSunShadowOn2 < 0.5) return 1.0;
  vec4 c = sunPic(uSunShadowM2, p);
  if (c.w <= 0.0) return 1.0;
  float z = c.z - uSunShadowB.y, r = uSunShadowTexel2 * 1.4;
  float lit = 0.25 * (step(z, texture2D(uSunShadow2, c.xy + vec2(-0.7, -0.3) * r).r) + step(z, texture2D(uSunShadow2, c.xy + vec2(0.7, 0.3) * r).r)
    + step(z, texture2D(uSunShadow2, c.xy + vec2(-0.3, 0.7) * r).r) + step(z, texture2D(uSunShadow2, c.xy + vec2(0.3, -0.7) * r).r));
  return mix(1.0, lit, c.w);
}
// 1 in the sun .. 0 in shadow, at world point p: the near picture (sharp, soft-edged under leaves) where it reaches,
// the far one beyond it, blended across the near one's edge
float treeShade(vec3 p) {
  if (uSunShadowOn < 0.5 && uSunShadowOn2 < 0.5) return 1.0;
  vec4 c = sunPic(uSunShadowM, p);
  float w = uSunShadowOn > 0.5 ? c.w : 0.0, nearLit = 1.0;
  if (w > 0.0) {
    float z = c.z - uSunShadowB.x, r = uSunShadowTexel * 2.8, lit = 0.0;      // (a sunfleck under leaves is soft-edged)
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(-0.94, -0.34) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(0.94, 0.34) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(-0.34, 0.94) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(0.34, -0.94) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(-0.2, -0.1) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(0.62, -0.62) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(-0.62, 0.62) * r).r);
    lit += step(z, texture2D(uSunShadow, c.xy + vec2(0.1, 0.25) * r).r);
    nearLit = lit / 8.0;
    if (w >= 1.0) return nearLit;
  }
  return mix(farShade(p, 4.0), nearLit, w);
}
// (the same, in four taps: for vertex shaders, run for every blade of grass)
float treeShade4(vec3 p) {
  if (uSunShadowOn < 0.5 && uSunShadowOn2 < 0.5) return 1.0;
  vec4 c = sunPic(uSunShadowM, p);
  float w = uSunShadowOn > 0.5 ? c.w : 0.0, nearLit = 1.0;
  if (w > 0.0) {
    float z = c.z - uSunShadowB.x, r = uSunShadowTexel * 2.2;
    nearLit = 0.25 * (step(z, texture2D(uSunShadow, c.xy + vec2(-0.7, -0.3) * r).r) + step(z, texture2D(uSunShadow, c.xy + vec2(0.7, 0.3) * r).r)
      + step(z, texture2D(uSunShadow, c.xy + vec2(-0.3, 0.7) * r).r) + step(z, texture2D(uSunShadow, c.xy + vec2(0.3, -0.7) * r).r));
    if (w >= 1.0) return nearLit;
  }
  return mix(farShade(p, 4.0), nearLit, w);
}`;

/** The uniforms (shared: every material on the hilltop takes them). */
export function shadowUniforms() {
  return { uSunShadow: { value: null }, uSunShadowM: { value: new THREE.Matrix4() }, uSunShadowOn: { value: 0 }, uSunShadowTexel: { value: 1 / 2048 },
    uSunShadow2: { value: null }, uSunShadowM2: { value: new THREE.Matrix4() }, uSunShadowOn2: { value: 0 }, uSunShadowTexel2: { value: 1 / 2048 },
    uSunShadowB: { value: new THREE.Vector2(0.0009, 0.0009) } };
}

/** A plain depth material for whatever has none of its own (a house, a rock, a boat): it only writes depth. */
const PLAIN_DEPTH = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
PLAIN_DEPTH.colorWrite = false;

/**
 * The shadow: an orthographic camera looking down the sun's rays, fitted round boxes, drawing a depth picture of the
 * casters. Two of them: the near one (slot '') sharp round the meadow in view, the far one (slot '2') coarser over a
 * few hundred metres, so the houses, the woods, the rocks and the boats all throw theirs on the land, the grass and
 * each other. U: the shared uniforms (shadowUniforms()).
 */
export class SunShadow {
  constructor(U, { size = 2048, slot = '', bias = 0.15 } = {}) {
    this.U = U; this.slot = slot; this.biasM = bias;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, generateMipmaps: false });
    this.rt.depthTexture = new THREE.DepthTexture(size, size);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    // (the casters of each picture on a layer of its own - the near picture's on 1, the far one's on 2 - and each
    // camera sees only its own: with one layer for both, whatever cast in the near picture alone (the cities' trees,
    // benches, lamps, railings, yards) was drawn into the far one as well, in its full material - 40 to 120 million
    // triangles a frame in the cities)
    this.layer = slot === '2' ? 2 : 1;
    this.cam.layers.set(this.layer);
    U['uSunShadow' + slot].value = this.rt.depthTexture;
    U['uSunShadowTexel' + slot].value = 1 / size;
    this.groups = [];
    this.casters = [];
  }

  /** Fit round boxes ([min, max] Vector3 pairs): what can shade the view. */
  fit(boxes) {
    const sun = this.U.uSunDir.value, c = new THREE.Vector3();
    for (const [a, b] of boxes) c.add(a).add(b);
    c.multiplyScalar(0.5 / boxes.length);
    // (stable: the sun's camera looks from a fixed point in the world, not from the boxes' middle, so the texel grid the
    // picture is snapped to (below) stays put in the world as the boxes move with the walker; and its span is kept the
    // same as the view turns (the largest yet, until the sun has moved), so its texels never change size. Each refit had
    // moved the grid a fraction of a texel and every shadow edge shimmered)
    if (!this._sun || this._sun.angleTo(sun) > 0.02) { this._sun = sun.clone(); this._sx = this._sy = 0; }
    this.anchor ??= new THREE.Vector3(Math.round(c.x / 1000) * 1000, 0, Math.round(c.z / 1000) * 1000);
    if (this.anchor.distanceTo(c) > 20000) this.anchor.set(Math.round(c.x / 1000) * 1000, 0, Math.round(c.z / 1000) * 1000);
    this.cam.position.copy(this.anchor).addScaledVector(sun, 400);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.anchor);
    this.cam.updateMatrixWorld(true);
    const inv = this.cam.matrixWorldInverse, lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate(), v = new THREE.Vector3();
    for (const [a, b] of boxes) for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z).applyMatrix4(inv);
      lo.min(v); hi.max(v);
    }
    // (texel-snapped, so the picture does not shimmer as it follows the walker)
    const size = this.rt.width;
    this._sx = Math.max(this._sx || 0, hi.x - lo.x); this._sy = Math.max(this._sy || 0, hi.y - lo.y);
    const sx = this._sx, sy = this._sy, tx = sx / size, ty = sy / size, mx = (lo.x + hi.x) / 2, my = (lo.y + hi.y) / 2;
    lo.x = Math.floor((mx - sx / 2) / tx) * tx; hi.x = lo.x + sx; lo.y = Math.floor((my - sy / 2) / ty) * ty; hi.y = lo.y + sy;
    Object.assign(this.cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: -hi.z - 30, far: -lo.z + 2 });
    this.cam.updateProjectionMatrix();
    this.U['uSunShadowM' + this.slot].value.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    // (the depth bias, a fixed few centimetres whatever the picture's depth)
    const b = this.U.uSunShadowB.value, d = (this.cam.far - this.cam.near) * 0.5;
    if (this.slot === '2') b.y = this.biasM / d; else b.x = this.biasM / d;
  }

  /** The casters: everything solid in `group`, now and as it is added to (a model loaded later): each drawn with its
   *  own depth material (userData.depthMat, which moves with the wind) or a plain one. */
  add(group) { this.groups.push(group); this.casters = null; }

  /** The depth material `o` is drawn with into the sun's pictures, or null if it throws no shadow (made once, kept on it). */
  depthOf(o) {
    if (!o.isMesh || o.userData.noCast) return null;
    if (o.userData.depthMat) return o.userData.depthMat;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    // (only the solid: no water, no mist, no lights, no special shader without a depth form of its own)
    if (!mat || mat.transparent || mat.isShaderMaterial || mat.depthWrite === false) return null;
    return (o.userData.depthMat = mat.alphaTest > 0 && mat.map ? Object.assign(new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, map: mat.map, alphaTest: mat.alphaTest }), { colorWrite: false }) : PLAIN_DEPTH);
  }

  _gather() {
    const out = [];
    for (const g of this.groups) g.traverse((o) => {
      // (noCastFar: into the near picture alone - small things; noCastNear: into the far one alone - trees too far
      // off to shade the ground round the walker, world/woods.js)
      if (!o.isMesh || o.userData.noCast || (this.layer === 2 && o.userData.noCastFar) || (this.layer === 1 && o.userData.noCastNear)) return;
      if (!this.depthOf(o)) return;
      o.layers.enable(this.layer);
      out.push(o);
    });
    return out;
  }

  /** The depth programs of `scene`'s meshes made now, before any of the real ones is drawn (walk.js gives a scene of
   *  small stand-ins, one for each material): each drawn once into this picture with the depth material its real mesh
   *  will cast with, and the picture cleared again. */
  warm(renderer, scene) {
    const groups = this.groups, casters = this.casters;
    this.groups = [scene];
    const cs = this._gather(), mats = cs.map((m) => m.material), prev = renderer.getRenderTarget();
    cs.forEach((m) => { m.material = m.userData.depthMat; });
    renderer.setRenderTarget(this.rt);
    depthMode(renderer, false);
    renderer.render(scene, this.cam);
    renderer.clear(true, true, false);
    depthMode(renderer, true);
    cs.forEach((m, i) => { m.material = mats[i]; });
    renderer.setRenderTarget(prev);
    this.groups = groups; this.casters = casters;
  }

  /** Draw the depth picture (if the sun is out at all), from `scene`. */
  render(renderer, scene, on) {
    const key = 'uSunShadowOn' + this.slot;
    if (!this.casters || (this.frame = (this.frame ?? 0) + 1) % 30 === 0) this.casters = this._gather();
    this.U[key].value = on && this.casters.length ? 1 : 0;
    if (!this.U[key].value) return;
    const prev = renderer.getRenderTarget(), mats = this.casters.map((m) => m.material), vis = this.casters.map((m) => m.visible);
    this.casters.forEach((m) => { m.material = m.userData.depthMat; });
    renderer.setRenderTarget(this.rt);
    depthMode(renderer, false);                           // (the shadow pictures in the ordinary depth: depthmode.js)
    renderer.clear(true, true, false);
    renderer.render(scene, this.cam);
    depthMode(renderer, true);
    this.casters.forEach((m, i) => { m.material = mats[i]; m.visible = vis[i]; });
    renderer.setRenderTarget(prev);
  }
}

/** A lit material (MeshStandardMaterial and the like) made to take the sun's shadows: its sunlight is cut wherever
 *  the near or far picture says something stands between it and the sun. Chains any onBeforeCompile it already has. */
export function receiveSun(mat, U) {
  if (!mat || mat.userData.sunRecv || mat.isShaderMaterial) return mat;
  mat.userData.sunRecv = true;
  const prev = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const keyBase = own ? own() : String(prev ?? '');
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    for (const k of Object.keys(shadowUniforms())) sh.uniforms[k] = U[k];
    sh.uniforms.uSunDir = U.uSunDir;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vShW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 shw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    shw = instanceMatrix * shw;
#endif
    vShW = (modelMatrix * shw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vShW;\n#ifndef SUN_DIR_DECL\nuniform vec3 uSunDir;\n#endif\n${SHADOW_GLSL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { float shS = treeShade(vShW + uSunDir * 0.15); reflectedLight.directDiffuse *= shS; reflectedLight.directSpecular *= shS; }`);
  };
  mat.customProgramCacheKey = () => keyBase + '-sunrecv';
  mat.needsUpdate = true;
  return mat;
}
