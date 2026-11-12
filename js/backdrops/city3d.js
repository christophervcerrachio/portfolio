// A place's 1:1 massing model, built from its spec.json and data as solid geometry, to stand in the live world
// (not painted): the ground from the map, the forests a canopy, the buildings the kit's own models standing where
// the map has a building, the landmarks their own shapes. Ported from dev\massing\render.html minus its far-plane,
// fog, camera and ID pass, so it can be dropped into the scene's own `land` and lit by its sun and sky. Returns a
// Group whose local frame is the map's world frame (metres, the camera's origin at the map origin, turned by map.az).
import * as THREE from 'three';
import { gltfLoader } from '../gltf.js';
import { FEATURES } from './features.js';

export async function buildCity(base, specPath, opts = {}) {
  const url = base + specPath, dir = url.replace(/[^/]*$/, '');
  const S = await (await fetch(url)).json();
  const M = S.map, m = M.mPerPx, [cx, cy] = M.origin;
  const at = (px, py) => [(px - cx) * m, (py - cy) * m];
  const cast = opts.shadows === true;              // (the meadow's shadow map does not reach a far city: off by default)
  const showGround = opts.ground !== false;        // (in the live region the walkable plain is the ground: pass ground:false)
  const group = new THREE.Group();
  const world = new THREE.Group(); world.rotation.y = M.az; group.add(world);
  const C = (c) => new THREE.Color(c);
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const floats = async (file) => new Float32Array(await (await fetch(dir + file)).arrayBuffer());
  const tex = async (file, srgb = true) => {
    const t = await new THREE.TextureLoader().loadAsync(dir + file);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  };

  // the country round the map (a wider map of the region), then the map's own ground (both skipped in the live region)
  if (showGround && S.region) {
    const Rg = S.region, g = new THREE.PlaneGeometry(Rg.size[0] * Rg.mPerPx, Rg.size[1] * Rg.mPerPx).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, lambert({ map: await tex(Rg.albedo) }));
    const [x, z] = at(Rg.center[0], Rg.center[1]); mesh.position.set(x, -0.8, z); mesh.rotation.y = Rg.rot;
    mesh.receiveShadow = cast; world.add(mesh);
  }
  if (showGround) {
    const [W, H] = M.size, g = new THREE.PlaneGeometry(W * m, H * m).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, lambert({ map: await tex(M.albedo) }));
    const [x, z] = at(W / 2, H / 2); mesh.position.set(x, 0, z); mesh.receiveShadow = cast; world.add(mesh);
  }

  // the forests: a canopy over them (a height picture on the map's grid, every `step` px)
  if (FEATURES.canopy && S.canopy) {
    const K = S.canopy;
    const load = async (f) => { const i = new Image(); i.src = dir + f; await i.decode(); const cv = document.createElement('canvas');
      cv.width = i.width; cv.height = i.height; cv.getContext('2d').drawImage(i, 0, 0); return { d: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height }; };
    const H1 = await load(K.height), C1 = await load(K.color);
    const nx = H1.w, ny = H1.h, st = K.step, hd = H1.d, cd = C1.d;
    const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), idx = [];
    const lin = (v) => Math.pow(v / 255, 2.2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, [x, z] = at(K.x0 + i * st, K.y0 + j * st);
      pos.set([x, (hd[k * 4] / 255) * K.max - K.sink * (hd[k * 4] < 3 ? 1 : 0), z], k * 3);
      col.set([lin(cd[k * 4]), lin(cd[k * 4 + 1]), lin(cd[k * 4 + 2])], k * 3);
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (hd[a * 4] + hd[b * 4] + hd[c * 4] + hd[d * 4] === 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, lambert({ vertexColors: true })); mesh.castShadow = cast; mesh.receiveShadow = cast; world.add(mesh);
  }
  // the kit: the models themselves, one copy where the map has a building, each turned so its painted front
  // looks at the street the map has in front of it - place_kit.py works that out from the map's own ground
  // classes and writes it to kit.bin, in map px, so the copies stand by the same at() as everything else
  // here and turn with the same az. A footprint the kit has no model for is still drawn as a box below.
  let kit = null;
  if (S.kit) kit = await buildKit(S, dir, world, at, cast, lambert);

  // the rest: instanced boxes [x, y(px mid), w, d, height, turn, wall rgb, roof rgb] with facade windows
  let nBoxes = 0;
  const boxAt = new Map();          // a box's map px -> its index, so the roof pass can ask the kit about it
  if (S.boxes) {
    const B = await floats(S.boxes), N = B.length / 12; nBoxes = N;
    for (let k = 0; k < N; k++) boxAt.set(B[k * 12] + '|' + B[k * 12 + 1], k);
    const keep = [];
    for (let k = 0; k < N; k++) if (!(kit && kit.done.has(k))) keep.push(k);
    if (keep.length) {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
    const cols = new Float32Array(g.attributes.position.count * 3), nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) cols.set(nrm.getY(i) > 0.5 ? [1, 1, 1] : [0, 0, 0], i * 3);
    g.setAttribute('roof', new THREE.BufferAttribute(cols, 3));
    const mat = lambert({});
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 roof; attribute vec3 aRoofCol; varying vec3 vRoofMix; varying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvRoofMix = roof.x > 0.5 ? aRoofCol : vec3(-1.0);')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);');
      const fac = S.facades ? `if (vRoofMix.x < 0.0 && abs(vWNrm.y) < 0.3) {
          vec2 t = normalize(vec2(-vWNrm.z, vWNrm.x)); float u = dot(vWPos.xz, t), v = vWPos.y;
          float wx = step(0.32, fract(u / 3.4)) * step(fract(u / 3.4), 0.68);
          float wy = step(0.34, fract(v / 3.8)) * step(fract(v / 3.8), 0.8) * step(3.0, v);
          diffuseColor.rgb *= 1.0 - 0.5 * wx * wy;
          diffuseColor.rgb *= 1.0 + 0.12 * step(fract(v / 3.8), 0.08) * step(3.0, v);
        }` : '';
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoofMix; varying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif (vRoofMix.x >= 0.0) diffuseColor.rgb = vRoofMix;\n' + fac);
    };
    const mesh = new THREE.InstancedMesh(g, mat, keep.length);
    const roofCol = new Float32Array(keep.length * 3), o = new THREE.Object3D(), c = new THREE.Color();
    keep.forEach((k, j) => {
      const b = B.subarray(k * 12, k * 12 + 12), [x, z] = at(b[0], b[1]);
      o.position.set(x, 0, z); o.rotation.set(0, b[5], 0); o.scale.set(b[2], b[4], b[3]); o.updateMatrix();
      mesh.setMatrixAt(j, o.matrix);
      mesh.setColorAt(j, c.setRGB(b[6], b[7], b[8], THREE.SRGBColorSpace));
      c.setRGB(b[9], b[10], b[11], THREE.SRGBColorSpace); roofCol.set([c.r, c.g, c.b], j * 3);
    });
    g.setAttribute('aRoofCol', new THREE.InstancedBufferAttribute(roofCol, 3));
    mesh.castShadow = cast; mesh.receiveShadow = cast; mesh.frustumCulled = false; world.add(mesh);
    }
  }

  // the roofs: pitched (gable) or hipped roofs on the walls - only the walls still drawn as boxes, since a
  // kit model carries its own roof
  if (S.roofs) {
    const B = await floats(S.roofs), N = B.length / 11;
    const mk = (hip) => {
      const i = hip ? 0.25 : 0, V = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5 - i, 1, 0], [-0.5 + i, 1, 0], [-0.5, 0, 0.5], [0.5, 0, 0.5]];
      const faces = [[0, 1, 2], [0, 2, 3], [5, 4, 3], [5, 3, 2], [1, 5, 2], [4, 0, 3]];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat().flatMap((k) => V[k]), 3)); g.computeVertexNormals();
      return g;
    };
    for (const hip of [0, 1]) {
      const idx = [];
      for (let k = 0; k < N; k++) {
        // a kit model carries its own roof, so the massing's pitched prism is left off wherever one stands.
        // roofs.bin and boxes.bin were written from the same boxes, so their px match to the bit.
        if (kit) { const bi = boxAt.get(B[k * 11] + '|' + B[k * 11 + 1]); if (bi !== undefined && kit.done.has(bi)) continue; }
        if ((B[k * 11 + 7] > 0.5 ? 1 : 0) === hip) idx.push(k);
      }
      if (!idx.length) continue;
      const mesh = new THREE.InstancedMesh(mk(hip), lambert({ side: THREE.DoubleSide }), idx.length);
      const o = new THREE.Object3D(), c = new THREE.Color();
      idx.forEach((k, j) => {
        const b = B.subarray(k * 11, k * 11 + 11), [x, z] = at(b[0], b[1]);
        o.position.set(x, b[5], z); o.rotation.set(0, b[6], 0); o.scale.set(b[2], b[4], b[3]); o.updateMatrix();
        mesh.setMatrixAt(j, o.matrix); mesh.setColorAt(j, c.setRGB(b[8], b[9], b[10], THREE.SRGBColorSpace));
      });
      mesh.castShadow = cast; mesh.receiveShadow = cast; mesh.frustumCulled = false; world.add(mesh);
    }
  }

  // the trees: [x, y(px), height, crown radius, r g b, kind (0 spruce cone, 1 broadleaf crown)]
  if (FEATURES.trees && S.trees) {
    const T = await floats(S.trees), N = T.length / 8;
    const geos = [new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0), new THREE.IcosahedronGeometry(1, 1).scale(1, 0.5, 1).translate(0, 0.5, 0)];
    const counts = [0, 0]; for (let k = 0; k < N; k++) counts[T[k * 8 + 7] > 0.5 ? 1 : 0]++;
    const meshes = geos.map((g, i) => { const mm = new THREE.InstancedMesh(g, lambert({}), Math.max(1, counts[i])); mm.count = counts[i]; mm.frustumCulled = false; world.add(mm); return mm; });
    const used = [0, 0], o = new THREE.Object3D(), c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      const t = T.subarray(k * 8, k * 8 + 8), i = t[7] > 0.5 ? 1 : 0, [x, z] = at(t[0], t[1]);
      if (i === 0) { o.position.set(x, t[2] * 0.08, z); o.scale.set(t[3], t[2] * 0.92, t[3]); }
      else { o.position.set(x, t[2] * 0.3, z); o.scale.set(t[3], t[2] * 0.7 * 2, t[3]); }
      o.rotation.set(0, k * 2.399, 0); o.updateMatrix();
      meshes[i].setMatrixAt(used[i], o.matrix); meshes[i].setColorAt(used[i], c.setRGB(t[4], t[5], t[6], THREE.SRGBColorSpace)); used[i]++;
    }
  }
  // the landmarks: shapes by kind, at map px, sizes in metres (a cathedral's dome, a fortress tower, a palace box)
  const prism = (len, span, rise, eave = 0) => { const sh = new THREE.Shape(); sh.moveTo(-span / 2 - eave, 0); sh.lineTo(span / 2 + eave, 0); sh.lineTo(0, rise); sh.lineTo(-span / 2 - eave, 0); return new THREE.ExtrudeGeometry(sh, { depth: len + 2 * eave, bevelEnabled: false }).translate(0, 0, -(len + 2 * eave) / 2).rotateY(Math.PI / 2); };
  const vault = (len, span, rise, n = 20) => { const sh = new THREE.Shape(); sh.moveTo(-span / 2, 0); for (let i = 1; i <= n; i++) { const a = Math.PI * (1 - i / n); sh.lineTo(Math.cos(a) * span / 2, Math.sin(a) * rise); } sh.lineTo(-span / 2, 0); return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: n }).translate(0, 0, -len / 2).rotateY(Math.PI / 2); };
  const multi = {
    house: (s) => [[new THREE.BoxGeometry(s.w, s.wall, s.d).translate(0, s.wall / 2, 0), s.wallColor], [prism(s.w, s.d, s.rise, s.eave ?? 0.4).translate(0, s.wall, 0), s.roofColor]],
    hangar: (s) => { const p = [[vault(s.w, s.d, s.rise).translate(0, s.wall, 0), s.roofColor]]; if (s.wall > 0) p.push([new THREE.BoxGeometry(s.w, s.wall, s.d).translate(0, s.wall / 2, 0), s.wallColor]); return p; },
  };
  const shapes = {
    cyl: (s) => new THREE.CylinderGeometry(s.r1 ?? s.r, s.r0 ?? s.r, s.h, s.seg ?? 32, 1, !!s.open).translate(0, s.h / 2 + (s.y ?? 0), 0),
    tower: (s) => { const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24, y = t * s.h, w = s.rWaist + (s.rBase - s.rWaist) * Math.pow(Math.abs(t - s.waist) / (t < s.waist ? s.waist : 1 - s.waist), 2) * (t < s.waist ? 1 : (s.rTop - s.rWaist) / (s.rBase - s.rWaist)); pts.push(new THREE.Vector2(w, y)); } return new THREE.LatheGeometry(pts, 48); },
    dome: (s) => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, a = t * Math.PI / 2; let r = Math.cos(a) * s.r, y = Math.sin(a) * s.r * (s.squash ?? 1); if (s.onion) { r = s.r * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t))) * (1 - t * 0.2); y = t * s.r * 2.2; } pts.push(new THREE.Vector2(Math.max(0.01, r), y + (s.y ?? 0))); } return new THREE.LatheGeometry(pts, 24); },
    arch: (s) => { const shape = new THREE.Shape(); const N = 32; for (let i = 0; i <= N; i++) { const a = Math.PI * i / N; shape.lineTo(Math.cos(a) * s.span / 2, Math.sin(a) * s.h); } for (let i = N; i >= 0; i--) { const a = Math.PI * i / N; shape.lineTo(Math.cos(a) * (s.span / 2 - 6), Math.sin(a) * (s.h - 6)); } return new THREE.ExtrudeGeometry(shape, { depth: s.len, bevelEnabled: false }).translate(0, 0, -s.len / 2); },
    lattice: (s) => new THREE.BoxGeometry(s.len, s.h, s.d ?? 6).translate(0, s.h / 2, 0),
    box: (s) => new THREE.BoxGeometry(s.w, s.h, s.d).translate(0, s.h / 2 + (s.y ?? 0), 0),
    mound: (s) => new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(s.w / 2, s.h, s.d / 2),
  };
  const latticeTex = (s) => { const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d'); x.clearRect(0, 0, 512, 512); x.strokeStyle = s.color ?? '#7d6f62'; x.lineWidth = 9; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(i * 128 + 20, 0); x.lineTo(i * 128 + 20, 512); x.stroke(); } const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(s.len / 40, s.h / 40); t.colorSpace = THREE.SRGBColorSpace; return t; };
  for (const [si, s] of (S.shapes ?? []).entries()) {
    if (kit && kit.doneShapes.has(si)) continue;      // the kit's own model stands where this crude shape stood
    if (multi[s.kind]) {
      const [x, z] = at(s.at[0], s.at[1]);
      for (const [g, col] of multi[s.kind](s)) { const mesh = new THREE.Mesh(g, lambert({ color: C(col), side: THREE.DoubleSide })); mesh.position.set(x, s.base ?? 0, z); mesh.rotation.y = s.turn ?? 0; mesh.castShadow = cast; mesh.receiveShadow = cast; world.add(mesh); }
      continue;
    }
    const g = shapes[s.kind](s);
    const mat = s.kind === 'lattice' ? lambert({ map: latticeTex(s), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide })
      : lambert({ color: C(s.color ?? '#999'), side: (s.kind === 'tower' || s.kind === 'arch') ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(g, mat), [x, z] = at(s.at[0], s.at[1]);
    mesh.position.set(x, s.base ?? 0, z); mesh.rotation.y = s.turn ?? 0; mesh.castShadow = cast; mesh.receiveShadow = cast; world.add(mesh);
  }
  return { group, spec: S, boxes: nBoxes, kit };
}

// The kit's models, one instance where the map has a building. kit.bin (place_kit.py) is nine floats a copy:
// which model it is, which massing box and which landmark shape it stands in place of, where it stands in map
// px, its turn within the map's own frame, and its scale. Every model is drawn twice over - its near picture
// and its far one - and which of the two a copy wears is settled by how far the eye is and redone whenever the
// walker has moved sixty-odd paces, because fifteen thousand copies cannot all wear their near picture and a
// city seen from the hill does not ask them to.
async function buildKit(S, dir, world, at, cast, lambert) {
  const K = await (await fetch(dir + S.kit)).json();
  const kdir = dir + S.kit.replace(/[^/]*$/, '');     // the kit's own folder, beside its json
  const gltf = await gltfLoader().loadAsync(kdir + K.glb);
  const parts = {}, done = new Set(), doneShapes = new Set(K.replaced_shapes || []);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [id, lod] = o.name.split('|');
    const mat = lambert({ map: o.material.map, side: o.material.side, color: o.material.color });
    if (mat.map) mat.map.anisotropy = 8;
    (parts[id] = parts[id] || {})[lod] = { geo: o.geometry, mat };
  });
  const B = new Float32Array(await (await fetch(kdir + K.bin)).arrayBuffer());
  const N = B.length / 9;
  const byId = new Map();
  for (let k = 0; k < N; k++) {
    const b = B.subarray(k * 9, k * 9 + 9);
    const id = K.models[b[0] | 0].id;
    if (b[1] >= 0) done.add(b[1]);
    if (b[2] >= 0) doneShapes.add(b[2] | 0);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(k);
  }

  // one pair of instanced meshes a model, and every copy's matrix composed once, at load, into a flat
  // array; splitting them between the two pictures is then a copy of sixteen floats a copy
  const o = new THREE.Object3D(), groups = [];
  for (const [id, ks] of byId) {
    const p = parts[id];
    if (!p || !p.lod0 || !p.lod1) throw new Error(`the kit glb has no ${id} in both lods`);
    const mk = (part, which) => {
      const m = new THREE.InstancedMesh(part.geo, part.mat, ks.length);
      m.name = 'kit:' + id + '|' + which;
      m.count = 0; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = cast;
      world.add(m); return m;
    };
    const g = { near: mk(p.lod0, 'lod0'), far: mk(p.lod1, 'lod1'), n: ks.length,
      mats: new Float32Array(ks.length * 16), pos: new Float32Array(ks.length * 2) };
    ks.forEach((k, j) => {
      const b = B.subarray(k * 9, k * 9 + 9);
      const [x, z] = at(b[3], b[4]);
      g.pos[j * 2] = x; g.pos[j * 2 + 1] = z;
      o.position.set(x, 0, z); o.rotation.set(0, b[5], 0); o.scale.set(b[6], b[7], b[8]);
      o.updateMatrix(); o.matrix.toArray(g.mats, j * 16);
    });
    groups.push(g);
  }

  const near2 = (K.near_m || 120) ** 2;
  const split = (eye) => {
    for (const g of groups) {
      const A = g.near.instanceMatrix.array, C = g.far.instanceMatrix.array;
      let n = 0, f = 0;
      for (let j = 0; j < g.n; j++) {
        const dx = g.pos[j * 2] - eye.x, dz = g.pos[j * 2 + 1] - eye.z;
        const src = g.mats.subarray(j * 16, j * 16 + 16);
        if (dx * dx + dz * dz <= near2) { A.set(src, n++ * 16); } else { C.set(src, f++ * 16); }
      }
      g.near.count = n; g.far.count = f;
      g.near.instanceMatrix.needsUpdate = true; g.far.instanceMatrix.needsUpdate = true;
    }
  };
  const last = new THREE.Vector3(1e9, 0, 0);
  const tick = (cam) => {
    const p = world.worldToLocal(cam.position.clone());
    if (p.distanceToSquared(last) < 36) return;              // (six paces: nothing has changed enough to redraw)
    last.copy(p); split(p);
  };
  for (const g of groups) { g.near.onBeforeRender = (r, s, cam) => tick(cam); g.far.onBeforeRender = (r, s, cam) => tick(cam); }
  return { copies: N, models: byId.size, near_m: K.near_m || 120, done, doneShapes, groups };
}
