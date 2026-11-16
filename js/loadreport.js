// The load, measured on every visit: where the time under the loading picture goes, so the wait can be cut where it
// is spent and nowhere else. Kept in this browser (localStorage 'career-load-reports', the last five loads) and on
// window.__loadReport; nothing is sent anywhere.
//
//   stages   the walk's own timeline (walk.js tl): each stage's moment, and how long the page's thread had been held
//   network  every file the load fetched, by kind: how many, how many came from the browser's cache, the bytes that
//            came over the network, and the time the kind was being fetched (overlaps counted once)
//   work     the page's thread by job: models read (the GLTF parse, from asking to having), fronts' relief built,
//            furniture built, the frame's three parts (the scene's update, its own pictures, the draw) and what the
//            frame sent to the card (arrive.js) - while the picture was up
//   frames   under the picture: how many, the slowest, and how many took longer than a sixtieth, a tenth, a quarter
//   watched  how much of the wait the page was in front and focused (a window behind others runs a frame a second,
//            and the load goes at the frames' pace)
//   at lift  the page's memory, and the card's: its programs, textures, geometries, and one frame's draws

const T0 = performance.now();
try { performance.setResourceTimingBufferSize(50000); } catch { /* (the browser's own size) */ }

const R = { stages: [], work: {}, frames: { n: 0, over16: 0, over100: 0, over250: 0, slowest: [] }, watchedMs: 0, unwatchedMs: 0 };
let open = true, lastSeen = T0, wasWatched = watched();
function watched() { return document.visibilityState === 'visible' && document.hasFocus(); }
function seen() {
  const now = performance.now();
  if (open) { if (wasWatched) R.watchedMs += now - lastSeen; else R.unwatchedMs += now - lastSeen; }
  lastSeen = now; wasWatched = watched();
}
for (const ev of ['visibilitychange', 'focus', 'blur']) (ev === 'visibilitychange' ? document : window).addEventListener(ev, seen);

/** Time a job of `kind` on the page's thread: returns the function that ends it. */
export function span(kind) {
  const t = performance.now();
  return () => add(kind, performance.now() - t);
}
/** Run `fn` as a job of `kind`, timed. */
export function timed(kind, fn) {
  const end = span(kind);
  try { return fn(); } finally { end(); }
}
function add(kind, ms) {
  // (after the lift: each job longer than 30 ms, by the time since the lift - what a long task of the minute after was)
  if (!open) { if (AFTER && ms > 30 && !/waiting/.test(kind) && AFTER.spans.length < 300) AFTER.spans.push([Math.round(performance.now() - ms - AFTER.t0), kind, Math.round(ms)]); return; }
  const w = (R.work[kind] ??= { n: 0, ms: 0, max: 0 });
  w.n++; w.ms += ms; if (ms > w.max) w.max = ms;
}

/** A stage of the walk's timeline (walk.js tl): under the picture, and for a minute after it lifts. */
export function stage(label, busy) {
  if (open) R.stages.push([label, Math.round(performance.now() - T0), Math.round(busy)]);
  else if (AFTER) AFTER.stages.push([label, Math.round(performance.now() - AFTER.t0), Math.round(busy)]);
}

// ---- the minute after the picture lifts: what comes in behind the walk must not hold a frame up. Every task of the
// page's thread longer than 50 ms, and every frame longer than 50 ms with its parts (the scene's update, its own
// pictures, the draw, what it sent to the card), by the time since the lift; kept with the load's report.
let AFTER = null;
const longObs = (() => { try {
  const o = new PerformanceObserver((l) => { if (!AFTER) return; for (const e of l.getEntries()) if (e.startTime >= AFTER.t0 && AFTER.tasks.length < 200) AFTER.tasks.push([Math.round(e.startTime - AFTER.t0), Math.round(e.duration)]); });
  o.observe({ type: 'longtask' }); return o;
} catch { return null; } })();
/** A frame after the lift (walk.js renderAt): kept if it was long. */
export function frameAfter(update, pictures, draw, pump) {
  if (!AFTER) return;
  const now = performance.now(), ms = update + pictures + draw, gap = AFTER.last ? now - AFTER.last : 0;
  AFTER.last = now; AFTER.n++;
  if ((ms > 50 || gap > 80) && AFTER.frames.length < 200) AFTER.frames.push([Math.round(now - AFTER.t0), Math.round(gap), +ms.toFixed(1), +update.toFixed(1), +pictures.toFixed(1), +draw.toFixed(1), pump ? { ms: +pump.ms.toFixed(1), tex: pump.tex, texMs: +pump.texMs.toFixed(1), shown: pump.shown, geoMb: +(pump.geo / 1e6).toFixed(1), big: pump.big } : null]);
  if (now - AFTER.t0 > 60000) closeAfter();
}
function closeAfter() {
  if (!AFTER) return;
  const a = AFTER; AFTER = null;
  const rep = window.__loadReport;
  if (!rep) return;
  rep.after = { frames: a.n, long: a.frames, tasks: a.tasks, spans: a.spans, stages: a.stages, heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  try {
    const all = JSON.parse(localStorage.getItem('career-load-reports') || '[]');
    if (all.length && all[all.length - 1].at === rep.at) all[all.length - 1] = rep;
    localStorage.setItem('career-load-reports', JSON.stringify(all.slice(-5)));
  } catch { /* (window.__loadReport has it) */ }
  console.info('[load] the minute after', rep.after);
}

/** A frame under the picture: its scene update, its own pictures, its draw, and what it sent to the card (arrive.js). */
export function frame(update, pictures, draw, pump) {
  if (!open) return;
  add('frame: scene update', update); add('frame: own pictures', pictures); add('frame: draw', draw);
  if (pump?.ms) add('frame: sent to the card', pump.ms);
  if (pump?.texMs) add('frame: pictures to the card', pump.texMs);
  const ms = update + pictures + draw, F = R.frames;
  F.n++;
  if (ms > 16.7) F.over16++;
  if (ms > 100) F.over100++;
  if (ms > 250) F.over250++;
  if (F.slowest.length < 8 || ms > F.slowest[F.slowest.length - 1][1]) {
    F.slowest.push([Math.round(performance.now() - T0), +ms.toFixed(1), +update.toFixed(1), +pictures.toFixed(1), +draw.toFixed(1)]);
    F.slowest.sort((a, b) => b[1] - a[1]); F.slowest.length = Math.min(8, F.slowest.length);
  }
}

function kindOf(url) {
  const p = url.split('?')[0];
  if (/-tiles\//.test(p)) return 'city tiles';
  if (/-relief\//.test(p)) return 'fronts relief';
  if (/\/tex\/|\.(jpe?g|png|webp|ktx2)$/.test(p)) return 'pictures';
  if (/\.glb$/.test(p)) return 'models';
  if (/\.(json|bin)$/.test(p)) return 'data';
  if (/\.(m?js|wasm)$/.test(p)) return 'code';
  return 'other';
}
function wall(spans) {
  spans.sort((a, b) => a[0] - b[0]);
  let sum = 0, s = -1, e = -1;
  for (const [a, b] of spans) { if (a > e) { if (e > s) sum += e - s; s = a; e = b; } else e = Math.max(e, b); }
  if (e > s) sum += e - s;
  return sum;
}
function network(until) {
  const out = {}, all = [];
  for (const r of performance.getEntriesByType('resource')) {
    if (r.startTime > until) continue;
    const k = kindOf(r.name), o = (out[k] ??= { n: 0, cached: 0, mb: 0, bodyMb: 0, spans: [] });
    o.n++;
    if (r.transferSize === 0 && r.decodedBodySize > 0) o.cached++;
    o.mb += r.transferSize / 1e6; o.bodyMb += r.decodedBodySize / 1e6;
    o.spans.push([r.startTime, r.responseEnd]); all.push([r.startTime, r.responseEnd]);
  }
  for (const o of Object.values(out)) { o.s = +(wall(o.spans) / 1000).toFixed(1); delete o.spans; o.mb = +o.mb.toFixed(1); o.bodyMb = +o.bodyMb.toFixed(1); }
  return { byKind: out, s: +(wall(all) / 1000).toFixed(1) };
}

/** The picture has lifted: the report made and kept. `extra`: the tier, the card's counts, anything the walk knows. */
export function finish(extra = {}) {
  if (!open) return null;
  seen(); open = false;
  const now = performance.now();
  const rep = {
    at: new Date().toISOString(), page: location.pathname + location.search,
    liftS: +((now - T0) / 1000).toFixed(1),
    watchedS: +(R.watchedMs / 1000).toFixed(1), unwatchedS: +(R.unwatchedMs / 1000).toFixed(1),
    network: network(now),
    work: Object.fromEntries(Object.entries(R.work).sort((a, b) => b[1].ms - a[1].ms)
      .map(([k, w]) => [k, { s: +(w.ms / 1000).toFixed(2), n: w.n, maxMs: +w.max.toFixed(1) }])),
    frames: R.frames, stages: R.stages,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    ...extra,
  };
  window.__loadReport = rep;
  AFTER = { t0: now, last: 0, n: 0, frames: [], tasks: [], spans: [], stages: [] };
  try {
    const all = JSON.parse(localStorage.getItem('career-load-reports') || '[]');
    all.push(rep);
    localStorage.setItem('career-load-reports', JSON.stringify(all.slice(-5)));
  } catch { /* (not kept: the page reads window.__loadReport) */ }
  console.info('[load] report', rep);
  return rep;
}
