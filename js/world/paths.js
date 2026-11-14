// The ways through the world, sharp up close (world-building): the roads, the cart tracks, the footpaths and the city
// streets (world.json: roads, paths, streets; read off the city plates and laid by build_world.py / paths.py), drawn
// round the camera into a picture a quarter metre a pixel, 512 m across, which follows the camera. The land's shader
// lays its ground tiles by it (beaten earth, cobbles, the ruts of the cart wheels), the grass leaves it bare, the woods
// stand back from it. Far off, the land's own road cover (8 m a texel) carries them.
//   R  beaten earth (a road, a track, a footpath, an earth street); faintly, its verge
//   G  cobbles (a city's paved street)
//   B  wheel ruts (in the roads and tracks, two to a way)
import * as THREE from 'three';

const SPAN = 512, PX = 2048, STEP = 96;

/** How each way is drawn: its width (m), and what it is. */
function style(kind, w) {
  // (every track one width and every footpath another, so they read as one network; the post roads stay wider)
  if (kind === 'foot') return { w: 1.3, earth: 1, cobble: 0, ruts: 0 };   // (a path worn by feet: 1.3 m)
  if (kind === 'track') return { w: 2.6, earth: 1, cobble: 0, ruts: 1 };
  if (kind === 'road') return { w: w ?? 6.5, earth: 1, cobble: 0, ruts: 1 };
  // the streets (paths.py read_streets): the main ones cobbled (Petersburg's by 1787, Moscow's centre), lanes earth
  if (kind === 'prospect' || kind === 'main' || kind === 'street') return { w, earth: 0, cobble: 1, ruts: 0 };
  return { w: w ?? 8, earth: 1, cobble: 0, ruts: 0.6 };      // (a lane)
}

/** A country way's line made smooth, as feet and wheels wear it: the builder's route comes off a grid and keeps small
 *  zig-zags; resampled every 3 m, averaged over about 20 m twice (the ends held), then rounded by two passes of
 *  corner-cutting. */
function smoothLine(pts) {
  if (pts.length < 3) return pts;
  const P = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let k = 0; k < n; k++) P.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  P.push(pts[pts.length - 1]);
  let Q = P;
  for (let pass = 0; pass < 2; pass++) {
    const R = Q.map((p, i) => {
      const h = Math.min(3, i, Q.length - 1 - i);
      if (h === 0) return p;
      let x = 0, z = 0;
      for (let k = -h; k <= h; k++) { x += Q[i + k][0]; z += Q[i + k][1]; }
      return [x / (2 * h + 1), z / (2 * h + 1)];
    });
    Q = R;
  }
  for (let pass = 0; pass < 2; pass++) {
    const R = [Q[0]];
    for (let i = 0; i < Q.length - 1; i++) {
      const [ax, az] = Q[i], [bx, bz] = Q[i + 1];
      R.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    R.push(Q[Q.length - 1]);
    Q = R;
  }
  // (thinned to a point every metre or so: enough for the picture, few for the lookups)
  const out = [Q[0]];
  for (let i = 1; i < Q.length - 1; i++) if (Math.hypot(Q[i][0] - out[out.length - 1][0], Q[i][1] - out[out.length - 1][1]) > 1.2) out.push(Q[i]);
  out.push(Q[Q.length - 1]);
  return out;
}

/** world: loadWorld()'s. Returns { tex, uniforms, update(cameraPos), near(x, z) }: near is metres to the nearest way's
 *  edge (negative inside it), for the woods and the walker. */
export function buildPaths(world, extra = []) {
  const J = world.json, ways = [];
  for (const e of extra) ways.push({ kind: e.kind, ...style(e.kind, e.w), pts: e.pts });
  for (const [name, pts] of Object.entries(J.roads ?? {})) {
    // (a road that starts by the spawn starts at the spawn itself, so the walker's own way out is the road)
    const p0 = pts[0], at0 = Math.hypot(p0[0], p0[1]) < 80 ? [[0, 0], ...pts] : pts;
    const kind = /track/.test(name) ? 'track' : 'road';
    ways.push({ kind, ...style(kind), pts: smoothLine(at0) });
  }
  for (const p of J.paths ?? []) ways.push({ kind: p.kind, ...style(p.kind, p.w), pts: smoothLine(p.pts) });
  // (every street of a city paved, the lanes too: a lane's earth had run as a strip of dirt down the middle of the brick
  // street)
  // (Moscow's streets, beaten earth (terrain.js), carry the cart wheels' ruts as its period pictures show them; Petersburg's
  // setts none)
  for (const list of Object.values(J.streets ?? {})) for (const s of list) {
    const msk = s.pts.reduce((a, q) => a + q[1], 0) / s.pts.length < -1200;
    ways.push({ kind: s.kind, ...style(s.kind, s.w), earth: 0, cobble: 1, ruts: msk ? 0.7 : 0, pts: s.pts });
  }
  // (a grid of the ways' segments, 64 m cells, to find the ones near a point quickly)
  const CELL = 64, grid = new Map(), segs = [];
  for (const w of ways) for (let i = 1; i < w.pts.length; i++) {
    const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i], k = segs.length;
    segs.push([ax, az, bx, bz, w.w / 2]);
    const r = w.w / 2 + 2;
    for (let cx = Math.floor((Math.min(ax, bx) - r) / CELL); cx <= Math.floor((Math.max(ax, bx) + r) / CELL); cx++)
      for (let cz = Math.floor((Math.min(az, bz) - r) / CELL); cz <= Math.floor((Math.max(az, bz) + r) / CELL); cz++) {
        const key = cx + ',' + cz; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(k);
      }
  }
  const near = (x, z) => {
    const l = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    let best = 1e9;
    if (l) for (const k of l) {
      const [ax, az, bx, bz, hw] = segs[k], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz) - hw);
    }
    return best;
  };
  // (the distance from (x, z) to the nearest way's edge, looking as far as R: for whatever must keep off the ways
  // (pois.js); near() above only knows the ways that pass within 2 m of the point's own cell)
  const clearance = (x, z, R = 30) => {
    let best = 1e9;
    const seen = new Set();
    for (let cx = Math.floor((x - R - 2) / CELL); cx <= Math.floor((x + R + 2) / CELL); cx++)
      for (let cz = Math.floor((z - R - 2) / CELL); cz <= Math.floor((z + R + 2) / CELL); cz++) {
        const l = grid.get(cx + ',' + cz);
        if (l) for (const k of l) {
          if (seen.has(k)) continue; seen.add(k);
          const [ax, az, bx, bz, hw] = segs[k], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz) - hw);
        }
      }
    return best;
  };
  // two pictures round the camera: the near one sharp (4 px a metre, 512 m), the far one (1 px a metre, 2 km) so the
  // ways stay smooth and whole out to a kilometre and more, not the land's coarse road cover's 8 m steps
  const pic = (span, px, step, ruts) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = px;
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    const P = { tex, c: new THREE.Vector2(1e9, 1e9), cx: NaN, cz: NaN };
    P.draw = () => {
      const { cx, cz } = P, s = px / span, ox = cx - span / 2, oz = cz - span / 2, b = (m) => `blur(${(m * s).toFixed(2)}px)`;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      g.fillStyle = '#000'; g.fillRect(0, 0, px, px);
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
      // (picture: x to the right, z down the rows, as the shader reads it)
      g.setTransform(s, 0, 0, s, -ox * s, -oz * s);
      const vis = (pts) => pts.some(([x, z]) => Math.abs(x - cx) < span && Math.abs(z - cz) < span);
      const path = (pts, off) => {
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          let [x, z] = pts[i];
          if (off) {   // (a rut: the line moved sideways along its normal)
            const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
            const tx = c[0] - a[0], tz = c[1] - a[1], L = Math.hypot(tx, tz) || 1;
            x += (-tz / L) * off; z += (tx / L) * off;
          }
          if (i) g.lineTo(x, z); else g.moveTo(x, z);
        }
        g.stroke();
      };
      // (the verge: a faint band a metre beyond either edge, where the grass is trodden short)
      g.filter = b(0.75);
      for (const w of ways) { if (!vis(w.pts)) continue; g.lineWidth = w.w + 2.2; g.strokeStyle = 'rgb(28,0,0)'; path(w.pts, 0); }
      // (a soft edge: the land frays it a little, so ways run into each other and into the turf)
      for (const w of ways) {
        if (!vis(w.pts)) continue;
        g.lineWidth = w.w;
        if (w.earth) { g.strokeStyle = `rgb(${Math.round(255 * w.earth)},0,0)`; path(w.pts, 0); }
        if (w.cobble) { g.strokeStyle = 'rgb(0,255,0)'; path(w.pts, 0); }
      }
      if (ruts) {
        g.filter = b(0.25);
        for (const w of ways) {
          if (!w.ruts || !vis(w.pts)) continue;
          // (the wheels' tracks: two ruts 1.5 m apart)
          g.lineWidth = 0.4; g.strokeStyle = `rgb(0,0,${Math.round(255 * w.ruts)})`;
          // (a street wide enough for two carts: a pair in each half, the carts keeping to their side)
          if (w.w > 9) for (const c of [w.w / 4, -w.w / 4]) { path(w.pts, c + 0.75); path(w.pts, c - 0.75); }
          else { path(w.pts, 0.75); path(w.pts, -0.75); }
        }
      }
      g.filter = 'none';
      tex.needsUpdate = true;
      P.c.set(cx, cz);
    };
    P.update = (pos) => {
      const nx = Math.round(pos.x / step) * step, nz = Math.round(pos.z / step) * step;
      if (nx === P.cx && nz === P.cz) return;
      P.cx = nx; P.cz = nz; P.draw();
    };
    return P;
  };
  const N = pic(SPAN, PX, STEP, true), F = pic(2048, 2048, 384, false);
  const uniforms = { uWayT: { value: N.tex }, uWayC: { value: N.c }, uWaySpan: { value: SPAN },
    uWayT2: { value: F.tex }, uWayC2: { value: F.c }, uWaySpan2: { value: 2048 } };
  const update = (pos) => { N.update(pos); F.update(pos); };
  return { tex: N.tex, uniforms, update, near, clearance, ways };
}

/** The shader's side: what the ways are at p (R earth, G cobbles, B ruts; 0 outside the pictures): the near picture
 *  where it reaches, the far one beyond it (no ruts there), blended across the near one's edge. */
export const WAYS_GLSL = /* glsl */`
uniform sampler2D uWayT; uniform vec2 uWayC; uniform float uWaySpan;
uniform sampler2D uWayT2; uniform vec2 uWayC2; uniform float uWaySpan2;
vec3 wayPic(sampler2D T, vec2 c, float span, vec2 p, out float w) {
  vec2 uv = (p - c) / span + 0.5;
  w = smoothstep(0.5, 0.44, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
  if (w <= 0.0) return vec3(0.0);
  return texture2D(T, vec2(uv.x, 1.0 - uv.y)).rgb;
}
vec3 wayAt(vec2 p) {
  float wn, wf;
  vec3 n = wayPic(uWayT, uWayC, uWaySpan, p, wn);
  if (wn >= 1.0) return n;
  vec3 f = wayPic(uWayT2, uWayC2, uWaySpan2, p, wf);
  return mix(f * vec3(1.0, 1.0, 0.0) * wf, n, wn);
}`;
