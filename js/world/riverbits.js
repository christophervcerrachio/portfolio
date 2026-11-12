// What the rivers carry besides their water (world.json, from build_world.py): the falls where a mountain river drops
// from one pool to the next, each a sheet of water curving over its lip, streaked and white, with spray at its foot;
// and the rocks of the rapids and the falls' lips, worn round, half in the water. All made here in code.
import * as THREE from 'three';
import { WIND_GLSL } from '../backdrops/wind-glsl.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { rockSkin } from './rockskin.js';

const FALL_VERT = /* glsl */`
${WIND_GLSL}
attribute vec2 aFall;          // x: across the sheet (0..1), y: down it (0 lip .. 1 foot)
varying vec2 vF; varying float vDist; varying float vSun;
void main() {
  vF = aFall;
  vSun = sunThrough(position);
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FALL_FRAG = /* glsl */`
${WIND_GLSL}
uniform float uSeed;
varying vec2 vF; varying float vDist; varying float vSun;
void main() {
  // streaks falling faster as they go, broken into strands, thinner at the edges; whiter where it churns at the foot
  float y = vF.y, x = vF.x;
  float fall = y * y * 6.0 - uTime * 2.6;
  float strands = vnoise(vec2(x * 38.0 + uSeed, fall * 1.2)) * 0.6 + vnoise(vec2(x * 90.0 - uSeed, fall * 3.0)) * 0.4;
  float edge = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.92, x);
  float a = edge * (0.45 + 0.55 * smoothstep(0.25, 0.75, strands)) * (0.75 + 0.25 * y);
  vec3 c = mix(vec3(0.62, 0.70, 0.68), vec3(0.95, 0.97, 0.96), smoothstep(0.35, 0.9, strands) * 0.7 + y * 0.3);
  c *= 0.55 + 0.45 * vSun + 0.1;
  gl_FragColor = vec4(hazed(c, vDist) * a, a);
}`;

/** world: loadWorld()'s; U: the landscape's uniforms. Returns a group (add it to the near scene). */
export function buildRiverBits(world, U, base = '', { detail = 3 } = {}) {
  const group = new THREE.Group();
  group.name = 'river-bits';
  const J = world.json;
  // ---- the falls
  for (const [k, f] of (J.falls ?? []).entries()) {
    const [x, z] = f.at, [dx, dz] = f.dir, nx = -dz, nz = dx, w = f.width * 0.8, drop = f.top - f.bottom;
    const NX = 12, NY = 10, pos = [], fa = [], idx = [];
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const u = i / NX, t = j / NY;
      // over the lip, then falling: forward a little (the water's speed carries it), down the drop
      const fwd = 0.6 * t + 1.4 * Math.sqrt(t) * Math.min(1, drop / 3), down = drop * t * t * (0.4 + 0.6 * t) + 0.02;
      const bow = Math.sin(u * Math.PI) * 0.25;
      pos.push(x + nx * (u - 0.5) * w + dx * (fwd + bow), f.top + 0.05 - down * (1 + 0.04 * Math.sin(u * 17 + k)), z + nz * (u - 0.5) * w + dz * (fwd + bow));
      fa.push(u, t);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFall', new THREE.Float32BufferAttribute(fa, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uSeed: { value: k * 7.3 } }, vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    group.add(m);
  }
  // ---- the rocks: one worn boulder shape, each copy squashed, turned and sized its own way
  const rocks = J.rocks ?? [];
  if (rocks.length) {
    // (detail: 3 in the full look - 1,280 triangles a boulder; a lighter machine's has 320 or 80: hardware.js)
    const geo = new THREE.IcosahedronGeometry(1, detail), P = geo.attributes.position, v = new THREE.Vector3();
    const hsh = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const r = 1 + 0.18 * (hsh(Math.round(v.x * 3), Math.round(v.y * 3), Math.round(v.z * 3)) - 0.5) + 0.08 * Math.sin(v.x * 5 + v.z * 3);
      v.multiplyScalar(r); v.y *= v.y < 0 ? 0.5 : 0.75;
      P.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    // (their faces: the rock skin, the 2k rock tile from three sides at two sizes, its relief and moss: rockskin.js)
    const mat = rockSkin(new THREE.MeshStandardMaterial({ color: 0xb4ada4, roughness: 0.9, metalness: 0 }), { base, kind: 'granite', moss: 0.5 });
    receiveSun(mat, U);
    // (the rocks of each 600 m of the land together, so those out of the view or out of reach are not drawn: they had
    // been one piece the whole river long, 41,000 triangles sent every frame from anywhere - measured 11 Nov 2026)
    const cells = new Map();
    for (const r of rocks) { const k = Math.floor(r[0] / 600) + ',' + Math.floor(r[1] / 600); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(r); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [k, list] of cells) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, size, lvl], i) => {
        const r1 = hsh(x, z, 1), r2 = hsh(z, x, 2), r3 = hsh(x + z, 3, 4);
        const ground = world.heightAt(x, z), y = Math.max(ground, lvl - size * 0.9) + size * 0.15;
        e.set((r1 - 0.5) * 0.5, r2 * Math.PI * 2, (r3 - 0.5) * 0.5); q.setFromEuler(e);
        s.set(size * (0.8 + 0.5 * r1), size * (0.6 + 0.4 * r2), size * (0.8 + 0.5 * r3));
        inst.setMatrixAt(i, m4.compose(p.set(x, y, z), q, s));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.name = 'rocks@' + k;
      group.add(inst);
    }
  }
  return group;
}
