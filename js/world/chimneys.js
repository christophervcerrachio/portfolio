// Smoke over the cities' chimneys. Every house has its chimneys (dev\world\city_blender.py builds them into the houses'
// own tiles and writes where each one's top is: assets/world/cities/<city>-chimneys/<tile>.json, a 400 m tile a file);
// over two in five of them a thread of smoke rises - a stove alight, a kitchen at work - leans with the wind, widens
// and thins out over the roofs.
// A thread is a few soft puffs, each a small card turned to the eye: born at the chimney's mouth, risen and drifted by
// its age, grown and faded with it, lit by the low sun on the side it comes from and cool in the sky's light on the
// other. Drawn only near the walker (hardware.js smokeNear), a tile at a time, read as the walker comes near and let
// go behind him; an older machine's picture of 240 lines has none.
import * as THREE from 'three';
import { styleNow } from '../retro.js';

const DIR = 'assets/world/cities/';
const PUFFS = 6;                // (a thread's puffs)
const LIFE = 11;                // (s: a puff's life, from the mouth to nothing)
const SHARE = 0.4;              // (of the chimneys: the ones alight)

const VERT = /* glsl */`
uniform float uTime; uniform vec2 uWindDir; uniform float uWindLevel; uniform float uNear;
attribute vec3 aTop; attribute vec2 aSeed;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vFar;
void main() {
  vUv = uv;
  float age = fract(uTime / ${LIFE.toFixed(1)} + aSeed.x + aSeed.y);      // (0 at the mouth, 1 gone)
  vAge = age; vSeed = aSeed.x * 17.0 + aSeed.y * 5.0;
  // (up fast out of the flue, then slower; downwind the more the higher it is; a slow sway of its own)
  float rise = 1.2 + 7.5 * (1.0 - exp(-age * 2.2)) + 2.0 * age;
  vec2 wind = uWindDir * (0.6 + 2.6 * uWindLevel);
  vec3 p = aTop + vec3(0.0, rise, 0.0);
  p.xz += wind * (age * age * 5.5 + age * 1.2);
  p.x += sin(uTime * 0.35 + vSeed) * 0.35 * age; p.z += cos(uTime * 0.28 + vSeed * 1.7) * 0.35 * age;
  float size = 0.35 + 2.4 * age;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vFar = 1.0 - smoothstep(uNear * 0.7, uNear, distance(cameraPosition, p));
}`;
const FRAG = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform float uTime;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vFar;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  // (a soft ball, its edge eaten by a slow curl of its own)
  float curl = sNoise(q * 2.3 + vec2(vSeed, uTime * 0.12 + vSeed)) * 0.6 + sNoise(q * 5.1 - vec2(uTime * 0.2, vSeed)) * 0.4;
  float body = smoothstep(1.0, 0.25, r + (curl - 0.5) * 0.7);
  float a = body * smoothstep(0.0, 0.07, vAge) * pow(1.0 - vAge, 1.6) * 0.5 * vFar;
  if (a < 0.004) discard;
  // (lit on the side the sun is on - the card's own right or left, by where the sun stands across the view - and by
  // the sky all round; wood smoke: a warm grey, bluer as it thins)
  vec3 sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float lit = 0.5 + 0.5 * clamp(dot(normalize(vec3(q, 0.6)), sv), -1.0, 1.0);
  vec3 smoke = mix(vec3(0.50, 0.49, 0.48), vec3(0.62, 0.65, 0.70), vAge);
  vec3 col = smoke * (uSkyColor * 0.95 + uSunColor * 0.42 * lit);
  gl_FragColor = vec4(col, a);
}`;

/** The smoke. U: the scene's uniforms (uTime, uWindDir, uWindLevel, uSunDir, uSunColor, uSkyColor). near: drawn within. */
export function buildChimneySmoke(U, { base = '', cities = ['spb', 'moscow'], near = 320 } = {}) {
  const group = new THREE.Group(); group.name = 'chimney-smoke';
  group.userData.update = () => {};
  if (!(near > 0) || (styleNow() && styleNow().lines <= 240)) return group;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uWindDir: U.uWindDir, uWindLevel: U.uWindLevel, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uNear: { value: near } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const quad = new THREE.PlaneGeometry(2, 2);
  const tiles = new Map();
  Promise.all(cities.map((c) => fetch(base + DIR + c + '-chimneys/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null))).then((idx) => {
    idx.forEach((I, ci) => {
      if (!I) return;
      for (const t of I.tiles) {
        const [i, j] = t.split('_').map(Number);
        tiles.set(cities[ci] + ':' + t, { city: cities[ci], key: t, size: I.tile, c: [(i + 0.5) * I.tile, (j + 0.5) * I.tile], state: 0, m: null });
      }
    });
  });
  const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
  function build(T, list) {
    const lit = list.filter(([x, , z]) => hash(x, z) < SHARE);
    if (!lit.length) return null;
    const n = lit.length * PUFFS, top = new Float32Array(n * 3), seed = new Float32Array(n * 2);
    let k = 0, lo = Infinity, hi = -Infinity;
    for (const [x, y, z] of lit) {
      const s0 = hash(z, x);
      for (let p = 0; p < PUFFS; p++, k++) { top[k * 3] = x; top[k * 3 + 1] = y; top[k * 3 + 2] = z; seed[k * 2] = s0; seed[k * 2 + 1] = p / PUFFS; }
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
    geo.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 3)); geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(T.c[0], (lo + hi) / 2 + 8, T.c[1]), T.size * 0.75 + 30);
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 6; m.castShadow = false; m.userData.noCast = true; m.name = 'smoke ' + T.key;
    return m;
  }
  group.userData.update = (pos) => {
    for (const T of tiles.values()) {
      const d = Math.max(Math.abs(T.c[0] - pos.x), Math.abs(T.c[1] - pos.z)) - T.size / 2;
      if (d < near && T.state === 0) {
        T.state = 1;
        fetch(base + DIR + T.city + '-chimneys/' + T.key + '.json').then((r) => r.json()).then((list) => { T.m = build(T, list); T.state = 2; if (T.m) group.add(T.m); }).catch(() => { T.state = 3; });
      } else if (d > near + 300 && T.state === 2) {
        if (T.m) { group.remove(T.m); T.m.geometry.dispose(); T.m = null; }
        T.state = 0;
      }
    }
  };
  return group;
}
