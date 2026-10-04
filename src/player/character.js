// Procedural "Jungle Man" character. The body is ONE continuous surface:
// anatomical primitives (round cones, ellipsoids) are smooth-blended as a
// signed distance field and polygonised in an A-pose, then skinned to the
// skeleton with distance-based weights so joints bend smoothly. Hair is a
// sculpted cap plus swinging locks; eyes, cords and the loincloth flaps ride
// on bones.
import * as THREE from 'three';
import { buildSurface, roundCone, ellipsoid, primDist, sdfEval } from './sdf.js';
import { getTextures } from '../fx/textures.js';
import { clamp } from '../core/math.js';

const SKIN = [0.34, 0.18, 0.11]; // linear (warm tan)
const SKIN_LIGHT = [0.46, 0.27, 0.17];
const CLOTH = [0.26, 0.15, 0.06];
const CORD = [0.11, 0.065, 0.035];

/** 3x3 world->local rotation from a quaternion (transpose of its matrix). */
function rotFromQuat(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).transpose().elements;
  // Matrix4 elements are column-major: transpose(R) rows = R columns.
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

export class Character {
  constructor() {
    const T = getTextures();
    this.skinMat = skinMaterial();
    this.hairMat = new THREE.MeshStandardMaterial({ color: 0x1c110a, roughness: 0.72, metalness: 0.0, vertexColors: true });
    this.clothMat = new THREE.MeshStandardMaterial({ map: T.cloth.map, normalMap: T.cloth.normalMap, roughness: 0.95, side: THREE.DoubleSide, color: 0xe0b888 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.3 });
    this.eyeWhite = new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.25 });
    this.irisMat = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.2 });
    this.cordMat = new THREE.MeshStandardMaterial({ color: 0x4a301c, roughness: 0.9 });
    this.toothMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.4 });

    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); // flips/rolls rotate around the body center
    this.pivot.position.y = 1.0;
    this.root.add(this.pivot);
    this.body = new THREE.Group();
    this.body.position.y = -1.0;
    this.pivot.add(this.body);

    this.joints = {};
    const j = (name, parent, x, y, z) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      parent.add(b);
      this.joints[name] = b;
      return b;
    };
    // ---- skeleton (rest pose: standing, arms hanging)
    const hips = j('hips', this.body, 0, 0.98, 0);
    const spine = j('spine', hips, 0, 0.1, 0);
    const chest = j('chest', spine, 0, 0.2, 0);
    const neck = j('neck', chest, 0, 0.27, -0.01);
    const head = j('head', neck, 0, 0.1, 0.012);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = j('shoulder' + side, chest, sx * 0.19, 0.19, -0.015);
      const ua = j('upperArm' + side, sh, sx * 0.035, -0.025, 0);
      const fa = j('foreArm' + side, ua, 0, -0.285, 0);
      j('hand' + side, fa, 0, -0.255, 0);
      const th = j('thigh' + side, hips, sx * 0.092, -0.045, 0);
      const sn = j('shin' + side, th, 0, -0.44, 0);
      j('foot' + side, sn, 0, -0.43, 0);
    }

    this.buildBody();
    this.buildHead(head);
    this.buildDetails();
    this.root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  }

  // ---------------------------------------------------------------- body
  buildBody() {
    const J = this.joints;
    // Pose the skeleton in an A-pose so arms and legs model clear of the torso.
    const apose = { upperArmL: [0, 0, 0.72], upperArmR: [0, 0, -0.72], thighL: [0, 0, 0.07], thighR: [0, 0, -0.07], foreArmL: [0, 0, 0.08], foreArmR: [0, 0, -0.08] };
    for (const [n, e] of Object.entries(apose)) J[n].rotation.set(e[0], e[1], e[2]);
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const boneM = new Map();
    for (const b of Object.values(J)) boneM.set(b, new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld));
    const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _t = new THREE.Vector3();
    const W = (bone, x, y, z) => _p.set(x, y, z).applyMatrix4(boneM.get(bone)).toArray();

    const prims = [];
    /** Round cone in bone-local coords. */
    const rc = (bone, a, b, r1, r2, k, tag = 'skin') => {
      const p = roundCone(W(bone, ...a), W(bone, ...b), r1, r2, { k, bone, tag });
      prims.push(p);
      return p;
    };
    /** Ellipsoid in bone-local coords with an optional local euler rotation. */
    const el = (bone, c, r, k, tag = 'skin', euler = null, sub = false) => {
      boneM.get(bone).decompose(_t, _q, _s);
      const q = _q.clone();
      if (euler) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler)));
      const p = ellipsoid(W(bone, ...c), r, { k, bone, tag, rot: rotFromQuat(q), sub });
      prims.push(p);
      return p;
    };

    // Torso.
    el(J.hips, [0, -0.015, 0.0], [0.152, 0.105, 0.105], 0);
    el(J.hips, [0.066, -0.075, -0.055], [0.072, 0.085, 0.07], 0.05);
    el(J.hips, [-0.066, -0.075, -0.055], [0.072, 0.085, 0.07], 0.05);
    el(J.spine, [0, 0.08, 0.01], [0.13, 0.13, 0.098], 0.08);
    el(J.spine, [0, 0.07, 0.07], [0.075, 0.085, 0.035], 0.04); // abs
    el(J.chest, [0, 0.095, -0.01], [0.172, 0.168, 0.118], 0.08);
    el(J.chest, [0, 0.12, -0.045], [0.198, 0.125, 0.088], 0.06); // lats / upper back
    el(J.chest, [0.074, 0.135, 0.07], [0.086, 0.062, 0.048], 0.045, 'skin', [0, 0, -0.25]);
    el(J.chest, [-0.074, 0.135, 0.07], [0.086, 0.062, 0.048], 0.045, 'skin', [0, 0, 0.25]);
    rc(J.chest, [0.035, 0.265, -0.025], [0.165, 0.205, -0.02], 0.052, 0.046, 0.05); // trapezius
    rc(J.chest, [-0.035, 0.265, -0.025], [-0.165, 0.205, -0.02], 0.052, 0.046, 0.05);
    rc(J.neck, [0, -0.04, 0.0], [0, 0.11, 0.008], 0.066, 0.055, 0.045);
    // Arms.
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      el(J['shoulder' + s], [sx * 0.035, -0.03, 0.0], [0.078, 0.08, 0.077], 0.05);
      const ua = J['upperArm' + s], fa = J['foreArm' + s], hd = J['hand' + s];
      rc(ua, [0, 0, 0], [0, -0.285, 0], 0.062, 0.046, 0.045);
      el(ua, [0, -0.135, 0.024], [0.046, 0.075, 0.044], 0.03); // biceps
      el(ua, [0, -0.115, -0.026], [0.047, 0.082, 0.043], 0.03); // triceps
      rc(fa, [0, 0, 0], [0, -0.25, 0], 0.047, 0.031, 0.03);
      el(fa, [0, -0.075, 0.008], [0.05, 0.078, 0.041], 0.03);
      // Hand: palm, curled finger block and thumb.
      el(hd, [0, -0.045, 0.004], [0.019, 0.048, 0.041], 0.022, 'palm');
      el(hd, [-sx * 0.004, -0.106, 0.018], [0.016, 0.042, 0.035], 0.02, 'palm', [0.55, 0, 0]);
      rc(hd, [-sx * 0.012, -0.022, 0.03], [-sx * 0.008, -0.07, 0.055], 0.0145, 0.0105, 0.016, 'palm');
    }
    // Legs.
    for (const s of ['L', 'R']) {
      const th = J['thigh' + s], sn = J['shin' + s], ft = J['foot' + s];
      rc(th, [0, 0.01, 0], [0, -0.44, 0], 0.094, 0.056, 0.06);
      el(th, [0, -0.18, 0.03], [0.07, 0.14, 0.066], 0.045); // quads
      el(th, [0, -0.2, -0.03], [0.058, 0.12, 0.055], 0.04); // hamstrings
      rc(sn, [0, 0, 0], [0, -0.42, 0], 0.054, 0.035, 0.04);
      el(sn, [0, -0.12, -0.032], [0.052, 0.098, 0.048], 0.04); // calf
      el(sn, [0, -0.005, 0.038], [0.03, 0.03, 0.022], 0.025); // knee
      el(ft, [0, -0.04, 0.045], [0.043, 0.032, 0.105], 0.03, 'palm');
      el(ft, [0, -0.025, -0.02], [0.038, 0.04, 0.045], 0.03, 'palm'); // heel
    }

    const t0 = performance.now();
    const S = buildSurface(prims, 0.0105);
    this.buildMs = performance.now() - t0;

    // Skin weights from distance to each bone's primitives.
    const bones = Object.values(J);
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const torso = new Set([J.hips, J.spine, J.chest, J.neck]);
    const byBone = new Map();
    for (const p of prims) if (!p.sub && p.tag !== 'cloth' && p.tag !== 'cord') {
      if (!byBone.has(p.bone)) byBone.set(p.bone, []);
      byBone.get(p.bone).push(p);
    }
    const nv = S.positions.length / 3;
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), col = new Float32Array(nv * 3);
    const cand = [];
    for (let v = 0; v < nv; v++) {
      const x = S.positions[v * 3], y = S.positions[v * 3 + 1], z = S.positions[v * 3 + 2];
      cand.length = 0;
      let dmin = Infinity;
      for (const [bone, list] of byBone) {
        let d = Infinity;
        for (const p of list) d = Math.min(d, primDist(p, x, y, z));
        cand.push([bone, d]);
        dmin = Math.min(dmin, d);
      }
      for (const c of cand) {
        const sigma = torso.has(c[0]) ? 0.03 : 0.016;
        c[1] = Math.exp(-(c[1] - dmin) / sigma);
      }
      cand.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += cand[k] ? cand[k][1] : 0;
      for (let k = 0; k < 4; k++) {
        const c = cand[k];
        si[v * 4 + k] = c ? boneIndex.get(c[0]) : 0;
        sw[v * 4 + k] = c ? c[1] / sum : 0;
      }
      // Ambient occlusion from the distance field (creases, armpits, muscle lines).
      const nx = S.normals[v * 3], ny = S.normals[v * 3 + 1], nz = S.normals[v * 3 + 2];
      let occ = 0;
      for (const [h, w] of [[0.015, 1], [0.035, 0.6], [0.07, 0.3]]) {
        occ += Math.max(0, h - sdfEval(prims, x + nx * h, y + ny * h, z + nz * h)) * w / h;
      }
      const ao = 1 - clamp(occ * 0.45, 0, 0.6);
      // Vertex colour by the dominant primitive's material tag.
      const tag = S.prims[v] ? S.prims[v].tag : 'skin';
      let c = tag === 'cloth' ? CLOTH : tag === 'cord' ? CORD : tag === 'palm' ? lerp3(SKIN, SKIN_LIGHT, 0.35) : SKIN;
      // Subtle variation: slightly warmer/redder on cheeks, knees, knuckles.
      const n = Math.sin(x * 41 + y * 23) * Math.sin(z * 37 - y * 19) * 0.03;
      col[v * 3] = c[0] * (1 + n) * ao; col[v * 3 + 1] = c[1] * (1 + n * 0.8) * ao; col[v * 3 + 2] = c[2] * (1 + n * 0.6) * ao;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(S.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(S.index);
    g.computeBoundingSphere();
    const skeleton = new THREE.Skeleton(bones);
    const mesh = new THREE.SkinnedMesh(g, this.skinMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(skeleton);
    this.skin = mesh;

    // Loincloth band: a strip wrapped around the hips just off the skin,
    // skinned with the same weights so it follows the legs.
    const band = this.wrapBand(prims, J, boneM, byBone, boneIndex, torso);
    const bm = new THREE.SkinnedMesh(band, this.clothMat);
    bm.castShadow = true;
    bm.frustumCulled = false;
    this.root.add(bm);
    bm.bind(skeleton);
    // Back to the rest pose: skinning moves the A-pose mesh with the bones.
    for (const n of Object.keys(apose)) J[n].rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  wrapBand(prims, J, boneM, byBone, boneIndex, torso) {
    const hipM = boneM.get(J.hips);
    const ctr = new THREE.Vector3().setFromMatrixPosition(hipM);
    const rows = 7, cols = 56;
    const yTop = ctr.y + 0.045, yBot = ctr.y - 0.105;
    const pos = [], uv = [], idx = [], si = [], sw = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (let c = 0; c <= cols; c++) {
        const a = (c / cols) * Math.PI * 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        // Lower in the back and at the sides, like a wrapped hide.
        const y = yTop - t * (yTop - yBot) * (1 + 0.25 * Math.max(0, -dz)) + (t === 0 ? Math.max(0, -dz) * -0.01 : 0);
        let lo = 0.02, hi = 0.4;
        for (let k = 0; k < 22; k++) {
          const m = (lo + hi) / 2;
          if (sdfEval(prims, ctr.x + dx * m, y, ctr.z + dz * m) < 0) lo = m; else hi = m;
        }
        const rr = lo + 0.011 + t * 0.006;
        pos.push(ctr.x + dx * rr, y, ctr.z + dz * rr);
        uv.push(c / cols * 4, t * 0.6);
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const cand = [];
      let dmin = Infinity;
      for (const [bone, list] of byBone) {
        if (bone !== J.hips && bone !== J.spine && bone !== J.thighL && bone !== J.thighR) continue;
        let d = Infinity;
        for (const p of list) d = Math.min(d, primDist(p, x, y, z));
        cand.push([bone, d]);
        dmin = Math.min(dmin, d);
      }
      for (const c of cand) c[1] = Math.exp(-(c[1] - dmin) / (torso.has(c[0]) ? 0.03 : 0.02));
      cand.sort((p, q) => q[1] - p[1]);
      const sum = cand.reduce((acc, c) => acc + c[1], 0);
      for (let k = 0; k < 4; k++) { si.push(cand[k] ? boneIndex.get(cand[k][0]) : 0); sw.push(cand[k] ? cand[k][1] / sum : 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------------------------------------------------------------- head
  buildHead(head) {
    const prims = [];
    const el = (c, r, k, tag = 'skin', sub = false, euler = null) => {
      const rot = euler ? rotFromQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler))) : null;
      prims.push(ellipsoid(c, r, { k, tag, sub, rot }));
    };
    const rc = (a, b, r1, r2, k, tag = 'skin') => prims.push(roundCone(a, b, r1, r2, { k, tag }));
    // Head-local coordinates (head bone at the top of the neck).
    rc([0, -0.05, -0.005], [0, 0.03, 0.0], 0.043, 0.048, 0.03); // neck top (tucks inside the body's neck)
    el([0, 0.105, -0.008], [0.09, 0.11, 0.102], 0.04); // cranium
    el([0, 0.05, 0.028], [0.068, 0.062, 0.074], 0.045); // jaw
    el([0, 0.012, 0.064], [0.03, 0.024, 0.026], 0.03); // chin
    el([0.044, 0.086, 0.07], [0.028, 0.02, 0.024], 0.025); // cheekbones
    el([-0.044, 0.086, 0.07], [0.028, 0.02, 0.024], 0.025);
    el([0, 0.13, 0.083], [0.066, 0.017, 0.022], 0.022); // brow ridge
    rc([0, 0.12, 0.094], [0, 0.084, 0.114], 0.01, 0.0155, 0.014); // nose
    el([0, 0.08, 0.108], [0.02, 0.011, 0.012], 0.012); // nostrils
    el([0, 0.053, 0.094], [0.022, 0.009, 0.012], 0.01, 'lip'); // lips
    el([0.092, 0.095, -0.005], [0.011, 0.028, 0.019], 0.014); // ears
    el([-0.092, 0.095, -0.005], [0.011, 0.028, 0.019], 0.014);
    el([0.034, 0.108, 0.098], [0.019, 0.016, 0.018], 0.012, 'skin', true); // eye sockets
    el([-0.034, 0.108, 0.098], [0.019, 0.016, 0.018], 0.012, 'skin', true);
    el([0, 0.047, 0.104], [0.021, 0.0035, 0.01], 0.004, 'lip', true); // mouth line
    const S = buildSurface(prims, 0.0055);
    const nv = S.positions.length / 3;
    const col = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const tag = S.prims[v] ? S.prims[v].tag : 'skin';
      const c = tag === 'lip' ? [0.42, 0.2, 0.15] : SKIN;
      // Darker in the eye sockets for depth.
      const ey = S.positions[v * 3 + 1], ez = S.positions[v * 3 + 2], ex = Math.abs(S.positions[v * 3]);
      const sock = Math.exp(-((ex - 0.034) ** 2 + (ey - 0.108) ** 2 + (ez - 0.09) ** 2) / 0.0004) * 0.35;
      col.set([c[0] * (1 - sock), c[1] * (1 - sock), c[2] * (1 - sock)], v * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(S.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(S.index);
    const m = new THREE.Mesh(g, this.skinMat);
    head.add(m);
    this.headMesh = m;

    // Eyes.
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 14, 10), this.eyeWhite);
      eye.position.set(sx * 0.034, 0.108, 0.088);
      head.add(eye);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 8), this.irisMat);
      iris.position.set(sx * 0.033, 0.108, 0.0995);
      iris.scale.set(1, 1, 0.5);
      head.add(iris);
      const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), this.hairMat);
      brow.scale.set(0.022, 0.0045, 0.008);
      brow.position.set(sx * 0.036, 0.132, 0.1);
      brow.rotation.z = sx * -0.18;
      head.add(brow);
    }
    this.buildHair(head);
  }

  buildHair(head) {
    // Sculpted hair cap: a shell over the cranium cut away at the face.
    const prims = [];
    prims.push(ellipsoid([0, 0.118, -0.016], [0.1, 0.12, 0.112], { k: 0, tag: 'hair' }));
    prims.push(roundCone([0, 0.1, -0.07], [0, -0.02, -0.085], 0.08, 0.062, { k: 0.05, tag: 'hair' })); // back mass
    prims.push(ellipsoid([0.0, 0.205, 0.06], [0.075, 0.03, 0.04], { k: 0.03, tag: 'hair', rot: rotFromQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0))) })); // fringe
    prims.push(ellipsoid([0, 0.045, 0.1], [0.12, 0.125, 0.085], { k: 0.025, tag: 'hair', sub: true })); // face opening
    prims.push(ellipsoid([0.1, 0.075, 0.02], [0.03, 0.045, 0.04], { k: 0.015, tag: 'hair', sub: true })); // ear openings
    prims.push(ellipsoid([-0.1, 0.075, 0.02], [0.03, 0.045, 0.04], { k: 0.015, tag: 'hair', sub: true }));
    // Clumps for a less helmet-like silhouette.
    for (let i = 0; i < 9; i++) {
      const a = -1.2 + (i / 8) * 2.4;
      prims.push(ellipsoid([Math.sin(a) * 0.09, 0.15 - Math.abs(a) * 0.03, -0.05 + Math.cos(a) * -0.04], [0.035, 0.03, 0.04], { k: 0.02, tag: 'hair' }));
    }
    const S = buildSurface(prims, 0.006);
    const nv = S.positions.length / 3;
    const col = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const y = S.positions[v * 3 + 1], x = S.positions[v * 3];
      const streak = 0.8 + 0.2 * Math.sin(x * 260 + y * 40) * Math.sin(x * 90);
      col.set([streak, streak, streak], v * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(S.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(S.index);
    head.add(new THREE.Mesh(g, this.hairMat));

    // Long locks down the back: two-segment flattened tapers that swing.
    this.hair = [];
    const lock = (r0, r1, len) => {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        // Rounded top, tapering body, closed rounded tip.
        const tip = t > 0.85 ? Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)) : 1;
        pts.push(new THREE.Vector2(Math.max(0.001, (r0 + (r1 - r0) * t) * Math.sin(Math.min(1, t * 6) * Math.PI / 2 + 0.2) * tip), -t * len));
      }
      pts[0].x = 0.001;
      const geo = new THREE.LatheGeometry(pts, 8);
      geo.scale(1, 1, 0.55);
      const c = new Float32Array(geo.attributes.position.count * 3).fill(0.85);
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return geo;
    };
    const locks = [
      [-0.05, 0.075, -0.075, 0.3], [-0.017, 0.08, -0.088, 0.34], [0.017, 0.08, -0.088, 0.34], [0.05, 0.075, -0.075, 0.3],
      [-0.075, 0.07, -0.045, 0.24], [0.075, 0.07, -0.045, 0.24],
    ];
    for (const [x, y, z, len] of locks) {
      const a = new THREE.Group();
      a.position.set(x, y, z);
      head.add(a);
      const m1 = new THREE.Mesh(lock(0.042, 0.034, len * 0.52), this.hairMat);
      m1.scale.set(1, 1, 0.7);
      a.add(m1);
      const b = new THREE.Group();
      b.position.y = -len * 0.5;
      a.add(b);
      const m2 = new THREE.Mesh(lock(0.034, 0.014, len * 0.55), this.hairMat);
      m2.scale.set(1, 1, 0.7);
      b.add(m2);
      this.hair.push({ a, b, ax: 0.25, az: x * 2, bx: 0.1, vax: 0, vbx: 0, baseZ: x * 3.5, side: x });
    }
  }

  // ---------------------------------------------------------------- details
  buildDetails() {
    const J = this.joints;
    const rigid = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    for (const side of ['L', 'R']) {
      const br = rigid(new THREE.TorusGeometry(0.037, 0.008, 6, 14), this.cordMat, J['foreArm' + side], 0, -0.215, 0.002);
      br.rotation.x = Math.PI / 2;
      const an = rigid(new THREE.TorusGeometry(0.042, 0.008, 6, 14), this.cordMat, J['shin' + side], 0, -0.35, -0.004);
      an.rotation.x = Math.PI / 2;
    }
    // Tooth necklace.
    const neckl = rigid(new THREE.TorusGeometry(0.1, 0.005, 5, 24, Math.PI * 1.1), this.cordMat, J.chest, 0, 0.205, 0.0);
    neckl.rotation.set(Math.PI / 2 + 0.55, 0, Math.PI * 0.95);
    neckl.scale.set(1.05, 1.25, 1);
    const tooth = rigid(new THREE.ConeGeometry(0.009, 0.042, 6), this.toothMat, J.chest, 0, 0.13, 0.112);
    tooth.rotation.x = Math.PI + 0.35;
    // Loincloth flaps (front and back) hanging from the band.
    this.flaps = [];
    for (const [z, rot, len, wid] of [[0.128, 0, 0.34, 0.19], [-0.135, Math.PI, 0.36, 0.23]]) {
      const pv = new THREE.Group();
      pv.position.set(0, -0.06, z);
      pv.rotation.y = rot;
      J.hips.add(pv);
      const g = new THREE.PlaneGeometry(wid, len, 3, 5);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const x = p.getX(i);
        const t = (len / 2 - y) / len; // 0 top .. 1 bottom
        const jag = t > 0.92 ? Math.sin(x * 70) * 0.012 : 0;
        p.setXYZ(i, x * (1 - t * 0.18), y - len / 2 + jag, Math.abs(x) * -0.25 + t * 0.01);
      }
      g.computeVertexNormals();
      rigid(g, this.clothMat, pv);
      this.flaps.push({ pv, angle: 0, vel: 0, back: rot !== 0 });
    }
  }
}

function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** Skin: vertex-coloured standard material with soft wrap lighting and a warm rim. */
function skinMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        // Cheap subsurface: lift the terminator and add a warm rim.
        float ndv = clamp(dot(normal, normalize(-vViewPosition)), 0.0, 1.0);
        float r2 = pow(1.0 - ndv, 3.0);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.3, 0.1, 0.05) * 0.35;
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.5, 0.3) * r2 * 0.5;
      }`);
  };
  m.customProgramCacheKey = () => 'skin2';
  return m;
}

export { clamp };
