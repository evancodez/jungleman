// Geometry helpers for procedural level construction.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3, rng } from '../core/math.js';

export { mergeGeometries, mergeVertices };

/** Ensure geometry has position/normal/uv/color and only those (for merging). */
export function normalizeAttrs(geo) {
  if (geo.index) geo = geo.toNonIndexed();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) {
    const c = new Float32Array(n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  for (const k of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  }
  geo.morphAttributes = {};
  return geo;
}

/** Multiply vertex colors by an AO function of world position + normal. */
export function applyAO(geo, fn) {
  const p = geo.attributes.position, nrm = geo.attributes.normal;
  let col = geo.attributes.color;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3);
    geo.setAttribute('color', col);
  }
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i), nrm ? nrm.getY(i) : 0);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

export function tint(geo, r, g, b) {
  const p = geo.attributes.position;
  let col = geo.attributes.color;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3);
    geo.setAttribute('color', col);
  }
  for (let i = 0; i < p.count; i++) col.setXYZ(i, col.getX(i) * r, col.getY(i) * g, col.getZ(i) * b);
  return geo;
}

/** Box with world-scaled UVs (texture density `tile` meters per repeat). */
export function boxGeo(w, h, d, tile = 2, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d, opts.sx || 1, opts.sy || 1, opts.sz || 1);
  const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    let u, v;
    if (nx > 0.5) { u = z; v = y; }
    else if (ny > 0.5) { u = x; v = z; }
    else { u = x; v = y; }
    if (opts.swapUV) uv.setXY(i, v / tile, u / tile);
    else uv.setXY(i, u / tile, v / tile);
  }
  return g;
}

/**
 * Tube along a curve with variable radius. rFn(t) -> radius. Noise adds
 * organic irregularity (for branches/roots).
 */
export function taperedTube(curve, segs, radial, rFn, opts = {}) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nrm = [], uv = [], idx = [];
  const len = curve.getLength();
  const noiseAmt = opts.noise ?? 0.12;
  const seed = opts.seed ?? 0;
  const uvAround = opts.uvAround ?? 2;
  const uvLen = opts.uvLen ?? 2.5;
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = rFn(t);
    const n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      N.set(n.x * ca + b.x * sa, n.y * ca + b.y * sa, n.z * ca + b.z * sa);
      const k = 1 + noiseAmt * noise3(P.x * 0.6 + ca * 0.8 + seed, P.y * 0.6 + sa * 0.8, P.z * 0.6);
      pos.push(P.x + N.x * r * k, P.y + N.y * r * k, P.z + N.z * r * k);
      nrm.push(N.x, N.y, N.z);
      uv.push((j / radial) * uvAround, (t * len) / uvLen);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // End caps. 'dome' closes the tube with a rounded bark tip (same geometry);
  // 'flat' makes a separate disc (g.userData.caps) for an end-grain material.
  const caps = [];
  for (const [which, mode] of [[0, opts.capStart], [1, opts.capEnd === true ? 'dome' : opts.capEnd]]) {
    if (!mode) continue;
    const i = which ? segs : 0;
    const base = i * (radial + 1);
    curve.getPointAt(which, P);
    const tng = curve.getTangentAt(which).clone();
    if (!which) tng.negate(); // outward
    const r = rFn(which);
    if (mode === 'dome') {
      const rings = 3;
      let prev = base;
      for (let k = 1; k <= rings; k++) {
        const t = k / rings;
        const out = Math.sin(t * Math.PI / 2) * r * 0.7;
        const shrink = Math.cos(t * Math.PI / 2);
        const start = pos.length / 3;
        for (let j = 0; j <= radial; j++) {
          const vx = pos[(base + j) * 3] - P.x, vy = pos[(base + j) * 3 + 1] - P.y, vz = pos[(base + j) * 3 + 2] - P.z;
          pos.push(P.x + vx * shrink + tng.x * out, P.y + vy * shrink + tng.y * out, P.z + vz * shrink + tng.z * out);
          nrm.push(0, 1, 0);
          uv.push((j / radial) * uvAround, ((which ? 1 : 0) * len + (which ? 1 : -1) * t * r) / uvLen);
        }
        for (let j = 0; j < radial; j++) {
          const a = prev + j, b = start + j;
          if (which) idx.push(a, b, a + 1, b, b + 1, a + 1);
          else idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
        prev = start;
      }
    } else {
      const cp = [], cu = [], ci = [];
      cp.push(P.x + tng.x * 0.01, P.y + tng.y * 0.01, P.z + tng.z * 0.01);
      cu.push(0.5, 0.5);
      for (let j = 0; j <= radial; j++) {
        const vx = pos[(base + j) * 3] - P.x, vy = pos[(base + j) * 3 + 1] - P.y, vz = pos[(base + j) * 3 + 2] - P.z;
        cp.push(P.x + vx + tng.x * 0.01, P.y + vy + tng.y * 0.01, P.z + vz + tng.z * 0.01);
        const a = (j / radial) * Math.PI * 2;
        const k = Math.hypot(vx, vy, vz) / (r * 1.12);
        cu.push(0.5 + Math.cos(a) * 0.5 * k, 0.5 + Math.sin(a) * 0.5 * k);
      }
      for (let j = 0; j < radial; j++) {
        if (which) ci.push(0, j + 1, j + 2);
        else ci.push(0, j + 2, j + 1);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
      cg.setIndex(ci);
      cg.computeVertexNormals();
      caps.push(cg);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.caps = caps;
  return g;
}

/** Organic tree trunk with buttress flare. */
export function trunkGeo(x, z, y0, y1, r0, r1, opts = {}) {
  const segsY = opts.segsY ?? Math.ceil((y1 - y0) / 1.2);
  const radial = opts.radial ?? 20;
  const seed = opts.seed ?? 0;
  const buttress = opts.buttress ?? 0;
  const nB = opts.nButtress ?? 5;
  const pos = [], uv = [], idx = [];
  const R = rng(seed + 7);
  const bPhase = R() * Math.PI * 2;
  for (let i = 0; i <= segsY; i++) {
    const t = i / segsY;
    const y = y0 + (y1 - y0) * t;
    const h = y - y0;
    let r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    const flare = Math.exp(-h / 2.2) * buttress;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Buttress fins: sharp lobes near the ground.
      const lobe = Math.pow(Math.max(0, Math.cos((a + bPhase) * nB)), 6) * flare;
      const n = noise3(ca * 1.2 + seed, sa * 1.2, y * 0.18) * 0.12 + noise3(ca * 3 + seed, sa * 3, y * 0.5) * 0.05;
      const rr = r * (1 + n) + lobe + flare * 0.25;
      pos.push(x + ca * rr, y, z + sa * rr);
      uv.push((j / radial) * Math.max(2, Math.round(r0 * 1.6)), h / 4);
    }
  }
  for (let i = 0; i < segsY; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Close the top with a shallow dome so the trunk never reads hollow from above.
  {
    const top = segsY * (radial + 1);
    const c = pos.length / 3;
    pos.push(x, y1 + r1 * 0.35, z);
    uv.push(0.5, (y1 - y0) / 4 + 0.1);
    for (let j = 0; j < radial; j++) idx.push(top + j + 1, top + j, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lumpy rock from a displaced icosahedron. */
export function rockGeo(sx, sy, sz, seed = 0, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(x * 1.6 + seed, y * 1.6, z * 1.6) * 0.28 + noise3(x * 4 + seed, y * 4, z * 4) * 0.08;
    const k = 1 + n;
    // Flatten bottom & top a bit.
    y = y > 0 ? Math.min(y, 0.75) : Math.max(y, -0.6);
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  // Triplanar-ish uv
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay > 0.6) uv.setXY(i, x / 3, z / 3);
    else if (ax > 0.5) uv.setXY(i, z / 3, y / 3);
    else uv.setXY(i, x / 3, y / 3);
  }
  return g;
}

/** Leaf card cluster: crossed quads using one tile of the 2x2 leaf atlas. */
export function leafCardGeo(tile, opts = {}) {
  const u0 = (tile % 2) * 0.5, v0 = tile < 2 ? 0.5 : 0;
  const planes = opts.planes ?? 3;
  const geos = [];
  for (let i = 0; i < planes; i++) {
    const g = new THREE.PlaneGeometry(1, 1, 2, 2);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.5, v0 + uv.getY(k) * 0.5);
    if (opts.upright) {
      g.translate(0, 0.5, 0);
      g.rotateY((i / planes) * Math.PI);
      g.rotateX((Math.random() - 0.5) * 0.2);
    } else {
      g.rotateY((i / planes) * Math.PI);
      g.rotateX((i % 2 ? 1 : -1) * 0.35);
    }
    geos.push(g);
  }
  if (opts.flat) {
    const g = new THREE.PlaneGeometry(1, 1, 2, 2);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.5, v0 + uv.getY(k) * 0.5);
    g.rotateX(-Math.PI / 2);
    geos.push(g);
  }
  const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()));
  // sway weight: grows with height above base / distance from center
  const p = merged.attributes.position;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    sway[i] = opts.upright ? Math.max(0, p.getY(i)) : Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) * 1.5 + 0.2);
  }
  merged.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  merged.computeVertexNormals();
  // Normals pointing up-ish look better for foliage lighting.
  const nr = merged.attributes.normal;
  for (let i = 0; i < nr.count; i++) {
    const x = nr.getX(i) * 0.4, y = Math.abs(nr.getY(i)) * 0.4 + 0.6, z = nr.getZ(i) * 0.4;
    const l = Math.hypot(x, y, z);
    nr.setXYZ(i, x / l, y / l, z / l);
  }
  return merged;
}

/** Catenary-ish sag curve between two points. */
export function sagPoints(a, b, sag, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  return pts;
}
