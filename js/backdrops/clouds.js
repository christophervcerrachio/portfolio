// The sky over the countryside, in 3D: a low deck of cloud in two or three great sheets (weather.js), drifting
// downwind, lit by a sun that stands high behind the viewer, so their faces are bright where it catches them and their
// flat bases grey-blue; under the deck the sun comes through the gaps in shafts, scattered by the moist air lying over
// the valley. Between the sheets, a pale blue going to a moist haze at the horizon.
//
// The rain is out of the picture. Two systems drew it and both drew *lines*: rain.js laid three planes of streaks
// squared to the camera, which papered the sky with short dashes whatever the sky over the valley was actually doing,
// and this file's rainAt() cut "shafts and streaks" out of vnoise at a couple of hundred metres and marched them nine
// samples deep - fine structure sampled coarse, which is a hatch, and it read as one. What replaces it draws nothing
// finer than the weather map and draws it from the same call the land's cloud shadows use, so the beam, the bright patch
// it lays in the valley and the gap overhead are one fact instead of three guesses. The streaks are kept in
// dev\retired\rain.js; the site no longer imports them.
//
// The clouds are raymarched into a panorama: the camera only ever turns and zooms, never moves, so the sky depends on
// the direction alone. A band of the panorama is drawn each frame, round and round, the bands in view more often; the
// sky on screen is read from it by direction (each band carried on by the drift since it was drawn, so no seam shows),
// so looking around is free. The panorama goes all the way round, a little coarser than the screen; a finer one of the
// part in view (the inset) is drawn over it the same way, and drawn again wherever the view turns or zooms to.
// SKY_GLSL is shared with everything that sees the sky or stands in its air (valley.js: the land's haze, its rain, its
// water's reflections).
import * as THREE from 'three';
import { WIND_GLSL } from './wind-glsl.js';
import { DRIFT, DECK } from './weather.js';

export const SKY_GLSL = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHazeSun; uniform vec3 uHazeShade; uniform float uFarHaze;
uniform vec3 uCloudLit; uniform vec3 uAmbHigh; uniform vec3 uAmbLow; uniform vec3 uShaftTint; uniform float uShaft;
// the clear sky between the clouds: a soft blue going to a pale, moist haze at the horizon
vec3 clearSky(vec3 d) {
  float el = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-el * 4.2));
  // (the low sun's glow: a broad warm halo low round it, a tight bright core: my evening picture, 8 Nov 2026)
  float cs = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (0.05 * pow(cs, 6.0) + 0.04 * pow(cs, 3.0) * (1.0 - min(el * 3.0, 1.0)) + 0.5 * pow(cs, 90.0) + 3.0 * pow(cs, 2000.0));
  return c;
}
// the air's own light along a ray: brighter and warmer where the sun gets through the deck, grey-blue under it
vec3 hazeLight(float sun) { return mix(uHazeShade, uHazeSun, sun); }
// The sun's shafts: what the deck's gaps let through, scattered by the moist air lying under the deck. Their shape is
// the deck's own - sunThrough() is the very call that paints the land's cloud shadows - so a beam of light and the
// bright patch it lays in the valley are one thing seen twice, and the edge between them is somewhere a cloud is.
// Nothing here is finer than the weather map and nothing is noise: this replaced a rain that drew streaks at a few
// hundred metres, marched nine deep, and arrived on screen as a hatch across the sky.
float shPhase(float c) {                                // (hg() is Henyey-Greenstein, defined later, in CLOUD_GLSL)
  const float g = 0.62, g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}
vec4 shaftAir(vec3 o, vec3 d, float far, float jitter, int steps) {   // (the light it adds, how much it hides)
  vec3 col = vec3(0.0); float T = 1.0;
  float a = 250.0, b = max(a + 1.0, min(far, 40000.0));
  // (forward-scattered: the shafts converge on where the sun stands behind the deck, and are faint looking away from it.
  // 11.2 is shPhase(1.0), the value looking straight along a beam, so ph stays near 1 and uShaft stays a real strength)
  float ph = 0.18 + 0.82 * (shPhase(max(dot(d, uSunDir), 0.0)) / 11.2);
  for (int i = 0; i < 12; i++) {
    if (i >= steps) break;
    float f0 = (float(i) + jitter) / float(steps), f1 = (float(i) + 1.0) / float(steps);
    float t = a * pow(b / a, f0), dt = a * pow(b / a, f1) - a * pow(b / a, float(i) / float(steps));
    vec3 p = o + d * t;
    float s = sunThrough(p);                                      // 0.07 under a sheet .. 1 in an open gap
    // (a gap is a gap: the shafts' whole shape is this threshold, and nothing in it is finer than the weather map. The
    // columns are the deck's gaps one to one, and the bright patch each lays on the land is the same gap again)
    float beam = smoothstep(0.52, 0.97, s);
    float moist = mix(1.0, 0.2, smoothstep(0.0, uDeckBase * 0.8, p.y));   // (the scattering air lies low, over the valley)
    // Scattering and dimming are ONE coefficient, and it is paid for only where a beam is. Both halves have to move
    // together: an earlier version scattered a little even in shaded air and glowed a fixed amount regardless, and the
    // glow was dimmer than the sky it was hiding - so turning the shafts UP made the picture DARKER (measured on the
    // land's march, where nothing is cached: 99.74 -> 99.23 near the horizon, 59.45 -> 59.33 over the city, going from
    // no shafts to 1/20000). Lit air may now only ever add light, and air a sheet covers neither glows nor dims.
    float sig = uShaft * moist * beam;
    float tr = exp(-sig * dt);
    vec3 lit = uShaftTint * ph * (0.35 + 0.65 * s);               // (the beam's own light, forward-scattered)
    lit = mix(lit, hazeLight(0.5), 1.0 - exp(-t / uFarHaze));     // (far air is lost in the air, like everything else)
    col += T * (1.0 - tr) * lit;
    T *= tr;
  }
  return vec4(col, 1.0 - T);
}`;

const CLOUD_GLSL = /* glsl */`
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// the deck's shape at p: how dense (0..1), and how high up in the cloud (0 its base .. 1 its top)
float deckShape(vec3 p, vec4 w, out float hf) {
  float base = uDeckBase + (w.b - 0.5) * 380.0;
  float top = base + 90.0 + w.g * uDeckDepth;
  hf = (p.y - base) / (top - base);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  // a flat base, softly rounded; a top that domes up over the thick middles
  return w.r * smoothstep(0.0, 0.18, hf) * (1.0 - smoothstep(0.35 + 0.25 * w.g, 1.0, hf));   // (base softened: 0.1 banded at grazing views)
}
float macroDensity(vec3 p) { float hf; vec4 w = weatherAt(p.xz); return w.r < 0.02 ? 0.0 : deckShape(p, w, hf); }
float cloudDensity(vec3 p, out float hf) {
  hf = 0.0;
  vec4 w = weatherAt(p.xz);
  if (w.r < 0.02) return 0.0;
  float d = deckShape(p, w, hf);
  if (d <= 0.0) return 0.0;
  // billows a few hundred metres across eat into the edges and the top, wisps finer still (moving with the deck)
  vec3 q = vec3(p.x + uWeatherOff.x, p.y * 1.6, p.z + uWeatherOff.y);
  float n = noise3(q * 0.0034) * 0.6 + noise3(q * 0.0105 + 7.3) * 0.28 + noise3(q * 0.031 - 3.1) * 0.12;
  return clamp((d - (n - 0.3) * 1.1 * (1.0 - 0.4 * d)) * 1.7, 0.0, 1.0);
}
const float SIGMA = 0.02;       // per metre, in the densest cloud
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
// the sky in direction d, seen from o: the sun's shafts under the deck, the deck, the clear sky beyond
vec3 skyWithClouds(vec3 o, vec3 d, float jitter) {
  vec3 sky = clearSky(d);
  // under the deck: the shafts (looking level, or down where the painted sky dips below the horizon, out as far as it
  // goes: they reach down to the far hills, and on over them, valley.js)
  float tBase = d.y > 0.004 ? (uDeckBase - 130.0 - o.y) / d.y : 40000.0;
  vec4 air = shaftAir(o, d, tBase, jitter, SHAFT_STEPS);
  if (d.y < 0.004) return air.rgb + (1.0 - air.a) * sky;
  // through the deck
  float t0 = max(0.0, tBase), t1 = min((uDeckBase + uDeckDepth + 140.0 - o.y) / d.y, 62000.0);
  if (t0 >= t1) return air.rgb + (1.0 - air.a) * sky;
  float cosA = dot(d, uSunDir);
  float phase = mix(hg(cosA, 0.55), hg(cosA, -0.25), 0.55);
  vec3 col = vec3(0.0); float T = 1.0, tw = 0.0, ws = 0.0;
  float dt = (t1 - t0) / float(STEPS), t = t0 + dt * jitter;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = o + d * t;
    float hf, den = cloudDensity(p, hf);
    if (den > 0.003) {
      float sig = den * SIGMA;
      float od = SIGMA * (macroDensity(p + uSunDir * 110.0) * 220.0 + macroDensity(p + uSunDir * 420.0) * 420.0 + macroDensity(p + uSunDir * 950.0) * 650.0);
      // the sun, straight through and (more softly, less dimmed, bluer) as light scattered on within the cloud
      vec3 sunL = uCloudLit * exp(-od) * phase + mix(uCloudLit, uAmbHigh, 0.5) * 0.36 * exp(-od * 0.2);
      // the sky's light from above, dimmed by the cloud over the point: thick middles have dark bases
      float above = (1.0 - hf) * (90.0 + weatherAt(p.xz).g * uDeckDepth);
      vec3 L = sunL + mix(uAmbLow, uAmbHigh, hf) * mix(1.0, exp(-above * 0.0022), 0.75);
      float tr = exp(-sig * dt);
      col += T * L * (1.0 - tr);
      tw += T * (1.0 - tr) * t; ws += T * (1.0 - tr);
      T *= tr;
      if (T < 0.015) break;
    }
    t += dt;
  }
  // the further the cloud, the more of the air's haze is in front of it
  float tc = ws > 0.0 ? tw / ws : t1;
  col = mix(col, hazeLight(0.55) * (1.0 - T), 1.0 - exp(-tc / (uFarHaze * 3.2)));
  return air.rgb + (1.0 - air.a) * (col + T * sky);
}`;

const QUAD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MARCH_FRAG = /* glsl */`
${WIND_GLSL}
${SKY_GLSL}
${CLOUD_GLSL}
uniform vec4 uRange;      // the panorama's azimuths (left, right) and elevations (bottom, top), radians
uniform vec3 uEye;
varying vec2 vUv;
void main() {
  float phi = mix(uRange.x, uRange.y, vUv.x), th = mix(uRange.z, uRange.w, vUv.y);
  vec3 d = vec3(sin(phi) * cos(th), sin(th), -cos(phi) * cos(th));
  // (each pixel's march starts at its own random point along its first step. Until 8 Nov 2026 this was interleaved
  // gradient noise, which changes mostly across x: near the horizon, where a step is a kilometre long, the deck's base
  // came out in vertical streaks. White noise per pixel leaves only a fine grain, which the screen's pixel-wide blur
  // reading the panorama smooths away.)
  float jitter = fract(sin(dot(gl_FragCoord.xy + uRange.xz * 997.0, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(skyWithClouds(uEye, d, jitter), 1.0);
}`;
// the sky on screen, read from the panorama by direction (the camera's own rays). Each band of a panorama was drawn at
// its own moment: what is read from it is carried on by the deck's drift since then (at the deck's height), so no band
// lags behind the next however far the view is zoomed. Zoomed in, a finer panorama of just the part of the sky in view
// (the inset) is laid over the wide one, its edges feathered into it.
const SHOW_VERT = /* glsl */`varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.99999, 1.0); }`;
const SHOW_FRAG = /* glsl */`
${WIND_GLSL}
${SKY_GLSL}
uniform mat4 uProjInv; uniform mat3 uCamRot; uniform float uNow; uniform vec2 uDrift; uniform float uCloudH;
uniform sampler2D uPano; uniform vec4 uRange; uniform vec2 uBands; uniform float uBandT[16]; uniform float uRound;
uniform sampler2D uInset; uniform vec4 uInsetRange; uniform vec2 uInsetBands; uniform float uInsetT[16]; uniform float uInsetMix;
uniform vec2 uInsetTexel; uniform vec2 uPanoTexel;
varying vec2 vNdc;
vec2 panoUv(vec3 d, vec4 R) {
  float phi = atan(d.x, -d.z), th = asin(clamp(d.y, -1.0, 1.0));
  phi += 6.2831853 * floor((0.5 * (R.x + R.y) - phi) / 6.2831853 + 0.5);    // (round to the side its middle is on)
  return vec2((phi - R.x) / (R.y - R.x), (th - R.z) / (R.w - R.z));
}
// where the cloud now in direction d was dt seconds ago (the deck drifts as one)
vec3 before(vec3 d, float dt) {
  float s = min(uCloudH / max(d.y, 0.04), 30000.0);
  return normalize(d * s + vec3(uDrift.x, 0.0, uDrift.y) * dt);
}
bool inside(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }
void main() {
  vec4 v = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(uCamRot * (v.xyz / v.w));
  vec2 uv = panoUv(d, uRange);
  int i = int(clamp(floor(uv.y * uBands.x), 0.0, uBands.y - 1.0));
  vec2 u2 = panoUv(before(d, uNow - uBandT[i]), uRange);
  if (uRound > 0.5) u2.x = fract(u2.x);                     // (all the way round: it closes on itself behind)
  // (the wide panorama too through a pixel-wide blur: the march's per-pixel grain otherwise sparkles along the cloud
  // bank's edges at the horizon)
  vec3 c = clearSky(d);
  if (inside(u2)) {
    vec2 po = 0.5 * uPanoTexel;
    c = 0.25 * (texture2D(uPano, u2 + po).rgb + texture2D(uPano, u2 - po).rgb
              + texture2D(uPano, u2 + vec2(po.x, -po.y)).rgb + texture2D(uPano, u2 + vec2(-po.x, po.y)).rgb);
  }
  if (uInsetMix > 0.0) {
    vec2 iu = panoUv(d, uInsetRange);
    if (inside(iu)) {
      int j = int(clamp(floor(iu.y * uInsetBands.x), 0.0, uInsetBands.y - 1.0));
      vec2 i2 = panoUv(before(d, uNow - uInsetT[j]), uInsetRange);
      vec2 e = min(i2, 1.0 - i2);
      float k = smoothstep(0.0, 0.04, min(e.x, e.y)) * uInsetMix;
      // (read through a pixel-wide blur: close up, the march's dither along the clouds' edges would show)
      vec2 o = 0.5 * uInsetTexel;
      vec3 ci = 0.25 * (texture2D(uInset, i2 + o).rgb + texture2D(uInset, i2 - o).rgb
                      + texture2D(uInset, i2 + vec2(o.x, -o.y)).rgb + texture2D(uInset, i2 + vec2(-o.x, o.y)).rgb);
      if (k > 0.0) c = mix(c, ci, k);
    }
  }
  // (below the horizon the sky only shows in the sliver where the land runs out, hundreds of kilometres off: there it
  // is the haze over that land, not sky blue, or a blue line runs along the horizon)
  c = mix(c, uHaze, smoothstep(0.0, -0.004, d.y));
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sky's colours and the air's (shared uniforms, added to the scene's). */
// A shadow from the deck as the eye sees it, for anything standing under it (the painting's land, valley.js).
//
// sunThrough() asks the weather MAP, which knows the sheets but not the shapes inside them: billowing edges and wisps
// live in cloudDensity, which only the sky's marcher ever reads. So the light on the land and the clouds overhead were
// two different weathers, and no shadow crossed the painting in the shape of the cloud above it.
//
// Geometrically this is the plain thing it has to be. The cloud shading a point p is the cloud at p + uSunDir * t, so
// the march starts at the ground and walks to the sun; a ridge takes its shadow where a ridge actually stands, and as
// the deck drifts the shadow line climbs the hill and comes down the other side. Same deckShape, same billow noise and
// the same uWeatherOff as cloudDensity, which is what makes the two agree at all.
//
// Names are prefixed because this lands in compilation units that already own hash31 and noise3 of their own, and it
// declares no uniforms: uSunDir, uDeckBase, uDeckDepth, uWeather and uWeatherOff all come with WEATHER_GLSL, which is
// already under every shader that sits in this weather.
export const CLOUD_SHADOW_GLSL = /* glsl */`
float csHash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float csNoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(csHash31(i), csHash31(i + vec3(1, 0, 0)), f.x), mix(csHash31(i + vec3(0, 1, 0)), csHash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(csHash31(i + vec3(0, 0, 1)), csHash31(i + vec3(1, 0, 1)), f.x), mix(csHash31(i + vec3(0, 1, 1)), csHash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// how much sun reaches p through the deck above it (1 in open sky, 0 under the thickest billow). steps: how many
// samples the walk gets - 8 is plenty, the deck is a few hundred metres thick and this runs on every land pixel.
float cloudShade(vec3 p, float steps) {
  if (uSunDir.y < 0.08) return 1.0;                       // a sun on the horizon casts nothing worth the pixels
  float span = (uDeckBase + uDeckDepth + 140.0 - p.y) / uSunDir.y;
  float ds = span / steps, od = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= steps) break;
    vec3 q = p + uSunDir * (ds * (float(i) + 0.5));
    vec4 w = weatherAt(q.xz);
    if (w.r < 0.02) continue;
    float base = uDeckBase + (w.b - 0.5) * 380.0;
    float top = base + 90.0 + w.g * uDeckDepth;
    float hf = (q.y - base) / max(top - base, 1.0);
    if (hf < 0.0 || hf > 1.0) continue;
    float d = w.r * smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(0.35 + 0.25 * w.g, 1.0, hf));
    if (d <= 0.0) continue;
    vec3 n = vec3(q.x + uWeatherOff.x, q.y * 1.6, q.z + uWeatherOff.y);
    float b = csNoise3(n * 0.0034) * 0.6 + csNoise3(n * 0.0105 + 7.3) * 0.28;
    od += clamp((d - (b - 0.3) * 1.1 * (1.0 - 0.4 * d)) * 1.7, 0.0, 1.0) * ds;
  }
  // 1.25 -> 1.62 with the shafts: the bright patches and the shade between them are where a beam lands, so the land has
  // to carry the contrast the air is drawing. (This chunk is concatenated into other shaders, so it ends on code, not on
  // a comment - a trailing // there would comment out whatever the next chunk declares.)
  return clamp(exp(-od * 0.02 * 1.62), 0.0, 1.0);         // 0.02 per metre of the densest cloud, as SIGMA in the deck
}`;

export function skyUniforms() {
  const lin = (hex, k = 1) => new THREE.Color(hex).convertSRGBToLinear().multiplyScalar(k);
  return {
    uZenith: { value: lin('#6f98ca') }, uHorizon: { value: lin('#dfe0d8') },
    uHazeSun: { value: lin('#f2d4a4', 1.0) }, uHazeShade: { value: lin('#a2adb8', 0.74) }, uFarHaze: { value: 7000 },
    uCloudLit: { value: lin('#ffe0b4', 1.6) }, uAmbHigh: { value: lin('#cdd7e2', 0.95) }, uAmbLow: { value: lin('#6f7d8b', 0.7) },
    // the shafts' colour and strength: uShaft is per metre at the deck's base, where the moist air lies. Read back off
    // the screen (a probe returning the march's own sums), at a tenth the march gathers about 0.004 of optical depth
    // over the horizon's eight kilometres; at a twentieth, 0.018. Both are a few levels over a bright sky - a
    // brightening, not a beam - because the lit part of the path is small: sunThrough is bimodal (0.07 under a sheet,
    // 1.0 in a hole, near nothing between), so most of the way is shaded air that scatters nothing. Strength is the
    // only lever that raises the glow; the beam's threshold is not, since any cut between 0.2 and 0.9 selects the same
    // holes. Going much past a twentieth saturates the pixels under a gap, so what the shafts lack is lit air, not force.
    uShaftTint: { value: lin('#ffeccc', 1.7) }, uShaft: { value: 1 / 25000 },
  };
}

/** A panorama of the sky (azimuths, elevations: radians), drawn a band at a time; each band remembers when. */
class Pano {
  constructor(n) {
    this.n = n; this.range = new THREE.Vector4(); this.rt = null; this.bands = [];
    this.times = new Float32Array(16); this.bandsU = new THREE.Vector2(1, 1); this.fresh = false; this.px = 0;
  }
  /** Its extent and resolution (px per radian, capped at maxPx pixels): all of it to draw again. */
  set(phi0, phi1, th0, th1, pxPerRad, maxPx, hdr) {
    this.range.set(phi0, phi1, th0, th1);
    let w = (phi1 - phi0) * pxPerRad, h = (th1 - th0) * pxPerRad;
    const k = Math.min(1, Math.sqrt(maxPx / (w * h)));
    w = Math.max(64, Math.round(w * k)); h = Math.max(32, Math.round(h * k));
    this.px = h / (th1 - th0);
    if (!this.rt || this.rt.width !== w || this.rt.height !== h || (this.rt.texture.wrapS === THREE.RepeatWrapping) !== (phi1 - phi0 > 6.28)) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: hdr === false ? THREE.UnsignedByteType : THREE.HalfFloatType, depthBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: phi1 - phi0 > 6.28 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping });
      this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    const rows = Math.ceil(h / this.n);
    this.bands = Array.from({ length: this.n }, (_, i) => ({ i, y0: i * rows, y1: Math.min(h, (i + 1) * rows), at: -1e9 }));
    this.bandsU.set(h / rows, this.n);
    this.fresh = false; this.next = 0;
  }
  /** Draw one band (the target's own scissor, which three.js applies in the target's pixels whatever the screen's ratio). */
  draw(sky, renderer, b, t) {
    sky.marchMat.uniforms.uRange.value = this.range;
    this.rt.scissor.set(0, b.y0, this.rt.width, b.y1 - b.y0);
    this.rt.scissorTest = true;
    renderer.setRenderTarget(this.rt);
    renderer.render(sky.marchScene, sky.ortho);
    this.rt.scissorTest = false;
    b.at = t; this.times[b.i] = t;
  }
  /** The band most overdue (those in view, [v0, v1] of its height, count as staler). */
  due(t, view) {
    let best = null, score = -Infinity;                  // (the stalest band, even if the clock went back)
    for (const b of this.bands) {
      const H = this.rt.height, seen = b.y1 / H > view[0] && b.y0 / H < view[1];
      const s = (t - b.at) * (seen ? 3 : 1);
      if (s > score) { score = s; best = b; }
    }
    return best;
  }
  /** Whether it holds the directions [phi0, phi1, th0, th1]. */
  holds(v) { const R = this.range; return v[0] >= R.x && v[1] <= R.y && v[2] >= R.z && v[3] <= R.w; }
}

/**
 * The sky: a panorama of it (azimuths phi0..phi1, elevations th0..th1, radians, at pxPerRad, capped at maxPx pixels),
 * kept up to date a band at a time; zoomed in, a finer one of the view's part of it; and the material that shows them on
 * screen. U: the scene's uniforms (with the weather's and skyUniforms()).
 */
export class Sky {
  constructor(U, { tier = 'high', eye = 1 } = {}) {
    this.tier = tier;
    this.U = U;
    const defines = { STEPS: tier === 'high' ? 56 : 32, SHAFT_STEPS: tier === 'high' ? 9 : 5 };
    this.marchMat = new THREE.ShaderMaterial({ uniforms: { ...U, uRange: { value: new THREE.Vector4() }, uEye: { value: new THREE.Vector3(0, eye, 0) } },
      vertexShader: QUAD_VERT, fragmentShader: MARCH_FRAG, defines, depthTest: false, depthWrite: false });
    this.march = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.marchMat);
    this.march.frustumCulled = false;
    this.marchScene = new THREE.Scene(); this.marchScene.add(this.march);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.wide = new Pano(tier === 'high' ? 12 : 8);
    this.insets = [new Pano(8), new Pano(8)];          // the one shown, and the next, drawn behind it
    this.shown = null;
    this.showU = {
      uPano: { value: null }, uRange: { value: this.wide.range }, uBands: { value: this.wide.bandsU }, uBandT: { value: this.wide.times }, uRound: { value: 0 },
      uInset: { value: null }, uInsetRange: { value: new THREE.Vector4() }, uInsetBands: { value: new THREE.Vector2(1, 1) },
      uInsetT: { value: new Float32Array(16) }, uInsetMix: { value: 0 }, uInsetTexel: { value: new THREE.Vector2(1, 1) }, uPanoTexel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) },
      uNow: { value: 0 }, uDrift: { value: DRIFT }, uCloudH: { value: DECK.base + 0.4 * DECK.depth - eye },
      uProjInv: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: { ...U, ...this.showU }, vertexShader: SHOW_VERT, fragmentShader: SHOW_FRAG, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -100;
  }
  get range() { return this.wide.range; }
  get rt() { return this.wide.rt; }

  /** The panorama's extent and resolution (the scene sets it from how far the view can turn, and its pixel size). */
  setRange(phi0, phi1, th0, th1, pxPerRad, maxPx) {
    const R = this.wide.range, same = R.x === phi0 && R.y === phi1 && R.z === th0 && R.w === th1 && this.wide.rt;
    const k = Math.min(1, Math.sqrt(maxPx / ((phi1 - phi0) * (th1 - th0) * pxPerRad * pxPerRad)));
    if (same && Math.abs(this.wide.px - pxPerRad * k) < 1) return;
    this.wide.set(phi0, phi1, th0, th1, pxPerRad, maxPx, this.hdr);
    this.showU.uPano.value = this.wide.rt.texture;
    this.showU.uPanoTexel.value.set(1 / this.wide.rt.width, 1 / this.wide.rt.height);
    this.showU.uRound.value = phi1 - phi0 > 6.28 ? 1 : 0;
  }

  /** Bring the panorama up to date: all of it (full), or the band most overdue (those in view count as staler). */
  update(renderer, t, { full = false, view = [-1, 2] } = {}) {
    const P = this.wide;
    if (!P.rt) return;
    if (this.hdr === undefined) this.hdr = renderer.extensions.has('EXT_color_buffer_float');
    const prev = renderer.getRenderTarget();
    if (full || !P.fresh) { for (const b of P.bands) P.draw(this, renderer, b, t); P.fresh = true; }
    else P.draw(this, renderer, P.due(t, view), t);
    this.showU.uNow.value = t;
    renderer.setRenderTarget(prev);
  }

  /**
   * Zoomed in: a finer panorama of the part of the sky in view. want: { view: [phi0, phi1, th0, th1] in view, range: the
   * same with a margin, px: px per radian wanted, maxPx, settled: the zoom has come to rest, full }; or null (zoomed out:
   * the inset fades away). The one shown is kept up to date a band a frame; when the view leaves it or needs it finer,
   * the next is drawn behind it, two bands a frame, and takes over once whole (the same sky: no seam shows).
   */
  updateInset(renderer, t, want, dt = 1 / 60) {
    const U = this.showU;
    if (!want) {
      U.uInsetMix.value = Math.max(0, U.uInsetMix.value - dt * 5);
      if (U.uInsetMix.value === 0) this.shown = null;
      return;
    }
    const prev = renderer.getRenderTarget();
    const S = this.shown, good = S && S.holds(want.view) && S.px >= want.px * 0.7;
    if (!good && (want.settled || !S)) {
      const B = this.insets[0] === S ? this.insets[1] : this.insets[0];
      if (!B.aim || B.fresh || !B.holds(want.view) || Math.abs(want.px / B.aim.px - 1) > 0.15) {
        B.set(...want.range, want.px, want.maxPx, this.hdr); B.aim = want;
      }
      for (let k = 0; k < (want.full ? B.n : 2) && B.next < B.n; k++) B.draw(this, renderer, B.bands[B.next++], t);
      if (B.next >= B.n) {
        B.fresh = true; B.aim = null;
        if (!S) U.uInsetMix.value = 0;                     // (coming in: it fades in; taking over: the same sky, at once)
        this.shown = B;
        U.uInset.value = B.rt.texture; U.uInsetRange.value = B.range; U.uInsetBands.value = B.bandsU; U.uInsetT.value = B.times;
        U.uInsetTexel.value.set(1 / B.rt.width, 1 / B.rt.height);
      }
    }
    const F = this.shown;
    if (F && F.fresh) {
      if (want.full) for (const b of F.bands) F.draw(this, renderer, b, t);
      else F.draw(this, renderer, F.due(t, [0, 1]), t);
      U.uInsetMix.value = Math.min(1, U.uInsetMix.value + dt * 5);
    }
    renderer.setRenderTarget(prev);
  }

  /** The screen's rays: the scene camera's lens and the way it is turned. */
  aim(cam) {
    this.showU.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.showU.uCamRot.value.setFromMatrix4(cam.matrixWorld);
  }
}

/** An environment for the hands' reflections: this overcast sky over the meadow. */
export function skyEnvironment(renderer, U) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uDeck: { value: new THREE.Color('#c3c9cf').convertSRGBToLinear() }, uMeadow: { value: new THREE.Color('#7f8c4a').convertSRGBToLinear() } },
    vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${WIND_GLSL}\n${SKY_GLSL}\nuniform vec3 uDeck; uniform vec3 uMeadow; varying vec3 vD;
      void main() { vec3 d = normalize(vD);
        vec3 c = d.y > 0.0 ? mix(clearSky(d), uDeck, 0.6 * smoothstep(0.03, 0.35, d.y)) : mix(uHorizon, uMeadow, smoothstep(0.0, 0.25, -d.y));
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 48, 24), mat));
  const pmrem = new THREE.PMREMGenerator(renderer), tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return tex;
}
