// A picture's one channel read off the page's own thread: fetched, decoded and drawn here, and the page handed its
// numbers. The cities' maps of where a house stands (cities/<city>-built.png, 2 m a pixel: 3,000 by 3,500 pixels and
// more) had each held the walk still for a tenth of a second as the cities came in (cityblocks.js).
// In: { url, channel (0 red .. 3 alpha) }. Out: { w, h, px: Uint8Array } or { error }.
self.onmessage = async (e) => {
  const { url, channel = 0 } = e.data;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data, px = new Uint8Array(bmp.width * bmp.height);
    for (let k = 0; k < px.length; k++) px[k] = d[k * 4 + channel];
    self.postMessage({ w: bmp.width, h: bmp.height, px }, [px.buffer]);
    bmp.close?.();
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
