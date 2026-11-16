// The host now and then fails to send a file the page asks for: GitHub Pages answered one model with 503 just after a
// deploy (16 Nov 2026), and the page, asking once, went on without it - Moscow's embankments missing until the next
// load. Every file the page and its workers ask this site for is asked for again when the failure is one that passes:
// no answer at all, or 408, 425, 429, 500, 502, 503, 504. Again after half a second, then 1.5, 4 and 8 s - each a
// little at random, so the many files of one hiccup do not all come back at once; a Retry-After the host gives is kept,
// up to 30 s. A file the host says is not there (404) is not asked for again. The answer that comes is handed on as it
// came: what asked never sees the failures before it.
// A picture drawn from an image element (three's TextureLoader, the land's ground tiles, the loading picture) is asked
// for again the same way, by its own src: its element's error is held back while the host is asked, by a HEAD, whether
// the failure passes, and its decode() waits for the last try. Only when the tries are spent does its error go on.
// Each file asked for again is noted (globalThis.__askedAgain: its path, the first failure, the last answer, the
// tries, when): the load report keeps them.
// Imported first of all, before unpack.js, by the page and by each worker that fetches a file - a classic worker by
// importScripts, so nothing here is a module's own syntax.
(() => {
  if (globalThis.__asking || typeof globalThis.fetch !== 'function') return;
  globalThis.__asking = true;
  const WAIT = [500, 1500, 4000, 8000];
  const PASSES = new Set([408, 425, 429, 500, 502, 503, 504]);
  const asked = (globalThis.__askedAgain = []);
  const note = (url, first, last, tries) => {
    if (asked.length < 200) asked.push({ path: new URL(url).pathname, first, last, tries, s: +(performance.now() / 1000).toFixed(1) });
  };
  const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);
  const aborted = (signal) => signal?.reason ?? new DOMException('The ask was called off', 'AbortError');
  const pause = (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) { rej(aborted(signal)); return; }
    const stop = () => { clearTimeout(t); rej(aborted(signal)); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
  // (the host's own word on when to come back: seconds, or a date)
  const after = (res) => {
    const v = res.headers.get('retry-after');
    if (!v) return 0;
    const n = Number(v), ms = Number.isFinite(n) ? n * 1000 : Date.parse(v) - Date.now();
    return Number.isFinite(ms) ? Math.min(30000, Math.max(0, ms)) : 0;
  };
  const base = () => globalThis.document?.baseURI ?? globalThis.location.href;
  const ours = (u) => {
    try { const a = new URL(u, base()); return a.origin === globalThis.location.origin && /^https?:$/.test(a.protocol) ? a.href : null; } catch { return null; }
  };
  const raw = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function fetch(input, init) {
    const req = typeof input === 'string' || input instanceof URL ? null : input;
    const url = ours(req ? req.url : String(input));
    const method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();
    if (!url || (method !== 'GET' && method !== 'HEAD')) return raw(input, init);
    const signal = init?.signal ?? req?.signal;
    let first = null;
    for (let k = 0; ; k++) {
      let res = null, err = null;
      // (asked again past the browser's cache: what it holds is not the failure, but the next answer is kept there)
      try { res = await raw(input, k ? { ...init, cache: init?.cache ?? 'reload' } : init); } catch (e) { err = e; }
      if (err) {
        if (err.name === 'AbortError' || signal?.aborted || k >= WAIT.length) { if (k) note(url, first, 'no answer', k + 1); throw err; }
      } else if (!PASSES.has(res.status) || k >= WAIT.length) {
        if (k) note(url, first, res.status, k + 1);
        return res;
      }
      first ??= err ? 'no answer' : res.status;
      const wait = Math.max(jitter(WAIT[k]), res ? after(res) : 0);
      if (res?.body) res.body.cancel().catch(() => {});      // (the failure's own body let go)
      await pause(wait, signal);
    }
  };

  if (typeof HTMLImageElement !== 'function') return;
  const P = HTMLImageElement.prototype, SRC = Object.getOwnPropertyDescriptor(P, 'src'), decode = P.decode;
  if (!SRC?.set || !SRC.get) return;
  const asks = new WeakMap(), heard = new WeakSet();
  // (does the failure pass? the host asked for the file's status alone: 0 for no answer)
  const status = (url) => raw(url, { method: 'HEAD', cache: 'no-store' }).then((r) => r.status, () => 0);
  // (its error held back - this listener comes before any other of the element's, a capturing one at its target)
  function held(e) {
    const st = asks.get(this);
    if (!st) return;
    if (st.letting) { st.letting = false; return; }
    if (SRC.get.call(this) !== st.url) return;
    e.stopImmediatePropagation();
    const img = this, k = st.tries;
    status(st.url).then((s) => {
      if (asks.get(img) !== st || SRC.get.call(img) !== st.url) return;      // (its src changed meanwhile: that is its own load)
      // (the host sending it whole now: the failure has passed - but a picture that came whole and still would not
      // draw is not asked for a third time: the fault is its own)
      const whole = s >= 200 && s < 300, passes = s === 0 || PASSES.has(s) || (whole && !st.whole);
      if (passes && k < WAIT.length) {
        st.first ??= s || 'no answer'; st.tries++; st.whole ||= whole;
        setTimeout(() => { if (asks.get(img) === st) SRC.set.call(img, st.url); }, jitter(WAIT[k]));
        return;
      }
      if (k) note(st.url, st.first, s || 'no answer', k + 1);
      st.rej(new DOMException('The picture could not be had', 'EncodingError'));
      st.letting = true;
      img.dispatchEvent(new Event('error'));
    });
  }
  function came() {
    const st = asks.get(this);
    if (!st || SRC.get.call(this) !== st.url) return;
    if (st.tries) note(st.url, st.first, 'whole', st.tries + 1);
    st.res();
  }
  Object.defineProperty(P, 'src', {
    configurable: true, enumerable: SRC.enumerable,
    get() { return SRC.get.call(this); },
    set(v) {
      const url = ours(String(v));
      // (a new src: whatever waited on the last one is told it will not come, as the browser's own decode() is)
      asks.get(this)?.rej(new DOMException('The picture was changed for another', 'EncodingError'));
      if (url) {
        if (!heard.has(this)) { heard.add(this); this.addEventListener('error', held, true); this.addEventListener('load', came, true); }
        const st = { url, tries: 0, first: null, whole: false, letting: false, over: false };
        st.done = new Promise((res, rej) => {
          st.res = () => { if (!st.over) { st.over = true; res(); } };
          st.rej = (e) => { if (!st.over) { st.over = true; rej(e); } };
        });
        st.done.catch(() => {});                       // (no one waiting on it: no complaint)
        asks.set(this, st);
      } else asks.delete(this);
      SRC.set.call(this, v);
    },
  });
  // (decode() waits for the last try, then decodes what came)
  if (typeof decode === 'function') P.decode = function () { const st = asks.get(this); return st ? st.done.then(() => decode.call(this)) : decode.call(this); };
})();
