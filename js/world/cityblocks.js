// The two cities' blocks of houses (the plan's stage C): every block the 1830s plates hatch between their streets,
// canals and squares, built in Blender as a ring of houses round its courtyard (dev\world\cityblocks.py reads the
// plates, dev\world\city_blender.py builds them): house fronts from ComfyUI (through the detail pass), three storeys in
// Petersburg's centre, two in Moscow's, a colour to each house, the painted iron roofs; and the granite embankments of
// both cities' rivers and canals (dev\world\canals.py), their parapets in the walker's picture. The houses come a 400 m
// tile at a time (citytiles.js), every tile of both cities read under the loading picture and kept.
// userData.builtAt(x, z): whether a house stands there (assets/world/cities/<city>-built.png, 2 m a pixel), for the
// walker, who goes along the streets and into the courtyards' gates no further than their walls.
import * as THREE from 'three';
import { receiveSun } from '../backdrops/sunshadow.js';
import { parallax } from './parallax.js';
import { interiors } from './interiors.js';
import { openings } from './openings.js';
import { styleNow } from '../retro.js';
import { buildFacadeRelief, CUT, reliefReach } from './facaderelief.js';
import { gate, allowed, loadInTurn } from './reveal.js';
import { tileStream } from './citytiles.js';
import { gltfLoader } from '../gltf.js';
import { DefaultLoadingManager as LM } from 'three';

const DIR = 'assets/world/cities/';

/** A picture's red channel as { w, h, px }, decoded in a worker (pixels-worker.js), or here where no worker can be made. */
export function readChannel(url, channel = 0) {
  const here = () => new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data, px = new Uint8Array(img.width * img.height);
      for (let k = 0; k < px.length; k++) px[k] = d[k * 4 + channel];
      res({ w: img.width, h: img.height, px });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return here();
  return new Promise((res) => {
    let w;
    try { w = new Worker(new URL('./pixels-worker.js', import.meta.url)); } catch { here().then(res); return; }
    w.onmessage = (e) => { w.terminate(); if (e.data?.error) here().then(res); else res(e.data); };
    w.onerror = () => { w.terminate(); here().then(res); };
    w.postMessage({ url: new URL(url, location.href).href, channel });
  });
}

export function buildCityBlocks(U, { base = '', cities = ['spb', 'moscow'], extras = ['spb-embankments.glb', 'spb-embankments-joints.glb', 'moscow-embankments.glb'], far = Infinity, relief: reliefNear = 380, tiles = 1200, changed = null, heightAt = null, ground = null, merge = 0 } = {}) {
  reliefReach(reliefNear);
  // (the relief built farther out than it is drawn - RELIEF_AHEAD m: a street's mouldings and open windows are made
  // before they come into the view, never made as it comes on them; facaderelief.js)
  const RELIEF_AHEAD = 220;
  const pieces = [];                     // (each tile's object and its middle: drawn within `far` m, the machine's setting)
  const group = new THREE.Group(); group.name = 'cityblocks';
  const masks = [];
  // (the fronts' relief near the camera - window surrounds, sills, cornices, string courses - in the houses' own front
  // materials: facaderelief.js)
  const MATS = {};
  const streams = [];
  // (a tile's relief comes in once its houses stand: come in before them, the arches, sills and window boxes of a street
  // whose houses were still rising stood on their own in the air - seen where the walk had put the walker back in a
  // street, 12 Nov 2026. A tile with no houses of its own keeps its relief as it was)
  const housesIn = (city, key) => { const st = streams[cities.indexOf(city)]; return !st || (st.ready && (!st.tiles.has(key) || st.tiles.get(key).state === 3 || st.risen(key))); };
  const relief = buildFacadeRelief(U, { base, cities, materials: (name) => MATS[name], near: reliefNear > 0 ? reliefNear + RELIEF_AHEAD : 0, heightAt, ground, housesIn });
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
  // The houses a 400 m tile at a time (citytiles.js): every tile's file read under the loading picture and kept, its
  // materials taken by name from the city's library (<city>-materials.glb: the pictures, once), each tile drawn
  // within `far` m (the machine's setting: everywhere on the full tiers). The plain coloured boxes that stood beyond
  // the tiles read in (<city>-tiles/far.glb) are no longer read: every house is in.
  const dress = (m) => {
    if (m.userData.dressed) return;
    m.userData.dressed = true;
    m.side = THREE.FrontSide;
    m.roughness = Math.max(0.75, m.roughness ?? 0.85);
    m.metalness = 0;
    if (m.map) m.map.anisotropy = 4;
    if (m.map && /granite/.test((m.name || '').toLowerCase())) parallax(m, { depth: 0.012, scale: 2.774 });
    // (a house front: rooms behind its windows - interiors.js)
    // (and its openings over its wall: the wall's picture is its wall alone, the windows and doors read from a picture of
    // their own - openings.js)
    { const nm = m.name || ''; if (m.map && /^front-/.test(nm)) { interiors(m, 'facade-' + nm.slice(6), { base, cut: CUT, sky: U }); openings(m, 'facade-' + nm.slice(6), { base }); MATS[nm] ??= m; } }
    // (a shopfront: its windows and door openings of their own, holes near the walker where the relief builds them -
    // none at 240 lines, whose relief builds no openings)
    { const nm = m.name || ''; if (m.map && /^shop-/.test(nm)) openings(m, nm, { base, cut: styleNow() && styleNow().lines <= 240 ? 0 : CUT }); }
    receiveSun(m, U, { street: true });
  };
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
    // (each tile rises out of the ground in its place as it comes in, under the loading picture: arrive.js)
    // (and from afar each 1.6 km of them drawn together, where the machine's setting says: supertiles.js)
    streams.push(tileStream({ base, city, kind: 'h', show: far, group, library, changed, merge }));
  }
  group.userData.streams = streams;
  // (what is still to come in: the tiles, the embankments, the relief round the camera - the loading picture waits for
  // all of it: walk.js)
  let extrasLeft = extras.length;
  group.userData.pending = () => streams.reduce((n, st) => n + st.pending(), 0) + extrasLeft + (relief.userData.pending?.() ?? 0);
  for (const file of extras) loadOne(file);
  function loadOne(file) {
    loadInTurn(base + DIR + file).then((g) => {
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        dress(o.material);
        // (its bounds as the file gives them, never summed over its vertices: citytiles.js)
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        // (shown first when the gate lets it, nearest first and a few MB a frame, rising out of the ground: reveal.js)
        gate(o, c.x, c.z, { batch: 'embankments', wave: 2200 }); o.visible = false;
        pieces.push({ o, x: c.x, z: c.z, r: o.geometry.boundingSphere.radius });
      });
      g.scene.name = 'cityblocks-' + file;
      group.add(g.scene);
    }).catch(() => {}).finally(() => { extrasLeft--; });
  }
  // (where each house stands, read off the page's own thread: pixels-worker.js)
  for (const city of cities) {
    Promise.all([fetch(base + DIR + city + '-blocks.grid.json').then((r) => r.json()), readChannel(base + DIR + city + '-built.png')])
      .then(([G, R]) => { if (R && R.w === G.nx && R.h === G.nz) masks.push({ ...G, px: R.px }); }).catch(() => {});
  }
  // (on a slower machine the houses past `far` are not drawn: hardware.js)
  group.userData.update = (pos) => {
    relief.userData.update(pos);
    for (const st of streams) st.update(pos);
    for (const p of pieces) {
      const want = far === Infinity || Math.hypot(p.x - pos.x, p.z - pos.z) - p.r < far;
      p.o.visible = p.o.userData.gate ? allowed(p.o, true) && want : want;   // (asked for wherever it stands)
    }
  };
  return group;
}
