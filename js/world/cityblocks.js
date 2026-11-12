// The two cities' blocks of houses (the plan's stage C): every block the 1830s plates hatch between their streets,
// canals and squares, built in Blender as a ring of houses round its courtyard (dev\world\cityblocks.py reads the
// plates, dev\world\city_blender.py builds them): house fronts from ComfyUI (through the detail pass), three storeys in
// Petersburg's centre, two in Moscow's, a colour to each house, the painted iron roofs; and the granite embankments of
// both cities' rivers and canals (dev\world\canals.py), their parapets in the walker's picture. The houses come a 400 m
// tile at a time (citytiles.js): only the tiles near the walker are in memory, the rest of the city plain boxes.
// userData.builtAt(x, z): whether a house stands there (assets/world/cities/<city>-built.png, 2 m a pixel), for the
// walker, who goes along the streets and into the courtyards' gates no further than their walls.
import * as THREE from 'three';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';
import { interiors } from './interiors.js';
import { buildFacadeRelief, CUT, reliefReach } from './facaderelief.js';
import { gate, allowed, loadInTurn } from './reveal.js';
import { tileStream, farBoxes } from './citytiles.js';
import { gltfLoader } from '../gltf.js';
import { DefaultLoadingManager as LM } from 'three';

const DIR = 'assets/world/cities/';

export function buildCityBlocks(U, { base = '', cities = ['spb', 'moscow'], extras = ['spb-embankments.glb', 'moscow-embankments.glb'], far = Infinity, relief: reliefNear = 380, tiles = 1200, changed = null, heightAt = null } = {}) {
  reliefReach(reliefNear);
  const pieces = [];                     // (each tile's object and its middle: drawn within `far` m, the machine's setting)
  const group = new THREE.Group(); group.name = 'cityblocks';
  const masks = [];
  // (the fronts' relief near the camera - window surrounds, sills, cornices, string courses - in the houses' own front
  // materials: facaderelief.js)
  const MATS = {};
  const relief = buildFacadeRelief(U, { base, cities, materials: (name) => MATS[name], near: reliefNear, heightAt });
  group.add(relief);
  // (and a step clear of every wall near: the walls themselves, exact - facaderelief.js push)
  group.userData.wallPush = (x, z, r) => relief.userData.push(x, z, r);
  group.userData.builtAt = (x, z) => {
    for (const m of masks) {
      const i = Math.floor((x - m.x0) / m.cell), j = Math.floor((z - m.z0) / m.cell);
      if (i >= 0 && j >= 0 && i < m.nx && j < m.nz) return m.px[j * m.nx + i] > 127;
    }
    return false;
  };
  // The houses a 400 m tile at a time (citytiles.js): each tile's file read when the walker comes within `tiles` m of
  // it and let go behind him, its materials taken by name from the city's library (<city>-materials.glb: the pictures,
  // once); beyond the tiles read in, every house a plain coloured box (<city>-tiles/far.glb).
  const dress = (m) => {
    if (m.userData.dressed) return;
    m.userData.dressed = true;
    m.side = THREE.FrontSide;
    m.roughness = Math.max(0.75, m.roughness ?? 0.85);
    m.metalness = 0;
    if (m.map) m.map.anisotropy = 4;
    if (m.map && /granite/.test((m.name || '').toLowerCase())) parallax(m, { depth: 0.012, scale: 2.774 });
    // (a house front: rooms behind its windows - interiors.js)
    { const nm = m.name || ''; if (m.map && /^front-/.test(nm)) { interiors(m, 'facade-' + nm.slice(6), { base, cut: CUT, sky: U }); MATS[nm] ??= m; } }
    receiveSun(m, U);
  };
  const streams = [], fars = [];
  for (const city of cities) {
    const url = base + DIR + city + '-materials.glb';
    LM.itemStart(url);
    const library = gltfLoader().loadAsync(url).then((g) => {
      const lib = new Map();
      g.scene.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.name && !lib.has(m.name)) { dress(m); lib.set(m.name, m); } });
      // (the library's own small triangles stay in the group, hidden: the walk makes every material's shaders from
      // them before the first tile is drawn - walk.js later)
      g.scene.name = 'library-' + city; g.scene.visible = false; g.scene.traverse((o) => { o.frustumCulled = false; o.userData.noCast = true; });
      group.add(g.scene);
      return lib;
    }).catch(() => new Map()).finally(() => LM.itemEnd(url));
    const st = tileStream({ base, city, kind: 'h', near: tiles, group, library, changed });
    streams.push(st);
    fars.push(farBoxes({ base, city, group, far, inTile: (key) => st.shown(key), dress: (m) => receiveSun(m, U) }));
  }
  group.userData.streams = streams;
  for (const file of extras) loadOne(file);
  function loadOne(file) {
    loadInTurn(base + DIR + file).then((g) => {
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        dress(o.material);
        o.geometry.computeBoundingSphere();
        const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        // (shown first when the gate lets it, nearest first and a few MB a frame: reveal.js)
        gate(o, c.x, c.z); o.visible = false;
        pieces.push({ o, x: c.x, z: c.z, r: o.geometry.boundingSphere.radius });
      });
      g.scene.name = 'cityblocks-' + file;
      group.add(g.scene);
    }).catch(() => {});
  }
  for (const city of cities) {
    Promise.all([fetch(base + DIR + city + '-blocks.grid.json').then((r) => r.json()), new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = base + DIR + city + '-built.png';
    })]).then(([G, img]) => {
      const c = document.createElement('canvas'); c.width = G.nx; c.height = G.nz;
      const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(img, 0, 0);
      const d = g2.getImageData(0, 0, G.nx, G.nz).data, px = new Uint8Array(G.nx * G.nz);
      for (let k = 0; k < px.length; k++) px[k] = d[k * 4];
      masks.push({ ...G, px });
    }).catch(() => {});
  }
  // (on a slower machine the houses past `far` are not drawn: hardware.js)
  group.userData.update = (pos) => {
    relief.userData.update(pos);
    for (const st of streams) st.update(pos);
    for (const f of fars) f.update(pos);
    for (const p of pieces) {
      const want = far === Infinity || Math.hypot(p.x - pos.x, p.z - pos.z) - p.r < far;
      p.o.visible = p.o.userData.gate ? allowed(p.o, want) : want;
    }
  };
  return group;
}
