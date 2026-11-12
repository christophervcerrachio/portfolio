// The pictures' size on a machine that cannot hold them all. Measured live on 11 Nov 2026: the walk draws from 189
// pictures, 2.3 GB on the graphics card once all of them have been seen (58 of them 2048 px square: 22 MB each with
// their smaller copies; two of 4096 px: 89 MB each). A desktop's card has that to itself. A laptop's built-in graphics
// takes it from the machine's own memory, beside the page's - and a machine out of memory goes to its disk for more,
// and draws a frame a second.
// hardware.js texMax is the longest side a picture is kept at on each tier (none on a graphics card): a picture larger
// than that is drawn down once, when it is read, before the card ever has it. Half the side is a quarter of the memory.
// The world's own maps (the heights, the cover, the water: world/terrain.js) are numbers, not pictures, and are never
// touched; nor are the sky's panoramas, which fill the whole view.
import * as THREE from 'three';

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

// ---- a picture file as a texture, decoded off the page's own thread
// three's TextureLoader gives a texture whose picture is an image element, and the browser decodes an image element
// when it is first sent to the graphics card - on the page's thread: 25 ms for a 2048 px JPEG, 60 ms for a PNG, each a
// dropped frame or four as it came into the walk; awaiting its decode() changed nothing. Read as a bitmap it is
// decoded in the background and goes up in 5 ms (all measured in Chrome on the walk's own pictures, 12 Nov 2026).
// (the browsers whose bitmaps cannot be trusted for this take the image element, as three's own model loader does)
const BITMAPS = (() => {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const safari = /^((?!chrome|android).)*safari/i.test(ua), sv = safari ? +(ua.match(/Version\/(\d+)/)?.[1] ?? -1) : -1;
  const ff = +(ua.match(/Firefox\/(\d+)\./)?.[1] ?? -1);
  return !(safari && sv < 17) && !(ua.includes('Firefox') && ff < 98);
})();

/** A texture for the picture at `url`, at once - to be set up as three's TextureLoader's is (its wrapping, its colour
 *  space, its flipY) - its picture following when the file has come, as a bitmap no larger than the machine's cap
 *  (cap: false - as it is). The texture's flipY and premultiplyAlpha as they stand when the file arrives are built
 *  into the bitmap (the card takes a bitmap as it is), so set them, if at all, at once. onLoad(texture) once it has
 *  its picture; onError(error) if it cannot be read. */
export function loadPicture(url, { cap = true, onLoad = null, onError = null } = {}) {
  const t = new THREE.Texture();
  const viaImage = () => new THREE.ImageLoader().load(url, (im) => { t.image = im; if (cap) capImage(t); t.needsUpdate = true; onLoad?.(t); }, undefined, (e) => onError?.(e));
  if (!BITMAPS) { viaImage(); return t; }
  fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.blob(); })
    .then((b) => createImageBitmap(b, { imageOrientation: t.flipY ? 'flipY' : 'none', premultiplyAlpha: t.premultiplyAlpha ? 'premultiply' : 'none', colorSpaceConversion: 'none' }))
    .then(async (bmp) => {
      const to = cap ? sizeFor(bmp.width, bmp.height) : null;
      if (to) {
        try {
          const small = await createImageBitmap(bmp, { resizeWidth: to[0], resizeHeight: to[1], resizeQuality: 'medium', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          if (small.width <= to[0] && small.height <= to[1]) { bmp.close?.(); bmp = small; } else small.close?.();
        } catch { /* (kept as it came) */ }
      }
      t.image = bmp; t.flipY = false; t.premultiplyAlpha = false; t.needsUpdate = true;
      return true;
    })
    .catch((e) => {
      // (the file is not there: said; a browser that could not make the bitmap: the image element)
      if (/ \d\d\d$/.test(String(e?.message))) onError?.(e); else viaImage();
      return false;
    })
    .then((ok) => { if (ok) onLoad?.(t); });
  return t;
}

/** loadPicture as a promise: the texture once it has its picture. */
export const loadPictureAsync = (url, opts = {}) => new Promise((res, rej) => loadPicture(url, { ...opts, onLoad: res, onError: rej }));

