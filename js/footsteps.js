// The walker's footsteps: one step each stride, from short recordings made in ComfyUI (Stable Audio 3.0 Medium: a walk
// over each ground, cut into single steps by dev/sound/cut_steps.py), chosen by what is underfoot: the meadow's grass,
// a field's stubble and soil, the forest floor's twigs and needles, the dirt of a path or track, a town's cobbles, bare
// rock, the pebbles of a shore, shallow water, the planks of a bridge. Never the same step twice running; each a little
// different in pitch and loudness; softer crouching, a shuffle lying down, louder running; a heavier one on landing
// from a jump.
//
// makeFootsteps(ctx, out, base) -> { step(surface, how), land(surface) } once the browser allows sound (walk.js).

export const SURFACES = ['grass', 'field', 'forest', 'dirt', 'cobble', 'rock', 'shore', 'water', 'wood'];
// (where a surface has no recordings of its own, the nearest that has)
const STAND_IN = { field: 'grass', cobble: 'rock', shore: 'dirt', rock: 'dirt', forest: 'grass', wood: 'dirt', water: 'shore', dirt: 'grass' };

export function makeFootsteps(ctx, out, base = '') {
  const sets = {};
  let manifest = null;
  fetch(base + 'assets/sound/steps/steps.json').then((r) => (r.ok ? r.json() : null)).then(async (m) => {
    manifest = m;
    if (!m) return;
    for (const [surface, files] of Object.entries(m.surfaces)) {
      sets[surface] = [];
      for (const f of files) {
        try {
          const buf = await (await fetch(base + 'assets/sound/steps/' + f)).arrayBuffer();
          sets[surface].push(await ctx.decodeAudioData(buf));
        } catch { /* (a step that will not load is left out) */ }
      }
    }
  }).catch(() => {});
  const bus = ctx.createGain();
  bus.gain.value = manifest?.gain ?? 0.55;
  bus.connect(out);
  const lastPick = {};
  let side = 1;
  const pick = (surface) => {
    let s = surface, guard = 0;
    while ((!sets[s] || !sets[s].length) && guard++ < 4) s = STAND_IN[s] ?? 'grass';
    const list = sets[s];
    if (!list || !list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[s]) i = (i + 1) % list.length;
    lastPick[s] = i;
    return list[i];
  };
  const play = (buf, gain, rate, pan) => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(g); node.connect(bus);
    src.start();
  };
  return {
    /** One stride on `surface`; how: { stance: 'stand' | 'crouch' | 'prone', run: bool }. */
    step(surface, how = {}) {
      const buf = pick(surface);
      if (!buf) return;
      side = -side;
      const loud = how.stance === 'prone' ? 0.25 : how.stance === 'crouch' ? 0.45 : how.run ? 1.15 : 0.8;
      play(buf, loud * (0.85 + 0.3 * Math.random()), (how.stance === 'prone' ? 0.85 : 1) * (0.93 + 0.14 * Math.random()), side * 0.12);
    },
    /** Coming down from a jump: both feet, a little apart, heavier. */
    land(surface) {
      const a = pick(surface), b = pick(surface);
      if (a) play(a, 1.2, 0.88, -0.08);
      if (b) setTimeout(() => play(b, 0.9, 0.92, 0.08), 45);
    },
  };
}
