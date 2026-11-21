// The controls, told at the start of every visit: a small pane of glass at the foot of the view, at the left, names the
// things to do - walk, the book, look closer, fly - and Esc, which lets the mouse go (and brings nothing up: 18 Nov
// 2026), and marks each as it is first done in the visit. When all have been done it fades. Nothing of it is kept from
// one visit to the next (19 Nov 2026: it had been kept in the browser - localStorage 'career-controls', cleared now -
// and once all had been done no visit after showed it); a change of look, which loads the walk again within the
// visit, carries what was done to the page it loads (carry: sessionStorage 'career-controls', read once). Not on a
// touch screen, whose ways are its own (a drag looks, a tap raises the book), and not in a still. ?controls: from the
// start, nothing carried.
const KEY = 'career-controls';
export const CONTROLS = [
  ['walk', ['W', 'A', 'S', 'D'], 'Walk'],
  ['book', ['Right click'], 'Open the book of places'],
  ['zoom', ['Scroll'], 'Look closer'],
  ['esc', ['Esc'], 'Release the cursor'],
];

/** The pane in `container`, hidden until show(true). fresh: from the start, nothing carried. */
export function makeControls({ container, fresh = false }) {
  let done = new Set();
  // (what a change of look carried here, read once; nothing from an earlier visit)
  try {
    const v = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
    const a = v && !fresh ? JSON.parse(v) : null;
    if (Array.isArray(a)) done = new Set(a.filter((id) => CONTROLS.some(([k]) => k === id)));
  } catch { /* (none carried) */ }
  try { localStorage.removeItem(KEY); } catch { /* (none kept) */ }
  const all = () => CONTROLS.every(([id]) => done.has(id));
  /** what has been done in this visit, carried to the page a change of look loads (walk.js choose) */
  const carry = () => { try { sessionStorage.setItem(KEY, JSON.stringify([...done])); } catch { /* (not carried) */ } };
  if (all()) {
    return { show() {}, used() {}, carry, get shown() { return false; }, get done() { return [...done]; } };
  }
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
  return {
    /** shown or not: not under the loading picture, nor while the book is up (walk.js, every frame) */
    show(on) { on = !!on; if (on === want) return; want = on; if (!gone) el.hidden = !want; },
    /** one of them done: its line marked; all of them, the pane fades away */
    used(id) {
      if (gone || done.has(id) || !CONTROLS.some(([k]) => k === id)) return;
      done.add(id);
      list.querySelector(`[data-k="${id}"]`)?.classList.add('is-done');
      if (all()) {
        gone = true;
        setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 900); }, 1400);
      }
    },
    carry,
    get shown() { return !gone && want; },
    get done() { return [...done]; },
  };
}
