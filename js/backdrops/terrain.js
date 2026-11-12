// The land all the way round the hilltop and out to the far horizons: one world, so the ring's painting and the walk's
// ground are the same land. Ahead lies the valley of my painting as it always was (plateLand: its river, its lake, the
// church's rise); round the rest of the way, the world the ring is painted from (site-dev/world): to the right the
// estate's valley and the uplands beyond it, behind the hill's back falling to the Neva lowland where Petersburg lies,
// to the left the green foothills of the Caucasus with Mashuk and five-headed Beshtau standing out of the plain, and on
// the horizon the snowy range with two-headed Elbrus. Heights in metres, the camera's ground at 0; x right, z back;
// directions (az) in radians clockwise from ahead, as LANDMARKS has them.
//
// valley.js draws its distances from worldHeight out to 22 km; site-dev/world/heights.mjs samples it out to the
// horizon for the painting (with the earth's curve, which only the painting needs).

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const AT = (azDeg, r) => { const a = (azDeg * Math.PI) / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };

// a little integer-hashed value noise (deterministic)
function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let k = 0; k < oct; k++) { s += a * noise(x * f + k * 17.3, y * f - k * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
// ridges: sharp crests, the finer ones where the coarser stand high (a mountain range's crests and spurs), 0..1
export function ridged(x, y, oct = 7) {
  let s = 0, a = 0.5, f = 1, n = 0, w = 1;
  for (let k = 0; k < oct; k++) {
    let v = 1 - Math.abs(noise(x * f + k * 31.7, y * f - k * 17.9) * 2 - 1);
    v *= v; v *= w; w = Math.min(1, Math.max(0, v * 1.8));
    s += v * a; n += a; a *= 0.52; f *= 2.07;
  }
  return s / n;
}

// ---- ahead: my painting's valley (as valley.js always had it)
export const RIVER = [AT(-40, 3400), AT(-29, 2300), AT(-19, 1600), AT(-10, 1230), AT(-2, 1040), AT(5, 950), AT(11, 930), AT(17, 990), AT(24, 1120), AT(31, 1400), AT(40, 2100), AT(48, 3200)];
export const RIVER_LEVEL = -89.2;
export const LAKE = { c: AT(14, 395), rx: 66, rz: 30, level: -88.9 };
export const CHURCH = { at: AT(19, 650) };
const FLOOR = -88;

function segDist(x, z, P) {
  let best = 1e9, at = 0;
  for (let k = 0; k < P.length - 1; k++) {
    const [ax, az] = P[k], [bx, bz] = P[k + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) { best = d; at = k + t; }
  }
  return [best, at];
}

/** The painting's valley (ahead): the land my painting shows, as it always was. */
export function plateLand(x, z) {
  const r = Math.hypot(x, z), az = Math.atan2(x, -z), round = smooth(2.0, 2.6, Math.abs(az));
  let h = -6 - (-FLOOR - 6) * (1 - Math.exp(-Math.max(0, r - 28) / 70));       // the hill falls steeply into the valley
  h += smooth(-0.12, -0.55, az) * 52 * smooth(480, 1350, r) * (1 - round);       // the left side rises sooner
  h += smooth(0.42, 0.75, az) * 34 * smooth(650, 1500, r) * (1 - round);
  // hills, then ranges (behind, toward Petersburg, the plain stays flat out to the horizon)
  h += 62 * smooth(1500, 3800, r) + (125 * smooth(3800, 9500, r) + 120 * smooth(9500, 18000, r)) * (1 - 0.8 * smooth(2.2, 2.8, Math.abs(az)));
  const amp = 3 * smooth(100, 400, r) + 24 * smooth(500, 2600, r) + 95 * smooth(3000, 12000, r);
  h += amp * (fbm(x / 950, z / 950) - 0.5) * 2;
  const [cx, cz] = CHURCH.at, dc = Math.hypot(x - cx, z - cz);
  h += 36 * Math.exp(-(dc * dc) / (2 * 170 * 170));                              // the church's rise
  const [d] = segDist(x, z, RIVER), w = 26;
  h = h + (RIVER_LEVEL - 1.6 - h) * (1 - smooth(w * 0.45, w * 2.6, d)) * (h > RIVER_LEVEL - 1.6 ? 1 : 0);
  const dl = Math.hypot((x - LAKE.c[0]) / LAKE.rx, (z - LAKE.c[1]) / LAKE.rz);
  h = h + (LAKE.level - 2.5 - h) * (1 - smooth(0.82, 1.6, dl)) * (h > LAKE.level - 2.5 ? 1 : 0);
  return h;
}

// ---- round the rest of the way: the world the ring is painted from
// Where each part lies. The painting's sector (|az| < PLATE[0]) is plateLand alone; past PLATE[1] the ring's land
// alone; between, the one turns into the other.
export const PLATE = [0.8, 1.0];
// Behind: the hill's back falls (the klint) to the Neva lowland, LOW m, from about 300 m to 1.5 km out; Petersburg lies
// on it (CITY: where the plan's corner under the hill is, how the plan is turned: site-dev/world/city.py).
export const LOW = -160;
export const WATER = -161.5;                 // (the Neva's and the gulf's water)
export const GULF = { az: [118, 168], shore: 15000 };
// Petersburg's plan (site-dev/massing/readings/spb.npz, 6.5 m a pixel): its pixel (px, py) under the hilltop, and the
// plan's north turned to `north` (the plan's view to the fortress, compass -54.6 degrees, behind the hill)
export const CITY = { px: 610, py: 470, m: 6.5, north: Math.PI + 0.9536 };
// The rivers round the ring, each with its water's level along it (m): the painting's river, out of the foothills on the
// left (the Podkumok), through the painting's valley (its own course there, plateLand's: the null), on round to the
// right past the estate (its ponds) and down off the klint into the lowland to the gulf; and the Neva, out of the far
// plain behind and to the left, round the hill's back into Petersburg (its course through the city is the plan's own).
export const RIVERS = {
  right: { w: 30, pts: [[-80, 21000, -62], [-76, 16500, -72], [-72, 12500, -79], [-66, 9200, -84], [-57, 6600, -87], [-48, 4600, -88.5],
    [-40, 3400, -89.2], null, [48, 3200, -89.2], [55, 3700, -89.6], [63, 3900, -90.2], [72, 3300, -91.0], [80, 2500, -92.5], [88, 2050, -94.0],
    [97, 2150, -95.0], [106, 2700, -96.5], [114, 3500, -100], [121, 4700, -112], [127, 6300, -140], [131, 8200, -158], [134, 10500, -161.5],
    [137, 13500, -161.5]] },
  neva: { w: 80, pts: [[-118, 22000, -158], [-124, 15000, -159.5], [-129, 10000, -160.5], [-131, 6500, -161], [-128, 4000, -161.3],
    [-123, 2700, -161.5], [-119.6, 1930, -161.5]] },
};
// The estate (right): its valley's floor, the manor on the rise beyond the ponds, the village and its church behind
export const ESTATE = { valley: AT(91, 2150), manor: AT(93, 2620), village: AT(104, 3500), church: AT(101, 3900) };
// The left: the lone mountains of the Pyatigorye (laccoliths: domes of rock pushed up through the plain), each
// [az (deg), distance (m), its height over the plain (m), radius (m), how pointed (1 a dome, higher sharper)]
export const LONE = [
  ['mashuk', -114, 10500, 470, 2300, 1.0], ['beshtau', -71, 16500, 250, 4000, 0.8],
  ['zheleznaya', -54, 21000, 330, 1700, 1.6], ['zmeyka', -89, 19500, 450, 2100, 1.2], ['razvalka', -62, 25000, 400, 2400, 1.1],
  ['byk', -98, 23000, 300, 1300, 1.4], ['lysaya', -125, 17500, 230, 2000, 1.0], ['kinzhal', -81, 21500, 170, 520, 2.4],
  ['verblyud-w', -105.5, 25500, 330, 1400, 1.3], ['verblyud-e', -102.4, 25500, 300, 1400, 1.3],
];
// Beshtau's five heads over its broad base: [along the view (m, + to the right as seen from the hill), toward the hill
// (m), height over the base (m), radius (m)]
export const BESHTAU5 = [[0, 0, 560, 1300], [-2000, 400, 400, 1050], [1750, -300, 360, 1000], [-3300, -500, 250, 850], [3100, 800, 260, 900]];
// Elbrus: its two heads (west 5642 m, east 5621 m above the sea; the hill stands at 600 m) across the view, a little
// further apart than they are (1.9 km, not 1.5) so the saddle between them reads from the hill; its cone, and the main
// range behind it from end to end
export const ELBRUS = { az: -91.2, r: 45000, heads: [[-950, 0, 5042], [950, -180, 5021]], cone: 4500, massif: 13000 };
export const RANGE = { az: [-150, -40], r: 58000, depth: 11000 };

const sectorOf = (az, r) => {
  // (behind, the lowland; then left and right; each 0..1, summing to 1. The lowland reaches a little further round on the
  // left, where the Neva comes in out of the far plain)
  const back = az > 0 ? smooth(2.02, 2.32, az) : smooth(1.86, 2.10, -az);
  return { back, left: az < 0 ? 1 - back : 0, right: az > 0 ? 1 - back : 0 };
};
const near = (x, z, P, rad) => Math.hypot(x - P[0], z - P[1]) / rad;

function carve(h, x, z, R) {
  // lay the land to a river's water (its level along the course): down where it stands higher, up where it lies lower
  // (a floodplain), the banks easing away from it
  let best = 1e9, level = 0;
  for (let k = 0; k < R.pts.length - 1; k++) {
    const A = R.pts[k], B = R.pts[k + 1];
    if (!A || !B) continue;
    const [ax, az] = AT(A[0], A[1]), [bx, bz] = AT(B[0], B[1]), dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) { best = d; level = A[2] + (B[2] - A[2]) * t; }
  }
  if (best > R.w * 4) return h;
  const bed = level - 1.5;
  return bed + (h - bed) * smooth(R.w * 0.5, R.w * 3.5, best);
}

// the lone mountains of the left
function lone(x, z) {
  let h = 0;
  for (const [name, a, r, ht, rad, sharp] of LONE) {
    const [cx, cz] = AT(a, r);
    if (name === 'beshtau') {
      const s = near(x, z, [cx, cz], rad);
      if (s < 1.6) h += ht * Math.pow(Math.max(0, 1 - s * s / 2.56), 1.6);
      // the five heads: placed across the view (to the right of the hill's ray to it) and along it
      const ux = Math.cos((a * Math.PI) / 180), uz = Math.sin((a * Math.PI) / 180);       // (to the right of the ray)
      const vx = -Math.sin((a * Math.PI) / 180), vz = Math.cos((a * Math.PI) / 180);      // (back toward the hill)
      for (const [u, v, hh, rr] of BESHTAU5) {
        const px = cx + ux * u + vx * v, pz = cz + uz * u + vz * v, q = Math.hypot(x - px, z - pz) / rr;
        if (q < 1.5) h += hh * Math.pow(Math.max(0, 1 - q * q / 2.25), 2.4) * (0.85 + 0.3 * ridged(x / 900, z / 900, 4));
      }
      continue;
    }
    // (an elongated dome for Zmeyka)
    const s = name === 'zmeyka' ? Math.hypot((x - cx) / (rad * 1.5), (z - cz) / rad) : near(x, z, [cx, cz], rad);
    if (s < 1.25) {
      const dome = Math.pow(Math.max(0, 1 - s * s / 1.5625), 1.4 * sharp);
      h += ht * dome * (0.88 + 0.24 * ridged(x / 700 + a, z / 700, 4));
    }
  }
  return h;
}

// Elbrus, and the main range from end to end behind it (heights over the hill's 600 m)
function highRange(x, z, r, az) {
  const deg = (az * 180) / Math.PI;
  const ends = smooth(RANGE.az[0] - 6, RANGE.az[0] + 16, deg) * (1 - smooth(RANGE.az[1] - 16, RANGE.az[1] + 6, deg));
  if (ends <= 0) return 0;
  let h = 0;
  // the forerange (the Pastbishchny and Skalisty ranges: long grassy cuestas rising away from the hill to their crests)
  const fr = 30000 + 2500 * (fbm(deg / 9, 3.3, 3) - 0.5) * 2;
  h += ends * (420 * smooth(fr - 9000, fr, r) * (1 - smooth(fr + 3000, fr + 7000, r) * 0.4)
    + 520 * smooth(fr - 2500, fr + 2500, r) * (0.5 + ridged(x / 4000, z / 4000, 6)) * (1 - smooth(fr + 5000, fr + 10000, r) * 0.5));
  // the main range: a crest along RANGE.r, its peaks 3400 to 4600 m over the hill, spurs running down toward it
  const crest = RANGE.r + 5000 * (fbm(deg / 14, 7.7, 3) - 0.5) * 2;
  const across = (r - crest) / RANGE.depth;
  if (across > -2.4 && across < 1.8) {
    const env = Math.pow(Math.max(0, 1 - Math.abs(across) / (across < 0 ? 2.4 : 1.8)), 1.1);
    // (the crest's height along the range: lower toward its ends, highest either side of Elbrus; peaks here and there)
    const mid = smooth(-152, -118, deg) * (1 - smooth(-66, -44, deg));
    const peaks = 0.62 + 0.38 * mid + 0.35 * (fbm(deg / 3.1, 1.9, 3) - 0.5);
    const rid = ridged(x / 5200 + 3.1, z / 5200 - 1.3, 8);
    h = Math.max(h, ends * env * 4300 * peaks * (0.38 + 0.8 * rid));
  }
  // Elbrus: a volcanic cone in front of the range, broad at its foot, its top a broad dome, its two heads on that with
  // the saddle between them
  const [ex, ez] = AT(ELBRUS.az, ELBRUS.r), de = Math.hypot(x - ex, z - ez), R = ELBRUS.massif;
  if (de < R * 1.4) {
    const s = de / R;
    const cone = (t) => (t < 1 ? (ELBRUS.cone - 1400) * Math.pow(1 - Math.pow(t, 1.5), 1.7) : 0);
    let m = 1400 * smooth(1.4, 1.0, s) + cone(s);
    // (its flanks ribbed by glaciers and ridges running down from the top)
    m *= 1 + 0.1 * (ridged(x / 1900, z / 1900, 6) - 0.5) * smooth(0.12, 0.45, s);
    const ux = Math.cos((ELBRUS.az * Math.PI) / 180), uz = Math.sin((ELBRUS.az * Math.PI) / 180);
    const vx = -Math.sin((ELBRUS.az * Math.PI) / 180), vz = Math.cos((ELBRUS.az * Math.PI) / 180);
    let top = 0;
    for (const [u, v, peak] of ELBRUS.heads) {
      const px = ex + ux * u + vx * v, pz = ez + uz * u + vz * v, q = Math.hypot(x - px, z - pz) / 1300;
      // (each head a rounded dome rising off the cone to its summit)
      if (q < 1) top = Math.max(top, (peak - 1400 - cone(Math.hypot(u, v) / R)) * Math.pow(1 - q * q, 1.3));
    }
    h = Math.max(h, m + top);
  }
  return h;
}

/** The ring's land (everywhere but the painting's sector, which plateLand alone gives). far: the far ranges too. */
export function ringLand(x, z, far = true) {
  const r = Math.hypot(x, z), az = Math.atan2(x, -z), S = sectorOf(az, r);
  // the hill's flanks, as the painting's valley has them
  let h = -6 - (-FLOOR - 6) * (1 - Math.exp(-Math.max(0, r - 28) / 70));
  const n1 = fbm(x / 950, z / 950) - 0.5, n2 = fbm(x / 3100 + 5.2, z / 3100 - 1.7) - 0.5;
  // behind: off the klint into the lowland, flat out to the gulf (a metre or two of swell in it), the gulf's floor
  if (S.back > 0) {
    let low = (LOW - FLOOR) * smooth(320, 1500, r) + 3 * n1 * smooth(1000, 3000, r);
    const deg = (az * 180) / Math.PI, shore = GULF.shore * (1 + 0.25 * n2 * 2);
    low -= 4 * smooth(GULF.az[0], GULF.az[0] + 8, deg) * (1 - smooth(GULF.az[1] - 8, GULF.az[1], deg)) * smooth(shore - 600, shore + 600, r);
    h += S.back * low;
  }
  // right: the estate's valley, the uplands beyond it, and far forested ridges
  if (S.right > 0) {
    let v = 30 * smooth(650, 1500, r) * (1 - smooth(1500, 2100, r));           // (the hill's shoulder, as ahead)
    v += (6 * smooth(200, 600, r) + 40 * smooth(1200, 5000, r) + 60 * smooth(6000, 20000, r)) * n1 * 2;
    // a wooded ridge beyond the estate, low where the estate opens toward the hill, high either side of it
    const deg = (az * 180) / Math.PI, open = Math.exp(-(((deg - 92) / 13) ** 2));
    const ridge = 190 * (0.3 + 0.7 * (1 - open)) * (0.7 + 0.6 * fbm(deg / 7, 2.2, 3));
    v += ridge * smooth(3000, 4700, r) * (1 - 0.55 * smooth(6000, 9500, r));
    // the far forested ridges, one behind another
    v += 60 * smooth(6000, 12000, r) + 420 * smooth(12000, 30000, r) * (0.5 + 0.9 * ridged(x / 7000 + 2.3, z / 7000 + 0.7, 5));
    // the estate's valley: a broad hollow, its floor at the ponds; the manor's rise beyond
    const dv = near(x, z, ESTATE.valley, 900);
    v -= 14 * Math.max(0, 1 - dv * dv);
    const dm = near(x, z, ESTATE.manor, 520);
    v += 10 * Math.exp(-dm * dm);
    h += S.right * v;
  }
  // left: rolling foothills, the painting's river's valley climbing gently away toward the mountains, the Pyatigorye's
  // plain rising beyond it
  if (S.left > 0) {
    let v = 52 * smooth(480, 1350, r) * (1 - smooth(1800, 4200, r));           // (the left side rises sooner, as ahead)
    v += (10 * smooth(300, 900, r) + 26 * smooth(1000, 4000, r)) * n1 * 2;
    v += 28 * smooth(6000, 16000, r) + 90 * smooth(14000, 32000, r) + 35 * n2 * 2 * smooth(5000, 18000, r);
    h += S.left * v;
  }
  if (far) h += lone(x, z) + highRange(x, z, r, az);
  for (const R of Object.values(RIVERS)) h = carve(h, x, z, R);
  return h;
}

/** The land anywhere round the hill (m): the painting's valley ahead, the ring's world the rest of the way. */
export function worldHeight(x, z, far = true) {
  const aa = Math.abs(Math.atan2(x, -z));
  if (aa <= PLATE[0]) return plateLand(x, z);
  const ring = ringLand(x, z, far);
  if (aa >= PLATE[1]) return ring;
  return plateLand(x, z) + (ring - plateLand(x, z)) * smooth(PLATE[0], PLATE[1], aa);
}
