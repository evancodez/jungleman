// Procedural "Jungle Man" character. Body parts are modelled as smooth
// primitives, merged into ONE skinned mesh whose joints blend between
// neighbouring bones, so elbows, knees, shoulders and hips bend smoothly.
// Hair, face details, cords and the loincloth ride rigidly on bones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTextures } from '../fx/textures.js';
import { clamp } from '../core/math.js';

function limbGeo(r0, r1, len, seg = 14, opts = {}) {
  // Lathe profile from the joint (y=0, radius r0) down to y=-len (radius r1),
  // with hemispherical caps. Extends along -Y.
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, -len + Math.sin(a) * r1));
  }
  const bulge = opts.bulge ?? 0;
  const bulgeAt = opts.bulgeAt ?? 0.4;
  const rings = 10;
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const r = r1 + (r0 - r1) * t;
    const b = bulge * Math.exp(-Math.pow((t - (1 - bulgeAt)) / 0.22, 2));
    pts.push(new THREE.Vector2(r + b, -len + len * t));
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  if (opts.flatten) g.scale(1, 1, opts.flatten);
  if (opts.widen) g.scale(opts.widen, 1, 1);
  return g;
}

function ellipsoid(rx, ry, rz, w = 18, h = 12) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

export class Character {
  constructor() {
    const T = getTextures();
    this.skinMat = new THREE.MeshStandardMaterial({ map: T.skin.map, normalMap: T.skin.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), color: 0xf4e2d4, roughness: 0.6, metalness: 0 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: 0x2c1a10, roughness: 0.6, metalness: 0.05 });
    this.clothMat = new THREE.MeshStandardMaterial({ map: T.cloth.map, normalMap: T.cloth.normalMap, roughness: 0.95, side: THREE.DoubleSide, color: 0xb88a5a });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.4 });
    this.eyeWhite = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.3 });
    this.cordMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 });

    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); // flips/rolls rotate around the body center
    this.pivot.position.y = 1.0;
    this.root.add(this.pivot);
    this.body = new THREE.Group();
    this.body.position.y = -1.0;
    this.pivot.add(this.body);

    this.joints = {};
    this.parts = []; // skinned parts: {geo, bone, parent, child, bp, bc, seg}
    const j = (name, parent, x, y, z) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      parent.add(b);
      this.joints[name] = b;
      return b;
    };
    /** Register a skinned part on `bone`, blending into parent/child bones near the joints. */
    const part = (geo, bone, o = {}) => {
      if (o.at) geo.translate(o.at[0], o.at[1], o.at[2]);
      this.parts.push({ geo, bone, parent: o.parent || null, child: o.child || null, bp: o.bp ?? 0.07, bc: o.bc ?? 0.07, seg: o.seg || null });
    };
    const rigid = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- skeleton
    const hips = j('hips', this.body, 0, 0.98, 0);
    const spine = j('spine', hips, 0, 0.1, 0);
    const chest = j('chest', spine, 0, 0.2, 0);
    const neck = j('neck', chest, 0, 0.27, 0);
    const head = j('head', neck, 0, 0.1, 0.01);
    const arm = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = j('shoulder' + side, chest, sx * 0.2, 0.19, -0.01);
      const ua = j('upperArm' + side, sh, sx * 0.03, -0.02, 0);
      const fa = j('foreArm' + side, ua, 0, -0.28, 0);
      const hd = j('hand' + side, fa, 0, -0.26, 0);
      arm[side] = { sh, ua, fa, hd, sx };
      const th = j('thigh' + side, hips, sx * 0.095, -0.04, 0);
      const sn = j('shin' + side, th, 0, -0.44, 0);
      j('foot' + side, sn, 0, -0.43, 0);
    }

    // ---- skinned body parts (geometry in bone-local space)
    // Torso.
    part(ellipsoid(0.165, 0.13, 0.115), hips, { at: [0, -0.01, 0], child: spine, bc: 0.06, seg: [0, 0.1] });
    part(limbGeo(0.14, 0.135, 0.22, 16, { widen: 1.12, flatten: 0.8 }).rotateX(Math.PI), spine, { at: [0, -0.01, 0.004], parent: hips, child: chest, bp: 0.06, bc: 0.07, seg: [0, 0.2] });
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) part(ellipsoid(0.04, 0.03, 0.018, 10, 8), spine, { at: [sx * 0.042, 0.0 + i * 0.058, 0.108], seg: [0, 0.2], parent: hips, child: chest, bp: 0.04, bc: 0.04 });
    part(ellipsoid(0.205, 0.17, 0.135), chest, { at: [0, 0.1, 0], parent: spine, bp: 0.08, seg: [0, 0.27] });
    for (const sx of [-1, 1]) {
      part(ellipsoid(0.098, 0.072, 0.05, 14, 10), chest, { at: [sx * 0.082, 0.125, 0.1], seg: [0, 0.27] });
      part(ellipsoid(0.072, 0.15, 0.1, 14, 10), chest, { at: [sx * 0.148, 0.05, -0.02], parent: spine, bp: 0.06, seg: [0, 0.27] });
    }
    part(ellipsoid(0.165, 0.06, 0.085, 14, 8), chest, { at: [0, 0.23, -0.02], child: neck, bc: 0.05, seg: [0, 0.27] });
    part(limbGeo(0.058, 0.066, 0.12, 12).rotateX(Math.PI), neck, { at: [0, -0.01, 0], parent: chest, child: head, bp: 0.05, bc: 0.04, seg: [0, 0.1] });
    // Arms.
    for (const side of ['L', 'R']) {
      const a = arm[side];
      part(ellipsoid(0.074, 0.078, 0.078, 14, 10), a.sh, { at: [a.sx * 0.015, -0.005, 0], parent: chest, child: a.ua, bp: 0.06, bc: 0.08, seg: [0, -0.02] });
      part(limbGeo(0.064, 0.05, 0.28, 14, { bulge: 0.017, bulgeAt: 0.45 }), a.ua, { parent: a.sh, child: a.fa, bp: 0.09, bc: 0.07, seg: [0, -0.28] });
      part(limbGeo(0.051, 0.036, 0.26, 14, { bulge: 0.011, bulgeAt: 0.25 }), a.fa, { parent: a.ua, child: a.hd, bp: 0.07, bc: 0.05, seg: [0, -0.26] });
      part(ellipsoid(0.038, 0.062, 0.022, 12, 8), a.hd, { at: [0, -0.05, 0.005], parent: a.fa, bp: 0.04, seg: [0, -0.1] });
      part(ellipsoid(0.035, 0.036, 0.021, 10, 8), a.hd, { at: [0, -0.11, 0.012], seg: [0, -0.1] });
      const thumb = limbGeo(0.017, 0.014, 0.05, 6);
      thumb.rotateZ(a.sx * 0.6); thumb.rotateX(0.4);
      part(thumb, a.hd, { at: [a.sx * -0.03, -0.02, 0.02], seg: [0, -0.1] });
    }
    // Legs.
    for (const side of ['L', 'R']) {
      const th = this.joints['thigh' + side], sn = this.joints['shin' + side], ft = this.joints['foot' + side];
      part(limbGeo(0.09, 0.058, 0.44, 14, { bulge: 0.013, bulgeAt: 0.35 }), th, { parent: hips, child: sn, bp: 0.1, bc: 0.07, seg: [0, -0.44] });
      const calf = limbGeo(0.058, 0.04, 0.43, 14, { bulge: 0.019, bulgeAt: 0.25 });
      calf.translate(0, 0, -0.006);
      part(calf, sn, { parent: th, child: ft, bp: 0.07, bc: 0.05, seg: [0, -0.43] });
      const footGeo = ellipsoid(0.048, 0.036, 0.12, 12, 8);
      footGeo.translate(0, -0.03, 0.06);
      part(footGeo, ft, { parent: sn, bp: 0.05, seg: [0, -0.03] });
    }

    this.buildSkinnedMesh();

    // ---- rigid details
    this.buildHead(head);
    for (const side of ['L', 'R']) {
      const fa = this.joints['foreArm' + side];
      const br = rigid(new THREE.TorusGeometry(0.043, 0.009, 6, 12), this.cordMat, fa, 0, -0.22, 0);
      br.rotation.x = Math.PI / 2;
      const sn = this.joints['shin' + side];
      const an = rigid(new THREE.TorusGeometry(0.05, 0.008, 6, 12), this.cordMat, sn, 0, -0.36, 0);
      an.rotation.x = Math.PI / 2;
    }
    // Tooth necklace.
    const neckl = rigid(new THREE.TorusGeometry(0.105, 0.007, 6, 20, Math.PI * 1.1), this.cordMat, chest, 0, 0.2, 0.02);
    neckl.rotation.set(Math.PI / 2 + 0.5, 0, Math.PI * 0.95);
    neckl.scale.set(1, 1.2, 1);
    const tooth = rigid(new THREE.ConeGeometry(0.012, 0.05, 5), this.eyeWhite, chest, 0, 0.115, 0.125);
    tooth.rotation.x = Math.PI + 0.3;

    // ---- loincloth (belt + front/back flaps)
    const belt = rigid(new THREE.TorusGeometry(0.155, 0.022, 6, 24), this.cordMat, hips, 0, 0.04, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.06, 0.8, 1);
    const wrap = rigid(new THREE.CylinderGeometry(0.17, 0.182, 0.12, 20, 1, true), this.clothMat, hips, 0, -0.01, 0);
    wrap.scale.set(1.03, 1, 0.82);
    this.flaps = [];
    for (const [z, rot, len, wid] of [[0.1, 0, 0.36, 0.2], [-0.1, Math.PI, 0.38, 0.24]]) {
      const pv = new THREE.Group();
      pv.position.set(0, 0.0, z);
      pv.rotation.y = rot;
      hips.add(pv);
      const g = new THREE.PlaneGeometry(wid, len, 2, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const x = p.getX(i);
        const jag = y < -len * 0.45 ? Math.sin(x * 60) * 0.02 : 0;
        p.setXYZ(i, x * (1 - (y + len / 2) * 0.1), y - len / 2 + jag, Math.abs(x) * -0.15);
      }
      g.computeVertexNormals();
      rigid(g, this.clothMat, pv);
      this.flaps.push({ pv, angle: 0, vel: 0, back: rot !== 0 });
    }

    this.root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  }

  buildSkinnedMesh() {
    this.root.updateMatrixWorld(true);
    const bones = Object.values(this.joints);
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const boneMat = (b) => new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld);
    const geos = [];
    const v = new THREE.Vector3();
    for (const p of this.parts) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const pos = g.attributes.position;
      const n = pos.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const own = boneIndex.get(p.bone);
      const [s0, s1] = p.seg || [0, -0.1];
      const len = Math.abs(s1 - s0) || 0.1;
      const dir = Math.sign(s1 - s0) || -1;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i);
        // Position along the bone's segment (local Y), 0 at the joint.
        const t = (v.y - s0) * dir;
        let wp = 0, wc = 0;
        if (p.parent) wp = clamp(0.5 - t / (2 * p.bp), 0, 0.85);
        if (p.child) wc = clamp(0.5 - (len - t) / (2 * p.bc), 0, 0.85);
        const wo = Math.max(0.0, 1 - wp - wc);
        const infl = [[own, wo], [p.parent ? boneIndex.get(p.parent) : 0, wp], [p.child ? boneIndex.get(p.child) : 0, wc]];
        infl.sort((a, b) => b[1] - a[1]);
        const sum = infl[0][1] + infl[1][1] + infl[2][1] || 1;
        for (let k = 0; k < 3; k++) { si[i * 4 + k] = infl[k][0]; sw[i * 4 + k] = infl[k][1] / sum; }
      }
      g = g.clone();
      g.applyMatrix4(boneMat(p.bone));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(merged, this.skinMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // Bind while the root is still at the origin: geometry is authored in
    // root space, so the standard attached bind mode works directly.
    this.root.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    this.skin = mesh;
  }

  buildHead(head) {
    const S = this.skinMat;
    const add = (geo, mat, x, y, z, parent = head) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    add(ellipsoid(0.098, 0.118, 0.108), S, 0, 0.1, 0);
    add(ellipsoid(0.078, 0.06, 0.08), S, 0, 0.035, 0.022); // jaw
    add(ellipsoid(0.074, 0.016, 0.022), S, 0, 0.138, 0.086); // brow ridge
    const nose = add(new THREE.ConeGeometry(0.018, 0.05, 6), S, 0, 0.098, 0.108);
    nose.rotation.x = Math.PI * 0.42;
    for (const sx of [-1, 1]) {
      add(ellipsoid(0.016, 0.011, 0.012), this.eyeWhite, sx * 0.035, 0.118, 0.096);
      add(ellipsoid(0.0075, 0.0085, 0.006), this.darkMat, sx * 0.035, 0.118, 0.106);
      add(ellipsoid(0.021, 0.0055, 0.008), this.hairMat, sx * 0.036, 0.137, 0.104).rotation.z = sx * -0.15;
      add(ellipsoid(0.014, 0.03, 0.02), S, sx * 0.098, 0.1, 0.0);
    }
    add(ellipsoid(0.026, 0.005, 0.008), this.darkMat, 0, 0.055, 0.098);
    // Hair: cap whose front rim sits at the hairline and back rim at the nape.
    const cap = add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), this.hairMat, 0, 0.112, -0.006);
    cap.scale.set(0.107, 0.13, 0.118);
    cap.rotation.x = -0.55;
    add(ellipsoid(0.085, 0.022, 0.04), this.hairMat, 0, 0.2, 0.065).rotation.x = 0.5; // fringe
    this.hair = [];
    const strands = [
      [-0.07, 0.09, -0.06, 0.36], [-0.035, 0.1, -0.09, 0.4], [0, 0.1, -0.1, 0.42], [0.035, 0.1, -0.09, 0.4], [0.07, 0.09, -0.06, 0.36],
      [-0.09, 0.07, 0.0, 0.3], [0.09, 0.07, 0.0, 0.3], [-0.05, 0.12, -0.06, 0.32], [0.05, 0.12, -0.06, 0.32], [-0.085, 0.11, -0.035, 0.34], [0.085, 0.11, -0.035, 0.34],
    ];
    for (const [x, y, z, len] of strands) {
      const a = new THREE.Group();
      a.position.set(x, y, z);
      head.add(a);
      const m1 = new THREE.Mesh(limbGeo(0.03, 0.022, len * 0.5, 6, { flatten: 0.6 }), this.hairMat);
      m1.castShadow = true;
      a.add(m1);
      const b = new THREE.Group();
      b.position.y = -len * 0.5;
      a.add(b);
      const g2 = new THREE.ConeGeometry(0.022, len * 0.55, 6);
      g2.rotateX(Math.PI);
      g2.translate(0, -len * 0.27, 0);
      g2.scale(1, 1, 0.6);
      const m2 = new THREE.Mesh(g2, this.hairMat);
      m2.castShadow = true;
      b.add(m2);
      this.hair.push({ a, b, ax: 0.25, az: x * 2, bx: 0.1, vax: 0, vbx: 0, baseZ: x * 3.5, side: x });
    }
  }
}
