// The first draws spread over frames, never bunched into one.
//
// A thing's triangles are not on the graphics card until it has been drawn once: three makes the buffers the first time
// it appears in a picture (pictures of a arriving piece are sent up at its arrival - arrive.js, renderer.initTexture -
// and there is no such way for a shape: this vendored three has no upload to call). So whether a thing EXISTS is the
// arrivals' business, by distance from the walker (world/cityprops.js builds a tile's furniture nearest first within a
// frame's budget and lets it go when he leaves; world/reveal.js asks for a thing wherever it stands) - but whether it
// has been DRAWN once is the view's business, and a turn of the view changes what is drawn without changing anything
// else. Turned on the spot at the spawn with everything arrived, the walk sent three hundred and seventy-five shapes to
// the card in nine seconds, and the frames it did it in ran to a fifth of a second while the same walk standing still
// sent none (tasks\2026-11-21-first-draw-uploads-plan.md, 21 Nov 2026: the turning arms of tasks\scripts\144-arm.mjs).
//
// So the work is not removed, it is spread: an object wanted for the first time is let through while a frame's allowance
// lasts, and one that missed the allowance waits a frame and goes through on the next whatever else decides. A frame at
// forty-five frames a second is 22 ms: nothing a visitor can see, against a fifth of a second of hitching. An object can
// be a frame late; it cannot be lost, because the beat below lets everything held through before the next frame's
// decisions are made.
//
// What it does NOT do: draw anything that is not wanted. An object held back is only ever one some part of the walk has
// already said it wants this frame, and the held ones go through one frame later whatever else decides - a thing at the
// very edge of a distance or a view may therefore be seen for one frame after it stopped being wanted. That is the whole
// cost, and it is one frame's worth of a thing at an edge.

import { inBulk } from './arrive.js';

/** How many never-yet-drawn things a frame may take. Set from the machine's class (walk.js); a dozen is where it starts. */
let allowance = 12;
export const setAllowance = (n) => { allowance = Math.max(1, Math.round(n) || 1); };
export const allowanceNow = () => allowance;

let used = 0;
const held = [];

/** This file's own beat: one frame's allowance ends with the frame, and whatever was held goes through. */
const beat = () => {
  if (held.length) { for (const o of held) { o.userData.seen = true; o.visible = true; } held.length = 0; }
  used = 0;
  requestAnimationFrame(beat);
};
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(beat);

/** How many objects are waiting for the next frame (for the tests and the frame's record). */
export const heldCount = () => held.length;

/** Whether `o` may be drawn this frame, given that something wants it drawn: `want` passes through untouched once `o`
 *  has been drawn once, which is all of it that this file changes. */
export function firstSight(o, want) {
  if (!want) return false;
  // (under the loading picture the walk brings whole cities in at once, by its own leave: arrive.js inBulk - a frame's
  //  allowance there would hold a city's furniture out for seconds after the picture lifted, so the loading walk is not
  //  spread; the frames a visitor turns in are)
  if (inBulk()) { o.userData.seen = true; return true; }
  if (o.userData.seen) return true;
  if (used < allowance) { used++; o.userData.seen = true; return true; }
  if (!held.includes(o)) held.push(o);
  return false;
}
