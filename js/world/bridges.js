// The country bridges: wherever a footpath, track or road runs into water, a heavy timber bridge of the Russian
// countryside of the 1830s carries it over, humped from bank to bank. Its parts are built in Blender
// (dev/world/bridge_kit.py, assets/world/bridges/*.glb) and laid along each crossing here: deck sections of thick
// planks on big log stringers with curb logs and a parapet of squared, braced posts and log rails; crib piers (log
// cribs filled with field stone) stacked from the bed, each with a squared cap beam, and an icebreaker of sloping logs
// on its upstream end (the flow from terrain.js flowAt). Wood: ComfyUI's tiles, through the detail pass (log-weathered,
// timber-hewn), in relief (parallax.js). The way's own run is found from the ways themselves (paths.js), the water from
// the world (terrain.js waterAt). deckAt(x, z) gives the walker the deck's height on a bridge.
import * as THREE from 'three';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';
import { arrive } from './arrive.js';
import { gltfLoader } from '../gltf.js';
import { loadPicture } from '../texcap.js';

// (the deck's line: an arch from bank to bank, as the old timber bridges were built, humped over the water: the rise
// enough to clear it in the middle, never less than a camber of 1/14 of the span, at most 7 m)
function archY(ya, yb, level, Ls, s) {
  const t = Math.min(1, Math.max(0, s / Ls)), base = ya + (yb - ya) * t;
  const need = level + 1.0 + Ls * 0.02 - (ya + yb) / 2;
  const rise = Math.min(7, Math.max(Ls / 14, need, 0.6));
  return base + rise * 4 * t * (1 - t);
}

// (the kit's deck for each way: a footbridge 2 m between its rails, a cart bridge 4.2 m, a road's stretched to 6 m;
// drop: deck top to the stringers' underside, where the piers' caps stand)
const KIND = { foot: { w: 2.0, kit: '2', drop: 0.38, pier: 5.5 }, track: { w: 4.2, kit: '4.2', drop: 0.47, pier: 6.5 }, road: { w: 6.0, kit: '4.2', drop: 0.47, pier: 6.5 } };
const KIT = { w: { '2': 2.0, '4.2': 4.2 }, crib: { A: 3.6, B: 2.4, h: 0.6 }, capDrop: 0.52 };

/** The stretches of each way over water: [{ kind, a: [x, z], b: [x, z], level, w, rail }]. */
function crossings(world) {
  const out = [];
  for (const w of world.ways?.ways ?? []) {
    const K = KIND[w.kind];
    if (!K) continue;
    let inside = null, last = null;
    const wet = (x, z) => { const s = world.waterAt(x, z); return s !== null && s - world.landAt(x, z) > 0.15 ? s : null; };
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, s = wet(x, z);
        if (s !== null && !inside) inside = { start: last ?? [x, z], level: s };
        else if (s !== null) inside.level = Math.max(inside.level, s);
        else if (inside) {
          const [sx, sz] = inside.start, d = Math.hypot(x - sx, z - sz);
          if (d > 3 && d < 400) {
            // (the bridge reaches a little onto either bank)
            const ux = (x - sx) / d, uz = (z - sz) / d;
            out.push({ kind: w.kind, a: [sx - ux * 2.5, sz - uz * 2.5], b: [x + ux * 2.5, z + uz * 2.5], level: inside.level, ...K });
          }
          inside = null;
        }
        last = [x, z];
      }
    }
  }
  return out;
}

export function buildBridges(world, U, { base = '', stonesTo = Infinity } = {}) {
  const group = new THREE.Group(); group.name = 'bridges';
  const B = crossings(world);
  const dir = base + 'assets/world/bridges/';
  // every part's placings: { module: [Matrix4] }
  // (bridge by bridge: each bridge's parts their own instanced meshes, so one out of view is not drawn - as one mesh
  // for all the world's bridges, every crib of every pier was drawn in every frame, 3 million triangles, and again in
  // each of the sun's pictures: 10 Nov 2026)
  const P = {}; let bi = 0;
  const put = (mod, m) => (((P[mod] ??= [])[bi] ??= [])).push(m);
  const up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(1, 0, 0);
  const place = (x, y, z, yaw, pitch, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(up, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(ax, -pitch)), new THREE.Vector3(sx, sy, sz));
  const decks = [];
  for (const b of B) {
    bi = decks.length;
    const [ax0, az0] = b.a, [bx, bz] = b.b, Ls = Math.hypot(bx - ax0, bz - az0), ux = (bx - ax0) / Ls, uz = (bz - az0) / Ls;
    const ya = world.heightAt(ax0, az0), yb = world.heightAt(bx, bz), Y = (q) => archY(ya, yb, b.level, Ls, q);
    const yaw = Math.atan2(ux, uz), lx = [uz, -ux];         // (the part's +x across the bridge, in the world)
    decks.push({ ...b, ux, uz, Ls });
    // the deck: 2 m sections of the kit, each laid along its own chord of the arch
    const n = Math.max(1, Math.round(Ls / 2)), kw = KIT.w[b.kit];
    for (let k = 0; k < n; k++) {
      const s0 = Ls * k / n, s1 = Ls * (k + 1) / n, y0 = Y(s0), y1 = Y(s1), ds = s1 - s0;
      const m = (s0 + s1) / 2;
      put('deck-' + b.kit, place(ax0 + ux * m, (y0 + y1) / 2, az0 + uz * m, yaw, Math.atan2(y1 - y0, ds), b.w / kw, 1, Math.hypot(ds, y1 - y0) / 2));
    }
    // the piers: a crib every few metres where the bed is under water, stacked from the bed to the cap
    const sx = Math.max(0.5, b.w / kw * (kw > 3 ? 1 : 0.5)), sz = kw > 3 ? 1 : 0.7;
    const cnt = Math.max(1, Math.round(Ls / b.pier));
    for (let k = 1; k < cnt; k++) {
      const s = Ls * k / cnt, x = ax0 + ux * s, z = az0 + uz * s, bed = world.landAt(x, z), capTop = Y(s) - b.drop;
      if (world.waterAt(x, z) === null && capTop - bed < 1.2) continue;
      put('cap', place(x, capTop, z, yaw, 0, b.w / 4.2, 1, sz));
      const top = capTop - KIT.capDrop;
      for (let y = top - KIT.crib.h; y > bed - 0.9; y -= KIT.crib.h) put('crib', place(x, y, z, yaw, 0, sx, 1, sz));
      // the icebreaker on the side the water comes from (both, where it barely moves)
      const [fx, fz] = world.flowAt?.(x, z) ?? [0, 0], along = fx * lx[0] + fz * lx[1];
      // (its logs slope at about 40 degrees from the bed to the cap, however deep: the ridge reaches out as far as it rises)
      const H = top - bed + 0.6, sides = Math.abs(along) < 0.05 ? [-1, 1] : [-Math.sign(along)];
      for (const sd of sides) {
        const off = KIT.crib.A * sx / 2 + 0.15;
        put('icebreaker', place(x + lx[0] * sd * off, bed - 0.6, z + lx[1] * sd * off, yaw + sd * Math.PI / 2, 0, sz, H, Math.max(0.8, H * 0.75)));
      }
    }
  }
  // the kit: one instanced mesh for each part and each of its materials, bridge by bridge. A bridge comes in whole once
  // its kit is in - deck, piers and icebreakers together - and rises out of the river in its place (arrive.js)
  const FILES = { 'deck-4.2': 'bridge-deck-4.2.glb', 'deck-2': 'bridge-deck-2.glb', crib: 'bridge-crib.glb', cap: 'bridge-cap.glb', icebreaker: 'bridge-icebreaker.glb' };
  const parts = decks.map(() => []);                   // (each bridge's meshes, as the files come)
  // (its pictures and its kit asked for once the walk is shown - group.userData.load, countryside.js loadRest: the
  // first view's files have the line to themselves)
  let asked = false;
  group.userData.load = () => {
  if (asked) return;
  asked = true;
  // (each picture read once: the logs and the planks are the same timber, and had each read and sent their own copy)
  const TEX = new Map();
  const tex = (f, srgb, rep = 1) => {
    const k = f + '|' + srgb + '|' + rep; let t = TEX.get(k);
    if (!t) { t = loadPicture(dir + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.repeat.set(rep, rep); TEX.set(k, t); }
    return t;
  };
  // (texture coordinates in metres from the kit: one tile of log-weathered covers 1.6 m, timber-hewn 1.4 m)
  // (a little darker than the photograph's sunlit grey: old timber over water, damp underneath)
  const wood = (name, tile, depth, tint = 0xd2cabe) => receiveSun(parallax(new THREE.MeshStandardMaterial({ map: tex(name + '.jpg', true, 1 / tile), normalMap: tex(name + '_n.png', false, 1 / tile), color: tint, roughness: 0.92, metalness: 0 }), { depth, scale: tile }), U);
  const MAT = {
    log: wood('log-weathered', 1.6, 0.012, 0xb4ab9e),
    planks: wood('log-weathered', 1.6, 0.01),
    timber: wood('timber-hewn', 1.4, 0.012),
    stone: receiveSun(new THREE.MeshStandardMaterial({ map: Object.assign(loadPicture(base + 'assets/world/ground/rock-granite-2k.jpg'), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.SRGBColorSpace }), color: 0xb8b2a8, roughness: 0.95, metalness: 0 }), U),
  };
  Promise.all(Object.entries(FILES).map(([mod, file]) => {
    const per = P[mod];
    if (!per?.length) return null;
    return gltfLoader().loadAsync(dir + file).then((g) => {
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const name = (o.material.name || '').replace(/\.\d+$/, '');
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        // (a crib's filling of field stone is 3,200 triangles, a crib every 0.6 m of every pier's height: 0.7 million
        // triangles for the four bridges seen from one Moscow street, 11 Nov 2026. Past `stonesTo` m - a tier's own,
        // hardware.js cribStones - a pier's stones are one plain block of the same stone inside the logs, which is
        // all that can be told of them from there: farcull.js drawTo / drawFrom)
        let block = null;
        if (mod === 'crib' && name === 'stone' && stonesTo < Infinity) {
          geo.computeBoundingBox();
          const bb = geo.boundingBox, sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
          block = new THREE.BoxGeometry(sz.x * 0.94, sz.y, sz.z * 0.94).translate(c.x, c.y, c.z);
        }
        per.forEach((ms, k) => {
          if (!ms?.length) return;
          const make = (g, nm) => {
            const im = new THREE.InstancedMesh(g, MAT[name] ?? MAT.timber, ms.length);
            ms.forEach((m, i) => im.setMatrixAt(i, m));
            im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
            im.name = nm; im.castShadow = im.receiveShadow = true;
            im.matrixAutoUpdate = false;
            parts[k].push(im);
            return im;
          };
          const im = make(geo, 'bridge-' + mod + '-' + name);
          if (block) { im.userData.drawTo = stonesTo; const far = make(block, 'bridge-crib-block'); far.userData.drawFrom = stonesTo; far.visible = false; }
        });
      });
    }).catch((e) => console.warn('bridges: ' + file, e));
  })).then(() => {
    parts.forEach((list, k) => { if (list.length) arrive(list, { parent: group, x: (decks[k].a[0] + decks[k].b[0]) / 2, z: (decks[k].a[1] + decks[k].b[1]) / 2 }); });
  });
  };
  // the walker on a bridge: the deck's height there, or null
  group.userData.deckAt = (x, z) => {
    for (const d of decks) {
      const rx = x - d.a[0], rz = z - d.a[1], s = rx * d.ux + rz * d.uz, c = Math.abs(rx * -d.uz + rz * d.ux);
      if (s < 0 || s > d.Ls || c > d.w / 2) continue;
      const ya = world.heightAt(d.a[0], d.a[1]), yb = world.heightAt(d.b[0], d.b[1]);
      return archY(ya, yb, d.level, d.Ls, s);
    }
    return null;
  };
  group.userData.count = B.length;
  return group;
}
