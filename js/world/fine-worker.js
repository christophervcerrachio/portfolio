// The fine relief's tables made off the page's own thread (finehash.js): the 9 m lattice over the core square is ten
// million corners, an eighth of a second and more of hashing - the page would have stood still for it as the world came
// in (terrain.js loadWorld). In: { i0, j0, n }. Out: { px } (a byte a corner, a row to each j), or { error }.
import { fineTable } from './finehash.js';

self.onmessage = (e) => {
  const { i0, j0, n } = e.data;
  try {
    const px = fineTable(i0, j0, n);
    self.postMessage({ px }, [px.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
