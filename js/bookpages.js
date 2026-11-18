// The book's pages (js/book.js): each drawn on its own canvas, the way a page of the 1830s was printed - Bodoni Moda
// (vendor/bodoni-moda, its licence beside it) in a warm black ink on the cream paper of the book's own tile, a red ink for
// the line the cursor is on. The right page lists the places to travel to, grouped, each with how far it lies in
// versts from where the walker stands; the left page, the graphics, the look in force ringed. The line under the
// printer's hand is red on either page.
// A page is measured in millimetres from its top left as the reader sees it, the leaf's own size (PAGE); its canvas
// is drawn at whatever size the look needs (book.js: finer for the full look, coarse and heavier for a picture of
// 240 lines or fewer, where the small lines under each place are left out). Every line that can be chosen is kept with
// its box, for the cursor (hit).
export const PAGE = { w: 212, h: 270 };
// (the text block: the left page's inner margin and the right's are over the fold, where 43 mm of the leaf dives into
// the gutter - book_geom.py)
const BLOCK = { verso: [20, 150], recto: [62, 192], top: 22, bottom: 248 };
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

/** The left page: the graphics. data: { choices: [{id, name, about}], now (the id in force), mine (this machine's),
 *  hover }. Returns its boxes. */
export function drawGraphics(g, W, H, data, { tile = null, coarse = false } = {}) {
  const k = W / PAGE.w, side = 'verso', [x0, x1] = BLOCK[side].map((v) => v * k), boxes = [];
  paper(g, W, H, tile, k);
  g.textBaseline = 'alphabetic';
  runningHead(g, k, side, 'Graphics', 'vi', coarse);
  let y = title(g, k, side, 'Graphics', 'how the walk is drawn', BLOCK.top + 18, coarse) + (coarse ? 6 : 8);
  const T = coarse ? 7.4 : 5.8, S = 4.0;
  for (const c of data.choices) {
    y += coarse ? 13 : 12.5;
    const on = data.hover === c.id, now = data.now === c.id, top = y - T * 0.85;
    g.fillStyle = on ? RED : INK;
    // (the one in force a filled ring, the others an empty one, as the menu's)
    const rx = x0 + 2.2 * k, ry = (y - T * 0.3) * k, rr = (coarse ? 2.0 : 1.55) * k;
    g.beginPath(); g.arc(rx, ry, rr, 0, Math.PI * 2); g.lineWidth = Math.max(1, 0.32 * k); g.strokeStyle = g.fillStyle; g.stroke();
    if (now) { g.beginPath(); g.arc(rx, ry, rr * 0.55, 0, Math.PI * 2); g.fill(); }
    g.font = face(T * k, { weight: coarse ? 700 : (on ? 500 : 400) });
    g.fillText(c.name, x0 + 7 * k, y * k);
    if (c.id === data.mine && !coarse) {
      const w = g.measureText(c.name).width; g.font = face(S * k, { italic: true }); g.fillText('this computer’s', x0 + 7 * k + w + 2.4 * k, y * k);
    }
    if (!coarse) { y += 5.2; g.font = face(S * k, { italic: true }); g.fillStyle = on ? RED : INK; g.fillText(c.about, x0 + 7 * k, y * k); }
    boxes.push({ id: c.id, box: [BLOCK[side][0] - 2, top - 1.2, BLOCK[side][1] + 2, y + 1.8] });
  }
  if (data.vignette) {
    // (a tailpiece, as the printers closed a chapter: the engraving multiplied into the paper, between the list and the
    // note, as large as the room left allows)
    const im = data.vignette, room = BLOCK.bottom - 16 - (y + 8), w = Math.min(70, room * im.width / im.height), h = w * im.height / im.width;
    if (h > 18) { g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(im, (x0 + x1) / 2 - w * k / 2, (y + 8 + (room - h) / 2) * k, w * k, h * k); g.restore(); }
  }
  g.fillStyle = INK; g.font = face((coarse ? 4.6 : 3.9) * k, { italic: true, weight: coarse ? 600 : 400 }); g.textAlign = 'center';
  g.fillText('A change loads the walk again, where you stand.', (x0 + x1) / 2, (BLOCK.bottom - 4) * k); g.textAlign = 'left';
  return boxes;
}

/** The line under page point (x, y mm), from a page's boxes: its id, or null. */
export function hit(boxes, x, y) {
  for (const b of boxes || []) if (x >= b.box[0] && x <= b.box[2] && y >= b.box[1] && y <= b.box[3]) return b.id;
  return null;
}
