// The wind and the light every growing thing in the countryside shares (meadow.js, models.js): GLSL, prepended to
// their shaders, and the uniforms that drive it (one object, shared, set each frame by countryside.js). The light is
// a changeable summer afternoon's: a sun that comes and goes as the cloud deck drifts over (weather.js: sunThrough),
// and the soft, cool light of an overcast sky.
import * as THREE from 'three';
import { WEATHER_GLSL } from './weather.js';
import { SHADOW_GLSL, shadowUniforms } from './sunshadow.js';

export function landscapeUniforms() {
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  return {
    uTime: { value: 0 }, uGust: { value: 0 }, uFront: { value: -1e4 }, uWindOrigin: { value: new THREE.Vector2() }, uWindLevel: { value: 1 },
    // (the walk's opening: what grows rises out of the ground in a wave from the walker - its middle x, z, when it set
    // out on the scene's clock (s), how fast it goes (m/s); 0: none, all of it in its place. arrive.js, countryside.js)
    uRise: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHalfTan: { value: 0.72 },                               // tan of half the full frame's width (the gust's 0..1 across it)
    uViewYaw: { value: 0 },                                  // how far the view is turned (radians: the gust sweeps across the view)
    uWindDir: { value: new THREE.Vector2(1, 0.12).normalize() },
    // (a low golden sun ahead and to the left, through the trees in shafts, the shade cool and deep)
    uSunDir: { value: new THREE.Vector3(-0.6, 0.15, -0.62).normalize() },   // toward the sun: low (about 8 degrees), ahead and to the left
    uSunColor: { value: lin('#ffd9ab').multiplyScalar(1.75) },
    uSkyColor: { value: lin('#a9bccf').multiplyScalar(0.66) },               // the sky's light: cooler and dimmer at evening
    uGroundColor: { value: lin('#7d8a3e').multiplyScalar(0.2) },
    uHaze: { value: lin('#c9cdcc') }, uHazeDist: { value: 48000 },
    // the weather's map (weather.js) is added by the scene once it is made
    uWeather: { value: null }, uWeatherOff: { value: new THREE.Vector2() }, uTile: { value: 48000 },
    uDeckBase: { value: 720 }, uDeckDepth: { value: 1050 }, uStorm: { value: new THREE.Vector4(0, 0, 1, 0) },
    // the birches' shadows on the hilltop (sunshadow.js)
    ...shadowUniforms(),
  };
}

// (windAt below, for what is moved on the CPU: the same hash and noise as the shaders')
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
/**
 * The wind at p (world, m) as the shaders' windAt has it at the uniforms' time, for what is moved on the CPU (nothing
 * is since v0.11.0; kept for anything hung to swing): how far it pushes across the ground per metre of height, x and z, and the gust's part
 * in it.
 */
export function windAtCPU(p, U, seed = 0.5) {
  const t = U.uTime.value, W = U.uWindDir.value, O = U.uWindOrigin.value;
  const qx = p.x - O.x, qz = p.z - O.y, along = qx * W.x + qz * W.y, side = -qx * W.y + qz * W.x;
  const gg = (along - U.uFront.value + 18 * (vnoise(side * 0.012, U.uFront.value * 0.004) - 0.5)) / 32;
  const g = U.uGust.value * Math.exp(-gg * gg) * (0.65 + 0.35 * vnoise(side * 0.03, t * 0.4));
  const al = p.x * W.x + p.z * W.y;
  let wave = 0.5 + 0.5 * Math.sin(al * 0.9 - t * 1.4 + 3 * vnoise(p.x * 0.11, p.z * 0.11));
  wave *= 0.45 + 0.55 * vnoise(p.x * 0.35 - W.x * t * 0.5, p.z * 0.35 - W.y * t * 0.5);
  const fl = Math.sin(t * (2.1 + 1.9 * seed + 3 * g) + seed * 37) + 0.5 * Math.sin(t * (4.7 + 2.3 * seed + 5 * g) + seed * 11);
  const L = U.uWindLevel?.value ?? 1, amt = (0.025 + 0.07 * wave) * L + 0.62 * g + fl * (0.008 * L + 0.05 * g), k = fl * (0.012 * L + 0.11 * g);
  return { x: W.x * amt - W.y * k, z: W.y * amt + W.x * k, gust: g };
}

export const WIND_GLSL = /* glsl */`
uniform float uTime; uniform float uGust; uniform float uFront; uniform float uHalfTan; uniform float uViewYaw; uniform vec2 uWindDir;
uniform vec2 uWindOrigin; uniform float uWindLevel;   // (0.07 in a calm spell .. 1)
uniform vec4 uRise;
// (how far a thing rooted at root has risen in the opening wave, 0 under the ground .. 1 in its place; seed: 0..1 its own)
// (uRise.w below 0: the leaving - walk.js, a change of look - each thing back into the ground in the same wave, at that
// speed: 1 in its place .. 0 under the ground)
float riseAt(vec2 root, float seed) {
  if (uRise.w == 0.0) return 1.0;
  float w = abs(uRise.w);
  float r = clamp(((uTime - uRise.z) * w - length(root - uRise.xy) + seed * 30.0) / (w * (uRise.w > 0.0 ? 1.25 : 0.6)), 0.0, 1.0);
  return uRise.w > 0.0 ? 1.0 - pow(1.0 - r, 3.2) : 1.0 - r * r * r;
}
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform vec3 uHaze; uniform float uHazeDist;
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
${WEATHER_GLSL}
${SHADOW_GLSL}
// where across the full frame a point is seen (0 at its left edge .. 1 at its right), as the view is turned: the gust
// sweeps across what is in view, wherever that is (behind the view, nowhere near it)
float acrossView(vec3 p) {
  float rel = atan(p.x, -p.z) - uViewYaw;
  rel -= 6.2831853 * floor((rel + 3.14159265) / 6.2831853);
  return 0.5 + 0.5 * tan(clamp(rel, -1.35, 1.35)) / uHalfTan;
}
// The gust: a front some 60 m deep travelling downwind through the land past the walker (uFront: metres along the wind
// from uWindOrigin, the walker), uneven along its length, so the grass and the trees bend as it reaches them and settle
// after it has gone by.
float gustAt(vec3 p) {
  vec2 q = p.xz - uWindOrigin;
  float along = dot(q, uWindDir), side = dot(q, vec2(-uWindDir.y, uWindDir.x));
  float g = (along - uFront + 18.0 * (vnoise(vec2(side * 0.012, uFront * 0.004)) - 0.5)) / 32.0;
  return uGust * exp(-g * g) * (0.65 + 0.35 * vnoise(vec2(side * 0.03, uTime * 0.4)));
}
// The wind at p: xy, how far it pushes a stem's top across the ground (per metre of height); z, how much this is the
// crest of a wave (where the bent grass catches the light). Between gusts only a light air, slow waves rolling
// downwind; in a gust a strong push, and the stems thrashing (the flutter grows with it).
vec3 windAt(vec3 p, float seed) {
  float g = gustAt(p);
  float along = dot(p.xz, uWindDir);
  float wave = 0.5 + 0.5 * sin(along * 0.9 - uTime * 1.4 + 3.0 * vnoise(p.xz * 0.11));
  wave *= 0.45 + 0.55 * vnoise(p.xz * 0.35 - uWindDir * uTime * 0.5);
  float fl = sin(uTime * (2.1 + 1.9 * seed + 3.0 * g) + seed * 37.0) + 0.5 * sin(uTime * (4.7 + 2.3 * seed + 5.0 * g) + seed * 11.0);
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float L = uWindLevel, amt = (0.025 + 0.07 * wave) * L + 0.62 * g;
  return vec3(uWindDir * amt + perp * fl * (0.012 * L + 0.11 * g) + uWindDir * fl * (0.008 * L + 0.05 * g), wave * 0.45 * L + g);
}
// Light: the sun (wrapped a little, as on soft leaves) as much of it as the clouds let through (sun: sunThrough()),
// the sky from above, the meadow from below, and the sun through anything thin (petals, leaves, blades) behind them.
vec3 lightUp(vec3 albedo, vec3 n, float ao, float thin, float sun) {
  float ndl = dot(n, uSunDir);
  float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
  vec3 c = albedo * (uSunColor * wrap * sun + uSkyColor * (0.6 + 0.4 * n.y) + uGroundColor * (0.5 - 0.5 * n.y) * (0.6 + 0.4 * sun));
  c += albedo * uSunColor * thin * clamp(-ndl, 0.0, 1.0) * 0.55 * sun;
  return c * ao;
}
vec3 hazed(vec3 c, float dist) { return mix(c, uHaze, 1.0 - exp(-dist / uHazeDist)); }
`;
