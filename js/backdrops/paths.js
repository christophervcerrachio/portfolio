// The dirt paths across the hilltop: one in each direction from where the painter stood, worn into the meadow by feet
// and cart wheels. Ahead, down to the church and the village (it meets the path the painting has there, at the brow,
// and runs on to Moscow); left, toward the Caucasus; right, toward the estate; behind, down to the avenue into
// Petersburg (landmarks.js). The grass and the flowers are left off them (meadow.js), and the meadow's ground
// shows their bare earth and two wheel ruts, read from a picture of them (pathTexture).
import * as THREE from 'three';
import { LANDMARKS } from './landmarks.js';

// each path: its line, as directions (radians right of ahead) at distances (m) from the camera, and its half-width
const LINES = [
  // ahead: bearing a little right, to where the painted path starts at the brow (u 0.625 of the painting)
  { pts: [[0.04, 0.3], [0.09, 4], [0.15, 9], [0.178, 13.5], [0.185, 21]], w: 0.62 },
  // left: straight out through the wood's opening, then bending a little down the slope
  { pts: [[LANDMARKS.caucasus, 0.3], [LANDMARKS.caucasus, 9], [LANDMARKS.caucasus - 0.04, 18], [LANDMARKS.caucasus - 0.09, 34]], w: 0.66 },
  // right: straight out through the wood's opening and on
  { pts: [[LANDMARKS.estate, 0.3], [LANDMARKS.estate, 15], [LANDMARKS.estate - 0.03, 34]], w: 0.72 },
  // behind: down toward the avenue
  { pts: [[LANDMARKS.petersburg, 0.3], [LANDMARKS.petersburg + 0.03, 14], [LANDMARKS.petersburg, 34]], w: 0.68 },
].map((L) => ({ w: 1.5, xz: L.pts.map(([a, r]) => [r * Math.sin(a), -r * Math.cos(a)]) }));
// (each 3 m across now, a cart track like every other in the world. Their old half-widths, 0.62 to 0.72 m, were a
// footpath's.)

/** The hilltop's tracks as the world's ways (world/paths.js draws them with the rest, in the same earth and ruts). */
export function hillWays() { return []; }

/** The hilltop's lines made the world's own roads out of the spawn (world.json roads that start by it), so the stones
 *  on the verges and the trees keep to the ways the walker sees. Call once the world is loaded, before the stones. */
export function setHillLines(roads) {
  const out = [];
  for (const pts of Object.values(roads ?? {})) {
    if (Math.hypot(pts[0][0], pts[0][1]) > 80) continue;
    const xz = [[0, 0]];
    for (const p of pts) { xz.push([p[0], p[1]]); if (Math.hypot(p[0], p[1]) > 40) break; }
    out.push({ w: 3.25, xz });
  }
  if (out.length) { LINES.length = 0; LINES.push(...out); tex = null; }
}

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** How far (m) the point is from the nearest path's edge (negative: on it), and from that path's middle. */
function edgeDist(x, z) {
  let best = 1e9, mid = 1e9;
  for (const L of LINES) {
    for (let k = 0; k < L.xz.length - 1; k++) {
      const [ax, az] = L.xz[k], [bx, bz] = L.xz[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d - L.w < best) { best = d - L.w; mid = d; }
    }
  }
  // (where the paths meet, at the painter's feet, a little worn patch)
  const r = Math.hypot(x, z);
  if (r - 0.9 < best) { best = r - 0.9; mid = 9; }
  return [best, mid];
}

/** 0 off the paths .. 1 on their bare earth (its edge ragged, the grass growing in a little here and there). */
export function pathAt(x, z) {
  const e = edgeDist(x, z)[0] + (vnoise(x * 2.3, z * 2.3) - 0.5) * 0.22 + (vnoise(x * 7.1, z * 7.1) - 0.5) * 0.08;
  return Math.min(1, Math.max(0, (0.08 - e) / 0.2));
}

/** 0 .. 1 on the strip of grass that grows down a cart track's middle, between the wheel ruts. */
export function crownAt(x, z) {
  const [e, mid] = edgeDist(x, z);
  if (e > 0) return 0;
  return Math.max(0, 1 - Math.max(0, mid - 0.07) / 0.09) * (0.55 + 0.45 * vnoise(x * 1.9 + 7.1, z * 1.9 - 3.3));
}

/**
 * Points along both edges of every path, about every `step` m (each gap between 0.5 and 1.5 steps; rand: 0..1), from
 * r0 to r1 m from the camera: where it is (x, z), which way is out of the path into the grass (nx, nz), how far from the
 * camera (d), and the path's half-width (w). (The stones along the verges: stones.js.)
 */
export function pathVerges(rand, { step = 0.6, r0 = 0.9, r1 = 26 } = {}) {
  const out = [];
  for (const L of LINES) {
    for (let k = 0; k < L.xz.length - 1; k++) {
      const [ax, az] = L.xz[k], [bx, bz] = L.xz[k + 1], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let t = rand() * step; t < len; t += step * (0.5 + rand())) {
        const x = ax + dx * t, z = az + dz * t, d = Math.hypot(x, z);
        if (d < r0 || d > r1) continue;
        for (const side of [-1, 1]) out.push({ x: x - side * dz * L.w, z: z + side * dx * L.w, nx: -side * dz, nz: side * dx, d, w: L.w });
      }
    }
  }
  return out;
}

const SPAN = 96;                  // the picture covers this many metres square, round the camera
let tex = null;
/** The paths' picture, seen from above (r: bare earth, g: how deep in a rut, b: the grassy crown), SPAN metres across. */
export function pathTexture() {
  if (tex) return tex;
  const N = 640, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * SPAN - SPAN / 2, z = (j + 0.5) / N * SPAN - SPAN / 2;
    const p = pathAt(x, z);
    // the ruts: two narrow troughs a cart's width apart along the path's middle
    const rut = p > 0 ? Math.max(0, 1 - Math.abs(edgeDist(x, z)[1] - 0.33) / 0.13) * 0.85 : 0;
    const o = (j * N + i) * 4;
    data[o] = Math.round(p * 255); data[o + 1] = Math.round(rut * p * 255); data[o + 2] = Math.round(crownAt(x, z) * p * 255); data[o + 3] = 255;
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
export const PATH_SPAN = SPAN;
