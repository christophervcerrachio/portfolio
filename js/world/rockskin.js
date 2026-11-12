// A rock's skin, close up: ComfyUI's rock tile (assets/world/ground/rock-granite-2k.jpg, 2048 px over 2 m, or the older
// rock.jpg till it is here) laid on from the three sides by the face's turn (no texture coordinates to stretch), at two
// sizes so it never repeats in a line: the tile at 1.7 m, and again at 0.45 m for the fine grain. Its relief from the
// tile's own light and dark (pits and cracks read as dents in the light), moss on the faces that look up, each stone a
// little lighter or darker than the next. For any lit material (MeshStandardMaterial): chains any onBeforeCompile it
// already has.
import * as THREE from 'three';
import { loadPictureAsync } from '../texcap.js';

const cache = new Map();
/** The rock tile (one texture for every rock), the best there is. */
function rockTile(base, kind) {
  const key = base + kind;
  if (!cache.has(key)) {
    const u = { value: null }, on = { value: 0 };
    const take = (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      u.value = t; on.value = 1;
    };
    loadPictureAsync(`${base}assets/world/ground/rock-${kind}-2k.jpg`).then(take)
      .catch(() => loadPictureAsync(`${base}assets/world/ground/rock.jpg`).then(take).catch(() => {}));
    cache.set(key, { u, on });
  }
  return cache.get(key);
}

/**
 * mat: a lit material. Options: base (the site's root), kind ('granite' boulders and stones, 'limestone' crags),
 * moss (0..1, how much moss on the faces that look up), tint (a colour the rock is brought to), relief (0..1).
 */
export function rockSkin(mat, { base = '', kind = 'granite', moss = 0.45, tint = 0xffffff, relief = 1 } = {}) {
  const T = rockTile(base, kind);
  const own = { uRkT: T.u, uRkOn: T.on, uRkMoss: { value: moss }, uRkTint: { value: new THREE.Color(tint) }, uRkRelief: { value: relief } };
  const prev = mat.onBeforeCompile, ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const keyBase = ownKey ? ownKey() : String(prev ?? '');
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRkW; varying vec3 vRkN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 rw = vec4(transformed, 1.0); vec3 rn = objectNormal;
#ifdef USE_INSTANCING
    rw = instanceMatrix * rw; rn = mat3(instanceMatrix) * rn;
#endif
    vRkW = (modelMatrix * rw).xyz; vRkN = mat3(modelMatrix) * rn; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRkW; varying vec3 vRkN;
uniform sampler2D uRkT; uniform float uRkOn; uniform float uRkMoss; uniform vec3 uRkTint; uniform float uRkRelief;
float rkHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float rkNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rkHash(i), rkHash(i + vec3(1,0,0)), f.x), mix(rkHash(i + vec3(0,1,0)), rkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rkHash(i + vec3(0,0,1)), rkHash(i + vec3(1,0,1)), f.x), mix(rkHash(i + vec3(0,1,1)), rkHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 rkTri(vec3 p, vec3 w) { return texture2D(uRkT, p.zy).rgb * w.x + texture2D(uRkT, p.xz + 0.37).rgb * w.y + texture2D(uRkT, p.xy + 0.71).rgb * w.z; }
vec3 rkBump(vec3 pos, vec3 n, float h, float k) {
  vec3 dx = dFdx(pos), dy = dFdy(pos); vec3 r1 = cross(dy, n), r2 = cross(n, dx); float det = dot(dx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * k; return normalize(abs(det) * n - g); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  float rkH = 0.0;
  {
    vec3 rn = normalize(vRkN), bw = pow(abs(rn), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
    float own = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    if (uRkOn > 0.5) {
      vec3 A = rkTri(vRkW / 1.7, bw), B = rkTri(vRkW / 0.45 + 3.1, bw);
      float la = dot(A, vec3(0.2126, 0.7152, 0.0722)), lb = dot(B, vec3(0.2126, 0.7152, 0.0722));
      vec3 rock = A * mix(1.0, lb / 0.42, 0.4);
      // (each stone its own shade: its own colour's brightness, and a slow mottle over the big ones)
      rock *= uRkTint * (0.8 + 0.4 * clamp(own / 0.55, 0.5, 1.5) * 0.5) * (0.88 + 0.24 * rkNoise(vRkW * 0.7));
      diffuseColor.rgb = rock;
      rkH = la * 0.65 + lb * 0.35;
    } else {
      diffuseColor.rgb *= 0.85 + 0.25 * rkNoise(vRkW * 9.0);
    }
    // moss and lichen where the face looks up and the rock holds the damp
    float up = smoothstep(0.45, 0.92, rn.y) * smoothstep(0.35, 0.7, rkNoise(vRkW * 1.3 + 4.7));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.25, 0.10) * (0.8 + 0.4 * rkNoise(vRkW * 11.0)), up * uRkMoss);
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = rkBump(-vViewPosition, normal, rkH, 0.9 * uRkRelief * uRkOn);`);
  };
  mat.customProgramCacheKey = () => keyBase + '-rockskin';
  mat.map = null; mat.needsUpdate = true;
  return mat;
}
