// The countryside: the hilltop the visitor starts on, and the solid world round it (region.js) - Saint Petersburg,
// Moscow, the Caucasus and Yasnaya Polyana, walked in the first person under changing weather. Each frame: the sky
// (read from its panorama), then the land (the meadow, its birches and stones, and the region), each lit by the
// weather. (Until 8 Nov 2026 the land beyond the hill was my oil painting, 5a774630_001, wrapped round as a panorama:
// valley.js. That path is retired; the hilltop's own shape below is still drawn from the painting's lines.)

import * as THREE from 'three';
import { landscapeUniforms } from './wind-glsl.js';
import { buildMeadow } from './meadow.js';
import { placeTrees } from './groves.js';
import { LANDMARKS } from './landmarks.js';
import { loadModel } from './models.js';
import { placeStones } from './stones.js';
import { Sky, skyUniforms, skyEnvironment } from './clouds.js';
import { makeWeather } from './weather.js';
import { SunShadow, SHADOW_GLSL, shadowUniforms } from './sunshadow.js';
import { loadBark, loadSpecies } from './birchlook.js';
import { loadWorld, buildLand, preloadGround } from '../world/terrain.js';
import { buildPaths } from '../world/paths.js';
import { buildWayStones } from '../world/waystones.js';
import { buildWayRibbons } from '../world/wayribbons.js';
import { buildKremlin, planKremlin } from '../world/kremlin.js';
import { buildCityMarks, planMarks } from '../world/citymarks.js';
import { makePlans, loadPlanShapes } from '../world/plans.js';
import { farCull } from '../world/farcull.js';
import { buildCityBlocks } from '../world/cityblocks.js';
import { pumpArrivals } from '../world/arrive.js';
import { buildCityBridges } from '../world/citybridges.js';
import { buildBridges } from '../world/bridges.js';
import { hillWays, setHillLines } from './paths.js';
import { buildWoods } from '../world/woods.js';
import { buildCityProps } from '../world/cityprops.js';
import { buildChimneySmoke } from '../world/chimneys.js';
import { buildRiverBits } from '../world/riverbits.js';
import { buildPOIs } from '../world/pois.js';
import { DEPTH } from '../depthmode.js';

// The whole world is a walkable solid land like the hilltop (region.js), no longer a painted panorama: the painted
// valley and ring (valley.js and its pictures) were retired on 8 Nov 2026. FRAME and the painting's lines below still
// shape the hilltop itself (makeGround), which is kept as it was.
// ?dev in the address: the fly camera (Z) may rise high above the world, to check layouts from above.
const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);

// the painting's frame, and where the camera stood
export const FRAME = { w: 2560, h: 1152, fovV: 36, horizon: 0.395, eye: 1.0 };
// the walker's eyes over the ground (an adult's, 1.65 m; FRAME.eye, 1.0 m, still shapes the hilltop's brow, which was
// fitted to the old painting from there)
export const EYE = 1.65;
const SPAN_Y = 2 * Math.tan((FRAME.fovV / 2) * Math.PI / 180), SPAN_X = SPAN_Y * FRAME.w / FRAME.h;
const EDGE = Math.atan(SPAN_X / 2);                 // the painting's own reach either way (radians)
// The painting carried on past its edges (my *Change one thing*, site-dev/countryside/extend.py), a third of its width
// either way, angle for angle at the scale it has at its edges: a column u (0..1 the painting, -1/3..4/3 with what was
// painted on) beyond them lies perU radians per width further round; rows keep the edges' vertical scale.
export const WIDE = { margin: 1 / 3, perU: SPAN_X / (1 + (SPAN_X / 2) ** 2) };
const REACH = EDGE + WIDE.margin * WIDE.perU;        // how far the painting now reaches either way (radians)
/** The direction (azimuth, radians right of ahead) of the painting's column u; and the column in a direction. */
export function azimuthAt(u) {
  if (u < 0) return -EDGE + u * WIDE.perU;
  if (u > 1) return EDGE + (u - 1) * WIDE.perU;
  return Math.atan(-SPAN_X / 2 + u * SPAN_X);
}
export function columnAt(phi) {
  if (phi < -EDGE) return (phi + EDGE) / WIDE.perU;
  if (phi > EDGE) return 1 + (phi - EDGE) / WIDE.perU;
  return (Math.tan(phi) + SPAN_X / 2) / SPAN_X;
}
// (a row's vertical scale: in the painting, 1 / cos of the column's azimuth; beyond its edges, as at them)
const rowScale = (phi) => 1 / Math.cos(Math.max(-EDGE, Math.min(EDGE, phi)));
/** An angle brought round to -pi..pi. */
export const wrapAngle = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const PITCH = [-0.1, 0.38];                          // how far the view can tip down and up (radians), zoomed out
// Walking (walkTo): a step d m toward a brow R m off lets the view see a band of about 2d / R^2 (in tan) more of the land
// below the brow than the painting holds (it was painted from the start): no further than `band` of that, nor more than
// `max` m from the start; `body`: how far the walker keeps from a trunk or a stone (m).
export const WALK = { band: 0.035, max: 12, body: 0.3 };
const ZOOM = { high: 6, low: 4 };                      // how far the view can zoom in
// the brow of the meadow in the painting (u across, v down; past its edges, in what was painted on), a little above
// it, so the 3D meadow covers the painted one (the same line as plate.py's MEADOW_TOP)
const BROW = [[-0.334, 0.62], [0, 0.62], [0.08, 0.64], [0.16, 0.66], [0.25, 0.7], [0.32, 0.74], [0.4, 0.79], [0.5, 0.83], [0.62, 0.84],
  [0.72, 0.82], [0.8, 0.78], [0.86, 0.75], [0.93, 0.74], [1.0, 0.73], [1.334, 0.73]].map(([u, v]) => [u, v - 0.012]);
// and on round the rest of the way (in the ring's rows, which are the margins': site-dev/countryside/ring/ring.py), to
// the left, behind and to the right, low enough that the land beyond shows
const ROUND = [[-Math.PI / 2, 0.66], [Math.PI, 0.64], [Math.PI / 2, 0.70]].map(([a, v]) => [a, v - 0.012]);
export { LANDMARKS };
const QUAD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
// The landscape, drawn in linear light with its highlights kept, gets the hands' own tone mapping and exposure here,
// then the weather's grade: a little less colour, cool shadows and warm lights, lifted blacks, a soft vignette.
const SHOW_FRAG = /* glsl */`
uniform sampler2D uPic; uniform float uAlpha; uniform vec4 uGrade; uniform vec3 uShadowTint; uniform vec3 uLightTint;
uniform vec2 uTexel; uniform float uSharp;
uniform vec2 uSunUV; uniform float uSunVis; uniform float uRays; uniform vec3 uRayTint; uniform float uAspect;
uniform sampler2D uDepth; uniform float uRevZ; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform float uAir; uniform float uSunLit; uniform float uAirSteps;
uniform vec3 uSunDir;
uniform sampler2D uMistH; uniform sampler2D uMistCov; uniform vec4 uMistCore; uniform float uMist; uniform float uTime;
uniform vec4 uRetro;
${SHADOW_GLSL}
float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x), f.y); }
// (one tap of the sun's pictures: the air's march takes many, and the jitter between pixels softens them)
float shade1(vec3 p) {
  // (one way out, its answer always set: Windows' shader compiler had warned of a value it could not see set on
  // every path, on each of the page's loads)
  float lit = 1.0; bool got = false;
  if (uSunShadowOn > 0.5) { vec4 c = sunPic(uSunShadowM, p); if (c.w >= 1.0) { lit = step(c.z - uSunShadowB.x, texture2D(uSunShadow, c.xy).r); got = true; } }
  if (!got && uSunShadowOn2 > 0.5) { vec4 d = sunPic(uSunShadowM2, p); if (d.w > 0.0) lit = mix(1.0, step(d.z - uSunShadowB.y, texture2D(uSunShadow2, d.xy).r), d.w); }
  return lit;
}
varying vec2 vUv;
void main() {
  // a light contrast-adaptive sharpen: each pixel pushed away from its four neighbours' mean, less where they already
  // differ a lot, so fine detail crisps without halos round the hard edges
  vec3 cC = texture2D(uPic, vUv).rgb;
  vec3 sharp = cC;
  // (where it is off - an older machine's picture, retro.js - its four neighbours are not read at all)
  if (uSharp > 0.0) {
    vec3 cN = texture2D(uPic, vUv + vec2(0.0, uTexel.y)).rgb, cS = texture2D(uPic, vUv - vec2(0.0, uTexel.y)).rgb;
    vec3 cE = texture2D(uPic, vUv + vec2(uTexel.x, 0.0)).rgb, cW = texture2D(uPic, vUv - vec2(uTexel.x, 0.0)).rgb;
    vec3 mn = min(cC, min(min(cN, cS), min(cE, cW))), mx = max(cC, max(max(cN, cS), max(cE, cW)));
    vec3 amp = sqrt(clamp(mn / max(mx, vec3(1e-4)), 0.0, 1.0));
    vec3 w = -uSharp * amp;
    sharp = clamp((cC + w * (cN + cS + cE + cW)) / (1.0 + 4.0 * w), mn, mx);
  }
  // the sun's shafts through the trees: the bright sky behind the trunks and boughs smeared toward the sun, so every
  // gap throws a beam and every trunk a shadow in the air; strongest looking toward the sun, nothing looking away
  float nearR = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSunUV) * vec2(uAspect, 1.0)));
  if (uRays > 0.0 && uSunVis > 0.001 && nearR > 0.001) {
    vec2 st = (uSunUV - vUv) / 24.0;
    vec2 p = vUv + st * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float acc = 0.0, dec = 1.0;
    for (int i = 0; i < 24; i++) {
      p += st;
      vec2 pc = clamp(p, vec2(0.0), vec2(1.0));
      float l = dot(texture2D(uPic, pc).rgb, vec3(0.2126, 0.7152, 0.0722));
      // (only the bright sky close round the sun throws beams: the open sky further off would only haze the picture)
      float nearSun = 1.0 - smoothstep(0.04, 0.3, length((pc - uSunUV) * vec2(uAspect, 1.0)));
      acc += smoothstep(0.75, 1.8, l) * nearSun * dec; dec *= 0.97;
    }
    sharp += uRayTint * (acc / 24.0) * nearR * uSunVis * uRays;
  }
  // the air lit by the sun between the shadows of the trunks and boughs (my evening wood, 8 Nov 2026): along each view
  // ray, the near 90 m sampled in the sun's shadow pictures; where the sun gets through, the air glows, forward scattered
  // (brightest looking toward the sun), so every gap in the trees throws a shaft and every trunk a dark one
  if (uAir > 0.0) {
    float dz = texture2D(uDepth, vUv).r;
    dz = mix(dz, 1.0 - dz, uRevZ);                       // (the view's depth is drawn reversed: depthmode.js)
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0); vp /= vp.w;
    float dist = dz >= 0.99999 ? 1e5 : length(vp.xyz);
    vec3 dirW = normalize((uCamWorld * vec4(normalize(vp.xyz), 0.0)).xyz), o = uCamWorld[3].xyz;
    float maxD = min(dist, 90.0), j = fract(sin(dot(gl_FragCoord.xy, vec2(41.31, 289.7))) * 43758.5453), lit = 0.0;
    for (int i = 0; i < 20; i++) {
      if (float(i) >= uAirSteps) break;
      float t = maxD * (float(i) + j) / uAirSteps;
      lit += shade1(o + dirW * t);
    }
    lit /= uAirSteps;
    float cosA = max(dot(dirW, uSunDir), 0.0);
    float phase = 0.12 + 2.2 * pow(cosA, 10.0) + 0.5 * pow(cosA, 3.0);
    // (none over the last few metres to a near surface: the march's jitter, a few taps of shadow per pixel, had laid a
    // grain over everything close - a window's glass in its recess seen from the street came out speckled)
    sharp += uRayTint * lit * phase * uAir * uSunLit * (1.0 - exp(-maxD / 45.0)) * smoothstep(10.0, 45.0, maxD);
  }
  // mist in the woods (the plan's DayZ look): a low drift of it lying among the trunks, a few metres deep over the
  // ground where the woods stand (cover-a's red), in slow-moving banks, lit warm toward the low sun and cool away from
  // it; only near (450 m): the open country keeps its clear vistas
  if (uMist > 0.0 && uMistCore.z > 0.0) {
    float dz2 = texture2D(uDepth, vUv).r; dz2 = mix(dz2, 1.0 - dz2, uRevZ);
    vec4 vq = uInvProj * vec4(vUv * 2.0 - 1.0, dz2 * 2.0 - 1.0, 1.0); vq /= vq.w;
    float dist2 = dz2 >= 0.99999 ? 1e5 : length(vq.xyz);
    vec3 dW = normalize((uCamWorld * vec4(normalize(vq.xyz), 0.0)).xyz), o2 = uCamWorld[3].xyz;
    float maxM = min(dist2, 450.0), jm = fract(sin(dot(gl_FragCoord.xy, vec2(7.13, 113.9))) * 43758.5453), dens = 0.0, litM = 0.0;
    for (int i = 0; i < 12; i++) {
      float t = maxM * pow((float(i) + jm) / 12.0, 1.6);
      vec3 q = o2 + dW * t;
      vec2 uv = (q.xz - uMistCore.xy) / uMistCore.z;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      float gh = texture2D(uMistH, uv).r, wood = smoothstep(0.3, 0.8, texture2D(uMistCov, uv).r);
      float bank = mNoise(q.xz / 70.0 + vec2(uTime * 0.012, uTime * 0.007)) * 0.7 + mNoise(q.xz / 19.0 - vec2(uTime * 0.02, 0.0)) * 0.3;
      float dd = wood * exp(-max(q.y - gh, 0.0) / 3.2) * smoothstep(0.3, 0.75, bank);
      dens += dd; litM += dd * shade1(q);
    }
    float T = (1.0 - exp(-dens / 12.0 * maxM * 0.011 * uMist)) * 0.85;
    float cosM = max(dot(dW, uSunDir), 0.0);
    // (the sun through it where the trunks and boughs let it, read in the sun's shadow pictures: the low sun's shafts
    // standing in the mist between the trees)
    float sunPart = dens > 1e-4 ? litM / dens : 1.0;
    vec3 mistCol = vec3(0.46, 0.51, 0.57) * (0.55 + 0.45 * uSunLit) + uRayTint * (0.2 + 2.2 * pow(cosM, 6.0)) * uSunLit * sunPart;
    sharp = mix(sharp, mistCol, T);
  }
  gl_FragColor = vec4(sharp, uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = gl_FragColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.x);
  c = (c - 0.5) * uGrade.y + 0.5;
  c += uShadowTint * (1.0 - l) * (1.0 - l) + uLightTint * l * l;
  c = uGrade.z + c * (1.0 - uGrade.z);
  vec2 q = (vUv - 0.5) * vec2(1.0, 0.75);
  c *= 1.0 - uGrade.w * dot(q, q) * 2.2;
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  c = clamp(c, 0.0, 1.0);
  // an older machine's colours (retro.js): so many levels a channel, their steps broken up by its own dither - the
  // ordered 4 x 4 pattern laid over every picture (its numbers a PlayStation's), or a fine grain
  if (uRetro.w > 0.5) {
    float lr = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(lr), c, uRetro.z), 0.0, 1.0);
    float d = 0.0;
    if (uRetro.y > 1.5) d = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    else if (uRetro.y > 0.5) {
      const float M[16] = float[16](-4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0);
      ivec2 pd = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
      d = M[pd.x + pd.y * 4] / 8.0;
    }
    c = clamp(floor(c * uRetro.x + 0.5 + d) / uRetro.x, 0.0, 1.0);
  }
  gl_FragColor.rgb = c;
}`;
// the models, by the names the scene workflow gave them; far: only the far copy is ever needed
export const MODELS = [
  ['birch-0'], ['birch-1'], ['birch-2'], ['birch-young-0'],
  // the world's woods (world/woods.js): grown from FLUX.2 pictures by dev\world\trees\grow_tree.py (8 Nov 2026)
  ['spruce-0'], ['pine-0'], ['oak-0'],
];

// a little value noise, for the ground's undulation and the drifts of grass and flowers
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The hilltop: for each direction, a convex slope whose brow (where the view grazes it) meets the painting's meadow line. */
export function makeGround() {
  const E = FRAME.eye;
  const tanOf = ([phi, v]) => [phi, -(FRAME.horizon - v) * SPAN_Y / rowScale(phi)];   // azimuth, tan of the depression
  const painted = BROW.map(([u, v]) => tanOf([azimuthAt(u), v]));
  // (round the back the line closes on itself: behind is both -pi and +pi)
  const [L, B, R] = ROUND.map(tanOf);
  const rows = [[-Math.PI, B[1]], L, ...painted, R, [Math.PI, B[1]]];
  // the island is now a CIRCLE: one brow radius every way round. (It used to widen to the sides and behind —
  // 13 + 11 min(1.3, (phi/EDGE)^2) — which is what made the meadow an oval.) The per-azimuth grazing still matches each
  // direction's painting brow because heightAt derives a,b from tanAt(phi) and this R. Raise BROW_R to grow the island;
  // keep it under ~15 so the grass ahead (R*1.45 ≈ 20 m) stays clear of where the valley plate starts painting (~22 m).
  const BROW_R = 14;
  const browR = () => BROW_R;
  const tanAt = (phi) => {
    if (phi <= rows[0][0]) return rows[0][1];
    for (let k = 1; k < rows.length; k++) if (phi <= rows[k][0]) {
      const f = (phi - rows[k - 1][0]) / (rows[k][0] - rows[k - 1][0]);
      return rows[k - 1][1] + (rows[k][1] - rows[k - 1][1]) * f;
    }
    return rows[rows.length - 1][1];
  };
  // h(r) = -a r - b r^2 grazes the eye's ray at r = R when b = E / R^2 and a = tan - 2E / R
  const heightAt = (x, z) => {
    const phi = Math.atan2(x, -z), r = Math.hypot(x, z), R = browR(phi), b = E / (R * R), a = Math.max(0, tanAt(phi) - 2 * E / R);
    return -a * r - b * r * r + 0.06 * (noise2(x * 0.45, z * 0.45) - 0.5) * Math.min(1, r / 3);
  };
  // whether the view can reach a point (the painting's frame, past its edges as far as it was painted on, and as far
  // down as the view can tip); reach: how far round either way that goes
  const seen = (x, y, z) => {
    if (-z < 0.05) return false;
    const phi = Math.atan2(x, -z), u = columnAt(phi), v = FRAME.horizon - (y - E) / Math.hypot(x, z) * rowScale(phi) / SPAN_Y;
    return u > -WIDE.margin - 0.03 && u < 1 + WIDE.margin + 0.03 && v > -0.05 && v < 1.22;
  };
  // the same all the way round (the view turns all the way now: only how far down it can tip limits it)
  const seenRound = (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r < 0.05) return false;
    const v = FRAME.horizon - (y - E) / r * rowScale(Math.atan2(x, -z)) / SPAN_Y;
    return v > -0.05 && v < 1.22;
  };
  // the same for the painting's own frame, as it always was (the meadow lays out its part of it as it always did)
  const seenPainting = (x, y, z) => {
    const d = -z;
    if (d < 0.05) return false;
    const u = (x / d + SPAN_X / 2) / SPAN_X, v = (FRAME.horizon * SPAN_Y - (y - E) / d) / SPAN_Y;
    return u > -0.03 && u < 1.03 && v > -0.05 && v < 1.22;
  };
  // how far out the meadow grows: past the brow every way, as far as can be seen down the slope from where the walker
  // can go (browR's terms, and the reach past it, for the grass's shader: grass.js)
  const meadow = [BROW_R, 0, EDGE, 1.45], meadowR = (phi) => browR(phi) * meadow[3];   // meadow[1]=0: same circle in the grass shader (uMeadow)
  return { heightAt, browR, meadow, meadowR, seen, seenRound, reach: -azimuthAt(-WIDE.margin - 0.03), phi0: -REACH - 0.05, phi1: REACH + 0.05, eye: E,
    painting: { seen: seenPainting, reach: -azimuthAt(-0.03), phi0: -EDGE - 0.05, phi1: EDGE + 0.05 },
    patch: (x, z) => noise2(x, z), azimuthAt };
}

export class CountrysideScene {
  /**
   * @param {object} o  id, name, palette, page, rig, horizon, anchor ([u, v] of the frame kept in view when cropping),
   *   quality ('high' | 'low'), sound (a sound.js maker, given the gusts), pitch ([down, up]: how far the view can tip,
   *   radians, zoomed out; the painter's view's by default)
   */
  constructor(o) {
    this.id = o.id; this.name = o.name; this.dir = o.dir;
    this.palette = o.palette; this.page = o.page; this.rig = o.rig;
    this.horizon = new THREE.Color(o.horizon ?? '#c9d1d6');
    this.anchor = o.anchor ?? [0.5, 0.56];
    this.quality = o.quality ?? 'high';
    this.gfx = o.gfx ?? {};                    // (the machine's graphics settings: hardware.js)
    this.makeSound = o.sound ?? null;
    this.aspect = 16 / 9;
    let seed = 977;
    this.rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.gusts = [{ t0: 2.5, len: 4.4, amp: 0.9 }];
    this.wind = { gust: 0, front: -9 };
    this.U = { ...landscapeUniforms(), ...skyUniforms() };
    this.U.uHalfTan.value = SPAN_X / 2;
    this.light = { sun: 1, rain: 0 };              // at the camera (the sound follows them)
    this.pitchRange = o.pitch ?? PITCH;
    // where the camera stands on the hill (x, z m: the painter's spot at first; walkTo), and how it is turned
    this.at = { x: 0, z: 0 };
    // ---- FREE-CAM (dev only; remove this block for the final product) ---- fly around unrestricted to take pictures.
    // Toggled with Z in walk.js: first Z flies free from where the view is, second Z snaps back to the spawn.
    this.freeCam = { on: false, pos: new THREE.Vector3(), speed: 14 };
    this._pitchSave = null;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.position.set(0, EYE, 0);
    this.cam.rotation.order = 'YXZ';
    this.cam.updateMatrixWorld(true);
    // (zoom: how many times magnified; anchor: while zooming toward a point, what stays under it)
    this.look = { yaw: 0, pitch: 0, goal: [0, 0], zoom: 1, zoomGoal: 1, anchor: null, free: false,
      limits: { yaw: [0, 0], pitch: PITCH.slice() }, drawn: null };
    this.skyScene = new THREE.Scene();
    this.distScene = new THREE.Scene();
    this.land = new THREE.Scene();
    // (its objects' places worked out once a frame, in prerender, not again for each of the frame's pictures - the
    // two sun shadows and the view each did it, a third of the frame's time; nothing in it moves between them)
    this.land.matrixWorldAutoUpdate = false;
    this.rt = null; this.distRT = null;
    // what the hero shows: the landscape's picture, behind the hands
    this.showU = { uPic: { value: null }, uAlpha: { value: 1 }, uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, uSharp: { value: 0.2 },
      uGrade: { value: new THREE.Vector4(0.86, 1.08, 0.015, 0.3) },            // saturation, contrast, lift, vignette
      // (the evening's grade: cool in the shade, warm in the light: my picture, 8 Nov 2026)
      uShadowTint: { value: new THREE.Vector3(-0.012, 0.004, 0.026) }, uLightTint: { value: new THREE.Vector3(0.022, 0.01, -0.016) },
      uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uRays: { value: 1.1 },
      uRayTint: { value: new THREE.Color('#ffd29a').convertSRGBToLinear() }, uAspect: { value: 1.6 },
      uDepth: { value: null }, uRevZ: { value: DEPTH.reversed ? 1 : 0 }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uAir: { value: 0.14 },
      uSunLit: { value: 1 }, uAirSteps: { value: 16 },
      uMistH: { value: null }, uMistCov: { value: null }, uMistCore: { value: new THREE.Vector4(0, 0, 0, 0) }, uMist: { value: 1.0 },
      // (an older machine's picture - retro.js, hardware.js STYLES: its colours' levels, its dither (0 none, 1 the
      // ordered 4 x 4, 2 fine noise), its colour, whether on)
      uRetro: { value: new THREE.Vector4(255, 0, 1, 0) } };
    this.retro = o.retro ?? null;
    if (this.retro) {
      const R = this.retro.show;
      this.showU.uRetro.value.set(R.levels, R.dither, R.sat, 1);
      // (none of the full look's finishing: no sharpening, no shafts, no lit air, no mist, no darkened corners - those
      // machines had none, and each is many taps a pixel)
      this.showU.uSharp.value = 0; this.showU.uRays.value = 0; this.showU.uAir.value = 0; this.showU.uMist.value = 0; this.showU.uGrade.value.w = 0;
    }
    // (the sun's shadow pictures, shared with every material: the air's shafts read them too)
    for (const k of Object.keys(shadowUniforms())) this.showU[k] = this.U[k];
    this.showU.uSunDir = this.U.uSunDir; this.showU.uTime = this.U.uTime;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.showU, vertexShader: QUAD_VERT, fragmentShader: SHOW_FRAG, transparent: true, depthWrite: false, depthTest: true }));
    this.quad.frustumCulled = false; this.quad.renderOrder = -30; this.quad.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.quad);
    this.ready = false;
    // the light the models are lit by (the grass and the ground light themselves the same way: wind-glsl.js)
    const U = this.U;
    const sun = new THREE.DirectionalLight(U.uSunColor.value.clone().convertLinearToSRGB(), 2.1);
    sun.position.copy(U.uSunDir.value).multiplyScalar(100);
    this.land.add(sun, new THREE.HemisphereLight(0xc2cdd8, 0x98a05e, 1.35));
  }

  async load(base = '', tl = () => {}) {
    const ground = makeGround(), tier = this.quality === 'low' ? 'low' : 'high';
    this.assets = base;
    this.ground = ground;
    // the workflow's models (any not there yet are simply left out)
    const dir = base + 'assets/countryside/models/', models = {};
    // (everything the first view needs asked for at once - the trees' models, the world's pictures and lists, the
    // ground's close tiles: they had come one set after another, the world's 20 MB only once the trees' 22 MB were in)
    const modelsIn = Promise.all([
      ...MODELS.map(async ([name, opt]) => { const m = await loadModel(dir, name, opt === 'far' ? { near: false } : {}); if (m) models[name] = m; }),
      loadBark(base), loadSpecies(base),
    ]).then(() => tl('scene load: models'));
    // the world beyond the island, one land from Moscow to Petersburg, the spa region to Yasnaya Polyana
    // (world/terrain.js, from dev\world\build_world.py): loaded first, so the grass grows over all of it
    const MARKS = { spb: 'spb.json', estate: 'estate-landmarks.json', kmv: 'kmv-landmarks.json', 'moscow-churches': 'moscow-churches.json' };
    const lm = (f) => fetch(base + 'assets/world/landmarks/' + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const worldIn = Promise.all([loadWorld(base, { island: ground.heightAt }), loadPlanShapes(base), lm('kremlin.json'), ...Object.values(MARKS).map(lm)])
      .then((r) => { tl('scene load: world'); return r; });
    preloadGround(base);
    const [, [world, shapes, kremlinList, ...markLists]] = await Promise.all([modelsIn, worldIn]);
    this.models = models;
    this.sky = new Sky(this.U, { tier, eye: EYE });
    this.skyScene.add(this.sky.mesh);
    // the true outline of everything that stands on the land (world/plans.js): the landmarks' here, from their lists,
    // before the woods plant a tree or a village is laid out; the country places' as they are set down (pois.js). The
    // walker is kept out of these outlines, the woods a crown's reach off them
    this.plans = makePlans();
    const marks = Object.fromEntries(Object.keys(MARKS).map((k, i) => [k, markLists[i]?.buildings ?? null]));
    for (const [k, list] of Object.entries(marks)) planMarks(this.plans, shapes, k, list);
    if (kremlinList) planKremlin(this.plans, shapes, kremlinList);
    // the ways through it, sharp near the camera (paths.js): the land, the grass and the woods all read them
    setHillLines(world.json.roads);                 // (the hilltop's ways are the world's roads out of the spawn)
    world.ways = buildPaths(world, hillWays());
    Object.assign(world.uniforms, world.ways.uniforms);
    this.world = world;
    // (the woods' mist reads the land's heights and the woods' cover: the show's shader, above)
    this.showU.uMistH.value = world.uniforms.uH.value; this.showU.uMistCov.value = world.uniforms.uCovA.value; this.showU.uMistCore.value.copy(world.uniforms.uCore.value);
    ground.heightAt = world.heightAt;                        // (the walker and camera now stand on the world's land)
    // (the machine's own meadow: hardware.js TIERS grass and flowers - below Full the grass is thinner and shorter
    // reaching, and a 240-line picture has none: its ground is painted)
    this.meadow = buildMeadow(ground, this.U, { tier, world, grass: this.gfx.grass, flowers: this.gfx.flowers });
    this.land.add(this.meadow);
    // every birch on the hill, each drawn in full near the camera (groves.js)
    this.groves = placeTrees(ground, models, this.U, { tier });
    this.land.add(this.groves);
    // the birches' shadows: the sun's picture of them, fitted round the meadow in view and the trees on it (turned with
    // the view, and moved with the camera: _fitShadow)
    const G = this.gfx;
    this.shadow = new SunShadow(this.U, { size: G.shadowSize ?? (tier === 'high' ? 2048 : 1024), bias: 0.06 });
    this.shadow.add(this.groves);
    // and the far picture: everything solid a few hundred metres round: the woods, the houses, the boats, the rocks of
    // the rapids, on the land and on each other
    this.shadowFar = new SunShadow(this.U, { size: G.shadowSize ? G.shadowSize * 2 : (tier === 'high' ? 4096 : 2048), slot: '2', bias: 0.35 });
    this.shadowFar.add(this.groves);
    // the stones along the paths' verges (stones.js): real, standing out of the turf, throwing their shadows
    this.stones = placeStones(ground, this.U, { tier, base, world });
    this.land.add(this.stones);
    this.shadow.add(this.stones); this.shadowFar.add(this.stones);
    // what the walker goes round: the trunks and the big stones
    this.solid = [...(this.groves.userData.solid ?? []), ...(this.stones.userData.solid ?? [])];
    // the land drawn: the rings to 6 km with the near world, the rest in a far pass
    tl('scene load: meadow, trees, stones');
    this.landRings = buildLand(world, this.U, { base, canopyAt: G.canopyAt, n: G.landN });
    this.land.add(this.landRings.near);
    // the woods everywhere the world has them, near the camera (world/woods.js)
    this.woods = buildWoods(world, models, this.U, { far: G.woodsFar, ladder: G.woods });
    this.land.add(this.woods);
    this.shadow.add(this.woods); this.shadowFar.add(this.woods);
    // the pebbles, stones and rocks scattered on the ways (world/waystones.js)
    tl('scene load: land, woods');
    this.wayStones = buildWayStones(world, this.U, { base });
    this.land.add(this.wayStones); this.shadow.add(this.wayStones);
    // the ways' own surface up close, built and baked in Blender (world/wayribbons.js, dev\world\path_strip.py)
    this.wayRibbons = buildWayRibbons(world, this.U, { base });
    this.land.add(this.wayRibbons);
    // the timber bridges where the ways cross water (world/bridges.js)
    this.bridges = buildBridges(world, this.U, { base, stonesTo: G.cribStones ?? Infinity });
    this.land.add(this.bridges); this.shadow.add(this.bridges); this.shadowFar.add(this.bridges);
    // the falls and the rocks of the rapids (world/riverbits.js)
    this.riverBits = buildRiverBits(world, this.U, base, { detail: G.style ? (G.landN >= 96 ? 2 : 1) : 3 });
    this.land.add(this.riverBits);
    this.shadow.add(this.riverBits); this.shadowFar.add(this.riverBits);
    // the villages, the fisherman's hut, the rusalka pond, the chapel, the post station, the kurgan (world/pois.js)
    this.pois = buildPOIs(world, this.U, { plans: this.plans, shapes });
    this.land.add(this.pois);
    this.shadow.add(this.pois); this.shadowFar.add(this.pois);
    // the cities' landmarks, 1:1: the Kremlin (world/kremlin.js)
    this.kremlin = buildKremlin(world, this.U, { base, light: G.marks === 'light', K: kremlinList, shapes });
    this.land.add(this.kremlin); this.shadow.add(this.kremlin); this.shadowFar.add(this.kremlin);
    // Petersburg's landmarks, 1:1 (world/citymarks.js, dev\world\spb\landmarks.py)
    this.spbMarks = buildCityMarks(world, this.U, { base, file: 'spb.json', light: G.marks === 'light', list: marks.spb, shapes });
    this.land.add(this.spbMarks); this.shadow.add(this.spbMarks); this.shadowFar.add(this.spbMarks);
    // Yasnaya Polyana's buildings, each where the estate's plan has it (dev\world\estate\estate.py)
    this.estateMarks = buildCityMarks(world, this.U, { base, file: 'estate-landmarks.json', light: G.marks === 'light', list: marks.estate, shapes });
    this.land.add(this.estateMarks); this.shadow.add(this.estateMarks); this.shadowFar.add(this.estateMarks);
    // the spa towns, Pyatigorsk under Mashuk and Kislovodsk: their galleries, baths, grottos, the Aeolian Harp, the
    // Proval, the Narzan gallery and the old fortress, and their streets of houses (dev\world\kmv\kmv_towns.py)
    this.kmvMarks = buildCityMarks(world, this.U, { base, file: 'kmv-landmarks.json', light: G.marks === 'light', list: marks.kmv, shapes });
    this.land.add(this.kmvMarks); this.shadow.add(this.kmvMarks); this.shadowFar.add(this.kmvMarks);
    // Moscow's parish churches, one in each of its forty church blocks (dev\world\church_plots.py, models ComfyUI ->
    // Blender)
    this.mskMarks = buildCityMarks(world, this.U, { base, file: 'moscow-churches.json', light: G.marks === 'light', list: marks['moscow-churches'], shapes });
    this.land.add(this.mskMarks); this.shadow.add(this.mskMarks); this.shadowFar.add(this.mskMarks);
    // (none of these drawn from further off than this machine's reach for them: world/farcull.js)
    this._culls = [farCull(this.bridges, G.bridgesFar ?? Infinity), ...[this.kremlin, this.spbMarks, this.estateMarks, this.kmvMarks, this.mskMarks].map((g) => farCull(g, G.marksFar ?? Infinity)),
      // (and the country places - a village, the chapel, the post station - and the river's rocks: each had been drawn
      // from anywhere on the map, 33 to 65 draw calls and 100,000 triangles a frame in the middle of Petersburg)
      farCull(this.pois, G.placesFar ?? Infinity), farCull(this.riverBits, G.placesFar ?? Infinity)];
    // the cities' houses, their bridges, yards, pavements and furniture: loaded once the walk has begun (loadLater,
    // called by walk.js when the veil lifts) - 250 MB of models kilometres from where the walk starts, which the veil
    // had waited for. The same models, drawn the same; they join the scene when they are in and their shaders made.
    this.cityBlocks = null; this.cityBridges = null; this.cityProps = null;
    this._laterArgs = { base, models, world };
    if (this.bridges) {
      const countryDeck = this.bridges.userData.deckAt;
      this.bridges.userData.deckAt = (x, z) => countryDeck(x, z) ?? this.cityBridges?.userData.deckAt(x, z);
    }
    // (the modelled buildings, the Kremlin's and the cities' landmarks, the bridges' kit: asked for once the walk is
    // shown - loadRest)
    this.solid = [...(this.solid ?? []), ...this.pois.userData.solid];
    this.farScene = new THREE.Scene();
    this.farScene.add(this.landRings.far);
    this.farCam = new THREE.PerspectiveCamera();
    this.U.uHazeDist.value = 48000;                          // (a clear day: only the air's own blue over tens of kilometres, the range sharp at 40 km)
    this.land.fog = new THREE.Fog(0xbfd0e0, 6000, 160000);   // (the models' haze, as the land's: faint)
    // as far as the world's core reaches, less a margin
    const C = world.json.core, cx = C.x0 + C.span / 2, cz = C.z0 + C.span / 2, half = C.span / 2 - 600;
    this.walkLimits = [[1, 0, cx + half], [-1, 0, -(cx - half)], [0, 1, cz + half], [0, -1, -(cz - half)]];
    // (and round: the world is a circle, the walker kept 300 m inside its rim: world.json circle)
    this.walkCircle = { x: world.circle.x, z: world.circle.z, r: world.circle.r - 300 };
    this._fitShadow(0);
    // (no drizzle planes in front of the camera: their streaks filled the frame with dashes whatever the weather over
    // the valley actually was. dev\retired\rain.js.)
    this.quad.visible = true;
    this.ready = true;
    this._window();
  }

  /** What the first view does not need, asked for once the walk is shown (walk.js): the country places' models, the
   *  Kremlin's towers and buildings, the cities' and the estate's and the spa towns' landmarks, the bridges' kit.
   *  Each piece rises in its place as it comes in (world/arrive.js). */
  loadRest() {
    if (this._rest || !this.ready) return;
    this._rest = true;
    this.pois?.userData.loadModels?.(this.assets);
    for (const g of [this.bridges, this.kremlin, this.spbMarks, this.estateMarks, this.kmvMarks, this.mskMarks]) g?.userData.load?.();
  }

  /** The cities' houses, bridges and furniture (see load): made now, out of the scene; addLater() puts them in. */
  loadLater() {
    if (this._later || !this._laterArgs) return this._later?.groups ?? [];
    const { base, models, world } = this._laterArgs, G = this.gfx;
    // the cities' blocks of houses, read off the plates (world/cityblocks.js, dev\world\cityblocks.py, city_blender.py):
    // they take the sun's near shadows and cast them; the far cascade leaves them out (the city is the plate's)
    // (tiles of houses and yards come and go as the walker moves: the sun's pictures gather their casters again then)
    const changed = () => { if (this.shadow) this.shadow.casters = null; if (this.shadowFar) this.shadowFar.casters = null; };
    const blocks = buildCityBlocks(this.U, { base, far: G.blocksFar ?? Infinity, relief: G.reliefNear ?? 380, tiles: G.tilesNear ?? 1200, changed, heightAt: (x, z) => world.heightAt(x, z) });
    // and their bridges (world/citybridges.js): the walker crosses them as the country ones (one deckAt for both)
    const bridges = buildCityBridges(this.U, { base });
    // the yards made gardens, and the yards' and streets' furniture: fountains, benches, lamps, gates, trees
    // (world/cityprops.js, dev\world\cityhouses.py), drawn near the camera only
    const props = buildCityProps(this.U, models, { base, cities: ['spb', 'moscow', 'estate', 'kmv'], heightAt: (x, z) => world.heightAt(x, z), near: G.propsNear, footNear: G.footNear, yardNear: G.yardNear, full: G.propsFull ?? 130,
      addTrees: this.woods?.userData.addTrees ? (items) => this.woods.userData.addTrees(items) : null, changed });
    // (and smoke over two in five of the houses' chimneys, near the walker: world/chimneys.js)
    const smoke = buildChimneySmoke(this.U, { base, near: G.smokeNear ?? 320 });
    this._later = { groups: [blocks, bridges, props], blocks, bridges, props, smoke };
    return this._later.groups;
  }

  /** Into the scene, once loaded (and their shaders made: walk.js). */
  addLater() {
    const L = this._later;
    if (!L || L.added) return;
    L.added = true;
    this.cityBlocks = L.blocks; this.cityBridges = L.bridges; this.cityProps = L.props;
    for (const g of L.groups) { this.land.add(g); this.shadow.add(g); }
    this.chimneySmoke = L.smoke; this.land.add(L.smoke);          // (in no shadow picture: smoke throws none)
    // (the houses, the bridges, the yards' hedges and walls in the sun's far picture too, as they had been - by the one
    // layer the two pictures shared; the furniture not (cityprops.js noCastFar): sunshadow.js)
    if (this.shadowFar) for (const g of L.groups) this.shadowFar.add(g);
    // (a city's bridges not drawn from another city: citybridges.js cuts them into pieces by where they stand)
    this._culls?.push(farCull(L.bridges, this.gfx.placesFar ?? Infinity));
  }

  /** (Once the painted ring loaded here; the solid world is all built at load now. Kept so stills and tests can still
   *  call it.) */
  round() { this.rounded = true; return (this.roundDone ??= Promise.resolve()); }
  /** All of it at once (stills, tests). */
  async roundNow() {
    this.round();
    await this.roundDone;
  }

  /** The sun's picture fitted round the meadow in view and the trees on it, turned with the view (yaw, radians) and
   *  moved to where the camera stands. */
  _fitShadow(yaw) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z), c = Math.cos(yaw), s = Math.sin(yaw);
    const boxes = [[V(-24, -8, -30), V(24, 1.5, -0.5)], [V(-22, -4, -28), V(22, 22, -4)], [V(-17, -2, -1), V(1, 21, 13)]];
    // (turned: each box's corners turned about the camera, the box round them)
    const F = this.freeCam, { x: ax, z: az } = F.on ? F.pos : this.at, ay = this.ground ? this.ground.heightAt(ax, az) : 0;
    const turned = boxes.map(([a, b]) => {
      const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? b.x : a.x, y = i & 2 ? b.y : a.y, z = i & 4 ? b.z : a.z, p = V(ax + x * c - z * s, ay + y, az + x * s + z * c);
        lo.min(p); hi.max(p);
      }
      return [lo, hi];
    });
    this.shadow.fit(turned);
    // (the far picture: from just behind the walker to 420 m ahead, 300 m either side, the tallest trees and roofs in it)
    if (this.shadowFar) {
      const far = [[V(-300, -90, -420), V(300, 70, 60)]].map(([a, b]) => {
        const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < 8; i++) {
          const x = i & 1 ? b.x : a.x, y = i & 2 ? b.y : a.y, z = i & 4 ? b.z : a.z;
          lo.min(V(ax + x * c - z * s, ay + y, az + x * s + z * c)); hi.max(V(ax + x * c - z * s, ay + y, az + x * s + z * c));
        }
        return [lo, hi];
      });
      // (where the far picture is drawn every few frames (hardware.js shadowFarEvery), it is fitted in the frame it is
      // drawn, never between: fitted every frame and drawn every other, its shadows had come and gone as the camera moved)
      if ((this.gfx.shadowFarEvery ?? 1) > 1 && this._farDrawn) this._farFit = far;
      else this.shadowFar.fit(far);
    }
    this.shadowYaw = yaw; this.shadowAt = { x: ax, z: az };
  }

  /** The hands' reflections: this overcast sky over the meadow, as an environment map (the hero asks once it is loaded). */
  environment(renderer) { return skyEnvironment(renderer, this.U); }

  /** The view: the painting's frame cropped to the hero's shape around the anchor (the window, in tangents at a
   *  distance of 1: base); how far it can turn from there. */
  _window() {
    const A = this.aspect, P = FRAME.w / FRAME.h;
    const S = A > P ? [1, P / A] : [A / P, 1];
    const O = [0, 1].map((k) => Math.min(1 - S[k], Math.max(0, this.anchor[k] - S[k] / 2)));
    const x0 = -SPAN_X / 2 + O[0] * SPAN_X, x1 = x0 + S[0] * SPAN_X;
    const y0 = FRAME.horizon * SPAN_Y - O[1] * SPAN_Y, y1 = y0 - S[1] * SPAN_Y;
    this.base = { x0, x1, y0, y1 };
    this._lens();
    this.look.drawn = null;
    this._skyRange();
  }
  /** The lens as zoomed: the window narrowed about its middle; and how far the view can turn and tip at this zoom. */
  _lens() {
    const B = this.base, z = this.look.zoom, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, near = 0.05, far = 60000;
    const x0 = cx + (B.x0 - cx) / z, x1 = cx + (B.x1 - cx) / z, y0 = cy + (B.y0 - cy) / z, y1 = cy + (B.y1 - cy) / z;
    this.cam.projectionMatrix.makePerspective(x0 * near, x1 * near, y0 * near, y1 * near, near, far);
    this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert();
    this.tans = { x0, x1, y0, y1 };
    // (the whole view, unzoomed: what is drawn round the view (the grass's and flowers' sides, the sky's bands) always
    // covers it, so zooming back out finds everything already there)
    this.tans1 = { x0: B.x0, x1: B.x1, y0: B.y0, y1: B.y1 };
    // turning, the view goes all the way round (the ring: valley.js); zoomed in, it can tip as far down and up as the
    // whole view could, zoomed out
    const L = this.look.limits;
    L.yaw = [-Infinity, Infinity];
    const P = this.pitchRange;
    L.pitch = [P[0] + Math.atan(B.y1) - Math.atan(y1), P[1] + Math.atan(B.y0) - Math.atan(y0)];
  }
  get zoomMax() { return this.quality === 'low' ? ZOOM.low : ZOOM.high; }
  /** The sky's panorama: all the way round, coarser than the screen (the part in view is drawn again finely over it,
   *  the inset: clouds.js), as high as the view can tip. */
  _skyRange() {
    if (!this.sky || !this.size) return;
    const { y0, y1 } = this.base, top = Math.atan(y0), vfov = top - Math.atan(y1);
    const pxPerRad = this.size[1] / vfov;
    this.sky.hdr = this.hdr;
    this.sky.setRange(-Math.PI, Math.PI, -0.035, Math.min(Math.PI / 2, top + this.pitchRange[1] + 0.06), pxPerRad, this.quality === 'low' ? 0.9e6 : 2.4e6);
  }

  /** The landscape is drawn at the hero's size (drawing-buffer pixels, at most 3840 across), multisampled. (It was at most
   *  2560 across: on a 3440-wide screen the picture was stretched a third larger than it was drawn, and looked soft.) */
  resize(w, h) {
    const k = Math.min(1, 3840 / w);
    this.size = [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
    this.showU.uTexel.value.set(1 / this.size[0], 1 / this.size[1]);
    if (this.rt && (this.rt.width !== this.size[0] || this.rt.height !== this.size[1])) {
      this.rt.setSize(...this.size); this.distRT.setSize(...this.size); this.look.drawn = null;
    }
    this._skyRange();
  }
  /** The scene's own pictures made (its picture, the weather's map, the sky's panorama) before anything is drawn:
   *  what its programs are made for - walk.js prime(). */
  prepare(renderer) { this._targets(renderer); }
  _targets(renderer) {
    if (this.rt || !this.size) return;
    this.hdr = renderer.extensions.has('EXT_color_buffer_float');    // linear light with its highlights, where it can be drawn
    // (8 samples where the card has them, 4 before)
    const samples = Math.min(this.gfx.msaa ?? 8, renderer.capabilities.maxSamples ?? 4);
    this.rt = new THREE.WebGLRenderTarget(...this.size, { samples, depthBuffer: true, type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.rt.texture.colorSpace = this.hdr ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    // (its depth kept, for the air's shafts in the show pass)
    this.rt.depthTexture = new THREE.DepthTexture(...this.size); this.rt.depthTexture.type = THREE.FloatType;
    this.showU.uDepth.value = this.rt.depthTexture;
    this.showU.uAirSteps.value = this.quality === 'low' ? 6 : 10;
    this.distRT = new THREE.WebGLRenderTarget(...this.size, { type: THREE.UnsignedByteType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.showU.uPic.value = this.rt.texture;
    // the weather, made once on the GPU (its map is kept on the CPU too); every material shares U's uniform objects,
    // so their values are filled in, not the objects replaced
    this.weather = makeWeather(renderer);
    for (const [k, u] of Object.entries(this.weather.uniforms)) this.U[k].value = u.value;
    this.weather.update(this.t ?? 0);                     // (where the clouds are now: the sky is drawn from it at once)
    this.skyT = undefined;
    this._skyRange();
  }

  fit(cx, cy, visH, aspect) { this.aspect = aspect; this._window(); }
  camera(camZ) { return { far: camZ * 2, fog: null }; }

  /** Turn the view (radians), with the hands drawn back; by the hero, from a drag or the arrow keys. */
  lookBy(dYaw, dPitch) {
    const L = this.look;
    if (!L.free) return;
    if (L.anchor) { L.goal = [L.yaw, L.pitch]; L.anchor = null; }      // (a turn ends a zoom's hold on its point)
    const M = L.limits, g = L.goal;
    g[0] = Math.min(M.yaw[1], Math.max(M.yaw[0], g[0] + dYaw));
    g[1] = Math.min(M.pitch[1], Math.max(M.pitch[0], g[1] + dPitch));
  }
  /** How far the view turns for a pixel of drag (radians), in a hero `height` px tall: the scene moves with the pointer. */
  radPerPx(height) { const { y0, y1 } = this.tans; return (Math.atan(y0) - Math.atan(y1)) / Math.max(1, height); }
  /** Free to look around (the hands drawn back) or not (the view eases back to the painter's, zoomed out, the shorter
   *  way round). */
  setFree(on) {
    const L = this.look;
    L.free = !!on;
    if (!on) { L.goal = [L.yaw - wrapAngle(L.yaw), 0]; L.zoomGoal = 1; L.anchor = null; }
    else this.round();
  }

  // ---- FREE-CAM (dev only; remove for the final product) ----------------------------------------------
  /** Fly free: start where the view is now, let the view look all the way up and down, load the land all the way round. */
  enterFree() {
    const F = this.freeCam;
    if (F.on || !this.ready) return;
    F.on = true;
    F.pos.copy(this.cam.position);
    this._pitchSave = this.pitchRange.slice();
    this.pitchRange = [-1.5533, 1.5533];          // look all the way up and down while flying (update() re-runs _lens)
    this._skyRange();                             // extend the sky's panorama up to the zenith so flying high has sky
    this.round();                                 // the whole ring of land, so flying round reveals it
  }
  /** Leave the free-cam and set the walker down on the ground under it, still looking the way the camera looks. */
  exitFree() {
    const F = this.freeCam;
    if (!F.on) return;
    F.on = false;
    if (this._pitchSave) { this.pitchRange = this._pitchSave; this._pitchSave = null; }
    const L = this.look;
    const P = this.pitchRange, pitch = Math.min(P[1], Math.max(P[0], L.pitch));
    L.pitch = pitch; L.goal = [L.yaw, pitch]; L.zoom = 1; L.zoomGoal = 1; L.anchor = null; L.drawn = null;
    // (on land within the walk's bounds: over water or past the rim, the nearest place the walker may stand)
    this.at.x = F.pos.x; this.at.z = F.pos.z;
    const at = this.walkTo(F.pos.x, F.pos.z, true);
    if (at) { this.at.x = at.x; this.at.z = at.z; }
    this._lens(); this._skyRange();
    this.round();
  }
  /** One free-cam step: (f, r, u) along the view, along the horizontal right, and along world-up; `boost` for speed.
   *  Unrestricted — it flies anywhere, above or below the land. */
  flyFree(dt, f, r, u, boost) {
    const F = this.freeCam;
    if (!F.on || dt <= 0) return;
    const L = this.look, sp = F.speed * (boost ? 5 : 1) * dt;
    const cp = Math.cos(L.pitch), spd = Math.sin(L.pitch), cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
    const dx = (cp * sy) * f + cy * r;            // forward (follows the pitch) + horizontal right
    const dy = spd * f + u;                       // the forward's rise + world-up
    const dz = (-cp * cy) * f + sy * r;
    const m = Math.hypot(dx, dy, dz);
    if (m > 1e-6) { F.pos.x += (dx / m) * sp; F.pos.y += (dy / m) * sp; F.pos.z += (dz / m) * sp; }
    // (a ceiling and a floor: 300 m over the land, or 8 km with ?dev in the address, to check layouts from above)
    F.pos.y = Math.min(DEV ? 8000 : 300, Math.max((this.ground?.heightAt(F.pos.x, F.pos.z) ?? -1) + 0.4, F.pos.y));   // (never under the land: it lies 25 m below the hilltop in places)
  }
  // ---- end FREE-CAM ---------------------------------------------------------------------------------

  /** The direction (world) through the view's point (sx across, sy down, 0..1), as the view is turned and zoomed. */
  dirAt(sx, sy, yaw = this.look.yaw, pitch = this.look.pitch, t = this.tans) {
    const u = t.x0 + sx * (t.x1 - t.x0), v = t.y0 + sy * (t.y1 - t.y0), n = Math.hypot(u, v, 1);
    const x = u / n, y = v / n, z = -1 / n, cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const y1 = y * cp - z * sp, z1 = y * sp + z * cp;                // tipped (about x), then turned (about y)
    return [x * cy - z1 * sy_, y1, x * sy_ + z1 * cy];
  }
  /** How the view must be turned [yaw, pitch] for direction D to lie under its point (sx, sy) at this zoom. */
  turnFor(D, sx, sy, t = this.tans) {
    const u = t.x0 + sx * (t.x1 - t.x0), v = t.y0 + sy * (t.y1 - t.y0), n = Math.hypot(u, v, 1);
    // tipped by p, the point's ray rises (v cos p + sin p) / n = sqrt(1 + v^2) sin(p + atan v) / n: as high as D
    const pitch = Math.asin(Math.max(-1, Math.min(1, D[1] * n / Math.hypot(v, 1)))) - Math.atan(v);
    const zt = (v * Math.sin(pitch) - Math.cos(pitch)) / n;
    const yaw = Math.atan2(D[0], -D[2]) - Math.atan2(u / n, -zt);
    return [this.look.yaw + wrapAngle(yaw - this.look.yaw), pitch];          // (the same turn as now, give or take)
  }
  /** Zoom by `factor` toward the view's point (sx, sy): what is under it stays under it (the wheel, the keys). */
  zoomAt(factor, sx = 0.5, sy = 0.5) {
    const L = this.look;
    if (!L.free) return;
    L.anchor = { sx, sy, D: this.dirAt(sx, sy) };
    L.zoomGoal = Math.min(this.zoomMax, Math.max(1, L.zoomGoal * factor));
  }
  /** A pinch: grab what is under the view's point, then hold it under the (moving) point, zoomed `scale` times. */
  grab(sx, sy) { return { D: this.dirAt(sx, sy), zoom: this.look.zoomGoal }; }
  hold(g, sx, sy, scale = 1) {
    const L = this.look;
    if (!L.free || !g) return;
    L.zoomGoal = Math.min(this.zoomMax, Math.max(1, g.zoom * scale));
    L.anchor = { sx, sy, D: g.D, held: true };
  }
  letGo() { if (this.look.anchor) this.look.anchor.held = false; }

  /** Draw the landscape (before the hero draws the hands): the sky, the painted valley over it, the near world. */
  prerender(renderer) {
    this._targets(renderer);
    if (!this.ready || !this.rt || !this.group.visible) return;
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    // the camera, where it stands and as turned
    const L = this.look;
    if (this.freeCam.on) this.cam.position.copy(this.freeCam.pos);
    else this.cam.position.set(this.at.x, Math.max(this.ground.heightAt(this.at.x, this.at.z), this.bridges?.userData.deckAt(this.at.x, this.at.z) ?? -1e9) + (this.stance?.eye ?? EYE) + (this.stance?.jump ?? 0), this.at.z);
    this.cam.rotation.set(L.pitch, -L.yaw, 0);
    this.cam.updateMatrixWorld(true);
    // (the grass grown round it, only the sides in view; the flowers and the birches near it drawn in full, and only
    // those toward the view; the birches the sun's picture takes in drawn there too, for their shade)
    // while flying free, grow the meadow all the way round (view null) so the hilltop reads as a whole circle from above
    // — not a slice with an un-grassed (grey) wedge where the view isn't pointing. On foot only the side in view is grown.
    const inView = this.freeCam.on ? null : this._azimuths();
    this.meadow.userData.update(this.cam.position, inView, L.zoom);
    this.groves.userData.update?.(this.cam.position, L.zoom, this.cam, this.shadow && this.light.sun > 0.03 ? this.shadow.cam : null);
    // (the far trees' pictures, drawn once the models are in: woods.js impostors)
    if (this.woods?.userData.bake && !this._woodsBaked) { this._woodsBaked = true; this.land.updateMatrixWorld(); this.woods.userData.bake(renderer, this.land.children.filter((o) => o.isLight), this.land.fog); }
    this.woods?.userData.update(this.cam.position, this.cam);
    if (this._culls) for (const c of this._culls) c(this.cam.position);
    this.cityProps?.userData.update(this.cam.position);
    this.cityBlocks?.userData.update?.(this.cam.position);
    this.chimneySmoke?.userData.update(this.cam.position);
    // (what has come in since the last frame let in by turns, and what is rising raised: world/arrive.js)
    pumpArrivals(this.cam.position);
    this.pois?.userData.update(this.cam.position, this.t ?? 0);
    this.sky.aim(this.cam);
    // (nothing to follow the camera now: the drizzle planes were the only thing that needed re-placing every frame)
    // the sky's panorama, a band at a time (all of it at first, or after a jump in time: stills, tests)
    const { y0, y1 } = this.tans1 ?? this.tans, R = this.sky.range, span = R.w - R.z;
    const view = [(L.pitch + Math.atan(y1) - R.z) / span, (L.pitch + Math.atan(y0) - R.z) / span];
    const jump = this.skyT === undefined || Math.abs(this.t - this.skyT) > 1.5;
    this.sky.update(renderer, this.t ?? 0, { full: jump, view });
    this.sky.updateInset(renderer, this.t ?? 0, this._insetWanted(jump), this.dt);
    this.skyT = this.t;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.skyScene, this.cam);
    // the land past 6 km, in its own depth range (near 150 m, out to 400 km), then the depth cleared for the near world
    if (this.landRings) {
      this.landRings.update(this.cam.position);
      this.world?.ways?.update(this.cam.position);
      this.wayStones?.userData.update(this.cam.position);
      this.wayRibbons?.userData.update(this.cam.position);
      const n2 = 150, f2 = 400000;
      this.farCam.position.copy(this.cam.position); this.farCam.quaternion.copy(this.cam.quaternion);
      this.farCam.projectionMatrix.copy(this.cam.projectionMatrix);
      const E = this.farCam.projectionMatrix.elements;
      E[10] = -(f2 + n2) / (f2 - n2); E[14] = -2 * f2 * n2 / (f2 - n2);
      this.farCam.projectionMatrixInverse.copy(this.farCam.projectionMatrix).invert();
      this.farCam.updateMatrixWorld(true);
      renderer.render(this.farScene, this.farCam);
      renderer.clearDepth();
    }
    // (everything in the land placed for this frame: once, for the shadows and the view alike)
    this.land.updateMatrixWorld();
    // the birches' shadows, while the sun is out over the hilltop
    if (this.shadow) {
      renderer.setRenderTarget(null);
      // (the machine's settings: both shadow pictures, the near one only, or none - hardware.js)
      const sh = this.gfx.shadows ?? 'both', sunUp = this.light.sun > 0.03;
      this.shadow.render(renderer, this.land, sunUp && sh !== 'none');
      // (the far picture every frame too: drawn every other frame, it lagged the frame its fit moved on, and while the
      // camera moved the houses' shadows came and went frame by frame. Half a millisecond since the scene's places are
      // worked out once a frame.)
      if (this.shadowFar) {
        const every = this.gfx.shadowFarEvery ?? 1;
        this._farN = ((this._farN ?? -1) + 1) % every;
        if (this._farN === 0 || !this._farDrawn) {
          if (this._farFit) { this.shadowFar.fit(this._farFit); this._farFit = null; }
          this.shadowFar.render(renderer, this.land, sunUp && sh === 'both'); this._farDrawn = true;
        }
      }
      renderer.setRenderTarget(this.rt);
    }
    renderer.render(this.land, this.cam);
    // (where the sun stands on the screen, for the shafts; faded as it leaves the view and when a cloud is over it)
    {
      const sd = this.U.uSunDir.value, fwd = this._fwd ??= new THREE.Vector3(), sp = this._sunP ??= new THREE.Vector3();
      this.cam.getWorldDirection(fwd);
      const facing = fwd.dot(sd);
      if (facing > 0.05) {
        sp.copy(this.cam.position).addScaledVector(sd, 1e4).project(this.cam);
        this.showU.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      }
      this.showU.uSunVis.value = THREE.MathUtils.smoothstep(facing, 0.05, 0.6) * Math.max(0.15, this.light.sun ?? 1);
      this.showU.uSunLit.value = Math.max(0.1, this.light.sun ?? 1);
      this.showU.uInvProj.value.copy(this.cam.projectionMatrixInverse); this.showU.uCamWorld.value.copy(this.cam.matrixWorld);
      this.showU.uAspect.value = this.size[0] / this.size[1];
    }
    renderer.autoClear = auto;
    renderer.setClearColor(cc, ca);
    renderer.setRenderTarget(prev);
  }

  /** The directions in view, round from where it is turned ({ az0, az1 }, radians right of ahead), or null when it
   *  looks so far down or up that any direction may be in it. */
  _azimuths() {
    const L = this.look, yaw = wrapAngle(L.yaw);
    let lo = Infinity, hi = -Infinity;
    for (const [sx, sy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
      const d = this.dirAt(sx, sy, L.yaw, L.pitch, this.tans1 ?? this.tans);
      if (Math.abs(d[1]) > 0.97) return null;
      const a = yaw + wrapAngle(Math.atan2(d[0], -d[2]) - yaw);
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    return { az0: lo, az1: hi };
  }

  /** Walk toward (x, z) m: as far as the painting holds (WALK) and round the trunks and the big stones. Where the
   *  camera stands now ({ x, z }). */
  /** The walker's step to (x, z) from where he stands, or - jump - his being set down there (a pose, the free
   *  camera's landing): where he comes to. */
  walkTo(x, z, jump = false) {
    let px = x, pz = z;
    for (let it = 0; it < 6; it++) {
      let worst = 0, wx = 0, wz = 0;
      for (const [ex, ez, lim] of this.walkLimits ?? []) {
        const over = px * ex + pz * ez - lim;
        if (over > worst) { worst = over; wx = ex; wz = ez; }
      }
      if (worst > 0) { px -= worst * wx; pz -= worst * wz; }
      const WC = this.walkCircle;
      if (WC) { const dx = px - WC.x, dz = pz - WC.z, d = Math.hypot(dx, dz); if (d > WC.r) { px = WC.x + dx * WC.r / d; pz = WC.z + dz * WC.r / d; worst = Math.max(worst, d - WC.r); } }
      for (const o of [...(this.solid ?? []), ...(this.woods?.userData.solidNear() ?? [])]) {
        const dx = px - o.x, dz = pz - o.z, d = Math.hypot(dx, dz), r = o.r + WALK.body;
        if (d < r && d > 1e-6) { px = o.x + (dx * r) / d; pz = o.z + (dz * r) / d; }
      }
      if (worst < 1e-4) break;
    }
    // not into a landmark, a palace, a cabin, a fence: out of its own outline and a step off its wall (world/plans.js -
    // the outline of the model itself; he had gone round circles laid along each one's box, and through the corners of
    // anything not round)
    if (this.plans) { const q = jump ? this.plans.push(px, pz, WALK.body + 0.15) : this.plans.step(this.at.x, this.at.z, px, pz, WALK.body + 0.15); px = q[0]; pz = q[1]; }
    // not into a house: along the street's wall instead, or stay
    const BA = this.cityBlocks?.userData.builtAt;
    if (BA && BA(px, pz)) {
      if (!BA(px, this.at.z)) pz = this.at.z;
      else if (!BA(this.at.x, pz)) px = this.at.x;
      else { px = this.at.x; pz = this.at.z; }
    }
    // (nor with the eye through a wall: a step clear of every wall near, measured on the walls themselves - the houses'
    // picture above is 2 m a pixel)
    const WP = this.cityBlocks?.userData.wallPush;
    if (WP) { const q = WP(px, pz, 0.45); if (!BA || !BA(q[0], q[1]) || BA(px, pz)) { px = q[0]; pz = q[1]; } }
    // not into water deeper than the knees: stop at its edge
    const W = this.world;
    if (W) {
      const deep = (x, z) => { if (this.bridges?.userData.deckAt(x, z) != null) return false; const w = W.waterAt(x, z); return w !== null && w - W.landAt(x, z) > 0.5; };
      if (deep(px, pz)) {
        let lo = 0, hi = 1; const ox = this.at.x, oz = this.at.z;
        if (deep(ox, oz)) { this.at.x = px; this.at.z = pz; return this.at; }   // (already in it: let it wade out)
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (deep(ox + (px - ox) * m, oz + (pz - oz) * m)) hi = m; else lo = m; }
        px = ox + (px - ox) * lo; pz = oz + (pz - oz) * lo;
      }
    }
    this.at.x = px; this.at.z = pz;
    return this.at;
  }

  /** The finer panorama of the sky wanted: the part in view, a fifth of it again either way, at the screen's own
   *  resolution (as far as maxPx allows). (Its azimuths are taken round from where the view is turned, so a view
   *  straddling the back is one piece: clouds.js reads it so.) */
  _insetWanted(full) {
    const L = this.look, T = this.tans;
    const dirs = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]].map(([sx, sy]) => this.dirAt(sx, sy));
    const yaw = wrapAngle(L.yaw);
    const az = dirs.map((d) => yaw + wrapAngle(Math.atan2(d[0], -d[2]) - yaw)), el = dirs.map((d) => Math.asin(d[1]));
    const view = [Math.min(...az), Math.max(...az), Math.min(...el), Math.max(...el)];
    const mw = (view[1] - view[0]) * 0.2, mh = (view[3] - view[2]) * 0.2;
    const range = [view[0] - mw, view[1] + mw, view[2] - mh, view[3] + mh];
    const maxPx = this.quality === 'low' ? 1.2e6 : 3.5e6;
    const need = this.size[1] / (Math.atan(T.y0) - Math.atan(T.y1));
    const px = Math.min(need, Math.sqrt(maxPx / ((range[1] - range[0]) * (range[3] - range[2]))));
    return { view, range, px, maxPx, full, settled: Math.abs(Math.log(L.zoom / L.zoomGoal)) < 0.03 };
  }

  /** 0..1 how much of the scene shows; ahead: drawn over the scene it replaces, dissolving in. */
  setFade(k, ahead = false) {
    this.quad.renderOrder = ahead ? -20 : -30;
    this.showU.uAlpha.value = ahead ? THREE.MathUtils.smootherstep(k, 0, 1) : 1;
    this.group.visible = k > 0;
  }

  /** The wind at time t: a light air most of the time, and every 12 to 35 seconds a gust of two or three pulses that
   *  travels through the land downwind past the walker (laid out ahead from a fixed seed, so any moment can be shown
   *  again: stills, tests). gust: how strong now, 0..1.2; front: how far through it is (0..1, the sound's sweep);
   *  frontM: where its front is, metres downwind of the walker (the shaders' gustAt). */
  windAt(t) {
    const G = this.gusts;
    while (G[G.length - 1].t0 < t + 40) {
      const p = G[G.length - 1], r = this.rng;
      const pulses = 2 + Math.floor(r() * 2);
      G.push({ t0: p.t0 + p.len + 12 + r() * 23, len: 5.5 + r() * 4.5, amp: 0.7 + r() * 0.5, pulses, ph: r() });
    }
    let gust = 0, front = -9, frontM = -1e4;
    for (let i = G.length - 1; i >= 0; i--) {
      if (G[i].t0 > t) continue;
      const g = G[i], u = (t - g.t0) / g.len;
      if (u <= 1) {
        // (a swell and a fall, with its pulses on it: a gust is never one smooth push)
        const env = Math.sin(Math.PI * u) ** 1.2, n = g.pulses ?? 1;
        const puls = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * (u * n + (g.ph ?? 0) * 0.3)));
        gust = g.amp * env * puls; front = -0.25 + 1.5 * u; frontM = -160 + 320 * u;
      }
      break;
    }
    // (calm spells: a slow swell of the weather's own, about half the time near still, easing over some ten seconds; a
    // gust comes only when the wind is up)
    const n = 0.5 + 0.3 * Math.sin(t * 2 * Math.PI / 83 + 1.3) + 0.2 * Math.sin(t * 2 * Math.PI / 151 + 4.1);
    const level = 0.07 + 0.93 * THREE.MathUtils.smoothstep(n, 0.42, 0.58);
    gust *= THREE.MathUtils.smoothstep(level, 0.3, 0.8);
    return { gust, front, frontM, level };
  }

  update(t) {
    const w = this.windAt(t), dt = Math.min(0.1, Math.max(0, t - (this.t ?? t)));
    this.t = t; this.dt = dt;
    this.U.uTime.value = t; this.U.uGust.value = w.gust; this.U.uFront.value = w.frontM; if (this.U.uWindLevel) this.U.uWindLevel.value = w.level;
    if (this.cam && this.U.uWindOrigin) this.U.uWindOrigin.value.set(this.cam.position.x, this.cam.position.z); this.U.uViewYaw.value = wrapAngle(this.look.yaw);
    this.wind = w;
    // the view eases toward where it is turned and how far zoomed (the walker's look is set outright: goal and view
    // alike); while zooming toward a point, it is turned so that what was under the point stays there
    const L = this.look, k = dt > 0 ? 1 - Math.exp(-dt * (L.free ? 12 : 3.2)) : 1;
    const lz = Math.log(L.zoom), lg = Math.log(L.zoomGoal);
    L.zoom = Math.abs(lg - lz) * (1 - k) < 1e-4 ? L.zoomGoal : Math.exp(lz + (lg - lz) * k);
    if (this.base) this._lens();
    const M = L.limits, clamp = (v, r) => Math.min(r[1], Math.max(r[0], v));
    if (L.anchor && this.base) {
      const [yaw, pitch] = this.turnFor(L.anchor.D, L.anchor.sx, L.anchor.sy);
      L.yaw = clamp(yaw, M.yaw); L.pitch = clamp(pitch, M.pitch); L.goal = [L.yaw, L.pitch];
      if (L.zoom === L.zoomGoal && !L.anchor.held) L.anchor = null;
    } else {
      L.goal[0] = clamp(L.goal[0], M.yaw); L.goal[1] = clamp(L.goal[1], M.pitch);
      L.yaw += (L.goal[0] - L.yaw) * k;
      L.pitch += (L.goal[1] - L.pitch) * k;
      if (Math.abs(L.goal[0] - L.yaw) < 1e-5) L.yaw = L.goal[0];
      if (Math.abs(L.goal[1] - L.pitch) < 1e-5) L.pitch = L.goal[1];
    }
    // (back home after turning all the way round: the count of whole turns forgotten)
    if (!L.free && L.yaw === L.goal[0] && L.yaw !== 0 && Math.abs(wrapAngle(L.yaw)) < 1e-9) { L.yaw = 0; L.goal[0] = 0; }
    // the sun's picture of the birches follows the view round, and the walker
    const sp = this.freeCam.on ? this.freeCam.pos : this.at;
    const moved = this.shadowAt ? Math.hypot(sp.x - this.shadowAt.x, sp.z - this.shadowAt.z) : 0;
    if (this.shadow && (Math.abs(wrapAngle(L.yaw - this.shadowYaw)) > 0.08 || moved > 1)) this._fitShadow(Math.abs(wrapAngle(L.yaw)) < 0.04 ? 0 : wrapAngle(L.yaw));
    if (this.weather) {
      this.weather.update(t);
      const FC = this.freeCam;
      const here = FC.on ? FC.pos.clone() : new THREE.Vector3(this.at.x, (this.ground?.heightAt(this.at.x, this.at.z) ?? 0) + EYE, this.at.z);
      this.light.sun = (this.weather.sunAt(here, this.U.uSunDir.value) - 0.07) / 0.93;
      this.light.rain = 0;                  // (no rain in the picture, so none to hear either: sound.js's hiss and
                                            // patter both ride on this number, and fade out with it)
    }
    this.sound?.update(w, t, this.light.rain, { yaw: wrapAngle(L.yaw) });
  }

  startSound(ctx, out) { if (!this.sound && this.makeSound) this.sound = this.makeSound(ctx, out); this.sound?.start(); }
  stopSound() { this.sound?.stop(); }
  setLinear() {}                                  // (the picture is laid down in whatever space the hero draws in)
}
