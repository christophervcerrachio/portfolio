// The cities' furniture lists packed for the page: for each kind of thing one block of numbers sorted by the
// furniture's tiles, and where each tile's part of it begins; the trees apart (props-worker.js reads the lists off the
// page's own thread with this; cityprops.js uses it itself where no worker can be made).
//
// packProps(J, P, tile) -> { kinds: [{ kind, data: Float32Array [x, y (NaN: on the ground), z, yaw, along, up] per item,
//   tiles: Int32Array [i, j, first item, items] per tile }], trees: { data: Float32Array [x, y, z, yaw, scale] per
//   tree, kind: Uint8Array, names: [model name] }, transfer: [the arrays' buffers] }
export const N = 6;

export function packProps(J, P, tile) {
  const byKind = new Map();
  const add = (kind, it) => { let l = byKind.get(kind); if (!l) byKind.set(kind, (l = [])); l.push(it); };
  const trees = [];
  for (const [kind, list] of Object.entries({ ...J, portico: P.portico })) {
    if (kind === 'about' || !Array.isArray(list)) continue;
    if (kind === 'tree') { for (const it of list) trees.push(it); continue; }
    for (const it of list) {
      // (the shops: one list, each naming its model; the porticos theirs, one or two storeys; the fences grey or
      // green, by the stretch they stand in - a whole gap's fence the same)
      const k = kind === 'shop' ? it[4] : kind === 'portico' ? it[6]
        : kind === 'fence' ? ((Math.floor(it[0] / 12) * 7 + Math.floor(it[2] / 12) * 13) % 3 === 0 ? 'fence-green' : 'fence-grey') : kind;
      add(k, it);
    }
  }
  const kinds = [], transfer = [];
  for (const [kind, list] of byKind) {
    const key = (it) => Math.floor(it[0] / tile) * 100003 + Math.floor(it[2] / tile);
    list.sort((a, b) => key(a) - key(b));
    const data = new Float32Array(list.length * N), runs = [];
    let start = 0;
    for (let n = 0; n < list.length; n++) {
      const it = list[n], o = n * N;
      data[o] = it[0]; data[o + 1] = typeof it[1] === 'number' ? it[1] : NaN; data[o + 2] = it[2]; data[o + 3] = it[3] ?? 0;
      data[o + 4] = typeof it[4] === 'number' ? it[4] : 1; data[o + 5] = typeof it[5] === 'number' ? it[5] : 1;
      if (n === list.length - 1 || key(list[n + 1]) !== key(it)) {
        runs.push(Math.floor(it[0] / tile), Math.floor(it[2] / tile), start, n + 1 - start);
        start = n + 1;
      }
    }
    const tiles = Int32Array.from(runs);
    kinds.push({ kind, data, tiles });
    transfer.push(data.buffer, tiles.buffer);
  }
  const names = [], ix = new Map();
  const td = new Float32Array(trees.length * 5), tk = new Uint8Array(trees.length);
  trees.forEach((it, n) => {
    td[n * 5] = it[0]; td[n * 5 + 1] = typeof it[1] === 'number' ? it[1] : NaN; td[n * 5 + 2] = it[2]; td[n * 5 + 3] = it[3] ?? 0; td[n * 5 + 4] = it[4] ?? 1;
    let k = ix.get(it[5]); if (k === undefined) { k = names.length; names.push(it[5]); ix.set(it[5], k); }
    tk[n] = k;
  });
  transfer.push(td.buffer, tk.buffer);
  return { kinds, trees: { data: td, kind: tk, names }, transfer };
}
