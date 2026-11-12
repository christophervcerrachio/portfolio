// The meadow's grass, laid out round wherever the camera stands (the visitor walks the hilltop now): close by, dense and
// fine; further off thinner, its blades wider, so the meadow still reads full (as it always did from where the painter
// stood: as thick within 3 m, then thinning as (3 / r)^1.6, its blades widening as (r / 4)^0.7; from 12 m on, thinner
// and wider still).
//
// Every blade belongs to a place on the hill, not to the view. The hill is cut into cells, finer near the camera and
// coarser further out, in rings round it (each ring a level); each cell's blade is made from the cell's own number
// (where in the cell it stands, how tall, which way it leans and turns), so as the camera walks on, the blades it passes
// stay where they stand. Only as a place comes near enough to need more blades (or goes far enough to need fewer) do
// blades grow up out of the turf there (or sink back into it), a few at a time; between one ring and the next, the
// blades of the one sink as those of the next grow, so the meadow's thickness never jumps.
//
// Each ring is cut into sectors round the camera (all but the first ring's middle), and only those the view can see are
// drawn.
import * as THREE from 'three';
import { WIND_GLSL } from './wind-glsl.js';
import { LAND_GLSL } from '../world/terrain.js';
import { WAYS_GLSL } from '../world/paths.js';
import { pathTexture, PATH_SPAN } from './paths.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// how thick the grass stands r m from the camera (of the most, close by) and how much wider its blades are there (past
// 12 m it thins as r^-1.7, not r^-2.4, and its blades widen as r, so the meadow covers the ground as thickly far off as
// near)
export const thick = (r) => (r <= 3 ? 1 : r <= 12 ? (3 / r) ** 1.6 : 0.10882 * (12 / r) ** 1.4);
// the rings: where each fades in and out (m from the camera; each fades in where the last fades out), how many sides
// it is cut into, and how many rows each of its blades has
// (five more rings, out to 300 m, each thinner and its blades wider, so past the near meadow the grass still stands as
// tufts; past 300 m the land's own shading carries on its colour)
// (three more rings, out to 950 m; each ring's sides out of view are not drawn, and past that the land's own meadow
// colour carries it to the horizon)
const EDGES = [0, 3.0, 3.3, 4.5, 4.95, 6.75, 7.4, 10.1, 11.1, 15.2, 16.7, 22.8, 25.1, 36, 40, 55, 60, 82, 90, 120, 132, 180, 200, 280, 300, 420, 460, 620, 680, 700, 950];
// (the last ring thins out over its whole outer quarter-kilometre, 700 to 950 m, not the last 70: its edge had shown as
// a circle drawn round the walker across the fields' strips, the crops' colour against the land's)
// (every ring's blades as finely made as the nearest, five rows each)
const RINGS = [[8, 5], [8, 5], [8, 5], [8, 5], [16, 5], [16, 5], [16, 5], [32, 5], [32, 5], [32, 5], [32, 5], [32, 5], [64, 5], [64, 5], [64, 5]];
// (the first ring's cells within CORE m of the camera are drawn whichever way it looks: below the view, mostly, but
// a blade there can lean into it; the rest of the ring is cut into sides like the others)
const CORE = 1.3;
// blades to the square metre close by
// (blades a square metre at the feet; 2000 until 8 Nov 2026, then 1000, then 700 for a steady 60 frames a second: the
// last, no thinner)
const TIERS = { high: 700, low: 230 };

const GRASS_VERT = /* glsl */`
${WIND_GLSL}
${LAND_GLSL}
uniform sampler2D uFlow;
${WAYS_GLSL}
uniform float uWorldOn;   // the world's land loaded (world/terrain.js): the grass grows over all of it, not the hilltop only
attribute vec2 aCell;      // the cell, counted from the camera's own (in cells)
uniform vec2 uOrg;         // the camera's cell (its number, east and south)
uniform float uCell;       // the cells' size (m)
uniform vec4 uFade;        // where this ring fades in (from, to) and out (from, to), m from the camera
uniform float uMost;       // how thick this ring's cells stand, of the most (one blade to each)
uniform float uWide;       // how much wider every blade is (a machine that draws fewer of them: hardware.js grass.wide)
uniform float uFloor;      // the least the grass thins to with distance, of the most (0: as far as thick() takes it)
uniform float uRing;
uniform sampler2D uHill; uniform float uHillSpan;      // the ground's height, seen from above (heightAt)
uniform sampler2D uPath; uniform float uPathSpan;      // the paths (paths.js: r bare earth, b the grassy crown)
uniform vec4 uMeadow;      // where the meadow ends: browR's terms (13 + 11 min(1.3, (phi / edge)^2)) times a reach
varying vec3 vN; varying float vT; varying float vSeed; varying float vCrest; varying float vDist; varying float vSun; varying float vKind;

uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float next(inout uint h) { h = pcg(h); return float(h >> 8u) * (1.0 / 16777216.0); }
float thick(float r) { return max(uFloor, r <= 3.0 ? 1.0 : r <= 12.0 ? pow(3.0 / r, 1.6) : 0.10882 * pow(12.0 / r, 1.4)); }
// (far blades are not made into wide flat cards; they widen only as much as a pixel grows, and there are more of them:
// thick() past 12 m is r^-1.4)
float wider(float r) { return max(max(1.0, pow(r / 6.0, 0.55)), r * 0.00055 / 0.0055); }   // (and never thinner than about a pixel)

void main() {
  ivec2 c = ivec2(floor(uOrg + aCell + 0.5));
  uint h = pcg(uint(c.x + 65536) * 2654435761u ^ pcg(uint(c.y + 65536) ^ (uint(uRing) * 2246822519u)));
  vec2 xz = (vec2(c) + vec2(next(h), next(h))) * uCell;
  float rank = next(h);
  // how many of this ring's cells carry a blade here (its share of the meadow's thickness, where two rings overlap)
  float r = length(xz - cameraPosition.xz);
  float share = (uFade.y > 0.0 ? smoothstep(uFade.x, uFade.y, r) : 1.0) * (1.0 - smoothstep(uFade.z, uFade.w, r));
  float grow = smoothstep(0.0, 0.05, thick(r) / uMost * share - rank);
  // (out to where the meadow ends, a little past the brow on every side)
  float q = atan(xz.x, -xz.y) / uMeadow.z;
  float onHill = 1.0 - smoothstep(-1.5, 0.0, length(xz) - (uMeadow.x + uMeadow.y * min(1.3, q * q)) * uMeadow.w);
  float onLand = 0.0, tall = 1.0, kind = 0.0;
  if (uWorldOn > 0.5) {
    // past the hilltop, by what the land is there: none on roads, in towns, on rock or under water; thin under the
    // woods and in the grain; longer and lusher in the wet hollows
    vec2 uv = coreUV(xz); vec4 A = textureLod(uCovA, uv, 0.0), B = textureLod(uCovB, uv, 0.0);
    A.r = max(A.r, copseAt(xz, A, B));         // (the copses in the open land: terrain.js)
    A.g = max(A.g, moreFields(xz, A, B)) * (1.0 - smoothstep(0.3, 0.55, A.r));   // (the farmland the land draws there too, never under the trees: terrain.js)
    // (the land's road cover is 8 m texels, blurred: near the camera the ways' own sharp picture cuts the grass instead
    // (below), or a bare green band ten metres wide runs beside every path)
    vec2 wd = abs(xz - uWayC2); float wayIn = 1.0 - smoothstep(850.0, 1000.0, max(wd.x, wd.y));
    onLand = 1.0 - smoothstep(0.3, 0.6, 1.0 - A.a) * (1.0 - wayIn) - smoothstep(0.3, 0.6, B.r) - smoothstep(0.35, 0.7, 1.0 - B.a) * (1.0 - smoothstep(0.3, 0.6, A.g)) * smoothstep(0.3, 0.6, slopeAt(xz));   // (the bare hills: their gentle slopes farmed, the rest grassed, only the steep faces bare rock)
    // (no grass on the town's paving: the same edge the land paves to (terrain.js townW, seams of the cover closed), not
    // the cover's soft ramp - between the two, blades had stood on the setts)
    {
      float tC = B.r;
      if (tC < 0.7) {
        float tE = textureLod(uCovB, coreUV(xz + vec2(11.0, 0.0)), 0.0).r, tW = textureLod(uCovB, coreUV(xz - vec2(11.0, 0.0)), 0.0).r;
        float tN = textureLod(uCovB, coreUV(xz + vec2(0.0, 11.0)), 0.0).r, tS = textureLod(uCovB, coreUV(xz - vec2(0.0, 11.0)), 0.0).r;
        tC = max(tC, max(min(tE, tW), min(tN, tS)));
      }
      // (a little wider than the paving's own edge, so no blade leans out over its last setts)
      onLand *= 1.0 - smoothstep(0.38, 0.46, tC + (vnoise(xz * 0.35) - 0.5) * 0.08);
    }
    // (in the woods' shade the meadow grass gives way to the forest floor: a few thin tufts, short)
    float shadeW = smoothstep(0.8, 0.97, A.r);      // (only deep in the woods: the cover is blurred, and the clearings and wood edges keep their grass)
    // (open grass and forest grass differ, as on a pine wood's floor: under the trees not meadow grass but a low carpet
    // of bilberry and young growth, knee-low and leafy, in patches, the bare floor between; vKind 7)
    float forestW = smoothstep(0.55, 0.88, A.r);
    onLand *= 1.0 - 0.35 * shadeW;
    // in the fields, the crop itself: rye taller than a man's waist, oats, flax in blue flower; reeds by the water;
    // wildflowers through the meadows (camomile, cornflowers, clover, bellflowers)
    vec4 fs = fieldStrip(xz);
    float fieldW = smoothstep(0.3, 0.6, A.g) * (1.0 - fs.w);
    float pick = fract(rank * 7.31 + 0.137);
    if (fieldW > 0.0 && fs.x < 2.5 && pick < fieldW * smoothstep(0.03, 0.12, fs.y) * smoothstep(0.97, 0.88, fs.y)) kind = 1.0 + fs.x;
    else if (fs.x > 2.5 && fieldW > 0.5) tall = 0.6;
    // (reeds only by still or slow water: never in a mountain stream's run, where the current would take them)
    else if (A.b > 0.55 && A.b < 0.98 && pick < (A.b - 0.55) * 1.6 && length(textureLod(uFlow, uv, 0.0).rg - 0.5) * 6.0 < 0.35) kind = 4.0;
    else if (forestW > 0.0 && fract(rank * 5.71 + 0.31) < forestW) {
      kind = 7.0;
      float patchF = smoothstep(0.3, 0.62, vnoise(xz * 0.11) * 0.75 + vnoise(xz * 0.55) * 0.35);
      onLand *= patchF;
    }
    else if (pick > 1.0 - 0.09 * (0.3 + B.b)) kind = 5.0;   // (more flowering stems)
    else if (onLand > 0.0 && fract(rank * 3.17) < 0.45) kind = 6.0;   // (a stem in seed)
    float wc = waterCode(xz);
    if (wc > 0.5 && wc * 0.5 - 20.0 > landH(xz) - 0.05) onLand = 0.0;
    // (none on the beach, short where it gives way to the turf: terrain.js beachAt)
    float bch = beachAt(xz, landH(xz), 1);
    onLand *= 1.0 - smoothstep(0.35, 0.75, bch) * (kind > 3.5 && kind < 4.5 ? 0.45 : 1.0);   // (reeds keep a few clumps on it: a riverbank as much as a beach)
    onLand = clamp(onLand, 0.0, 1.0) * coreEdge(uv);
    // (the open meadows as DayZ's are: grass knee to waist high, in clumps, thinner and shorter on the crests)
    float clump = smoothstep(0.25, 0.75, vnoise(xz * 0.35)) * 0.7 + 0.3 * vnoise(xz * 1.7);
    tall = (1.6 + 3.2 * clump) * (1.0 + 0.4 * A.b) * (1.0 - 0.7 * shadeW) * (1.0 - 0.6 * bch);
  }
  grow *= max(onHill, onLand);
  // (the hilltop grows as the land round it does now)
  float H = mix(0.1, 0.25, next(h)) * (0.8 + 0.4 * vnoise(xz * 0.5)) * mix(tall, 1.0, onHill * (1.0 - uWorldOn)), roll = next(h);
  // (on a path's bare earth, none; at its edges, shorter, trodden; down a cart track's middle, between the ruts, a thin
  // strip of short grass)
  vec3 pr = uWorldOn > 0.5 ? vec3(0.0) : textureLod(uPath, xz / uPathSpan + 0.5, 0.0).rgb;   // (with the world, its ways cut the grass: below)
  if (pr.r > 0.55) { float cr = pr.b / max(pr.r, 0.01); if (cr < 0.35 || roll > 0.22 * cr) grow = 0.0; H *= 0.3; }
  else H *= 1.0 - 0.65 * pr.r;

  if (kind > 6.5) H = mix(0.1, 0.3, next(h)) * (0.7 + 0.6 * vnoise(xz * 0.9));   // (the forest floor's growth: knee-low)
  if (kind > 0.5 && kind < 4.5) {                // (a stalk stands upright, its crop thick in the rows)
    H = kind < 1.5 ? mix(1.25, 1.65, next(h)) : kind < 2.5 ? mix(0.75, 1.0, next(h)) : kind < 3.5 ? mix(0.65, 0.9, next(h)) : mix(1.3, 2.0, next(h));
    grow = max(grow, smoothstep(0.0, 0.05, thick(r) * 0.8 / uMost * share - rank * 0.5));
  }
  // (on the world's ways nothing grows, crops included: the way itself bare; its verge, a metre either side, trodden
  // short so nothing tall leans over it; paths.js draws the verge faintly round every way)
  if (uWorldOn > 0.5) {
    vec3 wy = wayAt(xz); float on = wy.r + wy.g;
    // (a dirt path: bare, nothing on it)
    if (on > 0.42) grow = 0.0;
    else if (on > 0.02) { H *= mix(1.0, 0.15, smoothstep(0.02, 0.09, on)); kind = kind > 0.5 && kind < 4.5 ? 0.0 : kind; }
  }
  if (grow <= 0.001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }      // (none: off beyond the far plane)
  // (a machine's tufts - uWide - are the meadow's blades made broad; the woods' floor is leaves already, ten times a
  // blade's width: nine times that again had strewn the forest with leaves half a metre across, looked at 12 Nov 2026)
  float W = mix(0.0035, 0.0075, next(h)) * wider(r) * (kind > 6.5 ? min(uWide, 1.5) : uWide), curl = mix(0.05, 0.5, next(h)), seed = next(h), yaw = next(h) * 6.2831853;
  if (kind > 0.5 && kind < 3.5) { W *= 1.3; curl *= 0.25; }
  if (kind > 3.5 && kind < 4.5) { W *= 2.2; curl *= 0.6; }
  if (kind > 6.5) { W *= 10.0; curl = mix(0.5, 1.1, curl); }        // (a leaf on its stalk, broad and short, leaning out: not a blade)
  vKind = kind;
  H *= grow; W *= mix(0.35, 1.0, grow);
  vec2 hs = abs(xz) / uHillSpan;
  vec3 root = vec3(xz.x, uWorldOn > 0.5 && max(hs.x, hs.y) > 0.49 ? landH(xz) : textureLod(uHill, xz / uHillSpan + 0.5, 0.0).r, xz.y);
  // the blade: up from its root, curling over the way it faces, pushed over by the wind
  float t = position.y, side = position.x;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 across = vec3(cy, 0.0, -sy), facing = vec3(sy, 0.0, cy);
  vec3 w = windAt(root, seed);
  vec3 push = vec3(w.x, 0.0, w.y);
  float k = t * t;
  vec3 p = vec3(0.0, H * t, 0.0) + (facing * curl + push) * (H * k);
  p.y -= (dot(w.xy, w.xy) * 0.45 + curl * curl * 0.3) * H * k;                 // (bent over, it is lower)
  p += across * (side * W * (vKind > 6.5 ? sqrt(max(sin(3.14159 * min(t * 1.05, 1.0)), 0.0)) : pow(1.0 - t, 0.85)));   // (a leaf: ovate, round at both ends)
  vec3 tang = vec3(0.0, H, 0.0) + (facing * curl + push) * (2.0 * H * t);
  vN = normalize(normalize(cross(across, tang)) + across * side * 0.5);          // a blade is a little rounded
  vT = t; vSeed = seed; vCrest = w.z;
  vSun = sunThrough(root) * treeShade4(root + p + uSunDir * 0.08);
  vec4 mv = viewMatrix * vec4(root + p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const GRASS_FRAG = /* glsl */`
${WIND_GLSL}
uniform vec3 uRoot; uniform vec3 uMid; uniform vec3 uTip; uniform vec3 uDry;
varying vec3 vN; varying float vT; varying float vSeed; varying float vCrest; varying float vDist; varying float vSun; varying float vKind;
void main() {
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  float r1 = fract(vSeed * 13.7), r2 = fract(vSeed * 7.13);
  vec3 col = mix(uRoot, uMid, smoothstep(0.0, 0.5, vT));
  col = mix(col, mix(uTip, uDry, step(0.86, r2)), smoothstep(0.3, 1.0, vT));
  // the crops, reeds and flowers (grass.js vertex: vKind 1 rye, 2 oats, 3 flax, 4 reed, 5 a flowering stem)
  if (vKind > 0.5 && vKind < 1.5) col = mix(vec3(0.46, 0.44, 0.18), mix(vec3(0.78, 0.64, 0.30), vec3(0.70, 0.52, 0.24), step(0.82, vT)), smoothstep(0.0, 0.4, vT));
  else if (vKind < 2.5 && vKind > 0.5) col = mix(vec3(0.30, 0.36, 0.14), mix(vec3(0.52, 0.52, 0.26), vec3(0.66, 0.62, 0.40), step(0.8, vT)), smoothstep(0.0, 0.5, vT));
  else if (vKind < 3.5 && vKind > 0.5) col = vT > 0.9 && r2 < 0.55 ? vec3(0.18, 0.30, 0.72) : mix(vec3(0.20, 0.30, 0.12), vec3(0.32, 0.42, 0.20), vT);
  else if (vKind < 4.5 && vKind > 0.5) col = mix(vec3(0.16, 0.22, 0.08), mix(vec3(0.30, 0.34, 0.14), vec3(0.34, 0.24, 0.14), step(0.88, vT)), vT);
  else if (vKind > 6.5) {        // (the forest floor: bilberry and young growth, deep green, a few leaves turning)
    col = mix(vec3(0.035, 0.07, 0.02), mix(vec3(0.10, 0.22, 0.05), vec3(0.17, 0.29, 0.07), r2), smoothstep(0.0, 0.55, vT));
    if (r1 > 0.86) col = mix(col, vec3(0.34, 0.16, 0.05), 0.7 * smoothstep(0.3, 1.0, vT));
  }
  else if (vKind > 5.5) col = vT > 0.82 ? mix(vec3(0.70, 0.60, 0.36), vec3(0.55, 0.45, 0.30), r2) : mix(col, col * vec3(1.08, 1.0, 0.8), vT);
  // (a flowering stem's head: soft, not bright, and only near by; past some 20 m a head is a pixel or less, and
  // they showed as shiny dots: there it keeps the grass's colour, the meadow's own flowers carrying the colour)
  else if (vKind > 4.5 && vT > 0.86) col = mix(col, r2 < 0.3 ? vec3(0.74, 0.74, 0.68) : r2 < 0.55 ? vec3(0.20, 0.30, 0.68) : r2 < 0.75 ? vec3(0.62, 0.32, 0.46) : vec3(0.40, 0.33, 0.62),
    1.0 - smoothstep(10.0, 22.0, vDist));
  col *= 0.78 + 0.44 * r1;
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.7, vT));
  vec3 c = lightUp(col, n, ao, 0.7, vSun);
  c += uSunColor * col * vCrest * (0.1 + 0.18 * vSun) * vT * vT * (vKind > 4.5 && vKind < 5.5 ? 0.3 : vKind > 6.5 ? 0.25 : 1.0);   // the crest of a wave catches the light
  gl_FragColor = vec4(hazed(c, vDist), 1.0);
}`;

/** One blade: a strip of `segs` rows, x across (-0.5..0.5), y along (0..1), to a point at the tip. */
function bladeGeometry(segs) {
  const pos = [], idx = [];
  for (let k = 0; k < segs; k++) pos.push(-0.5, k / segs, 0, 0.5, k / segs, 0);
  pos.push(0, 1, 0);
  for (let k = 0; k < segs - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const a = 2 * (segs - 1); idx.push(a, a + 1, 2 * segs);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** The ground's height (heightAt), seen from above, span m square round the hilltop, n texels across (half floats). */
export function hillTexture(ground, span = 96, n = 512) {
  const data = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * span - span / 2, z = (j + 0.5) / n * span - span / 2;
    data[j * n + i] = THREE.DataUtils.toHalfFloat(ground.heightAt(x, z));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The grass on `ground` (countryside.js: heightAt, and the meadow's reach: { browR terms }), lit and blown by the shared
 * uniforms U. Returns a group whose userData.update(camera position, view) moves it with the camera; view: the
 * directions it sees ({ az0, az1 } radians right of ahead, or null: all the way round).
 */
export function buildGrass(ground, U, { tier = 'high', hill, world, opt } = {}) {
  // (opt: a machine's own meadow - hardware.js TIERS grass: { per, reach, rows, wide, floor }: fewer blades to the
  // square metre, not as far, each of fewer rows and much wider - tufts, as those machines drew grass - and never
  // thinner than `floor` of the most: thin blades thinned by thick() were a few dark stems on bare ground from 30 m,
  // looked at 12 Nov 2026. The full look's is the one above, untouched.)
  const D0 = opt?.per ?? TIERS[tier] ?? TIERS.high, group = new THREE.Group();
  group.name = 'grass';
  const lastRing = opt?.reach ? Math.max(0, RINGS.findLastIndex((_, k) => EDGES[2 * k + 2] <= opt.reach + 1e-6)) : RINGS.length - 1;
  const own = {
    uHill: { value: hill ?? hillTexture(ground) }, uHillSpan: { value: 96 }, uPath: { value: pathTexture() }, uPathSpan: { value: PATH_SPAN },
    uMeadow: { value: new THREE.Vector4(...ground.meadow) },
    uWayT: { value: null }, uWayC: { value: new THREE.Vector2(1e9, 1e9) }, uWaySpan: { value: 512 }, uWayT2: { value: null }, uWayC2: { value: new THREE.Vector2(1e9, 1e9) }, uWaySpan2: { value: 2048 },
    ...(world ? world.uniforms : {}), uWorldOn: { value: world ? 1 : 0 },
    uRoot: { value: lin('#556a22') }, uMid: { value: lin('#94b23c') }, uTip: { value: lin('#dcd874') }, uDry: { value: lin('#e8d58c') },
    uWide: { value: opt?.wide ?? 1 }, uFloor: { value: opt?.floor ?? 0 },
  };
  const thickHere = (r) => Math.max(opt?.floor ?? 0, thick(r));
  const rings = RINGS.slice(0, lastRing + 1).map(([sides, segs], k) => {
    const fade = [k ? EDGES[2 * k - 1] : 0, k ? EDGES[2 * k] : 0, EDGES[2 * k + 1], EDGES[2 * k + 2]];
    // (a shorter meadow's last ring thins out over its outer two fifths, so its end is not a line across the fields)
    if (opt?.reach && k === lastRing) fade[2] = Math.max(fade[1], Math.min(fade[2], fade[3] * 0.6));
    const most = thickHere(fade[0]), cell = 1 / Math.sqrt(D0 * most);
    // every cell that could fall in the ring, wherever in its own cell the camera stands; sorted into its sides
    const r0 = Math.max(0, fade[0] - 1.5 * cell), r1 = fade[3] + 1.5 * cell, n = Math.ceil(r1 / cell);
    const lists = Array.from({ length: sides }, () => []), core = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i, j) * cell;
      if (d < r0 || d > r1) continue;
      if (k === 0 && d < CORE) { core.push(i, j); continue; }
      const a = Math.atan2(i, -j), s = sides === 1 ? 0 : Math.min(sides - 1, Math.floor((a + Math.PI) / (2 * Math.PI) * sides));
      lists[s].push(i, j);
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, ...own, uOrg: { value: new THREE.Vector2() }, uCell: { value: cell }, uFade: { value: new THREE.Vector4(...fade) },
        uMost: { value: most }, uRing: { value: k } },
      vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide,
    });
    const blade = bladeGeometry(opt?.rows ?? (tier === 'high' ? segs : Math.max(3, segs - 1)));
    const parts = lists.map((l, s) => [l, s]);
    if (core.length) parts.push([core, 'core']);
    const meshes = parts.map(([l, s]) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = blade.index;
      g.setAttribute('position', blade.attributes.position);
      g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Int16Array(l), 2));
      g.instanceCount = l.length / 2;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false; m.name = `grass-${k}-${s}`;
      // (the directions this side spans, round from where the camera's cell is: a little more either way, for what
      // leans into it and for the camera's place in its own cell)
      m.userData.span = sides === 1 || s === 'core' ? null : [-Math.PI + (2 * Math.PI * s) / sides, -Math.PI + (2 * Math.PI * (s + 1)) / sides];
      m.userData.slack = Math.min(0.25, 0.45 / Math.max(1, k === 0 ? CORE : fade[0]));
      group.add(m);
      return m;
    });
    return { cell, mat, meshes, sides, fade, any: new Uint8Array(sides), coreAny: 1, count: parts.reduce((t, [l]) => t + l.length / 2, 0) };
  });
  // No blades drawn where the land has none to grow: a ring's side whose ground is all paving or water is left out. In
  // the middle of a city every blade was still sent to the card and thrown away there, one by one: 25 million triangles
  // a frame for nothing (measured 10 Nov 2026). The land in cells of GC m: a cell grows grass if any of its 8 m texels
  // is neither town nor under water, or a cell beside it does (the paving's edge is ragged by a few metres: terrain.js
  // townW).
  const GC = 32;
  let grows = null;
  if (world?.townAt && world.json?.core) {
    const C = world.json.core, n = Math.ceil(C.span / GC), own = new Uint8Array(n * n), wide = new Uint8Array(n * n);
    const cellOwn = (ci, cj) => {
      if (ci < 0 || cj < 0 || ci >= n || cj >= n) return true;
      let v = own[cj * n + ci];
      if (!v) {
        v = 1;
        const x0 = C.x0 + ci * GC, z0 = C.z0 + cj * GC;
        scan: for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
          const x = x0 + (a + 0.5) * GC / 4, z = z0 + (b + 0.5) * GC / 4;
          if (world.townAt(x, z) >= 0.5) continue;
          const w = world.waterAt(x, z);
          if (w !== null && w - world.landAt(x, z) > 0.05) continue;
          v = 2; break scan;
        }
        own[cj * n + ci] = v;
      }
      return v === 2;
    };
    grows = (x, z) => {
      const ci = Math.floor((x - C.x0) / GC), cj = Math.floor((z - C.z0) / GC);
      if (ci < 0 || cj < 0 || ci >= n || cj >= n) return true;
      let v = wide[cj * n + ci];
      if (!v) {
        v = 1;
        for (let a = -1; a <= 1 && v === 1; a++) for (let b = -1; b <= 1; b++) if (cellOwn(ci + a, cj + b)) { v = 2; break; }
        wide[cj * n + ci] = v;
      }
      return v === 2;
    };
  }
  let grownAt = null;
  const mark = (p) => {
    for (const R of rings) { R.any.fill(0); R.coreAny = 0; }
    const reach = EDGES[2 * lastRing + 2] + GC, hd = GC * 0.71 + 4, TWO = 2 * Math.PI;
    const i0 = Math.floor((p.x - reach) / GC), i1 = Math.floor((p.x + reach) / GC), j0 = Math.floor((p.z - reach) / GC), j1 = Math.floor((p.z + reach) / GC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * GC, cz = (j + 0.5) * GC;
      if (!grows(cx, cz)) continue;
      const ex = cx - p.x, ez = cz - p.z, d = Math.hypot(ex, ez);
      if (d > reach) continue;
      const ang = Math.atan2(ex, -ez), da = d > hd ? Math.asin(Math.min(1, hd / d)) + 0.02 : Math.PI;
      for (const R of rings) {
        if (d + hd < R.fade[0] || d - hd > R.fade[3] + 2 * R.cell) continue;
        if (d - hd < CORE + 1) R.coreAny = 1;
        if (da >= Math.PI) { R.any.fill(1); continue; }
        const n = R.sides, s0 = Math.floor((ang - da + Math.PI) / TWO * n), s1 = Math.floor((ang + da + Math.PI) / TWO * n);
        for (let q = s0; q <= s1; q++) R.any[((q % n) + n) % n] = 1;
      }
    }
  };
  group.userData.blades = rings.reduce((t, R) => t + R.count, 0);
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  /** Follow the camera (world position p) and draw only the sides in view (view: { az0, az1 }, or null: all). */
  group.userData.update = (p, view) => {
    if (grows && (!grownAt || Math.hypot(p.x - grownAt.x, p.z - grownAt.z) > 3)) { mark(p); grownAt = { x: p.x, z: p.z }; }
    for (const R of rings) {
      R.mat.uniforms.uOrg.value.set(Math.floor(p.x / R.cell + 0.5), Math.floor(p.z / R.cell + 0.5));
      R.meshes.forEach((m, q) => {
        const S = m.userData.span;
        // (a side over ground with no grass at all: not drawn)
        const some = !grows || (q < R.sides && S ? R.any[q] : R.sides === 1 || !S ? (q < R.sides ? R.any[q] || R.coreAny : R.coreAny) : 1);
        if (!some) { m.visible = false; return; }
        if (!S || !view) { m.visible = true; return; }
        const mid = (S[0] + S[1]) / 2, half = (S[1] - S[0]) / 2 + m.userData.slack;
        const vm = (view.az0 + view.az1) / 2, vh = (view.az1 - view.az0) / 2;
        m.visible = Math.abs(wrap(mid - vm)) < half + vh;
      });
    }
  };
  return group;
}
