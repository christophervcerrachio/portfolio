// The book the walker carries: an 1830s travelling quarto, modelled at its real size in Blender (dev\book\book_kit.py:
// assets/book/book.glb), held up from below in one gloved right hand, the thumb in the crease and the palm behind the
// spine: the hand drawn by Z-Image Turbo over the depth of a photograph of that hold, made into a model by TRELLIS.2,
// cut from the book it held and set on this one in Blender (dev\book\hands\hands_fit.py: hands.glb, its pictures its
// own); the book's leather, paper, gilt and silk from ComfyUI's tiles (assets/book/*.jpg). It is drawn into the
// scene's own picture after the land (countryside.js prerender: viewmodel), in a sliver of the depth nearest the eye,
// so it is always in front; it stands in the world itself, in front of the eye, so the sun and the shadows of the trees
// and the houses fall on it as they fall on the land. The book itself at the screen's own resolution in every look
// (18 Nov 2026): its pictures full, its corners and textures as the full look draws them, and - where the scene's
// picture is smaller than the screen - drawn again over it at the screen's size (renderFull, bookover.js); the glove
// stays the look's own, drawn in the picture with everything else.
// Held low at the right as the walker goes; right click brings it up before the face, the right page the places
// (assets/book/places.json: dev\book\places.py; places that stand close together are one line), the left the plate leaf;
// a printer's hand moves over both pages with the mouse from the moment the book comes up, and the line under it is
// red - a place as a look (18 Nov 2026: the hand had stood in the margin before a place, and shown only once the book
// was all the way up). The hand is ink on the page it lies on: moved freely with the mouse, it is never drawn past that
// page's edges - off the page it goes under the edge, and farther off it is gone (19 Nov 2026: it had been drawn whole
// out over the book's edge and the land). A click on a place carries the walker there under the walk's own loading
// picture, in the look in force (walk.js travel); the book is lowered under it. Right click again lowers it. On a touch
// screen a tap on the book raises it, a tap on a line chooses it, a tap off the book lowers it.
import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { unstyled } from './retro.js';
import { receiveSun } from './backdrops/sunshadow.js';
import { DEPTH, towardCamera } from './depthmode.js';
import { loadFonts, drawPlaces, drawGraphics, PAGE, hit } from './bookpages.js';

const RAISE = 0.45, LOWER = 0.40;                  // s: up to the face, back down
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
  for (const l of [sun, hemi, fill]) l.layers.enableAll();   // (lighting the book's layer and the glove's alike: render)
  // (the book as depth alone, where it is drawn again at the screen's resolution over the picture: render)
  const DEPTH_ONLY = unstyled(new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  const clearTo = new THREE.Color();
  const st = { up: 0, goal: 0, cursor: new THREE.Vector2(0.25, -0.15), hover: { l: null, r: null }, ready: false,
    bob: 0, swayY: 0, swayP: 0, lastYaw: null, lastPitch: null, shown: true, distAt: null };
  const T = {};                                     // the pictures
  const P = {};                                     // the pages: canvases, textures, boxes
  let J = null, places = [], parts = {}, cursor = null, vignette = null, plate = null, env = null;
  // (the hand bound by the page it lies on: each page's edges in the book's frame - x across, z toward the tail; the page
  // carried on past its edges, unseen, where the hand goes on lying when the mouse leaves the page; and the edges of the
  // page it lies on, that nothing of it is drawn beyond, as its program reads them: hover, pageBound)
  const rect = {}, skirts = [], CLIP = { uBookInv: { value: new THREE.Matrix4() }, uPageRect: { value: new THREE.Vector4(-1, 1, -1, 1) } };
  const cuff = [];                                   // (the cuff's end: fitUp keeps it below the window's foot)

  // ---- the pictures: each tile at its real size (the model's coordinates are in tiles already)
  // (the book's pictures whatever the look: at their full size, filtered as the full look filters them - retro.js leaves a
  // picture marked keepFilter as it is - and at the card's own anisotropy, o.aniso)
  const full = (t) => { t.userData.keepFilter = true; t.anisotropy = o.aniso ?? THREE.Texture.DEFAULT_ANISOTROPY; return t; };
  const tex = (name, srgb = true) => new Promise((res) => new THREE.TextureLoader().load(base + 'assets/book/' + name, (t) => {
    full(t); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t);
  }, undefined, () => res(null)));

  // ---- a page's canvas: the size the look needs (a picture of 240 lines or fewer: coarse, as its own pixels)
  const pageW = o.pageW ?? 1536, pageH = Math.round(pageW * PAGE.h / PAGE.w);
  function canvasTex(w = pageW, h = pageH) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = full(new THREE.CanvasTexture(c)); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
    return { c, g: c.getContext('2d'), t };
  }

  async function load() {
    const [gl, hands, places_, ...pics] = await Promise.all([
      new Promise((res, rej) => gltfLoader().load(base + 'assets/book/book.glb', res, undefined, rej)),
      new Promise((res) => gltfLoader().load(base + 'assets/book/hands.glb', res, undefined, () => res(null))),
      fetch(base + 'assets/book/places.json').then((r) => r.json()).catch(() => ({ places: [] })),
      tex('morocco.jpg'), tex('morocco_n.jpg', false), tex('gilt-edge.jpg'), tex('gilt-edge_n.jpg', false), tex('paper.jpg'), tex('paper_n.jpg', false),
      tex('silk.jpg'),
      tex('cursor.png'), new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + 'assets/book/vignette.png'; }), new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + 'assets/book/plate.png'; }),
      fetch(base + 'assets/book/book.json').then((r) => r.json()).catch(() => null),
      loadFonts(base),
    ]);
    [T.morocco, T.moroccoN, T.gilt, T.giltN, T.paper, T.paperN, T.silk, T.cursor, vignette, plate, J] = pics;
    places = places_.places || [];
    env = o.environment?.() ?? null;
    // the materials, by the parts' names (book_kit.py): the book's drawn as the full look draws them, the glove's as the
    // look draws everything (retro.js unstyled)
    // (wide: the book is held in the hands, so its whole surface is a few texels of the sun's pictures wide - a shadow
    //  crossing the paper then arrives as a ramp, not as metre-scaled blocks stretched by the low sun)
    const lit = (p) => receiveSun(new THREE.MeshStandardMaterial(p), s.U, { wide: true }), std = (p) => unstyled(lit(p));
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
      m.material = lit({ map: g.map, normalMap: g.normalMap, normalScale: g.normalScale?.clone(), roughnessMap: g.roughnessMap,
        roughness: g.roughnessMap ? 1 : 0.6, metalness: 0, aoMap: g.aoMap, aoMapIntensity: g.aoMap ? 1 : 0 });
      parts[m.name] = m;
    });
    if (parts['hand-r']) {
      book.add(parts['hand-r']);
      // (the glove on a layer of its own: drawn after the book, its cover kept - render; never over the book drawn at the
      // screen's resolution - renderFull)
      parts['hand-r'].layers.set(1);
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
    parts['page-r'].material.map = P.r.t; parts['page-l'].material.map = P.l.t;
    parts['page-r'].material.needsUpdate = parts['page-l'].material.needsUpdate = true;
    drawRight(); drawLeft();
    // the cursor: the manicule's ink lying on the paper, its fingertip the point
    if (T.cursor) {
      T.cursor.wrapS = T.cursor.wrapT = THREE.ClampToEdgeWrapping;
      const w = coarse ? 0.052 : 0.036, h = w * T.cursor.image.height / T.cursor.image.width;
      const g = new THREE.PlaneGeometry(w, h); g.translate(-w / 2 + w * (1 - TIP[0]), -h / 2 + h * TIP[1], 0);
      cursor = new THREE.Mesh(g, std({ map: T.cursor, transparent: true, alphaTest: 0.02, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: towardCamera(-2), polygonOffsetUnits: towardCamera(-4) }));
      cursor.frustumCulled = false; cursor.renderOrder = 5; cursor.visible = false; scene.add(cursor);
      pageBound(cursor.material);
    }
    for (const side of ['l', 'r']) {
      const m = parts['page-' + side];
      if (!m) continue;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      rect[side] = [b.min.x, b.max.x, b.min.z, b.max.z];
      skirts.push(skirt(side, rect[side], b.max.y));
    }
    st.ready = true;
  }

  // (the hand's program: each point of it taken into the book's frame, and nothing of it drawn past the edges of the
  // page it lies on - its own test, in the program the book makes ready before it is first drawn: three's clipping planes
  // would have it made again at its first draw)
  function pageBound(m) {
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      Object.assign(sh.uniforms, CLIP);
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform mat4 uBookInv;\nvarying vec3 vBookPos;\nvoid main() {\n  vBookPos = (uBookInv * modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec4 uPageRect;\nvarying vec3 vBookPos;\nvoid main() {\n  if (vBookPos.x < uPageRect.x || vBookPos.x > uPageRect.y || vBookPos.z < uPageRect.z || vBookPos.z > uPageRect.w) discard;');
    };
    m.customProgramCacheKey = () => key() + '-page';
    m.needsUpdate = true;
  }
  // (a page carried on past its outer edge and its head and tail, unseen - its own curve from the fold (book.json profile),
  // straight on past the edge - for where the hand lies when the mouse is off the page: a mesh of its own, never drawn,
  // placed with the book when the cursor is looked for)
  function skirt(side, [x0, x1, z0, z1], top) {
    const OUT = 0.07, sg = side === 'r' ? 1 : -1, edge = Math.max(Math.abs(x0), Math.abs(x1));
    const prof = J?.profile?.length > 1 ? J.profile : [[0, top, 0], [edge, top, edge]];
    const yAt = (a) => {                              // (the leaf's height a metres out from the fold)
      for (let i = 1; i < prof.length; i++) if (a <= prof[i][0] || i === prof.length - 1) {
        const [ax, ay] = prof[i - 1], [bx, by] = prof[i], t = (a - ax) / ((bx - ax) || 1);
        return ay + (by - ay) * t;
      }
      return top;
    };
    const NX = 48, NZ = 6, pos = [], idx = [];
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const a = (edge + OUT) * i / NX, z = (z0 - OUT) + (z1 - z0 + 2 * OUT) * j / NZ;
      pos.push(sg * a, yAt(a), z);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * (NX + 1) + i, a = k, b = k + 1, c = k + NX + 1, d = c + 1;
      if (sg > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const k = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    k.matrixAutoUpdate = false; k.userData.side = side;
    return k;
  }

  function stripes() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16; const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) { g.fillStyle = (x >> 2) % 2 ? '#c9b38a' : '#6c0a0c'; g.fillRect(x, 0, 1, 16); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 64, 3);
    const t = full(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  // (while the book's pictures go to the card: the card's own anisotropy, not a look's lower one - walk.js holds a look's
  // down by what the card is made to say it can do)
  function fullReads(renderer, fn) {
    const caps = renderer.capabilities, said = caps.getMaxAnisotropy;
    if (o.aniso) caps.getMaxAnisotropy = () => o.aniso;
    try { fn(); } finally { caps.getMaxAnisotropy = said; }
  }

  // ---- the two pages, drawn again when what they show changes
  function dists() {
    const at = s.at; return places.map((p) => ({ ...p, dist: Math.hypot(p.at[0] - at.x, p.at[1] - at.z) }));
  }
  // (the place under the printer's hand red, as a look is on the left page)
  function drawRight(hover = st.hover.r) {
    if (!P.r) return;
    P.boxR = drawPlaces(P.r.g, pageW, pageH, { places: dists(), hover }, { tile: T.paper?.image, coarse });
    P.r.t.needsUpdate = true; st.distAt = { x: s.at.x, z: s.at.z };
  }
  function drawLeft() {
    if (!P.l) return;
    P.boxL = drawGraphics(P.l.g, pageW, pageH, { vignette, plate }, { tile: T.paper?.image, coarse });
    P.l.t.needsUpdate = true;
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
  ray.layers.enableAll();   // (the glove on a layer of its own is still the book's to a tap: onBook)
  function underCursor() {
    if (!parts['page-r']) return null;
    ray.setFromCamera(st.cursor, cam);
    const h = ray.intersectObjects([parts['page-l'], parts['page-r']], false)[0];
    if (!h) return null;
    const side = h.object === parts['page-r'] ? 'r' : 'l';
    return { side, h, x: h.uv.x * PAGE.w, y: h.uv.y * PAGE.h };
  }
  // (from the moment it is asked up - the hand on the page as soon as a page is under it, riding up with it - until it is
  // asked down: it had shown only once the book was all the way up)
  function hover() {
    const u = st.goal === 1 ? underCursor() : null;
    const r = u?.side === 'r' ? hit(P.boxR, u.x, u.y) : null, l = u?.side === 'l' ? hit(P.boxL, u.x, u.y) : null;
    if (r !== st.hover.r) { st.hover.r = r; drawRight(); }
    if (l !== st.hover.l) { st.hover.l = l; drawLeft(); }
    if (cursor) {
      // (on the page: where the mouse points; off it, on the page carried on past its edge - where only the part of it
      // still over the page shows)
      let at = u ? { h: u.h, side: u.side } : null;
      if (!at && st.goal === 1 && skirts.length) {
        for (const k of skirts) k.matrixWorld.copy(book.matrixWorld);
        const h = ray.intersectObjects(skirts, false)[0];
        if (h) at = { h, side: h.object.userData.side };
      }
      cursor.visible = !!at && !o.touch;                 // (on a place as on a look: never snapped to the line)
      if (at) {
        const n = at.h.face.normal.clone().transformDirection(at.h.object.matrixWorld);
        if (n.dot(ray.ray.direction) > 0) n.negate();
        const across = new THREE.Vector3(1, 0, 0).transformDirection(book.matrixWorld);
        across.addScaledVector(n, -across.dot(n)).normalize();
        const upv = new THREE.Vector3().crossVectors(n, across);
        cursor.matrix.makeBasis(across, upv, n).setPosition(at.h.point.clone().addScaledVector(n, 0.0003));
        cursor.matrixAutoUpdate = false; cursor.matrixWorldNeedsUpdate = true;
        clipTo(at.side);
      }
    }
    return u;
  }

  // (the page it lies on: its edges, and the book's frame the hand's every point is taken into to be held to them)
  function clipTo(side) {
    const r = rect[side];
    if (!r) return;
    CLIP.uPageRect.value.set(r[0], r[1], r[2], r[3]);
    CLIP.uBookInv.value.copy(book.matrixWorld).invert();
  }

  // ---- what the walk calls
  const api = {
    ready: load().catch((e) => { console.warn('[book]', e); }),
    get loaded() { return st.ready; },
    /** whether its programs are made and its pictures on the card (prime): it is drawn only then */
    get primed() { return !!st.primed; },
    /** every program it will draw with made, without holding the page up (the browser's own parallel making), and
     *  every picture it can show sent to the card - its pages, the hand's - before it is first drawn: made as it was
     *  first drawn, in the walk, they had held a frame up for a second and a half */
    async prime(renderer) {
      if (st.primed || st.priming || !st.ready || !s.base) return;
      st.priming = true;
      const shown = [];
      scene.traverse((o) => { if ((o.isMesh || o.isGroup) && !o.visible) { shown.push(o); o.visible = true; } });
      cam.layers.enableAll();
      // (and the book as depth alone: one program, whatever the part - made under the book's own lights, which its
      // program counts though it does not use them)
      const depthOnly = new THREE.Scene(); depthOnly.add(new THREE.Mesh(parts['page-r'].geometry, DEPTH_ONLY));
      // (made for what it is drawn into: the scene's picture where there is one - a program drawing into a picture is
      // not the one drawing onto the screen; made for the screen, the walk made them all again at the book's first draw)
      const was = renderer.getRenderTarget();
      let made = Promise.resolve();
      try {
        fitUp(); place(0); aim();
        if (s.rt) renderer.setRenderTarget(s.rt);
        made = Promise.all([renderer.compileAsync(scene, cam), renderer.compileAsync(depthOnly, cam, scene)]);
      } catch (e) { console.warn('[book] programs', e); } finally { renderer.setRenderTarget(was); }
      try { await made; } catch (e) { console.warn('[book] programs', e); }
      for (const o of shown) o.visible = false;
      const seen = new Set();
      const up = (t) => { if (t?.isTexture && t.image && !seen.has(t)) { seen.add(t); renderer.initTexture(t); } };
      fullReads(renderer, () => {
        scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) up(v); });
        up(P.r?.t); up(P.l?.t);
      });
      st.primed = true; st.priming = false;
    },
    get up() { return st.goal === 1; },
    get state() { return { up: st.up, goal: st.goal, hover: { ...st.hover }, cursor: st.cursor.toArray() }; },
    /** (dev: whether the free cursor is drawn - off the list - or not: on a place its hand is in the page's margin) */
    get cursorShown() { return !!cursor?.visible; },
    /** (dev: where a point of the book's own frame - x across, y off the pages, z toward the tail - stands in the window,
     *  in pixels; and each page's edges in that frame, [x0, x1, z0, z1]: the tests of the hand) */
    screenOf(x, y, z) { const v = new THREE.Vector3(x, y, z).applyMatrix4(book.matrixWorld).project(cam), r = o.canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; },
    get pages() { return { l: rect.l, r: rect.r }; },
    toggle() { if (!st.ready) return; st.goal = st.goal ? 0 : 1; if (st.goal) { st.cursor.set(0.25, -0.2); drawRight(); } else if (cursor) cursor.visible = false; },
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
      if (st.up < 1) return null;
      const u = underCursor(); if (!u) return null;
      if (u.side === 'r') {
        const id = hit(P.boxR, u.x, u.y), p = places.find((q) => q.id === id);
        if (!p) return null;
        o.onTravel?.(p); return { place: id };
      }
      // (the left page is plain text now: a click on it chooses nothing - drawGraphics returns no boxes)
      return null;
    },
    /** (tests) travel there now, as a click on its line does */
    travel(id) { const p = places.find((q) => q.id === id); if (!p) return false; o.onTravel?.(p); return true; },
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
      // (the distances kept true while it is up: drawn again when the walker has gone 100 m)
      if (st.up >= 1 && st.distAt && Math.hypot(s.at.x - st.distAt.x, s.at.z - st.distAt.z) > 100) drawRight();
    },
    /** drawn into the scene's picture, nearest of all: countryside.js prerender. paint false: the book as depth alone
     *  (drawn again at the screen's resolution over the picture: renderFull), so the glove behind it is hidden as ever and
     *  nothing of a coarse book shows round the sharp one; cover: the glove's cover written into the picture's alpha (all
     *  of it cleared first), for what lays the book over the picture (bookover.js) */
    render(renderer, dt = 0, { paint = true, cover = false } = {}) {
      if (!st.ready || !st.shown || !s.base) return;
      // (not drawn until it is made ready: made ready here if the walk has not asked - its first frames wait, not stall)
      if (!st.primed) { api.prime(renderer); return; }
      fitUp(); place(dt); aim(); hover();
      const gl = renderer.getContext(), rev = DEPTH.reversed;
      gl.depthRange(rev ? 0.982 : 0.0, rev ? 1.0 : 0.018);
      // the book
      const cursorWas = cursor?.visible;
      if (!paint) { scene.overrideMaterial = DEPTH_ONLY; if (cursor) cursor.visible = false; }
      cam.layers.set(0);
      fullReads(renderer, () => renderer.render(scene, cam));
      scene.overrideMaterial = null; if (cursor) cursor.visible = cursorWas;
      // the glove, in front of the book where it is
      if (cover) {
        renderer.setRenderTarget(renderer.getRenderTarget());
        gl.colorMask(false, false, false, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.colorMask(true, true, true, true);
        renderer.state.buffers.color.reset();
      }
      cam.layers.set(1);
      renderer.render(scene, cam);
      // (the book as depth alone: the glove where the book hides it drawn as well - farther than what is there, and only
      // where the picture has no glove's cover yet, its cover left as it was - so what the look's picture shows round the
      // book drawn at the screen's resolution is the glove going on behind it, not the land through a gap: bookover.js)
      const g = parts['hand-r']?.material;
      if (cover && !paint && g) {
        const was = { depthFunc: g.depthFunc, depthWrite: g.depthWrite, blending: g.blending, blendSrc: g.blendSrc, blendDst: g.blendDst,
          blendSrcAlpha: g.blendSrcAlpha, blendDstAlpha: g.blendDstAlpha, blendEquation: g.blendEquation, blendEquationAlpha: g.blendEquationAlpha };
        Object.assign(g, { depthFunc: THREE.GreaterDepth, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
          blendEquationAlpha: THREE.AddEquation, blendSrc: THREE.OneMinusDstAlphaFactor, blendDst: THREE.DstAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
        renderer.render(scene, cam);
        Object.assign(g, was);
      }
      cam.layers.enableAll();
      gl.depthRange(0, 1);
    },
    /** the book (not the glove) at the size of `target` - the screen's - in colour, its pictures read at the card's own
     *  anisotropy; drawn after render in the same frame (its place is render's). Returns whether it was drawn */
    renderFull(renderer, target) {
      if (!st.ready || !st.shown || !s.base || !st.primed || !target) return false;
      const prev = renderer.getRenderTarget(), auto = renderer.autoClear, ca = renderer.getClearAlpha();
      renderer.getClearColor(clearTo);
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
      renderer.clear(true, true, false);
      cam.layers.set(0);
      fullReads(renderer, () => renderer.render(scene, cam));
      cam.layers.enableAll();
      renderer.setRenderTarget(prev); renderer.setClearColor(clearTo, ca); renderer.autoClear = auto;
      return true;
    },
  };
  return api;
}
