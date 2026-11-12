// The country ways' own surface, up close: a stretch of each kind of way built in Blender as real geometry (dirt with its
// relief, the droshky's ruts, a tenth of it gravel spread evenly, pebbles, hand-sized stones and rocks toward the middle,
// weeds on the fringes; dev\world\path_strip.py) and baked to colour, relief (normal) and shade (ambient occlusion)
// textures, laid here along every footpath, track and road near the camera as a ribbon on the land, its edges frayed into
// the turf. The land's own earth under it carries the ways further off (terrain.js, paths.js).
import * as THREE from 'three';
import { receiveSun } from '../backdrops/sunshadow.js';
import { towardCamera } from '../depthmode.js';
import { capImage } from '../texcap.js';

const R = 260, REBUILD = 60, FRINGE = 0.45;
const STRIPS = { track: { w: 2.6, len: 8, depth: 0.116 }, foot: { w: 1.3, len: 8, depth: 0.067 }, road: { w: 6.5, len: 8, depth: 0.116, from: 'track' } };

function loadStrip(base, kind, maxAniso) {
  const L = new THREE.TextureLoader(), dir = base + 'assets/world/ways/';
  const set = (t, srgb) => { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  return Promise.all([
    // (the colours: Blender's layout redrawn as a photograph by ComfyUI's detail pass; till that is here, no ribbon)
    L.loadAsync(dir + kind + '-albedo-comfy.jpg').then((t) => set(capImage(t), true)),
    L.loadAsync(dir + kind + '-normal.jpg').then((t) => set(capImage(t), false)),
    L.loadAsync(dir + kind + '-height.jpg').then((t) => set(t, false)).catch(() => null),   // (its height: for the parallax)
  ]);
}

export function buildWayRibbons(world, U, { base = '', renderer } = {}) {
  const group = new THREE.Group(); group.name = 'way-ribbons';
  // (not shown. The ribbons had been wound facing down since they were made, so the paths as they have always looked
  // are the land's own earth; turned up in v0.0.3 they changed that look. Hidden until they are wanted.)
  group.visible = false;
  const ways = world.ways?.ways ?? [];
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? Math.max(8, THREE.Texture.DEFAULT_ANISOTROPY);
  const mats = {};
  for (const [kind, S] of Object.entries(STRIPS)) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: towardCamera(-4), polygonOffsetUnits: towardCamera(-8), visible: false });
    const pomU = { uRbH: { value: null }, uRbDepth: { value: S.depth }, uRbSize: { value: new THREE.Vector2(S.w, S.len) } };
    m.userData.pomU = pomU;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, pomU);
      // (parallax occlusion: the view ray marched down through the way's own height, 12 steps and a refinement; colour
      // and relief read where it lands)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace(/vMapUv/g, 'pomUv'))
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(/vNormalMapUv/g, 'pomUv'))
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec2 pomUv = vMapUv;
  if (uRbDepth > 0.0) {
    vec3 q0 = dFdx(vRbW), q1 = dFdy(vRbW); vec2 s0 = dFdx(vMapUv), s1 = dFdy(vMapUv);
    vec3 N = normalize(cross(q0, q1)); if (N.y < 0.0) N = -N;
    vec3 T = q0 * s1.t - q1 * s0.t, B = q1 * s0.s - q0 * s1.s;
    T = normalize(T - N * dot(N, T)); B = normalize(B - N * dot(N, B));
    vec3 V = normalize(cameraPosition - vRbW);
    vec3 Vt = vec3(dot(V, T), dot(V, B), max(dot(V, N), 0.2));
    float fade = 1.0 - smoothstep(15.0, 35.0, length(cameraPosition - vRbW));
    vec2 dir = -Vt.xy / Vt.z * uRbDepth * fade / uRbSize;
    float stp = 1.0 / 12.0, dd = 0.0, h = texture2D(uRbH, pomUv).r, pd = 0.0, ph = h;
    for (int i = 0; i < 12; i++) {
      if (1.0 - h <= dd) break;
      pd = dd; ph = h; dd += stp; h = texture2D(uRbH, vMapUv + dir * dd).r;
    }
    float a = (1.0 - ph) - pd, b = (1.0 - h) - dd;
    pomUv = vMapUv + dir * mix(pd, dd, clamp(a / (a - b + 1e-5), 0.0, 1.0));
  }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRbH; uniform float uRbDepth; uniform vec2 uRbSize;');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAcross; attribute float aEnd; varying float vAcross; varying float vEnd; varying vec3 vRbW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvAcross = aAcross; vEnd = aEnd; vRbW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vAcross; varying float vEnd; varying vec3 vRbW;
float rbHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float rbNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rbHash(i), rbHash(i + vec2(1, 0)), f.x), mix(rbHash(i + vec2(0, 1)), rbHash(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
  {
    // (the edge frayed into the turf: past the strip's own width it fades over the fringe, raggedly)
    float out_ = abs(vAcross) - ${(0.5).toFixed(2)};
    float fray = (rbNoise(vRbW.xz * 2.3) - 0.5) * 0.12 + (rbNoise(vRbW.xz * 9.0) - 0.5) * 0.05;
    diffuseColor.a *= 1.0 - smoothstep(-0.04, ${(FRINGE / S.w).toFixed(3)}, out_ + fray);
    // (and its ends - where a way meets another, or the reach ends - frayed out over a metre and a half: a cut end had
    // shown as a thin straight line drawn across the path)
    diffuseColor.a *= smoothstep(0.0, 1.5, vEnd + fray * 6.0);
    float d = length(vRbW - cameraPosition);
    diffuseColor.a *= 1.0 - smoothstep(${(R - 60).toFixed(1)}, ${(R - 10).toFixed(1)}, d);
  }`);
    };
    m.customProgramCacheKey = () => 'way-ribbon-' + kind;
    receiveSun(m, U);
    mats[kind] = m;
    // (its pictures read only once the ribbons are shown: 7 MB the walk had fetched for ribbons it never drew)
    m.userData.load = () => loadStrip(base, S.from ?? kind, aniso).then(([a, n, ht]) => {
      m.map = a; m.normalMap = n; m.normalScale.set(1, 1);
      if (ht) pomU.uRbH.value = ht; else pomU.uRbDepth.value = 0;
      m.visible = true; m.needsUpdate = true;
    }).catch(() => {});
  }
  const v = new THREE.Vector2();
  // one ribbon mesh per kind, rebuilt as the camera moves on
  const meshes = {};
  for (const kind of Object.keys(STRIPS)) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mats[kind]);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = 'way-ribbon-' + kind;
    group.add(mesh); meshes[kind] = mesh;
  }
  let at = null;
  const ACROSS = 6;     // (cuts across a ribbon, so it lies on the land's curve)
  const build = (cam) => {
    const buf = {};
    for (const kind of Object.keys(STRIPS)) buf[kind] = { pos: [], uv: [], uv1: [], acr: [], end: [], idx: [] };
    for (const w of ways) {
      const kind = w.kind === 'foot' || w.kind === 'track' || w.kind === 'road' ? w.kind : null;
      if (!kind) continue;
      const S = STRIPS[kind], half = S.w / 2 + FRINGE, B = buf[kind];
      // its stretches within reach, resampled every metre, the distance along carried on for the texture
      let along = 0, run = null;
      const flush = () => {
        if (!run || run.length < 2) { run = null; return; }
        const base0 = B.pos.length / 3, s0 = run[0][2], s1 = run[run.length - 1][2];
        for (let i = 0; i < run.length; i++) {
          const [x, z, s] = run[i], a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
          let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
          for (let k = 0; k <= ACROSS; k++) {
            const c = -half + (2 * half * k) / ACROSS, px = x - tz * c, pz = z + tx * c;
            // (a little above the land, and the most of it and its neighbours half a metre round, so where the hill's foot breaks
            // to the flat the land's own surface never rises through the strip: it had drawn a thin line across the road)
            const hh = Math.max(world.heightAt(px, pz), world.heightAt(px + tx * 0.5, pz + tz * 0.5), world.heightAt(px - tx * 0.5, pz - tz * 0.5));
            B.pos.push(px, hh + 0.05, pz);
            const u = c / S.w + 0.5, vv = s / S.len;
            // (the strip's picture read well inside its edges: the bake's outermost texels are dark, and where a way's frayed side
            // lay over another way's earth they drew a thin dark line across it)
            const uu = Math.min(1, Math.max(0, u)) * 0.88 + 0.06;
            B.uv.push(uu, vv); B.uv1.push(uu, vv);
            B.acr.push(c / S.w); B.end.push(Math.min(s - s0, s1 - s));
          }
        }
        const row = ACROSS + 1;
        for (let i = 0; i < run.length - 1; i++) for (let k = 0; k < ACROSS; k++) {
          const p0 = base0 + i * row + k, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
          B.idx.push(p0, p1, p2, p1, p3, p2);   // (facing up: it had been wound facing down, so only a fold in it ever showed - as a line across the road)
        }
        run = null;
      };
      for (let i = 1; i < w.pts.length; i++) {
        const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i], seg = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(seg));
        for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
          const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, s = along + seg * t;
          // (not over water: a bridge carries the way there: bridges.js)
          const wl = world.waterAt(x, z), wet = wl !== null && wl - world.landAt(x, z) > 0.05;
          if (!wet && Math.hypot(x - cam.x, z - cam.z) < R) { (run ??= []).push([x, z, s]); } else flush();
        }
        along += seg;
      }
      flush();
    }
    for (const [kind, B] of Object.entries(buf)) {
      const g = new THREE.BufferGeometry();
      if (B.idx.length) {
        g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
        g.setAttribute('uv1', new THREE.Float32BufferAttribute(B.uv1, 2));
        g.setAttribute('aAcross', new THREE.Float32BufferAttribute(B.acr, 1));
        g.setAttribute('aEnd', new THREE.Float32BufferAttribute(B.end, 1));
        g.setIndex(new THREE.Uint32BufferAttribute(B.idx, 1));
        g.computeVertexNormals();
      }
      meshes[kind].geometry.dispose(); meshes[kind].geometry = g;
    }
  };
  let asked = false;
  group.userData.update = (cam) => {
    if (!group.visible) return;                        // (hidden: nothing read, nothing built)
    if (!asked) { asked = true; for (const m of Object.values(mats)) m.userData.load(); }
    if (at && Math.hypot(cam.x - at.x, cam.z - at.z) < REBUILD) return;
    at = { x: cam.x, z: cam.z };
    build(cam);
  };
  return group;
}
