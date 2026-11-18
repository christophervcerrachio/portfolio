// The controls, told once: on a visitor's first visits a small pane of the menu's glass at the foot of the view, at the
// left, names the four things to do - walk, the book, look closer, fly - and marks each as it is first done. When all
// four have been done it fades and is not shown again in this browser (localStorage 'career-controls': the ones done,
// kept as each is done, so a visit that ends halfway goes on where it left off). Not on a touch screen, whose ways are
// its own (a drag looks, a tap raises the book), and not in a still. ?controls shows it from the start and keeps nothing.
const KEY = 'career-controls';
export const CONTROLS = [
  ['walk', ['W', 'A', 'S', 'D'], 'Walk'],
  ['book', ['Right click'], 'Open the book of places'],
  ['zoom', ['Scroll'], 'Look closer'],
  ['fly', ['Z'], 'Fly free, and Z again to land'],
];

/** The pane in `container`, hidden until show(true). fresh: from the start, nothing kept. */
export function makeControls({ container, fresh = false }) {
  let done = new Set();
  if (!fresh) {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(v)) done = new Set(v); } catch { /* (none kept) */ }
  }
  const all = () => CONTROLS.every(([id]) => done.has(id));
  if (all()) return { show() {}, used() {}, get shown() { return false; }, get done() { return [...done]; } };
  const el = document.createElement('div');
  el.className = 'walk-keys'; el.hidden = true; el.setAttribute('role', 'note'); el.setAttribute('aria-label', 'Getting about');
  const head = document.createElement('p'); head.className = 'walk-keys-head'; head.textContent = 'Getting about';
  const list = document.createElement('ul');
  for (const [id, keys, what] of CONTROLS) {
    const li = document.createElement('li'); li.dataset.k = id; if (done.has(id)) li.classList.add('is-done');
    const caps = document.createElement('span'); caps.className = 'walk-keys-caps';
    for (const k of keys) { const kb = document.createElement('kbd'); kb.textContent = k; caps.appendChild(kb); }
    const w = document.createElement('span'); w.className = 'walk-keys-what'; w.textContent = what;
    li.append(caps, w); list.appendChild(li);
  }
  el.append(head, list);
  container.appendChild(el);
  let gone = false, want = false;
  const save = () => { if (!fresh) try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch { /* (not kept) */ } };
  return {
    /** shown or not: not under the loading picture, nor while the menu or the book is up (walk.js, every frame) */
    show(on) { on = !!on; if (on === want) return; want = on; if (!gone) el.hidden = !want; },
    /** one of the four done: its line marked; all four, the pane fades away */
    used(id) {
      if (gone || done.has(id) || !CONTROLS.some(([k]) => k === id)) return;
      done.add(id); save();
      list.querySelector(`[data-k="${id}"]`)?.classList.add('is-done');
      if (all()) {
        gone = true;
        setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 900); }, 1400);
      }
    },
    get shown() { return !gone && want; },
    get done() { return [...done]; },
  };
}
