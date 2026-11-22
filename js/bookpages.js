// The book's pages (js/book.js): each drawn on its own canvas, the way a page of the 1830s was printed - Bodoni Moda
// (vendor/bodoni-moda) in a warm black ink on the cream paper of the book's own tile, a red ink for
// the line the cursor is on. The right page lists the places to travel to, grouped, each with how far it lies in
// versts from where the walker stands; the left page, the plate leaf, its drawing and its name. The line under the
// printer's hand is red on either page.
// A page is measured in millimetres from its top left as the reader sees it, the leaf's own size (PAGE); its canvas
// is drawn at whatever size the look needs (book.js: finer for the full look, coarse and heavier for a picture of
// 240 lines or fewer, where the small lines under each place are left out). Every line that can be chosen is kept with
// its box, for the cursor (hit).
export const PAGE = { w: 212, h: 270 };
// (the text block: the left page's inner margin and the right's are over the fold, where 43 mm of the leaf dives into
// the gutter - book_geom.py)
const BLOCK = { verso: [20, 150], recto: [62, 192], top: 22, bottom: 248 };
// (the plate measure on the left leaf: the drawing's own field, and it bleeds. It runs to 0 at the fore-edge and to the
//  foot trim, and stops 3 mm short of where the leaf dives into the fold (PAGE.w - 43 = 169) because a press cannot
//  print into the gutter and the binding swallows what tries. 166 x 257 mm against the plate's 2:3 costs the drawing
//  5 mm of width and nothing at all of its height, so the quay, the town frontage and the ridges all stay whole. The
//  name and the folio therefore stand in the head band above it - a plate that bleeds has no margin beneath it)
const PLATE = { x: 0, y: 13, w: 166, h: 257 };
export const INK = '#211b17', RED = '#a8291f';
const FAMILY = 'BookBodoni', FALLBACK = 'Georgia, "Times New Roman", serif';
let fontsIn = false;

/** The book's type, from the site's own files: true once both faces are in (the pages fall back to Georgia). */
export async function loadFonts(base = '') {
  if (fontsIn) return true;
  try {
    const f = [new FontFace(FAMILY, `url(${base}vendor/bodoni-moda/BodoniModa-latin.woff2) format("woff2")`, { weight: '400 900', style: 'normal' }),
      new FontFace(FAMILY, `url(${base}vendor/bodoni-moda/BodoniModa-Italic-latin.woff2) format("woff2")`, { weight: '400 900', style: 'italic' })];
    await Promise.all(f.map((x) => x.load()));
    f.forEach((x) => document.fonts.add(x));
    fontsIn = true;
  } catch (e) { console.warn('[book] type', e); }
  return fontsIn;
}
const face = (size, { italic = false, weight = 400 } = {}) => `${italic ? 'italic ' : ''}${weight} ${size}px ${fontsIn ? `"${FAMILY}", ` : ''}${FALLBACK}`;

// ---- drawing
const roman = (n) => { const r = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, c] of r) while (n >= v) { s += c; n -= v; } return s; };

function paper(g, W, H, tile, k) {
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
  if (!tile) return;
  // (the paper's own picture, 74 mm a tile, its grain softened: under print it should read as paper, not as a pattern)
  const s = Math.max(8, Math.round(74 * k));
  const c = document.createElement('canvas'); c.width = c.height = s;
  c.getContext('2d').drawImage(tile, 0, 0, s, s);
  g.save(); g.globalAlpha = 0.85; g.fillStyle = g.createPattern(c, 'repeat'); g.fillRect(0, 0, W, H); g.restore();
}

/** Small capitals: the capitals full size, the rest as capitals smaller; letter-spaced. Returns its width (px). */
function smallCaps(g, str, x, y, size, { align = 'left', track = 0.08, weight = 500, measure = false } = {}) {
  const parts = [];
  for (const ch of str) {
    const up = ch.toUpperCase(), small = ch !== up || (ch === ' ');
    parts.push({ ch: up, size: small && ch !== ' ' ? size * 0.78 : size });
  }
  let w = 0;
  for (const p of parts) { g.font = face(p.size, { weight }); p.w = g.measureText(p.ch).width + size * track; w += p.w; }
  w -= size * track;
  if (measure) return w;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const p of parts) { g.font = face(p.size, { weight }); g.fillText(p.ch, cx, y); cx += p.w; }
  return w;
}

function rule(g, x0, x1, y, t) { g.fillRect(x0, y - t / 2, x1 - x0, t); }

/** The running head: its words in small capitals in the middle, the folio at the outer corner, a rule under. */
function runningHead(g, k, side, words, folio, coarse) {
  const [x0, x1] = BLOCK[side].map((v) => v * k), y = BLOCK.top * k;
  g.fillStyle = INK;
  smallCaps(g, words, (x0 + x1) / 2, y, (coarse ? 5.2 : 3.6) * k, { align: 'center', track: 0.14, weight: coarse ? 700 : 500 });
  if (folio) {
    g.font = face((coarse ? 5.2 : 3.8) * k, { weight: coarse ? 700 : 400 }); g.textAlign = side === 'verso' ? 'left' : 'right';
    g.fillText(folio, side === 'verso' ? x0 : x1, y); g.textAlign = 'left';
  }
  rule(g, x0, x1, y + 2.6 * k, Math.max(1, 0.28 * k));
}

/** A title in the 1830s manner: large spaced capitals, an italic line under it, a thick and thin rule. */
function title(g, k, side, big, under, y, coarse) {
  const [x0, x1] = BLOCK[side].map((v) => v * k), cx = (x0 + x1) / 2;
  g.fillStyle = INK;
  smallCaps(g, big, cx, y * k, (coarse ? 10 : 9.5) * k, { align: 'center', track: 0.16, weight: coarse ? 700 : 500 });
  let yy = y;
  if (under && !coarse) {
    yy += 7; g.font = face(4.4 * k, { italic: true }); g.textAlign = 'center'; g.fillText(under, cx, yy * k); g.textAlign = 'left';
  }
  yy += coarse ? 5.5 : 5;
  rule(g, cx - 16 * k, cx + 16 * k, yy * k, Math.max(1, 0.7 * k)); rule(g, cx - 16 * k, cx + 16 * k, (yy + 1.3) * k, Math.max(1, 0.25 * k));
  return yy + 1.3;
}

/** Dots led from x0 to x1 on the line y, set on the page's own grid so that they stand in columns line under line. */
function leaders(g, k, x0, x1, y, size) {
  const step = 2.4 * k, r = Math.max(0.7, 0.32 * k * size / 5);
  for (let x = Math.ceil((x0 + step * 0.6) / step) * step; x < x1 - step * 0.4; x += step) { g.beginPath(); g.arc(x, y - 0.6 * k, r, 0, Math.PI * 2); g.fill(); }
}

/** How far, said in versts: under a quarter "here", halves under ten, whole versts beyond. */
export function versts(m) {
  const v = m / 1066.8;
  if (v < 0.4) return 'here';
  if (v < 10) { const h = Math.round(v * 2) / 2, w = Math.floor(h); return (w ? String(w) : '') + (h - w ? '½' : ''); }
  return String(Math.round(v));
}

/** The right page: the places. data: { places: [{id, group, title, sub, dist (m)}], hover (an id) }. Returns its boxes. */
export function drawPlaces(g, W, H, data, { tile = null, coarse = false } = {}) {
  const k = W / PAGE.w, side = 'recto', [x0, x1] = BLOCK[side].map((v) => v * k), boxes = [];
  paper(g, W, H, tile, k);
  g.textBaseline = 'alphabetic';
  runningHead(g, k, side, 'Places', 'vii', coarse);
  let y = title(g, k, side, 'Places', 'and how far each lies from where you stand', BLOCK.top + 18, coarse) + (coarse ? 8 : 9);
  g.fillStyle = INK; g.font = face((coarse ? 4.6 : 3.6) * k, { italic: true, weight: coarse ? 600 : 400 }); g.textAlign = 'right';
  g.fillText('Versts', x1, y * k); g.textAlign = 'left';
  y += coarse ? 3 : 2.5;
  let group = null;
  const T = coarse ? 8.2 : 5.6, S = 4.0;                 // (the em of a place's name, and of the line under it, mm)
  for (const p of data.places) {
    if (p.group !== group) {
      group = p.group; y += coarse ? 10.5 : 8.2;
      g.fillStyle = INK; smallCaps(g, group, (x0 + x1) / 2, y * k, (coarse ? 5.2 : 3.9) * k, { align: 'center', track: 0.12, weight: coarse ? 700 : 500 });
      y += coarse ? 2 : 1.6;
    }
    y += coarse ? 10.6 : 7.2;
    const on = data.hover === p.id, top = y - T * 0.85;
    g.fillStyle = on ? RED : INK;
    const d = versts(p.dist ?? Infinity), here = d === 'here';
    g.font = face(T * k, { italic: here, weight: coarse ? 700 : 400 });
    const dw = g.measureText(d).width;
    let t = T; g.font = face(t * k, { weight: coarse ? 700 : (on ? 500 : 400) });
    while (t > T * 0.7 && g.measureText(p.title).width > x1 - x0 - dw - 5 * k) { t -= T * 0.05; g.font = face(t * k, { weight: coarse ? 700 : (on ? 500 : 400) }); }
    const name = p.title, nw = g.measureText(name).width;
    g.fillText(name, x0, y * k);
    g.font = face(T * k, { italic: here, weight: coarse ? 700 : 400 });
    g.textAlign = 'right'; g.fillText(d, x1, y * k); g.textAlign = 'left';
    leaders(g, k, x0 + nw + 1.2 * k, x1 - dw - 1.2 * k, y * k, T);
    if (!coarse && p.sub) {
      y += 5.4; g.font = face(S * k, { italic: true }); g.fillText(p.sub, x0 + 5 * k, y * k);
    }
    boxes.push({ id: p.id, box: [BLOCK[side][0] - 2, top - 1.2, BLOCK[side][1] + 2, y + 1.8] });
  }
  return boxes;
}

/** The left page: the plate leaf. data: { vignette, plate }. Returns no boxes: nothing on the leaf is a control. */
export function drawGraphics(g, W, H, data, { tile = null, coarse = false } = {}) {
  // (the plate leaf, as an 1830s book carries a plate on its own leaf - and this one bleeds: the drawing runs over the
  //  whole of its measure off the fore-edge and the foot, with its name and its folio in the band above. No running
  //  head, no title, no sentence)
  const k = W / PAGE.w;                                   // (mm on the page -> device pixels)
  paper(g, W, H, tile, k);
  g.textBaseline = 'alphabetic';
  const im = data.plate || data.vignette;
  const plate = !!im && im === data.plate;
  const name = plate ? 'Yalta, the quay.' : 'The road and the verst post.';
  const cap = (coarse ? 5.6 : 4.6) * k;
  if (im && im.width) {
    // (the plate covers the plate measure. Cover means: scale the drawing until it fills the measure both ways, and cut
    //  the overhang off the longer sides - which is nothing at all when the drawing is cut to the measure's own shape,
    //  as plate.png is. The woodcut tailpiece is a small picture and not a plate, so it keeps all of itself and is
    //  centred in the measure instead. Both multiplied in, so the paper's grain and warm white come through the ink)
    const bx = PLATE.x * k, by = PLATE.y * k, bw = PLATE.w * k, bh = PLATE.h * k;
    const a = im.width / im.height, ab = PLATE.w / PLATE.h;
    let sx = 0, sy = 0, sw = im.width, sh = im.height, dx = bx, dy = by, dw = bw, dh = bh;
    if (plate) {
      if (a > ab) { sw = im.height * ab; sx = (im.width - sw) / 2; }
      else { sh = im.width / ab; sy = (im.height - sh) / 2; }
    } else if (a > ab) { dh = bw / a; dy = by + (bh - dh) / 2; }
    else { dw = bh * a; dx = bx + (bw - dw) / 2; }
    g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh); g.restore();
    // (its name in the head band above it - a plate that bleeds has no margin below it to hold one. mm on the page:
    //  fillText wants device pixels, so the height goes through k like everything else here)
    g.fillStyle = INK; g.font = face(cap, { italic: true }); g.textAlign = 'center';
    g.fillText(name, bx + bw / 2, (PLATE.y - 5) * k);
    // (and the folio at the outend of the same band, where a plate leaf carries its number)
    g.font = face((coarse ? 5.2 : 3.8) * k, { weight: coarse ? 700 : 400 }); g.textAlign = 'left';
    g.fillText('vi', 8 * k, (PLATE.y - 5.4) * k);
  } else {
    g.fillStyle = INK; g.font = face((coarse ? 5.2 : 3.8) * k, { weight: coarse ? 700 : 400 });
    g.fillText('vi', 8 * k, (PLATE.y - 5.4) * k);
  }
  return [];                                          // (no line of this page is a control: nothing under the hand to pick)
}
/** The line under page point (x, y mm), from a page's boxes: its id, or null. */
export function hit(boxes, x, y) {
  for (const b of boxes || []) if (x >= b.box[0] && x <= b.box[2] && y >= b.box[1] && y <= b.box[3]) return b.id;
  return null;
}
