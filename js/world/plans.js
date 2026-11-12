// The true outline on the ground of everything that stands on the land outside the cities' own houses: the Kremlin's
// towers, wall and palaces, the cities' landmarks and parish churches, the estate's buildings, the spa towns' houses
// and galleries, the villages' cabins, barns, fences and stacks, the country church and chapel, the post station, the
// mill, the hunting towers (the cities' process: every thing measured on its own outline, never its box or a circle).
// One list, asked by all that must respect a building's geometry:
// - the walker, who is kept out of each outline and a step off its walls (he had been kept out of circles laid along
//   each building's box: the corners of the Winter Palace stood 50 m outside theirs, and a circle round a long church
//   stopped him in the open air), a hand at a time, so that he comes through nothing however fast he goes (step);
// - the woods, which plant no tree whose crown would reach a wall (keepAt);
// - the country places as they are laid out, each thing tried against what already stands (hits).
// A model's outline comes from its own triangles (dev\world\tools\plan_mask.py -> assets/world/landmarks/plans.json:
// what of it comes under 2.6 m, an open court left open); what the page builds in code gives its own rectangles.
// dev\world\world_audit.py measures the page against the models again from outside, so the two cannot drift apart.

const CELL = 16;

/** The plans.json of the site: { model: { rings, holes, box: [x0, x1, z0, z1], base, height } }, in each model's own frame. */
export const loadPlanShapes = (base = '') => fetch(base + 'assets/world/landmarks/plans.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

/** Points of a thing's own frame (x right, z toward its front) set where it stands: three.js's turn about y. */
export function placeRing(ring, x, z, yaw, s = 1) {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  return ring.map(([px, pz]) => [x + (px * c + pz * n) * s, z + (-px * n + pz * c) * s]);
}
/** A rectangle [x0, x1, z0, z1] of a thing's own frame as a ring. */
export const rectRing = ([x0, x1, z0, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** How far inside an outline (rings and holes of world [x, z]) a point is (m, to its nearest edge); under 0: that far outside. */
export function depthIn(rings, holes, x, z) {
  let inside = false, d = 1e9;
  const one = (r, hole) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > z) !== (b[1] > z) && x < a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c;
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      d = Math.min(d, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    }
    return c;
  };
  // (in more of its rings than of its courts: a barracks that stands in a fortress's court is in the wall's ring, in
  // the court and in its own ring - inside; the court's open ground is in one ring and one court - outside)
  let n = 0;
  for (const r of rings) if (one(r)) n++;
  for (const r of holes ?? []) if (one(r)) n--;
  inside = n > 0;
  return inside ? d : -d;
}

export function makePlans() {
  const list = [], segs = [];                    // segs: [ax, az, bx, bz, plan index]
  const segCells = new Map(), planCells = new Map();
  const cellsOf = (x0, z0, x1, z1, f) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) f(i + ',' + j);
  };
  const inRing = (r, x, z) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > z) !== (b[1] > z) && x < a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c;
    }
    return c;
  };
  // (in more of its pieces than of its courts: what stands in a court - a barracks inside a fortress's walls - is a
  // piece of its own inside the court)
  const inPlan = (p, x, z) => {
    if (x < p.bb[0] || x > p.bb[2] || z < p.bb[1] || z > p.bb[3]) return false;
    let n = 0;
    for (const r of p.rings) if (inRing(r, x, z)) n++;
    if (!n) return false;
    for (const r of p.holes) if (inRing(r, x, z)) n--;
    return n > 0;
  };

  /** A thing's outline, where it stands: rings and holes of world [x, z]. opt: group, solid (false: the walker may
   *  pass it), keep (m: how far off the woods keep their trunks), h (its height, m). Returns the plan. */
  function add(key, rings, holes = [], opt = {}) {
    if (!rings.length) return null;
    const p = { key, group: opt.group ?? null, rings, holes, solid: opt.solid !== false, keep: opt.keep ?? 6.5, h: opt.h ?? 0, bb: [1e9, 1e9, -1e9, -1e9] };
    const k = list.length; list.push(p);
    for (const r of rings) for (const [x, z] of r) { p.bb[0] = Math.min(p.bb[0], x); p.bb[1] = Math.min(p.bb[1], z); p.bb[2] = Math.max(p.bb[2], x); p.bb[3] = Math.max(p.bb[3], z); }
    cellsOf(p.bb[0], p.bb[1], p.bb[2], p.bb[3], (c) => { let l = planCells.get(c); if (!l) planCells.set(c, (l = [])); l.push(k); });
    for (const r of [...rings, ...holes]) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], n = segs.length;
      segs.push([a[0], a[1], b[0], b[1], k]);
      cellsOf(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (c) => { let l = segCells.get(c); if (!l) segCells.set(c, (l = [])); l.push(n); });
    }
    return p;
  }
  /** A model's outline (plans.json's, in its own frame) set where it stands. */
  const addShape = (key, shape, x, z, yaw, s = 1, opt = {}) => shape ? add(key, shape.rings.map((r) => placeRing(r, x, z, yaw, s)), (shape.holes ?? []).map((r) => placeRing(r, x, z, yaw, s)), { h: (shape.height ?? 0) * s, ...opt }) : null;

  // the nearest edge within R of (x, z): [distance, its nearest point x, z, the plan] or null
  const seen = new Set();
  function nearest(x, z, R, pick) {
    let best = null; seen.clear();
    for (let i = Math.floor((x - R) / CELL); i <= Math.floor((x + R) / CELL); i++) for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++) {
      const l = segCells.get(i + ',' + j);
      if (l) for (const n of l) {
        if (seen.has(n)) continue; seen.add(n);
        const s = segs[n], p = list[s[4]];
        if (pick && !pick(p)) continue;
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2)), qx = s[0] + t * dx, qz = s[1] + t * dz, d = Math.hypot(x - qx, z - qz);
        if (d <= R && (!best || d < best[0])) best = [d, qx, qz, p];
      }
    }
    return best;
  }
  // the plans (x, z) is inside
  function within(x, z, pick) {
    const l = planCells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!l) return null;
    for (const k of l) { const p = list[k]; if ((!pick || pick(p)) && inPlan(p, x, z)) return p; }
    return null;
  }
  const isSolid = (p) => p.solid;

  /** How far inside a solid outline (x, z) is (m, to its nearest edge); 0 or less: outside them all. */
  function depth(x, z) {
    const p = within(x, z, isSolid);
    if (!p) return 0;
    let d = 1e9;
    for (const r of [...p.rings, ...p.holes]) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      d = Math.min(d, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    }
    return d;
  }

  // (in the open: in no solid outline, and r clear of every edge)
  const free = (x, z, r) => !within(x, z, isSolid) && !nearest(x, z, r - 0.02, isSolid);

  /** The nearest place in the open to (x, z): the walker set down there - by a jump, at the start - is kept out of
   *  every solid outline and r clear of its edges: [x, z]. Outlines may lie over each other (a wall's end inside its
   *  tower, a porch against its house): he is put out by the nearest edge that leads into the open, out of them all,
   *  not into the next one. */
  function push(x, z, r = 0.45) {
    if (free(x, z, r)) return [x, z];
    // (a step off the nearest point of each edge near him, on either side of it: the nearest of those in the open)
    let best = null;
    const R = 3 * r + 1;
    const p = within(x, z, isSolid);
    const bb = p ? [Math.min(p.bb[0], x - R), Math.min(p.bb[1], z - R), Math.max(p.bb[2], x + R), Math.max(p.bb[3], z + R)] : [x - R, z - R, x + R, z + R];
    const done = new Set();
    cellsOf(bb[0], bb[1], bb[2], bb[3], (c) => {
      const l = segCells.get(c);
      if (l) for (const n of l) {
        if (done.has(n)) continue; done.add(n);
        const s = segs[n]; if (!list[s[4]].solid) continue;
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9, L = Math.sqrt(L2);
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2)), qx = s[0] + t * dx, qz = s[1] + t * dz;
        for (const sgn of [1, -1]) {
          const cx = qx - dz / L * sgn * (r + 0.01), cz = qz + dx / L * sgn * (r + 0.01), d = Math.hypot(cx - x, cz - z);
          if ((!best || d < best[0]) && free(cx, cz, r)) best = [d, cx, cz];
        }
      }
    });
    if (best) return [best[1], best[2]];
    // (none: a corner, a narrow place, deep in a great building. Rings out from him, a little finer than his body)
    for (let d = r * 0.5; d < 400; d += Math.max(r * 0.5, d * 0.08)) {
      const n = Math.max(12, Math.round(2 * Math.PI * d / (r * 1.2)));
      for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
        if (free(cx, cz, r)) return [cx, cz];
      }
    }
    return [x, z];
  }

  /** Does the straight line from (ax, az) to (bx, bz) cross the edge of a solid outline? */
  function crosses(ax, az, bx, bz) {
    let hit = false; seen.clear();
    const d1x = bx - ax, d1z = bz - az;
    cellsOf(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (c) => {
      const l = segCells.get(c);
      if (l && !hit) for (const n of l) {
        if (seen.has(n)) continue; seen.add(n);
        const s = segs[n]; if (!list[s[4]].solid) continue;
        const d2x = s[2] - s[0], d2z = s[3] - s[1], den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((s[0] - ax) * d2z - (s[1] - az) * d2x) / den, u = ((s[0] - ax) * d1z - (s[1] - az) * d1x) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { hit = true; break; }
      }
    });
    return hit;
  }

  /** The walker's step from (fx, fz) toward (x, z), his body r wide: where he comes to, [x, z]. He slides along a
   *  wall he walks into, stops in a corner, and never comes through anything: the step is taken a hand at a time (a
   *  fence is a hand thick, and at twelve metres a second a frame's step is longer than a man), each hand put off
   *  the nearest edge, and a hand that would end in or against a thing is not taken. Set down inside a thing to
   *  begin with, he is first put out of it (push). */
  function step(fx, fz, x, z, r = 0.45) {
    if (!free(fx, fz, r)) { const q = push(fx, fz, r); fx = q[0]; fz = q[1]; }
    const L = Math.hypot(x - fx, z - fz);
    if (L > 60) return push(x, z, r);                              // (a jump, not a step)
    const n = Math.max(1, Math.ceil(L / (r * 0.45)));
    let px = fx, pz = fz;
    for (let k = 0; k < n; k++) {
      let tx = px + (x - px) / (n - k), tz = pz + (z - pz) / (n - k), ok = false;
      for (let it = 0; it < 6; it++) {
        if (within(tx, tz, isSolid)) break;
        const q = nearest(tx, tz, r, isSolid);
        if (!q || q[0] >= r - 0.02) { ok = true; break; }
        if (q[0] < 1e-4) break;
        tx = q[1] + (tx - q[1]) / q[0] * r; tz = q[2] + (tz - q[2]) / q[0] * r;
      }
      if (!ok || crosses(px, pz, tx, tz)) break;                    // (blocked: he stays where the last hand left him)
      px = tx; pz = tz;
    }
    return [px, pz];
  }

  /** How far (x, z) is from the nearest outline's edge, looking as far as R; under 0: that far inside one. */
  function clearance(x, z, R = 30) {
    const p = within(x, z), n = nearest(x, z, R);
    return p ? -(n ? n[0] : 0) : n ? n[0] : R;
  }
  /** True where the woods plant no tree: in a thing, or nearer its wall than that thing keeps them. */
  function keepAt(x, z) {
    if (within(x, z)) return true;
    const n = nearest(x, z, 10, (p) => p.keep > 0);
    if (!n) return false;
    // (the nearest within 10 m may keep less than a further one: ask each within its own keep)
    if (n[0] < n[3].keep) return true;
    let hit = false; seen.clear();
    for (let i = Math.floor((x - 10) / CELL); i <= Math.floor((x + 10) / CELL) && !hit; i++) for (let j = Math.floor((z - 10) / CELL); j <= Math.floor((z + 10) / CELL) && !hit; j++) {
      const l = segCells.get(i + ',' + j);
      if (l) for (const m of l) {
        const s = segs[m], p = list[s[4]];
        if (!(p.keep > 0)) continue;
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2));
        if (Math.hypot(x - s[0] - t * dx, z - s[1] - t * dz) < p.keep) { hit = true; break; }
      }
    }
    return hit;
  }
  /** Does an outline about to be set down (rings of world [x, z]) come within gap of one that stands? The plan it
   *  meets, or null. Each ring is walked every 0.5 m; what stands is asked by its own corners too. */
  function hits(rings, gap = 0.3, pick) {
    let bb = [1e9, 1e9, -1e9, -1e9];
    for (const r of rings) for (const [x, z] of r) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], z); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], z); }
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.5));
      for (let k = 0; k < n; k++) {
        const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
        const p = within(x, z, pick); if (p) return p;
        const q = nearest(x, z, gap, pick); if (q && q[0] < gap) return q[3];
      }
    }
    // (one that stands wholly inside the new one: its corners)
    let found = null;
    cellsOf(bb[0], bb[1], bb[2], bb[3], (c) => {
      if (found) return;
      const l = planCells.get(c);
      if (l) for (const k of l) {
        const p = list[k]; if (pick && !pick(p)) continue;
        const [x, z] = p.rings[0][0];
        if (rings.some((r) => inRing(r, x, z))) { found = p; return; }
      }
    });
    return found;
  }
  return { list, add, addShape, depth, push, step, free, crosses, clearance, keepAt, hits, within, nearest };
}
