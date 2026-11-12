// The pictures' size on a machine that cannot hold them all. Measured live on 11 Nov 2026: the walk draws from 189
// pictures, 2.3 GB on the graphics card once all of them have been seen (58 of them 2048 px square: 22 MB each with
// their smaller copies; two of 4096 px: 89 MB each). A desktop's card has that to itself. A laptop's built-in graphics
// takes it from the machine's own memory, beside the page's - and a machine out of memory goes to its disk for more,
// and draws a frame a second.
// hardware.js texMax is the longest side a picture is kept at on each tier (none on a graphics card): a picture larger
// than that is drawn down once, when it is read, before the card ever has it. Half the side is a quarter of the memory.
// The world's own maps (the heights, the cover, the water: world/terrain.js) are numbers, not pictures, and are never
// touched; nor are the sky's panoramas, which fill the whole view.
let CAP = Infinity;

/** The longest side kept (px); 0, none or Infinity: every picture as it is. Set before anything is read. */
export function setTextureCap(px) { CAP = px > 0 ? px : Infinity; }
export const textureCap = () => CAP;

const sizeFor = (w, h) => {
  const s = CAP / Math.max(w, h);
  return s < 1 ? [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))] : null;
};

/** A texture whose picture is an image element (three's TextureLoader gives these), once loaded: no larger than the
 *  cap, drawn down onto a canvas. Returns the texture. */
export function capImage(tex) {
  const im = tex?.image, w = im ? (im.naturalWidth || im.videoWidth || im.width) : 0, h = im ? (im.naturalHeight || im.videoHeight || im.height) : 0;
  const to = w && h ? sizeFor(w, h) : null;
  if (!to || typeof document === 'undefined') return tex;
  try {
    const c = document.createElement('canvas');
    c.width = to[0]; c.height = to[1];
    const g = c.getContext('2d');
    if (!g) return tex;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, to[0], to[1]);
    tex.image = c; tex.needsUpdate = true;
    im.close?.();
  } catch { /* (kept as it came) */ }
  return tex;
}

/** A texture whose picture is an ImageBitmap (the model loader gives these): a promise of it, its picture no larger
 *  than the cap. The picture is drawn down as it was read - not flipped, its alpha not multiplied in, its colours not
 *  converted - and the large one let go at once. (Checked in Chrome, 11 Nov 2026: a half-clear picture keeps its
 *  colours and its alpha; 2048 px to 1024 takes 9 ms. 'medium' averages; 'high' rings at an edge of the alpha.) */
export async function capBitmap(tex) {
  const im = tex?.image;
  if (!im || !(CAP < Infinity)) return tex;
  if (typeof ImageBitmap === 'undefined' || !(im instanceof ImageBitmap) || typeof createImageBitmap !== 'function') return capImage(tex);
  const to = sizeFor(im.width, im.height);
  if (!to) return tex;
  try {
    const small = await createImageBitmap(im, { resizeWidth: to[0], resizeHeight: to[1], resizeQuality: 'medium', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    // (a browser that does not know the resize options gives the picture back as large as it was: kept, then)
    if (small.width <= to[0] && small.height <= to[1]) { tex.image = small; tex.needsUpdate = true; im.close?.(); }
    else small.close?.();
  } catch { /* (kept as it came) */ }
  return tex;
}
