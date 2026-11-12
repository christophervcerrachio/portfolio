// The points of interest in the land between the pillars (world.json pois, placed by build_world.py from the
// layout), every building made here in code after the Russian countryside of the 18th and 19th centuries:
// - a serfs' (muzhik) village: log izbas under thatch along its street, each on its own plot - its gable end and its
//   windows to the street, the porch at the side, a wattle fence closing the yard, a stack in the field behind; a
//   wooden church, its altar to the east; a well-sweep (zhuravl) in the street; bathhouses set apart, by the water
//   where there is any;
// - a kulak's khutor: big five-walled houses under painted iron roofs, carved white window frames, each with its barn
//   behind it inside a closed yard of planks with a cart gate, and a post windmill on the rise;
// - the fisherman's hut on the river bank with its plank dock on piles, a boat afloat beside it and nets drying;
// - the rusalka pond deep in the wood: mist on black water, lights flitting over it like fairies;
// - a wayside chapel facing its path, the post station fronting the post road, an old kurgan with a stone idol, a
//   hayfield, the striped verst posts beside the road, the hunting towers at the woods' edge.
// No people yet. Each kind of building is built once and copied.
//
// Everything is set down by its own outline, not a circle, as in the cities: a thing goes where its whole outline is
// dry, off every way, clear of what already stands (world/plans.js) and on ground it can stand on - its floor on the
// highest ground under it, its footing run down into the lowest - or to the nearest such place, or it is left out and
// said so (userData.left). dev\world\world_audit.py measures the result from outside, on the page's own placements.
import * as THREE from 'three';
import { arrive } from './arrive.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gltfLoader } from '../gltf.js';
import { receiveSun } from '../backdrops/sunshadow.js';
import { makePlans, placeRing } from './plans.js';

const lin = (hex) => new THREE.Color(hex);
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

// ---- materials: matte, coloured per vertex so each building is one draw ----
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
MAT.onBeforeCompile = (sh) => {        // (a little grain on everything, so no face is flat colour)
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp2;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp2;\nfloat gr(vec3 p){return fract(sin(dot(floor(p), vec3(12.9898,78.233,37.719)))*43758.5453);}')
    .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.86 + 0.16 * gr(vWp2 * 9.0) + 0.06 * gr(vWp2 * 1.7);');
};

function paint(geo, color) {
  const c = lin(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.index) geo = geo.toNonIndexed();
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
const box = (w, h, d, x, y, z, color, ry = 0) => paint(new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z), color);
const cyl = (r0, r1, h, x, y, z, color, seg = 8) => paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z), color);
const merge = (parts) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
// (a block from the floor line down into the ground: what a building stands on where the land falls away under it)
const down = (w, d, top, depth, x, z, color) => box(w, top + depth, d, x, (top - depth) / 2, z, color);

// What of some parts comes under 2.6 m, as a rectangle of the kit's own frame: a triangle that dips under 2.6 m counts
// whole - the rule the models' outlines are made by (dev\world\tools\plan_mask.py), so the page's outlines and the
// audit's agree. A log cabin's eaves hang lower than that: its outline is its roof's.
const LOW = 2.6;
function under(parts) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const g of parts) {
    const p = g.attributes.position;
    for (let i = 0; i + 2 < p.count; i += 3) {
      if (Math.min(p.getY(i), p.getY(i + 1), p.getY(i + 2)) >= LOW) continue;
      for (let k = i; k < i + 3; k++) { x0 = Math.min(x0, p.getX(k)); x1 = Math.max(x1, p.getX(k)); z0 = Math.min(z0, p.getZ(k)); z1 = Math.max(z1, p.getZ(k)); }
    }
  }
  return x1 < x0 ? null : [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}
const disc = (r, n = 16) => Array.from({ length: n }, (_, i) => [Math.cos(2 * Math.PI * i / n) * r, Math.sin(2 * Math.PI * i / n) * r]);
// a kit: its geometry, its outline (rings of its own frame), how deep its footing runs under its floor line (0: it
// stands on legs or lies on the ground), how far off the woods keep, its height
const kit = (groups, o = {}) => ({ geo: merge(groups.flat()), plan: (o.plan ?? groups.map(under)).filter(Boolean), foot: o.foot ?? 0, keep: o.keep ?? 6.5, h: o.h ?? 3, solid: o.solid !== false, fence: !!o.fence });

// a gable roof over a w x d plan, ridge along x, from wall top y0 rising h, overhanging o, thickness t
function gable(w, d, y0, h, o, t, color) {
  const W = w / 2 + o, D = d / 2 + o, g = new THREE.BufferGeometry();
  const v = [
    // two slopes (top faces) and their undersides
    -W, y0, D, W, y0, D, W, y0 + h, 0, -W, y0, D, W, y0 + h, 0, -W, y0 + h, 0,
    W, y0, -D, -W, y0, -D, -W, y0 + h, 0, W, y0, -D, -W, y0 + h, 0, W, y0 + h, 0,
    -W, y0 - t, D, W, y0 + h - t, 0, W, y0 - t, D, -W, y0 - t, D, -W, y0 + h - t, 0, W, y0 + h - t, 0,
    W, y0 - t, -D, -W, y0 + h - t, 0, -W, y0 - t, -D, W, y0 - t, -D, W, y0 + h - t, 0, -W, y0 + h - t, 0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  return paint(g, color);
}
// the gable ends' triangles (the wall under the roof), w wide at y0, rising h
function gableEnds(w, d, y0, h, color) {
  const g = new THREE.BufferGeometry(), W = w / 2, D = d / 2;
  const v = [-W, y0, -D, -W, y0, D, -W, y0 + h, 0, W, y0, D, W, y0, -D, W, y0 + h, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  return paint(g, color);
}
// log walls: round logs stacked, the corners crossing (v oblo), w along x, d along z, n courses
function logWalls(w, d, n, r, color, color2) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const y = r + k * r * 1.8, c = k % 2 ? color : color2;
    if (k % 2) {
      parts.push(paint(new THREE.CylinderGeometry(r, r, w + 0.5, 7).rotateZ(Math.PI / 2).translate(0, y, d / 2), c));
      parts.push(paint(new THREE.CylinderGeometry(r, r, w + 0.5, 7).rotateZ(Math.PI / 2).translate(0, y, -d / 2), c));
    } else {
      parts.push(paint(new THREE.CylinderGeometry(r, r, d + 0.5, 7).rotateX(Math.PI / 2).translate(w / 2, y + r * 0.9, 0), c));
      parts.push(paint(new THREE.CylinderGeometry(r, r, d + 0.5, 7).rotateX(Math.PI / 2).translate(-w / 2, y + r * 0.9, 0), c));
    }
  }
  parts.push(box(w - 0.1, n * r * 1.8, d - 0.1, 0, n * r * 0.9, 0, color2));   // (the gaps between logs, filled)
  return parts;
}
// a window: dark glass (mica, in a poor house), a frame, carved white surrounds (nalichniki) on a rich one
function windowOn(x, y, z, ry, carved, color) {
  const parts = [box(0.7, 0.8, 0.06, 0, 0, 0, '#1c1f22'), box(0.82, 0.08, 0.08, 0, 0.44, 0.01, color), box(0.82, 0.08, 0.08, 0, -0.44, 0.01, color),
    box(0.08, 0.9, 0.08, 0.41, 0, 0.01, color), box(0.08, 0.9, 0.08, -0.41, 0, 0.01, color)];
  if (carved) parts.push(box(1.1, 0.3, 0.06, 0, 0.62, 0.02, '#e8e4d8'), box(1.0, 0.12, 0.08, 0, -0.55, 0.02, '#e8e4d8'),
    box(0.1, 1.0, 0.05, 0.52, 0, 0.02, '#e8e4d8'), box(0.1, 1.0, 0.05, -0.52, 0, 0.02, '#e8e4d8'), box(0.44, 0.9, 0.04, 0.8, 0, 0.0, '#5b7a8f'), box(0.44, 0.9, 0.04, -0.8, 0, 0.0, '#5b7a8f'));
  const g = merge(parts);
  return g.rotateY(ry).translate(x, y, z);
}

// ---- the buildings, each built once. A building's floor line is its own y = 0; under it a footing runs FOOT m down
// (field stone under a rich house, the banked earth and corner stones of a poor one), so on falling ground its floor
// stands on the highest ground under it and nothing of it hangs in the air. Its own +x is the gable end with the
// windows (the end a cabin shows the street), its +z the long side with the door.
const FOOT = 1.5;
function izba(rich = false) {
  const w = rich ? 8.5 : 6, d = rich ? 7 : 5.5, n = rich ? 11 : 9, r = 0.13, wallH = n * r * 1.8;
  const logs = rich ? '#8a6a48' : '#6e5a45', logs2 = rich ? '#7c5e40' : '#62503d';
  const house = logWalls(w, d, n, r, logs, logs2);
  house.push(gableEnds(w + 0.3, d, wallH, rich ? 2.6 : 2.4, rich ? '#7d6448' : '#5f4e3c'));
  if (rich) {
    house.push(gable(w, d, wallH + 0.05, 2.6, 0.5, 0.06, '#5d7d64'));                 // (painted iron, green)
    house.push(box(0.6, 1.6, 0.6, w * 0.2, wallH + 2.0, 0, '#9a5a44'));                // (a brick chimney)
    house.push(down(w + 0.4, d + 0.4, 0.5, FOOT, 0, 0, '#8d8a80'));                   // (a stone footing)
  } else {
    house.push(gable(w, d, wallH + 0.05, 2.4, 0.6, 0.35, '#a99560'));                 // (thatch, thick and greyed)
    house.push(box(w + 1.2, 0.25, 0.5, 0, wallH + 2.45, 0, '#8e7d50'));               // (the ridge's straw roll)
    house.push(down(w + 0.3, d + 0.3, 0.06, FOOT, 0, 0, '#5c5346'));                  // (the earth banked against the bottom logs, on field stones)
  }
  // windows on the street (gable) end and the long side; a porch and door
  // (the rich house's three, 2.1 m apart: each has a shutter 0.44 m wide open either side of it, out to 1.02 m from its
  // middle. At 1.8 m apart with shutters of 0.55 m, each window's shutters lay over its neighbour's, one blue band
  // from end to end of the wall - seen 12 Nov 2026)
  for (const s of rich ? [-2.1, 0, 2.1] : [-0.9, 0.9]) house.push(windowOn(w / 2 + 0.2, wallH * 0.55, s, Math.PI / 2, rich, rich ? '#e8e4d8' : '#4a3c2e'));
  house.push(windowOn(0, wallH * 0.55, d / 2 + 0.2, 0, rich, rich ? '#e8e4d8' : '#4a3c2e'));
  house.push(box(1.0, 1.9, 0.08, -w / 2 + 1.2, 1.05, d / 2 + 0.2, '#3d3125'));
  const porch = [down(1.8, 1.4, 0.3, FOOT, -w / 2 + 1.2, d / 2 + 0.8, '#6b5a44')];
  return kit([house, porch], { foot: FOOT, h: wallH + (rich ? 2.6 : 2.4) });
}
function bathhouse() {
  const parts = logWalls(3.2, 3, 7, 0.12, '#5e4c3a', '#54443a');
  parts.push(gableEnds(3.4, 3, 1.5, 1.3, '#4e4034'), gable(3.2, 3, 1.55, 1.3, 0.4, 0.12, '#6c6450'), box(0.35, 0.8, 0.35, 1, 2.6, 0.6, '#4a4440'), down(3.4, 3.2, 0.05, 1.2, 0, 0, '#5c5346'));
  return kit([parts], { foot: 1.2, h: 2.9 });
}
function barn() {
  const parts = [down(9, 6, 3.8, 1.4, 0, 0, '#6f5b44')];
  parts.push(gableEnds(9.02, 6, 3.8, 2.6, '#655140'), gable(9, 6, 3.8, 2.6, 0.5, 0.08, '#77705f'), box(2.6, 3, 0.1, 0, 1.5, 3.02, '#4e3f30'));
  return kit([parts], { foot: 1.4, h: 6.4 });
}
function church() {
  // a wooden church: the log nave, an octagon on a square, a tent roof, a little onion dome and cross; a porch (its
  // door, at the west end: the nave's own -z is the altar's end)
  const nave = logWalls(7, 7, 14, 0.15, '#6c5640', '#5f4c38');
  const oct = paint(new THREE.CylinderGeometry(2.8, 3.2, 5, 8).translate(0, 6.2, 0), '#6a553f');
  const tent = paint(new THREE.ConeGeometry(3.1, 9, 8).translate(0, 13.2, 0), '#7c7466');
  const drum = paint(new THREE.CylinderGeometry(0.45, 0.5, 1.4, 10).translate(0, 18.2, 0), '#6a553f');
  const onion = paint(new THREE.SphereGeometry(0.85, 12, 10).scale(1, 1.25, 1).translate(0, 19.5, 0), '#5c6f72');
  const tip = paint(new THREE.ConeGeometry(0.35, 1.0, 10).translate(0, 20.8, 0), '#5c6f72');
  nave.push(oct, tent, drum, onion, tip, box(0.08, 2.0, 0.08, 0, 22.2, 0, '#c9a94e'), box(0.9, 0.08, 0.08, 0, 22.6, 0, '#c9a94e'), box(0.6, 0.08, 0.08, 0, 22.0, 0, '#c9a94e'), down(7.3, 7.3, 0.05, FOOT, 0, 0, '#77736a'));
  const porch = [down(3.4, 3.4, 3.2, FOOT, 0, 5.2, '#6c5640'), gable(3.4, 3.4, 3.2, 1.6, 0.3, 0.08, '#7c7466').rotateY(Math.PI / 2).translate(0, 0, 5.2)];
  return kit([nave, porch], { foot: FOOT, h: 23 });
}
function chapel() {
  const parts = logWalls(3, 3, 9, 0.12, '#6c5640', '#5f4c38');
  parts.push(paint(new THREE.ConeGeometry(2.4, 3.2, 4).rotateY(Math.PI / 4).translate(0, 3.6, 0), '#7c7466'));
  parts.push(paint(new THREE.SphereGeometry(0.4, 10, 8).scale(1, 1.3, 1).translate(0, 5.4, 0), '#5c6f72'), box(0.06, 1.2, 0.06, 0, 6.3, 0, '#c9a94e'), box(0.6, 0.06, 0.06, 0, 6.6, 0, '#c9a94e'), down(3.2, 3.2, 0.05, 1.2, 0, 0, '#77736a'));
  return kit([parts], { foot: 1.2, h: 6.9 });
}
function wellSweep() {       // (zhuravl: a forked post, a long pole with a weight at its low end, the bucket hung over the shaft)
  const post = [cyl(0.15, 0.18, 5.4, 0, -0.8, 0, '#5a4a38')];
  const shaft = [down(1.2, 1.2, 0.7, 0.8, 2.9, 2.9, '#5f4e3c'), box(0.04, 3.9, 0.04, 2.9, 4.45, 2.9, '#3a3a36'), cyl(0.18, 0.15, 0.35, 2.9, 2.15, 2.9, '#5a4a38')];
  // (the pole pivots at 4.6 m: its low end and the weight on it pass over a walker's head, 2.8 m up)
  const pole = [paint(new THREE.CylinderGeometry(0.07, 0.1, 9, 6).rotateZ(-1.15).translate(0, 4.6, 0).rotateY(-Math.PI / 4), '#6b5a45'), box(0.5, 0.5, 0.5, -2.9, 3.05, -2.9, '#5a5a55')];
  return kit([post, shaft, pole], { plan: [under(post), under(shaft)], keep: 3, h: 6.4 });
}
function haystack() {         // (a stog: hay stacked round its pole - broad at the foot, swelling a little, drawn in to a rounded top)
  const prof = [[2.0, -0.7], [2.1, 0.0], [2.3, 0.9], [2.32, 1.5], [2.15, 2.4], [1.75, 3.3], [1.2, 4.05], [0.6, 4.65], [0.12, 5.0], [0.0, 5.05]];
  const hay = paint(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14), '#b39a5a');
  return kit([[hay, cyl(0.06, 0.06, 1.0, 0, 4.7, 0, '#5a4a38')]], { plan: [disc(2.32)], foot: 0.7, keep: 4, h: 5.7 });
}
// fences, a panel at a time (2.4 m), so a run follows the ground: each panel stands on its own two stakes
const PANEL = 2.4;
function wattlePanel() {     // (pletni: woven hazel between stakes)
  const parts = [box(PANEL, 1.35, 0.1, 0, 0.425, 0, '#6b5a40')];
  for (const x of [-PANEL / 2, 0, PANEL / 2]) parts.push(cyl(0.05, 0.06, 2.1, x, -0.6, 0, '#5a4a38'));
  return kit([parts], { keep: 1.2, h: 1.5, fence: true });
}
function plankPanel() {      // (a closed yard's fence: boards on two rails, a post at each end)
  const parts = [box(PANEL, 2.25, 0.06, 0, 0.875, 0, '#7a6448'), box(PANEL, 0.1, 0.1, 0, 1.6, 0.07, '#6a553c'), box(PANEL, 0.1, 0.1, 0, 0.4, 0.07, '#6a553c')];
  for (const x of [-PANEL / 2, PANEL / 2]) parts.push(box(0.14, 2.7, 0.14, x, 0.75, 0.09, '#5f4c36'));
  return kit([parts], { keep: 1.2, h: 2.1, fence: true });
}
// a post mill: the body turns on its post, which stands in a trestle of cross-trees and struts; a tail pole behind
const MILL = { hub: 8.2, arm: 6.2 };
function windmillBody() {
  const parts = [cyl(0.4, 0.5, 4.6, 0, -0.6, 0, '#5a4a38'), box(4, 5, 4.5, 0, 6.5, 0, '#6e5a44'), gableEnds(4.02, 4.5, 9, 2, '#665240').rotateY(Math.PI / 2),
    gable(4, 4.5, 9, 2, 0.3, 0.08, '#7a7266').rotateY(Math.PI / 2), box(0.3, 0.3, 6, 0, 3.5, -4, '#5a4a38'), box(1.4, 0.15, 2.6, 0, 3.8, -3.3, '#5f4e3c')];
  // (the trestle: two cross-trees on the ground, a strut from each end up to the post)
  for (const a of [0, Math.PI / 2]) {
    parts.push(box(5.2, 0.9, 0.36, 0, 0.0, 0, '#54453a', a));
    for (const s of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(0.13, 0.15, 3.6, 6).rotateZ(s * 0.72).translate(s * 1.2, 1.65, 0).rotateY(a), '#5a4a38'));
  }
  // (its outline is what stands on the ground: the two cross-trees; the body, 4 m up, and the tail pole pass overhead)
  return kit([parts], { plan: [[[-2.6, -0.2], [2.6, -0.2], [2.6, 0.2], [-2.6, 0.2]], [[-0.2, -2.6], [0.2, -2.6], [0.2, 2.6], [-0.2, 2.6]]], keep: 9, h: 11 });
}
function windmillSails() {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const arm = merge([box(0.2, MILL.arm, 0.2, 0, MILL.arm / 2, 0, '#5f4e3c'), box(1.5, MILL.arm - 1.5, 0.05, 0.85, MILL.arm / 2 + 0.6, 0, '#8a7a5e')]);
    parts.push(arm.rotateZ(a));
  }
  return merge(parts);
}
function dock(len) {          // (planks on piles running out over the water, along its own +z from the bank)
  const parts = [];
  for (let z = 0; z <= len; z += 2) parts.push(cyl(0.12, 0.14, 5.5, -0.9, -4.5, z, '#4a3c2e'), cyl(0.12, 0.14, 5.5, 0.9, -4.5, z, '#4a3c2e'));
  for (let z = -0.1; z <= len; z += 0.32) parts.push(box(2.2, 0.06, 0.28, 0, 0.98, z, '#7a6a52'));
  return kit([parts], { keep: 2, h: 1, solid: false });
}
function rowboat() {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.15 + 0.55 * Math.sin(t * Math.PI / 2), t * 0.55)); }
  const hull = paint(new THREE.LatheGeometry(pts, 12, 0, Math.PI).rotateZ(Math.PI).scale(1, 1, 3.2).translate(0, 0.55, 0), '#5b4a36');
  return kit([[hull, box(1.1, 0.06, 0.25, 0, 0.45, 0, '#6e5c44')]], { keep: 0, h: 0.6, solid: false });
}
function netRack() {
  return kit([[cyl(0.05, 0.06, 2.8, -2, -0.6, 0, '#4a3c2e'), cyl(0.05, 0.06, 2.8, 2, -0.6, 0, '#4a3c2e'), box(4.2, 0.06, 0.06, 0, 2.1, 0, '#4a3c2e'),
    box(3.6, 1.6, 0.02, 0, 1.25, 0, '#6d6a5c')]], { keep: 2, h: 2.2 });
}
function fisherHut() {       // (its window, on its own +z, looks at the water)
  const parts = logWalls(4.5, 4, 8, 0.12, '#5e4c3a', '#54443a');
  parts.push(gableEnds(4.7, 4, 1.75, 1.8, '#4e4034'), gable(4.5, 4, 1.8, 1.8, 0.6, 0.3, '#8e8058'), windowOn(0, 1.0, 2.2, 0, false, '#3a3024'), down(4.7, 4.2, 0.05, 1.2, 0, 0, '#5c5346'));
  return kit([parts], { foot: 1.2, h: 3.6 });
}
function postStation() {     // (the station house, its door and windows on its own +z, to the road; the stable at its side)
  const house = logWalls(14, 8, 12, 0.15, '#7a5e42', '#6c5238');
  const wallH = 12 * 0.27;
  house.push(gableEnds(14.3, 8, wallH, 3, '#6a553f'), gable(14, 8, wallH + 0.05, 3, 0.6, 0.08, '#6a6a62'), down(14.3, 8.3, 0.05, 1.4, 0, 0, '#77736a'));
  for (const x of [-4.5, -1.5, 1.5, 4.5]) house.push(windowOn(x, wallH * 0.55, 4.2, 0, true, '#e8e4d8'));
  house.push(box(1.2, 2.2, 0.08, 0, 1.2, 4.2, '#3d3125'));
  const stable = [down(6, 10, 3.2, 1.4, 12, -2, '#6f5b44'), gable(6, 10, 3.2, 1.8, 0.4, 0.08, '#77705f').rotateY(Math.PI / 2).translate(12, 0, -2)];
  return kit([house, stable], { foot: 1.4, h: 6.3 });
}
function verstPost() {        // (black and white stripes, the verst number on a board)
  const parts = [box(0.2, 0.6, 0.2, 0, -0.3, 0, '#1c1c1c', Math.PI / 4)];
  for (let k = 0; k < 7; k++) parts.push(box(0.22, 0.4, 0.22, 0, 0.2 + k * 0.4, 0, k % 2 ? '#1c1c1c' : '#ecebe6', Math.PI / 4));
  parts.push(box(0.5, 0.35, 0.05, 0, 2.4, 0.14, '#ecebe6'));
  return kit([parts], { keep: 0, h: 2.8 });
}
function huntStand() {        // (the hunting tower's stand-in while its model loads: four poles, a floor, a roof)
  const parts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.2, 8.2, 0.2, sx * 1.4, 3.5, sz * 1.4, '#8a8072'));
  parts.push(box(2.8, 0.15, 2.8, 0, 5.0, 0, '#7a6e60'), box(2.6, 1.0, 2.6, 0, 5.6, 0, '#8a8072'), box(3.2, 0.2, 3.2, 0, 7.0, 0, '#6a645c'));
  return kit([parts], { plan: [[[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]], foot: 0.6, keep: 4, h: 7.2 });
}
function stoneIdol() {         // (a kamennaya baba: a weathered stone figure on the mound)
  return kit([[box(0.7, 1.9, 0.45, 0, 0.45, 0, '#8a8478'), paint(new THREE.SphereGeometry(0.33, 10, 8).scale(1, 1.15, 0.9).translate(0, 1.65, 0), '#8a8478'),
    box(0.75, 0.15, 0.5, 0, 1.0, 0.03, '#7c766a')]], { foot: 0.5, keep: 0, h: 2 });
}

/** The points of interest. plans: the world's list of outlines (world/plans.js: every thing set down here joins it, and
 *  is tried against what stands in it); shapes: the models' own outlines (plans.json), for the kits a model stands in
 *  for. Returns a group (the near scene) with userData.update(cameraPos) (the fairies, the sails), userData.left (what
 *  found no place, and why) and userData.solid (empty: the walker is kept out by the outlines themselves). */
export function buildPOIs(world, U, { plans = makePlans(), shapes = {} } = {}) {
  const group = new THREE.Group(); group.name = 'pois';
  receiveSun(MAT, U);                     // (the sun's shadows on every house and prop: sunshadow.js)
  const J = world.json, animate = [], left = [];
  const kits = { izba: izba(false), izbaRich: izba(true), bath: bathhouse(), barn: barn(), church: church(), chapel: chapel(), well: wellSweep(),
    hay: haystack(), wattle: wattlePanel(), fence: plankPanel(), mill: windmillBody(), dock: dock(14), boat: rowboat(), nets: netRack(),
    fisher: fisherHut(), post: postStation(), verst: verstPost(), idol: stoneIdol(), hunt: huntStand() };
  const lists = Object.fromEntries(Object.keys(kits).map((k) => [k, []]));
  // The models made in ComfyUI and Blender (my route for complex buildings: ComfyUI, refined in Blender, textured again
  // in ComfyUI; props by `objects`), each taking its stand-in's place: assets/world/models/<file>, its floor line at 0.
  // MODELED: the files for a kit (several: each copy takes one by its place) and how far each is turned to face as its
  // stand-in does (yaw, radians). A kit whose model has an outline in plans.json is set down by the model's outline,
  // not the stand-in's.
  const MODELED = {
    // (the country churches in brick, after my reference chapel: dev\world\chapel_kit.py in Blender, ComfyUI's tiles)
    church: [{ file: 'church-brick.glb', yaw: 0 }],
    chapel: [{ file: 'chapel-brick.glb', yaw: 0 }],
    izba: [{ file: 'izba.glb', yaw: Math.PI }, { file: 'izba-b.glb', yaw: Math.PI / 2 }],
    // (the hunting tower: dev\world\models\hunting_tower.py in Blender, ComfyUI's pine, planks and shingles)
    hunt: [{ file: 'hunting-tower.glb', yaw: 0 }],
  };
  const stem = (f) => f.replace(/\.glb$/, '');
  const pickOf = (x, z, n) => Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)) % n;
  // (the model that will stand at (x, z) for a kit, if its outline is known: { shape, turn, file })
  const modelAt = (name, x, z) => {
    const ok = (MODELED[name] ?? []).filter((f) => shapes[stem(f.file)]);
    if (!ok.length) return null;
    const f = ok[ok.length === 1 ? 0 : pickOf(x, z, ok.length)];
    return { shape: shapes[stem(f.file)], turn: f.yaw ?? 0, file: f.file };
  };

  // ---- the ground, the water, the ways, as a thing asks of them
  const wet = (x, z) => { const w = world.waterAt(x, z); return w !== null && w - world.heightAt(x, z) > 0.02; };
  const wayGap = (x, z, R = 12) => world.ways?.clearance?.(x, z, R) ?? 1e9;
  const walk = (rings, step = 0.5) => {
    const pts = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return pts;
  };
  // (which place each thing belongs to: a place's things are drawn together, and only when it is in the view and
  // within the machine's reach for it - world/farcull.js, hardware.js placesFar)
  let PLACE = '-';
  let serial = 0;

  /** Can a thing stand at (x, z), turned ry? Its outline there and the height it stands at, or why not. o: wet (may
   *  stand in water), way (m to keep off a way's edge; null: none), gap (m off what stands), fall (how much the
   *  ground may fall under a thing with no footing), pick (which standing things count). */
  const tryAt = (name, x, z, ry, s, o) => {
    const K = kits[name], M = modelAt(name, x, z);
    const rings = M ? M.shape.rings.map((r) => placeRing(r, x, z, ry + M.turn, s)) : K.plan.map((r) => placeRing(r, x, z, ry, s));
    const pts = walk(rings); pts.push([x, z]);
    let lo = 1e9, hi = -1e9;
    for (const [qx, qz] of pts) {
      if (!o.wet && wet(qx, qz)) return 'water';
      if (o.way !== null && wayGap(qx, qz) < (o.way ?? 1.0)) return 'a way';
      const g = world.heightAt(qx, qz); lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    // (a footing - a metre or more under the floor line all round - takes the fall of the ground under it, less a
    // hand; with none, or on legs, the thing stands on the lowest ground under it and the ground may rise against
    // it only a little)
    const foot = (M ? Math.max(0, M.shape.foot ?? 0) : K.foot) * s;
    if (hi - lo > (foot > 1.0 ? foot - 0.2 : o.fall ?? 0.45)) return 'the fall of the ground';
    const hit = plans.hits(rings, o.gap ?? 0.6, o.pick);
    if (hit) return 'what stands there (' + hit.key + ')';
    return { rings, y: foot > 1.0 ? hi + 0.04 : lo - 0.04, M };
  };
  /** Set a thing down at (x, z) or the nearest place it can stand within o.reach (m). Returns its place {x, y, z, ry, s}, or null (left out, and said). */
  const set = (name, x, z, ry = 0, s = 1, o = {}) => {
    let at = o.where && !o.where(x, z) ? 'too near something it keeps off' : tryAt(name, x, z, ry, s, o), px = x, pz = z;
    const why = at;
    if (typeof at === 'string') {
      at = null;
      const reach = o.reach ?? 10;
      search: for (let d = 1.5; d <= reach; d += 1.5) {
        const n = Math.max(8, Math.round(2 * Math.PI * d / 1.6));
        for (let k = 0; k < n; k++) {
          const a = 2 * Math.PI * k / n + (o.from ?? 0), qx = x + Math.cos(a) * d, qz = z + Math.sin(a) * d;
          if (o.where && !o.where(qx, qz)) continue;
          const t = tryAt(name, qx, qz, ry, s, o);
          if (typeof t !== 'string') { at = t; px = qx; pz = qz; break search; }
        }
      }
    }
    if (!at) { left.push({ kit: name, place: PLACE, x: Math.round(x), z: Math.round(z), why }); return null; }
    const K = kits[name], it = { x: px, y: o.y ?? at.y, z: pz, ry, s, place: PLACE, sx: o.sx, tilt: o.tilt };
    lists[name].push(it);
    it.plan = plans.add('pois:' + name + '#' + (serial++), at.rings, [], { group: 'pois', keep: K.keep, h: (at.M ? at.M.shape.height ?? K.h : K.h) * s, solid: K.solid });
    if (it.plan) it.plan.fence = K.fence;
    return it;
  };
  /** A fence from a to b: panels end to end, each on its own ground and leaning with it. A panel that would stand in
   *  water, on a way or through a thing is left out (the run has a gap there). */
  const skipped = [];                                // (fence panels left out, and why: the audit reads them)
  const fence = (name, ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / PANEL));
    if (L < 0.9) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L, len = L / n, ry = Math.atan2(-uz, ux), plan = kits[name].plan[0];
    for (let k = 0; k < n; k++) {
      const x0 = ax + ux * len * k, z0 = az + uz * len * k, x1 = x0 + ux * len, z1 = z0 + uz * len, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const g0 = world.heightAt(x0, z0), g1 = world.heightAt(x1, z1), sx = len / PANEL;
      // (its middle must be clear of everything, other fences too; its last 0.6 m at either end may meet a wall, a
      // roof's edge or the next fence)
      const half = Math.max(0.15, len / 2 - 0.62), z1p = plan[2][1];
      const out = (why) => skipped.push({ kit: name, place: PLACE, x: Math.round(mx * 10) / 10, z: Math.round(mz * 10) / 10, why });
      let hit = plans.hits([placeRing([[-half, -z1p], [half, -z1p], [half, z1p], [-half, z1p]], mx, mz, ry, 1)], 0.03);
      if (hit) { out((hit.fence ? 'across ' : 'through ') + hit.key); continue; }
      // (nor beside a fence that already runs the same way within a pace: neighbours share the one between them)
      hit = plans.hits([placeRing([[-half, -1.1], [half, -1.1], [half, 1.1], [-half, 1.1]], mx, mz, ry, 1)], 0.03, (q) => q.fence && q.dir && Math.abs(q.dir[0] * ux + q.dir[1] * uz) > 0.9);
      if (hit) { out('beside ' + hit.key); continue; }
      let bad = null;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) { const qx = x0 + (x1 - x0) * t, qz = z0 + (z1 - z0) * t; if (wet(qx, qz)) { bad = 'water'; break; } if (wayGap(qx, qz) < 0.3) { bad = 'a way'; break; } }
      if (bad) { out(bad); continue; }
      const ring = placeRing(plan.map(([px, pz]) => [px * sx, pz]), mx, mz, ry, 1);
      const it = { x: mx, y: (g0 + g1) / 2, z: mz, ry, s: 1, sx, tilt: Math.atan2(g1 - g0, len), place: PLACE };
      lists[name].push(it);
      it.plan = plans.add('pois:' + name + '#' + (serial++), [ring], [], { group: 'pois', keep: kits[name].keep, h: kits[name].h });
      it.plan.fence = true; it.plan.dir = [ux, uz];
    }
  };
  // (the ground the woods leave open: the villages' yards and the room round each stack; and no tree nearer a wall
  // than its crown would reach - world/plans.js keepAt. woods.js asks world.clearAt before it plants a tree)
  const CLR = new Map(), CC = 16;
  const clear = (x, z, r) => {
    for (let j = Math.floor((z - r) / CC); j <= Math.floor((z + r) / CC); j++) for (let i = Math.floor((x - r) / CC); i <= Math.floor((x + r) / CC); i++) {
      const k = i + ',' + j; let a = CLR.get(k); if (!a) CLR.set(k, (a = [])); a.push(x, z, r);
    }
  };
  world.clearAt = (x, z) => {
    if (plans.keepAt(x, z)) return true;
    const a = CLR.get(Math.floor(x / CC) + ',' + Math.floor(z / CC));
    if (a) for (let n = 0; n < a.length; n += 3) if ((x - a[n]) ** 2 + (z - a[n + 1]) ** 2 < a[n + 2] ** 2) return true;
    return false;
  };

  // ---- the ways that pass a place: the arms that lead away from its middle
  const armsAt = (x0, z0, R = 30, L = 170) => {
    const out = [];
    for (const w of world.ways?.ways ?? []) {
      if (w.kind === 'street' || w.kind === 'lane') continue;
      let bi = -1, bd = R;
      for (let i = 0; i < w.pts.length; i++) { const d = Math.hypot(w.pts[i][0] - x0, w.pts[i][1] - z0); if (d < bd) { bd = d; bi = i; } }
      if (bi < 0) continue;
      for (const dir of [1, -1]) {
        const arm = [w.pts[bi]]; let len = 0;
        for (let i = bi + dir; i >= 0 && i < w.pts.length && len < L; i += dir) { len += Math.hypot(w.pts[i][0] - arm[arm.length - 1][0], w.pts[i][1] - arm[arm.length - 1][1]); arm.push(w.pts[i]); }
        if (len < 25) continue;
        // (where it heads: toward its point 40 m out)
        let far = arm[arm.length - 1], run = 0;
        for (let i = 1; i < arm.length; i++) { run += Math.hypot(arm[i][0] - arm[i - 1][0], arm[i][1] - arm[i - 1][1]); if (run >= 40) { far = arm[i]; break; } }
        const dl = Math.hypot(far[0] - arm[0][0], far[1] - arm[0][1]) || 1;
        out.push({ pts: arm, w: w.w, len, dir: [(far[0] - arm[0][0]) / dl, (far[1] - arm[0][1]) / dl] });
      }
    }
    return out;
  };
  /** A place's street: the two arms that best carry on from each other through its middle (the widest, the straightest),
   *  as points a metre apart with s = 0 at the middle; { at(s) -> [x, z, tx, tz], lo, hi, hw }. A way that only comes
   *  in and ends carries straight on, as a street with no track. */
  const streetAt = (x0, z0, L = 170) => {
    const arms = armsAt(x0, z0, 30, L);
    if (!arms.length) return null;
    let best = null;
    for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i], b = arms[j], cos = a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1];
      const score = -cos * 100 + (a.w + b.w) * 6 + Math.min(a.len, b.len) * 0.1;
      if (cos < -0.5 && (!best || score > best.score)) best = { a, b, score };
    }
    let A, B, hw;
    if (best) { A = best.a.pts; B = best.b.pts; hw = Math.max(best.a.w, best.b.w) / 2; }
    else {
      const a = arms.reduce((m, q) => (q.w * 10 + q.len > m.w * 10 + m.len ? q : m));
      A = a.pts; hw = a.w / 2;
      B = [a.pts[0]]; for (let d = 6; d <= L; d += 6) B.push([a.pts[0][0] - a.dir[0] * d, a.pts[0][1] - a.dir[1] * d]);
    }
    const line = [...A.slice().reverse(), ...B.slice(1)];
    // (a point a metre, the run measured from the middle)
    const P = [line[0]], S = [0];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d));
      for (let k = 1; k <= n; k++) { P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); S.push(S[S.length - 1] + d / n); }
    }
    let mi = 0, md = 1e9;
    P.forEach((p, i) => { const d = Math.hypot(p[0] - A[0][0], p[1] - A[0][1]); if (d < md) { md = d; mi = i; } });
    const s0 = S[mi];
    const at = (s) => {
      const t = s + s0; let i = 1;
      while (i < S.length - 1 && S[i] < t) i++;
      const a = P[Math.max(0, i - 3)], b = P[Math.min(P.length - 1, i + 3)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const f = (t - S[i - 1]) / (S[i] - S[i - 1] || 1);
      return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f, (b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
    };
    return { at, lo: -s0, hi: S[S.length - 1] - s0, hw, real: !!best };
  };

  // ---- a village: plots along its street
  const village = (P, R) => {
    const [x0, z0] = P.at, rich = P.style === 'kulak', n = P.houses ?? 10;
    const front = rich ? 36 : 19;                      // (a plot's width along the street)
    const K = kits[rich ? 'izbaRich' : 'izba'], hx = K.plan[0][1][0], hz = K.plan[0][2][1];      // (the house's half length to the street, its half width along it)
    const wall = hx - (rich ? 0.25 : 0.35);            // (its wall's face, inside the eaves' line)
    const st = streetAt(x0, z0) ?? (() => { const a = R() * Math.PI, c = Math.cos(a), s = Math.sin(a); return { at: (q) => [x0 + c * q, z0 + s * q, c, s], lo: -170, hi: 170, hw: 0, real: false }; })();
    const back = st.hw + (rich ? 5.2 : 3.6) + hx;      // (from the street's middle to the house's middle: a strip of grass before the gable)
    const homes = [];
    // (slots out from the middle on both sides of the way, the two sides out of step; the middle itself is left open:
    // ways meet there)
    const slots = [];
    for (let k = 0; k < 40; k++) for (const side of [1, -1]) for (const sign of [1, -1]) {
      const s = sign * (14 + (side > 0 ? 0 : front / 2) + k * front);
      if (s > st.lo + 8 && s < st.hi - 8) slots.push({ s, side, k });
    }
    slots.sort((a, b) => Math.abs(a.s) - Math.abs(b.s));
    for (const sl of slots) {
      if (homes.length >= n) break;
      let it = null, H = null;
      for (const ds of [0, 3, -3, 6, -6]) {
        const [sx, sz, tx, tz] = st.at(sl.s + ds), nx = -tz * sl.side, nz = tx * sl.side;      // (n: from the street to the plot)
        const x = sx + nx * (back + (R() - 0.5) * 0.8), z = sz + nz * (back + (R() - 0.5) * 0.8);
        // (the gable end, the house's own +x, looks at the street)
        const fx = -nx, fz = -nz, ry = Math.atan2(-fz, fx);
        // (the whole plot dry and crossed by no other way: its yard behind the house, its strip of field behind that;
        // and the line its fence takes - with a pace to spare, since a corner shared with a neighbour moves a little -
        // clear of every way from end to end)
        let open = true;
        const q = (u, v) => { const qx = x - fz * u - fx * v, qz = z + fx * u - fz * v; return !wet(qx, qz) && wayGap(qx, qz) >= 1.0; };
        for (let v = -hx + 1.5; v <= (rich ? 27 : 30) && open; v += 2.5) for (let u = -front / 2 + 0.5; u <= front / 2 - 0.5; u += 3) if (!q(u, v)) { open = false; break; }
        const vF = -(hx - (rich ? 0.25 : 0.35)), vB = rich ? 25.5 : 16;
        for (let t = 0; t <= 1 && open; t += 0.02) {
          const u = -front / 2 + front * t, v = vF + (vB - vF) * t;
          if (!q(u, vF) || !q(u, vB) || !q(-front / 2, v) || !q(front / 2, v)) open = false;
        }
        if (!open) continue;
        it = set(rich ? 'izbaRich' : 'izba', x, z, ry, 1, { reach: 0, gap: 3.0, way: 1.5 });
        if (it) { H = { it, fx, fz, ux: -fz, uz: fx }; break; }
        left.pop();
      }
      if (!it) continue;
      homes.push(H);
      // the plot, in its own measures: u along the street (the porch's side is +u), v back from the house's middle
      H.at = (u, v) => [it.x + H.ux * u - H.fx * v, it.z + H.uz * u - H.fz * v];
      for (let q = -8; q <= 24; q += 8) clear(...H.at(0, q), front / 2 + 3);
      // (the kulak's barn behind his house, its doors - on its own +z - to the yard)
      if (rich) { const b = H.at(0, 17.2); set('barn', b[0], b[1], Math.atan2(H.fx, H.fz), 1, { reach: 6, gap: 2.0, way: 1.5 }); }
    }
    // the yards. Each plot's four corners in its own measures; where two plots lie side by side the corners between
    // them are one pair, halfway, and the fence between them is built once: neighbours share it (each plot had been
    // fenced as its own rectangle - along a bending street two fences ran side by side a hand apart and crossed)
    {
      const hw = front / 2, vf = -wall, vb = rich ? 25.5 : 16, kind = rich ? 'fence' : 'wattle', gate = rich ? 4.8 : 2.6;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const H of homes) { H.c = { fl: H.at(-hw, vf), fr: H.at(hw, vf), bl: H.at(-hw, vb), br: H.at(hw, vb) }; H.mine = { l: true, r: true }; H.met = {}; }
      for (const A of homes) for (const sa of ['l', 'r']) {
        if (A.met[sa]) continue;
        const am = mid(A.c['f' + sa], A.c['b' + sa]);
        let best = null;
        for (const B of homes) if (B !== A) for (const sb of ['l', 'r']) {
          if (B.met[sb]) continue;
          const bm = mid(B.c['f' + sb], B.c['b' + sb]), d = Math.hypot(am[0] - bm[0], am[1] - bm[1]);
          if (d < front * 0.45 && (!best || d < best.d)) best = { B, sb, d };
        }
        if (!best) continue;
        const B = best.B, sb = best.sb;
        A.c['f' + sa] = B.c['f' + sb] = mid(A.c['f' + sa], B.c['f' + sb]);
        A.c['b' + sa] = B.c['b' + sb] = mid(A.c['b' + sa], B.c['b' + sb]);
        A.met[sa] = B.met[sb] = true; B.mine[sb] = false;
      }
      const run = (a, b) => fence(kind, a[0], a[1], b[0], b[1]);
      for (const H of homes) {
        // along the street, in line with the gable's wall, to the house's corners; a gate's gap on the porch's side
        // (the kulak's a cart gate); down the sides and along the back
        run(H.c.fl, H.at(-hz + 0.2, vf)); run(H.at(hz + gate, vf), H.c.fr);
        if (H.mine.r) run(H.c.fr, H.c.br);
        run(H.c.br, H.c.bl);
        if (H.mine.l) run(H.c.bl, H.c.fl);
      }
      // (a stack in the field behind each yard, well off the house)
      if (!rich) for (const H of homes) if (R() < 0.62) { const h = H.at((R() - 0.5) * 8, 22 + R() * 5); set('hay', h[0], h[1], R() * 6, 0.85 + 0.3 * R(), { reach: 8, gap: 2.5, way: 2.0 }); clear(h[0], h[1], 7); }
    }
    for (let k = homes.length; k < n; k++) left.push({ kit: rich ? 'izbaRich' : 'izba', place: PLACE, x: Math.round(x0), z: Math.round(z0), why: 'no room left along the street' });
    // how far the houses run along the street
    let s0 = 0, s1 = 0;
    for (const sl of slots) { s0 = Math.min(s0, sl.s); s1 = Math.max(s1, sl.s); }
    const far = (x, z) => homes.every((h) => Math.hypot(h.it.x - x, h.it.z - z) > 26);
    if (rich) {
      // the mill: on the highest clear ground 60 to 110 m off, its sails to the open
      let best = null;
      for (let a = 0; a < 6.28; a += 0.26) for (const d of [60, 75, 90, 105]) {
        const x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d;
        if (wet(x, z) || wayGap(x, z, 20) < 12 || world.forestAt(x, z) > 0.4) continue;
        const h = world.heightAt(x, z);
        if (!best || h > best.h) best = { x, z, h, a };
      }
      if (best) {
        const face = Math.atan2(best.x - x0, best.z - z0);          // (its sails look away from the yards)
        const it = set('mill', best.x, best.z, face, 1, { reach: 12, gap: 8, way: 8, fall: 0.6 });
        if (it) { animate.push({ kind: 'sails', x: it.x, y: it.y, z: it.z, ry: face, place: PLACE }); clear(it.x, it.z, 14); }
      } else left.push({ kit: 'mill', place: PLACE, x: Math.round(x0), z: Math.round(z0), why: 'no clear rise' });
    } else {
      // the church: past the last plots, where the ground is evenest; its altar to the east (the world's -x), so its
      // door, on its own +z, looks west
      let best = null;
      for (const s of [s1 + front / 2 + 24, s0 - front / 2 - 24, s1 + front / 2 + 44, s0 - front / 2 - 44]) for (const side of [1, -1]) {
        const [sx, sz, tx, tz] = st.at(Math.max(st.lo + 1, Math.min(st.hi - 1, s))), x = sx - tz * side * (st.hw + 17), z = sz + tx * side * (st.hw + 17);
        let lo = 1e9, hi = -1e9;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const g = world.heightAt(x + i * 8, z + j * 8); lo = Math.min(lo, g); hi = Math.max(hi, g); }
        if (!wet(x, z) && (!best || hi - lo < best.r)) best = { x, z, r: hi - lo };
      }
      if (best) { const it = set('church', best.x, best.z, Math.PI / 2, 1, { reach: 30, gap: 6, way: 3, fall: 0.55 }); if (it) clear(it.x, it.z, 20); }
      // the well: in the street, by the middle
      { const [sx, sz, tx, tz] = st.at(4); set('well', sx - tz * (st.hw + 3.4), sz + tx * (st.hw + 3.4), Math.atan2(tx, tz) + Math.PI * 0.75, 1, { reach: 10, gap: 2.2, way: 0.9, fall: 0.5 }); }
      // the bathhouses: by the water where there is any within 160 m of the village's middle, 5 m back from it;
      // else in a row behind the plots on the lower side, well off the houses
      let bank = null;
      for (let d = 30; d <= 160 && !bank; d += 4) for (let a = 0; a < 6.28; a += 0.2) { const x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d; if (wet(x, z)) { bank = { x, z, a, d }; break; } }
      const baths = [];
      if (bank) {
        // (along the bank: back from the water toward the village, then sideways)
        const bx = Math.cos(bank.a), bz = Math.sin(bank.a);
        for (let k = 0; k < 4; k++) {
          const off = (k - 1.5) * 9.5; let d = bank.d;
          const ox = -bz * off, oz = bx * off;
          while (d > 20 && wet(x0 + bx * d + ox, z0 + bz * d + oz)) d -= 1;
          while (d < 220 && !wet(x0 + bx * (d + 1) + ox, z0 + bz * (d + 1) + oz)) d += 1;
          baths.push([x0 + bx * (d - 6.5) + ox, z0 + bz * (d - 6.5) + oz, Math.atan2(bx, bz)]);
        }
      } else {
        const [sx, sz, tx, tz] = st.at((s0 + s1) / 2), g1 = world.heightAt(sx - tz * 60, sz + tx * 60), g2 = world.heightAt(sx + tz * 60, sz - tx * 60), side = g1 < g2 ? 1 : -1;
        for (let k = 0; k < 4; k++) { const [qx, qz, ux, uz] = st.at((s0 + s1) / 2 + (k - 1.5) * 11); baths.push([qx - uz * side * (st.hw + 56), qz + ux * side * (st.hw + 56), Math.atan2(ux, uz)]); }
      }
      for (const [bx, bz, ry] of baths) { const it = set('bath', bx, bz, ry, 1, { reach: 14, gap: 3, way: 1.5, where: far }); if (it) clear(it.x, it.z, 6); }
    }
  };

  for (const [pi, P] of (J.pois ?? []).entries()) {
    const [x0, z0] = P.at, R = rnd(Math.round(x0 * 7 + z0 * 13));
    PLACE = 'p' + pi;
    if (P.kind === 'village') village(P, R);
    else if (P.kind === 'fisher') {
      // the hut on the bank, its window to the water; the dock from the bank out over the water; the boat afloat
      // beside the dock's outer end; the nets drying on the bank
      const [tx, tz] = P.to_water;
      let d = 0;                                       // (the waterline along the way to the water, from the place's own point)
      while (d > -40 && wet(x0 + tx * d, z0 + tz * d)) d -= 0.5;
      while (d < 40 && !wet(x0 + tx * (d + 0.5), z0 + tz * (d + 0.5))) d += 0.5;
      const bx = x0 + tx * d, bz = z0 + tz * d, ry = Math.atan2(tx, tz);
      const hut = set('fisher', bx - tx * 8.5 + tz * 5, bz - tz * 8.5 - tx * 5, ry, 1, { reach: 12, gap: 2, way: 1.2 });
      const dk = { x: bx - tx * 1.6, y: P.level, z: bz - tz * 1.6, ry, s: 1, place: PLACE };
      lists.dock.push(dk);
      dk.plan = plans.add('pois:dock#' + (serial++), kits.dock.plan.map((r) => placeRing(r, dk.x, dk.z, ry, 1)), [], { group: 'pois', keep: 2, h: 1, solid: false });
      // (the boat where the water is deep enough to float it, along the dock's outer half)
      for (const along of [9.5, 11.5, 7.5, 13, 6]) {
        const qx = dk.x + tx * along + tz * 1.9, qz = dk.z + tz * along - tx * 1.9, w = world.waterAt(qx, qz);
        if (w !== null && w - world.heightAt(qx, qz) > 0.4) {
          const b = { x: qx, y: P.level - 0.35, z: qz, ry: ry + 0.08, s: 1, place: PLACE }; lists.boat.push(b);
          b.plan = plans.add('pois:boat#' + (serial++), kits.boat.plan.map((r) => placeRing(r, b.x, b.z, b.ry, 1)), [], { group: 'pois', keep: 0, h: 0.6, solid: false });
          break;
        }
      }
      if (!lists.boat.some((b) => b.place === PLACE)) left.push({ kit: 'boat', place: PLACE, x: Math.round(bx), z: Math.round(bz), why: 'no water deep enough beside the dock' });
      set('nets', bx - tx * 4.5 - tz * 6.5, bz - tz * 4.5 + tx * 6.5, ry, 1, { reach: 10, gap: 1.2, way: 0.8, fall: 0.5 });      // (the rack along the bank)
      if (hut) clear(hut.x, hut.z, 10);
    } else if (P.kind === 'chapel' || P.kind === 'post_station') {
      // by its way, its door (its own +z) to it: the chapel a few steps off its path, the station across a yard from
      // the post road
      const name = P.kind === 'chapel' ? 'chapel' : 'post';
      let best = null;
      for (const w of world.ways?.ways ?? []) {
        if (w.kind === 'street' || w.kind === 'lane') continue;
        for (let i = 1; i < w.pts.length; i++) {
          const a = w.pts[i - 1], b = w.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x0 - a[0]) * dx + (z0 - a[1]) * dz) / L2)), qx = a[0] + t * dx, qz = a[1] + t * dz, d = Math.hypot(x0 - qx, z0 - qz);
          // (the station wants the road itself: a wide way is taken before a nearer path)
          const score = d - (name === 'post' ? w.w * 12 : 0);
          if (d < 90 && (!best || score < best.score)) best = { qx, qz, d, score, hw: w.w / 2, L: Math.sqrt(L2), dx, dz };
        }
      }
      if (best) {
        // (on the side of the way the place's own point is on)
        let nx = -best.dz / best.L, nz = best.dx / best.L;
        if ((x0 - best.qx) * nx + (z0 - best.qz) * nz < 0) { nx = -nx; nz = -nz; }
        const off = best.hw + (name === 'post' ? 13 : 6.5), ry = Math.atan2(-nx, -nz);
        const it = set(name, best.qx + nx * off, best.qz + nz * off, ry, 1, { reach: 16, gap: 2.5, way: name === 'post' ? 4 : 2.2, fall: 0.6 });
        if (it) clear(it.x, it.z, name === 'post' ? 16 : 9);
      } else { const it = set(name, x0, z0, 0, 1, { reach: 16, gap: 2.5, fall: 0.6 }); if (it) clear(it.x, it.z, 9); }
    } else if (P.kind === 'kurgan') set('idol', x0, z0, R() * 6, 1, { reach: 4, gap: 1, way: 0.6, fall: 0.6 });
    else if (P.kind === 'haystacks') for (let k = 0; k < 7; k++) set('hay', x0 + (R() - 0.5) * P.r * 2, z0 + (R() - 0.5) * P.r * 2, R() * 6, 0.8 + 0.4 * R(), { reach: 14, gap: 3.5, way: 2.0 });
    else if (P.kind === 'nymph_pond') group.add(rusalkaPond(P, world, U, animate));
  }
  // the verst posts: beside the road each marks, a good step off its edge. A mark that falls on a bridge or in a
  // ford stands on the nearer bank: along its road either way, the first place it can stand
  for (const [x, z] of J.verst_posts ?? []) {
    PLACE = 'v' + Math.floor(x / 1500) + ',' + Math.floor(z / 1500);
    const beside = (x, z) => {
      let px = x, pz = z, c = wayGap(px, pz, 30);
      // (a step and a half off its road's edge: moved out of the roadway, or in toward it, the shortest way)
      for (let it = 0; it < 90 && c < 40 && (c < 1.2 || c > 2.2); it++) {
        const want = c < 1.2 ? 1 : -1; let bx = 0, bz = 0, bc = -1e9;
        for (let a = 0; a < 6.28; a += 0.3927) { const q = wayGap(px + Math.cos(a) * 0.5, pz + Math.sin(a) * 0.5, 30) * want; if (q > bc) { bc = q; bx = Math.cos(a); bz = Math.sin(a); } }
        px += bx * 0.3; pz += bz * 0.3; c = wayGap(px, pz, 30);
      }
      return [px, pz];
    };
    const O = { reach: 3, gap: 0.5, way: 0.6, fall: 0.8 };
    let [px, pz] = beside(x, z), it = set('verst', px, pz, 0, 1, O);
    if (!it) {
      const why = left.pop();
      // (its road: the nearest way's line, walked both ways from the mark)
      let w = null, wi = 0, wd = 60;
      for (const q of world.ways?.ways ?? []) for (let i = 0; i < q.pts.length; i++) { const d = Math.hypot(q.pts[i][0] - x, q.pts[i][1] - z); if (d < wd) { wd = d; w = q; wi = i; } }
      if (w) search: for (let k = 1; k < 80; k++) for (const dir of [1, -1]) {
        const i = wi + dir * k; if (i < 0 || i >= w.pts.length) continue;
        if (Math.hypot(w.pts[i][0] - x, w.pts[i][1] - z) > 220) continue;
        [px, pz] = beside(w.pts[i][0], w.pts[i][1]);
        it = set('verst', px, pz, 0, 1, O);
        if (it) break search;
        left.pop();
      }
      if (!it) left.push(why);
    }
  }
  // hunting towers at the edge of the woods (the plan's DayZ look): out from the spawn along twenty-four bearings, the
  // first place the woods begin with open meadow before them; four in all, 500 m apart or more, each looking out over
  // its meadow (its open side to it, the ladder to the woods)
  {
    const towers = [];
    for (let k = 0; k < 24 && towers.length < 4; k++) {
      const a = k * 2.399963;
      for (let r = 300; r < 1900; r += 10) {
        const x = Math.sin(a) * r, z = -Math.cos(a) * r;
        if (world.forestAt(x, z) < 0.6) continue;
        const bx = x - Math.sin(a) * 18, bz = z + Math.cos(a) * 18;
        if (world.meadowAt(bx, bz) > 0.5 && world.waterAt(x, z) === null && towers.every((t) => Math.hypot(t[0] - x, t[1] - z) > 500)) {
          towers.push([x - Math.sin(a) * 5, z + Math.cos(a) * 5, -a]);
        }
        break;
      }
    }
    towers.forEach(([x, z, ry], k) => { PLACE = 't' + k; const it = set('hunt', x, z, ry, 1, { reach: 14, gap: 3, way: 2 }); if (it) clear(it.x, it.z, 6); });
  }
  // the copies
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(), p = new THREE.Vector3();
  // (a copy's placing: turned about y; a fence's panel also leaned along its own length with the ground, and drawn out
  // or in a little along it to fill its run)
  const placing = (o) => { q.setFromAxisAngle(up, o.ry); if (o.tilt) q.multiply(q2.setFromAxisAngle(fwd, o.tilt)); return m4.compose(p.set(o.x, o.y, o.z), q, sc.set((o.sx ?? 1) * o.s, o.s, o.s)); };
  const sails = [];
  // (each place's copies of a kit as their own piece, with its bounds: a village 2 km off behind the walker is not
  // sent to the card - every kit had been one piece the whole map wide, drawn from anywhere, measured 11 Nov 2026)
  const byPlace = (list) => { const by = new Map(); for (const o of list) { let l = by.get(o.place); if (!l) by.set(o.place, (l = [])); l.push(o); } return by; };
  // (each place comes in whole when the walk is shown - its houses, barns, fences and the mill's sails together - and
  // rises out of the ground, the nearest places first: arrive.js)
  const atPlace = new Map(), toPlace = (place, o) => { let l = atPlace.get(place); if (!l) atPlace.set(place, (l = [])); l.push(o); };
  for (const [k, list] of Object.entries(lists)) {
    // (a kit whose model's outline is known is set down by it: the stand-in is not shown unless the model fails to come)
    const modeled = (MODELED[k] ?? []).some((f) => shapes[stem(f.file)]);
    for (const [place, l] of byPlace(list)) {
      const inst = new THREE.InstancedMesh(kits[k].geo, MAT, l.length);
      l.forEach((o, i) => inst.setMatrixAt(i, placing(o)));
      inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere(); inst.name = 'poi-' + k; inst.userData.place = place;
      if (modeled) { inst.visible = false; inst.userData.replaced = true; inst.userData.drawTo = -Infinity; }
      toPlace(place, inst);
    }
  }
  const sailGeo = windmillSails();
  for (const a of animate.filter((o) => o.kind === 'sails')) {
    const m = new THREE.Mesh(sailGeo, MAT);
    m.position.set(a.x + Math.sin(a.ry) * 2.4, a.y + MILL.hub, a.z + Math.cos(a.ry) * 2.4); m.rotation.y = a.ry;
    m.name = 'poi-sails';
    toPlace(a.place ?? '-', m); sails.push(m);
  }
  for (const list of atPlace.values()) arrive(list, { parent: group });
  // (the stand-ins of every place, before they are in: what the models that come take over - loadModels, below)
  const standIns = (kitName) => [...atPlace.values()].flat().filter((c) => c.name === 'poi-' + kitName);
  group.userData.solid = [];
  group.userData.left = left;
  group.userData.skipped = skipped;
  group.userData.MODELED = MODELED;
  group.userData.loadModels = async (base) => {
    const turn = new THREE.Matrix4();
    // (a model's copies of each place come in together, and rise in their place: arrive.js)
    const byModelPlace = new Map();
    await Promise.all(Object.entries(MODELED).map(async ([kitName, files]) => {
      const list = lists[kitName];
      if (!list?.length) return;
      const got = await Promise.all(files.map((f) => gltfLoader().loadAsync(base + 'assets/world/models/' + f.file).then((g) => ({ ...f, g })).catch(() => null)));
      const ok = got.filter(Boolean);
      const stands = standIns(kitName);
      // (not made, or it did not come: the stand-in is shown)
      if (!ok.length) { for (const st of stands) { st.visible = true; st.userData.replaced = false; st.userData.drawTo = undefined; } return; }
      // (which of the kit's files each copy takes: by its place, among the files whose outline it was set down by -
      // or, where none has an outline, among those that came)
      const planned = files.filter((f) => shapes[stem(f.file)]);
      const pool = planned.length ? planned : ok;
      ok.forEach((f, vi) => {
        const mine = list.filter((o) => pool[pool.length === 1 ? 0 : pickOf(o.x, o.z, pool.length)].file === f.file);
        if (!mine.length) return;
        f.g.scene.updateMatrixWorld(true);
        f.g.scene.traverse((c) => {
          if (!c.isMesh) return;
          const mat = c.material;
          // (metal and glass keep their shine, the rest is matt; the sky's light picture is the scene's environment)
          if (!(mat.metalness > 0.3 || mat.roughness < 0.3)) { mat.metalness = 0; mat.roughness = Math.max(0.8, mat.roughness ?? 0.8); }
          receiveSun(mat, U);
          const geo = c.geometry.clone().applyMatrix4(c.matrixWorld);
          for (const [place, l] of byPlace(mine)) {
            const inst = new THREE.InstancedMesh(geo, mat, l.length);
            l.forEach((o, i) => inst.setMatrixAt(i, placing(o).multiply(turn.makeRotationY(f.yaw ?? 0))));
            inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere(); inst.name = 'model-' + kitName + '-' + vi;
            inst.userData.place = place; inst.userData.file = f.file;
            (byModelPlace.get(place) ?? byModelPlace.set(place, []).get(place)).push(inst);
          }
        });
      });
      // (the stand-ins of the kit away for good: replaced says so to the audits, drawTo keeps farcull.js from showing them)
      for (const st of stands) { st.visible = false; st.userData.replaced = true; st.userData.drawTo = -Infinity; }
    }));
    for (const list of byModelPlace.values()) arrive(list, { parent: group });
  };
  group.userData.update = (cam, t) => {
    for (const m of sails) m.rotation.z = -t * 0.6;
    for (const a of animate) if (a.update) a.update(cam, t);
  };
  return group;
}

// ---- the rusalka pond: mist lying on black water, lights like fairies drifting over it, lilies on it ----
function rusalkaPond(P, world, U, animate) {
  const g = new THREE.Group(), [x0, z0] = P.at, lvl = P.level, R = P.r;
  // the fairies: soft glowing motes, each wandering its own loop over the water, pulsing
  const N = 28, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { seed[i] = i / N; pos.set([x0, lvl + 1, z0], i * 3); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const fairy = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Vector3(x0, lvl, z0) }, uR: { value: R } },
    vertexShader: `attribute float aSeed; uniform float uT; uniform vec3 uC; uniform float uR; varying float vPulse; varying float vHue;
      void main() {
        float s = aSeed * 6.2831, t = uT * (0.25 + 0.2 * fract(aSeed * 7.3));
        vec3 p = uC + vec3(cos(t + s) * uR * (0.3 + 0.6 * fract(aSeed * 3.1)) + sin(t * 2.3 + s * 3.0) * 2.5,
                           0.6 + 1.8 * fract(aSeed * 5.7) + sin(t * 3.1 + s) * 0.6,
                           sin(t * 0.8 + s * 2.0) * uR * (0.3 + 0.6 * fract(aSeed * 9.1)) + cos(t * 1.7 + s) * 2.5);
        vPulse = 0.6 + 0.4 * sin(uT * (2.0 + 3.0 * fract(aSeed * 11.0)) + s * 5.0); vHue = fract(aSeed * 13.7);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(260.0 / -mv.z, 2.0, 60.0) * (0.7 + 0.3 * vPulse);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vPulse; varying float vHue;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-r * r * 18.0), halo = exp(-r * r * 3.0) * 0.45;
        vec3 c = mix(vec3(0.75, 0.95, 1.0), vec3(0.95, 0.85, 1.0), vHue);
        float a = (core + halo) * vPulse;
        gl_FragColor = vec4(c * a * 1.6, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(pg, fairy); pts.frustumCulled = false; g.add(pts);
  // the mist: soft sheets lying low over the water, drifting
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uT: fairy.uniforms.uT, uC: fairy.uniforms.uC, uR: fairy.uniforms.uR },
    vertexShader: `varying vec3 vW2; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW2 = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uR; varying vec3 vW2;
      float h(vec2 p){return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main() {
        vec2 q = (vW2.xz - uC.xz) / uR;
        float m = n(vW2.xz * 0.12 + uT * 0.05) * 0.6 + n(vW2.xz * 0.35 - uT * 0.08) * 0.4;
        float a = smoothstep(1.35, 0.6, length(q)) * smoothstep(0.25, 0.75, m) * 0.32;
        gl_FragColor = vec4(vec3(0.82, 0.86, 0.88) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * 3, R * 3).rotateX(-Math.PI / 2), mistMat);
    m.position.set(x0, lvl + 0.3 + k * 0.45, z0); m.renderOrder = 3; g.add(m);
  }
  // water lilies
  const lily = new THREE.InstancedMesh(paint(new THREE.CircleGeometry(0.35, 9, 0.3, Math.PI * 1.85).rotateX(-Math.PI / 2), '#3f5a2e'), MAT, 40);
  const m4 = new THREE.Matrix4(), rr = rnd(77);
  for (let i = 0; i < 40; i++) {
    const a = rr() * 6.283, d = Math.sqrt(rr()) * R * 0.85;
    m4.makeRotationY(rr() * 6.28); m4.setPosition(x0 + Math.cos(a) * d, lvl + 0.03, z0 + Math.sin(a) * d);
    lily.setMatrixAt(i, m4);
  }
  g.add(lily);
  animate.push({ update: (cam, t) => { fairy.uniforms.uT.value = t; } });
  return g;
}
