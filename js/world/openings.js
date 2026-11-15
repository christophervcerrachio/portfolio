// A house front's wall and its openings, apart (15 Nov 2026: every window and door built, none drawn into a wall's
// picture, so the build sets each one's size, place and facing). The front's own picture is its wall alone, drawn
// again without a window, door or opening in it (ComfyUI; dev\world\cities\walls90.py); every window and door is built
// where the build places it (facade-bays.json: bays, rows, frames, doors - facaderelief.js near the walker), and their
// faces - the glass, the casing, the door's leaves - are read from a picture of their own, fronts/<front>-openings.jpg,
// in the wall's own pixels, never from the wall's. Its mask (fronts/<front>-openings-mask.png: white over each opening,
// its casing, sill, hood and the things hung on it) says where on the wall an opening stands; far off, where nothing is
// built, the wall shows each opening there from that picture, so a street seen down its length still has its windows.
import * as THREE from 'three';
import { loadPicture } from '../texcap.js';

const DIR = 'assets/world/cities/';
const PICS = {};

/** The front's openings: { map, mask } (textures; loaded once a front). name: 'facade-<front>'. */
export function openingsOf(name, base = '') {
  if (PICS[name]) return PICS[name];
  const k = name.replace(/^facade-/, '');
  const map = loadPicture(base + DIR + 'fronts/' + k + '-openings.jpg', { cap: false });
  map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const mask = new THREE.TextureLoader().load(base + DIR + 'fronts/' + k + '-openings-mask.png');
  mask.flipY = false; mask.colorSpace = THREE.NoColorSpace; mask.generateMipmaps = true; mask.minFilter = THREE.LinearMipmapLinearFilter;
  return (PICS[name] = { map, mask });
}

/** Give a house front's material its openings over its wall. Call after interiors(): its rooms and reveals read the
 *  openings' picture (OPENTEX), and its windows are drawn over the mix made here. */
export function openings(mat, name, { base = '', cut = 0 } = {}) {
  if (!mat || mat.userData.openings || !mat.isMeshStandardMaterial) return mat;
  mat.userData.openings = true;
  const O = openingsOf(name, base);
  mat.userData.openMap = O.map;
  (mat.userData.pictures ??= []).push(O.map, O.mask);
  // (cut: within this many metres an opening is a hole in the material - its reveals, glass and what lies behind are
  // built there (facaderelief.js: a shop's windows and door); 0: never)
  const U = { uOpen: { value: O.map }, uOpenMask: { value: O.mask }, uOpenCut: { value: cut } };
  const prev = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const keyBase = own ? own() : String(prev ?? '');
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, U);
    if (!sh.fragmentShader.includes('#include <map_fragment>')) return;
    if (cut > 0) sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOpenW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  { vec4 ow = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    ow = instanceMatrix * ow;
#endif
    vOpenW = (modelMatrix * ow).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uOpen; uniform sampler2D uOpenMask; uniform float uOpenCut;' + (cut > 0 ? ' varying vec3 vOpenW;' : '') + '\n#define OPENTEX uOpen')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  { float om = texture2D(uOpenMask, vMapUv).r;
    ${cut > 0 ? 'if (om > 0.5 && length(cameraPosition - vOpenW) < uOpenCut) discard;' : ''}
    if (om > 0.004) diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(uOpen, vMapUv).rgb, om); }
#endif`);
  };
  mat.customProgramCacheKey = () => keyBase + '-openings' + (cut > 0 ? '-cut' : '');
  mat.needsUpdate = true;
  return mat;
}
