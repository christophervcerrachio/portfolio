// Heavy things that stand in one place - a church, the Kremlin's towers, a bridge's piers - not drawn from further off
// than they can be made out. Each of them was drawn whenever it lay in the view's wedge, at any distance: Moscow's
// forty churches, 2.3 million triangles, from the streets of Petersburg 13 km away; the country bridges' piers, 3.5
// million, from anywhere. farCull(group, far) gives a function to call once a frame with the camera's place: each of
// the group's own children is shown only while its nearest edge is within `far` m (Infinity: always, as before).
import * as THREE from 'three';
import { firstSight } from './firstsight.js';

export function farCull(group, far) {
  const where = new WeakMap(), box = new THREE.Box3(), s = new THREE.Sphere();
  return (pos) => {
    if (!group || !(far < Infinity)) return;
    for (const o of group.children) {
      let c = where.get(o);
      if (!c) {
        // (its place worked out here, whether or not it has been shown yet: the land's places are kept up only for what is
        // shown - landparts.js updateWorld)
        if (o.isInstancedMesh && o.boundingSphere) { o.updateWorldMatrix(true, false); s.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); }
        else { box.setFromObject(o); if (box.isEmpty()) continue; box.getBoundingSphere(s); }
        where.set(o, (c = { x: s.center.x, z: s.center.z, r: s.radius }));
      }
      // (a thing may give its own nearer bounds - userData.drawTo: not drawn from this far; drawFrom: only from this
      // far - so a light stand-in can take a heavy part's place: the bridges' crib stones, bridges.js)
      const d = Math.hypot(c.x - pos.x, c.z - pos.z) - c.r;
      // (firstSight: its buffers are not on the card until it has been drawn once, so the frames of a turn take a
      //  frame's worth of these, not every one at once - world/firstsight.js)
      o.visible = firstSight(o, d < far && !(d >= o.userData.drawTo) && !(d < o.userData.drawFrom));
    }
  };
}
