// The land in parts (16 Nov 2026), so that each of the frame's pictures - the view, and the sun's two shadow pictures -
// goes through only what it can see. The land is some 31,000 objects: the cities' tiles of houses, their fronts'
// relief, the furniture, the landmarks, the woods. three.js went through every one of them for each picture, frustum
// test and all, and the sun's pictures turned every caster in the land to its depth material and back, both of them,
// every frame. A part is a subtree of the land no wider than PART m either way - a tile of houses, a tile of the
// fronts' relief, a tile of furniture, a landmark - with the box round everything it holds; a picture whose reach that
// box does not meet leaves the part out whole (hidden for that picture, shown again after it), and draws the rest as
// it always has.
// The objects' places are worked out here too, once a frame, in place of the land's own updateMatrixWorld(): three.js
// had composed the land's matrix every frame, and that forced every one of the 31,000 below it to be made again, moved
// or not. Here an object's matrix is composed again only when its position, turn or size has changed, its place in the
// world worked out again only when that or its parent's has (or it was given to another parent) - the same matrices,
// made only where something moved. What moves marks its part, whose box is measured again before the next picture: a
// tile rising out of the ground, a mill's sails, a piece put in by the arrivals.
// Measured on an RTX 5090 over Moscow, 3440 x 1300, before: the matrices 3 to 7 ms a frame, the two shadow pictures'
// material turns 4.6 ms, their walks through the land 4 to 6 ms, and every half second the casters gathered again, 10 ms.
import * as THREE from 'three';

const PART = 600;                      // (m: a subtree no wider than this either way is one part)
const BASE = THREE.Object3D.prototype.updateMatrixWorld;
const _sph = new THREE.Sphere(), _m = new THREE.Matrix4(), _fr = new THREE.Frustum();

class Part {
  constructor(node) {
    this.node = node;
    this.box = new THREE.Box3();
    this.always = false;               // (it holds what is drawn whatever the frustum: a light, an unculled mesh)
    this.layers = 0;                   // (the layers its drawn things are on, together)
    this.dirty = true;                 // (to be measured again before the next picture)
    this.gen = 0;                      // (how many times measured: the shadows' casters follow it, sunshadow.js)
    this.dead = false;                 // (taken out of the land)
    this.shown = false;                // (it and all above it visible this frame: update())
  }
}

const drawn = (o) => o.isMesh || o.isPoints || o.isLine || o.isSprite;

export class LandParts {
  constructor(root) {
    this.root = root;
    this.parts = [];
    this.fresh = [];                   // (what came in straight under the land or a container since the last frame)
    this.k = 0;                        // (where the round of parts measured again in turn stands)
    this.hid = [];
    this.moved = (o) => this._moved(o);
    root.__container = true;
  }

  /** Once a frame, before any picture: the land's places worked out, what came in placed into parts, what moved
   *  measured again. */
  update() {
    updateWorld(this.root, this.moved);
    if (this.fresh.length) {
      const f = this.fresh; this.fresh = [];
      for (const o of f) if (o.parent && o.__part == null && !o.__container && this._inLand(o)) this._adopt(o);
    }
    // (the parts gone from the land let go, and whether each is shown this frame - it and everything above it visible;
    // and a few each frame measured again whatever moved or not - every part about once a second: the safety under
    // what is not marked, a flag or a picture changed in place)
    let gone = 0;
    for (const p of this.parts) {
      let shown = p.node.visible, inLand = false;
      for (let a = p.node.parent; a; a = a.parent) { if (a === this.root) { inLand = true; break; } if (!a.visible) shown = false; }
      if (p.dead || p.node.__part !== p || !inLand) { p.dead = true; gone++; } else p.shown = shown;
    }
    if (gone) this.parts = this.parts.filter((p) => !p.dead);
    const n = this.parts.length, every = Math.ceil(n / 60);
    for (let i = 0; i < every; i++) { this.k = (this.k + 1) % n; this.parts[this.k].dirty = true; }
    for (const p of this.parts) if (p.dirty) this._measure(p);
  }

  /** The frustum of the picture `cam` is about to take, for seen(). */
  aim(cam) {
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_m);
  }
  /** Whether part `p` can be in that picture (aim() first). */
  seen(p) { return p.always || (!p.box.isEmpty() && _fr.intersectsBox(p.box)); }

  /** Hide, for the picture `cam` is about to take, the parts it cannot see: nothing on its layers, or their box out of
   *  its frustum (those not shown at all left as they are). What was hidden comes back with show(). */
  hide(cam) {
    this.aim(cam);
    const out = this.hid, mask = cam.layers.mask;
    for (const p of this.parts) {
      if (!p.shown || p.always) continue;
      if ((p.layers & mask) === 0 || !this.seen(p)) { p.node.visible = false; out.push(p.node); }
    }
    return out;
  }
  /** What hide() hid (or `list`), shown again. */
  show(list = this.hid) { for (const o of list) o.visible = true; list.length = 0; }

  // ---- inside
  _inLand(o) { for (let a = o.parent; a; a = a.parent) if (a === this.root) return true; return false; }

  /** Something placed again: its part marked; straight under the land or a container and in no part, put in one. */
  _moved(o) {
    if (o.__container) return;
    const up = o.parent;
    if (up === null) return;
    if (up.__container) {
      const p = o.__part;
      if (p && p.node === o && !p.dead) p.dirty = true;
      else { o.__part = null; this.fresh.push(o); }
      return;
    }
    const p = up.__part;
    if (p) { o.__part = p; p.dirty = true; }
    // (under something not yet in a part: it goes in with that)
  }

  /** `o`, straight under the land or a container, made a part - or, wider than a part and not drawn itself, a
   *  container whose children are each taken the same way. */
  _adopt(o) {
    const box = new THREE.Box3();
    o.traverse((c) => { if (drawn(c) && c.frustumCulled !== false && !c.isSprite && !c.isSkinnedMesh) sphereBox(c, box); });
    const wide = box.isEmpty() ? 0 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (wide > PART && !drawn(o) && !o.isLight && o.children.length) {
      o.__container = true; o.__part = null;
      for (const c of o.children) this._adopt(c);
      return;
    }
    const p = new Part(o);
    o.__container = false;
    o.traverse((c) => { c.__part = p; });
    this.parts.push(p);
    this._measure(p);
  }

  /** A part's box, whether it holds what is drawn whatever the frustum, and its layers - measured again from what it
   *  holds now. */
  _measure(p) {
    const box = p.box.makeEmpty();
    let always = false, layers = 0;
    p.node.traverse((c) => {
      if (c.__part !== p) c.__part = p;
      if (c.isLight) { always = true; return; }
      if (!drawn(c)) return;
      layers |= c.layers.mask;
      if (c.frustumCulled === false || c.isSprite || c.isSkinnedMesh) always = true;
      else sphereBox(c, box);
    });
    p.always = always; p.layers = layers; p.dirty = false; p.gen++;
  }
}

/** `o`'s bounding sphere in the world, as three.js's own frustum test takes it, added to `box`. */
function sphereBox(o, box) {
  if (o.boundingSphere !== undefined) { if (o.boundingSphere === null) o.computeBoundingSphere(); _sph.copy(o.boundingSphere); }
  else { const g = o.geometry; if (!g) return; if (g.boundingSphere === null) g.computeBoundingSphere(); _sph.copy(g.boundingSphere); }
  _sph.applyMatrix4(o.matrixWorld);
  const c = _sph.center, r = _sph.radius;
  if (!(r >= 0) || !isFinite(r) || !isFinite(c.x + c.y + c.z)) return;
  box.min.x = Math.min(box.min.x, c.x - r); box.min.y = Math.min(box.min.y, c.y - r); box.min.z = Math.min(box.min.z, c.z - r);
  box.max.x = Math.max(box.max.x, c.x + r); box.max.y = Math.max(box.max.y, c.y + r); box.max.z = Math.max(box.max.z, c.z + r);
}

/**
 * The world matrices of everything under `root` brought up to date, as root.updateMatrixWorld() would leave them - but
 * each object's own matrix composed again only when its position, quaternion or scale changed, and its world matrix
 * made again only when that changed, it was given another parent, it was marked (matrixWorldNeedsUpdate), or its
 * parent's was made again. `moved(o)`: told of each object whose world matrix was made again. An object with an
 * updateMatrixWorld of its own (a camera, a skinned mesh, a sound) is left to it, as three.js would.
 */
export function updateWorld(root, moved = null) { step(root, false, moved, true); }
function step(o, force, moved, top) {
  if (!top && o.updateMatrixWorld !== BASE) { o.updateMatrixWorld(force); if (moved !== null) moved(o); return; }
  if (o.matrixAutoUpdate) {
    const p = o.position, q = o.quaternion, s = o.scale;
    let c = o.__trs;
    if (c === undefined || c[0] !== p.x || c[1] !== p.y || c[2] !== p.z || c[3] !== q.x || c[4] !== q.y || c[5] !== q.z || c[6] !== q.w
      || c[7] !== s.x || c[8] !== s.y || c[9] !== s.z) {
      o.matrix.compose(p, q, s);
      if (c === undefined) c = o.__trs = new Float64Array(10);
      c[0] = p.x; c[1] = p.y; c[2] = p.z; c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w; c[7] = s.x; c[8] = s.y; c[9] = s.z;
      o.matrixWorldNeedsUpdate = true;
    }
  }
  if (o.__up !== o.parent) { o.__up = o.parent; o.matrixWorldNeedsUpdate = true; }
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate === true) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
    if (moved !== null) moved(o);
  }
  const ch = o.children;
  for (let i = 0, n = ch.length; i < n; i++) step(ch[i], force, moved, false);
}
