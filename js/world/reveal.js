// The cities come in a little at a time. Two things had made that tick:
//   - every piece of both cities (the houses' tiles, the yards, the pavements, the bridges) shown in the same frame, so
//     that frame sent some hundreds of MB of new geometry and pictures to the graphics card at once;
//   - the cities' files all read and decoded close together.
// Now each heavy piece is shown for the first time only when the gate lets it, and the gate is the walk's arrivals
// (arrive.js): its shaders made in the background, its pictures and its triangles sent up within a frame's budget,
// nearest the camera first, and then it rises out of the ground into its place - unless a farther copy of it stood
// there already (a tile of houses taking its plain boxes' place: rise false). Once on the card it shows and hides as
// before. The files are fetched and decoded one after another (loadInTurn), with a frame between, so no two decodes
// share a frame.
import { DefaultLoadingManager as LM } from 'three';
import { gltfLoader } from '../gltf.js';
import { arrive, arrivalsWaiting } from './arrive.js';

/** Hold `o` back until the gate lets it through (call once, when it is made; it stays in the scene, hidden).
 *  opts: the arrival's (rise, depth, dur). */
export function gate(o, x, z, opts = {}) {
  o.userData.gate = { x, z, opts, asked: false };
}

/** Whether `o` may be shown now, given that it is wanted: true once it has been let through. */
export function allowed(o, want) {
  const g = o.userData.gate;
  if (!g) return want;
  if (want && !g.asked) {
    g.asked = true;
    // (asked for once; it comes in whether or not it is still wanted by then - shown only while it is. Once it stands
    // in its place, userData.risen says so: what belongs on it waits for that - citytiles.js risen)
    arrive(o, { gate: true, x: g.x, z: g.z, ...g.opts }).then(() => { o.userData.risen = true; });
  }
  return false;
}

/** (The arrivals' own pump lets the gate's pieces through: arrive.js pumpArrivals. Kept for what still calls it.) */
export function pump() {}

/** How many pieces are still waiting to come in or rising (for tests and the timeline). */
export const waitingCount = () => arrivalsWaiting();

// (the cities' files, one at a time: all fetched at once, each decoded after the one before, a frame apart)
let chain = Promise.resolve();
// (a frame's wait, or 50 ms where no frames come - a page in the background)
export const aFrame = () => new Promise((res) => { requestAnimationFrame(() => res()); setTimeout(res, 50); });
export function loadInTurn(url) {
  // (held open in the loading manager until it is decoded, so the page knows when every city file is in)
  LM.itemStart(url);
  const fetched = fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); });
  const p = chain.then(() => fetched).then((buf) => aFrame().then(() => buf))
    .then((buf) => gltfLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1)));
  p.then(() => LM.itemEnd(url), () => { LM.itemError(url); LM.itemEnd(url); });
  chain = p.catch(() => {}).then(aFrame);
  return p;
}

// ---- work in slices: a long loop over thousands of things gives the frame back every few milliseconds, its work done
// in the gaps between frames (after each frame is drawn), every loop together no more than `ms` a gap
let gapStart = 0;
const nextGap = () => new Promise((res) => { requestAnimationFrame(() => setTimeout(res, 0)); setTimeout(res, 80); });
/** Await it in a loop's body: once this gap's few milliseconds are spent, the next gap. */
export async function breathe(ms = 5) {
  if (gapStart && performance.now() - gapStart < ms) return;
  await nextGap();
  gapStart = performance.now();
}
