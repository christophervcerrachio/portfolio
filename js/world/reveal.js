// The cities come in a little at a time. Two things had made that tick:
//   - every piece of both cities (the houses' tiles, the yards, the pavements, the bridges) shown in the same frame, so
//     that frame sent some hundreds of MB of new geometry and pictures to the graphics card at once;
//   - the cities' files all read and decoded close together.
// Now each heavy piece is shown for the first time only when the gate lets it: nearest the camera first, at most
// BUDGET bytes of new data a frame (one piece always, however big). Once on the card it shows and hides as before. The
// files are fetched and decoded one after another (loadInTurn), with a frame between, so no two decodes share a frame.
import { DefaultLoadingManager as LM } from 'three';
import { gltfLoader } from '../gltf.js';

const BUDGET = 24e6;                    // (bytes of new geometry and pictures a frame: about 3 ms of upload on a desktop card)
const waiting = new Set();              // the pieces wanting to be shown, not yet let through
const counted = new WeakSet();          // (pictures already counted: shared between pieces, sent once)

function bytesOf(o) {
  let b = 0;
  o.traverse?.((m) => {
    const g = m.geometry;
    if (g) {
      for (const a of Object.values(g.attributes)) b += a.array?.byteLength ?? 0;
      if (g.index) b += g.index.array.byteLength;
    }
    if (m.isInstancedMesh) b += m.instanceMatrix.array.byteLength;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
      const t = mt[k];
      if (t?.image && !counted.has(t.source ?? t)) { counted.add(t.source ?? t); b += (t.image.width || 0) * (t.image.height || 0) * 4 * 1.33; }
    }
  });
  return b;
}

/** Hold `o` back until the gate lets it through (call once, when it is made). */
export function gate(o, x, z) {
  o.userData.gate = { bytes: bytesOf(o), x, z };
}

/** Whether `o` may be shown now, given that it is wanted: true once it has been let through. */
export function allowed(o, want) {
  const g = o.userData.gate;
  if (!g) return want;
  if (want) waiting.add(o); else waiting.delete(o);
  return false;
}

/** Once a frame, before drawing: let the nearest waiting pieces through, up to the budget. */
export function pump(pos) {
  if (!waiting.size) return;
  const list = [...waiting].sort((a, b) => {
    const A = a.userData.gate, B = b.userData.gate;
    return Math.hypot(A.x - pos.x, A.z - pos.z) - Math.hypot(B.x - pos.x, B.z - pos.z);
  });
  let spent = 0;
  for (const o of list) {
    const g = o.userData.gate;
    if (spent > 0 && spent + g.bytes > BUDGET) break;
    spent += g.bytes;
    delete o.userData.gate; waiting.delete(o);
    o.visible = true;
  }
}

/** How many pieces are still waiting (for tests and the timeline). */
export const waitingCount = () => waiting.size;

// (the cities' files, one at a time: all fetched at once, each decoded after the one before, a frame apart)
let chain = Promise.resolve();
// (a frame's wait, or 50 ms where no frames come - a page in the background)
const aFrame = () => new Promise((res) => { requestAnimationFrame(() => res()); setTimeout(res, 50); });
export function loadInTurn(url) {
  // (held open in the loading manager until it is decoded, so the page waits for every city file before it makes
  // their shaders: walk.js later)
  LM.itemStart(url);
  const fetched = fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); });
  const p = chain.then(() => fetched).then((buf) => aFrame().then(() => buf))
    .then((buf) => gltfLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1)));
  p.then(() => LM.itemEnd(url), () => { LM.itemError(url); LM.itemEnd(url); });
  chain = p.catch(() => {}).then(aFrame);
  return p;
}
