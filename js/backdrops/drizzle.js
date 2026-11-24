// A light shower now and then, and far off in it a storm: a little more cloud comes over, fine rain falls round the
// walker for a few minutes - short, faint streaks slanting with the wind, only a few metres off - and goes; while it
// lasts, low thunder rolls now and then from a storm kilometres off, heard and never seen (15 Nov 2026: the bolt on the
// horizon and the sky's flash round it taken out, the thunder kept).
//
//   drizzleAt(t)   the weather's spell at the walk's clock t (s): { overcast, rain } each 0..1 - the cover comes first
//                  and goes last, the rain within it. The first spell a minute into the walk, then one in every twenty
//                  minutes, eight of them rain (24 Nov 2026: the rain had lasted three and a half minutes in ten).
//                  ?rain=1 holds a drizzle, ?rain=0 none.
//   wetAt(t)       how wet the world is at t (0 dry .. 1 soaked): the rain so far, soaked in over a few minutes and
//                  dried out slower once it stops - the ground darkens and its puddles fill, the walls darken in runs
//                  (terrain.js, sunshadow.js receiveSun). ?rain=1 soaked, ?rain=0 dry.
//   makeDrizzle    the streaks round the camera (one draw: a few thousand short lines, each drop's place wrapped into
//                  a box that moves with the camera, so the rain is anchored in the world and the walker moves through
//                  it): makeDrizzle(U).update(t, dt, { cam, rain, storm, wind, light }) each frame. The far storm's
//                  peals are told to `onThunder({ km, yaw })` and its rumbles beyond the horizon to `onRumble()`
//                  (sound.js).
import * as THREE from 'three';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HOLD = (() => { try { const v = new URLSearchParams(location.search).get('rain'); return v === null ? null : +v; } catch { return null; } })();
const LIGHT = 0.7;                                // (a drizzle at its heaviest: seven drops in ten of the box's)
// (the cover at its fullest: a quarter of the way to a closed grey deck - a day's shower, the sky only a little more
// overcast than it is without it, the sun and the sunset still through it; closed all the way, an evening sky went
// flat and dark rust - seen 15 Nov 2026)
const COVER = 0.25;
export const SPELL = { start: 60, cycle: 1200, cover: 600, rain: 480 };    // s: the first, how often, how long the cover and the rain last

/** The weather's spell at the walk's clock t (s): how overcast (0..1), how hard it drizzles (0..1), and how far into
 *  its spell the weather is (spell: 0..1, the storm far off only near its height). */
export function drizzleAt(t) {
  if (HOLD !== null) return HOLD > 0 ? { overcast: COVER, rain: LIGHT * Math.min(1, HOLD), spell: 1 } : { overcast: 0, rain: 0, spell: 0 };
  const S = SPELL, u = t - S.start;
  if (u < -60) return { overcast: 0, rain: 0, spell: 0 };
  // (where in its spell the weather is: the cover comes over in the minute before the rain, and clears a minute and a
  // half after it)
  const q = ((u + 60) % S.cycle) - 60;
  const spell = ss(-60, 0, q) * (1 - ss(S.cover - 90, S.cover, q)), overcast = COVER * spell;
  const rain = LIGHT * ss(5, 50, q) * (1 - ss(S.rain - 50, S.rain, q));
  return { overcast, rain, spell };
}

/** How wet the world is at the walk's clock t: 0 dry .. 1 soaked. The rain of the last 25 minutes, in steps of 10 s:
 *  while it rains the wet grows toward soaked over some two and a half minutes (as hard as it rains), after it dries
 *  over some seven - a whole spell's rain soaks it, and the next spell comes before it is quite dry again. */
export function wetAt(t) {
  if (HOLD !== null) return HOLD > 0 ? 1 : 0;
  let w = 0;
  for (let k = 150; k >= 0; k--) {
    const r = drizzleAt(t - k * 10).rain / LIGHT;
    w = r > 0.02 ? w + r * (1 - w) * (10 / 150) : w * (1 - 10 / 420);
  }
  return Math.min(1, Math.max(0, w));
}

const N = 5200, BOX = 34, HIGH = 22;              // drops; the box round the camera (m across, m high)

const DROP_VERT = /* glsl */`
attribute vec4 aSeed; attribute float aEnd;
uniform vec3 uCam; uniform float uT; uniform float uRain; uniform vec3 uVel; uniform float uLen;
varying float vA;
void main() {
  vec3 hb = vec3(${BOX / 2}.0, ${HIGH / 2}.0, ${BOX / 2}.0), box = hb * 2.0;
  // (each drop falls at its own pace, a little faster or slower than the rest)
  vec3 v = uVel * (0.8 + 0.4 * aSeed.w);
  vec3 rel = mod(aSeed.xyz * box + v * uT - uCam + hb, box) - hb;
  float d = length(rel);
  // (as many drops as the rain is hard: the rest are put out of sight)
  float on = step(aSeed.w, uRain);
  vec3 p = uCam + rel - normalize(v) * uLen * aEnd;
  vA = on * smoothstep(0.7, 2.2, d) * (1.0 - smoothstep(9.0, ${BOX / 2 - 1}.0, d)) * (0.55 + 0.45 * fract(aSeed.w * 7.31));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (on < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const DROP_FRAG = /* glsl */`
uniform vec3 uLight;
varying float vA;
void main() {
  gl_FragColor = vec4(uLight, vA * 0.27);
  #include <colorspace_fragment>
}`;

export function makeDrizzle(U, { onThunder = null } = {}) {
  const group = new THREE.Group(); group.name = 'drizzle';
  // ---- the drops
  const seeds = new Float32Array(N * 2 * 4), ends = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let e = 0; e < 2; e++) { seeds.set(s, (i * 2 + e) * 4); ends[i * 2 + e] = e; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const DU = { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uRain: { value: 0 }, uVel: { value: new THREE.Vector3(1, -3, 0) }, uLen: { value: 0.24 },
    uLight: { value: new THREE.Color(0.5, 0.52, 0.55) } };
  const drops = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: DU, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false, depthTest: true }));
  drops.frustumCulled = false; drops.renderOrder = 5; drops.name = 'drizzle.drops'; drops.userData.noCast = true;
  g.setDrawRange(0, 0);
  group.add(drops);

  // ---- the far storm: a peal now and then, from 7 to 16 km off, ahead of the walker or to either side; and between
  // them, rumbles from beyond the horizon
  let next = 25 + Math.random() * 40, rumbleNext = 8 + Math.random() * 12;

  return {
    group, drops,
    /** Each frame: the walk's clock t, the frame's dt (s), the camera, the drizzle now (0..1), how far into its spell
     *  the weather is (0..1), the wind across the ground (m/s, x and z) and the light the drops catch. */
    update(t, dt, { cam, rain = 0, storm = 0, wind = [1.5, 0.2], light = null, onRumble = null }) {
      DU.uT.value = t % 3600; DU.uRain.value = rain;
      if (cam) DU.uCam.value.copy(cam.position);
      DU.uVel.value.set(wind[0], -3.2, wind[1]);
      if (light) DU.uLight.value.copy(light);
      g.setDrawRange(0, rain > 0.002 ? N * 2 : 0);
      // (the storm: far off, only while the cover is over and the drizzle falls)
      if (storm > 0.5 && rain > 0.2) {
        next -= dt;
        if (next <= 0) { onThunder?.({ km: 7 + Math.random() * 9, yaw: (Math.random() - 0.5) * 2.2 }); next = 45 + Math.random() * 75; }
        rumbleNext -= dt;
        if (rumbleNext <= 0) { onRumble?.(); rumbleNext = 20 + Math.random() * 35; }
      }
    },
  };
}
