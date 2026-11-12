// The weather over the countryside: a low deck of cloud in two or three great sheets, drifting downwind, with gaps the
// sun comes through - now read as shafts of light in the air and bright patches crossing the land, both off this one map
// - and their shadows sweeping with them. (uStorm can hold a storm that never leaves one place: none is set.) The map
// still paints its fourth channel, the shape of a downpour, because a rain may want drawing again; nothing reads it now.
//
// It is all one map (made once, on the GPU): for each point of the land below, how much cloud is over it (r), how
// thick the cloud is (g), how high its base sits (b), how hard it rains from it (a). The map is tiled (TILE m across)
// and drifts with the wind. Everything reads it: the sky (clouds.js) draws the clouds and the rain from it, the land
// knows from it where the sun gets through (WEATHER_GLSL), and the CPU keeps a copy, so the scene knows whether the
// sun is out where the camera stands (the light on the hands follows it).
import * as THREE from 'three';

export const TILE = 48000;                  // m: the map repeats every 48 km
export const DECK = { base: 720, depth: 1050 };   // m above the hilltop: the cloud base, and the thickest cloud's depth
export const DRIFT = new THREE.Vector2(10.5, 1.6);   // m/s: the clouds' drift, the way the wind blows (left to right)

// shared by every shader that sits under the weather (prepended after WIND_GLSL, whose uSunDir it uses)
export const WEATHER_GLSL = /* glsl */`
uniform sampler2D uWeather; uniform vec2 uWeatherOff; uniform float uTile; uniform float uDeckBase; uniform float uDeckDepth;
uniform vec4 uStorm;        // a storm that never leaves one place: its middle (x, z, m), its reach (m), how strong
vec4 weatherAt(vec2 xz) {
  vec4 w = texture2D(uWeather, (xz + uWeatherOff) / uTile);
  if (uStorm.w > 0.0) {
    // (a heavy, low, dark deck over that place, raining in places, whatever the wind does elsewhere)
    float s = uStorm.w * (1.0 - smoothstep(0.5, 1.0, length(xz - uStorm.xy) / uStorm.z));
    w = vec4(max(w.r, s), max(w.g, s * 0.95), mix(w.b, 0.18, s), max(w.a, s * 0.3));
  }
  return w;
}
// how much of the sun reaches p: where its ray crosses the deck, the cloud there (and a little around: its shadow's
// edge is soft)
float sunThrough(vec3 p) {
  float h = uDeckBase + 0.4 * uDeckDepth - p.y;
  vec2 q = p.xz + uSunDir.xz / max(uSunDir.y, 0.2) * h;
  vec4 a = weatherAt(q), b = weatherAt(q + vec2(140.0, -90.0));
  float od = 0.5 * (a.r * (0.5 + 3.4 * a.g) + b.r * (0.5 + 3.4 * b.g));
  // 2.55, not the 1.9 this ran on (6 Nov): the shafts and the shadows are the weather's drama now, not a side effect of
  // it, and at 1.9 the difference between a gap and a sheet was 40% of the range. The floor stays 0.07 - valley.js and
  // countryside.js both normalise by it - so this deepens the shade without moving the ends the rest of the scene assumes.
  return mix(0.07, 1.0, exp(-od * 2.55));
}`;

// the map, painted once: periodic noise, so it tiles
const GEN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
float hashP(vec2 i, float P) { i = mod(i, P); return fract(sin(dot(i + uSeed, vec2(127.1, 311.7))) * 43758.5453); }
float noiseP(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashP(i, P), hashP(i + vec2(1, 0), P), f.x), mix(hashP(i + vec2(0, 1), P), hashP(i + vec2(1, 1), P), f.x), f.y);
}
// fbm on the tile: base frequency f (a whole number, so it tiles), oct octaves
float fbmP(vec2 uv, float f, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int k = 0; k < 6; k++) { if (k >= oct) break; s += a * noiseP(uv * f, f); n += a; a *= 0.5; f *= 2.0; }
  return s / n;
}
// cells (like the rolls and cells of a stratocumulus deck): 0 at a cell's middle .. 1 at its rim
float cellsP(vec2 uv, float f) {
  vec2 p = uv * f, i = floor(p), fr = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(float(x), float(y)), j = mod(i + c, f);
    vec2 o = vec2(fract(sin(dot(j + uSeed, vec2(41.3, 289.1))) * 43758.5), fract(sin(dot(j + uSeed, vec2(173.7, 61.9))) * 24634.6));
    float d = length(c + o - fr);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return clamp(1.0 - (d2 - d1) * 0.9, 0.0, 1.0);
}
void main() {
  vec2 uv = vUv;
  // the great sheets: low-frequency noise, warped so they are long and ragged rather than round; most of the sky is
  // under them (a changeable, mostly overcast day), with long gaps between
  vec2 warp = vec2(fbmP(uv + 0.37, 4.0, 3), fbmP(uv + 0.71, 4.0, 3)) - 0.5;
  float big = fbmP(uv + warp * 0.2, 3.0, 5);
  // (a relatively sunny day under a light, broken cover: fair-weather clouds in drifts with wide blue between them, no
  // rain)
  float cover = smoothstep(0.47, 0.57, big);
  // within them: soft cells a kilometre or so across (the rolls and cells of a stratocumulus deck), and patchiness
  float cells = cellsP(uv + warp * 0.02, 40.0);
  float mid = fbmP(uv, 24.0, 3), fine = fbmP(uv, 96.0, 2);
  float core = smoothstep(0.42, 0.58, big);
  float c = cover * clamp(0.8 + 0.3 * (mid - 0.5) - 0.13 * cells * (1.0 - 0.6 * core) - 0.1 * (fine - 0.5), 0.0, 1.0);
  c = smoothstep(0.15, 0.6, c) * cover;
  float thick = cover * (0.2 + 0.5 * core) * (0.7 + 0.3 * (1.0 - cells)) * (0.85 + 0.3 * (mid - 0.5));
  float base = fbmP(uv + 0.2, 12.0, 3);
  // rain: from the thick middles, in streaks along the wind
  float streak = fbmP(vec2(uv.x * 0.25, uv.y) + 0.43, 32.0, 3);
  float rain = 0.0 * streak;
  gl_FragColor = vec4(c, clamp(thick, 0.0, 1.0), base, rain);
}`;

/** The weather: its map (texture), the uniforms every shader under it shares, and its read-out on the CPU. */
export function makeWeather(renderer, { size = 1024, seed = 17.3 } = {}) {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
  rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: seed } }, fragmentShader: GEN_FRAG,
    vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    depthTest: false, depthWrite: false,
  }));
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  quad.geometry.dispose(); quad.material.dispose();

  const uniforms = {
    uWeather: { value: rt.texture }, uWeatherOff: { value: new THREE.Vector2() }, uTile: { value: TILE },
    uDeckBase: { value: DECK.base }, uDeckDepth: { value: DECK.depth }, uStorm: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
  // the map on the CPU, bilinear, wrapped: [cover, thick, base, rain] at world (x, z)
  const at = (x, z) => {
    const off = uniforms.uWeatherOff.value;
    const fx = (((x + off.x) / TILE) % 1 + 1) % 1 * size - 0.5, fy = (((z + off.y) / TILE) % 1 + 1) % 1 * size - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, out = [0, 0, 0, 0];
    for (const [dx, dy, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const i = ((((iy + dy) % size) + size) % size * size + (((ix + dx) % size) + size) % size) * 4;
      for (let k = 0; k < 4; k++) out[k] += (px[i + k] / 255) * wgt;
    }
    return out;
  };
  // the same as sunThrough() in WEATHER_GLSL
  const sunAt = (p, sunDir) => {
    const h = DECK.base + 0.4 * DECK.depth - p.y, k = h / Math.max(sunDir.y, 0.2);
    const qx = p.x + sunDir.x * k, qz = p.z + sunDir.z * k, a = at(qx, qz), b = at(qx + 140, qz - 90);
    const od = 0.5 * (a[0] * (0.5 + 3.4 * a[1]) + b[0] * (0.5 + 3.4 * b[1]));
    return 0.07 + 0.93 * Math.exp(-od * 2.55);
  };
  // where in the tile the world begins, which is to say the phase of the day. It matters more than it looks: the deck
  // drifts only 10.5 m/s, so the piece of map in front of the view barely moves during a visit, and what is out there
  // decides whether there are shafts to see at all. Measured on the running scene's own map (dev/scratch pages, marching
  // shaftAir's own loop across the azimuths the valley paints), at 1/25000: this phase gives the arc 0.112 mean and
  // 0.171 peak with every azimuth lit; the previous (46342.5, 38476.0) gave 0.035 with 56% lit; the original
  // (29680.6, 1697.9) gave 0.022 with 36%. All three keep the deck over the camera (0.159, 0.113 and 0.072 of the sun
  // where the camera stands), so the day is the same day - only the distance changes. Still a brightening rather than a
  // beam: see clouds.js on uShaft for why.
  return { texture: rt.texture, uniforms, at, sunAt, start: new THREE.Vector2(33842.5, 35976.0), update(t) { uniforms.uWeatherOff.value.copy(DRIFT).multiplyScalar(t).add(this.start); } };
}
