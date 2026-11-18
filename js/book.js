// The book the walker carries: an 1830s travelling quarto, modelled at its real size in Blender (dev\book\book_kit.py:
// assets/book/book.glb), held up from below in one gloved right hand, the thumb in the crease and the palm behind the
// spine: the hand drawn by Z-Image Turbo over the depth of a photograph of that hold, made into a model by TRELLIS.2,
// cut from the book it held and set on this one in Blender (dev\book\hands\hands_fit.py: hands.glb, its pictures its
// own); the book's leather, paper, gilt and silk from ComfyUI's tiles (assets/book/*.jpg). It is drawn into the
// scene's own picture after the land (countryside.js prerender: viewmodel), in a sliver of the depth nearest the eye,
// so it is always in front and every look (hardware.js STYLES) draws it as it draws everything else; it stands in the
// world itself, in front of the eye, so the sun and the shadows of the trees and the houses fall on it as they fall on
// the land.
// Held low at the right as the walker goes; right click brings it up before the face, the right page the places
// (assets/book/places.json: dev\book\places.py; places that stand close together are one line), the left the graphics
// (as the menu's); a printer's hand moves over them with the mouse (on a place it stands in the margin, pointing at its
// name); a click on a place sets the leaves turning fast while the walker is carried there, until the place is in;
// then they stop on the same two pages. Right click again lowers it. On a touch screen a tap on the book raises it, a
// tap on a line chooses it, a tap off the book lowers it.
import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { capImage } from './texcap.js';
import { receiveSun } from './backdrops/sunshadow.js';
import { DEPTH, towardCamera } from './depthmode.js';
import { loadFonts, drawPlaces, drawGraphics, drawText, TEXTS, PAGE, hit } from './bookpages.js';

const RAISE = 0.45, LOWER = 0.40;                  // s: up to the face, back down
const FLIP = { dur: 0.42, every: 0.075, min: 1.2, max: 12 };     // s: one leaf's turn, one after another, the least and most
const VERST = 1066.8;
const ease = (t) => t * t * (3 - 2 * t);
const TIP = [0.99, 0.056];                           // (the manicule's fingertip in its picture, from its top left)

export function makeBook(o) {
  const { s, base = '', coarse = false } = o;
  const scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = true;
  const cam = new THREE.PerspectiveCamera();
  const root = new THREE.Group(); root.matrixAutoUpdate = false; scene.add(root);      // (the book in the world, in front of the eye)
  const book = new THREE.Group(); root.add(book);    // (the book's own frame: x across, y off the pages, z toward the tail)
  const sun = new THREE.DirectionalLight('#ffffff', 2); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#c2cdd8', '#98a05e', 1.35); scene.add(hemi);
  const fill = new THREE.DirectionalLight('#fff4e6', 0.5); scene.add(fill, fill.target);     // (from over the reader's shoulder)
  const st = { up: 0, goal: 0, flip: null, cursor: new THREE.Vector2(0.25, -0.15), hover: { l: null, r: null }, ready: false,
    bob: 0, swayY: 0, swayP: 0, lastYaw: null, lastPitch: null, shown: true, distAt: null, travelling: null };
  const T = {};                                     // the pictures
  const P = {};                                     // the pages: canvases, textures, boxes
  let J = null, places = [], parts = {}, leaves = [], cursor = null, vignette = null, env = null;
  const cuff = [];                                   // (the cuff's end: fitUp keeps it below the window's foot)

  // ---- the pictures: each tile at its real size (the model's coordinates are in tiles already)
  const tex = (name, srgb = true) => new Promise((res) => new THREE.TextureLoader().load(base + 'assets/book/' + name, (t) => {
    capImage(t); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t);
  }, undefined, () => res(null)));

  // ---- a page's canvas: the size the look needs (a picture of 240 lines or fewer: coarse, as its own pixels)
  const pageW = o.pageW ?? 1536, pageH = Math.round(pageW * PAGE.h / PAGE.w);
  function canvasTex(w = pageW, h = pageH) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
    return { c, g: c.getContext('2d'), t };
  }

  async function load() {
    const [gl, hands, places_, ...pics] = await Promise.all([
      new Promise((res, rej) => gltfLoader().load(base + 'assets/book/book.glb', res, undefined, rej)),
      new Promise((res) => gltfLoader().load(base + 'assets/book/hands.glb', res, undefined, () => res(null))),
      fetch(base + 'assets/book/places.json').then((r) => r.json()).catch(() => ({ places: [] })),
      tex('morocco.jpg'), tex('morocco_n.jpg', false), tex('gilt-edge.jpg'), tex('gilt-edge_n.jpg', false), tex('paper.jpg'), tex('paper_n.jpg', false),
      tex('silk.jpg'),
      tex('cursor.png'), new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + 'assets/book/vignette.png'; }),
      fetch(base + 'assets/book/book.json').then((r) => r.json()).catch(() => null),
      loadFonts(base),
    ]);
    [T.morocco, T.moroccoN, T.gilt, T.giltN, T.paper, T.paperN, T.silk, T.cursor, vignette, J] = pics;
    places = places_.places || [];
    env = o.environment?.() ?? null;
    // the materials, by the parts' names (book_kit.py)
    const std = (p) => receiveSun(new THREE.MeshStandardMaterial(p), s.U);
    const M = {
      leather: std({ map: T.morocco, normalMap: T.moroccoN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.46, color: '#ffffff' }),
      gilt: std({ color: '#e0b062', metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 1.1 }),
      edge: std({ map: T.gilt, normalMap: T.giltN, normalScale: new THREE.Vector2(0.5, 0.5), metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 1.0 }),
      headband: std({ map: stripes(), roughness: 0.55 }),
      ribbon: std({ map: T.silk, roughness: 0.42, side: THREE.DoubleSide }),
    };
    const pageMat = () => std({ map: null, normalMap: T.paperN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9 });
    if (T.paperN) { T.paperN.repeat.set(PAGE.w / 74, PAGE.h / 74); }
    gl.scene.traverse((m) => {
      if (!m.isMesh) return;
      const n = m.name.replace(/[-_.]\d+$/, '');
      parts[n] = m; m.frustumCulled = false;
      m.material = n.startsWith('page') ? pageMat() : n.startsWith('board') || n === 'spine' ? M.leather : n.startsWith('gilt') ? M.gilt
        : n.startsWith('block') ? M.edge : n.startsWith('headband') ? M.headband : n.startsWith('ribbon') ? M.ribbon : m.material;
    });
    book.add(gl.scene);
    // the hand (hand-r): its own pictures - colour, relief, roughness and shade - on the walk's material
    if (hands) hands.scene.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.material;
      m.frustumCulled = false;
      m.material = std({ map: g.map, normalMap: g.normalMap, normalScale: g.normalScale?.clone(), roughnessMap: g.roughnessMap,
        roughness: g.roughnessMap ? 1 : 0.6, metalness: 0, aoMap: g.aoMap, aoMapIntensity: g.aoMap ? 1 : 0 });
      parts[m.name] = m;
    });
    if (parts['hand-r']) {
      book.add(parts['hand-r']);
      // (the glove's cuff ends where its picture ended: that end is kept out of view - fitUp; its outermost points, in
      // the book's frame)
      const h = parts['hand-r'], pos = h.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
      h.updateMatrix(); let zmax = -Infinity;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(h.matrix); zmax = Math.max(zmax, v.z); }
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(h.matrix); if (v.z > zmax - 0.012) pts.push(v.clone()); }
      for (const k of ['x', 'y']) for (const f of [Math.min, Math.max]) { const e = pts.reduce((a, q) => (f(a[k], q[k]) === q[k] ? q : a)); cuff.push(e); }
    }
    // the ribbon's end swings from its own top (book.json ribbonTail)
    if (parts['ribbon-tail'] && J?.ribbonTail) {
      const r = parts['ribbon-tail'], pivot = new THREE.Group(); pivot.position.fromArray(J.ribbonTail);
      book.add(pivot); r.position.sub(pivot.position); pivot.add(r); parts.ribbonPivot = pivot;
    }
    // the pages
    P.r = canvasTex(); P.l = canvasTex();
    const gw = Math.min(pageW, 1024), gh = Math.round(gw * PAGE.h / PAGE.w);
    P.text = TEXTS.map((t, i) => { const c = canvasTex(gw, gh); drawText(c.g, gw, gh, t, i % 2 ? 'recto' : 'verso', { tile: T.paper?.image, coarse }); c.t.needsUpdate = true; return c; });
    parts['page-r'].material.map = P.r.t; parts['page-l'].material.map = P.l.t;
    parts['page-r'].material.needsUpdate = parts['page-l'].material.needsUpdate = true;
    drawRight(); drawLeft();
    // the turning leaves: the right page's own curve (book.json profile), both its sides printed
    if (J?.profile) for (let i = 0; i < 8; i++) leaves.push(makeLeaf());
    // the cursor: the manicule's ink lying on the paper, its fingertip the point
    if (T.cursor) {
      T.cursor.wrapS = T.cursor.wrapT = THREE.ClampToEdgeWrapping;
      const w = coarse ? 0.052 : 0.036, h = w * T.cursor.image.height / T.cursor.image.width;
      const g = new THREE.PlaneGeometry(w, h); g.translate(-w / 2 + w * (1 - TIP[0]), -h / 2 + h * TIP[1], 0);
      cursor = new THREE.Mesh(g, std({ map: T.cursor, transparent: true, alphaTest: 0.02, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: towardCamera(-2), polygonOffsetUnits: towardCamera(-4) }));
      cursor.frustumCulled = false; cursor.renderOrder = 5; cursor.visible = false; scene.add(cursor);
    }
    st.ready = true;
  }

  function stripes() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16; const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) { g.fillStyle = (x >> 2) % 2 ? '#c9b38a' : '#6c0a0c'; g.fillRect(x, 0, 1, 16); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 64, 3);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  // ---- the two pages, drawn again when what they show changes
  function dists() {
    const at = s.at; return places.map((p) => ({ ...p, dist: Math.hypot(p.at[0] - at.x, p.at[1] - at.z) }));
  }
  // (on a place the printer's hand is printed in the margin before it, pointing at it: its fingertip short of the name)
  function drawRight(hover = st.hover.r, hand = !!hover && !st.flip && !o.touch) {
    if (!P.r) return;
    const H = hand && T.cursor ? { img: T.cursor.image, w: (coarse ? 0.052 : 0.036) * 1000, tip: TIP } : null;
    P.boxR = drawPlaces(P.r.g, pageW, pageH, { places: dists(), hover, hand: H }, { tile: T.paper?.image, coarse });
    P.r.t.needsUpdate = true; st.distAt = { x: s.at.x, z: s.at.z };
  }
  function drawLeft() {
    if (!P.l) return;
    P.boxL = drawGraphics(P.l.g, pageW, pageH, { choices: o.choices, now: o.now, mine: o.mine, hover: st.hover.l, vignette }, { tile: T.paper?.image, coarse });
    P.l.t.needsUpdate = true;
  }

  // ---- a leaf: the right page's curve, turned over the fold to lie on the left page; its root goes first and its
  // edge follows behind, as a leaf let go of runs
  function makeLeaf() {
    const prof = J.profile, n = prof.length, rows = 7, H = J.H;
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * rows * 3), uv = new Float32Array(n * rows * 2), idx = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) { const k = j * n + i; uv[k * 2] = prof[i][2] / J.L; uv[k * 2 + 1] = j / (rows - 1); }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n; idx.push(a, d, b, b, d, c); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    // (each side its own page: the front as the right page reads, the back flipped across, as the left reads)
    const mk = (side) => receiveSun(new THREE.MeshStandardMaterial({ side, roughness: 0.9, normalMap: T.paperN, normalScale: new THREE.Vector2(0.3, 0.3),
      polygonOffset: true, polygonOffsetFactor: towardCamera(-1), polygonOffsetUnits: towardCamera(-2) }), s.U);
    const front = new THREE.Mesh(g, mk(THREE.FrontSide)), back = new THREE.Mesh(g, mk(THREE.BackSide));
    front.frustumCulled = back.frustumCulled = false; front.visible = back.visible = false;
    book.add(front, back);
    // (the angle along the right page's leaf at each point, for the turn)
    const ang = prof.map((p, i) => { const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); });
    return { g, pos, front, back, ang, n, rows, H, t0: 0, on: false };
  }
  function shapeLeaf(L, p) {
    // (riffled, as a thumb lets the leaves go at the fore-edge: each leaf's edge turns first and its root last, so it
    // rolls over the fold in a wave a few centimetres high, the corner at the foot a little ahead of the head's)
    const prof = J.profile, n = L.n, lam = 1.6, x = L.x ??= new Float32Array(n), y = L.y ??= new Float32Array(n);
    for (let j = 0; j < L.rows; j++) {
      const pj = Math.min(1, Math.max(0, p + 0.07 * (j / (L.rows - 1) - 0.5) * Math.sin(Math.PI * p) * 2));
      x[0] = prof[0][0]; y[0] = prof[0][1];
      for (let i = 1; i < n; i++) {
        const sf = prof[i][2] / J.L, ds = prof[i][2] - prof[i - 1][2];
        const b = ease(Math.min(1, Math.max(0, pj * (1 + lam) - lam * (1 - sf))));
        const a0 = L.ang[i], a = a0 + (Math.PI - 2 * a0) * b;
        x[i] = x[i - 1] + Math.cos(a) * ds; y[i] = y[i - 1] + Math.sin(a) * ds;
      }
      const z = -L.H / 2 + L.H * j / (L.rows - 1), lift = 0.0005 + 0.002 * Math.sin(Math.PI * pj);
      for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; L.pos[k] = x[i]; L.pos[k + 1] = y[i] + lift * Math.min(1, i / 12); L.pos[k + 2] = z; }
    }
    L.g.attributes.position.needsUpdate = true; L.g.computeVertexNormals();
  }

  // ---- the turning of the leaves: each leaf takes the right page's top sheet over to the left; the page under it is
  // the next of the guide's; the last leaf's back is the graphics page and under it again the places
  let nextText = 0;
  const pickText = () => P.text[(nextText++) % P.text.length].t;
  function startFlip() {
    st.flip = { t: 0, launched: 0, last: false, stop: false, done: false, wait: 0, landed: 0, lastLaunched: false };
    const was = st.hover.r;
    st.hover.l = st.hover.r = null; if (cursor) cursor.visible = false;
    if (was) drawRight(was, false);                    // (the place chosen stays red as the leaves turn; the hand goes)
  }
  function stepFlip(dt) {
    const F = st.flip; if (!F) return;
    F.t += dt;
    const done = o.isIn?.() ?? true;
    if (!F.stop && F.t > FLIP.min && done) F.wait += dt; else if (!done) F.wait = 0;
    if (!F.stop && (F.wait > 0.35 || F.t > FLIP.max)) F.stop = true;
    // (a new leaf every so often, until the last one has gone)
    while (!F.lastLaunched && F.t >= F.launched * FLIP.every) {
      const L = leaves.find((x) => !x.on); if (!L) break;
      const last = F.stop;
      L.on = true; L.t0 = F.launched * FLIP.every; L.last = last;
      L.front.material.map = parts['page-r'].material.map; L.front.material.needsUpdate = true;
      const back = last ? P.l.t : pickText();
      L.back.material.map = flipped(back); L.back.material.needsUpdate = true; L.backTex = back;
      parts['page-r'].material.map = last ? P.r.t : pickText(); parts['page-r'].material.needsUpdate = true;
      L.front.visible = L.back.visible = true;
      F.launched++; if (last) F.lastLaunched = true;
    }
    for (const L of leaves) {
      if (!L.on) continue;
      const p = Math.min(1, (F.t - L.t0) / FLIP.dur);
      shapeLeaf(L, p);
      if (p >= 1) {
        L.on = false; L.front.visible = L.back.visible = false;
        parts['page-l'].material.map = L.backTex; parts['page-l'].material.needsUpdate = true;
        if (L.last) { F.done = true; }
      }
    }
    if (F.done && !leaves.some((x) => x.on)) { st.flip = null; drawRight(); o.onArrived?.(); }
  }
  // (a page's picture as the back of a leaf reads it: across the other way)
  const backs = new Map();
  function flipped(t) {
    let b = backs.get(t);
    if (!b) { b = t.clone(); b.repeat.x = -1; b.offset.x = 1; b.needsUpdate = true; b.source = t.source; backs.set(t, b); }
    return b;
  }

  // ---- where the book is held: low at the right (0) or up before the face (1), in the eye's frame
  const POSE = {
    idle: { p: new THREE.Vector3(0.155, -0.235, -0.40), r: new THREE.Euler(1.02, -0.30, -0.20, 'YXZ') },
    up: { p: new THREE.Vector3(0, -0.012, -0.36), r: new THREE.Euler(1.36, 0, 0, 'YXZ') },
  };
  const qI = new THREE.Quaternion().setFromEuler(POSE.idle.r), qU = new THREE.Quaternion().setFromEuler(POSE.up.r);
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpP = new THREE.Vector3(), M = new THREE.Matrix4(), S1 = new THREE.Vector3(1, 1, 1);
  const tmpC = new THREE.Vector3();
  function fitUp() {
    // (the spread and the hand under it in view whatever the window's shape: as far off as it must be, no nearer than
    // 0.32 m)
    const B = s.base; if (!B) return;
    const tx = (B.x1 - B.x0) / 2, ty = (B.y0 - B.y1) / 2;
    const d = Math.max(0.32, 0.262 / tx, 0.165 / ty);
    POSE.up.p.set((B.x0 + B.x1) / 2 * d, (B.y0 + B.y1) / 2 * d + 0.004, -d);
    // (a window taller than it is wide shows more under the book: then it goes lower, till the cuff's end is under
    // the window's foot)
    for (const c of cuff) {
      tmpC.copy(c).applyQuaternion(qU);
      POSE.up.p.y = Math.min(POSE.up.p.y, B.y1 * (d - tmpC.z) - tmpC.y - 0.006);
    }
  }
  function place(dt) {
    const k = ease(st.up);
    tmpP.lerpVectors(POSE.idle.p, POSE.up.p, k);
    tmpP.y += Math.sin(Math.PI * k) * 0.03;                     // (lifted in an arc, not slid)
    tmpQ.slerpQuaternions(qI, qU, k);
    // (it goes with the walk: a little bob with each stride, a lag when the view turns)
    const L = s.look;
    if (st.lastYaw !== null && dt > 0) {
      st.swayY += (-(L.yaw - st.lastYaw) * 0.35 - st.swayY) * Math.min(1, dt * 10);
      st.swayP += (-(L.pitch - st.lastPitch) * 0.35 - st.swayP) * Math.min(1, dt * 10);
    }
    st.lastYaw = L.yaw; st.lastPitch = L.pitch;
    const sp = o.speed?.() ?? 0; st.bob += dt * sp * 1.6;
    const bobA = Math.min(1, sp / 5) * (1 - 0.7 * k);
    tmpP.x += Math.sin(st.bob) * 0.004 * bobA + st.swayY * 0.05; tmpP.y += Math.abs(Math.cos(st.bob)) * 0.006 * bobA + st.swayP * 0.05;
    M.compose(tmpP, tmpQ, S1);
    root.matrix.multiplyMatrices(s.cam.matrixWorld, M); root.matrixWorldNeedsUpdate = true;
    // the ribbon's end hangs toward the ground
    if (parts.ribbonPivot) {
      // (world down, in the book's own frame: the end swings about the book's width, from hanging toward the tail)
      root.updateMatrixWorld(true);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(book.getWorldQuaternion(tmpQ2).invert());
      const want = THREE.MathUtils.clamp(Math.atan2(-down.y, down.z), -0.25, 1.5), piv = parts.ribbonPivot;
      piv.rotation.x += (want - piv.rotation.x) * Math.min(1, dt * 6);
    }
  }

  // ---- the eye that draws it: where the scene's camera is, its lens unzoomed
  function aim() {
    cam.position.copy(s.cam.position); cam.quaternion.copy(s.cam.quaternion);
    const B = s.base, n = 0.05, f = 4;
    if (B) cam.projectionMatrix.makePerspective(B.x0 * n, B.x1 * n, B.y0 * n, B.y1 * n, n, f);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);
    // (the land's own light: its sun and its sky)
    const ls = s.land.children.find((x) => x.isDirectionalLight), lh = s.land.children.find((x) => x.isHemisphereLight);
    if (ls) { sun.color.copy(ls.color); sun.intensity = ls.intensity; }
    if (lh) { hemi.color.copy(lh.color); hemi.groundColor.copy(lh.groundColor); hemi.intensity = lh.intensity; }
    const at = new THREE.Vector3().setFromMatrixPosition(root.matrix);
    sun.target.position.copy(at); sun.position.copy(at).addScaledVector(s.U.uSunDir.value, 10);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    // (the fill from behind the eye and above it, as much as the sky's own light gives)
    fill.intensity = 0.35 * (hemi.intensity / 1.35); fill.target.position.copy(at);
    fill.position.copy(cam.position).add(new THREE.Vector3(0.15, 0.4, 0).applyQuaternion(cam.quaternion)); fill.updateMatrixWorld(); fill.target.updateMatrixWorld();
  }

  // ---- the cursor: where it points on the screen (-1..1 each way), the page and the line under it
  const ray = new THREE.Raycaster();
  function underCursor() {
    if (!parts['page-r']) return null;
    ray.setFromCamera(st.cursor, cam);
    const h = ray.intersectObjects([parts['page-l'], parts['page-r']], false)[0];
    if (!h) return null;
    const side = h.object === parts['page-r'] ? 'r' : 'l';
    return { side, h, x: h.uv.x * PAGE.w, y: h.uv.y * PAGE.h };
  }
  function hover() {
    const u = st.up >= 1 && !st.flip ? underCursor() : null;
    const r = u?.side === 'r' ? hit(P.boxR, u.x, u.y) : null, l = u?.side === 'l' ? hit(P.boxL, u.x, u.y) : null;
    if (r !== st.hover.r) { st.hover.r = r; drawRight(); }
    if (l !== st.hover.l) { st.hover.l = l; drawLeft(); }
    if (cursor) {
      cursor.visible = !!u && !o.touch && !r;            // (on a place, the hand is in the page's margin: drawRight)
      if (u) {
        const n = u.h.face.normal.clone().transformDirection(u.h.object.matrixWorld);
        const across = new THREE.Vector3(1, 0, 0).transformDirection(book.matrixWorld);
        across.addScaledVector(n, -across.dot(n)).normalize();
        const upv = new THREE.Vector3().crossVectors(n, across);
        cursor.matrix.makeBasis(across, upv, n).setPosition(u.h.point.clone().addScaledVector(n, 0.0003));
        cursor.matrixAutoUpdate = false; cursor.matrixWorldNeedsUpdate = true;
      }
    }
    return u;
  }

  // ---- what the walk calls
  const api = {
    ready: load().catch((e) => { console.warn('[book]', e); }),
    get loaded() { return st.ready; },
    get up() { return st.goal === 1; },
    get flipping() { return !!st.flip; },
    get state() { return { up: st.up, goal: st.goal, flipping: !!st.flip, hover: { ...st.hover }, cursor: st.cursor.toArray() }; },
    /** (dev: whether the free cursor is drawn - off the list - or not: on a place its hand is in the page's margin) */
    get cursorShown() { return !!cursor?.visible; },
    toggle() { if (!st.ready || st.flip) return; st.goal = st.goal ? 0 : 1; if (st.goal) { st.cursor.set(0.25, -0.2); drawRight(); } else if (cursor) cursor.visible = false; },
    raise() { if (st.goal !== 1) api.toggle(); },
    lower() { if (st.goal !== 0) api.toggle(); },
    /** the mouse moved while held (pixels): the cursor moves over the pages */
    moveBy(dx, dy) {
      if (st.goal !== 1) return;
      const w = o.canvas.clientWidth || innerWidth, h = o.canvas.clientHeight || innerHeight;
      st.cursor.x = THREE.MathUtils.clamp(st.cursor.x + dx * 2 / w, -0.98, 0.98); st.cursor.y = THREE.MathUtils.clamp(st.cursor.y - dy * 2 / h, -0.98, 0.98);
    },
    /** the cursor to a point of the window (a free mouse, a finger) */
    pointAt(cx, cy) {
      const r = o.canvas.getBoundingClientRect();
      st.cursor.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    },
    /** a click: the line under the cursor chosen. Returns what was chosen, or null */
    click() {
      if (st.up < 1 || st.flip) return null;
      const u = underCursor(); if (!u) return null;
      if (u.side === 'r') {
        const id = hit(P.boxR, u.x, u.y), p = places.find((q) => q.id === id);
        if (!p) return null;
        startFlip(); o.onTravel?.(p); return { place: id };
      }
      const id = hit(P.boxL, u.x, u.y);
      if (id && id !== o.now) { o.onChoose?.(id); return { look: id }; }
      return null;
    },
    /** travel there now (tests): the leaves turn as for a click */
    travel(id) { const p = places.find((q) => q.id === id); if (!p || st.flip) return false; if (st.goal !== 1) { st.goal = 1; st.up = 1; } startFlip(); o.onTravel?.(p); return true; },
    /** whether a point of the window is on the book (a tap on it raises it) */
    onBook(cx, cy) {
      if (!st.ready) return false;
      const r = o.canvas.getBoundingClientRect(), v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, cam); return ray.intersectObject(book, true).length > 0;
    },
    get places() { return places; },
    /** (dev: a pose tried, in the eye's frame: position, Euler YXZ) */
    pose(name, p, r) { POSE[name].p.set(...p); POSE[name].r.set(...r, 'YXZ'); (name === 'idle' ? qI : qU).setFromEuler(POSE[name].r); },
    /** (dev: a pose by its axes: the book's width toward a, its head toward h, the point g of the book at G) */
    poseAxes(name, a, h, g, G) {
      const A = new THREE.Vector3(...a).normalize(), Hh = new THREE.Vector3(...h); Hh.addScaledVector(A, -Hh.dot(A)).normalize();
      const Zb = Hh.clone().negate(), Yb = new THREE.Vector3().crossVectors(Zb, A);
      const m = new THREE.Matrix4().makeBasis(A, Yb, Zb), q = new THREE.Quaternion().setFromRotationMatrix(m);
      const at = new THREE.Vector3(...G).sub(new THREE.Vector3(...g).applyQuaternion(q));
      POSE[name].p.copy(at); POSE[name].r.setFromQuaternion(q, 'YXZ'); (name === 'idle' ? qI : qU).copy(q);
      return { p: at.toArray().map((v) => +v.toFixed(4)), r: [POSE[name].r.x, POSE[name].r.y, POSE[name].r.z].map((v) => +v.toFixed(4)) };
    },
    set up01(v) { st.up = st.goal = v; },
    show(on) { st.shown = !!on; },
    update(dt) {
      if (!st.ready) return;
      if (st.up !== st.goal) {
        const r = st.goal > st.up ? dt / RAISE : -dt / LOWER;
        st.up = THREE.MathUtils.clamp(st.up + r, 0, 1);
      }
      stepFlip(dt);
      // (the distances kept true while it is up: drawn again when the walker has gone 100 m)
      if (st.up >= 1 && !st.flip && st.distAt && Math.hypot(s.at.x - st.distAt.x, s.at.z - st.distAt.z) > 100) drawRight();
    },
    /** drawn into the scene's picture, nearest of all: countryside.js prerender */
    render(renderer, dt = 0) {
      if (!st.ready || !st.shown || !s.base) return;
      fitUp(); place(dt); aim(); hover();
      const gl = renderer.getContext(), rev = DEPTH.reversed;
      gl.depthRange(rev ? 0.982 : 0.0, rev ? 1.0 : 0.018);
      renderer.render(scene, cam);
      gl.depthRange(0, 1);
    },
  };
  return api;
}
