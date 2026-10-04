// Procedural animation: computes a target pose for every joint from the
// player's movement state each frame and blends toward it. Locomotion cycles
// are analytic (driven by the physical stride phase) so blending acts as a
// free cross-fade between states.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, dampT, wrapAngle, TAU } from '../core/math.js';

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UPV = new THREE.Vector3(0, 1, 0);

function blankPose() {
  const p = { hipY: 0, hipZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0, rate: 16 };
  for (const j of JOINTS) p[j] = [0, 0, 0];
  return p;
}
function set(p, j, x, y = 0, z = 0) { p[j][0] = x; p[j][1] = y; p[j][2] = z; }
function add(p, j, x, y = 0, z = 0) { p[j][0] += x; p[j][1] += y; p[j][2] += z; }
/** Symmetric arms/legs: z mirrored. */
function arms(p, ux, uz, fx, uy = 0) { set(p, 'upperArmL', ux, uy, uz); set(p, 'upperArmR', ux, -uy, -uz); set(p, 'foreArmL', fx); set(p, 'foreArmR', fx); }
function legs(p, tx, tz, sx) { set(p, 'thighL', tx, 0, tz); set(p, 'thighR', tx, 0, -tz); set(p, 'shinL', sx); set(p, 'shinR', sx); }

export class Animator {
  constructor(character) {
    this.c = character;
    this.pose = blankPose();
    this.pivotQ = new THREE.Quaternion();
    this.hipY = 0;
    this.hipZ = 0;
    this.turnRate = 0;
    this.lastYaw = 0;
    this.lean = 0;
    this.prevState = '';
    this.blendBoost = 0;
    this.airPhase = 0;
    this.rootQ = new THREE.Quaternion();
    this.prevVel = new THREE.Vector3();
  }

  update(dt, pl, time) {
    this.dt = dt;
    const c = this.c;
    const P = blankPose();
    const st = pl.state;
    if (st !== this.prevState) { this.blendBoost = 0.18; this.prevState = st; }
    this.blendBoost = Math.max(0, this.blendBoost - dt);
    const hs = pl.hspeed;

    // Turn rate for banking.
    const yawD = wrapAngle(pl.yaw - this.lastYaw);
    this.lastYaw = pl.yaw;
    this.turnRate = lerp(this.turnRate, clamp(yawD / Math.max(dt, 1e-4), -6, 6), dampT(10, dt));

    let rootYaw = pl.yaw;
    let alignUp = null; // world up vector override for the root (swing)

    switch (st) {
      case 'ground': this.groundPose(P, pl, time, hs); break;
      case 'air': this.airPose(P, pl, time, dt); break;
      case 'grind': this.grindPose(P, pl, time); break;
      case 'swing': alignUp = this.swingPose(P, pl, time); break;
      case 'wallrun': this.wallrunPose(P, pl, time); break;
      case 'climb': this.climbPose(P, pl, time); break;
      case 'mantle': this.mantlePose(P, pl); break;
      case 'swim': this.swimPose(P, pl, time); break;
      case 'bail': this.bailPose(P, pl, time); break;
    }
    if (pl.state === 'air' && pl.spin.active) rootYaw += pl.spin.angle * pl.spin.dir;

    // ---- apply root
    const root = c.root;
    root.position.copy(pl.pos).add(pl.visOffset);
    _q.setFromAxisAngle(UPV, rootYaw);
    if (alignUp) {
      _q2.setFromUnitVectors(UPV, alignUp);
      _q.premultiply(_q2);
    }
    // Smooth root rotation (prevents pops on snaps), quick but not instant.
    if (pl.state === 'air' && pl.spin.active) this.rootQ.copy(_q);
    else {
      this.rootQ.slerp(_q, dampT(alignUp ? 14 : 22, dt));
      if (this.rootQ.angleTo(_q) > 1.4) this.rootQ.slerp(_q, 0.5);
    }
    root.quaternion.copy(this.rootQ);

    // ---- pivot (flips, leans)
    _e.set(P.pivotX, P.pivotY, P.pivotZ, 'YXZ');
    _q.setFromEuler(_e);
    const fast = P.rate >= 40;
    this.pivotQ.slerp(_q, fast ? 1 : dampT(P.rate * 0.8 + this.blendBoost * 60, dt));
    c.pivot.quaternion.copy(this.pivotQ);
    this.hipY = lerp(this.hipY, P.hipY, dampT(18, dt));
    this.hipZ = lerp(this.hipZ, P.hipZ, dampT(18, dt));
    c.joints.hips.position.y = 0.98 + this.hipY;
    c.joints.hips.position.z = this.hipZ;

    // ---- joints
    const k = dampT(P.rate + this.blendBoost * 70, dt);
    for (const j of JOINTS) {
      const t = P[j];
      _e.set(t[0], t[1], t[2], 'XYZ');
      _q.setFromEuler(_e);
      c.joints[j].quaternion.slerp(_q, k);
    }

    this.secondary(dt, pl, time, hs);
  }

  // ------------------------------------------------------------ states
  groundPose(P, pl, time, hs) {
    const a = clamp(hs / 10.5, 0, 1.25);
    const ph = pl.footPhase * TAU;
    const s = Math.sin(ph), co = Math.cos(ph);
    if (pl.rollT >= 0) {
      // Forward roll out of a hard landing, then into the slide.
      const t = clamp(pl.rollT / 0.45, 0, 1);
      P.pivotX = t * TAU;
      P.hipY = -0.45 * Math.sin(t * Math.PI);
      const tuck = Math.sin(t * Math.PI);
      legs(P, -2.0 * tuck - 0.2, 0.08, 2.2 * tuck + 0.2);
      set(P, 'spine', 0.6 * tuck); set(P, 'neck', 0.4 * tuck);
      arms(P, -1.2 * tuck - 0.2, 0.3, -1.4 * tuck);
      P.rate = 40;
      return;
    }
    if (pl.sliding) {
      P.hipY = -0.52;
      P.pivotX = -0.25;
      set(P, 'spine', -0.15); set(P, 'chest', -0.1); set(P, 'neck', 0.35); set(P, 'head', 0.1);
      set(P, 'thighL', -1.45, 0, 0.1); set(P, 'shinL', 0.15); set(P, 'footL', -0.3);
      set(P, 'thighR', -0.2, 0, -0.35); set(P, 'shinR', 2.1); set(P, 'footR', 0.4);
      set(P, 'upperArmR', 0.5, 0, -0.55); set(P, 'foreArmR', -0.2);
      set(P, 'upperArmL', -0.9, 0, 0.9); set(P, 'foreArmL', -0.4);
      this.lean = lerp(this.lean, clamp(-this.turnRate * 0.12, -0.4, 0.4), 0.2);
      P.pivotZ = this.lean;
      return;
    }
    if (pl.skidding) {
      P.hipY = -0.28;
      set(P, 'spine', -0.35); set(P, 'chest', -0.1); set(P, 'neck', 0.3);
      set(P, 'thighL', -1.0, 0, 0.15); set(P, 'shinL', 0.35); set(P, 'footL', -0.4);
      set(P, 'thighR', 0.25, 0, -0.15); set(P, 'shinR', 1.1);
      arms(P, -1.2, 0.7, -0.3);
      P.pivotY = 0.5;
      P.rate = 22;
      return;
    }
    if (pl.tauntT >= 0) {
      const t = pl.tauntT;
      set(P, 'spine', -0.15); set(P, 'chest', -0.12);
      legs(P, 0, 0.12, 0.15);
      P.hipY = -0.06;
      if (t < 1.0) {
        const beat = Math.sin(t * 16);
        set(P, 'upperArmL', -0.75 + (beat > 0 ? 0.25 : -0.1), 0, -0.25); set(P, 'foreArmL', -2.3);
        set(P, 'upperArmR', -0.75 + (beat < 0 ? 0.25 : -0.1), 0, 0.25); set(P, 'foreArmR', -2.3);
        set(P, 'neck', -0.05);
      } else {
        // Head back, arms wide: the jungle call.
        arms(P, -0.6, 1.25, -0.6);
        set(P, 'neck', -0.45); set(P, 'head', -0.2);
      }
      P.rate = 24;
      return;
    }
    // Idle -> run blend.
    const idle = 1 - clamp(a * 3, 0, 1);
    const breathe = Math.sin(time * 2.1);
    this.idleT = idle > 0.9 ? (this.idleT || 0) + this.dt : 0;
    // Idle.
    P.hipY = -0.02 * idle;
    set(P, 'spine', 0.04 * idle);
    set(P, 'chest', (0.02 + breathe * 0.025) * idle);
    // After standing a while, glance around the jungle.
    const look = smoothstep(2.5, 4, this.idleT) * idle;
    const glance = Math.sin(time * 0.45) * 0.7 + Math.sin(time * 1.1) * 0.15;
    set(P, 'neck', -0.04 * idle, glance * 0.5 * look, 0);
    set(P, 'head', -0.05 * look + Math.sin(time * 0.3) * 0.05 * look, glance * 0.35 * look, 0);
    set(P, 'upperArmL', 0.06 * idle, 0, 0.17 * idle + 0.12 * (1 - idle));
    set(P, 'upperArmR', 0.06 * idle, 0, -0.17 * idle - 0.12 * (1 - idle));
    set(P, 'foreArmL', -0.25); set(P, 'foreArmR', -0.25);
    set(P, 'thighL', -0.04 * idle, 0, 0.06 * idle); set(P, 'thighR', 0.03 * idle, 0, -0.06 * idle);
    set(P, 'shinL', 0.08 * idle); set(P, 'shinR', 0.06 * idle);
    if (a > 0.01) {
      const r = 1 - idle;
      const sprint = smoothstep(1.0, 1.25, a);
      const stride = 0.35 + 0.75 * Math.min(a, 1) + sprint * 0.15;
      add(P, 'thighL', (-s * stride - 0.18 * a) * r);
      add(P, 'thighR', (s * stride - 0.18 * a) * r);
      add(P, 'shinL', (0.2 + (0.5 + 1.4 * Math.min(a, 1)) * Math.pow(Math.max(0, co), 0.8)) * r);
      add(P, 'shinR', (0.2 + (0.5 + 1.4 * Math.min(a, 1)) * Math.pow(Math.max(0, -co), 0.8)) * r);
      add(P, 'footL', (-0.25 * a * s + 0.2 * Math.max(0, co) * a) * r);
      add(P, 'footR', (0.25 * a * s + 0.2 * Math.max(0, -co) * a) * r);
      const armSw = 0.35 + 0.85 * Math.min(a, 1);
      add(P, 'upperArmL', s * armSw * r);
      add(P, 'upperArmR', -s * armSw * r);
      add(P, 'foreArmL', (-0.5 - 0.9 * Math.min(a, 1) - Math.max(0, -s) * 0.3) * r);
      add(P, 'foreArmR', (-0.5 - 0.9 * Math.min(a, 1) - Math.max(0, s) * 0.3) * r);
      add(P, 'spine', (0.1 + 0.22 * a + sprint * 0.1) * r, s * 0.14 * a * r);
      add(P, 'chest', 0, s * 0.08 * a * r);
      add(P, 'hips', 0, -s * 0.14 * a * r);
      add(P, 'neck', -(0.08 + 0.15 * a) * r);
      P.hipY += (-0.06 * Math.min(a, 1) + Math.abs(s) * 0.07 * Math.min(a, 1)) * r;
    }
    // Bank into turns.
    this.lean = lerp(this.lean, clamp(-this.turnRate * hs * 0.018, -0.45, 0.45), 0.25);
    P.pivotZ = this.lean;
    // Landing squash.
    const L = pl.landImpact;
    if (L > 0) {
      P.hipY -= L * 0.32;
      add(P, 'thighL', -L * 0.55); add(P, 'thighR', -L * 0.55);
      add(P, 'shinL', L * 1.1); add(P, 'shinR', L * 1.1);
      add(P, 'spine', L * 0.35);
      add(P, 'upperArmL', 0, 0, L * 0.4); add(P, 'upperArmR', 0, 0, -L * 0.4);
      P.rate = 28;
    }
  }

  airPose(P, pl, time, dt) {
    const vy = pl.vel.y;
    const rise = clamp(vy / 9, -1, 1);
    const fall = clamp(-vy / 14, 0, 1);
    this.airPhase += dt * (6 + fall * 6);
    const w = Math.sin(this.airPhase);
    // Leap pose (rising) blended into a reaching fall.
    const up = Math.max(0, rise);
    set(P, 'thighL', lerp(-0.35, -1.25, up) + w * 0.25 * fall, 0, 0.08);
    set(P, 'shinL', lerp(0.5, 1.5, up));
    set(P, 'thighR', lerp(-0.15, 0.35, up) - w * 0.25 * fall, 0, -0.08);
    set(P, 'shinR', lerp(0.4, 0.9, up));
    set(P, 'upperArmL', lerp(-0.5, -2.4, up) + w * 0.4 * fall, 0, lerp(0.4, 0.25, up) + fall * 0.9);
    set(P, 'upperArmR', lerp(-0.4, 0.5, up) - w * 0.4 * fall, 0, -lerp(0.4, 0.35, up) - fall * 0.9);
    set(P, 'foreArmL', -0.4); set(P, 'foreArmR', -0.5);
    set(P, 'spine', 0.12 - fall * 0.15);
    set(P, 'neck', -0.1 + fall * 0.15);
    P.rate = 14;

    const f = pl.flip;
    if (f.active) {
      const tuck = smoothstep(0, 0.7, f.angle) * smoothstep(f.target, f.target - 0.9, f.angle);
      if (f.axis === 'x') {
        P.pivotX = f.dir * f.angle;
        legs(P, -2.1 * tuck - 0.2, 0.08, 2.3 * tuck + 0.3);
        set(P, 'spine', 0.55 * tuck); set(P, 'neck', 0.3 * tuck);
        arms(P, -1.1 * tuck - 0.3, 0.35, -1.6 * tuck);
      } else {
        P.pivotZ = f.dir * f.angle;
        legs(P, -0.2, 0.7 * tuck + 0.1, 0.2);
        arms(P, -0.2, 1.45 * tuck + 0.3, -0.1);
      }
      P.rate = 40;
    }
    if (pl.spin.active && !f.active) {
      arms(P, -0.5, 0.15, -2.0, 0.6);
      legs(P, -0.15, 0.03, 0.25);
      P.rate = 30;
    }
    const p = pl.pose;
    if (p.active) {
      const t = p.time;
      switch (p.type) {
        case 'cannonball':
          legs(P, -2.3, 0.15, 2.5);
          set(P, 'spine', 0.6); set(P, 'neck', 0.4);
          arms(P, -1.0, 0.25, -1.9);
          P.pivotX = 0.2;
          break;
        case 'superman':
          P.pivotX = 1.25;
          arms(P, -3.0, 0.15, -0.05);
          legs(P, 0.25, 0.04, 0.15);
          set(P, 'neck', -0.9); set(P, 'head', -0.3);
          break;
        case 'starfish':
          P.pivotX = -0.35;
          arms(P, -0.3, 1.45, -0.1);
          legs(P, -0.1, 0.65, 0.1);
          set(P, 'spine', -0.25);
          break;
        case 'yell':
          set(P, 'upperArmL', -1.6, 0, 0.55); set(P, 'foreArmL', -2.2);
          set(P, 'upperArmR', -0.4, 0, -1.4); set(P, 'foreArmR', -0.2);
          set(P, 'neck', -0.5); set(P, 'head', -0.25);
          legs(P, -0.6, 0.1, 0.9);
          set(P, 'thighR', 0.2, 0, -0.1);
          break;
        case 'chestpound': {
          const beat = Math.sin(t * 18);
          set(P, 'upperArmL', -0.75 + (beat > 0 ? 0.25 : -0.1), 0, -0.25); set(P, 'foreArmL', -2.3);
          set(P, 'upperArmR', -0.75 + (beat < 0 ? 0.25 : -0.1), 0, 0.25); set(P, 'foreArmR', -2.3);
          set(P, 'spine', -0.2);
          legs(P, -0.5, 0.25, 0.8);
          break;
        }
      }
      P.rate = Math.max(P.rate, 24);
    }
  }

  grindPose(P, pl, time) {
    const g = pl.grind;
    if (g.rail && g.rail.hang) {
      this.hangPose(P, pl, time, 0);
      return;
    }
    if (g.mode === 'run') {
      // Running along a branch: normal stride with arms out for balance.
      this.groundPose(P, pl, time, g.speed);
      const bal = 1 - clamp(g.speed / 9, 0, 0.7);
      const wob = Math.sin(time * 3.1) * 0.12 * bal;
      add(P, 'upperArmL', 0, 0, 0.55 * bal + wob);
      add(P, 'upperArmR', 0, 0, -0.55 * bal + wob);
      P.pivotZ += g.lean * -0.12 + wob * 0.3;
      return;
    }
    const side = g.switch ? -1 : 1;
    const crouch = pl.input.held('slide') ? 1 : 0;
    const wob = Math.sin(time * 2.7) * 0.08 + Math.sin(time * 5.3) * 0.04;
    set(P, 'hips', 0, 1.35 * side, 0);
    set(P, 'spine', 0.18 + crouch * 0.2, -0.55 * side, 0);
    set(P, 'chest', 0.05, -0.25 * side, 0);
    set(P, 'neck', 0.1, -0.45 * side, 0);
    set(P, 'thighL', -0.5 - crouch * 0.4, 0, 0.36);
    set(P, 'thighR', -0.5 - crouch * 0.4, 0, -0.36);
    set(P, 'shinL', 0.9 + crouch * 0.6); set(P, 'shinR', 0.9 + crouch * 0.6);
    set(P, 'footL', -0.35, 0, -0.3); set(P, 'footR', -0.35, 0, 0.3);
    set(P, 'upperArmL', -0.25, 0, 1.2 + wob + g.lean * 0.4);
    set(P, 'upperArmR', -0.25, 0, -1.2 + wob + g.lean * 0.4);
    set(P, 'foreArmL', -0.35); set(P, 'foreArmR', -0.35);
    P.hipY = -0.2 - crouch * 0.2;
    P.pivotZ = -g.lean * 0.3 + wob * 0.3;
    if (g.trickT >= 0) {
      if (g.trickKind === 'flip') {
        const t = clamp(g.trickT / 0.62, 0, 1);
        P.pivotX = -t * TAU;
        const tuck = Math.sin(t * Math.PI);
        legs(P, -2.0 * tuck - 0.4, 0.1, 2.2 * tuck + 0.6);
        P.hipY = Math.sin(t * Math.PI) * 1.0 - 0.1;
        P.rate = 40;
      } else {
        const t = clamp(g.trickT / 0.38, 0, 1);
        P.hipY = Math.sin(t * Math.PI) * 0.6 - 0.2;
        set(P, 'hips', 0, lerp(1.35 * side, -1.35 * side, smoothstep(0, 1, t)), 0);
        P.rate = 40;
      }
    }
    if (P.rate < 40) P.rate = 18;
  }

  hangPose(P, pl, time, legSwing) {
    set(P, 'upperArmL', -2.95, 0, 0.22); set(P, 'upperArmR', -2.95, 0, -0.22);
    set(P, 'foreArmL', -0.15); set(P, 'foreArmR', -0.15);
    set(P, 'shoulderL', 0, 0, 0.15); set(P, 'shoulderR', 0, 0, -0.15);
    const sw = Math.sin(time * 2.2) * 0.12;
    set(P, 'thighL', -0.35 + sw + legSwing, 0, 0.06); set(P, 'thighR', -0.15 - sw + legSwing, 0, -0.06);
    set(P, 'shinL', 0.5); set(P, 'shinR', 0.7);
    set(P, 'spine', -0.08); set(P, 'neck', 0.1);
    P.rate = 16;
  }

  swingPose(P, pl, time) {
    const sw = pl.swing;
    if (!sw.vine) return null;
    // Body aligned with the rope.
    const up = _v.subVectors(sw.vine.anchor, sw.hand).normalize();
    // Legs trail/pike depending on velocity along facing.
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    const vf = pl.vel.x * fx + pl.vel.z * fz;
    const vup = pl.vel.y;
    const pike = clamp(-vup * 0.06 + vf * 0.02, -0.7, 0.9);
    this.hangPose(P, pl, time, -pike);
    // One-hand swing flair at high speed.
    if (pl.vel.length() > 12) { set(P, 'upperArmR', -1.0, 0, -1.3); set(P, 'foreArmR', -0.3); }
    if (sw.flipT >= 0) {
      const t = clamp(sw.flipT / 0.6, 0, 1);
      P.pivotX = -t * TAU;
      legs(P, -1.8 * Math.sin(t * Math.PI), 0.05, 1.8 * Math.sin(t * Math.PI));
      P.rate = 40;
    }
    return up.clone();
  }

  wallrunPose(P, pl, time) {
    const w = pl.wall;
    const ph = time * (w.type === 'up' ? 11 : 9.5);
    const s = Math.sin(ph), co = Math.cos(ph);
    legs(P, -0.3, 0.05, 0.6);
    add(P, 'thighL', -s * 0.9 - 0.3); add(P, 'thighR', s * 0.9 - 0.3);
    add(P, 'shinL', Math.max(0, co) * 1.4); add(P, 'shinR', Math.max(0, -co) * 1.4);
    if (w.type === 'up') {
      set(P, 'spine', 0.35);
      set(P, 'upperArmL', -2.2 + s * 0.6, 0, 0.3); set(P, 'upperArmR', -2.2 - s * 0.6, 0, -0.3);
      set(P, 'foreArmL', -0.6); set(P, 'foreArmR', -0.6);
      P.pivotX = -0.25;
    } else {
      // Side the wall is on, relative to facing.
      let nx, nz;
      if (w.type === 'flat') { nx = w.normal.x; nz = w.normal.z; }
      else { nx = Math.cos(w.theta); nz = Math.sin(w.theta); }
      const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
      const rightX = -fz, rightZ = fx; // character's left in world (+X local)
      const wallOnLeft = -(nx * rightX + nz * rightZ) > 0; // wall direction = -n
      const side = wallOnLeft ? 1 : -1;
      P.pivotZ = -side * 0.55;
      set(P, 'spine', 0.2);
      add(P, 'upperArmL', s * 0.8, 0, side > 0 ? 1.3 : 0.2);
      add(P, 'upperArmR', -s * 0.8, 0, side < 0 ? -1.3 : -0.2);
      set(P, 'foreArmL', -0.7); set(P, 'foreArmR', -0.7);
    }
    P.rate = 22;
  }

  climbPose(P, pl) {
    const c = pl.climb;
    const ph = c.phase * 2.6;
    const s = Math.sin(ph);
    set(P, 'upperArmL', -2.5 + s * 0.45, 0, 0.45); set(P, 'upperArmR', -2.5 - s * 0.45, 0, -0.45);
    set(P, 'foreArmL', -0.7 - Math.max(0, -s) * 0.7); set(P, 'foreArmR', -0.7 - Math.max(0, s) * 0.7);
    set(P, 'thighL', -1.0 - s * 0.35, 0, 0.32); set(P, 'thighR', -1.0 + s * 0.35, 0, -0.32);
    set(P, 'shinL', 1.4 + s * 0.3); set(P, 'shinR', 1.4 - s * 0.3);
    set(P, 'footL', -0.3); set(P, 'footR', -0.3);
    set(P, 'spine', 0.12); set(P, 'neck', -0.35);
    P.hipZ = -0.12;
    P.rate = 18;
  }

  mantlePose(P, pl) {
    const m = pl.mantle;
    const t = m.t;
    if (m.vault) {
      P.pivotZ = 0.55 * Math.sin(t * Math.PI);
      set(P, 'upperArmL', -0.9, 0, 0.4); set(P, 'foreArmL', -0.1);
      set(P, 'upperArmR', -1.6, 0, -0.8);
      legs(P, -1.3, 0.3, 1.2);
      P.hipY = -0.1;
    } else if (t < 0.55) {
      const k = t / 0.55;
      set(P, 'upperArmL', lerp(-2.6, -0.5, k), 0, 0.3); set(P, 'upperArmR', lerp(-2.6, -0.5, k), 0, -0.3);
      set(P, 'foreArmL', lerp(-0.4, -1.8, k)); set(P, 'foreArmR', lerp(-0.4, -1.8, k));
      legs(P, -0.6 - k * 0.8, 0.08, 0.9 + k * 0.8);
      set(P, 'spine', 0.4);
    } else {
      const k = (t - 0.55) / 0.45;
      arms(P, lerp(-0.5, 0.0, k), 0.3, lerp(-1.8, -0.3, k));
      set(P, 'thighL', lerp(-1.4, -0.2, k), 0, 0.08); set(P, 'shinL', lerp(1.7, 0.3, k));
      set(P, 'thighR', lerp(-0.8, 0.1, k), 0, -0.08); set(P, 'shinR', lerp(1.6, 0.4, k));
      set(P, 'spine', lerp(0.4, 0.1, k));
    }
    P.rate = 26;
  }

  swimPose(P, pl, time) {
    const ph = pl.swim.t * 4.5;
    const s = Math.sin(ph);
    const moving = clamp(pl.hspeed / 3, 0, 1);
    P.pivotX = 1.15 * moving + 0.2;
    P.hipY = -0.2;
    set(P, 'upperArmL', -1.6 + s * 1.5 * moving, 0, 0.35 + (1 - moving) * 0.6); set(P, 'upperArmR', -1.6 - s * 1.5 * moving, 0, -0.35 - (1 - moving) * 0.6);
    set(P, 'foreArmL', -0.3); set(P, 'foreArmR', -0.3);
    const k = Math.sin(time * 9) * 0.3 * moving;
    set(P, 'thighL', k + 0.1, 0, 0.08); set(P, 'thighR', -k + 0.1, 0, -0.08);
    set(P, 'shinL', 0.3); set(P, 'shinR', 0.3);
    set(P, 'neck', -0.9 * moving); set(P, 'head', -0.25 * moving);
    P.rate = 12;
  }

  bailPose(P, pl, time) {
    const t = pl.bail.t;
    if (t < 0.55) {
      P.pivotX = -t * 9;
      arms(P, -1.0 + Math.sin(time * 17) * 0.6, 1.1, -0.5);
      legs(P, -0.8 + Math.sin(time * 13) * 0.5, 0.4, 0.8);
      P.rate = 40;
    } else if (t < 0.95) {
      P.pivotX = -1.45;
      P.hipY = -0.8;
      arms(P, 0.2, 1.2, -0.2);
      legs(P, -0.3, 0.3, 0.4);
      P.rate = 14;
    } else {
      const k = (t - 0.95) / 0.3;
      P.hipY = -0.5 * (1 - k);
      legs(P, -1.0 * (1 - k), 0.1, 1.6 * (1 - k));
      set(P, 'spine', 0.5 * (1 - k));
      P.rate = 12;
    }
  }

  // ------------------------------------------------------------ hair / cloth
  secondary(dt, pl, time, hs) {
    const c = this.c;
    // Acceleration in the character's local frame drives the hair.
    const acc = _v2.subVectors(pl.vel, this.prevVel).multiplyScalar(1 / Math.max(dt, 1e-4));
    this.prevVel.copy(pl.vel);
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    const fwdSpeed = pl.vel.x * fx + pl.vel.z * fz;
    const fwdAcc = clamp(acc.x * fx + acc.z * fz, -60, 60);
    const vy = pl.vel.y;
    for (const h of c.hair) {
      const target = 0.25 + clamp(fwdSpeed * 0.06, -0.4, 1.1) + clamp(vy * -0.03, -0.6, 0.7) + Math.sin(time * 3 + h.side * 20) * 0.04;
      h.vax += ((target - h.ax) * 60 - h.vax * 7 - fwdAcc * 0.05) * dt;
      h.ax += h.vax * dt;
      h.ax = clamp(h.ax, -0.6, 1.9);
      const tb = (h.ax - 0.25) * 0.5;
      h.vbx += ((tb - h.bx) * 90 - h.vbx * 8) * dt;
      h.bx += h.vbx * dt;
      h.a.rotation.set(h.ax, 0, h.baseZ * (0.7 + 0.3 * Math.sin(time * 1.3 + h.side * 9)));
      h.b.rotation.set(h.bx, 0, 0);
    }
    const tl = c.joints.thighL.rotation.x, tr = c.joints.thighR.rotation.x;
    for (const f of c.flaps) {
      let target;
      if (f.back) target = -clamp(hs * 0.045 + Math.max(0, Math.max(tl, tr)) * 0.4 + Math.max(0, -vy) * 0.03, 0, 1.3);
      else target = -clamp(Math.max(0, -Math.min(tl, tr)) * 0.75 - hs * 0.01 + Math.max(0, -vy) * 0.04, -0.2, 1.4);
      f.vel += ((target - f.angle) * 140 - f.vel * 10) * dt;
      f.angle += f.vel * dt;
      f.pv.rotation.x = f.angle + Math.sin(time * 9 + (f.back ? 1 : 0)) * 0.03 * Math.min(1, hs / 5);
    }
  }
}
