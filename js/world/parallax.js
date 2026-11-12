// Parallax occlusion for any textured lit material: the view ray marched down through the surface's own relief, read
// from its colour picture (a brick stands proud of its mortar, a stone of its joint), 10 steps and a refinement; the
// colour and the normal map read where it lands. The tangent frame from the screen derivatives of the world position
// and the texture coordinates, so a model needs no tangents. Near the camera only (it fades out by `far` m).
//   depth: the relief in metres (a brick wall's mortar is ~1.5 cm deep); invert: true where the joints are the
//   lighter part (pale lime mortar between dark bricks); scale: metres one unit of texture coordinate covers.
import * as THREE from 'three';

export function parallax(mat, { depth = 0.015, invert = false, scale = 1, far = 40 } = {}) {
  if (!mat || mat.userData.parallax || !mat.isMeshStandardMaterial) return mat;
  mat.userData.parallax = true;
  const prev = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const keyBase = own ? own() : String(prev ?? '');
  const U = { uPxDepth: { value: depth / scale }, uPxInv: { value: invert ? 1 : 0 }, uPxFar: { value: far } };
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPxW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 pw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    pw = instanceMatrix * pw;
#endif
    vPxW = (modelMatrix * pw).xyz; }`);
    if (!sh.fragmentShader.includes('#include <map_fragment>')) return;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPxW; uniform float uPxDepth; uniform float uPxInv; uniform float uPxFar;')
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace(/vMapUv/g, 'pxUv'))
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(/vNormalMapUv/g, 'pxUv'))
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef USE_MAP
  vec2 pxUv = vMapUv;
  {
    float fade = 1.0 - smoothstep(uPxFar * 0.5, uPxFar, length(cameraPosition - vPxW));
    if (fade > 0.0) {
      vec3 q0 = dFdx(vPxW), q1 = dFdy(vPxW); vec2 s0 = dFdx(vMapUv), s1 = dFdy(vMapUv);
      vec3 N = normalize(cross(q0, q1));
      vec3 T = q0 * s1.t - q1 * s0.t, B = q1 * s0.s - q0 * s1.s;
      float lt = length(T), lb = length(B);
      if (lt > 1e-8 && lb > 1e-8) {
        T /= lt; B /= lb;
        vec3 V = normalize(cameraPosition - vPxW);
        if (dot(V, N) < 0.0) N = -N;
        vec3 Vt = vec3(dot(V, T), dot(V, B), max(dot(V, N), 0.25));
        vec2 dir = -Vt.xy / Vt.z * uPxDepth * fade;
        float stp = 0.1, dd = 0.0, pd = 0.0;
        float h = dot(texture2D(map, pxUv).rgb, vec3(0.299, 0.587, 0.114)); h = mix(h, 1.0 - h, uPxInv);
        float ph = h;
        for (int i = 0; i < 10; i++) {
          if (1.0 - h <= dd) break;
          pd = dd; ph = h; dd += stp;
          h = dot(texture2D(map, vMapUv + dir * dd).rgb, vec3(0.299, 0.587, 0.114)); h = mix(h, 1.0 - h, uPxInv);
        }
        float a = (1.0 - ph) - pd, b = (1.0 - h) - dd;
        pxUv = vMapUv + dir * mix(pd, dd, clamp(a / (a - b + 1e-5), 0.0, 1.0));
      }
    }
  }
#elif defined(USE_NORMALMAP)
  vec2 pxUv = vNormalMapUv;
#endif`);
  };
  mat.customProgramCacheKey = () => keyBase + '-parallax';
  mat.needsUpdate = true;
  return mat;
}
