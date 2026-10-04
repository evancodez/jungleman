// Grindable paths: branches, vine ropes, bridge ropes, roof ridges, stone ledges
// and zip-vines. Each rail is a densely sampled polyline with arc-length lookup.
import * as THREE from 'three';
import { clamp } from '../core/math.js';

const SPACING = 0.2;

export const RAIL_KINDS = {
  branch: { name: 'Branch Slide', offset: true, hang: false, points: 1.0, sound: 'bark' },
  log: { name: 'Log Ride', offset: true, hang: false, points: 1.0, sound: 'bark' },
  rope: { name: 'Rope Walk', offset: true, hang: false, points: 1.3, sound: 'rope' },
  stone: { name: 'Ledge Grind', offset: true, hang: false, points: 1.1, sound: 'stone' },
  roof: { name: 'Ridge Run', offset: true, hang: false, points: 1.2, sound: 'thatch' },
  zip: { name: 'Zip Vine', offset: false, hang: true, points: 0.8, sound: 'zip' },
  rail: { name: 'Rail Slide', offset: true, hang: false, points: 1.0, sound: 'wood' },
};

let RAIL_ID = 1;

export class Rail {
  /**
   * @param {THREE.Vector3[]} pts control points
   * @param {object} opts {kind, radius, smooth, name}
   */
  constructor(pts, opts = {}) {
    this.id = RAIL_ID++;
    this.kind = opts.kind || 'branch';
    this.info = RAIL_KINDS[this.kind];
    this.radius = opts.radius ?? 0.25;
    this.r0 = opts.r0 ?? this.radius;
    this.r1 = opts.r1 ?? this.radius;
    this.name = opts.name || this.info.name;
    this.hang = this.info.hang;
    this.oneWay = !!opts.oneWay; // zip lines: only ride downhill
    this.minSpeed = opts.minSpeed ?? (this.hang ? 6 : 3.5);
    this.gap = opts.gap || null;
    let curve;
    if (pts.length === 2 || opts.smooth === false) {
      curve = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    } else {
      curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    }
    this.curve = curve;
    const approxLen = curve.getLength();
    const n = Math.max(2, Math.ceil(approxLen / SPACING));
    this.pts = [];
    this.s = [];
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt ? curve.getPointAt(i / n) : curve.getPoint(i / n);
      if (i > 0) acc += p.distanceTo(this.pts[i - 1]);
      this.pts.push(p);
      this.s.push(acc);
    }
    this.length = acc;
    this.min = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of this.pts) { this.min.min(p); this.max.max(p); }
  }

  radiusAt(s) {
    return this.r0 + (this.r1 - this.r0) * clamp(s / (this.length || 1), 0, 1);
  }

  /** Index of the segment containing arc length s. */
  _seg(s) {
    s = clamp(s, 0, this.length);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.s[m] <= s) lo = m; else hi = m;
    }
    return lo;
  }
  pointAt(s, out) {
    const i = this._seg(s);
    const s0 = this.s[i], s1 = this.s[i + 1];
    const t = s1 > s0 ? clamp((s - s0) / (s1 - s0), 0, 1) : 0;
    return out.lerpVectors(this.pts[i], this.pts[i + 1], t);
  }
  tangentAt(s, out) {
    // Smooth tangent from a small finite difference window.
    const a = clamp(s - 0.35, 0, this.length), b = clamp(s + 0.35, 0, this.length);
    this.pointAt(b, out);
    this.pointAt(a, _tmp);
    out.sub(_tmp);
    const l = out.length();
    if (l < 1e-6) {
      const i = this._seg(s);
      out.subVectors(this.pts[i + 1], this.pts[i]).normalize();
    } else out.multiplyScalar(1 / l);
    return out;
  }
  /** Closest arc length to p (brute force over samples; rails are short). */
  closest(p, out) {
    let best = Infinity, bestS = 0;
    const pts = this.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const l2 = abx * abx + aby * aby + abz * abz;
      let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
      t = clamp(t, 0, 1);
      const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestS = this.s[i] + (this.s[i + 1] - this.s[i]) * t; }
    }
    out.s = bestS;
    out.dist = Math.sqrt(best);
    return out;
  }
}
const _tmp = new THREE.Vector3();

export class RailSet {
  constructor() { this.rails = []; }
  add(rail) { this.rails.push(rail); return rail; }

  /**
   * Find the best rail to snap to from player feet position `feet`.
   * Returns {rail, s, dist} or null.
   */
  findSnap(feet, vel, opts = {}) {
    const reachH = opts.reachH ?? 1.4;
    const best = { rail: null, s: 0, dist: Infinity, score: Infinity };
    const tmp = { s: 0, dist: 0 };
    const probe = _probe;
    for (const rail of this.rails) {
      if (opts.exclude && opts.exclude(rail)) continue;
      const hangOff = rail.hang ? 2.05 : -(rail.r0 + rail.r1) * 0.5;
      // Reference point: where the rail would be relative to the player.
      probe.set(feet.x, feet.y + hangOff, feet.z);
      if (probe.x < rail.min.x - reachH - 1 || probe.x > rail.max.x + reachH + 1 ||
          probe.z < rail.min.z - reachH - 1 || probe.z > rail.max.z + reachH + 1 ||
          probe.y < rail.min.y - 3 || probe.y > rail.max.y + 3) continue;
      rail.closest(probe, tmp);
      rail.pointAt(tmp.s, _pt);
      const dx = _pt.x - probe.x, dz = _pt.z - probe.z;
      const dh = Math.hypot(dx, dz);
      const dy = _pt.y - probe.y; // + : rail above expected position
      if (dh > reachH) continue;
      // Vertical window: generous when falling onto it, smaller when it is above us.
      const up = rail.hang ? 1.1 : (opts.upReach ?? 0.9);
      const down = rail.hang ? 1.0 : (opts.downReach ?? 1.4);
      if (dy > up || dy < -down) continue;
      const score = dh + Math.abs(dy) * 0.6;
      if (score < best.score) { best.rail = rail; best.s = tmp.s; best.dist = dh; best.score = score; }
    }
    return best.rail ? best : null;
  }
}
const _probe = new THREE.Vector3();
const _pt = new THREE.Vector3();
