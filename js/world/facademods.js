// A house front's wall in its window module (24 Nov 2026): the walk's own copy, number for number, of
// dev\world\facade_mods.py, which laid the wall out when the city was built - every window of a storey one size, the
// windows evenly spaced, none near a corner, none with anything standing before it. The wall's record (the relief's
// tiles: city_blender.py) carries its layout - its window bays, their width, its two plain ends, where its doors are and
// which bays are kept blind - and this gives, for each storey band, the strips of the front's picture it is drawn from
// along the wall: [x0 px, x1 px, metres, kind], kind 'end' (plain wall), 'W' (a window bay), 'D' (a door bay's ground
// band), 'Dup' (a door bay's own upper band: a balcony's door), 'Df' (plain wall either side of a door bay narrower than
// the window bays it takes: 'Dfill', the door bay at its own width), 'B' (a window bay kept blind), 'S' (a shop's
// ground band: the shop's own picture there).

/** The storey band's name in the front's bands ('ground', 'mid', 'top') from its rows [y0, y1]. */
export function bandName(fb, band) {
  for (const bn of ['ground', 'mid', 'top']) {
    const [y0, y1] = fb.bands[bn];
    if (Math.abs(y0 - band[0]) < 0.6 && Math.abs(y1 - band[1]) < 0.6) return bn;
  }
  return 'top';          // (a one-storey wall's top band ends at the eaves: the top band's strip)
}

/** One storey band (band: [y0 px, y1 px, metres], kb its index from the ground) along the wall. lay: { n, e, M (a window
 *  bay's width, m), seq ('W' | 'D' | 'd' a character a bay) }; blind: the bays kept blind in this band (a Set); shop:
 *  [from, to] its bays, or null. */
export function segments(fb, lay, band, kb, blind, shop) {
  // (the window bay and the door bay - cut down about their openings on a narrow wall: lay.crop; a cut-down bay's wall
  // has no pilasters, and over a cut-down door bay the window bay's storeys - facade_mods.py segments)
  const md = fb.mod, P = md.P[bandName(fb, band)], W = lay.crop?.W ?? md.W, DD = lay.crop?.D ?? md.D, M = lay.M, e = lay.e, ph = lay.crop ? [0, 0] : (md.ph || [0, 0]), mx = md.mx;
  const out = [];
  // (plain wall: the band's plain strip stretched to the width - or at a wall's end (side 'left' or 'right') cut from it
  // at the picture's own size where it is wide enough, from its side toward the wall's first or last bay, so the
  // plaster, its courses and its cornice run on at their own size into the corner; on a front with pilasters, one at
  // either cut - the halves the window bay has there, at their own width - and the plain strip between)
  const plain = (width, kind, side = null) => {
    let PP = P;
    if (side && !ph[0] && !ph[1]) {
      const want = width / (M / (W[1] - W[0]));
      if (want <= P[1] - P[0]) PP = side === 'left' ? [P[1] - want, P[1]] : [P[0], P[0] + want];
    }
    if (ph[0] || ph[1]) {
      const a = ph[0] * mx, b = ph[1] * mx;
      return [[W[0], W[0] + ph[0], a, kind], [PP[0], PP[1], width - a - b, kind], [W[1] - ph[1], W[1], b, kind]];
    }
    return [[PP[0], PP[1], width, kind]];
  };
  out.push(...plain(e, 'end', 'left'));
  const seq = lay.seq;
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === 'D') {
      // (a narrow wall's door bay, cut down about its door, is one bay wide whatever the front's: facade_mods.py narrow)
      const k = lay.crop?.D ? 1 : md.Dk, D = DD;
      // (a door bay narrower than the window bays it takes ('Dfill'): at its own width, the band's plain wall either side)
      const dw = md.Dfill ? Math.min(k * M, (D[1] - D[0]) * M / (W[1] - W[0])) : k * M, f = (k * M - dw) / 2;
      if (kb === 0 || (md.Dup === 'own' && !lay.crop?.D)) {
        if (f > 1e-6) out.push(...plain(f, 'Df'));
        out.push([D[0], D[1], dw, kb === 0 ? 'D' : (blind.has(i) ? 'B' : 'Dup')]);
        if (f > 1e-6) out.push(...plain(f, 'Df'));
      } else for (let j = 0; j < k; j++) out.push(...(blind.has(i + j) ? plain(M, 'B') : [[W[0], W[1], M, 'W']]));
      i += k; continue;
    }
    if (kb === 0 && shop && shop[0] <= i && i < shop[1]) out.push([W[0], W[1], M, 'S']);
    else if (blind.has(i)) out.push(...plain(M, 'B'));
    else out.push([W[0], W[1], M, 'W']);
    i++;
  }
  out.push(...plain(e, 'end', 'right'));
  return out;
}

/** The wall's layout from its record's [n, e, sc, seq, blind(, crop)] (blind: [[band, [bays]], ...]; crop: a narrow
 *  wall's window bay and door bay cut down about their openings, [[x0, x1], [x0, x1] or null] px - facade_mods.py
 *  narrow): { n, e, M, seq, blind: Map band -> Set, crop: { W, D } or null }. */
export function layoutOf(fb, rec) {
  const [n, e, sc, seq, bl = [], cr = null] = rec;
  const crop = cr ? { W: cr[0], ...(cr[1] ? { D: cr[1] } : {}) } : null, W = crop?.W ?? fb.mod.W;
  return { n, e, M: (W[1] - W[0]) * fb.mod.mx * sc, sc, seq, crop, blind: new Map(bl.map(([k, l]) => [k, new Set(l)])) };
}
