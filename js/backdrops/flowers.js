// Wildflowers of a Russian summer meadow, built in code. Each species is a small 3D model (stem, leaves, flower heads)
// made of real geometry: every petal of a daisy, every floret of a cornflower, every pea flower on a lupine's spike.
// The meadow (meadow.js) scatters thousands of copies of each, and the wind bends each one from its root.
//
// A model is built into flat arrays, in metres, with its root at the origin and y up:
//   position, normal, color (linear RGB), tint (0: keeps its own colour; 1: takes the copy's petal colour, keeping its
//   own light and shade, so one lupine model blooms violet, pink or purple), bend (0 at the root .. 1 at the top: how
//   far the wind moves it).
// detail 1 is the close-up model; detail 0 a lighter one for the far meadow (fewer petals, no leaves, thinner stems).
import * as THREE from 'three';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/** A seeded random source: rng() in 0..1, rng.range(a, b), rng.pick(list). */
export function seeded(seed) {
  let s = (seed >>> 0) || 1;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  rng.range = (a, b) => a + (b - a) * rng();
  rng.pick = (l) => l[Math.floor(rng() * l.length) % l.length];
  return rng;
}

class Plant {
  constructor() { this.p = []; this.n = []; this.c = []; this.t = []; this.i = []; }
  vert(p, n, c, tint = 0) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b); this.t.push(tint);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }

  /** A tube along points (a stem, a branch), radius from r0 to r1, `sides` around, coloured from c0 to c1. */
  tube(pts, r0, r1, sides, c0, c1 = c0) {
    const n = pts.length, rings = [];
    let normal = null;
    for (let k = 0; k < n; k++) {
      const tan = (k < n - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
      if (!normal) normal = Math.abs(tan.y) < 0.9 ? V(0, 1, 0).cross(tan).normalize() : V(1, 0, 0).cross(tan).normalize();
      else normal.sub(tan.clone().multiplyScalar(normal.dot(tan))).normalize();          // carried along (no twist)
      const bin = tan.clone().cross(normal), u = k / (n - 1), r = r0 + (r1 - r0) * u, col = c0.clone().lerp(c1, u);
      const ring = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2, d = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
        ring.push(this.vert(pts[k].clone().addScaledVector(d, r), d, col));
      }
      rings.push(ring);
    }
    for (let k = 0; k < n - 1; k++) for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      this.quad(rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j]);
    }
  }

  /**
   * A petal or a leaf: a strip from `base` along `dir`, its face toward `face`, `len` long and `width` wide at its
   * widest (at `widest` of its length), curling by `curl` (radians, toward its face) along its length, folded along
   * its midrib by `fold`. Coloured c0 at the base to c1 at the tip.
   */
  blade(base, dir, face, len, width, { curl = 0, fold = 0.2, widest = 0.5, segs = 3, c0, c1 = c0, tint = 0, tip = 0 }) {
    const side = dir.clone().cross(face).normalize(), d = dir.clone().normalize(), f = face.clone().normalize();
    const rows = [];
    let p = base.clone(), dd = d.clone(), ff = f.clone();
    const q = new THREE.Quaternion().setFromAxisAngle(side, -curl / segs);
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const w = width * (u <= widest ? Math.sin((u / widest) * Math.PI / 2) ** 0.7 : Math.cos(((u - widest) / (1 - widest)) * Math.PI / 2) ** 0.8);
      const ww = k === segs ? width * tip : Math.max(w, width * 0.12 * (1 - u));
      const col = c0.clone().lerp(c1, u);
      const mid = p.clone().addScaledVector(ff, fold * ww * 0.5);                 // the midrib stands proud of the edges
      rows.push([
        this.vert(p.clone().addScaledVector(side, -ww / 2), ff.clone().addScaledVector(side, -fold).normalize(), col, tint),
        this.vert(mid, ff, col, tint),
        this.vert(p.clone().addScaledVector(side, ww / 2), ff.clone().addScaledVector(side, fold).normalize(), col, tint),
      ]);
      dd.applyQuaternion(q); ff.applyQuaternion(q);
      p.addScaledVector(dd, len / segs);
    }
    for (let k = 0; k < segs; k++) {
      this.quad(rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]);
      this.quad(rows[k][1], rows[k][2], rows[k + 1][2], rows[k + 1][1]);
    }
  }

  /** A dome (a daisy's disc, a buttercup's heart): radius r, height h, facing `up`, `segs` around. */
  dome(center, up, r, h, segs, c0, c1 = c0, tint = 0) {
    const u = up.clone().normalize(), a = Math.abs(u.y) < 0.9 ? V(0, 1, 0).cross(u).normalize() : V(1, 0, 0).cross(u).normalize(), b = u.clone().cross(a);
    const top = this.vert(center.clone().addScaledVector(u, h), u, c1, tint);
    const ring = [], mid = [];
    for (let j = 0; j < segs; j++) {
      const t = (j / segs) * Math.PI * 2, d = a.clone().multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t));
      mid.push(this.vert(center.clone().addScaledVector(d, r * 0.62).addScaledVector(u, h * 0.78), d.clone().addScaledVector(u, 1.4).normalize(), c0.clone().lerp(c1, 0.6), tint));
      ring.push(this.vert(center.clone().addScaledVector(d, r), d.clone().addScaledVector(u, 0.5).normalize(), c0, tint));
    }
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      this.tri(top, mid[j], mid[j2]);
      this.quad(mid[j], ring[j], ring[j2], mid[j2]);
    }
  }

  /** A bell or funnel of revolution along `axis`: from radius r0 at the base to r1 at the mouth, `lobes` points. */
  bell(base, axis, len, r0, r1, sides, c0, c1, { lobes = 5, flare = 0.25, tint = 0 } = {}) {
    const u = axis.clone().normalize(), a = Math.abs(u.y) < 0.9 ? V(0, 1, 0).cross(u).normalize() : V(1, 0, 0).cross(u).normalize(), b = u.clone().cross(a);
    const rows = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, r = r0 + (r1 - r0) * Math.pow(t, 1.6), row = [];
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2, d = a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
        const lobe = k === 3 ? 1 + flare * Math.max(0, Math.cos(ang * lobes)) : 1;
        const out = k === 3 ? flare * 0.6 * lobe : 0;
        const p = base.clone().addScaledVector(u, len * t * (k === 3 ? 1 + 0.12 * (lobe - 1) : 1)).addScaledVector(d, r * lobe + len * out * 0.2);
        row.push(this.vert(p, d.clone().addScaledVector(u, -0.3).normalize(), c0.clone().lerp(c1, t), tint));
      }
      rows.push(row);
    }
    for (let k = 0; k < 3; k++) for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      this.quad(rows[k][j], rows[k][j2], rows[k + 1][j2], rows[k + 1][j]);
    }
  }

  /** The finished model: an indexed BufferGeometry with bend = height over the plant's height (the root stays put). */
  geometry() {
    const g = new THREE.BufferGeometry();
    let top = 0;
    for (let k = 1; k < this.p.length; k += 3) top = Math.max(top, this.p[k]);
    const bend = new Float32Array(this.p.length / 3);
    for (let k = 0; k < bend.length; k++) bend[k] = Math.max(0, this.p[3 * k + 1]) / top;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute('bend', new THREE.BufferAttribute(bend, 1));
    g.setIndex(this.i);
    g.userData.height = top;
    return g;
  }
}

/** A stem's points: from the root up to `h`, leaning a little and curving (a gentle S). */
function stemPath(rng, h, n = 6, lean = 0.08) {
  const dx = rng.range(-1, 1) * lean, dz = rng.range(-1, 1) * lean, s = rng.range(-0.04, 0.04);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, wob = Math.sin(t * Math.PI * 1.5) * s * h;
    pts.push(V(dx * h * t * t + wob, h * t, dz * h * t * t - wob * 0.6));
  }
  return pts;
}
const tipDir = (pts) => pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
const around = (axis, ang) => {                                                      // unit vectors at right angles to axis
  const a = Math.abs(axis.y) < 0.9 ? V(0, 1, 0).cross(axis).normalize() : V(1, 0, 0).cross(axis).normalize(), b = axis.clone().cross(a);
  return a.multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
};

// colours (sRGB as painted, kept in linear)
const C = {
  stem: lin('#4f7a2a'), stemDark: lin('#2f4f1a'), stemRed: lin('#7a3a3a'), leaf: lin('#5a8a2c'), leafGrey: lin('#7d9a6a'),
  leafDark: lin('#3d6a22'), white: lin('#f7f4ea'), whiteShade: lin('#d9dccb'), yellow: lin('#f4cf2a'), yellowDeep: lin('#e3a91c'),
  butter: lin('#ffe45a'), green: lin('#9ab43a'), petalWhite: lin('#ffffff'), petalShade: lin('#b8b8c8'), bud: lin('#6f8a3a'),
};

/** Narrow leaves along the lower stem. */
function stemLeaves(P, rng, pts, count, len, width, from, to, color, droop = 0.6) {
  for (let k = 0; k < count; k++) {
    const t = from + (to - from) * (k + rng.range(0.1, 0.9)) / count, idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const at = pts[idx].clone().lerp(pts[idx + 1], t * (pts.length - 1) - idx);
    const out = around(UP, rng() * Math.PI * 2), dir = out.clone().multiplyScalar(0.8).addScaledVector(UP, 0.6).normalize();
    P.blade(at, dir, out.clone().multiplyScalar(-0.4).add(UP).normalize(), len * rng.range(0.8, 1.2), width, { curl: -droop, fold: 0.35, widest: 0.35, segs: 3, c0: color, c1: color.clone().multiplyScalar(1.1) });
  }
}

export const SPECIES = {
  // oxeye daisy / chamomile: a yellow disc, a ring of white rays
  daisy: { height: [0.32, 0.6], build(rng, detail) {
    const P = new Plant(), h = 1, pts = stemPath(rng, h, detail ? 6 : 3);
    P.tube(pts, 0.004 / 0.45, 0.0025 / 0.45, detail ? 5 : 3, C.stem, C.stem);
    if (detail) stemLeaves(P, rng, pts, 2, 0.12, 0.012, 0.08, 0.4, C.leafDark);
    const top = pts[pts.length - 1], up = tipDir(pts).add(around(UP, rng() * 6.28).multiplyScalar(0.45)).normalize();
    const s = 1 / 0.45;                                       // (modelled at a height of 1; real sizes scaled for 45 cm)
    P.dome(top, up, 0.0095 * s, 0.006 * s, detail ? 10 : 6, C.yellowDeep, C.yellow);
    const n = detail ? 21 : 11;
    for (let k = 0; k < n; k++) {
      const out = around(up, (k / n) * Math.PI * 2 + rng.range(-0.08, 0.08)), dir = out.clone().addScaledVector(up, rng.range(-0.05, 0.25)).normalize();
      P.blade(top.clone().addScaledVector(out, 0.008 * s).addScaledVector(up, 0.002 * s), dir, up, rng.range(0.019, 0.025) * s, 0.0058 * s,
        { curl: rng.range(-0.5, 0.1), fold: 0.15, widest: 0.6, segs: detail ? 3 : 1, c0: C.whiteShade, c1: C.white, tip: 0.55 });
    }
    return P;
  } },
  // cornflower: a cup of green-grey scales, a crown of ragged blue funnels, a dark violet heart
  cornflower: { height: [0.4, 0.72], tints: ['#5d8cec', '#6a94f0', '#6f86e2', '#5682e4'], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, detail ? 6 : 3, 0.1), s = 1 / 0.55;
    P.tube(pts, 0.0035 * s, 0.002 * s, detail ? 5 : 3, C.leafGrey, C.leafGrey);
    if (detail) stemLeaves(P, rng, pts, 3, 0.1, 0.006, 0.1, 0.6, C.leafGrey, 0.3);
    const top = pts[pts.length - 1], up = tipDir(pts).add(around(UP, rng() * 6.28).multiplyScalar(0.35)).normalize();
    P.bell(top.clone().addScaledVector(up, -0.012 * s), up, 0.013 * s, 0.0035 * s, 0.0062 * s, detail ? 8 : 5, C.stemDark, C.leafGrey, { lobes: 0, flare: 0 });
    const n = detail ? 11 : 7;
    for (let k = 0; k < n; k++) {
      const out = around(up, (k / n) * Math.PI * 2 + rng.range(-0.15, 0.15)), dir = out.clone().addScaledVector(up, rng.range(0.25, 0.6)).normalize();
      if (detail) P.bell(top.clone().addScaledVector(out, 0.004 * s), dir, 0.016 * s, 0.0012 * s, 0.0055 * s, 5, C.petalShade, C.petalWhite, { lobes: 5, flare: 0.55, tint: 1 });
      else P.blade(top.clone().addScaledVector(out, 0.004 * s), dir, up, 0.017 * s, 0.009 * s, { curl: -0.3, segs: 1, c0: C.petalShade, c1: C.petalWhite, tint: 1, tip: 0.8 });
    }
    P.dome(top.clone().addScaledVector(up, 0.002 * s), up, 0.005 * s, 0.006 * s, detail ? 8 : 5, lin('#3a2a6a'), lin('#5a3a8a'));
    return P;
  } },
  // lupine: a tall spike of pea flowers in whorls, buds at the top; palmate leaves low down
  lupine: { height: [0.55, 0.9], tints: ['#5b54d6', '#7a4fd0', '#d96aa6', '#e88ab8', '#9a48c4', '#c44f7e'], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, detail ? 8 : 4, 0.05), s = 1 / 0.95;
    P.tube(pts, 0.006 * s, 0.003 * s, detail ? 6 : 3, C.stem, C.stem);
    if (detail) for (let k = 0; k < 3; k++) {                                         // palmate leaves on long stalks
      const at = pts[1].clone().lerp(pts[2], k / 3), out = around(UP, rng() * 6.28 + k * 2.1);
      const stalkEnd = at.clone().addScaledVector(out, 0.07 * s).addScaledVector(UP, 0.05 * s);
      P.tube([at, at.clone().lerp(stalkEnd, 0.5).addScaledVector(UP, 0.01 * s), stalkEnd], 0.0018 * s, 0.0014 * s, 3, C.stem);
      for (let j = 0; j < 9; j++) {
        const d = around(UP, (j / 9) * 6.28).addScaledVector(UP, 0.25).normalize();
        P.blade(stalkEnd, d, UP.clone().addScaledVector(d, -0.3).normalize(), 0.055 * s, 0.011 * s, { curl: -0.5, fold: 0.4, widest: 0.55, segs: 2, c0: C.leafDark, c1: C.leaf });
      }
    }
    // the spike, from 45% of the height to the top; whorls of five, smaller and greener toward the top
    const spikeFrom = 0.45, whorls = detail ? 16 : 8;
    for (let w = 0; w < whorls; w++) {
      const t = spikeFrom + (1 - spikeFrom) * (w / whorls) * 0.97, idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const at = pts[idx].clone().lerp(pts[idx + 1], t * (pts.length - 1) - idx), k = w / whorls, bud = k > 0.72;
      const size = (0.0125 - 0.006 * k) * s, nf = detail ? 5 : 3;
      for (let j = 0; j < nf; j++) {
        const out = around(UP, (j / nf) * 6.28 + w * 0.63 + rng.range(-0.2, 0.2));
        const base = at.clone().addScaledVector(out, 0.004 * s);
        if (bud) P.blade(base, out.clone().addScaledVector(UP, 0.9).normalize(), out, size * 1.1, size * 0.55, { curl: 0.4, segs: 1, c0: C.bud, c1: C.petalShade, tint: 0.55, tip: 0.3 });
        else {
          // the banner, upright behind; the keel and wings, forward
          P.blade(base, UP.clone().addScaledVector(out, 0.35).normalize(), out, size, size * 0.9, { curl: -0.5, fold: 0.35, widest: 0.6, segs: detail ? 2 : 1, c0: C.petalShade, c1: C.petalWhite, tint: 1, tip: 0.6 });
          if (detail) P.blade(base.clone().addScaledVector(UP, size * 0.15), out.clone().addScaledVector(UP, -0.25).normalize(), UP, size * 0.85, size * 0.55, { curl: 0.6, fold: 0.6, segs: 1, c0: C.petalShade, c1: C.petalWhite, tint: 0.85, tip: 0.4 });
        }
      }
    }
    return P;
  } },
  // fireweed (Ivan-chai): a tall stem of narrow leaves; open four-petalled flowers below, nodding buds above
  fireweed: { height: [0.7, 1.05], tints: ['#ec6fb0', '#f07ab8', '#e2609f', '#f48cc0'], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, detail ? 8 : 4, 0.05), s = 1 / 1.05;
    P.tube(pts, 0.005 * s, 0.002 * s, detail ? 5 : 3, C.stemRed, C.stemRed);
    if (detail) stemLeaves(P, rng, pts, 9, 0.11, 0.012, 0.08, 0.55, C.leafDark, 0.9);
    const from = 0.55, n = detail ? 22 : 10;
    for (let k = 0; k < n; k++) {
      const t = from + (1 - from) * (k / n) * 0.98, idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const at = pts[idx].clone().lerp(pts[idx + 1], t * (pts.length - 1) - idx), u = k / n;
      const out = around(UP, k * 2.4 + rng.range(-0.3, 0.3));
      if (u > 0.62) {                                                                  // buds, nodding outward
        P.blade(at, out.clone().addScaledVector(UP, 0.5).normalize(), out, (0.014 - 0.006 * u) * s, 0.004 * s, { curl: 0.9, segs: 1, c0: C.stemRed, c1: C.petalShade, tint: 0.6, tip: 0.2 });
      } else {
        const stalk = at.clone().addScaledVector(out, 0.012 * s).addScaledVector(UP, 0.004 * s);
        P.tube([at, stalk], 0.0012 * s, 0.001 * s, 3, C.stemRed);
        const face = out.clone().addScaledVector(UP, 0.35).normalize();
        for (let j = 0; j < 4; j++) {                                                 // four broad petals
          const d = around(face, (j / 4) * 6.28 + 0.4).addScaledVector(face, 0.15).normalize();
          P.blade(stalk, d, face, 0.012 * s, 0.0105 * s, { curl: -0.3, fold: 0.15, widest: 0.65, segs: detail ? 2 : 1, c0: C.petalShade, c1: C.petalWhite, tint: 1, tip: 0.7 });
        }
        if (detail) P.tube([stalk, stalk.clone().addScaledVector(face, 0.01 * s)], 0.0008 * s, 0.0006 * s, 3, C.white);   // the white style
      }
    }
    return P;
  } },
  // meadow buttercup: a branching stem, small glossy yellow cups
  buttercup: { height: [0.3, 0.58], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, detail ? 5 : 3, 0.1), s = 1 / 0.45;
    P.tube(pts, 0.0028 * s, 0.0018 * s, detail ? 4 : 3, C.stem);
    const tops = [pts[pts.length - 1]];
    if (detail) for (let b = 0; b < 2; b++) {                                         // two side branches
      const at = pts[3 + b].clone(), out = around(UP, rng() * 6.28), end = at.clone().addScaledVector(out, 0.07 * s).addScaledVector(UP, rng.range(0.08, 0.14) * s);
      P.tube([at, at.clone().lerp(end, 0.5).addScaledVector(UP, 0.02 * s), end], 0.0018 * s, 0.0014 * s, 3, C.stem);
      tops.push(end);
    }
    for (const top of tops) {
      const up = UP.clone().add(around(UP, rng() * 6.28).multiplyScalar(0.5)).normalize();
      for (let j = 0; j < 5; j++) {
        const d = around(up, (j / 5) * 6.28).addScaledVector(up, 0.75).normalize();
        P.blade(top, d, up.clone().addScaledVector(d, -0.6).normalize(), 0.011 * s, 0.01 * s, { curl: -0.5, fold: 0.1, widest: 0.7, segs: detail ? 2 : 1, c0: C.yellowDeep, c1: C.butter, tip: 0.6 });
      }
      if (detail) P.dome(top.clone().addScaledVector(up, 0.002 * s), up, 0.003 * s, 0.002 * s, 6, C.green, C.butter);
    }
    return P;
  } },
  // red clover: a low plant, three-leaflet leaves, a round pink head of florets
  clover: { height: [0.14, 0.28], tints: ['#c84a86', '#d65a92', '#b94080'], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, 4, 0.12), s = 1 / 0.2;
    P.tube(pts, 0.0025 * s, 0.002 * s, 3, C.stem);
    if (detail) for (let k = 0; k < 2; k++) {
      const at = pts[1 + k], d0 = around(UP, rng() * 6.28);
      for (let j = 0; j < 3; j++) {
        const d = around(UP, (j / 3) * 6.28 + d0.x * 3).addScaledVector(UP, 0.2).normalize();
        P.blade(at, d, UP, 0.022 * s, 0.013 * s, { curl: -0.2, fold: 0.2, widest: 0.55, segs: 2, c0: C.leaf, c1: C.leafGrey });
      }
    }
    const top = pts[pts.length - 1], n = detail ? 26 : 12;
    for (let k = 0; k < n; k++) {                                                     // florets: a ball of upturned spikes
      const y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(1 - y * y), a = k * 2.399;
      const d = V(Math.cos(a) * r, y * 0.8 + 0.35, Math.sin(a) * r).normalize();
      P.blade(top.clone().addScaledVector(d, 0.004 * s), d, around(d, 0), 0.008 * s, 0.0035 * s, { segs: 1, c0: C.petalShade, c1: C.petalWhite, tint: 1, tip: 0.2 });
    }
    return P;
  } },
  // spreading bellflower: a slim branching stem with violet bells facing out
  bellflower: { height: [0.3, 0.55], tints: ['#7a68d8', '#8a72e0', '#6a5ccc'], build(rng, detail) {
    const P = new Plant(), pts = stemPath(rng, 1, detail ? 5 : 3, 0.1), s = 1 / 0.42;
    P.tube(pts, 0.002 * s, 0.0014 * s, 3, C.stem);
    const n = detail ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const at = pts[pts.length - 1 - k], out = around(UP, rng() * 6.28 + k * 2.1);
      const end = at.clone().addScaledVector(out, 0.03 * s).addScaledVector(UP, 0.02 * s);
      P.tube([at, end], 0.0012 * s, 0.001 * s, 3, C.stem);
      const axis = out.clone().addScaledVector(UP, rng.range(-0.1, 0.5)).normalize();
      P.bell(end, axis, 0.018 * s, 0.0025 * s, 0.009 * s, detail ? 10 : 5, C.petalShade, C.petalWhite, { lobes: 5, flare: 0.45, tint: 1 });
    }
    return P;
  } },
};

/** A species' models: `variants` close-up ones and as many light ones, each with its height and petal tints. */
export function buildSpecies(name, variants = 3, seed = 1) {
  const sp = SPECIES[name], out = { near: [], far: [], height: sp.height, tints: (sp.tints ?? ['#ffffff']).map(lin) };
  for (let v = 0; v < variants; v++) {
    out.near.push(sp.build(seeded(seed * 97 + v * 13 + 1), 1).geometry());
    out.far.push(sp.build(seeded(seed * 97 + v * 13 + 1), 0).geometry());
  }
  return out;
}
