// The wind and the rain, heard: the sound of the countryside (backdrops/countryside.js hands it the wind and the rain
// every frame). Nothing is recorded; it is all noise, shaped:
//   - the howl: the air through two narrow resonant bands, low, their pitches wandering slowly and never together,
//     quiet between gusts and rising and swelling with each one;
//   - the breeze: a deep, soft rush of air under it;
//   - the whoosh: with each strong gust the air swells, muffled (heard across the hilltop, not at the ear), and runs
//     across from left to right with it; the lighter gusts only stir the leaves;
//   - the birches: their leaves rustle on either side only as a gust reaches them, fluttering several times a second;
//   - the drizzle: a soft hiss, and the patter of drops on the leaves and the grass all round, as the shower comes;
//   - the thunder: far off, low, rolling, now and then while it drizzles (drizzle.js).
// Nothing in it is bright: every noise is rounded off well below where hiss turns to static. It starts silent and
// fades in, from the visitor's first click (browsers allow sound only after one).

/** A looping buffer of n samples, filled by fill(data). */
function buffer(ctx, n, fill) {
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  fill(b.getChannelData(0), n);
  return b;
}

export function windSound(ctx, out) {
  const rate = ctx.sampleRate;
  // deep noise (brown: each sample a small step from the last), evened out so that it loops without a click
  const brown = buffer(ctx, Math.round(rate * 7), (d, n) => {
    let x = 0;
    for (let i = 0; i < n; i++) { x = (x + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = x; }
    const drift = d[n - 1] - d[0];
    let mean = 0, peak = 1e-6;
    for (let i = 0; i < n; i++) { d[i] -= drift * i / (n - 1); mean += d[i] / n; }
    for (let i = 0; i < n; i++) { d[i] -= mean; peak = Math.max(peak, Math.abs(d[i])); }
    for (let i = 0; i < n; i++) d[i] /= peak;
  });
  const white = buffer(ctx, Math.round(rate * 5), (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
  // the leaves' flutter: a new random level every 70 ms, eased into from the last (and back round to the first)
  const step = Math.round(rate * 0.07), steps = Math.round(9 / 0.07);
  const levels = Array.from({ length: steps }, () => Math.random() * 2 - 1);
  const flutter = buffer(ctx, step * steps, (d, n) => {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i / step), e = (1 - Math.cos(Math.PI * (i % step) / step)) / 2;
      d[i] = levels[j] + (levels[(j + 1) % steps] - levels[j]) * e;
    }
  });

  // the drops: a few hundred a second at the heaviest, each a tiny tick of noise dying away in a few milliseconds
  const drops = () => buffer(ctx, Math.round(rate * 3.3), (d, n) => {
    for (let k = 0; k < 520; k++) {
      const at = Math.floor(Math.random() * n), len = Math.round(rate * (0.002 + Math.random() * 0.006)), a = 0.25 + Math.random() * 0.75;
      for (let i = 0; i < len; i++) d[(at + i) % n] += a * (Math.random() * 2 - 1) * Math.exp(-6 * i / len);
    }
  });

  const sources = [];
  const loop = (b, speed = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = b; s.loop = true; s.playbackRate.value = speed;
    sources.push(s);
    return s;
  };
  const filter = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const pan = (p) => { if (!ctx.createStereoPanner) return gain(1); const n = ctx.createStereoPanner(); n.pan.value = p; return n; };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); };

  const master = gain(0);
  master.connect(out);
  // the breeze: brown noise, low
  const rumble = filter('lowpass', 320, 0.5), rumbleGain = gain(0.2);
  // the whoosh: the same air through a band that rises a little with the gust, rounded off above (heard across the
  // hilltop, not at the ear), travelling across with it
  const whoosh = filter('bandpass', 200, 0.9), whooshGain = gain(0), whooshPan = pan(0);
  const air = loop(brown);
  chain(air, rumble, rumbleGain, master);
  air.connect(whoosh); chain(whoosh, filter('lowpass', 620, 0.5), whooshGain, whooshPan, master);
  // its breath: a little air on top, only in the gusts, muffled too
  const hiss = filter('bandpass', 640, 0.7), hissGain = gain(0);
  chain(loop(white), hiss, filter('lowpass', 900, 0.5), hissGain, whooshPan);
  // the howl: brown and a little white noise through two narrow bands (a high Q sings), a low one and one a fifth or so
  // above, panned a little apart
  // (fluttery: its loudness shaken by the leaves' flutter at two speeds, as air catches and lets go)
  const howls = [[210, 8, -0.3], [330, 9, 0.3]].map(([f, q, p], k) => {
    const bp = filter('bandpass', f, q), g = gain(0), depth = gain(0);
    chain(air, bp); chain(bp, filter('lowpass', 900, 0.5), g, pan(p), master);
    const w = gain(0.05); chain(loop(white, 0.97), w, bp);
    loop(flutter, 1.9 + 0.7 * k).connect(depth); loop(flutter, 4.3 + 1.1 * k).connect(depth);
    depth.connect(g.gain);
    return { bp, g, depth, f, drift: Math.random() * 6.28 };
  });
  // the birches: bright noise on either side, its loudness shaken by the flutter (slow and fast together)
  const leaves = [[-0.7, 0.15, 2500], [0.7, 0.85, 3000]].map(([p, at, f]) => {
    const g = gain(0), depth = gain(0), soft = filter('lowpass', 4800, 0.4);
    chain(loop(white), filter('bandpass', f, 0.8), soft, g, pan(p), master);
    loop(flutter).connect(depth);
    loop(flutter, 2.7).connect(depth);
    depth.connect(g.gain);
    return { g, depth, at };
  });

  // the drizzle: a soft hiss, and drops pattering either side
  const rainHiss = filter('bandpass', 1600, 0.45), rainGain = gain(0);
  chain(loop(white, 0.93), rainHiss, filter('lowpass', 4000, 0.5), rainGain, master);
  const patter = [-0.6, 0.6].map((p, i) => {
    const g = gain(0);
    chain(loop(drops(), 0.9 + 0.2 * i), filter('bandpass', 2300 - 450 * i, 0.6), filter('lowpass', 4800, 0.5), g, pan(p), master);
    return g;
  });

  // the thunder: far off, so only its low part reaches the walker (the air takes the rest) - a long roll of deep noise
  // swelling two or three times and dying away, from the side the bolt came down (drizzle.js); km away: it comes that
  // many times 2.9 s after the flash. Without a flash (rumble): a storm beyond the horizon, lower and fainter still.
  const roll = buffer(ctx, Math.round(rate * 12), (d, n) => {
    let x = 0;
    for (let i = 0; i < n; i++) { x = (x + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = x; }
    let peak = 1e-6; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < n; i++) d[i] /= peak;
  });
  const peal = (when, km, side, level) => {
    if (!on) return;
    const s = ctx.createBufferSource(); s.buffer = roll; s.playbackRate.value = 0.8 + 0.3 * Math.random();
    const lp = filter('lowpass', Math.max(70, 260 - km * 11), 0.6), lp2 = filter('lowpass', Math.max(90, 320 - km * 12), 0.5);
    const g = gain(0), p = pan(Math.max(-0.7, Math.min(0.7, side)));
    chain(s, lp, lp2, g, p, master);
    // (its swells: the near part of the bolt's path heard first, the far parts after)
    const dur = 4 + Math.random() * 5, K = 64, curve = new Float32Array(K), sw = 2 + Math.floor(Math.random() * 2);
    const at = Array.from({ length: sw }, (_, i) => (i === 0 ? 0.06 : 0.15 + Math.random() * 0.55)), hi = at.map((_, i) => (i === 0 ? 1 : 0.4 + 0.6 * Math.random()));
    for (let i = 0; i < K; i++) {
      const u = i / (K - 1);
      let v = 0;
      for (let j = 0; j < sw; j++) { const x = (u - at[j]) / (0.08 + 0.12 * j); v = Math.max(v, hi[j] * (x < 0 ? Math.exp(-x * x * 8) : Math.exp(-x * 1.6))); }
      curve[i] = level * v * (1 - u) ** 0.7;
    }
    const t0 = ctx.currentTime + when;
    g.gain.setValueCurveAtTime(curve, t0, dur);
    s.start(t0, Math.random() * 3); s.stop(t0 + dur + 0.1);
  };

  let started = false, on = false, last = -1;
  const set = (param, v, tc) => param.setTargetAtTime(v, ctx.currentTime, tc);

  return {
    start() {
      if (!started) { sources.forEach((s, i) => s.start(0, (i * 0.37) % 4)); started = true; }
      on = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      set(master.gain, 1, 0.9);
    },
    stop() {
      on = false;
      master.gain.cancelScheduledValues(ctx.currentTime);
      set(master.gain, 0, 0.3);
    },
    /** Thunder from a bolt km off, toward yaw (radians from straight ahead, right positive): drizzle.js onStrike. */
    thunder({ km, yaw = 0 }) { peal(km / 0.343, km, Math.sin(yaw), 0.55 * Math.min(1, 9 / km)); },
    /** Thunder from a storm beyond the horizon: no flash. */
    rumble() { peal(0, 22 + Math.random() * 10, (Math.random() - 0.5) * 1.2, 0.22 + 0.12 * Math.random()); },
    /** The wind now ({ gust: 0..1, front: where across the view it is, 0..1 }), the rain (0..1) and, if given, which
     *  way the view faces ({ yaw }: radians, 0 straight ahead, to the right positive; 0 if not given); a few times a
     *  second is enough. */
    update(w, t, rain = 0, view) {
      if (!on || Math.abs(t - last) < 0.04) return;
      last = t;
      set(rainGain.gain, 0.05 * rain, 0.8);
      for (const g of patter) set(g.gain, 0.22 * rain * rain, 0.8);
      const G = w.gust;
      const near = (u) => { const x = (u - w.front) / 0.35; return G * Math.exp(-x * x); };
      // (the whoosh comes only with the strong part of a strong gust; a light one is heard in the leaves alone)
      const S = G * Math.min(1, Math.max(0, (G - 0.4) / 0.5)) ** 1.5;
      // (all of it softer: WIND scales every part of it)
      const WIND = 0.5 * (0.15 + 0.85 * (w.level ?? 1));   // (and near silent in a calm spell)
      set(rumbleGain.gain, (0.09 + 0.25 * G) * WIND, 0.5);
      // (the howl: its pitch wanders on its own, slowly, and climbs with the gust; louder in it)
      for (const [k, H] of howls.entries()) {
        const wob = Math.sin(t * (0.11 + 0.07 * k) + H.drift) * 0.6 + Math.sin(t * (0.037 + 0.02 * k) + H.drift * 2) * 0.4;
        set(H.bp.frequency, H.f * (1 + 0.12 * wob + 0.45 * G), 0.6);
        const lvl = (0.55 + 0.3 * (0.5 + 0.5 * wob)) * (1 + 3.2 * G) * WIND * 0.8;          // (a narrow band lets little through: hence the gain)
        set(H.g.gain, lvl, 0.6);
        set(H.depth.gain, lvl * 0.75, 0.6);
      }
      set(whooshGain.gain, 1.25 * S * WIND, 0.45);
      set(whoosh.frequency, 190 + 230 * S, 0.45);
      set(whoosh.Q, 0.9 - 0.3 * S, 0.45);
      set(hissGain.gain, 0.04 * S * WIND, 0.4);
      if (whooshPan.pan) set(whooshPan.pan, Math.max(-0.8, Math.min(0.8, (w.front - 0.5) * 1.6)) * Math.min(1, G * 2.5), 0.3);
      for (const L of leaves) {
        const a = (0.004 + 0.17 * near(L.at) + 0.045 * G) * (0.4 + 0.6 * WIND);
        set(L.g.gain, a, 0.25);
        set(L.depth.gain, a * 0.45, 0.25);
      }
    },
  };
}
