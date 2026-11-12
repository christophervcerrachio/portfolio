// The Moscow Kremlin, 1:1: its twenty towers each built to its own measurements (dev\world\kremlin\towers.py,
// landmark-models), stood where they stand, fitted to the 1836 plate's Kremlin; and the wall between them, red brick
// with its swallow-tail merlons and the wall walk, built here along the ring. Textures: ComfyUI's tiles of the Kremlin's
// brick and white stone (detail-pass).
import * as THREE from 'three';
import { arrive } from './arrive.js';
import { gltfLoader } from '../gltf.js';
import { loadPicture } from '../texcap.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';
import { lightCopies, standAt } from './citymarks.js';
import { placeRing, depthIn } from './plans.js';

const DIR = 'assets/world/landmarks/';
// (where the wall is high: along Red Square, the east side, it stands to 19 m; along the river and the garden, lower)
const WALL = { h: 12.0, hRed: 17.0, thick: 4.5, merlon: { w: 2.0, h: 2.4, t: 0.7, gap: 1.9, notch: 0.75 } };
const RED_SQUARE = new Set(['konstantino-eleninskaya', 'nabatnaya', 'tsarskaya', 'spasskaya', 'senatskaya', 'nikolskaya', 'corner-arsenalnaya']);

function tileTex(base, name, rep) {
  const t = loadPicture(base + DIR + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  if (rep) t.repeat.set(rep, rep);
  return t;
}

/** A swallow-tail merlon, 1 m across, its notch cut from the top: extruded (x across, y up, z through the wall). */
function merlonGeometry(M) {
  const s = new THREE.Shape(), w = M.w / 2, n = M.notch;
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, M.h); s.lineTo(w * 0.22, M.h - n * 0.15); s.lineTo(0, M.h - n);
  s.lineTo(-w * 0.22, M.h - n * 0.15); s.lineTo(-w, M.h); s.lineTo(-w, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: M.t, bevelEnabled: false });
  g.translate(0, 0, -M.t / 2);
  // (texture coordinates in metres, as the wall's)
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) / 2, p.getY(i) / 2);
  return g;
}

const stem = (glb) => glb.replace(/\.glb$/, '');
/** The Kremlin's own measures from its list (kremlin.json, read as the walk loads): the ring's middle, each tower's
 *  turn (its front, its own +z, out from the middle) and outline where it stands, and the wall's spans. A span runs
 *  from inside one tower's side to inside the next one's - its end face, 4.5 m across, a hand or more inside the
 *  tower's own outline (plans.json), found by walking out from the tower's middle: the wall had been cut 4.5 m from
 *  each tower's middle whatever the tower's size and turn, and stood 0.3 to 2.7 m short of eleven of them (measured
 *  12 Nov 2026, dev\world\world_audit.py) - and its merlons begin where it comes out of the tower. */
export function kremlinPlan(K, shapes = {}) {
  const T = K.world.towers, ring = T.filter((t) => !t.outside);
  const cx = ring.reduce((a, r) => a + r.x, 0) / ring.length, cz = ring.reduce((a, r) => a + r.z, 0) / ring.length;
  // (a tower stands square to the wall that runs through it: its front - its own +z, and the way through a gate
  // tower - along the wall's own outward normal there, the normal of the line from the tower before it to the tower
  // after. Each had been turned to look straight out from the Kremlin's middle, whatever way its wall ran: at the
  // Nikolskaya the wall came into the tower's corner at 45 degrees, and when the gate towers were given their ways
  // through (12 Nov 2026) the wall lay across them. The Kutafya, outside the ring: in line with the Troitskaya's gate)
  const outward = (t) => {
    const i = ring.indexOf(t);
    if (i < 0) { const tr = ring.find((r) => r.name === 'troitskaya'); return tr ? Math.atan2(t.x - tr.x, t.z - tr.z) : Math.atan2(t.x - cx, t.z - cz); }
    const p = ring[(i - 1 + ring.length) % ring.length], n = ring[(i + 1) % ring.length];
    let nx = -(n.z - p.z), nz = n.x - p.x;
    if ((t.x - cx) * nx + (t.z - cz) * nz < 0) { nx = -nx; nz = -nz; }
    return Math.atan2(nx, nz);
  };
  const towers = T.map((t) => {
    const yaw = outward(t), sh = shapes[stem(t.glb)];
    return { t, yaw, shape: sh, rings: sh ? sh.rings.map((r) => placeRing(r, t.x, t.z, yaw, 1)) : [] };
  });
  const by = new Map(towers.map((o) => [o.t.name, o]));
  const th = WALL.thick, spans = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    // (from a tower's middle along the wall: how far the wall's whole end face is still 0.25 m inside the tower, and
    // where its middle line comes out of the tower)
    const reach = (tw, px, pz, sx, sz) => {
      const R = by.get(tw.name)?.rings ?? [];
      if (!R.length) return [4.5, 4.5];
      const face = (s, m) => [-th / 2, 0, th / 2].every((o) => depthIn(R, [], px + sx * s + nx * o, pz + sz * s + nz * o) >= m);
      let inS = 0, midS = 0, outS = 0;
      for (let s = 0; s <= 14; s += 0.1) {
        if (face(s, 0.25)) inS = s;
        if (depthIn(R, [], px + sx * s, pz + sz * s) >= 0.25) midS = s;
        if (depthIn(R, [], px + sx * s, pz + sz * s) > -0.05 || [-th / 2, th / 2].some((o) => depthIn(R, [], px + sx * s + nx * o, pz + sz * s + nz * o) > -0.05)) outS = s;
      }
      // (a gate tower is two piers with its way between them: the wall never comes on into the way - where its whole
      // end face finds no room in the pier, it ends with its middle line a hand inside the pier's side)
      if (R.length > 1 && inS === 0) inS = midS;
      return [inS, outS + 0.1];
    };
    const [a0, aOut] = reach(a, a.x, a.z, ux, uz), [b0, bOut] = reach(b, b.x, b.z, -ux, -uz);
    spans.push({ a, b, L, ux, uz, nx, nz, s0: a0, s1: L - b0, m0: aOut, m1: L - bOut, high: RED_SQUARE.has(a.name) && RED_SQUARE.has(b.name) });
  }
  return { cx, cz, ring, towers, spans };
}
/** The Kremlin into the world's outlines (plans.js): its towers, its palaces and cathedrals, each span of its wall. */
export function planKremlin(plans, shapes, K) {
  const P = kremlinPlan(K, shapes), th = WALL.thick;
  for (const o of P.towers) if (o.rings.length) plans.add('kremlin:' + o.t.name, o.rings, [], { group: 'kremlin', h: o.shape.height ?? 30 });
  for (const b of K.world.buildings ?? []) plans.addShape('kremlin:' + b.name, shapes[stem(b.glb)], b.x, b.z, b.yaw ?? 0, 1, { group: 'kremlin' });
  P.spans.forEach((sp, i) => {
    const c = (s, o) => [sp.a.x + sp.ux * s + sp.nx * o, sp.a.z + sp.uz * s + sp.nz * o];
    plans.add('kremlin:wall#' + i, [[c(sp.s0, -th / 2), c(sp.s1, -th / 2), c(sp.s1, th / 2), c(sp.s0, th / 2)]], [], { group: 'kremlin', h: sp.high ? WALL.hRed : WALL.h });
  });
  return P;
}

/** world: loadWorld()'s (heightAt). K: kremlin.json, already read (else it is fetched); shapes: plans.json. Returns a
 *  group; its towers load as they come. */
export function buildKremlin(world, U, { base = '', light = false, K: K0 = null, shapes = {} } = {}) {
  const group = new THREE.Group(); group.name = 'kremlin';
  const solid = []; group.userData.solid = solid;
  let asked = false, start = null;
  group.userData.load = () => { if (asked) return; asked = true; start?.(); };
  // (light: a machine that draws the walk as an older console did reads the palaces' and cathedrals' light copies,
  // never the full models, and no stone in relief - citymarks.js lightCopies, hardware.js marks)
  Promise.all([K0 ?? fetch(base + DIR + 'kremlin.json').then((r) => r.json()), light ? lightCopies(base) : {}]).then(([K, LIGHT]) => {
    const T = K.world.towers, ring = T.filter((t) => !t.outside), KP = kremlinPlan(K, shapes);
    // (the bricks stand proud of their pale mortar: parallax, the mortar the lighter part; texture coordinates in half metres)
    const brick = receiveSun(parallax(new THREE.MeshStandardMaterial({ map: tileTex(base, 'kremlin-brick.jpg'), normalMap: tileTex(base, 'kremlin-brick_n.png'), roughness: 0.92, metalness: 0 }), { depth: 0.018, invert: true, scale: 2 }), U);
    const ground = (x, z) => world.heightAt(x, z);
    // (the ground inside the wall, and Red Square outside it from the Nikolskaya to the Konstantino-Eleninskaya tower,
    // 130 m out to take in St Basil's: paved in setts by the land's shader, terrain.js paved())
    const WU = world.uniforms;
    if (WU.uKrem) {
      ring.slice(0, 20).forEach((t, i) => WU.uKrem.value[i].set(t.x, t.z)); WU.uKremN.value = Math.min(20, ring.length);
      const a = T.find((t) => t.name === 'nikolskaya'), b = T.find((t) => t.name === 'konstantino-eleninskaya');
      if (a && b) {
        const cx = ring.reduce((s, r) => s + r.x, 0) / ring.length, cz = ring.reduce((s, r) => s + r.z, 0) / ring.length;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
        let nx = -uz, nz = ux; if (nx * (a.x - cx) + nz * (a.z - cz) < 0) { nx = -nx; nz = -nz; }
        const a0 = [a.x - ux * 40, a.z - uz * 40], b0 = [b.x + ux * 25, b.z + uz * 25], O = 130;
        WU.uRed.value[0].set(...a0); WU.uRed.value[1].set(...b0); WU.uRed.value[2].set(b0[0] + nx * O, b0[1] + nz * O); WU.uRed.value[3].set(a0[0] + nx * O, a0[1] + nz * O);
      }
    }
    // ---- the towers and the buildings: asked for once the walk is shown (group.userData.load, countryside.js
    // loadRest), so the first view's files have the line to themselves
    const models = () => {
    for (const t of T) {
      gltfLoader().loadAsync(base + DIR + t.glb).then((g) => {
        const m = g.scene;
        m.traverse((o) => {
          if (!o.isMesh) return;
          o.material.side = THREE.FrontSide;
          // (the brick and the white stone in relief: landmarks.py lays its tiles 2 m to a unit of texture coordinate)
          const nm = (o.material.name || '').toLowerCase();
          if (light) { /* plain */ }
          else if (o.material.map && /brick|white/.test(nm)) parallax(o.material, { depth: nm.includes('brick') ? 0.018 : 0.01, invert: nm.includes('brick'), scale: 2 });
          else if (o.material.map && /tent/.test(nm)) parallax(o.material, { depth: 0.02, scale: 1.5 });
          receiveSun(o.material, U);
        });
        // square to its wall, its front (the model's +z) out (kremlinPlan), standing by its own outline (standAt)
        m.rotation.y = KP.towers.find((o) => o.t === t)?.yaw ?? Math.atan2(t.x - KP.cx, t.z - KP.cz);
        m.position.set(t.x, standAt(world, shapes[stem(t.glb)], { x: t.x, z: t.z, yaw: m.rotation.y }), t.z);
        m.name = 'kremlin-' + t.name;
        arrive(m, { parent: group });                    // (rises in its place when it is in: arrive.js)
      }).catch(() => {});
    }
    // ---- the buildings inside, and St Basil's on Red Square (dev\world\kremlin\inner.py, landmark-models, built in
    // Blender): each where it stands, turned as it stands; the walker goes round them (circles along each one's plan)
    for (const b of K.world.buildings ?? []) {
      const file = LIGHT[b.glb.replace(/\.glb$/, '')] !== undefined ? b.glb.replace(/\.glb$/, '.lod.glb') : b.glb;
      gltfLoader().loadAsync(base + DIR + file).then((g) => {
        const m = g.scene;
        m.traverse((o) => {
          if (!o.isMesh) return;
          o.material.side = THREE.FrontSide;
          const nm = (o.material.name || '').toLowerCase();
          if (light) { /* plain */ }
          else if (o.material.map && /brick/.test(nm)) parallax(o.material, { depth: 0.018, invert: true, scale: 2 });
          else if (o.material.map && /white/.test(nm)) parallax(o.material, { depth: 0.01, scale: 2 });
          // (gilt, sheet metal and glass catch the sky)
          if (o.material.metalness > 0.5) { o.material.metalness = 0.72; o.material.envMapIntensity = 2.4; }   // (gilt: still bright gold where the sky it reflects is dim)
          else if (o.material.roughness < 0.2) o.material.envMapIntensity = 1.6;
          receiveSun(o.material, U);
        });
        m.rotation.y = b.yaw;
        m.position.set(b.x, standAt(world, shapes[stem(b.glb)], b), b.z);
        m.name = 'kremlin-' + b.name;
        m.updateMatrixWorld(true);
        arrive(m, { parent: group });
      }).catch(() => {});
    }
    };
    if (asked) models(); else start = models;
    // ---- the wall: from each tower to the next round the ring, a body of brick, the wall walk, merlons on both edges
    const pos = [], uv = [], idx = [], mer = [];
    const M = WALL.merlon, mGeo = merlonGeometry(M);
    for (const sp of KP.spans) {
      const { a, L, ux, uz, nx, nz } = sp;
      const H = sp.high ? WALL.hRed : WALL.h, th = WALL.thick;
      // (from inside one tower's side to inside the next one's: kremlinPlan)
      const s0 = sp.s0, s1 = sp.s1, steps = Math.max(1, Math.ceil((s1 - s0) / 6));
      const base0 = pos.length / 3;
      for (let k = 0; k <= steps; k++) {
        const s = s0 + (s1 - s0) * k / steps, x = a.x + ux * s, z = a.z + uz * s, y0 = ground(x, z) - 1.0;
        for (const [side, top] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
          const px = x + nx * side * th / 2, pz = z + nz * side * th / 2;
          pos.push(px, top ? y0 + 1.0 + H : y0, pz); uv.push(s / 2, top ? (H + 1) / 2 : 0);
        }
        // merlons along both edges, every gap
      }
      for (let k = 0; k < steps; k++) {
        const r = base0 + k * 4, q = r + 4;
        idx.push(r, q, r + 2, q, q + 2, r + 2);           // (one face)
        idx.push(r + 1, r + 3, q + 1, q + 1, r + 3, q + 3); // (the other)
        idx.push(r + 2, q + 2, r + 3, q + 2, q + 3, r + 3); // (the top: the wall walk)
      }
      // (each merlon on the wall walk itself: the walk runs straight from one station of the wall to the next)
      const topAt = (s) => { const f = Math.max(0, Math.min(steps - 1e-6, (s - s0) / (s1 - s0) * steps)), k = Math.floor(f); return pos[(base0 + k * 4 + 2) * 3 + 1] * (1 - (f - k)) + pos[(base0 + (k + 1) * 4 + 2) * 3 + 1] * (f - k); };
      for (let s = sp.m0 + M.w * 0.6; s < sp.m1 - M.w / 2; s += M.w + M.gap) {
        const x = a.x + ux * s, z = a.z + uz * s, y = topAt(s);
        for (const side of [-1, 1]) mer.push([x + nx * side * (th / 2 - M.t / 2), y, z + nz * side * (th / 2 - M.t / 2), Math.atan2(ux, uz)]);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wg.setIndex(idx); wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, brick); wall.name = 'kremlin-wall';
    brick.side = THREE.DoubleSide;
    const mi = new THREE.InstancedMesh(mGeo, brick, mer.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    mer.forEach(([x, y, z, yaw], i) => mi.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1))));
    mi.instanceMatrix.needsUpdate = true; mi.name = 'kremlin-merlons';
    // (the wall and its merlons together, all round the ring)
    arrive([wall, mi], { parent: group });
  }).catch(() => {});
  return group;
}
