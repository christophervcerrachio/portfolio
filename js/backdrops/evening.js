// The evening (career\notes\evening.md): now and then the walk's sky, light, haze and colour drift from the day into
// the evening of its own loading picture - a cool grey-blue sky paling to an apricot glow at the horizon, the land in
// cool greys under a weak low sun, the air thicker, the woods' mist deeper - and back again.
//
// Nothing here draws: it moves the values the walk already draws with, which are shared objects (wind-glsl.js
// landscapeUniforms, clouds.js skyUniforms, the show pass's uniforms, the scene's two lights and the models' fog), so
// everything that reads them follows. The day's values are read from those objects as they stand when the evening is
// made, so the day stays exactly as it was; set(k) puts the blend k (0: the day, 1: the evening) into them.
//
// The cycle (update(t), t the walk's clock in seconds): the walk opens in the evening - the loading picture carries on
// into the world - and the day comes up over its first minute; then the day for five and a half minutes, a sunset of
// 80 s, the evening for two and a half minutes and a sunrise of 80 s, again and again. hold: 'day' or 'evening' (the
// address's ?sky=) keeps one; a still (?t=) stays in the day unless ?sky= asks.
import * as THREE from 'three';

const lin = (hex, k = 1) => new THREE.Color(hex).convertSRGBToLinear().multiplyScalar(k);

// the evening's values (the loading picture's colours, dev\load: sky top #bbc7c9 to an apricot glow #c4a395 at the
// horizon, clouds lit pink from below, the land far #798385 to near #1f2628)
const EVE = {
  // the light everything outdoors is lit by
  uSunColor: lin('#ffb487', 0.62), uSkyColor: lin('#a3afbd', 0.5), uGroundColor: lin('#5f5d57', 0.13),
  uHaze: lin('#c6b1a6'), uHazeDist: 16000,
  // the sky (its panorama is redrawn a band a frame: it follows in a second or so)
  uZenith: lin('#93a7b8'), uHorizon: lin('#e2c3ad'), uHazeSun: lin('#f3b98f'), uHazeShade: lin('#a9abb3', 0.8),
  uFarHaze: 3800, uCloudLit: lin('#ffbc9d', 1.25), uAmbHigh: lin('#b7bfcb', 0.8), uAmbLow: lin('#7b7a83', 0.58),
};
// the models' lights and fog, and the picture's finish (the show pass)
const EVE_SUN = { color: new THREE.Color('#ffc19a'), intensity: 0.85 };
const EVE_HEMI = { sky: new THREE.Color('#aab3bf'), ground: new THREE.Color('#6d6b61'), intensity: 1.05 };
const EVE_FOG = { color: new THREE.Color('#c8b6ab'), near: 2500, far: 70000 };
const EVE_GRADE = new THREE.Vector4(0.8, 1.05, 0.03, 0.36);          // (saturation, contrast, lift, vignette)
const EVE_SHADE = new THREE.Vector3(-0.022, 0.0, 0.034), EVE_LIGHT = new THREE.Vector3(0.03, 0.012, -0.022);

// the cycle, s: the first minute into the day, then day, sunset, evening, sunrise
const OPEN = 60, DAY = 330, DOWN = 80, EVENING = 150, UP = 80, CYCLE = DAY + DOWN + EVENING + UP;
const ease = (x) => x * x * (3 - 2 * x);

/** The evening's blend at the walk's clock t: 0 the day, 1 the evening. */
export function eveningAt(t) {
  if (t < OPEN) return 1 - ease(Math.max(0, t) / OPEN);
  const c = (t - OPEN) % CYCLE;
  if (c < DAY) return 0;
  if (c < DAY + DOWN) return ease((c - DAY) / DOWN);
  if (c < DAY + DOWN + EVENING) return 1;
  return 1 - ease((c - DAY - DOWN - EVENING) / UP);
}

/**
 * The evening for a scene. U: its shared uniforms (landscape and sky); show: the show pass's uniforms; sun, hemi: its
 * directional and hemisphere lights; fog(): the models' fog, once there is one; hold: 'day' | 'evening' | null;
 * still: a still picture (the day unless held). Returns { set(k), update(t), k }.
 */
export function makeEvening({ U, show, sun, hemi, fog = () => null, hold = null, still = false }) {
  const keys = Object.keys(EVE).filter((k) => U[k]);
  const day = Object.fromEntries(keys.map((k) => [k, typeof U[k].value === 'number' ? U[k].value : U[k].value.clone()]));
  const daySun = { color: sun.color.clone(), intensity: sun.intensity };
  const dayHemi = { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity };
  const dayGrade = show.uGrade.value.clone(), dayShade = show.uShadowTint.value.clone(), dayLight = show.uLightTint.value.clone();
  const dayMist = show.uMist.value;
  let dayFog = null, k = -1;
  const lerp = (a, b, x) => a + (b - a) * x;
  const api = {
    get k() { return Math.max(0, k); },
    /** The blend k (0 the day, 1 the evening) put into everything that draws with it. */
    set(x) {
      x = Math.min(1, Math.max(0, x));
      if (x === k) return;
      k = x;
      for (const n of keys) {
        const d = day[n], e = EVE[n];
        if (typeof d === 'number') U[n].value = lerp(d, e, x);
        else U[n].value.copy(d).lerp(e, x);
      }
      sun.color.copy(daySun.color).lerp(EVE_SUN.color, x); sun.intensity = lerp(daySun.intensity, EVE_SUN.intensity, x);
      hemi.color.copy(dayHemi.sky).lerp(EVE_HEMI.sky, x); hemi.groundColor.copy(dayHemi.ground).lerp(EVE_HEMI.ground, x);
      hemi.intensity = lerp(dayHemi.intensity, EVE_HEMI.intensity, x);
      const f = fog();
      if (f) {
        dayFog ??= { color: f.color.clone(), near: f.near, far: f.far };
        f.color.copy(dayFog.color).lerp(EVE_FOG.color, x); f.near = lerp(dayFog.near, EVE_FOG.near, x); f.far = lerp(dayFog.far, EVE_FOG.far, x);
      }
      // (the finish: a little less colour, the shade cooler and the light warmer; the vignette only where the look has
      // one - an older machine's picture has none - and the woods' mist deeper where it is drawn at all)
      const g = show.uGrade.value;
      g.set(lerp(dayGrade.x, EVE_GRADE.x, x), lerp(dayGrade.y, EVE_GRADE.y, x), lerp(dayGrade.z, EVE_GRADE.z, x), dayGrade.w > 0 ? lerp(dayGrade.w, EVE_GRADE.w, x) : 0);
      show.uShadowTint.value.copy(dayShade).lerp(EVE_SHADE, x); show.uLightTint.value.copy(dayLight).lerp(EVE_LIGHT, x);
      show.uMist.value = dayMist * (1 + 1.2 * x);
    },
    /** The cycle at the walk's clock t (s). */
    update(t) {
      if (hold === 'evening') return api.set(1);
      if (hold === 'day' || still) return api.set(0);
      api.set(eveningAt(t));
    },
  };
  return api;
}
