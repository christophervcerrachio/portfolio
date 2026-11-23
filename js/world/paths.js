// The ways through the world, sharp up close (world-building): the roads, the cart tracks, the footpaths and the city
// streets (world.json: roads, paths, streets; read off the city plates and laid by build_world.py / paths.py), drawn
// round the camera into a picture a quarter metre a pixel, 512 m across, which follows the camera. The land's shader
// lays its ground tiles by it (beaten earth, cobbles, the ruts of the cart wheels), the grass leaves it bare, the woods
// stand back from it. Far off, the land's own road cover (8 m a texel) carries them.
//   R  beaten earth (a road, a track, a footpath, an earth street); faintly, its verge; and the ground people walk
//      on round the country's houses, as worn as each is (addAreas: the yards, the paths to their doors)
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
/** A footpath that runs to a pond or a lake ends at its shore: the builder led the path to the water's middle (the
 *  rusalka pond's path began there), and a bridge had been laid from the bank to that middle, ending in the water, the
 *  way's earth and its stones under the water with it (19 Nov 2026). Each end walked in a metre at a time while the
 *  water there is more than a hand deep (as the bridges count it: bridges.js), and cut at the first dry ground. */
function dryEnds(world, pts) {
  if (!world.waterAt || !world.landAt || pts.length < 2) return pts;
  const wet = (x, z) => { const s = world.waterAt(x, z); return s !== null && s - world.landAt(x, z) > 0.15; };
  const cut = (P) => {
    for (let i = 1; i < P.length; i++) {
      const [ax, az] = P[i - 1], [bx, bz] = P[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
        if (!wet(x, z)) return k === 0 && i === 1 ? P : [[x, z], ...P.slice(i)];
      }
    }
    return [];
  };
  const a = cut(pts);
  return a.length > 1 ? cut(a.slice().reverse()).reverse() : a;
}

export function buildPaths(world, extra = []) {
  const J = world.json, ways = [];
  for (const e of extra) ways.push({ kind: e.kind, ...style(e.kind, e.w), pts: e.pts });
  for (const [name, pts] of Object.entries(J.roads ?? {})) {
    // (a road that starts by the spawn starts at the spawn itself, so the walker's own way out is the road)
    const p0 = pts[0], at0 = Math.hypot(p0[0], p0[1]) < 80 ? [[0, 0], ...pts] : pts;
    const kind = /track/.test(name) ? 'track' : 'road';
    ways.push({ kind, ...style(kind), pts: smoothLine(at0) });
  }
  for (const p of J.paths ?? []) { const pts = dryEnds(world, p.pts); if (pts.length > 1) ways.push({ kind: p.kind, ...style(p.kind, p.w), pts: smoothLine(pts) }); }
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
  // (each way's box, once, with room for its verge and the blur: a way whose box misses a picture draws nothing in it)
  for (const w of ways) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of w.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const m = w.w / 2 + 6;
    w.box = [x0 - m, z0 - m, x1 + m, z1 + m];
  }
  // (the ground people walk on round the country's houses - pois.js lays it out with the places, after the ways: each
  // a fill { ring, r }, a patch { at, rad, r } or a path { pts, w, r, ruts }, r as worn as its earth)
  const areas = [];
  // two pictures round the camera: the near one sharp (4 px a metre, 512 m), the far one (1 px a metre, 2 km) so the
  // ways stay smooth and whole out to a kilometre and more, not the land's coarse road cover's 8 m steps.
  // Each follows the camera in steps (96 m, 384 m). Drawn whole the moment the camera crossed into the next step, a
  // picture held the frame up while the card drew it - a few hundred to a few thousand strokes, each blurred: over a
  // city the near one 0.1 s every 96 m and the far one 0.4 s every 384 m, at the run's speed a stall every second and
  // a half and a freeze every five (measured 16 Nov 2026 on an RTX 5090, flying over Moscow). Now the next picture is
  // drawn before it is wanted: the step the camera heads into, its strokes a few a frame on the picture's own canvas
  // (the card's copy of the last one shows meanwhile), each few sent to the card by themselves so it draws them
  // between frames; the moment the camera crosses, the canvas is sent up whole. The same strokes, in the same order,
  // on the same canvas: the same picture (but for a few hundred of its 16 million values, a few levels, where the card
  // blurs a stroke's edge in a smaller batch). A step not foreseen - a jump, a turn at the last moment - is drawn at
  // once, as it always was.
  const pic = (span, px, step, ruts) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = px;
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    const s = px / span, fw = `blur(${(0.75 * s).toFixed(2)}px)`, fr = `blur(${(0.25 * s).toFixed(2)}px)`;
    // cx, cz: the picture the card has (or is about to take: sent false till it has); nx, nz, L, cost, i: the one on
    // the canvas, its strokes and how many of them are drawn; lx, lz: where the camera was the frame before
    const P = { tex, c: new THREE.Vector2(1e9, 1e9), cx: NaN, cz: NaN, sent: true, L: null, cost: null, i: 0, nx: NaN, nz: NaN, lx: NaN, lz: NaN };
    tex.onUpdate = () => { P.sent = true; };
    /** The strokes of the picture round (cx, cz), in the order they were always drawn: the verges, the ways, the ruts;
     *  each [width, colour, way, sideways offset, filter], and what each costs the card, summed (cost). */
    const begin = (cx, cz) => {
      const h = span / 2, V = [];
      for (const w of ways) {
        const b = w.box;
        if (b[2] < cx - h || b[0] > cx + h || b[3] < cz - h || b[1] > cz + h) continue;
        if (!w.pts.some(([x, z]) => Math.abs(x - cx) < span && Math.abs(z - cz) < span)) continue;   // (the ways it always took)
        V.push(w);
      }
      const L = [];
      // (the verge: a faint band a metre beyond either edge, where the grass is trodden short)
      for (const w of V) L.push([w.w + 2.2, 'rgb(28,0,0)', w, 0, fw]);
      // (a soft edge: the land frays it a little, so ways run into each other and into the turf)
      for (const w of V) {
        if (w.earth) L.push([w.w, `rgb(${Math.round(255 * w.earth)},0,0)`, w, 0, fw]);
        if (w.cobble) L.push([w.w, 'rgb(0,255,0)', w, 0, fw]);
      }
      // (the ground people walk on round the country's houses: its trodden fills, its bare patches, its worn paths)
      const A = areas.filter((a) => !(a.box[2] < cx - h || a.box[0] > cx + h || a.box[3] < cz - h || a.box[1] > cz + h));
      for (const a of A) L.push([a.w ?? 0, `rgb(${Math.round(255 * a.r)},0,0)`, a, 0, fw]);
      // (the wheels' tracks: two ruts 1.5 m apart; a street wide enough for two carts, a pair in each half, the carts
      // keeping to their side)
      if (ruts) for (const w of V) {
        if (!w.ruts) continue;
        const col = `rgb(0,0,${Math.round(255 * w.ruts)})`;
        if (w.w > 9) for (const c of [w.w / 4, -w.w / 4]) { L.push([0.4, col, w, c + 0.75, fr]); L.push([0.4, col, w, c - 0.75, fr]); }
        else { L.push([0.4, col, w, 0.75, fr]); L.push([0.4, col, w, -0.75, fr]); }
      }
      if (ruts) for (const a of A) if (a.ruts) for (const o of [0.75, -0.75]) L.push([0.4, `rgb(0,0,${Math.round(255 * a.ruts)})`, a, o, fr]);
      // (a stroke's cost to the card: the blurred layer it is drawn in, its box within the picture, and a little more)
      const cost = new Float64Array(L.length + 1);
      for (let k = 0; k < L.length; k++) {
        const b = L[k][2].box, ax = Math.max(0, Math.min(b[2], cx + h) - Math.max(b[0], cx - h)), az = Math.max(0, Math.min(b[3], cz + h) - Math.max(b[1], cz - h));
        cost[k + 1] = cost[k] + ax * az * s * s + 4096;
      }
      Object.assign(P, { nx: cx, nz: cz, L, cost, i: 0 });
    };
    /** Strokes i0..i1 of the picture begun drawn on the canvas (from the first: the canvas cleared). */
    const paint = (i0, i1) => {
      const L = P.L, ox = P.nx - span / 2, oz = P.nz - span / 2;
      if (i0 === 0) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, px, px); }
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
      // (picture: x to the right, z down the rows, as the shader reads it)
      g.setTransform(s, 0, 0, s, -ox * s, -oz * s);
      let f = null;
      for (let k = i0; k < i1; k++) {
        const [lw, col, w, off, filt] = L[k], pts = w.pts;
        if (filt !== f) g.filter = f = filt;
        if (w.ring || w.at) {
          g.fillStyle = col; g.beginPath();
          if (w.at) g.arc(w.at[0], w.at[1], w.rad, 0, Math.PI * 2);
          else w.ring.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
          g.fill();
          continue;
        }
        g.lineWidth = lw; g.strokeStyle = col;
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          let [x, z] = pts[i];
          if (off) {   // (a rut: the line moved sideways along its normal)
            const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
            const tx = c[0] - a[0], tz = c[1] - a[1], Ln = Math.hypot(tx, tz) || 1;
            x += (-tz / Ln) * off; z += (tx / Ln) * off;
          }
          if (i) g.lineTo(x, z); else g.moveTo(x, z);
        }
        g.stroke();
      }
      g.filter = 'none';
      P.i = i1;
    };
    // (what was drawn sent to the card now, as its own piece of work, not left to pile up for the frame that sends the
    // picture up: asking for a pixel of the canvas does it)
    const flush = () => { createImageBitmap(cv, 0, 0, 1, 1).then((b) => b.close(), () => {}); };
    P.update = (pos) => {
      const x = pos.x, z = pos.z, vx = x - P.lx, vz = z - P.lz;
      P.lx = x; P.lz = z;
      const nx = Math.round(x / step) * step, nz = Math.round(z / step) * step;
      if (nx !== P.cx || nz !== P.cz) {
        // (into the next step: its picture - drawn ahead where it was foreseen - finished, and sent up)
        if (P.nx !== nx || P.nz !== nz || !P.L) begin(nx, nz);
        paint(P.i, P.L.length);
        P.cx = nx; P.cz = nz; P.c.set(nx, nz); P.L = null;
        P.sent = false; tex.needsUpdate = true;
        return;
      }
      if (!P.sent) return;                 // (the card has yet to take the picture the canvas holds)
      // ahead: the step the camera will cross into next at its pace (both at once where it crosses them within a frame
      // of each other), and the frames left till then
      const h = step / 2;
      const fx = vx > 1e-3 ? (nx + h - x) / vx : vx < -1e-3 ? (x - nx + h) / -vx : Infinity;
      const fz = vz > 1e-3 ? (nz + h - z) / vz : vz < -1e-3 ? (z - nz + h) / -vz : Infinity;
      const f = Math.min(fx, fz);
      if (!(f < 1e6)) return;              // (standing still: nothing ahead)
      const tx = fx <= f + 1 ? nx + Math.sign(vx) * step : nx, tz = fz <= f + 1 ? nz + Math.sign(vz) * step : nz;
      if (P.nx !== tx || P.nz !== tz || !P.L) begin(tx, tz);
      const L = P.L, C = P.cost, n = L.length;
      if (P.i >= n) return;                // (drawn: it waits for the camera)
      // (the rest spread over half the frames left, a six-hundredth of the whole at the least)
      const goal = C[P.i] + Math.max(C[n] / 600, (C[n] - C[P.i]) / Math.max(1, (f - 2) * 0.5));
      let j = P.i + 1;
      while (j < n && C[j + 1] <= goal) j++;
      paint(P.i, j);
      flush();
    };
    return P;
  };
  const N = pic(SPAN, PX, STEP, true), F = pic(2048, 2048, 384, false);
  const uniforms = { uWayT: { value: N.tex }, uWayC: { value: N.c }, uWaySpan: { value: SPAN },
    uWayT2: { value: F.tex }, uWayC2: { value: F.c }, uWaySpan2: { value: 2048 } };
  const update = (pos) => { N.update(pos); F.update(pos); };
  /** The ground people walk on round the country's houses (pois.js): drawn into both pictures from the next frame, as
   *  a way is - read by the land, the grass and the woods as theirs - but no way: nothing keeps off it, nothing is laid
   *  along it. */
  const addAreas = ({ fills = [], dots = [], lines = [] } = {}) => {
    const boxOf = (pts, m) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0 - m, z0 - m, x1 + m, z1 + m]; };
    for (const f of fills) areas.push({ ring: f.ring, r: f.r, box: boxOf(f.ring, 3) });
    for (const d of dots) areas.push({ at: d.at, rad: d.rad, r: d.r, box: boxOf([d.at], d.rad + 3) });
    for (const l of lines) areas.push({ pts: l.pts, w: l.w, r: l.r, ruts: l.ruts ?? 0, box: boxOf(l.pts, l.w / 2 + 3) });
    // (each picture begun again, whole, at the next frame: the one the card has was drawn without them)
    for (const P of [N, F]) { P.cx = P.cz = NaN; P.L = null; }
  };
  return { tex: N.tex, uniforms, update, near, clearance, ways, addAreas };
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
