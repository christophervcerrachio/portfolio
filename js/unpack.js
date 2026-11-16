// The site's models and data are kept gzipped where it is published (16 Nov 2026): GitHub Pages holds a site to 1 GB,
// and the cities' tiles alone were 706 MB as they were; packed, the whole site is about half. Each file keeps its own
// name. Every fetch of a model or a data file (a .glb, .json or .bin under assets/) looks at its first three bytes,
// and a gzip file (1f 8b 08) is unpacked on the way in by the browser's own DecompressionStream - the very bytes it held
// before it was packed. A file that is not packed (the working copy, served as it is) passes through untouched; none of
// the site's own begins so (post.py stops if one does).
// Imported right after again.js (which asks the host again when it fails to send a file), by the page and by each of
// its workers that fetches such a file: what comes here is the answer that came.
const PACKED = /\/assets\/.+\.(glb|json|bin)$/i;

if (!globalThis.__unpacking && typeof DecompressionStream === 'function' && typeof ReadableStream === 'function') {
  globalThis.__unpacking = true;
  const raw = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function fetch(input, init) {
    const res = await raw(input, init);
    let path;
    try { path = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, globalThis.location.href).pathname; } catch { return res; }
    if (!res.ok || !res.body || !PACKED.test(path)) return res;
    // (its first three bytes, read off its stream and put back in front of the rest)
    const reader = res.body.getReader();
    let head = new Uint8Array(0), done = false;
    while (head.length < 3 && !done) {
      const r = await reader.read();
      done = r.done;
      if (r.value?.length) { const h = new Uint8Array(head.length + r.value.length); h.set(head); h.set(r.value, head.length); head = h; }
    }
    const packed = head.length >= 3 && head[0] === 0x1f && head[1] === 0x8b && head[2] === 0x08;
    let body = new ReadableStream({
      start(c) { if (head.length) c.enqueue(head); if (done) c.close(); },
      async pull(c) { const r = await reader.read(); if (r.done) c.close(); else c.enqueue(r.value); },
      cancel(why) { return reader.cancel(why); },
    });
    if (packed) body = body.pipeThrough(new DecompressionStream('gzip'));
    const headers = new Headers(res.headers);
    // (its length unpacked is not the packed file's: a reader counting its progress against it is told nothing)
    if (packed) { headers.delete('content-length'); headers.delete('content-encoding'); }
    const out = new Response(body, { status: res.status, statusText: res.statusText, headers });
    try { Object.defineProperty(out, 'url', { value: res.url }); } catch { /* (its address unknown to it) */ }
    return out;
  };
}
