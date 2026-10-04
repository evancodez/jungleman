// Swingable vines: rigid-rope pendulum gameplay with a verlet-simulated visual rope.
import * as THREE from 'three';
import { clamp } from '../core/math.js';

export const VINE_NODES = 18;

let VINE_ID = 1;

export class Vine {
  constructor(anchor, length, opts = {}) {
    this.id = VINE_ID++;
    this.anchor = anchor.clone();
    this.length = length;
    this.n = VINE_NODES;
    this.seg = length / (this.n - 1);
    this.p = [];
    this.pp = [];
    this.phase = opts.phase ?? Math.random() * 10;
    this.name = opts.name || 'Vine';
    for (let i = 0; i < this.n; i++) {
      const v = new THREE.Vector3(anchor.x, anchor.y - i * this.seg, anchor.z);
      this.p.push(v);
      this.pp.push(v.clone());
    }
    this.held = false;
    this.holdDist = 0;
    this.hand = new THREE.Vector3();
    this.min = new THREE.Vector3(anchor.x - length, anchor.y - length - 1, anchor.z - length);
    this.max = new THREE.Vector3(anchor.x + length, anchor.y + 0.5, anchor.z + length);
    this.pushImpulse = new THREE.Vector3();
  }

  update(dt, time) {
    const g = 14;
    const damping = 0.985;
    const n = this.n;
    const wind = Math.sin(time * 0.7 + this.phase) * 0.6 + Math.sin(time * 1.9 + this.phase * 2.3) * 0.25;
    const k = this.held ? clamp(Math.round(this.holdDist / this.seg), 1, n - 1) : -1;
    for (let i = 1; i < n; i++) {
      const p = this.p[i], pp = this.pp[i];
      const vx = (p.x - pp.x) * damping, vy = (p.y - pp.y) * damping, vz = (p.z - pp.z) * damping;
      pp.copy(p);
      const w = i / n;
      p.x += vx + (wind * 0.35 * w + this.pushImpulse.x) * dt * dt * 10;
      p.y += vy - g * dt * dt;
      p.z += vz + (wind * 0.22 * w + this.pushImpulse.z) * dt * dt * 10;
    }
    this.pushImpulse.multiplyScalar(Math.exp(-dt * 4));
    this.p[0].copy(this.anchor);
    if (this.held) {
      // Taut section: straight line from anchor to hand.
      for (let i = 1; i <= k; i++) {
        const t = i / k;
        this.p[i].lerpVectors(this.anchor, this.hand, t);
        this.pp[i].copy(this.p[i]);
      }
    }
    for (let it = 0; it < 12; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = this.p[i], b = this.p[i + 1];
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - this.seg) / d;
        const pinA = i === 0 || (this.held && i <= k);
        const pinB = this.held && i + 1 <= k;
        if (pinA && pinB) continue;
        if (pinA) { b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff; }
        else if (pinB) { a.x += dx * diff; a.y += dy * diff; a.z += dz * diff; }
        else {
          dx *= 0.5 * diff; dy *= 0.5 * diff; dz *= 0.5 * diff;
          a.x += dx; a.y += dy; a.z += dz;
          b.x -= dx; b.y -= dy; b.z -= dz;
        }
      }
    }
  }

  /** Closest point on the current rope shape to p. Returns {dist, along, point}. */
  closest(p, out) {
    let best = Infinity, along = 0;
    for (let i = 0; i < this.n - 1; i++) {
      const a = this.p[i], b = this.p[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const l2 = abx * abx + aby * aby + abz * abz;
      let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
      t = clamp(t, 0, 1);
      const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        along = (i + t) * this.seg;
        out.point.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
      }
    }
    out.dist = Math.sqrt(best);
    out.along = along;
    return out;
  }
}

export class VineSet {
  constructor() { this.vines = []; }
  add(v) { this.vines.push(v); return v; }
  update(dt, time, focus) {
    for (const v of this.vines) {
      // Simulate nearby vines every frame, distant ones at a lower rate.
      if (!focus || v.held || v.anchor.distanceToSquared(focus) < 90 * 90) v.update(dt, time);
    }
  }
  findGrab(hand, reach, exclude) {
    let best = null;
    const tmp = { dist: 0, along: 0, point: new THREE.Vector3() };
    for (const v of this.vines) {
      if (exclude && exclude(v)) continue;
      if (hand.x < v.min.x - reach || hand.x > v.max.x + reach || hand.z < v.min.z - reach || hand.z > v.max.z + reach) continue;
      if (hand.y > v.max.y + reach || hand.y < v.min.y - reach) continue;
      v.closest(hand, tmp);
      if (tmp.along < 2.2) continue;
      if (tmp.dist < reach && (!best || tmp.dist < best.dist)) {
        best = { vine: v, dist: tmp.dist, along: tmp.along, point: tmp.point.clone() };
      }
    }
    return best;
  }
}
