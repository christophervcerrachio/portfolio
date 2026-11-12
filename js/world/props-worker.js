// The cities' furniture lists read off the page's own thread. Moscow's list is 12 MB of numbers - 170,000 lengths of
// fence, 52,000 trees, 37,000 gate leaves - and reading it and sorting it into the furniture's tiles had held the walk
// still for a fifth of a second as the cities came in. Here it is read and sorted in a worker (props-pack.js); the page
// is handed, for each kind of thing, one block of numbers sorted by tile and where each tile's part of it begins
// (cityprops.js).
// In: { url, porticos (or null), tile (m) }. Out: packProps's, or { error }.
import { packProps } from './props-pack.js';

self.onmessage = async (e) => {
  const { url, porticos, tile } = e.data;
  try {
    const [J, P] = await Promise.all([fetch(url).then((r) => r.json()), porticos ? fetch(porticos).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : {}]);
    const out = packProps(J, P, tile);
    self.postMessage({ kinds: out.kinds, trees: out.trees }, out.transfer);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
