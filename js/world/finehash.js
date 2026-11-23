// The fine relief's hash as the CPU works it - the shaders' own (wind-glsl.js hash12), in double precision - and its
// tables for the card. The land's fine relief (terrain.js fineCPU: hummocks of 0.45 m at a 9 m lattice and 0.7 m at a
// 23 m one) is value noise over the corners of the two lattices; the CPU's height of the land, and so every place,
// house, stone and tree laid on it, is worked from these numbers. The card had worked the hash itself, in single
// precision, and at one corner in thirty its last step - the fraction of a product near 20,000 - came out on the other
// side of a whole number: a hummock the CPU did not have, or one it had and the card did not draw, up to 0.7 m, and the
// ways' stones laid on it stood over the drawn path (23 Nov 2026, dev\tests\groundtest.js). Now the card reads the
// CPU's own numbers, a byte a corner, from tables made of them (fine-worker.js, terrain.js loadWorld; LAND_GLSL fineH).
// (Not the other way about: v0.0.160 gave both a new hash, every hummock moved, and the places laid out on the land
// moved with them - the windmill out of the walk's first view. The CPU's numbers stay as they are.)
const fract = (v) => v - Math.floor(v);
export function hash12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}

/** The hash at every whole point (i0 + i, j0 + j) of an n by n square, a byte each (the nearest of 0..255), a row to
 *  each j. */
export function fineTable(i0, j0, n) {
  const px = new Uint8Array(n * n);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) px[k] = Math.round(hash12(i0 + i, j0 + j) * 255);
  return px;
}
