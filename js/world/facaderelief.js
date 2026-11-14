// The house fronts in relief: round every window its surround (architrave) standing 5 cm proud of the wall with its
// sides, a stone sill under it, a cornice along the top of every front and a string course over the ground floor - each
// cut from the front's own picture at its own place, so the moulding painted in the picture is the moulding modelled.
// Built only near the camera, tile by 400 m tile, from the walls city_blender.py lists (<city>-relief/<tile>.json): the
// cities have some 780,000 walls and millions of windows, gigabytes if every one were in the models. The window maps'
// bays and storey bands (windows/bays.json, from dev\world\cities\facade-bays.json) place each window as the houses'
// own walls placed it.
// A front measured to its openings (bays.json 'frames': each window's painted frame inside its hole) has its windows'
// frames as models of their own (fronts/<front>.glb: dev\world\cities\fixtures\frames_blender.py), each set at the back
// of its hole on the glass, stretched to the hole as the picture is; the glass behind is the picture's own window, from
// its painted frame's place, and the hole's sides the picture's own reveal.
import * as THREE from 'three';
import { interiors } from './interiors.js';
import { arrive } from './arrive.js';
import { gltfLoader } from '../gltf.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { styleNow } from '../retro.js';

const DIR = 'assets/world/cities/';
const NEAR = 380;               // (m: the relief is built for the tiles within this of the camera)
const CELL = 200;               // (each tile's relief in cells of 200 m, each drawn while the camera is within SHOW m of its middle: every wall
// within CUT of the camera in a drawn cell)
let SHOW = 320;
const PROUD = 0.08, SILL = 0.15, CORN = 0.35, COURSE = 0.08;
// (each window a hole through the wall near the camera, REC deep, its sides plaster and its glass at the back, the
// rooms seen through it - the wall's own material leaves the hole open within CUT m: interiors.js `cut`)
export const REC = 0.25;
export let CUT = 150;
// (the windows' frames: in cells of FCELL m of their own, each drawn while the camera is within FRAMES_NEAR m of it and
// the holes are open there - farther, a frame is a pixel and the picture's own frame on the glass does as well)
const FCELL = 50, FRAMES_NEAR = 60;
/** The relief's reach for this machine (hardware.js reliefNear): built within `near` m, drawn within a little less, the
 *  windows open as holes within less again. Call before the fronts' materials are made (cityblocks.js). */
export function reliefReach(near) {
  SHOW = Math.min(320, Math.max(60, near - 60)); CUT = Math.min(150, Math.max(40, SHOW - 20));
}

/** An arched opening's head, x0..x1 wide in the picture with its crown at y0, the arch rising `f` of half the width
 *  (1: a half circle): { ys: the row it springs from, pts: [x, y, out x, out y] along it from its left springing to
 *  its right - px of the picture, the last two the way out from the arch's middle }. dev\world\cities\facade-bays.json. */
function archOf(x0, x1, y0, f, n) {
  const a = (x1 - x0) / 2, r = f * a, R = (a * a + r * r) / (2 * r), xc = (x0 + x1) / 2, cy = y0 + R, ph = Math.asin(Math.min(1, a / R));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = -ph + 2 * ph * i / n, sn = Math.sin(t), cs = Math.cos(t); pts.push([xc + R * sn, cy - R * cs, sn, -cs]); }
  return { ys: y0 + r, pts };
}

/** A reveal for a window of a front measured to its holes (bays.json 'frames') whose picture shows none of its own on
 *  that face: the nearest window's of the same storey that shows one, upright as the picture has it. kind 'side': its
 *  strip from the hole's edge at the wall to the frame's at the glass, as [wall's foot, frame's foot, frame's head,
 *  wall's head]; 'head': its soffit, as [wall's left, wall's right, frame's right, frame's left] - px of the picture;
 *  null if none does. */
function borrowed(fb, ci, ry0, ry1, kind = 'side') {
  const cache = (fb._borrowed ??= {}), key = kind + ci;
  if (key in cache) return cache[key];
  const mid = (fb.cols[ci][0] + fb.cols[ci][1]) / 2;
  let best = null, bd = Infinity;
  for (const [y0, y1, cs] of fb.rows) {
    if (y1 < ry0 || y0 > ry1) continue;                       // (another storey)
    for (const c of cs) {
      const g = fb.frames?.[c]; if (!g || c === ci) continue;
      const [x0, x1] = fb.cols[c], d = Math.abs((x0 + x1) / 2 - mid);
      if (d >= bd) continue;
      if (kind === 'head') { if (g[1] - y0 >= 2) { bd = d; best = [[x0, y0], [x1, y0], [g[2], g[1]], [g[0], g[1]]]; } continue; }
      const s = g[0] - x0 >= 2 ? [x0, g[0]] : x1 - g[2] >= 2 ? [x1, g[2]] : null;
      if (s) { bd = d; best = [[s[0], y1], [s[1], g[3]], [s[1], g[1]], [s[0], y0]]; }
    }
  }
  return (cache[key] = best);
}

/** Each front's storey bands from the street up, st storeys high: [[y0 px, y1 px, metres], ...] (city_blender.py bands_for). */
function bandsFor(fb, st, storey) {
  const B = fb.bands;
  let seq;
  if (st <= 1) {
    // (a one-storey wall's top band ends at the front's 'eaves' where it was measured: facade_bays.py)
    const topWin = Math.min(...fb.rows.map((r) => r[0]));
    seq = [B.ground, [B.top[0], fb.eaves ?? Math.max(B.top[0] + 20, topWin - 12)]];
  } else if (st === 2) seq = [B.ground, B.top];
  else { seq = [B.ground]; for (let i = 0; i < st - 2; i++) seq.push(B.mid); seq.push(B.top); }
  const hs = seq.map(([a, b]) => (b - a) * fb.my), k = st * storey / hs.reduce((s, v) => s + v, 0);
  return seq.map(([a, b], i) => [a, b, hs[i] * k]);
}

export function buildFacadeRelief(U, { base = '', cities = ['spb', 'moscow'], materials, near = NEAR, heightAt = null, ground = null, housesIn = null } = {}) {
  // (the steps before the doors are made of the pavements' own stone and planks: the city's ground materials, once
  // cityprops.js has read them into `ground` - { <city>: Map of materials by name })
  const stepMat = (city, timber) => { const L = ground?.[city]; return L ? (timber ? L.get('walk') : null) ?? L.get('kerb') ?? L.get('footway') ?? null : null; };
  // (the glass at the back of each hole: the front's picture of its window, the rooms behind it - interiors.js, flat)
  const GLASS = {};
  const glassMat = (name) => {
    if (GLASS[name]) return GLASS[name];
    const w = materials(name); if (!w) return null;
    const m = new THREE.MeshStandardMaterial({ map: w.map, roughness: 0.35, metalness: 0, name: name + '-glass' });
    interiors(m, 'facade-' + name.slice(6), { base, flat: true, far: CUT + 20, sky: U });
    receiveSun(m, U, { street: true });
    return (GLASS[name] = m);
  };
  // (the door at the back of its opening, and its threshold: the front's own picture, but not the wall's material - within
  // CUT m that material leaves every window-map opening a hole, the door's included, and the door had been cut out with
  // it: a doorway open to the yard behind)
  const DOORS = {};
  const doorMat = (name) => {
    if (DOORS[name]) return DOORS[name];
    const w = materials(name); if (!w) return null;
    const m = new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap || null, roughness: 0.8, metalness: 0, name: name + '-door' });
    receiveSun(m, U, { street: true });
    return (DOORS[name] = m);
  };
  // (a front's own picture before something was painted out of the wall's - its open shutters, fronts/<front>-shutters.jpg;
  // its balcony, railings, lamps and plaques, fronts/<front>-fixtures.jpg - for the models of them; its px as the wall's)
  const PICS = {};
  const picMat = (name, suffix) => {
    const key = name + suffix;
    if (PICS[key]) return PICS[key];
    const w = materials(name); if (!w) return null;
    const m = new THREE.MeshStandardMaterial({ map: w.map, roughness: 0.8, metalness: 0, name: key, side: THREE.DoubleSide });
    new THREE.TextureLoader().loadAsync(base + DIR + 'fronts/' + name.slice(6) + suffix + '.jpg').then((t) => {
      t.colorSpace = w.map?.colorSpace ?? THREE.SRGBColorSpace; t.flipY = w.map?.flipY ?? false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = w.map?.anisotropy ?? 4;
      m.map = t; m.needsUpdate = true;
    }).catch(() => {});
    receiveSun(m, U, { street: true });
    return (PICS[key] = m);
  };
  const shutMat = (name) => picMat(name, '-shutters');
  // (a carved casing's boards cut to their own outline: the wall's picture on them, fronts/<front>-cut.png the carving's
  // shape in it - white where the board is, black where the logs show through - so a crest's curve, an apron's scallops
  // and the openwork stand free of the wall instead of a board's rectangle with logs painted on its corners)
  const CUTS = {};
  const cutMat = (name) => {
    if (CUTS[name]) return CUTS[name];
    const w = materials(name); if (!w) return null;
    const m = new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap || null, roughness: 0.8, metalness: 0, name: name + '-cut', alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
    m.visible = false;
    new THREE.TextureLoader().loadAsync(base + DIR + 'fronts/' + name.slice(6) + '-cut.png').then((t) => {
      t.flipY = w.map?.flipY ?? false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = w.map?.anisotropy ?? 4;
      m.alphaMap = t; m.visible = true; m.needsUpdate = true;
    }).catch(() => {});
    receiveSun(m, U, { street: true });
    return (CUTS[name] = m);
  };
  // (the fittings' iron and a lantern's frosted panes: one material each, whatever the front)
  const IRON = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide, name: 'fittings-iron' });
  const PANES = new THREE.MeshStandardMaterial({ color: 0xd7dbd6, roughness: 0.3, metalness: 0, side: THREE.DoubleSide, name: 'fittings-glass' });
  const BRASS = new THREE.MeshStandardMaterial({ color: 0x8c6a2e, roughness: 0.35, metalness: 0.85, name: 'fittings-brass' });
  // (a modelled door's own paint or varnish, by its colour; the dark glass of its transom light)
  const DGLASS = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.08, metalness: 0.0, name: 'fittings-darkglass' });
  const PAINTS = {};
  const paintMat = (hex) => { if (!PAINTS[hex]) { PAINTS[hex] = new THREE.MeshStandardMaterial({ color: new THREE.Color('#' + hex), roughness: 0.55, metalness: 0, name: 'fittings-paint-' + hex }); receiveSun(PAINTS[hex], U, { street: true }); } return PAINTS[hex]; };
  receiveSun(IRON, U, { street: true }); receiveSun(PANES, U, { street: true }); receiveSun(BRASS, U, { street: true }); receiveSun(DGLASS, U, { street: true });
  // (the window boxes' models: each mesh's geometry in the model's own frame, its material; null if not there)
  const BOXES = Promise.all([0, 1].map((v) => gltfLoader().loadAsync(base + 'assets/world/props/prop-window-box-' + v + '.glb').then((g) => {
    g.scene.updateMatrixWorld(true); const parts = [];
    g.scene.traverse((o) => { if (o.isMesh) { const m = o.material; receiveSun(m, U); parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: m }); } });
    return parts;
  }).catch(() => null)));
  // (the windows' frames: each front's models, { c<column>: { p, n, u: its triangles' points, normals and texture
  // coordinates in its own metres - x along the hole from its left, y up from its foot, z out from the glass - mat }};
  // their paint one material a colour, whatever the front)
  const FRAMES = {}, FMATS = {};
  const frameMat = (name, src) => {
    if (FMATS[name]) return FMATS[name];
    const m = new THREE.MeshStandardMaterial({ color: src.color.clone(), roughness: src.roughness ?? 0.45, metalness: 0, name });
    receiveSun(m, U, { street: true });
    return (FMATS[name] = m);
  };
  const loadFrames = (key) => gltfLoader().loadAsync(base + DIR + 'fronts/' + key.slice(7) + '.glb').then((g) => {
    g.scene.updateMatrixWorld(true); const F = {};
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      const uv = geo.attributes.uv;
      F[o.name] = { p: geo.attributes.position.array, n: geo.attributes.normal.array, u: uv ? uv.array : new Float32Array(geo.attributes.position.count * 2), mat: frameMat(o.material.name || 'frame', o.material) };
    });
    FRAMES[key] = F;
  }).catch(() => {});
  // (a front's fittings: its balcony on its brackets with its railing, French railings, lamps, plaques - each a model of
  // its own, built to its box in the front's measure (bays.json 'models'; dev\\world\\cities\\fixtures\\
  // fittings_blender.py): { <name>: { p, n, u, kind } } in its own metres - x along the box from its left, y up from its
  // foot, z out from the wall; kind its material, 'iron', 'glass' or 'fix' (the front's picture before they were painted
  // out))
  const FITS = {};
  const loadFittings = (key) => gltfLoader().loadAsync(base + DIR + 'fronts/' + key.slice(7) + '-fittings.glb').then((g) => {
    g.scene.updateMatrixWorld(true); const F = {};
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      const uv = geo.attributes.uv, nm = o.parent?.isMesh ? o.parent.name : o.name.replace(/_\d+$/, '');
      const mn = o.material.name, pm = /paint-([0-9a-f]{6})/.exec(mn);
      const kind = pm ? 'paint:' + pm[1] : /darkglass/.test(mn) ? 'dglass' : /iron/.test(mn) ? 'iron' : /glass/.test(mn) ? 'glass' : /brass/.test(mn) ? 'brass' : /wall/.test(mn) ? 'wall' : 'fix';
      (F[nm] ??= []).push({ p: geo.attributes.position.array, n: geo.attributes.normal.array, u: uv ? uv.array : new Float32Array(geo.attributes.position.count * 2), kind });
    });
    FITS[key] = F;
  }).catch(() => {});
  const group = new THREE.Group(); group.name = 'facade-relief';
  const tiles = new Map();         // key -> { c: [x, z], state: 0 none 1 loading 2 built, mesh group }
  let BAYS = null, FRONTS = null;
  const ready = Promise.all([
    fetch(base + DIR + 'windows/bays.json').then((r) => r.json()),
    fetch(base + DIR + 'windows/fronts.json').then((r) => r.json()),
    ...cities.map((c) => fetch(base + DIR + c + '-relief/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)),
  ]).then(([b, f, ...idx]) => Promise.all([...Object.keys(b).filter((k) => b[k]?.frameModels).map(loadFrames), ...Object.keys(b).filter((k) => b[k]?.models).map(loadFittings)]).then(() => {
    // (the frames first: the tiles are built once, from what is in hand when they are)
    BAYS = b; FRONTS = f;
    idx.forEach((I, ci) => {
      if (!I) return;
      for (const t of I.tiles) {
        const [i, j] = t.split('_').map(Number);
        tiles.set(cities[ci] + ':' + t, { city: cities[ci], key: t, I, c: [(i + 0.5) * I.tile, (j + 0.5) * I.tile], state: 0, g: null });
      }
    });
  })).catch(() => {});

  // ---- the walls themselves, for the walker: he is kept a step off every wall that shows (the houses' picture the
  // walker is stopped by is 2 m a pixel, and by it he could stand with his eye through a wall and see the house from
  // within). The same lists the relief is built from, kept by 8 m square while their tile is in memory.
  const HASH = new Map(), HC = 8;
  function hashWalls(T, walls) {
    T.hk = new Set();
    for (const w of walls) {
      if ((w[10] ?? 0) > 0) continue;                        // (a wall shared with a lower house: nobody stands at it)
      const ax = w[0], az = -w[1], bx = w[2], bz = -w[3], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const seg = { ax, az, bx, bz, L, nx: (w[3] - w[1]) / L, nz: (w[2] - w[0]) / L };
      const i0 = Math.floor((Math.min(ax, bx) - 1) / HC), i1 = Math.floor((Math.max(ax, bx) + 1) / HC), j0 = Math.floor((Math.min(az, bz) - 1) / HC), j1 = Math.floor((Math.max(az, bz) + 1) / HC);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i + ',' + j; let l = HASH.get(k); if (!l) HASH.set(k, (l = []));
        l.push(seg); seg.T = T; T.hk.add(k);
      }
    }
  }
  function unhashWalls(T) {
    for (const k of T.hk ?? []) { const l = HASH.get(k); if (!l) continue; const m = l.filter((sg) => sg.T !== T); if (m.length) HASH.set(k, m); else HASH.delete(k); }
    T.hk = null;
  }
  /** (x, z) moved, if need be, to stand r m clear of every wall near it: out on the wall's own outer side. */
  group.userData.push = (x, z, r = 0.45) => {
    for (let it = 0; it < 3; it++) {
      const l = HASH.get(Math.floor(x / HC) + ',' + Math.floor(z / HC));
      if (!l) break;
      let moved = false;
      for (const sg of l) {
        const dx0 = sg.bx - sg.ax, dz0 = sg.bz - sg.az;
        const t = Math.min(1, Math.max(0, ((x - sg.ax) * dx0 + (z - sg.az) * dz0) / (sg.L * sg.L)));
        const cx = sg.ax + dx0 * t, cz = sg.az + dz0 * t, dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        const out = dx * sg.nx + dz * sg.nz;                 // (how far out from the wall's face; under 0: behind it)
        if (out < -0.7) continue;                            // (far behind it: not this wall's business)
        if (t > 0 && t < 1) { x = cx + sg.nx * r; z = cz + sg.nz * r; }
        else if (out >= 0 && d > 1e-6) { x = cx + dx / d * r; z = cz + dz / d * r; }       // (round the wall's end)
        else { x = cx + sg.nx * r; z = cz + sg.nz * r; }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  };

  function build(T, walls) {
    // per front material: positions, normals, uvs
    const acc = new Map(); const boxes = [];
    const get = (name, ck, cell = CELL) => { const k = name + '|' + ck; let a = acc.get(k); if (!a) acc.set(k, (a = { name, ck, cell, p: [], n: [], u: [], c: [] })); return a; };
    // (the windows' frames are not built for an older machine's picture of 240 lines: its windows are the picture's own,
    // no holes - interiors.js)
    const frOK = !(styleNow() && styleNow().lines <= 240);
    for (const w of walls) {
      // (k0, cut: a wall shared with a lower house - it shows from `cut` up, its windows from storey band k0 up:
      // dev/world/facade_bays.py)
      // (lev: for each of the wall's doors, in their order along it, [the pavement's top before it, how far out the
      // pavement reaches (m)] - dev/world/door_levels.py; room: [from, to] along the wall (m), the room between a
      // portico's two middle columns' pedestals, which its door's steps keep to - dev/world/city_blender.py)
      const [px, py, qx, qy, y0, st, fi, sh0, sh1, bix, k0 = 0, , lev = null, room = null] = w;
      let dix = 0;
      const fname = T.I.fronts[fi], key = 'facade-' + fname.slice(6), fb = BAYS[key], fr = FRONTS[key], FM = frOK ? FRAMES[key] : null;
      if (!fb || !fr) continue;
      fb.my ??= fr.my; fb.mx ??= fr.mx;
      const H = fr.H;
      // the wall in the world: p -> q along it (x, z = -y), its outside to the right in Blender's plan
      const ax = px, az = -py, bx = qx, bz = -qy;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const nxB = (qy - py) / L, nyB = -(qx - px) / L;            // (outward in Blender's plan)
      const nx = nxB, nz = -nyB;
      const ck_ = Math.floor((ax + bx) / 2 / CELL) + ',' + Math.floor((az + bz) / 2 / CELL);
      let A = get(fname, ck_); const AG = get(fname + '#glass', ck_), AD = get(fname + '#door', ck_);
      // a vertex: s along the wall, h up, o out; its picture coordinates (px)
      const V = (s, h, o) => [ax + tx * s + nx * o, h, az + tz * s + nz * o];
      const quad = (a, b, c, d, ua, ub, uc, ud, n) => {
        // (wound to face n: the fronts' material draws front faces only)
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const L_ = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0 ? [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]] : [[a, ua], [c, uc], [b, ub], [a, ua], [d, ud], [c, uc]];
        for (const [v, uv] of L_) { A.p.push(v[0], v[1], v[2]); A.n.push(n[0], n[1], n[2]); if (raw) A.u.push(uv[0], uv[1]); else A.u.push(uv[0] / 1024, uv[1] / H); if (winC) A.c.push(winC[0], winC[1], winC[2]); }
      };
      let winC = null;              // (the glass's window centre, for its room: interiors.js)
      let raw = false;              // (texture coordinates as given - the steps' stone, in its own tiles - not the picture's px)
      const out = [nx, 0, nz], up = [0, 1, 0], down = [0, -1, 0], along = [tx, 0, tz], back = [-tx, 0, -tz];
      // a box proud of the wall: s0..s1 along, h0..h1 up, o out; its face cut from the picture's px rectangle
      // (o0: where its back stands, 0 the wall's face - a board out from the wall stands from o0 to o)
      const box = (s0, s1, h0, h1, o, pr, faces = 'ftblr', o0 = 0) => {
        const [x0, y0p, x1, y1p] = pr;                               // (px: left, top, right, bottom)
        const a = V(s0, h0, o), b = V(s1, h0, o), c = V(s1, h1, o), d = V(s0, h1, o);
        const a0 = V(s0, h0, o0), b0 = V(s1, h0, o0), c0 = V(s1, h1, o0), d0 = V(s0, h1, o0);
        if (faces.includes('f')) quad(a, b, c, d, [x0, y1p], [x1, y1p], [x1, y0p], [x0, y0p], out);
        // (a side's strip read a little inside the moulding's edge: the edge's own row or column of the picture is the
        // dark line of its shadow, which had lain along every surround's and pilaster's side as a grey stripe)
        const ix = Math.min(2, Math.abs(x1 - x0) / 4) * Math.sign(x1 - x0), iy = Math.min(2, Math.abs(y1p - y0p) / 4) * Math.sign(y1p - y0p);
        const xl = x0 + ix, xr = x1 - ix, yt = y0p + iy, yb = y1p - iy;
        if (faces.includes('t')) quad(d, c, c0, d0, [x0, yt], [x1, yt], [x1, yt], [x0, yt], up);
        if (faces.includes('b')) quad(a0, b0, b, a, [x0, yb], [x1, yb], [x1, yb], [x0, yb], down);
        if (faces.includes('l')) quad(a0, a, d, d0, [xl, y1p], [xl, y1p], [xl, y0p], [xl, y0p], back);
        if (faces.includes('r')) quad(b, b0, c0, c, [xr, y1p], [xr, y1p], [xr, y0p], [xr, y0p], along);
      };
      // (a fitting's model set on this wall: its box [x0, y0, x1, y1] px of the picture, its back o0 m out from the wall's
      // face, S and Z the bay's and band's own mapping; each part in its material - iron, a lantern's panes, brass, the
      // picture before the fittings were painted out ('fix'), the wall's picture as it is ('wall'))
      const fit = (parts, [fx0, fy0, fx1, fy1], S, Z, o0 = 0) => {
        const f0 = S(fx0), sx = (S(fx1) - f0) / ((fx1 - fx0) * fb.mx), f1 = Z(fy1), sy = (Z(fy0) - f1) / ((fy1 - fy0) * fb.my);
        const mid = V((f0 + S(fx1)) / 2, f1, 0), ckF = Math.floor(mid[0] / CELL) + ',' + Math.floor(mid[2] / CELL);
        for (const pt of parts) {
          const AF = get('fit-' + pt.kind + (pt.kind === 'fix' || pt.kind === 'wall' ? ':' + fname : ''), ckF);
          AF.mat ??= pt.kind.startsWith('paint:') ? paintMat(pt.kind.slice(6)) : pt.kind === 'dglass' ? DGLASS : pt.kind === 'iron' ? IRON : pt.kind === 'glass' ? PANES : pt.kind === 'brass' ? BRASS : pt.kind === 'wall' ? doorMat(fname) : picMat(fname, '-fixtures');
          const { p: fp, n: fn, u: fu } = pt;
          for (let i = 0; i < fp.length; i += 3) {
            const s_ = f0 + fp[i] * sx, h_ = f1 + fp[i + 1] * sy, o_ = o0 + fp[i + 2];
            AF.p.push(ax + tx * s_ + nx * o_, h_, az + tz * s_ + nz * o_);
            let q0 = fn[i] / sx, q1 = fn[i + 1] / sy, q2 = fn[i + 2]; const ql = Math.hypot(q0, q1, q2) || 1; q0 /= ql; q1 /= ql; q2 /= ql;
            AF.n.push(tx * q0 + nx * q2, q1, tz * q0 + nz * q2);
          }
          for (let i = 0; i < fu.length; i++) AF.u.push(fu[i]);
        }
      };
      const FT = FITS[key];
      const bands = bandsFor(fb, st, T.I.storey);
      const top = y0 + st * T.I.storey;
      if (!bix.length) continue;
      const tb = bands[bands.length - 1];
      const cpx = Math.max(10, Math.round(CORN / fb.my)), cp = Math.max(6, Math.round(0.16 / fb.my));
      const zc = y0 + bands[0][2];
      // the bays along the wall: their picture's px stretched to the wall
      const bl = bix.map((i) => fb.bays[Math.max(0, i)]);
      const tot = bl.reduce((s, b) => s + (b[1] - b[0]) * fb.mx, 0), sc = L / tot;
      let s = 0;
      bl.forEach((b, bi) => {
        const wpx = b[1] - b[0], wm = wpx * fb.mx * sc, sa = s; s += wm;
        const S = (x) => sa + (x - b[0]) / wpx * wm;
        // (the cornice along the top of the bay, from the picture's top rows over it; its ends closed at the wall's)
        box(sa, s, top - CORN, top, CORN, [b[0], tb[0], b[1], tb[0] + cpx], 'fb' + (bi === 0 ? 'l' : '') + (bi === bl.length - 1 ? 'r' : ''));
        // (the string course over the ground floor: the picture's rows where the ground band meets the next)
        // (a front measured for it ('course': its rows in the ground band's top) has its own course where the picture
        // paints it; a front whose picture paints none has none modelled - the plain band across its wall had stood over
        // nothing; the others as before)
        const ends = (bi === 0 ? 'l' : '') + (bi === bl.length - 1 ? 'r' : '');
        // (none across a shop's bays: its front and its sign stand up past the course, which had cut across the sign's
        // top - seen live, 13 Nov 2026)
        if (sh0 >= 0 && bi >= sh0 && bi < sh1) { /* the shop's front */ }
        else if (fb.course) {
          if (bands.length > 1 && k0 === 0) {
            const [g0, g1, gh] = bands[0], Zg = (y) => y0 + (g1 - y) / (g1 - g0) * gh;
            box(sa, s, Zg(fb.course[1]), Zg(fb.course[0]), COURSE, [b[0], fb.course[0], b[1], fb.course[1]], 'ftb' + ends);
          }
        } else if (fb.eaves === undefined && bands.length > 1 && k0 === 0) box(sa, s, zc - 0.08, zc + 0.08, COURSE, [b[0], bands[0][0] - cp / 2, b[1], bands[0][0] + cp / 2], 'ftb' + ends);
        // (the pilasters (bays.json 'pilasters'): one at every joint of the bays, each bay's two halves of it standing out
        // of the wall from capital to base in every band it crosses - all cut from the one pilaster of the picture, so they
        // stand alike and in line; their sides closed only at the wall's ends)
        const PL = fb.pilasters;
        if (PL) {
          const hw = PL.half, src = PL.src, [r0, r1] = PL.rows, dp = PL.depth;
          let zp = y0;
          bands.forEach(([py0, py1, phm], kk) => {
            const lo = Math.max(py0, r0), hi = Math.min(py1, r1);
            const shopB = kk === 0 && sh0 >= 0 && bi >= sh0 && bi < sh1;
            if (kk >= k0 && hi - lo > 1 && !shopB) {
              const Zp = (y) => zp + (py1 - y) / (py1 - py0) * phm, hl = hw * fb.mx * sc;
              const fc = 'f' + (lo === r0 ? 't' : '') + (hi === r1 ? 'b' : '');            // (its top at the capital, its foot at the base)
              // (the bay's left: the right half of the pilaster on its joint; its right: the left half)
              if (PL.at.some((x) => Math.abs(x - b[0]) < 2)) box(sa, sa + hl, Zp(hi), Zp(lo), dp, [src, lo, src + hw, hi], fc + 'r' + (bi === 0 ? 'l' : ''));
              if (PL.at.some((x) => Math.abs(x - b[1]) < 2)) box(s - hl, s, Zp(hi), Zp(lo), dp, [src - hw, lo, src, hi], fc + 'l' + (bi === bl.length - 1 ? 'r' : ''));
            }
            zp += phm;
          });
        }
        let zb = y0;
        bands.forEach(([by0, by1, hm], k) => {
          if (k < k0) { zb += hm; return; }                          // (behind the next house: nothing to model)
          const Z = (y) => zb + (by1 - y) / (by1 - by0) * hm;
          const shop = k === 0 && sh0 >= 0 && bi >= sh0 && bi < sh1;
          // An arched opening (windows/bays.json: a row's fourth number, the door's doorArch - the arch's rise as a
          // share of half the opening's width): its jambs' surrounds up to where the arch springs, its archivolt
          // standing proud of the wall in segments, and the hole's sides and head back D m to the glass or the door -
          // each face cut from the picture where it stands, the hole's from the plaster beyond the surround. (Every
          // opening had been a rectangle: under an arch the wall between it and the rectangle's corners was cut away
          // with the hole, and the hole's flat head stood across the arch like a plank.)
          const arched = (x0, x1, y0p, y1p, vBot, af, mpx, e, ew, D, rev = null) => {
            // (an even count of segments: the crown is a corner, where the head's left half meets its right)
            const NA = 2 * Math.max(3, Math.round(6 * Math.min(1, af))), Ar = archOf(x0, x1, y0p, af, NA);
            const a0 = S(x0), a1 = S(x1), am = mpx * fb.mx * sc, vs = Z(Ar.ys);
            box(a0 - am, a0, vBot, vs, PROUD, [x0 - mpx, Ar.ys, x0, y1p], 'fl');
            box(a1, a1 + am, vBot, vs, PROUD, [x1, Ar.ys, x1 + mpx, y1p], 'fr');
            // (the hole's sides and head from the surround's front back to the glass, not from the wall's face: the wall's
            // cut is its window map's, a staircase of texels round an arch, and between that and the smooth arch the
            // light behind had shown in dots along every arched head - seen live, 12 Nov 2026)
            // (rev: the picture's own reveal for each side, [u at the front, u at the back] - a window measured to its
            // hole; else the plaster beyond the surround. That reveal lies inside the hole, which the wall's own material
            // leaves open near the camera: its faces take the door's, the front's picture with no hole in it)
            const [lf, lb] = rev ? rev[0] : [x0 - e, x0 - e - ew], [rf, rb] = rev ? rev[1] : [x1 + e, x1 + e + ew];
            const AW = A, AR = AD;
            A = AR;
            quad(V(a0, vBot, PROUD), V(a0, vBot, -D), V(a0, vs, -D), V(a0, vs, PROUD), [lf, y1p], [lb, y1p], [lb, Ar.ys], [lf, Ar.ys], along);
            quad(V(a1, vBot, -D), V(a1, vBot, PROUD), V(a1, vs, PROUD), V(a1, vs, -D), [rb, y1p], [rf, y1p], [rf, Ar.ys], [rb, Ar.ys], back);
            A = AW;
            const W = (x, y, o) => V(S(x), Z(y), o);
            // (the head's underside in the jambs' own strip of the picture, carried on from where each jamb stops: up the
            // arch from either springing, the strip read on down from the springing's row, so the reveal is one plain
            // surface from sill to crown. It had been the picture's strip just outside the arch, following it round - on
            // a rusticated front the dark wedges of stone over every arch, smeared through the head's depth like wood -
            // seen live, 13 Nov 2026)
            const arc = [0];
            for (let i = 0; i < NA; i++) arc.push(arc[i] + Math.hypot(Ar.pts[i + 1][0] - Ar.pts[i][0], Ar.pts[i + 1][1] - Ar.pts[i][1]));
            const half = arc[NA] / 2, vAt = (i) => Math.min(y1p, Ar.ys + Math.min(arc[i], 2 * half - arc[i]));
            for (let i = 0; i < NA; i++) {
              const [ax_, ay_, anx, any] = Ar.pts[i], [bx_, by_, bnx, bny] = Ar.pts[i + 1];
              const mxn = (anx + bnx) / 2, myn = (any + bny) / 2, ml = Math.hypot(mxn, myn) || 1;
              const nr = [tx * mxn / ml, -myn / ml, tz * mxn / ml];           // (out from the arch, in the wall's plane)
              const qa = [ax_ + anx * mpx, ay_ + any * mpx], qb = [bx_ + bnx * mpx, by_ + bny * mpx];
              quad(W(ax_, ay_, PROUD), W(bx_, by_, PROUD), W(qb[0], qb[1], PROUD), W(qa[0], qa[1], PROUD), [ax_, ay_], [bx_, by_], qb, qa, out);       // (the archivolt's face)
              quad(W(qa[0], qa[1], 0), W(qa[0], qa[1], PROUD), W(qb[0], qb[1], PROUD), W(qb[0], qb[1], 0), qa, qa, qb, qb, nr);                        // (its outer edge)
              const left = i < NA / 2, uf = left ? lf : rf, ub = left ? lb : rb, va = vAt(i), vb = vAt(i + 1);
              A = AR; quad(W(ax_, ay_, PROUD), W(bx_, by_, PROUD), W(bx_, by_, -D), W(ax_, ay_, -D), [uf, va], [uf, vb], [ub, vb], [ub, va], [-nr[0], -nr[1], -nr[2]]); A = AW;   // (the hole's head)
            }
          };
          if (!shop) for (const [ry0, ry1, cs, af = 0] of fb.rows) {
            if (ry0 < by0 - 1 || ry1 > by1 + 1) continue;
            for (const ci of cs) {
              const [cx0, cx1] = fb.cols[ci];
              if (cx0 < b[0] - 1 || cx1 > b[1] + 1) continue;
              // the surround: a frame round the window's rectangle, its width a tenth of the window's - or, where the
              // front's own surround was measured off its picture (bays.json 'trim': px at the sides, over the head,
              // under the sill - a timber house's carved casing with its crest and apron), that
              const tr = fb.trim && (!fb.trimRows || (ry0 >= fb.trimRows[0] && ry1 <= fb.trimRows[1])) ? fb.trim : null, mpx = tr ? tr[0] : Math.max(6, Math.min(16, (cx1 - cx0) * 0.12)), hpx = tr ? tr[1] : mpx;
              const u0 = S(cx0), u1 = S(cx1), v0 = Z(ry1), v1 = Z(ry0), um = mpx * fb.mx * sc, vm = (Z(ry0 - hpx) - v1);
              const e = Math.round(mpx) + 5, ew = 6;
              // (a window measured to its hole (bays.json 'frames'): its painted frame's place in the picture, and at each
              // side the picture's own reveal between the two - [u at the wall, u at the frame] - or, where the picture
              // shows that side's none (under 2 px, the picture taken square to the front's middle), the other side's)
              const gf = fb.frames?.[ci], [gx0, gy0, gx1, gy1] = gf ?? [cx0, ry0, cx1, ry1];
              const rvL = gf && gx0 - cx0 >= 2 ? [cx0, gx0] : null, rvR = gf && cx1 - gx1 >= 2 ? [cx1, gx1] : null;
              const rev = rvL || rvR ? [rvL ?? rvR, rvR ?? rvL] : null;
              // (each strip's corners in the picture - at the wall's foot, the frame's foot, the frame's head, the wall's
              // head - for a side: the left's, the right's, or, where the window shows neither (one near the picture's
              // middle), the nearest window's of its storey that shows one, upright as the picture has it - the soffit's
              // turned on its side had lain across the reveal; and the soffit's for the head where it shows)
              const hasH = gf && gy0 - ry0 >= 2;
              const SL = [[cx0, ry1], [gx0, gy1], [gx0, gy0], [cx0, ry0]], SR = [[cx1, ry1], [gx1, gy1], [gx1, gy0], [cx1, ry0]];
              const SB = gf && !rvL && !rvR ? borrowed(fb, ci, ry0, ry1) : null;
              const sideL = rvL ? SL : rvR ? SR : SB, sideR = rvR ? SR : rvL ? SL : SB;
              // (the shutters standing open beside it, where the picture has them: bays.json 'shutters', measured off it -
              // dev\world\cities\measure_shutters.py)
              // (one hangs on this window where its inner edge is at the frame or within the casing's breadth of it)
              // (by the painted frame's edges where the window was measured to its hole: the shutters were measured to them)
              const ex0 = gf ? gx0 : cx0, ex1 = gf ? gx1 : cx1;
              const sh = (!(af > 0) && fb.shutters) ? fb.shutters.filter((q) => (q[4] < 0 ? q[2] <= ex0 + 1.5 && ex0 - q[2] <= mpx + 2 + (ex0 - cx0) : q[0] >= ex1 - 1.5 && q[0] - ex1 <= mpx + 2 + (cx1 - ex1)) && q[1] < ry1 && q[3] > ry0) : [];
              const shL = sh.some((q) => q[4] < 0), shR = sh.some((q) => q[4] > 0);
              // (only the faces that show: the jambs' inner sides are a few cm deep, left to the window's recess)
              // (a front whose casings are carved boards (bays.json 'cut'): the head, sides and apron cut to the carving)
              const AC_ = A, cut = tr && fb.cut;
              if (af > 0) arched(cx0, cx1, ry0, ry1, v0, af, mpx, e, ew, REC, rev);
              else {
                if (cut) A = get(fname + '#cut', ck_);
                box(u0 - um, u1 + um, v1, v1 + vm, PROUD, [cx0 - mpx, ry0 - hpx, cx1 + mpx, ry0], 'ftlr');          // (head)
                // (a side of the casing under an open shutter is not built: its strip of the picture is the shutter's
                // own edge, and raised with the casing it had cut every shutter along the casing's line - seen live,
                // 12 Nov 2026)
                if (!shL) box(u0 - um, u0, v0, v1, PROUD, [cx0 - mpx, ry0, cx0, ry1], 'fl');                     // (left)
                if (!shR) box(u1, u1 + um, v0, v1, PROUD, [cx1, ry0, cx1 + mpx, ry1], 'fr');                     // (right)
                A = AC_;
              }
              // the sill: a stone ledge under the window, a little wider than its surround
              const sp = Math.max(5, Math.round(0.08 / fb.my));
              box(u0 - um - 0.04, u1 + um + 0.04, v0 - 0.08, v0, SILL, [cx0 - mpx, ry1 + 1, cx1 + mpx, ry1 + 1 + sp], 'ftblr');
              // (and the casing's apron under the sill, where the front has one)
              if (cut) A = get(fname + '#cut', ck_);
              if (tr && tr[2]) box(u0 - um, u1 + um, Z(ry1 + sp + tr[2]), v0 - 0.08, PROUD, [cx0 - mpx, ry1 + sp + 1, cx1 + mpx, ry1 + sp + tr[2]], 'fblr');
              A = AC_;
              // (each open shutter: a board 4 cm thick standing just out from the casing, the picture's whole shutter on
              // it, its foot at the sill)
              // (in the front's picture as it was before its shutters were painted out - fronts/<front>-shutters.jpg, the
              // same px - the wall's own picture now has plain wall where they hung: a shutter is a model, not paint)
              if (sh.length) {
                const A0 = A; A = get(fname + '#shut', ck_);
                for (const [qx0, qy0, qx1, qy1] of sh) {
                  const yb = Math.min(qy1, ry1 + 1);
                  box(S(qx0), S(qx1), Z(yb), Z(qy0), PROUD + 0.035, [qx0, qy0, qx1, yb], 'ftblr', PROUD - 0.005);
                }
                A = A0;
              }
              // the hole: its four sides back to the glass, plaster from just outside the window in the picture
              const R0 = V(u0, v0, 0), R1 = V(u1, v0, 0), R2 = V(u1, v1, 0), R3 = V(u0, v1, 0);
              const B0 = V(u0, v0, -REC), B1 = V(u1, v0, -REC), B2 = V(u1, v1, -REC), B3 = V(u0, v1, -REC);
              // (the sides and head from the surround's front, which stands PROUD out: from the wall's face they had left
              // a crack along the opening's edge, where the wall's own cut and these faces meet, and the light behind
              // showed through it in dots at 480 lines)
              const F0 = V(u0, v0, PROUD), F1 = V(u1, v0, PROUD), F2 = V(u1, v1, PROUD), F3 = V(u0, v1, PROUD);
              // (the plaster from beyond the surround, a strip of the wall itself: the frame's own edge, a pixel or two
              // stretched over the reveal, had read as a flat grey-blue)
              // (a window measured to its hole: each side the picture's own reveal there, from the hole's edge at the wall to
              // the frame's at the glass - the reveal the picture paints in its perspective, laid on the reveal modelled. It
              // lies inside the hole, which the wall's own material leaves open near the camera: those faces take the door's,
              // the front's picture with no hole in it)
              const AW = A;
              if (!(af > 0)) {
                if (sideL) { A = AD; quad(F0, B0, B3, F3, ...sideL, along); A = AW; }                                          // (left side)
                else { A = AD; quad(F0, B0, B3, F3, [cx0 - e, ry1], [cx0 - e - ew, ry1], [cx0 - e - ew, ry0], [cx0 - e, ry0], along); A = AW; }
                if (sideR) { A = AD; quad(B1, F1, F2, B2, sideR[1], sideR[0], sideR[3], sideR[2], back); A = AW; }             // (right side)
                else { A = AD; quad(B1, F1, F2, B2, [cx1 + e + ew, ry1], [cx1 + e, ry1], [cx1 + e, ry0], [cx1 + e + ew, ry0], back); A = AW; }
                const HB = gf && !hasH ? borrowed(fb, ci, ry0, ry1, 'head') : null;
                if (hasH) { A = AD; quad(F3, F2, B2, B3, [cx0, ry0], [cx1, ry0], [gx1, gy0], [gx0, gy0], down); A = AW; }       // (head)
                else if (HB) { A = AD; quad(F3, F2, B2, B3, ...HB, down); A = AW; }
                else { A = AD; quad(F3, F2, B2, B3, [cx0, ry0 - e], [cx1, ry0 - e], [cx1, ry0 - e - ew], [cx0, ry0 - e - ew], down); A = AW; }
              }
              if (gf && ry1 - gy1 >= 2) { A = AD; quad(B0, B1, R1, R0, [gx0, gy1], [gx1, gy1], [cx1, ry1], [cx0, ry1], up); A = AW; }             // (sill)
              else { A = AD; quad(B0, B1, R1, R0, [cx0, ry1 + e + ew], [cx1, ry1 + e + ew], [cx1, ry1 + e], [cx0, ry1 + e], up); A = AW; }
              // the glass and its frame at the back: the picture's window - from its painted frame's place where the window
              // was measured to its hole
              if (fb.doorCols?.includes(ci) && FT?.bdoor && fb.models?.bdoor) fit(FT.bdoor, fb.models.bdoor, S, Z, -REC);   // (a balcony's door, its own model)
              else {
                const A0 = A; A = AG; winC = V((u0 + u1) / 2, (v0 + v1) / 2, -REC);
                quad(B0, B1, B2, B3, [gx0, gy1], [gx1, gy1], [gx1, gy0], [gx0, gy0], out); A = A0; winC = null;
              }
              // the window's frame, its own model (fronts/<front>.glb), standing on the glass: stretched to the hole as the
              // picture is, the model being the hole's own size in the picture's metres
              const fm = FM?.['c' + ci];
              if (fm) {
                const sx = (u1 - u0) / ((cx1 - cx0) * fb.mx), sy = (v1 - v0) / ((ry1 - ry0) * fb.my);
                const mid = V((u0 + u1) / 2, (v0 + v1) / 2, 0), AF = get(fm.mat.name, Math.floor(mid[0] / FCELL) + ',' + Math.floor(mid[2] / FCELL), FCELL);
                AF.mat = fm.mat;
                const { p: fp, n: fn, u: fu } = fm;
                for (let i = 0; i < fp.length; i += 3) {
                  const s_ = u0 + fp[i] * sx, h_ = v0 + fp[i + 1] * sy, o_ = -REC + fp[i + 2];
                  AF.p.push(ax + tx * s_ + nx * o_, h_, az + tz * s_ + nz * o_);
                  // (a normal stretched the other way to the shape)
                  let q0 = fn[i] / sx, q1 = fn[i + 1] / sy, q2 = fn[i + 2]; const ql = Math.hypot(q0, q1, q2) || 1; q0 /= ql; q1 /= ql; q2 /= ql;
                  AF.n.push(tx * q0 + nx * q2, q1, tz * q0 + nz * q2);
                }
                for (let i = 0; i < fu.length; i++) AF.u.push(fu[i]);
              }
              // a window box of flowers on the sill now and then: one window in six on the lower two storeys, never a
              // shop's
              const hsh = Math.abs(Math.sin((ax + bx) * 12.9898 + u0 * 78.233 + v0 * 37.719) * 43758.5453) % 1;
              if (k <= 1 && hsh < 0.17) {
                const c_ = V((u0 + u1) / 2, v0, SILL - 0.02);
                boxes.push([c_[0], c_[1], c_[2], Math.atan2(nx, nz), (u1 - u0 + 0.1) / 1.0, hsh < 0.085 ? 0 : 1]);
              }
            }
          }
          // the door: in the door bay's ground band, its opening as the picture draws it (facade-bays.json 'door') cut
          // 0.22 m into the wall, a surround standing proud round its sides and head, the door itself (the picture's) at
          // the back, its steps before it
          if (k === 0 && b[2] === 'door') {
            const lv = lev?.[dix++] ?? null;
            if (fb.door && fb.door[0] >= b[0] - 2 && fb.door[2] <= b[1] + 2) {
              const [dx0, dy0, dx1, dy1] = fb.door, da = fb.doorArch ?? 0;
              const DR = 0.22, mp = Math.max(8, Math.min(18, (dx1 - dx0) * 0.08));
              const u0 = S(dx0), u1 = S(dx1), v0 = Math.max(y0 - 0.05, Z(dy1)), v1 = Z(dy0), um = mp * fb.mx * sc, vm = Z(dy0 - mp) - v1;
              const R0 = V(u0, v0, 0), R1 = V(u1, v0, 0), R2 = V(u1, v1, 0), R3 = V(u0, v1, 0);
              const B0 = V(u0, v0, -DR), B1 = V(u1, v0, -DR), B2 = V(u1, v1, -DR), B3 = V(u0, v1, -DR);
              const e = Math.round(mp) + 5, ew = 6;
              if (da > 0) arched(dx0, dx1, dy0, dy1, v0, da, mp, e, ew, DR);
              else {
                box(u0 - um, u1 + um, v1, v1 + vm, PROUD, [dx0 - mp, dy0 - mp, dx1 + mp, dy0], 'ftlr');
                box(u0 - um, u0, v0, v1, PROUD, [dx0 - mp, dy0, dx0, dy1], 'flt');
                box(u1, u1 + um, v0, v1, PROUD, [dx1, dy0, dx1 + mp, dy1], 'frt');
                // (the sides and head from the surround's front, as a window's: no crack along the door's edge)
                const F0 = V(u0, v0, PROUD), F1 = V(u1, v0, PROUD), F2 = V(u1, v1, PROUD), F3 = V(u0, v1, PROUD);
                const AW_ = A; A = AD;
                quad(F0, B0, B3, F3, [dx0 - e, dy1], [dx0 - e - ew, dy1], [dx0 - e - ew, dy0], [dx0 - e, dy0], along);
                quad(B1, F1, F2, B2, [dx1 + e + ew, dy1], [dx1 + e, dy1], [dx1 + e, dy0], [dx1 + e + ew, dy0], back);
                quad(F3, F2, B2, B3, [dx0, dy0 - e], [dx1, dy0 - e], [dx1, dy0 - e - ew], [dx0, dy0 - e - ew], down);
                A = AW_;
              }
              const A1 = A; A = AD;
              quad(B0, B1, R1, R0, [dx0, dy1 - 3], [dx1, dy1 - 3], [dx1, dy1 - 1], [dx0, dy1 - 1], up);   // (the threshold)
              if (FT?.door && fb.models?.door) fit(FT.door, fb.models.door, S, Z, -DR);                   // (the door, its own model)
              else quad(B0, B1, B2, B3, [dx0, dy1], [dx1, dy1], [dx1, dy0], [dx0, dy0], out);             // (the door)
              A = A1;
              // The steps: from the threshold down to the pavement before the door - the level the city's ground was
              // built at there and how far out it reaches (the wall's own list, read off the ground as built:
              // dev\world\door_levels.py) - in the pavement's stone, or planks before a timber house. They stand on the
              // pavement and end inside its edge; a riser 19 cm at most. (They had been cut from the door's own rows
              // of the picture, which the wall's material opens as a hole near the camera, so only their two ends
              // showed; and they had run down to the bare ground under the pavement, through it and out of its side.)
              const [yp, reach] = lv ?? [y0 - 0.03, 1.25];
              {
                // (between a porch's columns where the door has them, and a portico's)
                let s0 = u0 - um - 0.06, s1 = u1 + um + 0.06;
                for (const [cx0_, cx1_] of fb.hood?.cols ?? []) { if (cx1_ <= (dx0 + dx1) / 2) s0 = Math.max(s0, S(cx1_) + 0.04); else s1 = Math.min(s1, S(cx0_) - 0.04); }
                if (room) { s0 = Math.max(s0, room[0]); s1 = Math.min(s1, room[1]); }
                const rise = v0 - yp;
                if (rise >= 0.025 && rise < 2.6 && s1 - s0 > 0.4) {
                  const timber = /timber|wood/.test(fname), T = timber ? 1.4 : 2.774;
                  const n = Math.max(1, Math.ceil((rise - 0.005) / 0.19)), hs = rise / n;
                  const run = Math.max(0.3, reach - 0.25), d0 = Math.min(0.36, run), dt = n > 1 ? Math.min(0.27, Math.max(0.16, (run - d0) / (n - 1))) : 0;
                  const A2 = A; A = get(fname + (timber ? '#stept' : '#steps'), ck_); raw = true;
                  for (let q = 0; q < n; q++) {
                    const h1 = v0 - hs * q, h0 = h1 - hs, o = d0 + dt * q;
                    const a = V(s0, h0, o), bq = V(s1, h0, o), c = V(s1, h1, o), d = V(s0, h1, o), a0 = V(s0, h0, 0), b0 = V(s1, h0, 0), c0 = V(s1, h1, 0), d0_ = V(s0, h1, 0);
                    quad(a, bq, c, d, [s0 / T, h0 / T], [s1 / T, h0 / T], [s1 / T, h1 / T], [s0 / T, h1 / T], out);            // (its riser)
                    quad(d, c, c0, d0_, [s0 / T, o / T], [s1 / T, o / T], [s1 / T, 0], [s0 / T, 0], up);                       // (its tread)
                    quad(a0, a, d, d0_, [0, h0 / T], [o / T, h0 / T], [o / T, h1 / T], [0, h1 / T], back);                     // (its ends)
                    quad(bq, b0, c0, c, [o / T, h0 / T], [0, h0 / T], [0, h1 / T], [o / T, h1 / T], along);
                  }
                  A = A2; raw = false;
                }
              }
              // the door's hood: what the picture paints over the door - a gabled timber canopy on its brackets, a
              // pediment, a flat hood on consoles, the columns of a porch - built out from the wall in the picture's own
              // paint, each face cut from where the picture has it (windows/bays.json 'hood': px of the picture). The
              // painted one behind it is covered with a piece of the plain wall beside it ('wall').
              if (fb.hood) {
                const h = fb.hood, D = h.depth, xl = S(h.x0), xr = S(h.x1), zt = Z(h.y0), zb_ = Z(h.y1);
                // (a face wound and lit by its own plane, turned toward `hint`)
                const face = (a, b, c, d, ua, ub, uc, ud, hint) => {
                  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                  const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
                  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) n = [-n[0], -n[1], -n[2]];
                  quad(a, b, c, d, ua, ub, uc, ud, n);
                };
                if (h.wall) { const w = h.wall; quad(V(xl, zb_, 0.03), V(xr, zb_, 0.03), V(xr, zt, 0.03), V(xl, zt, 0.03), [w[0], w[3]], [w[2], w[3]], [w[2], w[1]], [w[0], w[1]], out); }
                // (where a portico or a porch stands over the door - its columns on the door's own piers - its top is the
                // door's shelter: the hood, as wide as the door's surround and more, would run into its columns)
                if (room) { /* the painted hood covered, none built */ } else {
                if (h.kind === 'gable') {
                  const xc = S(h.cx), ze = Z(h.ye);
                  const Al = V(xl, ze, D), Ar = V(xr, ze, D), Ap = V(xc, zt, D), Bl = V(xl, zb_, D), Br = V(xr, zb_, D);
                  const Al0 = V(xl, ze, 0), Ar0 = V(xr, ze, 0), Ap0 = V(xc, zt, 0), Bl0 = V(xl, zb_, 0), Br0 = V(xr, zb_, 0);
                  quad(Al, Ar, Ap, Ap, [h.x0, h.ye], [h.x1, h.ye], [h.cx, h.y0], [h.cx, h.y0], out);                    // (the gable)
                  quad(Bl, Br, Ar, Al, [h.x0, h.y1], [h.x1, h.y1], [h.x1, h.ye], [h.x0, h.ye], out);                    // (the beam under it)
                  face(Al0, Al, Ap, Ap0, [h.x0 + 2, h.ye - 1], [h.x0 + 2, h.ye - 1], [h.cx, h.y0 + 2], [h.cx, h.y0 + 2], up);   // (its two slopes)
                  face(Ap0, Ap, Ar, Ar0, [h.cx, h.y0 + 2], [h.cx, h.y0 + 2], [h.x1 - 2, h.ye - 1], [h.x1 - 2, h.ye - 1], up);
                  face(Bl0, Br0, Br, Bl, [h.x0 + 6, h.y1 - 2], [h.x1 - 6, h.y1 - 2], [h.x1 - 6, h.y1 - 2], [h.x0 + 6, h.y1 - 2], down);   // (its underside)
                  face(Bl0, Bl, Al, Al0, [h.x0 + 2, h.y1], [h.x0 + 2, h.y1], [h.x0 + 2, h.ye], [h.x0 + 2, h.ye], back);     // (its ends)
                  face(Br, Br0, Ar0, Ar, [h.x1 - 2, h.y1], [h.x1 - 2, h.y1], [h.x1 - 2, h.ye], [h.x1 - 2, h.ye], along);
                } else box(xl, xr, zb_, zt, D, [h.x0, h.y0, h.x1, h.y1], 'ftblr');
                // (its brackets: each a strut from the wall under it out to its front edge, the picture's bracket on it)
                for (const [bx0, bx1, by] of h.brackets ?? []) {
                  const s0 = S(bx0), s1 = S(bx1), zl = Z(by), Df = D * 0.92;
                  const T0a = V(s0, zb_, 0), T1a = V(s0, zb_, Df), T2a = V(s0, zl, 0), T0b = V(s1, zb_, 0), T1b = V(s1, zb_, Df), T2b = V(s1, zl, 0);
                  face(T0a, T1a, T2a, T2a, [bx0, h.y1], [bx1, h.y1], [bx0, by], [bx0, by], back);
                  face(T0b, T2b, T1b, T1b, [bx1, h.y1], [bx1, by], [bx0, h.y1], [bx0, h.y1], along);
                  face(T1a, T1b, T2b, T2a, [bx0, h.y1], [bx1, h.y1], [bx1, by], [bx0, by], [nx, -1, nz]);
                }
                // (a porch's columns: each a shaft standing out of the wall, the picture's own column on it - and under it,
                // down to the pavement, a block of the steps' stone: the picture's column stops at the floor, and the
                // pavement before the door is up to three quarters of a metre under it, so the columns stood in the air)
                for (const [cx0_, cx1_, cy0, cy1, pr] of h.cols ?? []) {
                  const c0 = S(cx0_), c1 = S(cx1_), cb = Math.max(y0, Z(cy1));
                  box(c0, c1, cb, Z(cy0), pr, [cx0_, cy0, cx1_, cy1], 'flr');
                  if (cb - yp > 0.02) {
                    const timber = /timber|wood/.test(fname), T = timber ? 1.4 : 2.774, e0 = c0 - 0.03, e1 = c1 + 0.03, o1 = pr + 0.03;
                    const A2 = A; A = get(fname + (timber ? '#stept' : '#steps'), ck_); raw = true;
                    const a = V(e0, yp, o1), bq = V(e1, yp, o1), c = V(e1, cb, o1), d = V(e0, cb, o1), a0 = V(e0, yp, 0), b0 = V(e1, yp, 0), c0_ = V(e1, cb, 0), d0_ = V(e0, cb, 0);
                    quad(a, bq, c, d, [e0 / T, yp / T], [e1 / T, yp / T], [e1 / T, cb / T], [e0 / T, cb / T], out);
                    quad(d, c, c0_, d0_, [e0 / T, o1 / T], [e1 / T, o1 / T], [e1 / T, 0], [e0 / T, 0], up);
                    quad(a0, a, d, d0_, [0, yp / T], [o1 / T, yp / T], [o1 / T, cb / T], [0, cb / T], back);
                    quad(bq, b0, c0_, c, [o1 / T, yp / T], [0, yp / T], [0, cb / T], [o1 / T, cb / T], along);
                    A = A2; raw = false;
                  }
                }
                }
              }
            }
          }
          // the front's fittings standing in this bay at this band: each where its box is in the picture, stretched with
          // the bay and the band as the picture is (its depth as built). One whose box starts in this band belongs to it -
          // a balcony on the upper storeys hangs on down over the band below, as in the picture; a sign that names the
          // street (plaque-st) once a wall
          if (FT && fb.models && k >= k0) for (const mk in fb.models) {
            // (a model may stand at several places - a pediment over every window: a list of boxes)
            const parts = FT[mk], boxes = Array.isArray(fb.models[mk][0]) ? fb.models[mk] : [fb.models[mk]];
            if (!parts || fb.doorParts?.[mk] || fb.doorSpec?.[mk] || shop) continue;
            for (const box of boxes) {
              if (box[0] < b[0] - 1 || box[2] > b[1] + 1 || box[1] < by0 - 1 || box[1] >= by1) continue;
              if (mk === 'plaque-st') { if (w.stDone) continue; w.stDone = true; }
              fit(parts, box, S, Z);
            }
          }
          zb += hm;
        });
      });
    }
    const g = new THREE.Group(); g.userData.cells = [];
    for (const a of acc.values()) {
      const name = a.name, mat = a.mat ?? (name.endsWith('#glass') ? glassMat(name.slice(0, -6)) : name.endsWith('#door') ? doorMat(name.slice(0, -5))
        : name.endsWith('#shut') ? shutMat(name.slice(0, -5)) : name.endsWith('#cut') ? cutMat(name.slice(0, -4)) : name.endsWith('#steps') ? stepMat(T.city, false) : name.endsWith('#stept') ? stepMat(T.city, true) : materials(name));
      if (!mat || !a.p.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
      if (a.c.length) geo.setAttribute('aWinC', new THREE.Float32BufferAttribute(a.c, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.name = 'relief.' + name; m.matrixAutoUpdate = false;
      m.userData.noCastFar = true;                     // (mouldings a hand deep: the sun's near picture alone can draw their shade)
      const [ci, cj] = a.ck.split(',').map(Number);
      g.userData.cells.push({ m, x: (ci + 0.5) * a.cell, z: (cj + 0.5) * a.cell, near: a.cell === FCELL });
      g.add(m);
    }
    // the window boxes: copies of the two models (prop-window-box-0/1.glb, Blender with ComfyUI's flowers), each cell's
    // its own instanced meshes so they show and hide with the cell's relief
    if (boxes.length) BOXES.then((models) => {
      if (!models) return;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sv = new THREE.Vector3(), pv = new THREE.Vector3();
      const byCell = new Map();
      for (const b of boxes) { const k = Math.floor(b[0] / CELL) + ',' + Math.floor(b[2] / CELL); let l = byCell.get(k); if (!l) byCell.set(k, (l = [])); l.push(b); }
      for (const [ck, list] of byCell) {
        const [ci, cj] = ck.split(',').map(Number);
        for (const v of [0, 1]) {
          const mine = list.filter((b) => b[5] === v); if (!mine.length || !models[v]) continue;
          for (const part of models[v]) {
            const im = new THREE.InstancedMesh(part.geo, part.mat, mine.length);
            mine.forEach((b, i) => im.setMatrixAt(i, m4.compose(pv.set(b[0], b[1], b[2]), q.setFromAxisAngle(up, b[3]), sv.set(b[4], 1, 1))));
            im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.name = 'relief.window-box';
            im.userData.noCastFar = true;
            g.userData.cells.push({ m: im, x: (ci + 0.5) * CELL, z: (cj + 0.5) * CELL });
            g.add(im);
          }
        }
      }
    });
    g.matrixAutoUpdate = false;
    return g;
  }

  group.userData.update = (pos) => {
    if (!BAYS) return;
    for (const T of tiles.values()) {
      const d = Math.max(Math.abs(T.c[0] - pos.x), Math.abs(T.c[1] - pos.z)) - T.I.tile / 2;
      const want = d < near;
      // (not before the city's ground materials are read - the steps are made of them - or eight seconds have gone)
      if (want && T.state === 0 && ground && !ground[T.city] && performance.now() - (T.asked ??= performance.now()) < 8000) continue;
      if (want && T.state === 0) {
        T.state = 1;
        fetch(base + DIR + T.city + '-relief/' + T.key + '.json').then((r) => r.json()).then((walls) => {
          T.g = build(T, walls); hashWalls(T, walls); T.state = 2; T.fresh = true;
        }).catch(() => { T.state = 3; });
      }
      if (T.state === 2) {
        // (a tile's mouldings come in together and settle onto their fronts - a short rise, a metre: arrive.js; while
        // it comes in the tile is the arrival's to add. Not before the tile's houses stand: housesIn, cityblocks.js)
        if (want && !T.g.parent && T.fresh) {
          if (!housesIn || housesIn(T.city, T.key)) {
            T.fresh = false; T.arriving = true;
            const g = T.g;
            arrive(g, { parent: group, x: T.c[0], z: T.c[1], depth: 1.2, dur: 0.7, cancel: () => T.g !== g }).then(() => { if (T.g === g) T.arriving = false; });
          }
        } else if (!T.arriving) {
          if (want && !T.g.parent) group.add(T.g);
          else if (!want && T.g.parent) group.remove(T.g);
        }
        // (a tile left well behind: its relief let go - built again from its list if the walker comes back; kept, the
        // relief of every street ever walked stayed in memory)
        if (d > near + 400) { T.g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh) o.geometry.dispose(); }); T.g.removeFromParent(); T.g = null; T.arriving = false; unhashWalls(T); T.state = 0; continue; }
        if (want) {
          const nearF = Math.min(SHOW, CUT, FRAMES_NEAR) + FCELL / 2;
          for (const c of T.g.userData.cells) c.m.visible = Math.max(Math.abs(c.x - pos.x), Math.abs(c.z - pos.z)) < (c.near ? nearF : SHOW);
        }
      }
    }
  };
  group.userData.ready = ready;
  return group;
}
