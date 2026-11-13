// The graphics settings chosen for the machine the walk runs on. Three steps:
//  1. guess: the graphics chip's own name (WEBGL_debug_renderer_info), the processor's threads, the memory and the
//     screen's pixels place the machine in a tier - a software renderer or a phone's chip at the bottom, a laptop's
//     built-in Intel or AMD graphics in the middle-low, a separate NVIDIA RTX or Radeon RX card at the top;
//  2. measure: the first second and a half of frames under the loading veil (walk.js) - if they come far too slowly
//     for the tier guessed, it steps down at once, before anyone sees a frame;
//  3. keep watching: the resolution scale follows the frame time while walking (walk.js), and if it sits at its
//     floor and still cannot keep up, the tier steps down again (the page reloads its world at the new tier, once).
// Each tier's settings are what costs most on a weak card: the screen's resolution, the MSAA samples, the sun's
// shadow pictures, how far the trees, the yards' furniture and the grass are drawn, and the sky's panorama.
// The tier is remembered per browser (localStorage), with the reason, so a slow machine starts right the next time;
// ?gfx=ultra|high|xbox360|gamecube|dreamcast|n64|ps1|gameboy forces one (medium, low and minimum still read: the three
// they became).
//
// Below the two full tiers the walk is drawn the way an older machine drew: a weak machine cannot draw the full picture
// well, and a full picture drawn badly is only a bad picture - so it draws a smaller one on purpose, by the rules of a
// machine that was good at small pictures. Each of these tiers has a `style` (STYLES, below): the picture's own lines,
// how it is scaled up to the screen, its colours' depth and dither, its textures' size and filtering, and whether its
// corners snap to the pixel grid.
// The menu (walk.js: Esc) offers them by name, with Full for the two full tiers.

export const TIERS = {
  // pixelRatio: the cap on the screen's own; scale: the scene's picture against the canvas (the resolution
  // follows the frame time between minScale and 1); msaa: samples; scene: the countryside's own 'high' | 'low'
  // (grass rings, shadow picture sizes, sky); woodsFar / canopyAt: trees drawn to here, the land's painted crowns from
  // there; propsNear / footNear / yardNear: the cities' furniture, pavements and yards drawn within; blocksFar: the
  // houses drawn within; shadows: 'both' | 'near' | 'none' of the sun's two shadow pictures, shadowSize their size;
  // woods: the trees' ladder, bands outward from the walker, each [to (m), the copy drawn, the copy that throws its
  // shadow]: 'full' (every leaf: 48,000 to 125,000 triangles a tree), 'mid' (a third of the leaves, each grown, on the
  // light trunk: 15,000 to 29,000), 'light' (5,600 to 16,000), 'lighter' (2,700 to 9,500), and one card a tree from the
  // last band out to woodsFar - world/woods.js; the cities' trees too. In a thick wood (11 Nov 2026) the trees were 86
  // million triangles a frame at medium and 56 million at low with the full copies out to 120 and 70 m: a laptop's
  // ladder keeps them for the trees walked among;
  // shadowFarEvery: the sun's far picture drawn every so many frames; reliefNear: the house fronts' mouldings and open
  // windows built within; tilesNear: the houses' own tiles read in within (boxes beyond, to blocksFar; a tile of houses is about 14,000 triangles and 0.4 MB); marksFar / bridgesFar: the
  // landmarks (churches, the Kremlin, the palaces) and the country bridges drawn within; propsFull: the cities'
  // furniture in its full models in the tiles this near, its light copies beyond; texMax: the longest side a picture
  // is kept at (texcap.js: the walk's 189 pictures are 2.3 GB on the card at their full size, 0.8 GB at 1024, and a
  // laptop's built-in graphics holds them in the machine's own memory); aniso: the most any texture is filtered at
  // a glancing angle (16 where not given); cribStones: a bridge pier's field stones drawn stone by stone within, as
  // one block of stone a crib beyond (always stone by stone where not given); smokeNear: the smoke over the houses'
  // chimneys drawn within (world/chimneys.js; 0: none); grass: the meadow's blades below Full - per (blades to the
  // square metre at the feet: 700 in the full look), reach (m: the full look's goes to 950), rows (each blade's: 5),
  // wide (how much wider each blade is: tufts, so a few still read as grass), floor (the least it thins to with
  // distance, of `per`), or null: none, the ground painted;
  // flowers: reach (m), far and near (the most of each kind and shape drawn as light and as full models; 0 near: all
  // light), thin (how many grow, of the full look's), or null: none (at 240 lines a flower is a dark stem a pixel
  // wide); landN: the land's rings' cells a side (96: 295,000 triangles of
  // ground; 48: a quarter of it); marks: 'light' - the landmarks' light copies only (landmarks/light.json), the full
  // models never read; placesFar: the country places (a village, a chapel) and the cities' own bridges drawn within.
  // Measured 11 Nov 2026 on the walk as published (v0.0.31): the meadow alone was 1.5 to 4.8 million triangles a frame
  // on every tier below Full - its grass at a third of the full density out to 950 m, 21 kinds of flower by the
  // thousand - even in the 240-line pictures, even over a city.
  ultra:   { pixelRatio: 2,    scale: 1,    minScale: 1,    msaa: 8, scene: 'high', woods: [[60, 'full', 'full'], [220, 'full', 'light'], [450, 'light']], shadowFarEvery: 1, woodsFar: 1800, canopyAt: 1650, propsFull: 150, propsNear: 600, footNear: 900, yardNear: 1400, shadows: 'both', shadowSize: 2048 , marksFar: Infinity, bridgesFar: 8000, tilesNear: 2500, reliefNear: 380, blocksFar: Infinity, smokeNear: 420 },
  high:    { pixelRatio: 1.5,  scale: 1,    minScale: 0.55, msaa: 4, scene: 'high', woods: [[12, 'full', 'full'], [45, 'full', 'mid'], [95, 'mid', 'light'], [140, 'mid', 'light'], [220, 'light', 'lighter'], [320, 'lighter']], shadowFarEvery: 2, woodsFar: 1500, canopyAt: 1350, propsFull: 130, propsNear: 500, footNear: 750, yardNear: 1100, shadows: 'both', shadowSize: 2048 , marksFar: 6000, bridgesFar: 4000, cribStones: 350, tilesNear: 1800, reliefNear: 380, blocksFar: 7000, smokeNear: 320 },
  // (the six below: `style` names the older machine whose way of drawing the tier takes - STYLES; scale, minScale and
  // pixelRatio are not used by them: the picture has the style's own number of lines whatever the screen)
  // (a 360's: 720 lines, near the full look's world but a little less of it - the step between Full and the GameCube)
  xbox360:   { style: 'xbox360', pixelRatio: 1, scale: 1, minScale: 1, msaa: 2, scene: 'high', texMax: 1024, aniso: 8, woods: [[12, 'full', 'mid'], [45, 'mid', 'light'], [110, 'light', 'lighter'], [220, 'lighter']], shadowFarEvery: 2, woodsFar: 1500, canopyAt: 1350, propsFull: 90, propsNear: 380, footNear: 600, yardNear: 850, shadows: 'both', shadowSize: 1024, marksFar: 5000, bridgesFar: 3000, cribStones: 250, tilesNear: 1200, reliefNear: 250, blocksFar: 5500, smokeNear: 260, grass: { per: 240, reach: 260, rows: 4, wide: 2.5, floor: 0.04 }, flowers: { reach: 120, far: 400, near: 60, thin: 0.75 }, landN: 96, placesFar: 4000 },
  gamecube:  { style: 'gamecube', pixelRatio: 1, scale: 1, minScale: 1, msaa: 2, scene: 'low', texMax: 512, aniso: 4, woods: [[14, 'mid', 'lighter'], [45, 'light', 'lighter'], [110, 'lighter']], shadowFarEvery: 1, woodsFar: 1500, canopyAt: 1350, propsFull: 50, propsNear: 220, footNear: 450, yardNear: 620, shadows: 'near', shadowSize: 1024, marks: 'light', marksFar: 4000, bridgesFar: 2000, cribStones: 160, tilesNear: 700, reliefNear: 120, blocksFar: 4000, smokeNear: 220, grass: { per: 110, reach: 90, rows: 3, wide: 4.5, floor: 0.05 }, flowers: { reach: 60, far: 200, near: 30, thin: 0.5 }, landN: 96, placesFar: 2500 },
  dreamcast: { style: 'dreamcast', pixelRatio: 1, scale: 1, minScale: 1, msaa: 0, scene: 'low', texMax: 256, aniso: 2, woods: [[10, 'light'], [45, 'lighter']], shadowFarEvery: 1, woodsFar: 1100, canopyAt: 950, propsFull: 0, propsNear: 180, footNear: 300, yardNear: 420, shadows: 'none', shadowSize: 512, marks: 'light', marksFar: 2600, bridgesFar: 1200, cribStones: 90, tilesNear: 420, reliefNear: 60, blocksFar: 2600, smokeNear: 150, grass: { per: 50, reach: 90, rows: 2, wide: 7, floor: 0.13 }, flowers: { reach: 45, far: 120, near: 0, thin: 0.3 }, landN: 64, placesFar: 1600 },
  n64:       { style: 'n64', pixelRatio: 1, scale: 1, minScale: 1, msaa: 0, scene: 'low', texMax: 96, aniso: 1, woods: [[16, 'lighter']], shadowFarEvery: 1, woodsFar: 800, canopyAt: 680, propsFull: 0, propsNear: 110, footNear: 170, yardNear: 230, shadows: 'none', shadowSize: 512, marks: 'light', marksFar: 1500, bridgesFar: 600, cribStones: 60, tilesNear: 240, reliefNear: 0, blocksFar: 1500, smokeNear: 0, grass: null, flowers: null, landN: 48, placesFar: 900 },
  ps1:       { style: 'ps1', pixelRatio: 1, scale: 1, minScale: 1, msaa: 0, scene: 'low', texMax: 128, aniso: 1, woods: [[12, 'lighter']], shadowFarEvery: 1, woodsFar: 700, canopyAt: 600, propsFull: 0, propsNear: 95, footNear: 140, yardNear: 190, shadows: 'none', shadowSize: 512, marks: 'light', marksFar: 1300, bridgesFar: 500, cribStones: 50, tilesNear: 200, reliefNear: 0, blocksFar: 1300, smokeNear: 0, grass: null, flowers: null, landN: 48, placesFar: 800 },
  // (a Game Boy's: 144 lines in four greens - the least the walk is drawn with, for the weakest machine)
  gameboy:   { style: 'gameboy', pixelRatio: 1, scale: 1, minScale: 1, msaa: 0, scene: 'low', texMax: 64, aniso: 1, woods: [[10, 'lighter']], shadowFarEvery: 1, woodsFar: 600, canopyAt: 500, propsFull: 0, propsNear: 80, footNear: 120, yardNear: 160, shadows: 'none', shadowSize: 512, marks: 'light', marksFar: 1100, bridgesFar: 400, cribStones: 40, tilesNear: 160, reliefNear: 0, blocksFar: 1100, smokeNear: 0, grass: null, flowers: null, landN: 48, placesFar: 700 },
};
// (the three tiers these took the place of, 11 Nov 2026: an address or a remembered setting that names one gets its heir)
const HEIR = { medium: 'gamecube', low: 'dreamcast', minimum: 'n64' };
for (const [was, now] of Object.entries(HEIR)) TIERS[was] = TIERS[now];

// How each older machine drew, as far as a browser can draw it again. lines: the picture's height (its width follows
// the window); scaleUp: 'pixel' (each of its pixels a hard square) or 'smooth'; bits: the levels each colour channel
// keeps (5: 32 levels, as a 15-bit picture; [5, 6, 5]: red, green and blue as a 16-bit picture keeps them) and
// dither, how its steps are broken up - 'bayer' (the ordered 4 x 4 pattern a PlayStation laid over every picture),
// 'ordered' (the regular 4 x 4 cross-hatch a Dreamcast's graphics chip laid over its 16-bit picture, sharp on a VGA
// screen), 'noise' (a Nintendo 64's finer grain, softened by its own blur on the way to the screen), or none;
// snap: corners moved to the picture's own pixels (a PlayStation had no finer
// place to put them: its models shiver as they move); affine: how far a texture is drawn straight across each triangle
// instead of in perspective (0 to 1: it swims on big walls seen at a slant, as it did); filter: 'nearest' (hard
// texels), 'linear' (smeared, no smaller copies), 'trilinear'; sat: the picture's colour against the full look's;
// bloom: how strongly what is bright spreads soft light round it (a 360's, its picture's own smaller copies); tone:
// 'filmic' (the film-like curve those years' pictures were finished with); palette: 'dmg' (the light of each pixel
// as one of a Game Boy's four greens, through the dither).
// texMax (the tier's) is the longest side any texture keeps.
// No fog in any of them: the land is seen to the horizon as in the full look, and what stands far off is drawn by
// lighter means instead of hidden - the trees as one card each and then as the land's painted crowns, the houses as
// plain boxes, the landmarks as their light copies (dev\world\landmarks_lod.py).
export const STYLES = {
  xbox360:   { name: 'Xbox 360',  about: '720 lines, bloom, filmic tone',      lines: 720, scaleUp: 'smooth', bits: 8, dither: 'none',  snap: false, affine: 0,    filter: 'trilinear', sat: 0.94, bloom: 0.7, tone: 'filmic' },
  gamecube:  { name: 'GameCube',  about: '480 lines, soft and clean',          lines: 480, scaleUp: 'smooth', bits: 8, dither: 'none',  snap: false, affine: 0,    filter: 'trilinear', sat: 1.1 },
  // (a Dreamcast on its VGA box: every pixel of its 640 x 480 hard-edged, its 16-bit colour's dither plain to see, no
  // smoothing anywhere - not the GameCube's soft picture, which it had been all but the same as: 12 Nov 2026)
  dreamcast: { name: 'Dreamcast', about: '480 lines, hard VGA pixels, 16-bit dither', lines: 480, scaleUp: 'pixel', bits: [5, 6, 5], dither: 'ordered', snap: false, affine: 0, filter: 'trilinear', sat: 1.06 },
  n64:       { name: 'N64',       about: '240 lines, smeared textures',        lines: 240, scaleUp: 'smooth', bits: 5, dither: 'noise', snap: false, affine: 0,    filter: 'linear',    sat: 1.0 },
  ps1:       { name: 'PS1',       about: '240 lines, hard pixels, it shivers', lines: 240, scaleUp: 'pixel',  bits: 5, dither: 'bayer', snap: true,  affine: 0.55, filter: 'nearest',   sat: 1.0 },
  gameboy:   { name: 'Game Boy',  about: '144 lines, four greens',             lines: 144, scaleUp: 'pixel',  bits: 2, dither: 'ordered', snap: false, affine: 0, filter: 'nearest',   sat: 1.0, palette: 'dmg' },
};
/** What the menu offers, top to bottom: the full look, then each older machine's. */
export const CHOICES = [
  { id: 'full', name: 'Full', about: 'everything, as it was made: needs a graphics card' },
  ...['xbox360', 'gamecube', 'dreamcast', 'n64', 'ps1', 'gameboy'].map((id) => ({ id, name: STYLES[id].name, about: STYLES[id].about })),
];
/** The menu's name for a tier. */
export const choiceOf = (tier) => (TIERS[tier]?.style ? TIERS[tier].style : 'full');
export const ORDER = ['ultra', 'high', 'xbox360', 'gamecube', 'dreamcast', 'n64', 'ps1', 'gameboy'];
// (v2: the tiers v1 remembered are dropped - a desktop card had been held low by them)
// (v3, 11 Nov 2026: the lower tiers took their older machines' names, and a choice made in the menu is kept as a choice)
const KEY = 'career-gfx-v3';

/** What the browser says of the graphics chip: { vendor, renderer } (the unmasked names where allowed). */
export function gpuInfo(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { vendor: String(vendor || ''), renderer: String(renderer || '') };
  } catch { return { vendor: '', renderer: '' }; }
}

/** The tier the machine's parts suggest, and why. */
export function guessTier(gl) {
  const { renderer: r } = gpuInfo(gl);
  const s = r.toLowerCase();
  const threads = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  const px = (screen.width || innerWidth) * (screen.height || innerHeight) * Math.min(devicePixelRatio || 1, 2) ** 2;
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  let tier, why, locked = false;
  if (/swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/.test(s)) { tier = 'n64'; why = 'software renderer'; }
  else if (mobile || /mali|adreno|powervr|apple gpu/.test(s)) { tier = 'dreamcast'; why = 'phone or tablet graphics'; }
  // (a separate card: NVIDIA's GeForce RTX / GTX 16 and up, Radeon RX 5000 and up, Arc; the laptop versions of these
  // a step lower)
  else if (/rtx|gtx 1[6-9]\d\d|radeon rx [5-9]\d\d\d|rx [6-9]\d\d\d|arc(\(tm\))? a[3-7]/.test(s)) {
    const laptop = /laptop|mobile|max-q| m\b/.test(s);
    tier = laptop ? 'high' : 'ultra'; why = laptop ? 'laptop graphics card' : 'graphics card';
    // (a desktop card: ultra, held there - full resolution always, never stepped down by a slow spell)
    if (!laptop) locked = true;
    if (/rtx 20[56]0|gtx 16|rx 5[5-6]00|arc(\(tm\))? a3/.test(s)) { tier = 'high'; why = 'entry graphics card'; locked = false; }
  }
  else if (/gtx|quadro|radeon pro|radeon r9|rx 4\d\d|rx 5\d\d\b/.test(s)) { tier = 'gamecube'; why = 'older graphics card'; }
  else if (/apple m[1-9] (pro|max|ultra)/.test(s)) { tier = 'high'; why = 'Apple silicon (Pro/Max)'; }
  else if (/apple m[1-9]|apple/.test(s)) { tier = 'gamecube'; why = 'Apple silicon'; }
  // (built-in graphics: Intel UHD / Iris / HD, AMD's "Radeon(TM) Graphics" or Vega on the processor)
  else if (/iris(\(r\))? xe|radeon 7\d0m|radeon 8\d0m|780m|680m/.test(s)) { tier = 'gamecube'; why = 'recent built-in graphics'; }
  else if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega/.test(s)) { tier = 'dreamcast'; why = 'built-in graphics'; }
  else { tier = 'gamecube'; why = 'unknown graphics (' + (r || 'hidden') + ')'; }
  // (a weak processor or little memory: a step lower; a very large screen on a middling card: a step lower)
  if (!locked && (threads <= 4 || mem <= 4)) { tier = step(tier, 1); why += ', few cores or little memory'; }
  if (!locked && px > 8.5e6 && ORDER.indexOf(tier) >= 1) { tier = step(tier, 1); why += ', a very large screen'; }
  return { tier, why, gpu: r, locked };
}

export const step = (tier, by) => ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(tier) + by))];

/** The tier to start at: the URL's ?gfx=, else the one chosen in the menu, else what this browser settled on before
 * (unless the chip changed), else the guess. `chosen`: someone picked it - it is never stepped down behind their back. */
export function chooseTier(gl) {
  const g = guessTier(gl);
  let forced = new URLSearchParams(location.search).get('gfx');
  if (forced === 'full') forced = fullTier(g);
  if (forced && TIERS[forced]) return { ...g, tier: HEIR[forced] ?? forced, why: 'chosen in the address', forced: true, locked: forced === 'ultra' || g.locked };
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (kept && kept.chosen && TIERS[kept.tier]) return { ...g, tier: kept.tier, why: 'chosen in the menu', forced: true, chosen: true, locked: kept.tier === 'ultra' };
    if (g.locked) return g;                                // (a desktop card: ultra, whatever was remembered)
    if (kept && kept.gpu === g.gpu && TIERS[kept.tier]) return { ...g, tier: kept.tier, why: kept.why };
  } catch { /* (no storage) */ }
  return g;
}

/** The full look's tier on this machine: ultra where its parts place it there, high everywhere else. */
export const fullTier = (g) => (g.tier === 'ultra' ? 'ultra' : 'high');

/** A choice made in the menu ('full' or an older machine's name), kept for the next visits; null forgets it (the
 * machine's own bracket again). Returns the tier it means. */
export function keepChoice(id, gl) {
  const g = guessTier(gl), tier = id === 'full' ? fullTier(g) : id;
  try {
    if (id === null) localStorage.removeItem(KEY);
    else if (TIERS[tier]) localStorage.setItem(KEY, JSON.stringify({ tier, why: 'chosen in the menu', gpu: g.gpu, chosen: true, at: Date.now() }));
  } catch { /* (none) */ }
  return id === null ? g.tier : tier;
}

export function rememberTier(info) {
  try { localStorage.setItem(KEY, JSON.stringify({ tier: info.tier, why: info.why, gpu: info.gpu, at: Date.now() })); } catch { /* (none) */ }
}
