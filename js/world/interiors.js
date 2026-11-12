// Rooms behind the windows (interior mapping): every window of a house front, where its picture shows glass, looks into
// a room. No room is built: the view ray is followed from the glass into a box behind it (as wide and tall as the
// window, 3 m deep) to the wall, floor or ceiling it meets, and that point is read from a photograph of a room taken
// square to its back wall (ComfyUI; the back wall the middle half of the picture, so a point d deep of the room's depth
// lies at 1 / (1 + d) of its way out from the middle). Each window its own room of sixteen, chosen by where the window
// is.
// The front's window map (dev\world\cities\make_window_maps.py, from facade-bays.json) says which pixels are glass,
// where each lies across its window (red, green) and the window's size (blue: width x 40; alpha: 128 + height x 30).
// The windows set back in their openings: the frame and its glass drawn 24 cm behind the wall's face, the opening's
// sides, sill and head where the view meets them first, so a window has depth from every angle, as the picture's own
// windows do.
// Near the camera only: past `far` m the front's own picture of the glass returns. The room is dim and seen through
// the dark of the glass only; the front's own picture of the pane (its curtains, its lights) stays over it, and the
// glass mirrors the sky the flatter it is looked along (11 Nov 2026).
import * as THREE from 'three';
import { styleNow } from '../retro.js';
import { loadPicture } from '../texcap.js';

const DIR = 'assets/world/cities/';
let ROOMS = null;
const WINS = {};
let FRONTS = null;

function tex(url, nearest) {
  if (nearest) {
    // (a window map holds numbers, not colours: decoded as they are, its alpha never multiplied into its colour - the
    // browser's own decoding had done that, and every window's glass came out speckled)
    const t = new THREE.Texture();
    t.flipY = false; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.premultiplyAlpha = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1;
    fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((bmp) => { t.image = bmp; t.needsUpdate = true; }).catch(() => {});
    return t;
  }
  const t = loadPicture(url, { cap: false });
  t.flipY = false;                                  // (as the models' own pictures: glTF's way up)
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Give a house front's material its rooms. `name`: the front's picture (facade-spb-cream ...). */
export function interiors(mat, name, { base = '', far = 140, depth = 3.0, cut = 0, flat = false, sky = null } = {}) {
  // (an older machine's picture of 240 lines has painted windows only: retro.js)
  if (styleNow() && styleNow().lines <= 240) return;
  if (!mat || mat.userData.interiors || !mat.isMeshStandardMaterial) return mat;
  mat.userData.interiors = true;
  ROOMS ??= tex(base + DIR + 'rooms.jpg', false);
  WINS[name] ??= tex(base + DIR + 'windows/' + name + '_win.png', true);
  // (the pictures its shader takes beside its own maps: sent to the card with it as it comes into the walk - arrive.js)
  (mat.userData.pictures ??= []).push(ROOMS, WINS[name]);
  const U = { uWin: { value: WINS[name] }, uRooms: { value: ROOMS }, uIntFar: { value: far }, uIntDepth: { value: depth },
    uRev: { value: flat ? 0.0 : 0.24 }, uMx: { value: 0.012 }, uMy: { value: 0.012 }, uPH: { value: 1024 }, uCut: { value: cut },
    // (the sky the glass mirrors: the scene's own, at the horizon and overhead - backdrops/clouds.js)
    uIntHorizon: sky?.uHorizon ?? { value: new THREE.Color(0.73, 0.74, 0.69) }, uIntZenith: sky?.uZenith ?? { value: new THREE.Color(0.16, 0.31, 0.59) } };
  // (the front picture's metres a pixel and its height in pixels: windows/fronts.json)
  FRONTS ??= fetch(base + DIR + 'windows/fronts.json').then((r) => r.json()).catch(() => ({}));
  FRONTS.then((F) => { const f = F[name]; if (f) { U.uMx.value = f.mx; U.uMy.value = f.my; U.uPH.value = f.H; } });
  const prev = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;
  const keyBase = own ? own() : String(prev ?? '');
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIntW;' + (flat ? '\nattribute vec3 aWinC; varying vec3 vWinC;' : ''))
      .replace('#include <fog_vertex>', `#include <fog_vertex>${flat ? '\n  vWinC = aWinC;' : ''}
  { vec4 iw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    iw = instanceMatrix * iw;
#endif
    vIntW = (modelMatrix * iw).xyz; }`);
    if (!sh.fragmentShader.includes('#include <map_fragment>')) return;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIntW;' + (flat ? ' varying vec3 vWinC;' : '') + ' uniform sampler2D uWin; uniform sampler2D uRooms; uniform vec3 uIntHorizon; uniform vec3 uIntZenith; uniform float uIntFar; uniform float uIntDepth; uniform float uRev; uniform float uMx; uniform float uMy; uniform float uPH; uniform float uCut;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  {
    vec4 wm = texture2D(uWin, vMapUv);
    float aA = floor(wm.a * 255.0 + 0.5);
    float fade = 1.0 - smoothstep(uIntFar * 0.6, uIntFar, length(cameraPosition - vIntW));
    // (near the camera the window is a hole in the wall: its recess, frame and glass are modelled there -
    // facaderelief.js; this far side of uCut the setback is drawn here)
    if (aA > 127.5 && uCut > 0.0 && length(cameraPosition - vIntW) < uCut) discard;
    if (aA > 127.5 && fade > 0.0) {
      vec3 intGlow = vec3(0.0);                          // (the sky in the glass: light of its own, not the wall's)
      vec3 q0 = dFdx(vIntW), q1 = dFdy(vIntW); vec2 s0 = dFdx(vMapUv), s1 = dFdy(vMapUv);
      // (the wall's facing from its own normal, not from the derivatives of the world position: thousands of metres
      // out, a 32-bit position changes by less than its own precision from one pixel to the next up close, and the
      // facing worked out from it had jittered pixel by pixel - every room seen through a near window came out grainy)
      vec3 N = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
      if (dot(N, cameraPosition - vIntW) < 0.0) N = -N;
      vec3 Up = vec3(0.0, 1.0, 0.0);
      vec3 T = normalize(cross(Up, N));
      // (the picture's u runs one way or the other along the wall: its sign from the derivatives, which hold for that)
      if (dot(q0, T) * s0.x + dot(q1, T) * s1.x < 0.0) T = -T;
      float wpx = floor(wm.b * 255.0 + 0.5) * 4.0, hpx = floor((aA - 128.0) / 2.0) * 16.0;
      float ww = max(wpx * uMx, 0.2), hh = max(hpx * uMy, 0.2);
      vec3 V = normalize(vIntW - cameraPosition);
      vec3 dm = vec3(dot(V, T), dot(V, Up), max(-dot(V, N), 0.05));     // (metres: across, up, into the wall)
      vec2 p = vec2(wm.r, wm.g);
      // (the window stands back uRev in its opening: the ray goes on to the frame's plane; if it meets the opening's
      // side first, that side is seen - the wall's plaster, in its shade)
      vec2 pg = p + vec2(dm.x / ww, dm.y / hh) * (uRev / dm.z);
      vec3 col;
      if (pg.x < 0.0 || pg.x > 1.0 || pg.y < 0.0 || pg.y > 1.0) {
        vec2 side = clamp(pg, 0.0, 1.0);
        vec2 uvS = vMapUv + vec2((side.x - p.x) * wpx / 1024.0, -(side.y - p.y) * hpx / uPH);
        // (the plaster just outside the window, beside where the side is met)
        vec2 out_ = vec2(side.x <= 0.0 ? -0.06 : side.x >= 1.0 ? 0.06 : 0.0, side.y <= 0.0 ? -0.06 : side.y >= 1.0 ? 0.06 : 0.0);
        col = texture2D(map, uvS + vec2(out_.x * wpx / 1024.0, -out_.y * hpx / uPH)).rgb;
        col *= (pg.y < 0.0 ? 0.92 : pg.y > 1.0 ? 0.55 : 0.68);     // (the sill lit from above, the head in shade)
      } else {
        vec2 uvG = vMapUv + vec2((pg.x - p.x) * wpx / 1024.0, -(pg.y - p.y) * hpx / uPH);
        vec4 w2 = texture2D(uWin, uvG);
        col = texture2D(map, uvG).rgb;
        float glass = mod(floor(w2.a * 255.0 + 0.5) - 128.0, 2.0);
        if (w2.a > 0.5 && glass > 0.5) {
          // (through the glass: the room, a box as wide and tall as the window, uIntDepth deep)
          vec3 d = vec3(dm.x / ww, dm.y / hh, dm.z / uIntDepth);
          vec3 pp = vec3(pg, 0.0);
          vec3 tt = (step(0.0, d) - pp) / d;
          float t = min(min(tt.x, tt.y), tt.z);
          vec3 hit = clamp(pp + d * t, 0.0, 1.0);
          vec2 ruv = 0.5 + (hit.xy - 0.5) / (1.0 + hit.z);
          // (the window's room chosen by the window's middle: the modelled glass carries it (facaderelief.js), exact; the
          // wall's own picture works it out from where in the window the pixel is, near enough far off - near, a window
          // stretched to its wall had straddled two rooms' cells and shown both, speckled)
          // (the wall's: the window's middle from where in the window the pixel is, in the wall's own metres - read off
          // how far the picture's u and v run per metre here, as the wall stretches its fronts to fit, not the picture's
          // own metres: with those the middle had wandered by a fifth of the window and two rooms speckled one window)
          float mu = abs(s0.x) > 1e-7 ? dot(q0, T) / s0.x : (abs(s1.x) > 1e-7 ? dot(q1, T) / s1.x : ww * 1024.0 / max(wpx, 1.0));
          float mv = abs(s0.y) > 1e-7 ? dot(q0, Up) / s0.y : (abs(s1.y) > 1e-7 ? dot(q1, Up) / s1.y : -hh * uPH / max(hpx, 1.0));
          vec3 wc = ${flat ? 'vWinC' : 'vIntW - T * (p.x - 0.5) * abs(mu) * wpx / 1024.0 - Up * (p.y - 0.5) * abs(mv) * hpx / uPH'};
          float id = floor(fract(sin(dot(floor(wc * 0.5 + 0.25), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 16.0);
          vec2 cell = vec2(mod(id, 4.0), floor(id / 4.0));
          vec2 auv = vec2((cell.x + ruv.x) / 4.0, (cell.y + 1.0 - ruv.y) / 4.0);
          vec3 room = texture2D(uRooms, clamp(auv, cell / 4.0 + 0.002, (cell + 1.0) / 4.0 - 0.002)).rgb;
          // (a window by day is glass before it is a view. The room had been drawn at four fifths over the glass, lit
          // like a shop's. Now: the room is as dim as a room is beside the street outside it, a little brighter or
          // darker window by window, and seen only through the dark of the glass - where the front's own picture paints
          // a curtain, a blind or a light on the pane, that stays; and the glass mirrors the sky, hardly at all looked
          // at square and nearly wholly looked along, as glass does)
          room *= 0.30 + 0.22 * fract(id * 0.618);
          float see = 1.0 - smoothstep(0.14, 0.46, dot(col, vec3(0.2126, 0.7152, 0.0722)));
          col = mix(col, room, 0.85 * see);
          float fr = 0.05 + 0.95 * pow(1.0 - clamp(dm.z, 0.0, 1.0), 5.0);
          vec3 Rd = reflect(V, N);
          vec3 skyR = Rd.y > 0.0 ? mix(uIntHorizon, uIntZenith, 1.0 - exp(-Rd.y * 4.2)) : uIntHorizon * 0.3;
          intGlow = skyR * fr * 0.85;
          col *= 1.0 - 0.85 * fr;
        }
        col *= 0.9;                                      // (set back in the opening, a little in its shade)
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, col * diffuse, fade);
      totalEmissiveRadiance += intGlow * fade;
    }
  }
#endif`);
  };
  mat.customProgramCacheKey = () => keyBase + '-interiors' + (cut > 0 ? '-cut' : '') + (flat ? '-flat' : '');
  mat.needsUpdate = true;
  return mat;
}
