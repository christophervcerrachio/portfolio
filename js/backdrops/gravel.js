// The gravel and sand of the paths' earth (paths.js), and how the meadow's ground draws it with depth (meadow.js).
//
// The gravel is a picture tiled over the paths, made once and the same every time: r, its height (0 the lowest of the
// sand .. 1 a cobble's top, over GRAVEL_DEPTH m); g, each stone's own shade (0.5 .. 1), and on the sand between them
// its grain (0 .. 0.45); b, where the stones are; a, how open each point is to the sky (less in the hollows between
// the stones and round their feet).
//
// The ground's shader (GRAVEL_GLSL) follows each pixel's line of sight down through those heights, and the paths' own
// (their earth worn below the turf, the wheel ruts deeper, the grassy crown between them higher) to where it first
// meets them: parallax occlusion. So the stones stand up out of the path and hide what lies behind them, a rut's far
// side shows and its near side does not; what is met is lit by its own tilt, its hollows darker, and while the sun is
// out the stones throw their shadows across the path (traced back toward the sun through the same heights).
import * as THREE from 'three';

export const GRAVEL_TILE = 3.0;      // metres the picture covers (it repeats: two layers of it, turned apart)
export const GRAVEL_DEPTH = 0.09;    // metres from the lowest sand to the tallest cobble's top

// the stones, largest first: how many on the picture, the half-lengths they come in (m)
// (big enough to read from the hilltop: the paths are seen from 3 to 20 m off)
const STONES = [
  { n: 16, r: [0.05, 0.085] },
  { n: 120, r: [0.025, 0.05] },
  { n: 1400, r: [0.012, 0.025] },
  { n: 7000, r: [0.006, 0.012] },
  { n: 9000, r: [0.003, 0.006] },
];

/** The picture, N pixels square (1024: 3 mm a pixel). */
export function gravelTexture(N = 1024) {
  const PX = GRAVEL_TILE / N, D = GRAVEL_DEPTH;
  let s = 91;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const H = new Float32Array(N * N), S = new Float32Array(N * N), M = new Float32Array(N * N), SAND = new Float32Array(N * N);

  // the sand: low drifts, ripples and grit, repeating with the picture (value noise on a lattice that wraps), its grain
  // a shade to each pixel
  const lattice = (P, seed) => {
    const v = new Float32Array(P * P);
    for (let i = 0; i < P * P; i++) { const h = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; v[i] = h - Math.floor(h); }
    return (x, y) => {                                     // x, y in lattice cells
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const a = ((ix % P) + P) % P, b = ((iy % P) + P) % P, a1 = (a + 1) % P, b1 = (b + 1) % P;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const v00 = v[b * P + a], v10 = v[b * P + a1], v01 = v[b1 * P + a], v11 = v[b1 * P + a1];
      return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
    };
  };
  const drift = lattice(8, 1), ripple = lattice(40, 2), grit = lattice(N / 4, 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, k = j * N + i, g = grit(u * N / 4, v * N / 4);
    const h = 0.004 + 0.006 * drift(u * 6, v * 6) + 0.0025 * ripple(u * 29, v * 29) + 0.0012 * g;
    H[k] = SAND[k] = h / D;
    const w = Math.sin(k * 0.7713 + (k >> 10) * 3.17) * 43758.5453;
    S[k] = 0.45 * (0.5 * (w - Math.floor(w)) + 0.5 * g);
  }

  // the stones: each an ellipse turned its own way, its outline uneven (broken stone, its corners worn), domed with
  // its top tipped one way, and sunk partway into the sand; where one lies over another, the higher shows
  for (const C of STONES) {
    for (let n = 0; n < C.n; n++) {
      const r = C.r[0] * (C.r[1] / C.r[0]) ** rng(), ra = r, rb = r * (0.55 + 0.4 * rng());
      const th = rng() * Math.PI, ct = Math.cos(th), st = Math.sin(th);
      const cx = Math.round(rng() * N), cy = Math.round(rng() * N);
      const top = r * (0.4 + 0.42 * rng()), sink = 0.18 + 0.3 * rng(), tip = (rng() - 0.5) * 0.5;
      const shade = 0.5 + 0.5 * rng(), lump = 0.06 + 0.1 * rng(), w1 = rng() * 6.283, w2 = rng() * 6.283;
      const c1 = Math.cos(w1), s1 = Math.sin(w1), c2 = Math.cos(w2), s2 = Math.sin(w2), lumpy = r > 0.005;
      const R = Math.ceil(ra * (1 + lump) / PX) + 1;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = dx * PX, y = dy * PX;
        const qa = (x * ct + y * st) / ra, qb = (-x * st + y * ct) / rb, q2 = qa * qa + qb * qb;
        if (q2 > 1.7) continue;
        const ql = Math.sqrt(q2);
        let edge = 1;
        if (lumpy && ql > 1e-6) {
          // (sin(3a + w1) and sin(5a + w2) of the angle round it, from its cosine and sine)
          const c = qa / ql, sn = qb / ql, cc = c * c, ss = sn * sn;
          const sin3 = sn * (3 - 4 * ss), cos3 = c * (4 * cc - 3), sin5 = sn * (5 - 20 * ss + 16 * ss * ss), cos5 = c * (16 * cc * cc - 20 * cc + 5);
          edge = 1 + lump * (sin3 * c1 + cos3 * s1) + 0.3 * lump * (sin5 * c2 + cos5 * s2);
        }
        const d = ql / edge;
        if (d >= 1) continue;
        const z = top * ((Math.sqrt(1 - d * d) - sink) / (1 - sink) + tip * qa * 0.5);
        if (z <= 0) continue;
        const px = ((cx + dx) % N + N) % N, py = ((cy + dy) % N + N) % N, k = py * N + px;
        const hz = SAND[k] + z / D;
        const cover = Math.min(1, (1 - d) * rb / PX * 1.6);     // (the outline, a pixel soft)
        if (hz > H[k]) { H[k] += (hz - H[k]) * Math.max(cover, 0.35); S[k] = shade; M[k] = Math.max(M[k], cover); }
      }
    }
  }

  // how open to the sky: below the mean of what is round it, a hollow (two reaches: between the stones, round them)
  const box = (src, rad) => {
    const tmp = new Float32Array(N * N), out = new Float32Array(N * N), w = 2 * rad + 1;
    for (let j = 0; j < N; j++) {
      const row = j * N;
      let acc = 0;
      for (let i = -rad; i <= rad; i++) acc += src[row + ((i % N) + N) % N];
      for (let i = 0; i < N; i++) {
        tmp[row + i] = acc / w;
        acc += src[row + (i + rad + 1) % N] - src[row + (i - rad + N) % N];
      }
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -rad; j <= rad; j++) acc += tmp[(((j % N) + N) % N) * N + i];
      for (let j = 0; j < N; j++) {
        out[j * N + i] = acc / w;
        acc += tmp[((j + rad + 1) % N) * N + i] - tmp[((j - rad + N) % N) * N + i];
      }
    }
    return out;
  };
  const near = box(H, Math.max(2, Math.round(0.01 / PX))), wide = box(H, Math.max(4, Math.round(0.035 / PX)));

  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const hollow = Math.max(0, near[k] - H[k]) * 0.6 + Math.max(0, wide[k] - H[k]) * 0.4;
    data[k * 4] = Math.round(Math.min(1, H[k]) * 255);
    data[k * 4 + 1] = Math.round(S[k] * 255);
    data[k * 4 + 2] = Math.round(Math.min(1, M[k]) * 255);
    data[k * 4 + 3] = Math.round(Math.max(0, 1 - hollow / 0.13) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The paths' look, with depth, for the ground's fragment shader. It needs, declared before it: vnoise (WIND_GLSL), the
 * paths' picture (uPath, uPathSpan: paths.js, r bare earth, g rut, b crown), the earth's colours (uDirt, uDirtDark),
 * the stones' (uStone), the grass's (uMoss); and POM_STEPS defined (0: flat, no march).
 */
export const GRAVEL_GLSL = /* glsl */`
uniform sampler2D uGravel; uniform float uGrTile; uniform float uGrDepth;
// the earth worn below the turf, the ruts deeper, the crown higher (m)
const float PATH_SINK = 0.015, RUT_SINK = 0.05, CROWN_RISE = 0.016;
// the gravel in two layers, turned and scaled apart, each the more of it where the other is the less, so the picture
// never shows where it repeats
const mat2 GRA = mat2(0.8253, 0.5646, -0.5646, 0.8253), GRB = mat2(0.9135, -0.4067, 0.4067, 0.9135);
vec2 gdA, gdA2, gdB, gdB2, gdP, gdP2;    // (each picture's change across this pixel: read as sharp as the pixel sees it)
float wA;                                // (the first layer's share, here)
vec4 grA, grB; vec3 grP;                 // (what the last reading found)
vec2 uvA(vec2 p) { return GRA * p / uGrTile; }
vec2 uvB(vec2 p) { return GRB * p / (uGrTile * 0.71) + vec2(0.37, 0.61); }
float layerH(vec4 g, float share) { return g.r - (1.0 - share) * g.b * max(0.0, g.r - 0.12); }
/** How far below the meadow's surface the path is at p (m). */
float pathDepth(vec2 p) {
  grP = textureGrad(uPath, p / uPathSpan + 0.5, gdP, gdP2).rgb;
  grA = textureGrad(uGravel, uvA(p), gdA, gdA2);
  grB = textureGrad(uGravel, uvB(p), gdB, gdB2);
  float h = max(layerH(grA, wA), layerH(grB, 1.0 - wA));
  h = mix(h, min(h, 0.2), 0.75 * grP.g);                        // (in the ruts the stones are pressed in)
  return grP.r * (PATH_SINK + RUT_SINK * grP.g - CROWN_RISE * grP.b + uGrDepth * (1.0 - h));
}
// a stone's colour by its own shade (0 .. 1): pale limestone, tan, warm grey, dark grey, rust-brown, now and then a
// white quartz, each a little its own
vec3 stoneColour(float k) {
  vec3 c = uStone;
  c = mix(c, uStone * vec3(0.84, 0.7, 0.52), step(0.22, k));
  c = mix(c, vec3(dot(uStone, vec3(0.3, 0.59, 0.11))) * vec3(0.64, 0.6, 0.54), step(0.42, k));
  c = mix(c, uStone * vec3(0.3, 0.29, 0.27), step(0.68, k));
  c = mix(c, uStone * vec3(0.66, 0.42, 0.27), step(0.84, k));
  c = mix(c, vec3(0.8, 0.79, 0.75), step(0.975, k));
  return c * (0.88 + 0.24 * fract(k * 37.31));
}
/**
 * The path at this pixel (pr: the paths' picture here; dx, dy: how xz changes across the pixel, from the caller, where
 * all pixels take the same branch; V: toward the eye; sunOut: 0 .. 1): the colour of what the line of sight meets
 * (rgb) and how much light it throws back (a); nrm tilted to its surface; sunVis, how much of the sun reaches it.
 */
vec4 pathLook(vec2 xz, vec3 pr, vec2 dx, vec2 dy, vec3 V, float sunOut, inout vec3 nrm, out float sunVis) {
  float px = length(abs(dx) + abs(dy));                          // (metres across the pixel)
  gdP = dx / uPathSpan; gdP2 = dy / uPathSpan;
  gdA = GRA * dx / uGrTile; gdA2 = GRA * dy / uGrTile;
  gdB = GRB * dx / (uGrTile * 0.71); gdB2 = GRB * dy / (uGrTile * 0.71);
  wA = smoothstep(0.3, 0.7, vnoise(xz * 0.33 + 3.7));
  sunVis = 1.0;
  float DMAX = PATH_SINK + RUT_SINK + uGrDepth;
  float fade = 1.0 - smoothstep(0.06, 0.16, px);                 // (far off, the heights come to less than a pixel)
  vec2 p = xz;
#if POM_STEPS > 0
  if (fade > 0.0) {
    // ---- down the line of sight a layer at a time (more of them the flatter it runs) to where it first meets the
    // path, then the last step halved toward where it crossed
    float vy = max(V.y, 0.06);
    int steps = int(mix(float(POM_STEPS) * 0.4, float(POM_STEPS), clamp(1.0 - vy * 1.5, 0.0, 1.0)));
    float layer = 1.0 / float(steps);
    vec2 dp = -V.xz / vy * DMAX * layer * fade;
    float depth = 0.0, d = pathDepth(p) / DMAX;
    bool moved = false;
    for (int i = 0; i < POM_STEPS; i++) {
      if (i >= steps || depth >= d) break;
      p += dp; depth += layer; d = pathDepth(p) / DMAX; moved = true;
    }
    if (moved) {
      vec2 lo = p - dp, hi = p;
      float zlo = depth - layer, zhi = depth;
      for (int i = 0; i < 5; i++) {
        vec2 mid = 0.5 * (lo + hi); float zm = 0.5 * (zlo + zhi);
        if (zm >= pathDepth(mid) / DMAX) { hi = mid; zhi = zm; } else { lo = mid; zlo = zm; }
      }
      p = hi;
    }
  }
#endif
  float d0 = pathDepth(p);
  vec4 ga = grA, gb = grB; vec3 q = grP;
  // ---- its tilt there (from the heights a step across and a step along: as fine as the pixel sees them)
  float e = max(0.0025, 0.6 * px);
  vec2 slope = vec2(pathDepth(p + vec2(e, 0.0)) - d0, pathDepth(p + vec2(0.0, e)) - d0) / e;
  nrm = normalize(nrm + vec3(slope.x, 0.0, slope.y));
#if POM_STEPS > 12
  // ---- the sun's way back out: blocked where the stones (or a rut's side) stand above it, softer the further off
  float lh = length(uSunDir.xz);
  if (sunOut > 0.02 && lh > 1e-3 && fade > 0.0) {
    vec2 ld = uSunDir.xz / lh;
    float rise = uSunDir.y / lh;
    for (int i = 1; i <= 6; i++) {
      float t = 0.005 * float(i * i), beam = d0 - rise * t;
      if (beam <= 0.0) break;
      sunVis = min(sunVis, clamp(1.0 - (beam - pathDepth(p + ld * t)) / (0.002 + 0.12 * t), 0.0, 1.0));
    }
    sunVis = mix(1.0, sunVis, fade);
  }
#endif
  // ---- what is there: the stone the line of sight met (the higher layer's), or the sand between
  float hA = layerH(ga, wA), hB = layerH(gb, 1.0 - wA), h = max(hA, hB);
  vec4 g = hA >= hB ? ga : gb;
  float stone = g.b * (1.0 - 0.4 * q.g);
  // dry, packed earth: sand and dust, paler where most worn, browner in patches
  float m = vnoise(xz * 0.9) * 0.45 + vnoise(xz * 3.7) * 0.35 + vnoise(xz * 13.0) * 0.2;
  vec3 earth = mix(uDirtDark, uDirt, smoothstep(0.15, 0.85, m));
  vec3 sand = earth * (0.93 + 0.14 * clamp(g.g / 0.45, 0.0, 1.0));
  vec3 rock = mix(stoneColour(clamp((g.g - 0.5) * 2.0, 0.0, 1.0)), earth, 0.08);
  vec3 col = mix(sand, rock, stone);
  // the wheel ruts browner, pressed hard; the crown between them grassed over here and there
  col = mix(col, col * vec3(0.88, 0.82, 0.74), 0.5 * q.g);
  col = mix(col, mix(col, uMoss * 0.85, 0.45 + 0.25 * vnoise(xz * 6.0)), 0.6 * q.b);
  // dry dust and pale stone throw the light back; the hollows between the stones and the low sand less
  float cav = mix(0.28, 1.0, g.a) * mix(0.75, 1.0, smoothstep(0.08, 0.45, h));
  return vec4(col, 1.42 * mix(1.0, cav, fade));
}`;
