// A light shower now and then, and far off in it a storm: a little more cloud comes over, fine rain falls round the
// walker for a few minutes - short, faint streaks slanting with the wind, only a few metres off - and goes; while it
// lasts, low thunder rolls from far away and once in a while a bolt comes down on the horizon, kilometres off, with
// the sky flashing pale round it (15 Nov 2026).
//
//   drizzleAt(t)   the weather's spell at the walk's clock t (s): { overcast, rain } each 0..1 - the cover comes first
//                  and goes last, the rain within it. The first spell a minute into the walk, then one in every ten.
//                  ?rain=1 holds a drizzle, ?rain=0 none.
//   makeDrizzle    the streaks round the camera (one draw: a few thousand short lines, each drop's place wrapped into
//                  a box that moves with the camera, so the rain is anchored in the world and the walker moves through
//                  it), and the lightning: makeDrizzle(U).update(t, dt, { cam, rain, wind, sky }) each frame.
//                  Its strikes are told to `onStrike({ km, yaw })` (the thunder: sound.js) and its flash is U.uFlash.
import * as THREE from 'three';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HOLD = (() => { try { const v = new URLSearchParams(location.search).get('rain'); return v === null ? null : +v; } catch { return null; } })();
const LIGHT = 0.7;                                // (a drizzle at its heaviest: seven drops in ten of the box's)
// (the cover at its fullest: a quarter of the way to a closed grey deck - a day's shower, the sky only a little more
// overcast than it is without it, the sun and the sunset still through it; closed all the way, an evening sky went
// flat and dark rust - seen 15 Nov 2026)
const COVER = 0.25;
export const SPELL = { start: 60, cycle: 600, cover: 300, rain: 210 };    // s: the first, how often, how long the cover and the rain last

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
uniform vec3 uLight; uniform float uFlash;
varying float vA;
void main() {
  gl_FragColor = vec4(uLight * (1.0 + 3.0 * uFlash), vA * 0.27);
  #include <colorspace_fragment>
}`;

const BOLT_VERT = /* glsl */`
attribute float aGlow;
varying float vGlow;
void main() { vGlow = aGlow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BOLT_FRAG = /* glsl */`
uniform float uOn;
varying float vGlow;
void main() {
  gl_FragColor = vec4(vec3(0.82, 0.86, 1.0) * (2.4 * uOn * vGlow), uOn * vGlow);
  #include <colorspace_fragment>
}`;

/** A bolt's path from the cloud base down to the ground: midpoint displacement, with a few branches. */
function boltLines(top, bottom, rnd) {
  const out = [];                                  // [x0, y0, z0, x1, y1, z1, glow]
  const seg = (a, b, rough, depth, glow) => {
    const L = a.distanceTo(b);
    if (L < 12 || depth > 9) { out.push([a.x, a.y, a.z, b.x, b.y, b.z, glow]); return; }
    const m = a.clone().lerp(b, 0.4 + 0.2 * rnd());
    m.x += (rnd() - 0.5) * L * rough; m.z += (rnd() - 0.5) * L * rough; m.y += (rnd() - 0.5) * L * rough * 0.3;
    seg(a, m, rough, depth + 1, glow); seg(m, b, rough, depth + 1, glow);
    // (a branch now and then, off to the side and down, fainter, ending in the air)
    if (glow > 0.6 && depth > 1 && depth < 6 && rnd() < 0.28) {
      const dir = b.clone().sub(a).normalize();
      const e = m.clone().add(new THREE.Vector3(dir.x + (rnd() - 0.5) * 1.6, dir.y * (0.5 + 0.4 * rnd()), dir.z + (rnd() - 0.5) * 1.6).multiplyScalar(L * (0.3 + 0.4 * rnd())));
      seg(m, e, rough * 1.1, depth + 2, glow * 0.45);
    }
  };
  seg(top, bottom, 0.55, 0, 1);
  return out;
}

export function makeDrizzle(U, { heightAt = () => 0, onStrike = null } = {}) {
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
    uLight: { value: new THREE.Color(0.5, 0.52, 0.55) }, uFlash: U.uFlash };
  const drops = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: DU, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false, depthTest: true }));
  drops.frustumCulled = false; drops.renderOrder = 5; drops.name = 'drizzle.drops'; drops.userData.noCast = true;
  g.setDrawRange(0, 0);
  group.add(drops);

  // ---- the lightning: one bolt drawn at a time, far off
  const MAXV = 2400;
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3));
  bg.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(MAXV), 1));
  bg.setDrawRange(0, 0);
  const BU = { uOn: { value: 0 } };
  const bolt = new THREE.LineSegments(bg, new THREE.ShaderMaterial({ uniforms: BU, vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }));
  bolt.frustumCulled = false; bolt.renderOrder = 4; bolt.name = 'drizzle.bolt'; bolt.userData.noCast = true;
  group.add(bolt);

  let next = 25 + Math.random() * 40, strike = null, rumbleNext = 8 + Math.random() * 12;
  const pulses = () => {                           // (a strike's flicker: two to four return strokes over half a second)
    const n = 2 + Math.floor(Math.random() * 3), out = [];
    let at = 0;
    for (let i = 0; i < n; i++) { out.push([at, 0.05 + Math.random() * 0.05, i === 0 ? 1 : 0.5 + Math.random() * 0.5]); at += 0.06 + Math.random() * 0.14; }
    return out;
  };
  const strikeAt = (cam, sky) => {
    // (somewhere ahead or to the side of the view, 7 to 16 km off: never overhead)
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const yaw0 = Math.atan2(fwd.x, -fwd.z), yaw = yaw0 + (Math.random() - 0.5) * 2.2, km = 7 + Math.random() * 9;
    const x = cam.position.x + Math.sin(yaw) * km * 1000, z = cam.position.z - Math.cos(yaw) * km * 1000, y0 = heightAt(x, z);
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 400, y0 + (sky?.base ?? 800) + 300 + Math.random() * 500, z + (Math.random() - 0.5) * 400);
    const lines = boltLines(top, new THREE.Vector3(x, y0, z), Math.random).slice(0, MAXV / 2);
    const P = bg.attributes.position.array, A = bg.attributes.aGlow.array;
    lines.forEach((l, i) => { P.set(l.slice(0, 3), i * 6); P.set(l.slice(3, 6), i * 6 + 3); A[i * 2] = A[i * 2 + 1] = l[6]; });
    bg.attributes.position.needsUpdate = true; bg.attributes.aGlow.needsUpdate = true;
    bg.setDrawRange(0, lines.length * 2);
    U.uFlashDir?.value.set(Math.sin(yaw), 0.18, -Math.cos(yaw)).normalize();
    strike = { t: 0, pulses: pulses() };
    onStrike?.({ km, yaw: yaw - yaw0 });
  };

  return {
    group, drops, bolt,
    /** Each frame: the walk's clock t, the frame's dt (s), the camera, the drizzle now (0..1), the storm's chance (0..1:
     *  the cover), the wind across the ground (m/s, x and z) and the light the drops catch. */
    update(t, dt, { cam, rain = 0, storm = 0, wind = [1.5, 0.2], light = null, sky = null, onRumble = null }) {
      DU.uT.value = t % 3600; DU.uRain.value = rain;
      if (cam) DU.uCam.value.copy(cam.position);
      DU.uVel.value.set(wind[0], -3.2, wind[1]);
      if (light) DU.uLight.value.copy(light);
      g.setDrawRange(0, rain > 0.002 ? N * 2 : 0);
      // (the storm: far off, only while the cover is over and the drizzle falls)
      let flash = 0;
      if (strike) {
        strike.t += dt;
        let on = 0;
        for (const [at, len, k] of strike.pulses) if (strike.t >= at && strike.t < at + len) on = Math.max(on, k * (1 - (strike.t - at) / len * 0.5));
        BU.uOn.value = on; flash = on;
        const endT = strike.pulses[strike.pulses.length - 1][0] + 0.2;
        if (strike.t > endT) { strike = null; BU.uOn.value = 0; bg.setDrawRange(0, 0); }
      } else if (cam && storm > 0.5 && rain > 0.2) {
        next -= dt;
        if (next <= 0) { strikeAt(cam, sky); next = 45 + Math.random() * 75; }
        // (and between the strikes, thunder from further off still, a storm beyond the horizon: heard, not seen)
        rumbleNext -= dt;
        if (rumbleNext <= 0) { onRumble?.(); rumbleNext = 20 + Math.random() * 35; }
      }
      U.uFlash.value = flash;
    },
  };
}
