// Static collision world: oriented boxes, vertical cylinders, capsules and a
// heightfield terrain. The player is always an upright capsule, which keeps
// the narrow-phase tests simple and robust.
import * as THREE from 'three';
import { clamp, segmentClosestT, segmentSegmentST } from '../core/math.js';

let NEXT_ID = 1;
const _ss = { s: 0, t: 0 };
const _p1 = new THREE.Vector3(), _q1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _q2 = new THREE.Vector3();

class Collider {
  constructor(tag = 'ground', opts = {}) {
    this.id = NEXT_ID++;
    this.tag = tag; // ground | wood | stone | bark | trunk | moss | bounce | mud | rock | leaf
    this.min = new THREE.Vector3();
    this.max = new THREE.Vector3();
    this.climbable = !!opts.climbable;
    this.wallRun = opts.wallRun !== undefined ? !!opts.wallRun : false;
    this.bounce = opts.bounce || 0;
    this.noMantle = !!opts.noMantle;
    this.noCamera = !!opts.noCamera;
    this.name = opts.name || '';
    this.data = opts.data || null;
    this._stamp = 0;
  }
}

/** Oriented box. `quat` rotates the local axes. */
export class BoxCollider extends Collider {
  constructor(center, half, quat = null, tag = 'ground', opts = {}) {
    super(tag, opts);
    this.type = 'box';
    this.c = center.clone();
    this.h = half.clone();
    this.q = quat ? quat.clone() : new THREE.Quaternion();
    this.ax = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    this.ay = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    this.az = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    const ex = Math.abs(this.ax.x) * this.h.x + Math.abs(this.ay.x) * this.h.y + Math.abs(this.az.x) * this.h.z;
    const ey = Math.abs(this.ax.y) * this.h.x + Math.abs(this.ay.y) * this.h.y + Math.abs(this.az.y) * this.h.z;
    const ez = Math.abs(this.ax.z) * this.h.x + Math.abs(this.ay.z) * this.h.y + Math.abs(this.az.z) * this.h.z;
    this.min.set(this.c.x - ex, this.c.y - ey, this.c.z - ez);
    this.max.set(this.c.x + ex, this.c.y + ey, this.c.z + ez);
    this.flatTop = this.ay.y > 0.999;
  }
  toLocal(x, y, z, out) {
    const dx = x - this.c.x, dy = y - this.c.y, dz = z - this.c.z;
    out.x = dx * this.ax.x + dy * this.ax.y + dz * this.ax.z;
    out.y = dx * this.ay.x + dy * this.ay.y + dz * this.ay.z;
    out.z = dx * this.az.x + dy * this.az.y + dz * this.az.z;
    return out;
  }
  toWorldDir(lx, ly, lz, out) {
    out.x = this.ax.x * lx + this.ay.x * ly + this.az.x * lz;
    out.y = this.ax.y * lx + this.ay.y * ly + this.az.y * lz;
    out.z = this.ax.z * lx + this.ay.z * ly + this.az.z * lz;
    return out;
  }
  /** Contact against an upright capsule segment (x, y0..y1, z) of radius r. */
  contact(x, y0, y1, z, r, out) {
    const a = this.toLocal(x, y0, z, _p1);
    const b = this.toLocal(x, y1, z, _q1);
    const hx = this.h.x, hy = this.h.y, hz = this.h.z;
    let t = 0.5, px = 0, py = 0, pz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 4; i++) {
      px = a.x + (b.x - a.x) * t; py = a.y + (b.y - a.y) * t; pz = a.z + (b.z - a.z) * t;
      cx = clamp(px, -hx, hx); cy = clamp(py, -hy, hy); cz = clamp(pz, -hz, hz);
      t = segmentClosestT(a.x, a.y, a.z, b.x, b.y, b.z, cx, cy, cz);
    }
    px = a.x + (b.x - a.x) * t; py = a.y + (b.y - a.y) * t; pz = a.z + (b.z - a.z) * t;
    cx = clamp(px, -hx, hx); cy = clamp(py, -hy, hy); cz = clamp(pz, -hz, hz);
    let dx = px - cx, dy = py - cy, dz = pz - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return 0;
    let depth;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      depth = r - d;
      dx /= d; dy /= d; dz /= d;
    } else {
      // Segment point inside the box: push out through the nearest face,
      // preferring the top face when the bottom of the capsule is near it.
      const fx = hx - Math.abs(px), fy = hy - Math.abs(py), fz = hz - Math.abs(pz);
      const topY = hy - Math.min(a.y, b.y);
      if (topY < 0.6 && topY < fx + 0.3 && topY < fz + 0.3) { dx = 0; dy = 1; dz = 0; depth = topY + r; }
      else if (fx <= fy && fx <= fz) { dx = Math.sign(px) || 1; dy = 0; dz = 0; depth = fx + r; }
      else if (fz <= fy) { dx = 0; dy = 0; dz = Math.sign(pz) || 1; depth = fz + r; }
      else { dx = 0; dy = Math.sign(py) || 1; dz = 0; depth = fy + r; }
    }
    this.toWorldDir(dx, dy, dz, out);
    return depth;
  }
  raycast(o, d, maxT) {
    const lo = this.toLocal(o.x, o.y, o.z, _p2);
    const ld = _q2.set(d.dot(this.ax), d.dot(this.ay), d.dot(this.az));
    let tmin = 0, tmax = maxT, nAxis = -1, nSign = 0;
    const h = [this.h.x, this.h.y, this.h.z];
    const oo = [lo.x, lo.y, lo.z];
    const dd = [ld.x, ld.y, ld.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dd[i]) < 1e-9) {
        if (oo[i] < -h[i] || oo[i] > h[i]) return -1;
      } else {
        let t1 = (-h[i] - oo[i]) / dd[i], t2 = (h[i] - oo[i]) / dd[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = i; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    if (nAxis < 0) return -1; // origin inside
    _rayNormal.set(0, 0, 0);
    if (nAxis === 0) _rayNormal.copy(this.ax).multiplyScalar(nSign);
    else if (nAxis === 1) _rayNormal.copy(this.ay).multiplyScalar(nSign);
    else _rayNormal.copy(this.az).multiplyScalar(nSign);
    return tmin;
  }
  /** Height of the top surface at x,z (for flat or tilted boxes), or null. */
  topAt(x, z) {
    // Intersect a downward ray from high above.
    _o.set(x, this.max.y + 1, z);
    const t = this.raycast(_o, _down, this.max.y - this.min.y + 2);
    if (t < 0 || _rayNormal.y < 0.3) return null;
    return _o.y - t;
  }
}
const _o = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _rayNormal = new THREE.Vector3();

/** Upright cylinder (tree trunks, pillars, mushroom caps, mesas). */
export class CylinderCollider extends Collider {
  constructor(x, z, radius, y0, y1, tag = 'trunk', opts = {}) {
    super(tag, opts);
    this.type = 'cyl';
    this.x = x; this.z = z; this.r = radius; this.y0 = y0; this.y1 = y1;
    this.min.set(x - radius, y0, z - radius);
    this.max.set(x + radius, y1, z + radius);
  }
  contact(x, y0, y1, z, r, out) {
    if (y1 + r < this.y0 || y0 - r > this.y1) return 0;
    let dx = x - this.x, dz = z - this.z;
    const d = Math.hypot(dx, dz);
    const R = this.r;
    if (y0 > this.y1 || y1 < this.y0) {
      // Capsule end sphere vs top/bottom disc.
      const ey = y0 > this.y1 ? y0 : y1;
      const cy = y0 > this.y1 ? this.y1 : this.y0;
      const k = d > R ? R / d : 1;
      const qx = this.x + dx * k, qz = this.z + dz * k;
      let vx = x - qx, vy = ey - cy, vz = z - qz;
      const l = Math.hypot(vx, vy, vz);
      if (l >= r) return 0;
      if (l < 1e-6) { out.set(0, ey >= cy ? 1 : -1, 0); return r; }
      out.set(vx / l, vy / l, vz / l);
      return r - l;
    }
    if (d >= R + r) return 0;
    if (d > R * 0.5 || d > R - 0.05) {
      if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
      // If the bottom of the capsule is just below the top, prefer standing on it.
      const top = this.y1 - y0 + r;
      if (top < 0.5 && d < R) { out.set(0, 1, 0); return top; }
      out.set(dx, 0, dz);
      return R + r - d;
    }
    const side = R + r - d;
    const top = this.y1 - y0 + r;
    const bottom = y1 + r - this.y0;
    if (top <= side && top <= bottom) { out.set(0, 1, 0); return top; }
    if (bottom < side) { out.set(0, -1, 0); return bottom; }
    if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    out.set(dx, 0, dz);
    return side;
  }
  raycast(o, d, maxT) {
    let best = -1;
    const ox = o.x - this.x, oz = o.z - this.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const b = ox * d.x + oz * d.z;
      const c = ox * ox + oz * oz - this.r * this.r;
      const disc = b * b - a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        if (t >= 0 && t <= maxT) {
          const y = o.y + d.y * t;
          if (y >= this.y0 && y <= this.y1) {
            best = t;
            _rayNormal.set(ox + d.x * t, 0, oz + d.z * t).normalize();
          }
        }
      }
    }
    if (Math.abs(d.y) > 1e-9) {
      for (const [cy, ny] of [[this.y1, 1], [this.y0, -1]]) {
        const t = (cy - o.y) / d.y;
        if (t >= 0 && t <= maxT && (best < 0 || t < best) && Math.sign(-d.y) === ny) {
          const px = ox + d.x * t, pz = oz + d.z * t;
          if (px * px + pz * pz <= this.r * this.r) { best = t; _rayNormal.set(0, ny, 0); }
        }
      }
    }
    return best;
  }
}

/** Capsule between points a and b (branches, logs). */
export class CapsuleCollider extends Collider {
  constructor(a, b, radius, tag = 'bark', opts = {}) {
    super(tag, opts);
    this.type = 'cap';
    this.a = a.clone(); this.b = b.clone(); this.r = radius;
    this.min.set(Math.min(a.x, b.x) - radius, Math.min(a.y, b.y) - radius, Math.min(a.z, b.z) - radius);
    this.max.set(Math.max(a.x, b.x) + radius, Math.max(a.y, b.y) + radius, Math.max(a.z, b.z) + radius);
  }
  contact(x, y0, y1, z, r, out) {
    _p1.set(x, y0, z); _q1.set(x, y1, z);
    segmentSegmentST(_p1, _q1, this.a, this.b, _ss);
    const px = x, py = y0 + (y1 - y0) * _ss.s, pz = z;
    const qx = this.a.x + (this.b.x - this.a.x) * _ss.t;
    const qy = this.a.y + (this.b.y - this.a.y) * _ss.t;
    const qz = this.a.z + (this.b.z - this.a.z) * _ss.t;
    let vx = px - qx, vy = py - qy, vz = pz - qz;
    const R = r + this.r;
    const l2 = vx * vx + vy * vy + vz * vz;
    if (l2 >= R * R) return 0;
    const l = Math.sqrt(l2);
    if (l < 1e-6) { out.set(0, 1, 0); return R; }
    out.set(vx / l, vy / l, vz / l);
    return R - l;
  }
  raycast(o, d, maxT) {
    // Inigo Quilez capsule intersection.
    const ba = _p2.subVectors(this.b, this.a);
    const oa = _q2.subVectors(o, this.a);
    const baba = ba.dot(ba), bard = ba.dot(d), baoa = ba.dot(oa), rdoa = d.dot(oa), oaoa = oa.dot(oa);
    const ra = this.r;
    let a = baba - bard * bard;
    let b = baba * rdoa - baoa * bard;
    let c = baba * oaoa - baoa * baoa - ra * ra * baba;
    let h = b * b - a * c;
    if (h >= 0 && Math.abs(a) > 1e-9) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t >= 0 && t <= maxT) {
        const k = y / baba;
        _rayNormal.set(o.x + d.x * t - (this.a.x + ba.x * k), o.y + d.y * t - (this.a.y + ba.y * k), o.z + d.z * t - (this.a.z + ba.z * k)).normalize();
        return t;
      }
      const ocx = y <= 0 ? oa.x : o.x - this.b.x, ocy = y <= 0 ? oa.y : o.y - this.b.y, ocz = y <= 0 ? oa.z : o.z - this.b.z;
      b = d.x * ocx + d.y * ocy + d.z * ocz;
      c = ocx * ocx + ocy * ocy + ocz * ocz - ra * ra;
      h = b * b - c;
      if (h > 0) {
        const t2 = -b - Math.sqrt(h);
        if (t2 >= 0 && t2 <= maxT) {
          _rayNormal.set(ocx + d.x * t2, ocy + d.y * t2, ocz + d.z * t2).normalize();
          return t2;
        }
      }
    }
    return -1;
  }
}

/** Sphere (boulders). */
export class SphereCollider extends Collider {
  constructor(c, radius, tag = 'rock', opts = {}) {
    super(tag, opts);
    this.type = 'sph';
    this.c = c.clone();
    this.r = radius;
    this.min.set(c.x - radius, c.y - radius, c.z - radius);
    this.max.set(c.x + radius, c.y + radius, c.z + radius);
  }
  contact(x, y0, y1, z, r, out) {
    const py = clamp(this.c.y, y0, y1);
    const vx = x - this.c.x, vy = py - this.c.y, vz = z - this.c.z;
    const R = r + this.r;
    const l2 = vx * vx + vy * vy + vz * vz;
    if (l2 >= R * R) return 0;
    const l = Math.sqrt(l2);
    if (l < 1e-6) { out.set(0, 1, 0); return R; }
    out.set(vx / l, vy / l, vz / l);
    return R - l;
  }
  raycast(o, d, maxT) {
    const ox = o.x - this.c.x, oy = o.y - this.c.y, oz = o.z - this.c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - this.r * this.r;
    const h = b * b - c;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    if (t < 0 || t > maxT) return -1;
    _rayNormal.set(ox + d.x * t, oy + d.y * t, oz + d.z * t).normalize();
    return t;
  }
}

/** Regular-grid heightfield. */
export class Heightfield {
  constructor(minX, minZ, size, res, heightFn, tagFn) {
    this.minX = minX; this.minZ = minZ; this.size = size; this.res = res;
    this.cell = size / res;
    this.h = new Float32Array((res + 1) * (res + 1));
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        this.h[j * (res + 1) + i] = heightFn(minX + i * this.cell, minZ + j * this.cell);
      }
    }
    this.tagFn = tagFn || (() => 'ground');
  }
  heightAt(x, z) {
    const fx = clamp((x - this.minX) / this.cell, 0, this.res - 1e-4);
    const fz = clamp((z - this.minZ) / this.cell, 0, this.res - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const R = this.res + 1;
    const h00 = this.h[j * R + i], h10 = this.h[j * R + i + 1];
    const h01 = this.h[(j + 1) * R + i], h11 = this.h[(j + 1) * R + i + 1];
    // Triangulated like the render mesh (diagonal from 00 to 11).
    if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  normalAt(x, z, out) {
    const e = this.cell * 0.75;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }
  tagAt(x, z) { return this.tagFn(x, z); }
  raycast(o, d, maxT) {
    const step = this.cell * 0.5;
    let tPrev = 0;
    let above = o.y - this.heightAt(o.x, o.z);
    if (above < 0) return -1;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = Math.min(t, maxT);
      const y = o.y + d.y * tt;
      const h = this.heightAt(o.x + d.x * tt, o.z + d.z * tt);
      if (y < h) {
        let lo = tPrev, hi = tt;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < this.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m;
        }
        this.normalAt(o.x + d.x * lo, o.z + d.z * lo, _rayNormal);
        return lo;
      }
      tPrev = tt;
      if (tt >= maxT) break;
    }
    return -1;
  }
}

const _n = new THREE.Vector3();

export class CollisionWorld {
  constructor() {
    this.colliders = [];
    this.terrain = null;
    this.cellSize = 6;
    this.grid = new Map();
    this.stamp = 0;
    this.waterLevel = -1;
    this.waterFn = null; // (x,z) => water surface y or -Infinity
  }
  add(c) {
    this.colliders.push(c);
    const cs = this.cellSize;
    const i0 = Math.floor(c.min.x / cs), i1 = Math.floor(c.max.x / cs);
    const k0 = Math.floor(c.min.z / cs), k1 = Math.floor(c.max.z / cs);
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const key = i * 73856093 ^ k * 19349663;
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(c);
    }
    return c;
  }
  query(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this.stamp;
    const cs = this.cellSize;
    const i0 = Math.floor(minX / cs), i1 = Math.floor(maxX / cs);
    const k0 = Math.floor(minZ / cs), k1 = Math.floor(maxZ / cs);
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const arr = this.grid.get(i * 73856093 ^ k * 19349663);
      if (!arr) continue;
      for (const c of arr) {
        if (c._stamp === stamp) continue;
        c._stamp = stamp;
        if (c.max.x < minX || c.min.x > maxX || c.max.y < minY || c.min.y > maxY || c.max.z < minZ || c.min.z > maxZ) continue;
        out.push(c);
      }
    }
    return out;
  }

  /**
   * Gather penetration contacts for an upright capsule whose feet are at `p`.
   * Each contact: {nx,ny,nz,depth,col,tag}
   */
  capsuleContacts(p, r, h, contacts) {
    contacts.length = 0;
    const y0 = p.y + r, y1 = p.y + h - r;
    const cands = this.query(p.x - r, p.y, p.z - r, p.x + r, p.y + h, p.z + r, _cands);
    for (const c of cands) {
      const depth = c.contact(p.x, y0, y1, p.z, r, _n);
      if (depth > 1e-5) contacts.push({ nx: _n.x, ny: _n.y, nz: _n.z, depth, col: c, tag: c.tag });
    }
    if (this.terrain) {
      const t = this.terrain;
      const hh = t.heightAt(p.x, p.z);
      t.normalAt(p.x, p.z, _n);
      const dist = (y0 - hh) * _n.y;
      if (dist < r) contacts.push({ nx: _n.x, ny: _n.y, nz: _n.z, depth: r - dist, col: null, tag: t.tagAt(p.x, p.z) });
    }
    return contacts;
  }

  /** Raycast against everything. Returns {t, point, normal, col} or null. */
  raycast(o, d, maxT, opts = {}) {
    const ex = Math.max(0, maxT);
    const minX = Math.min(o.x, o.x + d.x * ex), maxX = Math.max(o.x, o.x + d.x * ex);
    const minY = Math.min(o.y, o.y + d.y * ex), maxY = Math.max(o.y, o.y + d.y * ex);
    const minZ = Math.min(o.z, o.z + d.z * ex), maxZ = Math.max(o.z, o.z + d.z * ex);
    const cands = this.query(minX, minY, minZ, maxX, maxY, maxZ, _cands);
    let best = maxT, bestCol = null, hit = false;
    const bestN = _bestN;
    for (const c of cands) {
      if (opts.camera && c.noCamera) continue;
      if (opts.ignore && opts.ignore(c)) continue;
      const t = c.raycast(o, d, best);
      if (t >= 0 && t < best) { best = t; bestCol = c; hit = true; bestN.copy(_rayNormal); }
    }
    if (this.terrain && !opts.noTerrain) {
      const t = this.terrain.raycast(o, d, best);
      if (t >= 0 && t < best) { best = t; bestCol = null; hit = true; bestN.copy(_rayNormal); }
    }
    if (!hit) return null;
    return {
      t: best,
      point: new THREE.Vector3().copy(o).addScaledVector(d, best),
      normal: bestN.clone(),
      col: bestCol,
      tag: bestCol ? bestCol.tag : this.terrain.tagAt(o.x + d.x * best, o.z + d.z * best),
    };
  }

  /** Highest walkable surface below (x, yTop, z) down to yBottom. */
  groundBelow(x, yTop, z, depth) {
    _ro.set(x, yTop, z);
    const hit = this.raycast(_ro, _down, depth);
    return hit && hit.normal.y > 0.55 ? hit : null;
  }

  /** True if an upright capsule at p overlaps nothing (beyond `slack`). */
  capsuleFree(p, r, h, slack = 0.02) {
    const cs = this.capsuleContacts(p, r, h, _tmpContacts);
    for (const c of cs) if (c.depth > slack) return false;
    return true;
  }

  waterAt(x, z) {
    return this.waterFn ? this.waterFn(x, z) : -Infinity;
  }
}
const _cands = [];
const _tmpContacts = [];
const _bestN = new THREE.Vector3();
const _ro = new THREE.Vector3();
