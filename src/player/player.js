// Player movement controller: a momentum-driven state machine.
//
// States: ground, air, grind, swing, wallrun, climb, mantle, swim, bail.
// The controller is independent of rendering; it publishes events that the
// audio, FX, camera and trick-scoring systems consume.
import * as THREE from 'three';
import { P } from './params.js';
import { clamp, lerp, approach, wrapAngle, approachAngle, yawFromDir, smoothstep, TAU } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _old = new THREE.Vector3();

const POSE_BY_DIR = { neutral: 'cannonball', forward: 'superman', back: 'starfish', left: 'yell', right: 'chestpound' };
export const POSE_NAMES = {
  cannonball: 'Cannonball', superman: 'Superman', starfish: 'Starfish', yell: 'Jungle Call', chestpound: 'Chest Pound',
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class Player {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.rails = game.rails;
    this.vines = game.vines;
    this.events = game.events;
    this.input = game.input;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'air';
    this.prevState = 'air';
    this.stateTime = 0;
    this.time = 0;
    this.height = P.height;

    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundTag = 'ground';
    this.groundCol = null;
    this.coyote = 0;
    this.airTime = 0;
    this.jumpCut = false;
    this.sliding = false;
    this.skidding = false;
    this.wallPush = 0;
    this.lastWallActionTime = -10;
    this.lastWallCol = null;
    this.tauntT = -1;

    this.flip = { active: false, axis: 'x', dir: 1, angle: 0, target: 0, count: 0, kind: '' };
    this.spin = { active: false, dir: 1, angle: 0, target: 0, total: 0 };
    this.pose = { active: false, type: '', time: 0 };
    this.grind = { rail: null, s: 0, dir: 1, speed: 0, dist: 0, runDist: 0, mode: 'grind', entryTime: -10, trickT: -1, trickKind: '', switch: false, lastRail: null, lastTime: -10, lean: 0 };
    this.swing = { vine: null, d: 0, hand: new THREE.Vector3(), lastVine: null, lastTime: -10, flipT: -1, angle: 0 };
    this.wall = { type: '', col: null, theta: 0, sign: 1, speed: 0, vy: 0, normal: new THREE.Vector3(), tangent: new THREE.Vector3(), dist: 0, R: 0 };
    this.climb = { col: null, theta: 0, phase: 0, R: 0, moving: 0 };
    this.mantle = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.3, exitSpeed: 0, vault: false, dir: new THREE.Vector3() };
    this.bail = { t: 0 };
    this.swim = { t: 0 };

    this.visOffset = new THREE.Vector3();
    this.spawn = new THREE.Vector3();
    this.spawnYaw = 0;
    this.lastSafe = new THREE.Vector3();
    this.safeTimer = 0;
    this.launchPos = new THREE.Vector3();
    this.contacts = [];
    this.wallHit = null;
    this.hitGround = false;
    this.hitCeil = false;
    this.landImpact = 0;
    this.footPhase = 0;
    this.lastStepPhase = 0;
    this.camYaw = 0;
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.inputDir = new THREE.Vector3();
    this.inputMag = 0;
    this.autoGrind = false;
    this.speedLines = 0;
    this.preWallVel = { x: 0, z: 0 };
    this.slideEndTime = -10;
    this.rollT = -1; // forward roll animation timer after a rolled landing
  }

  // ---------------------------------------------------------------- helpers
  get hspeed() { return Math.hypot(this.vel.x, this.vel.z); }
  get speed() { return this.vel.length(); }
  emit(name, data = {}) { this.events.emit(name, data); }

  setState(s) {
    if (s === this.state) return;
    this.prevState = this.state;
    this.state = s;
    this.stateTime = 0;
    this.height = s === 'ground' && this.sliding ? P.crouchHeight : P.height;
    if (s !== 'ground') {
      // Ground-only flags must not leak into (or back out of) other states.
      this.groundCol = null;
      this.skidding = false;
    }
    this.emit('state', { from: this.prevState, to: s });
  }

  placeAt(pos, yaw = 0, setSpawn = true) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    if (setSpawn) { this.spawn.copy(pos); this.spawnYaw = yaw; }
    this.lastSafe.copy(pos);
    this.visOffset.set(0, 0, 0);
    this.cancelTricks();
    this.releaseHolds();
    this.sliding = false;
    this.setState('air');
    this.airTime = 0;
  }

  respawn(toSpawn = false) {
    const target = toSpawn ? this.spawn : this.lastSafe;
    this.placeAt(target, toSpawn ? this.spawnYaw : this.yaw, false);
    this.emit('respawn', {});
  }

  releaseHolds() {
    if (this.swing.vine) { this.swing.vine.held = false; this.swing.vine = null; }
    this.grind.rail = null;
  }

  snapTo(newPos) {
    // Visual smoothing for discontinuous position changes.
    this.visOffset.add(_old.copy(this.pos).sub(newPos));
    if (this.visOffset.lengthSq() > 9) this.visOffset.setLength(3);
    this.pos.copy(newPos);
  }

  wantsGrab() {
    return this.input.pressed('grab', 0.2) || this.input.held('grab');
  }

  /** Landing mode for rails: run along them, or grind if asked to. */
  perchMode() {
    return this.input.held('grab') || this.input.held('slide') || this.autoGrind ? 'grind' : 'run';
  }

  tryPerchOnGroundRail() {
    const col = this.groundCol;
    const rail = col && col.data && col.data.rail;
    if (!rail || rail.hang) return false;
    if (rail === this.grind.lastRail && this.time - this.grind.lastTime < 0.5) return false;
    const tmp = rail.closest(_v.set(this.pos.x, this.pos.y - rail.r0, this.pos.z), { s: 0, dist: 0 });
    if (tmp.dist > 1.3) return false;
    const slope = Math.abs(rail.tangentAt(tmp.s, _t).y);
    this.startGrind(rail, tmp.s, slope > P.runMaxSlope ? 'grind' : this.perchMode());
    return true;
  }

  computeInput() {
    const i = this.input;
    const cy = this.camYaw;
    // Camera forward (horizontal) and right.
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    this.camFwd.set(fx, 0, fz);
    const dx = rx * i.moveX + fx * i.moveY;
    const dz = rz * i.moveX + fz * i.moveY;
    const m = Math.min(1, Math.hypot(dx, dz));
    this.inputMag = m;
    if (m > 1e-3) this.inputDir.set(dx / m, 0, dz / m);
    else this.inputDir.set(0, 0, 0);
  }

  /** Direction of the stick relative to the player's facing. */
  stickRelative() {
    if (this.inputMag < 0.35) return 'neutral';
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const f = this.inputDir.x * fx + this.inputDir.z * fz;
    const r = -this.inputDir.x * fz + this.inputDir.z * fx; // right = (-fz, fx)
    if (Math.abs(f) >= Math.abs(r)) return f > 0 ? 'forward' : 'back';
    return r > 0 ? 'left' : 'right';
  }

  // ---------------------------------------------------------------- collision
  resolve(dt) {
    const p = this.pos, v = this.vel;
    const r = P.radius, h = this.height;
    this.hitGround = false;
    this.hitCeil = false;
    this.wallHit = null;
    let groundBest = null;
    for (let iter = 0; iter < 4; iter++) {
      const cs = this.world.capsuleContacts(p, r, h, this.contacts);
      if (!cs.length) break;
      let any = false;
      for (const c of cs) {
        // Re-evaluating is too expensive; resolve each with current info.
        let nx = c.nx, ny = c.ny, nz = c.nz, depth = c.depth;
        if (depth < 1e-4) continue;
        any = true;
        if (ny > 0.62) {
          if (!groundBest || ny > groundBest.ny) groundBest = c;
          this.hitGround = true;
          // Resolve walkable contacts straight up so standing on slopes never creeps downhill.
          p.y += Math.min(depth / ny, depth * 2) + 0.0005;
          if (v.y < 0) v.y = 0;
          continue;
        } else if (ny < -0.55) {
          this.hitCeil = true;
        } else {
          // Treat as a wall: push horizontally only.
          const l = Math.hypot(nx, nz);
          if (l > 1e-3) {
            depth = Math.min(depth / l, depth * 2.5);
            nx /= l; nz /= l; ny = 0;
          }
          if (!this.wallHit || c.depth > this.wallHit.depth) {
            this.wallHit = { nx, nz, depth: c.depth, col: c.col, tag: c.tag };
          }
        }
        p.x += nx * (depth + 0.0005);
        p.y += ny * (depth + 0.0005);
        p.z += nz * (depth + 0.0005);
        const vn = v.x * nx + v.y * ny + v.z * nz;
        if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; }
      }
      if (!any) break;
    }
    if (groundBest) {
      this.groundNormal.set(groundBest.nx, groundBest.ny, groundBest.nz);
      this.groundTag = groundBest.tag;
      this.groundCol = groundBest.col;
    }
  }

  probeGround(maxDown) {
    const hit = this.world.groundBelow(this.pos.x, this.pos.y + 0.35, this.pos.z, 0.35 + maxDown);
    return hit && hit.normal.y > 0.6 ? hit : null;
  }

  // ---------------------------------------------------------------- update
  update(dt, camYaw) {
    this.camYaw = camYaw;
    this.computeInput();
    const speed = this.speed;
    const steps = Math.max(1, Math.min(10, Math.ceil(Math.max(dt / (1 / 120), (speed * dt) / 0.22))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);

    // Smooth out snaps.
    this.visOffset.multiplyScalar(Math.exp(-dt * 14));
    this.landImpact = Math.max(0, this.landImpact - dt * 3);

    // Safety: fell out of the world.
    const p = this.pos;
    if (p.y < -30 || !Number.isFinite(p.x + p.y + p.z) || !Number.isFinite(this.vel.x + this.vel.y + this.vel.z)) this.respawn();
    if (this.input.pressed('respawn')) { this.input.consume('respawn'); this.respawn(true); }
  }

  step(dt) {
    this.time += dt;
    this.stateTime += dt;
    if (this.rollT >= 0) { this.rollT += dt; if (this.rollT > 0.5 || this.state !== 'ground') this.rollT = -1; }
    switch (this.state) {
      case 'ground': this.updateGround(dt); break;
      case 'air': this.updateAir(dt); break;
      case 'grind': this.updateGrind(dt); break;
      case 'swing': this.updateSwing(dt); break;
      case 'wallrun': this.updateWallrun(dt); break;
      case 'climb': this.updateClimb(dt); break;
      case 'mantle': this.updateMantle(dt); break;
      case 'swim': this.updateSwim(dt); break;
      case 'bail': this.updateBail(dt); break;
    }
    if (this.vel.lengthSq() > P.maxSpeed * P.maxSpeed) this.vel.setLength(P.maxSpeed);
  }

  // ================================================================ GROUND
  updateGround(dt) {
    const v = this.vel, inp = this.input;
    const d = this.inputDir, m = this.inputMag;
    this.airTime = 0;

    // Mushrooms and other trampolines never let you stand still.
    if (this.groundCol && this.groundCol.bounce) { this.doBounce(Math.max(4, -v.y), this.groundCol); return; }
    // Standing on a branch or log means running along it.
    if (this.tryPerchOnGroundRail()) return;

    let hx = v.x, hz = v.z;
    let hs = Math.hypot(hx, hz);
    let dirx = hs > 1e-4 ? hx / hs : Math.sin(this.yaw);
    let dirz = hs > 1e-4 ? hz / hs : Math.cos(this.yaw);
    const n = this.groundNormal;
    // Downhill component of gravity along the travel direction.
    const slopeAlong = -(n.x * dirx + n.z * dirz); // >0 when moving uphill

    // --- Taunt (chest pound) when standing still.
    if (this.tauntT >= 0) {
      this.tauntT += dt;
      if (this.tauntT > 1.5 || m > 0.3 || inp.pressed('jump')) this.tauntT = -1;
    } else if (inp.pressed('taunt') && hs < 2) {
      inp.consume('taunt');
      this.tauntT = 0;
      this.emit('taunt', {});
    }

    // --- Slide start/stop
    const wantSlide = inp.held('slide');
    if (!this.sliding && wantSlide && hs > P.slideMin && inp.pressed('slide', 0.25)) {
      inp.consume('slide');
      this.sliding = true;
      this.height = P.crouchHeight;
      this.emit('slide', { speed: hs });
    }
    if (this.sliding && (!wantSlide || hs < 2.5)) {
      // Stand up only if there is headroom.
      // Only the space above the crouched body matters (the slope underfoot doesn't).
      const head = _v.set(this.pos.x, this.pos.y + P.crouchHeight - P.radius, this.pos.z);
      if (this.world.capsuleFree(head, P.radius, P.height - P.crouchHeight + P.radius, 0.05)) {
        this.sliding = false;
        this.slideEndTime = this.time;
        this.height = P.height;
        this.emit('slideEnd', {});
      }
    }

    if (this.sliding) {
      // Momentum slide: low friction, gravity on slopes, gentle steering.
      if (m > 0.1) {
        const target = Math.atan2(d.x, d.z);
        const cur = Math.atan2(dirx, dirz);
        const na = approachAngle(cur, target, P.slideSteer * dt * m);
        dirx = Math.sin(na); dirz = Math.cos(na);
      }
      const mud = this.groundTag === 'mud';
      hs += -slopeAlong * P.slopeAccel * (mud ? 1.35 : 1) * dt;
      hs -= (mud ? 0.6 : P.slideFriction) * dt;
      if (mud) hs = Math.max(hs, 7);
      hs = Math.max(0, hs);
      this.skidding = false;
    } else if (this.skidding) {
      hs = approach(hs, 0, P.skidDecel * dt);
      if (hs < 1.5 || m < 0.1) {
        this.skidding = false;
        if (m > 0.1) { dirx = d.x; dirz = d.z; hs = Math.max(hs, 2); }
      }
    } else if (m > 0.05 && this.tauntT < 0) {
      const dot = dirx * d.x + dirz * d.z;
      if (hs > P.skidMinSpeed && dot < P.skidDot) {
        this.skidding = true;
        this.emit('skid', { speed: hs });
      } else {
        // Rotate velocity toward the input direction; tighter turns at low speed.
        const turn = lerp(P.turnLow, P.turnHigh, clamp(hs / 22, 0, 1));
        if (hs < 1.0) { dirx = d.x; dirz = d.z; }
        else {
          const cur = Math.atan2(dirx, dirz);
          const target = Math.atan2(d.x, d.z);
          const na = approachAngle(cur, target, turn * dt);
          dirx = Math.sin(na); dirz = Math.cos(na);
          // Losing a bit of speed in sharp turns makes them feel weighty.
          const diff = Math.abs(wrapAngle(target - cur));
          if (diff > 0.6) hs = approach(hs, 0, diff * 6 * dt);
        }
        const maxS = P.runSpeed * m;
        if (hs < maxS) {
          const a = P.accel * (1.15 - 0.6 * clamp(hs / P.runSpeed, 0, 1));
          hs = Math.min(maxS, hs + a * dt);
        } else {
          // Keep momentum earned from moves, bleeding it slowly.
          hs = approach(hs, maxS, (P.overDecay + (hs - maxS) * 0.12) * dt);
        }
        // Slopes: slower uphill, faster downhill.
        hs += -slopeAlong * 6 * dt;
        if (this.groundTag === 'mud') hs += 6 * dt;
      }
    } else {
      hs = approach(hs, 0, P.decel * dt);
    }
    hs = Math.max(0, hs);
    v.x = dirx * hs;
    v.z = dirz * hs;
    // Keep velocity on the ground plane.
    v.y = n.y > 0.2 ? -(n.x * v.x + n.z * v.z) / n.y : 0;

    // Facing.
    if (hs > 0.5 && !this.skidding) this.yaw = approachAngle(this.yaw, Math.atan2(dirx, dirz), 18 * dt);
    else if (m > 0.2 && hs <= 0.5) this.yaw = approachAngle(this.yaw, Math.atan2(d.x, d.z), 14 * dt);

    // --- Actions
    if (inp.pressed('grab', 0.12)) {
      if (this.tryGrabRail({ fromGround: true })) { inp.consume('grab'); return; }
      if (this.tryGrabVine(1.6)) { inp.consume('grab'); return; }
      if (this.tryClimbAdjacent()) { inp.consume('grab'); return; }
    }
    if (inp.pressed('jump', P.jumpBuffer)) {
      this.doJump();
      return;
    }

    // --- Move
    this.moveGround(dt);
    if (this.state !== 'ground') return;

    // Footsteps / animation phase.
    // Stride length grows with speed (short steps when jogging, long bounds when sprinting).
    const strideLen = clamp(1.0 + hs * 0.36, 1.2, 5.2);
    if (!this.sliding) this.footPhase += (hs * dt) / strideLen;
    if (Math.floor(this.footPhase * 2) !== Math.floor(this.lastStepPhase * 2) && hs > 1) {
      this.emit('footstep', { tag: this.groundTag, speed: hs, pos: this.pos });
    }
    this.lastStepPhase = this.footPhase;

    // Track a safe respawn point.
    this.safeTimer += dt;
    if (this.safeTimer > 0.4 && this.groundNormal.y > 0.92 && !this.sliding && !(this.groundCol && this.groundCol.bounce)) {
      this.safeTimer = 0;
      if (this.world.waterAt(this.pos.x, this.pos.z) < this.pos.y - 0.2) this.lastSafe.copy(this.pos);
    }
  }

  moveGround(dt) {
    const p = this.pos, v = this.vel;
    const sx = p.x, sy = p.y, sz = p.z;
    const vx0 = v.x, vz0 = v.z;
    p.addScaledVector(v, dt);
    this.resolve(dt);

    // Step up small obstacles, vault waist-high ones, or scramble up trunks.
    if (this.wallHit) {
      const wn = this.wallHit;
      const hs = Math.hypot(vx0, vz0);
      const into = -(vx0 * wn.nx + vz0 * wn.nz);
      const inputInto = -(this.inputDir.x * wn.nx + this.inputDir.z * wn.nz) * this.inputMag;
      if (wn.col && wn.col.climbable && wn.col.type === 'cyl' && inputInto > 0.3 && into > 5) {
        // Hit a trunk at speed: run straight up it.
        this.wallPush = 0;
        this.startTrunkRun(wn.col, hs);
        return;
      }
      if (wn.col && wn.col.climbable && wn.col.type === 'cyl' && inputInto > 0.6) {
        // Pushing the stick into a trunk: start running up / climbing it.
        this.wallPush += dt;
        if (this.wallPush > 0.12) {
          this.wallPush = 0;
          if (hs > 5.5) this.startTrunkRun(wn.col, hs); else this.startClimb(wn.col);
          return;
        }
      } else {
        this.wallPush = 0;
        // Step up whenever we're pushing into the obstacle (even from a standstill).
        const pushing = into > 0.05 || inputInto > 0.3;
        let stepVx = vx0, stepVz = vz0;
        if (hs < 1 && inputInto > 0.3) { stepVx = this.inputDir.x * 2; stepVz = this.inputDir.z * 2; }
        if (pushing && !this.tryStepUp(sx, sy, sz, stepVx, stepVz, dt)) {
          if (hs > 2.5 && inputInto > 0.35 && !(wn.col && wn.col.noMantle)) {
            const ledge = this.findLedge(wn.nx, wn.nz, 0.45, 1.6);
            if (ledge) { this.startMantle(ledge, true, Math.max(hs, 5)); return; }
          }
        }
      }
    } else this.wallPush = 0;

    // Stick to the ground. When moving upward (ramps, stairs) only accept
    // ground right under our feet, so running off a ramp lip launches you.
    const hit = this.probeGround(v.y > 2.5 && !this.hitGround ? 0.14 : P.snapDown);
    if (hit && hit.point.y <= p.y + 0.36) {
      p.y = hit.point.y;
      this.groundNormal.copy(hit.normal);
      this.groundTag = hit.tag;
      this.groundCol = hit.col;
      this.grounded = true;
      this.coyote = P.coyote;
      if (this.groundCol && this.groundCol.bounce) this.doBounce(5, this.groundCol);
    } else if (this.hitGround) {
      this.grounded = true;
      this.coyote = P.coyote;
    } else {
      this.grounded = false;
      this.coyote = P.coyote;
      this.jumpCut = false;
      this.launchPos.copy(p);
      this.setState('air');
    }
    this.checkWater();
  }

  tryStepUp(sx, sy, sz, vx, vz, dt) {
    const test = _v.set(sx, sy + P.stepHeight, sz);
    if (!this.world.capsuleFree(test, P.radius, this.height, 0.03)) return false;
    test.x += vx * dt; test.z += vz * dt;
    if (!this.world.capsuleFree(test, P.radius, this.height, 0.03)) {
      // nudge a little farther to clear the edge
      return false;
    }
    // Probe under the center and under the leading edge of the capsule.
    const hs = Math.hypot(vx, vz) || 1;
    let hit = this.world.groundBelow(test.x, test.y + 0.05, test.z, P.stepHeight + 0.1);
    if (!hit || hit.point.y < sy + 0.03) {
      const ex = test.x + (vx / hs) * P.radius * 0.9, ez = test.z + (vz / hs) * P.radius * 0.9;
      const h2 = this.world.groundBelow(ex, test.y + 0.05, ez, P.stepHeight + 0.1);
      if (h2 && h2.point.y >= sy + 0.03) hit = h2;
    }
    if (!hit || hit.normal.y < 0.65 || hit.point.y < sy + 0.03) return false;
    const np = _v2.set(test.x, hit.point.y, test.z);
    if (!this.world.capsuleFree(np, P.radius, this.height, 0.04)) return false;
    this.visOffset.y += this.pos.y - np.y;
    this.visOffset.y = clamp(this.visOffset.y, -0.6, 0.6);
    this.pos.copy(np);
    this.vel.x = vx; this.vel.z = vz;
    this.wallHit = null;
    return true;
  }

  doJump(kind = 'jump') {
    const v = this.vel;
    let vy = P.jumpVel;
    let name = 'Ollie';
    const hs = this.hspeed;
    if (this.skidding && this.inputMag > 0.2) {
      // Skid jump: a high reversing flip-jump.
      vy = P.skidJumpVel;
      v.x = this.inputDir.x * 6; v.z = this.inputDir.z * 6;
      this.yaw = Math.atan2(this.inputDir.x, this.inputDir.z);
      name = 'Skid Flip';
      this.startFlip('back', true);
    } else if ((this.sliding || this.time - this.slideEndTime < 0.15) && hs > 5) {
      const boost = Math.min(hs * P.slideJumpBoost, hs + 3);
      v.x *= boost / hs; v.z *= boost / hs;
      vy *= 0.9;
      name = 'Long Jump';
    } else if (hs < 3 && this.inputMag > 0.3) {
      // Quick start from standstill feels better with a small kick.
      v.x = this.inputDir.x * Math.max(hs, 4);
      v.z = this.inputDir.z * Math.max(hs, 4);
    }
    // Inherit some upward velocity from ramps.
    v.y = Math.max(vy, vy + Math.max(0, v.y) * 0.6);
    this.input.consume('jump');
    this.sliding = false;
    this.skidding = false;
    this.tauntT = -1;
    this.height = P.height;
    this.jumpCut = name !== 'Skid Flip';
    this.coyote = 0;
    this.launchPos.copy(this.pos);
    this.setState('air');
    this.emit('jump', { name, kind, speed: hs, pos: this.pos });
  }

  // ================================================================ AIR
  updateAir(dt) {
    const v = this.vel, inp = this.input;
    const d = this.inputDir, m = this.inputMag;
    this.airTime += dt;
    this.coyote -= dt;
    this.grounded = false;

    if (this.coyote > 0 && inp.pressed('jump', P.jumpBuffer) && this.prevState === 'ground' && this.airTime < P.coyote) {
      this.doJump('coyote');
      return;
    }

    // Gravity with variable jump height.
    let g = P.gravity;
    if (v.y > 0 && this.jumpCut && !inp.held('jump')) g *= P.jumpCutGravity;
    v.y = Math.max(v.y - g * dt, -P.maxFall);

    // Air control: steer freely, but never gain speed beyond what you had.
    const hs0 = Math.hypot(v.x, v.z);
    if (m > 0.05) {
      v.x += d.x * P.airAccel * m * dt;
      v.z += d.z * P.airAccel * m * dt;
      const cap = Math.max(hs0, P.airBaseMax * m);
      const hs1 = Math.hypot(v.x, v.z);
      if (hs1 > cap) { v.x *= cap / hs1; v.z *= cap / hs1; }
    }
    const hs = Math.hypot(v.x, v.z);
    if (!this.spin.active) {
      if (hs > 1.5) this.yaw = approachAngle(this.yaw, Math.atan2(v.x, v.z), 7 * dt);
      else if (m > 0.3) this.yaw = approachAngle(this.yaw, Math.atan2(d.x, d.z), 7 * dt);
    }

    this.updateAirTricks(dt);

    // Grab vines / rails. Holding grab catches from further away (and grinds);
    // otherwise touching a vine catches it and landing on a branch perches you.
    if (this.airTime > 0.06 || this.prevState !== 'ground') {
      if (this.wantsGrab()) {
        if (this.tryGrabVine(1.55)) { inp.consume('grab'); return; }
        if (this.tryGrabRail({})) { inp.consume('grab'); return; }
      }
      if (this.tryGrabVine(P.vineCatch, true)) return;
      if (v.y < 1.5 && this.tryGrabRail({ auto: true, mode: this.perchMode() })) return;
      if (v.y < 2.5 && this.airTime > 0.12) this.airAssist(dt);
    }

    const vyBefore = v.y;
    const hsBefore = hs;
    this.preWallVel.x = v.x;
    this.preWallVel.z = v.z;
    this.pos.addScaledVector(v, dt);
    this.resolve(dt);

    if (this.hitGround && vyBefore <= 1.0) {
      this.land(vyBefore, hsBefore);
      return;
    }
    if (this.wallHit && this.wallHit.col) {
      // Clipping the rim of a mushroom cap still bounces you (generous).
      const wc = this.wallHit.col;
      if (wc.bounce && this.pos.y > wc.max.y - 1.1) { this.pos.y = Math.max(this.pos.y, wc.max.y); this.doBounce(Math.max(4, -vyBefore), wc); return; }
      if (this.tryWallAction(this.wallHit, vyBefore)) return;
    }
    if (this.hitCeil && v.y > 0) v.y = 0;
    this.checkWater();
  }

  /**
   * Gentle magnetism toward a branch or vine you're already flying at, so
   * hops connect without the game steering for you.
   */
  airAssist(dt) {
    const v = this.vel;
    const hs = Math.hypot(v.x, v.z);
    let tx = 0, tz = 0, best = Infinity;
    const g = this.grind;
    const snap = this.rails.findSnap(this.pos, v, { reachH: 2.4, upReach: 0.5, downReach: 3.2, exclude: (r) => r.hang || (r === g.lastRail && this.time - g.lastTime < 0.4) });
    if (snap && snap.dist > 0.25) {
      snap.rail.pointAt(snap.s, _v3);
      tx = _v3.x - this.pos.x; tz = _v3.z - this.pos.z; best = snap.dist;
    }
    const hand = _v2.set(this.pos.x, this.pos.y + P.handHeight - 0.2, this.pos.z);
    const sw = this.swing;
    const vg = this.vines.findGrab(hand, 2.6, (vn) => vn === sw.lastVine && this.time - sw.lastTime < 0.6);
    if (vg && vg.dist < best + 0.5) { tx = vg.point.x - hand.x; tz = vg.point.z - hand.z; best = Math.hypot(tx, tz); }
    if (best === Infinity || best < 0.2) return;
    const dx = tx / best, dz = tz / best;
    // Only when already heading that way (by momentum or stick).
    const heading = hs > 1 ? (v.x * dx + v.z * dz) / hs : 0;
    const stick = (this.inputDir.x * dx + this.inputDir.z * dz) * this.inputMag;
    if (heading < 0.35 && stick < 0.5) return;
    const k = P.airAssist * (1 - best / 2.8) * dt;
    v.x += dx * k; v.z += dz * k;
  }

  land(vyBefore, hsBefore) {
    const impact = Math.max(0, -vyBefore);
    const col = this.groundCol;
    if (col && col.bounce && impact > 1.5) { this.doBounce(impact, col); return; }

    // Resolve tricks in progress.
    let bail = false;
    if (this.flip.active) {
      const remaining = this.flip.target - this.flip.angle;
      if (this.flip.angle < 0.5 && this.flip.count === 0) {
        this.flip.active = false; // barely started: just cancel
      } else if (remaining < 1.0) {
        this.completeFlip(remaining > 0.35);
      } else bail = true;
    }
    if (bail) { this.startBail('Botched flip'); return; }
    if (this.spin.active) this.completeSpin(true);
    const wasPosing = this.pose.active;
    if (this.pose.active) this.endPose(true);

    this.sliding = false;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    const rollInput = this.input.held('slide') || this.input.pressed('slide', 0.3) || wasPosing;
    let rolled = false;
    if (rollInput && hv > 4) {
      this.sliding = true;
      rolled = true;
      this.rollT = 0;
      if (impact > 14) { this.vel.x *= 1.06; this.vel.z *= 1.06; }
    } else if (impact > 24) {
      // Very hard landing without a roll: stumble and lose momentum.
      this.vel.x *= 0.55; this.vel.z *= 0.55;
    }
    this.landImpact = clamp(impact / 22, 0.15, 1);
    this.grounded = true;
    this.coyote = P.coyote;
    this.setState('ground');
    this.height = this.sliding ? P.crouchHeight : P.height;
    this.emit('land', { impact, tag: this.groundTag, rolled, speed: hv, pos: this.pos, airTime: this.airTime });
    this.airTime = 0;
  }

  doBounce(impact, col) {
    let vy = Math.max(col.bounce, Math.min(impact * 0.9, col.bounce + 8));
    let superB = false;
    if (this.input.pressed('jump', 0.25) || this.input.held('jump')) { vy += 5.5; superB = true; this.input.consume('jump'); }
    this.vel.y = vy;
    this.sliding = false;
    this.height = P.height;
    // Flips in progress simply continue through a bounce (forgiving).
    this.jumpCut = false;
    this.launchPos.copy(this.pos);
    this.pos.y += 0.05;
    this.setState('air');
    this.airTime = 0;
    this.emit('bounce', { col, vy, super: superB, pos: this.pos });
  }

  // ---------------------------------------------------------------- air tricks
  updateAirTricks(dt) {
    const inp = this.input;
    if (inp.pressed('trick', 0.12)) {
      inp.consume('trick');
      if (this.flip.active) {
        if (this.flip.target / TAU < 3) this.flip.target += TAU;
      } else this.startFlip(this.stickRelative());
    }
    // Flips.
    if (this.flip.active) {
      const rate = TAU / 0.56;
      this.flip.angle = Math.min(this.flip.target, this.flip.angle + rate * dt);
      if (this.flip.angle >= this.flip.target - 1e-4) this.completeFlip(false);
    }
    // Spins (L1/R1, Q/E).
    for (const [act, dir] of [['spinL', 1], ['spinR', -1]]) {
      if (inp.pressed(act, 0.12)) {
        inp.consume(act);
        if (!this.spin.active) {
          this.spin.active = true; this.spin.dir = dir; this.spin.angle = 0; this.spin.target = TAU;
        } else if (this.spin.dir === dir) this.spin.target += TAU;
      }
    }
    if (this.spin.active) {
      const holding = inp.held(this.spin.dir > 0 ? 'spinL' : 'spinR');
      if (holding && this.spin.target - this.spin.angle < 0.6) this.spin.target += Math.PI; // keep spinning in half turns
      const rate = TAU / 0.44;
      this.spin.angle = Math.min(this.spin.target, this.spin.angle + rate * dt);
      if (this.spin.angle >= this.spin.target - 1e-4) {
        // Only full rotations land you facing forward; round up to a full turn.
        if (Math.round(this.spin.target / Math.PI) % 2 === 1) this.spin.target += Math.PI;
        else this.completeSpin(false);
      }
    }
    // Poses (hold slide button in the air).
    if (!this.pose.active && inp.pressed('slide', 0.1) && this.airTime > 0.05) {
      inp.consume('slide');
      this.pose.active = true;
      this.pose.type = POSE_BY_DIR[this.stickRelative()];
      this.pose.time = 0;
      this.emit('poseStart', { type: this.pose.type });
    }
    if (this.pose.active) {
      this.pose.time += dt;
      if (!inp.held('slide')) this.endPose(false);
    }
  }

  startFlip(dir, auto = false) {
    const f = this.flip;
    f.active = true;
    f.angle = 0;
    f.target = TAU;
    f.count = 0;
    if (dir === 'forward') { f.axis = 'x'; f.dir = 1; f.kind = 'Front Flip'; }
    else if (dir === 'left') { f.axis = 'z'; f.dir = 1; f.kind = 'Side Flip'; }
    else if (dir === 'right') { f.axis = 'z'; f.dir = -1; f.kind = 'Side Flip'; }
    else { f.axis = 'x'; f.dir = -1; f.kind = 'Back Flip'; }
    if (auto) f.kind = 'Skid Flip';
    this.emit('flipStart', { kind: f.kind });
  }
  completeFlip(sketchy) {
    const f = this.flip;
    const n = Math.max(1, Math.round(f.target / TAU));
    const prefix = n === 3 ? 'Triple ' : n === 2 ? 'Double ' : '';
    this.emit('trick', { name: prefix + f.kind, base: f.kind === 'Side Flip' ? 500 : f.kind === 'Front Flip' ? 450 : 400, mult: n === 1 ? 1 : n === 2 ? 2.4 : 4, kind: 'flip', sketchy });
    f.active = false;
    f.angle = 0;
  }
  completeSpin(landed) {
    const s = this.spin;
    // Landing a little short of a half turn still counts (generous).
    const deg = Math.floor(((landed ? s.angle : s.target) + 0.6) / Math.PI) * 180;
    if (deg >= 360) this.emit('trick', { name: `${deg} Spin`, base: deg * 0.9, kind: 'spin' });
    s.active = false;
    s.angle = 0;
  }
  endPose(landed) {
    const p = this.pose;
    if (p.time > 0.18) {
      this.emit('trick', { name: POSE_NAMES[p.type], base: 150 + Math.min(p.time, 3) * 260, kind: 'pose', held: p.time, lastSecond: landed });
    }
    p.active = false;
    this.emit('poseEnd', {});
  }
  cancelTricks() {
    this.flip.active = false; this.flip.angle = 0;
    this.spin.active = false; this.spin.angle = 0;
    if (this.pose.active) { this.pose.active = false; this.emit('poseEnd', {}); }
    this.grind.trickT = -1;
    this.swing.flipT = -1;
  }

  // ================================================================ WALLS
  tryWallAction(w, vyBefore) {
    const col = w.col;
    const v = this.vel, d = this.inputDir, m = this.inputMag;
    const nx = w.nx, nz = w.nz;
    const hx = v.x, hz = v.z;
    const hs = Math.hypot(hx, hz) || 0;
    // Use pre-collision velocity direction (resolve clipped it).
    const vin = this.preWallVel;
    const into = -(vin.x * nx + vin.z * nz);
    const inputInto = -(d.x * nx + d.z * nz) * m;
    const recent = this.time - this.lastWallActionTime < 0.35 && this.lastWallCol === col;

    if (col.type === 'cyl' && col.climbable && !recent) {
      const tx = -nz, tz = nx; // tangent (CCW)
      const tang = hx * tx + hz * tz;
      const total = Math.hypot(into > 0 ? into : 0, tang);
      // Spirals need a proper trunk and the stick pushing toward it.
      if (col.r >= 1.5 && Math.abs(tang) > 6 && inputInto > 0.12) {
        this.startSpiral(col, Math.sign(tang), Math.max(Math.abs(tang), total * 0.85), vyBefore);
        return true;
      }
      // Run up / grab on only when steering into the trunk (or hitting it dead on).
      if (inputInto > 0.5 || into > 7) {
        if (vyBefore > -6 && total > 5) this.startTrunkRun(col, total);
        else this.startClimb(col);
        return true;
      }
    }
    if (col.type === 'box' && col.wallRun && !recent) {
      const tx = -nz, tz = nx;
      const tang = hx * tx + hz * tz;
      if (Math.abs(tang) > 6.5 && vyBefore > -8 && (inputInto > 0.15 || Math.abs(d.x * tx + d.z * tz) * m > 0.4)) {
        this.startFlatWallRun(col, nx, nz, Math.sign(tang), Math.abs(tang), vyBefore);
        return true;
      }
    }
    // Ledge grab / mantle.
    if (!col.noMantle && (inputInto > 0.3 || into > 1) && vyBefore < 8) {
      const ledge = this.findLedge(nx, nz, 0.3, 2.35);
      if (ledge) { this.startMantle(ledge, false, hs); return true; }
    }
    return false;
  }

  findLedge(nx, nz, minUp, maxUp) {
    const p = this.pos;
    for (const reach of [P.radius + 0.3, P.radius + 0.7]) {
      const qx = p.x - nx * reach, qz = p.z - nz * reach;
      const top = p.y + maxUp + 0.25;
      const hit = this.world.groundBelow(qx, top, qz, maxUp + 0.25 - minUp);
      if (!hit || hit.normal.y < 0.72) continue;
      const stand = _v3.set(qx, hit.point.y + 0.02, qz);
      if (stand.y < p.y + minUp) continue;
      if (!this.world.capsuleFree(stand, P.radius * 0.9, P.crouchHeight, 0.06)) continue;
      // Ensure we can rise vertically next to the wall without hitting a ceiling.
      const rise = _v2.set(p.x, stand.y, p.z);
      if (!this.world.capsuleFree(rise, P.radius * 0.8, 0.9, 0.12)) {
        // allow if the obstruction is just the ledge lip itself
      }
      return stand.clone();
    }
    return null;
  }

  startMantle(target, vault, hs, perch = null) {
    const mt = this.mantle;
    mt.perch = perch;
    mt.from.copy(this.pos);
    mt.to.copy(target);
    const h = target.y - this.pos.y;
    mt.dur = vault ? 0.2 + 0.08 * h : 0.26 + 0.1 * h;
    mt.t = 0;
    mt.vault = vault;
    mt.dir.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    if (mt.dir.lengthSq() < 1e-6 || perch) mt.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    mt.dir.normalize();
    mt.exitSpeed = vault ? Math.max(hs * 0.9, 5) : Math.max(hs * 0.55, 3.5);
    if (perch) mt.dur = 0.22 + 0.06 * h;
    this.yaw = Math.atan2(mt.dir.x, mt.dir.z);
    this.cancelTricks();
    this.vel.set(0, 0, 0);
    this.lastWallActionTime = this.time;
    this.setState('mantle');
    this.emit('mantle', { vault, height: h, pos: target });
  }

  updateMantle(dt) {
    const mt = this.mantle;
    mt.t = Math.min(1, mt.t + dt / mt.dur);
    const ty = easeOut(Math.min(1, mt.t / 0.7));
    const tx = smoothstep(0.25, 1, mt.t);
    const tr = mt.perch && mt.perch.trunk;
    if (tr && mt.t < 1) {
      // Swing around the trunk instead of cutting through it.
      const a0 = Math.atan2(mt.from.z - tr.z, mt.from.x - tr.x), a1 = Math.atan2(mt.to.z - tr.z, mt.to.x - tr.x);
      const r0 = Math.hypot(mt.from.x - tr.x, mt.from.z - tr.z), r1 = Math.hypot(mt.to.x - tr.x, mt.to.z - tr.z);
      const ta = smoothstep(0, 0.8, mt.t);
      const a = a0 + wrapAngle(a1 - a0) * ta;
      const rr = Math.max(tr.r + P.radius, lerp(r0, r1, tx));
      this.pos.set(tr.x + Math.cos(a) * rr, lerp(mt.from.y, mt.to.y, ty), tr.z + Math.sin(a) * rr);
      return;
    }
    this.pos.set(
      lerp(mt.from.x, mt.to.x, tx),
      lerp(mt.from.y, mt.to.y, ty) + (mt.vault ? Math.sin(mt.t * Math.PI) * 0.25 : 0),
      lerp(mt.from.z, mt.to.z, tx)
    );
    if (mt.t >= 1 && mt.perch) {
      this.pos.copy(mt.to);
      this.vel.set(0, 0, 0);
      this.startGrind(mt.perch.rail, mt.perch.s, 'run');
      return;
    }
    if (mt.t >= 1) {
      this.pos.copy(mt.to);
      this.vel.set(mt.dir.x * mt.exitSpeed, 0, mt.dir.z * mt.exitSpeed);
      this.grounded = true;
      this.groundNormal.set(0, 1, 0);
      this.setState('ground');
      const hit = this.probeGround(0.3);
      if (hit) { this.groundTag = hit.tag; this.groundCol = hit.col; this.groundNormal.copy(hit.normal); }
    }
  }

  // --- Trunk spiral run (horizontal wall run around a tree).
  startSpiral(col, sign, speed, vyBefore) {
    const w = this.wall;
    w.type = 'spiral';
    w.col = col;
    w.R = col.r + P.radius + 0.03;
    w.theta = Math.atan2(this.pos.z - col.z, this.pos.x - col.x);
    w.sign = sign;
    w.speed = clamp(speed, 7, 24);
    w.vy = clamp(vyBefore + 3, 3.5, 7.5);
    w.dist = 0;
    this.cancelTricks();
    this.lastWallActionTime = this.time;
    this.lastWallCol = col;
    this.setState('wallrun');
    this.emit('wallrun', { type: 'spiral', pos: this.pos });
  }

  // --- Run straight up a trunk, then cling.
  startTrunkRun(col, speed) {
    const w = this.wall;
    w.type = 'up';
    w.col = col;
    w.R = col.r + P.radius + 0.03;
    w.theta = Math.atan2(this.pos.z - col.z, this.pos.x - col.x);
    w.vy = clamp(speed * 0.8 + 2, 7, 14);
    w.dist = 0;
    this.cancelTricks();
    this.lastWallActionTime = this.time;
    this.lastWallCol = col;
    this.yaw = Math.atan2(-Math.cos(w.theta), -Math.sin(w.theta));
    this.setState('wallrun');
    this.emit('wallrun', { type: 'up', pos: this.pos });
  }

  startFlatWallRun(col, nx, nz, sign, speed, vyBefore) {
    const w = this.wall;
    w.type = 'flat';
    w.col = col;
    w.normal.set(nx, 0, nz);
    w.tangent.set(-nz * sign, 0, nx * sign);
    w.speed = clamp(speed, 7, 24);
    w.vy = clamp(vyBefore + 3, 3, 7);
    w.dist = 0;
    this.cancelTricks();
    this.lastWallActionTime = this.time;
    this.lastWallCol = col;
    this.setState('wallrun');
    this.emit('wallrun', { type: 'flat', pos: this.pos });
  }

  updateWallrun(dt) {
    const w = this.wall, inp = this.input, p = this.pos, v = this.vel;
    const col = w.col;
    if (w.type === 'up') {
      w.vy -= P.gravity * P.trunkRunGravity * dt;
      const ny = p.y + w.vy * dt;
      p.set(col.x + Math.cos(w.theta) * w.R, ny, col.z + Math.sin(w.theta) * w.R);
      v.set(0, w.vy, 0);
      w.dist += Math.abs(w.vy) * dt;
      this.yaw = Math.atan2(-Math.cos(w.theta), -Math.sin(w.theta));
      if (inp.pressed('jump', 0.12)) { this.wallKick(); return; }
      if (this.tryPerchAbove()) return;
      // Blocked above or reached the top?
      if (this.headBlocked() || p.y + P.height > col.y1 - 0.1) {
        if (this.tryMantleAbove()) return;
        this.startClimb(col, true);
        return;
      }
      if (w.vy < 1.2) { this.startClimb(col, true); return; }
      return;
    }

    if (w.type === 'spiral') {
      w.speed = Math.max(0, w.speed - 1.6 * dt);
      w.theta += (w.sign * w.speed / w.R) * dt;
      w.vy -= P.gravity * P.wallRunGravity * dt;
      const cx = Math.cos(w.theta), cz = Math.sin(w.theta);
      p.set(col.x + cx * w.R, p.y + w.vy * dt, col.z + cz * w.R);
      const tx = -cz * w.sign, tz = cx * w.sign;
      v.set(tx * w.speed, w.vy, tz * w.speed);
      this.yaw = Math.atan2(tx, tz);
      w.normal.set(cx, 0, cz);
      w.dist += w.speed * dt;
    } else {
      w.speed = Math.max(0, w.speed - 1.4 * dt);
      w.vy -= P.gravity * P.wallRunGravity * dt;
      v.set(w.tangent.x * w.speed, w.vy, w.tangent.z * w.speed);
      p.addScaledVector(v, dt);
      this.yaw = Math.atan2(w.tangent.x, w.tangent.z);
      w.dist += w.speed * dt;
      // Re-glue to the wall plane, and detect running off its end.
      const probe = this.world.raycast(_v.set(p.x, p.y + 1.0, p.z), _v2.set(-w.normal.x, 0, -w.normal.z), P.radius + 0.6);
      if (!probe || probe.col !== col) { this.endWallRun(); return; }
      const gap = probe.t - P.radius - 0.02;
      p.x -= w.normal.x * gap;
      p.z -= w.normal.z * gap;
    }

    if (inp.pressed('jump', 0.12)) { this.wallKick(); return; }
    if (inp.pressed('grab') || inp.pressed('slide')) { inp.consume('grab'); this.endWallRun(); return; }
    if (this.stateTime > P.wallRunTime || w.vy < -7 || w.speed < 4) { this.endWallRun(); return; }
    if (w.type === 'spiral' && (p.y + P.height > col.y1 || p.y < col.y0 - 0.5)) { this.endWallRun(); return; }
    // Collisions with other geometry (branches, ground).
    const cs = this.world.capsuleContacts(p, P.radius * 0.9, P.height, this.contacts);
    for (const c of cs) {
      if (c.col === col) continue;
      if (c.ny > 0.6 && w.vy <= 0.5) {
        this.emitWallTrick();
        this.pos.y += c.depth;
        this.vel.y = 0;
        this.groundCol = c.col;
        this.groundTag = c.tag;
        this.land(-1, w.speed);
        return;
      }
      if (c.depth > 0.12) { this.endWallRun(true); return; }
    }
  }

  headBlocked() {
    const cs = this.world.capsuleContacts(_v.copy(this.pos).add(_v2.set(0, 0.15, 0)), P.radius * 0.8, P.height, this.contacts);
    for (const c of cs) if (c.ny < -0.3 && c.col !== this.wall.col && c.col !== this.climb.col) return true;
    return false;
  }

  /** Pull up onto a branch just above the hands (from a climb or trunk run). */
  tryPerchAbove() {
    const p = this.pos;
    const trunk = this.state === 'climb' ? this.climb.col : this.state === 'wallrun' ? this.wall.col : null;
    const hand = _v.set(p.x, p.y + P.handHeight, p.z);
    const tmp = { s: 0, dist: 0 };
    let best = null;
    for (const r of this.rails.rails) {
      if (r.hang || r.kind === 'rope') continue;
      const m = trunk ? 2.5 + trunk.r * 2 : 1.5;
      if (hand.x < r.min.x - m || hand.x > r.max.x + m || hand.z < r.min.z - m || hand.z > r.max.z + m || hand.y < r.min.y - 1.5 || hand.y > r.max.y + 1.5) continue;
      r.closest(hand, tmp);
      if (tmp.dist > 1.25) {
        // On a trunk, branches growing out of it on any side are in reach.
        if (!trunk) continue;
        r.closest(_v3.set(trunk.x, hand.y, trunk.z), tmp);
        if (tmp.dist > trunk.r + 1.0) continue;
      }
      const top = this.railPos(r, tmp.s, _v2);
      if (top.y < p.y + 0.9 || top.y > p.y + 2.6) continue;
      if (Math.abs(r.tangentAt(tmp.s, _t).y) > P.runMaxSlope) continue;
      if (!best || tmp.dist < best.dist) best = { rail: r, s: tmp.s, dist: tmp.dist, top: top.clone() };
    }
    if (!best) return false;
    // Face away from the trunk we were on, and step out clear of it.
    const col = trunk;
    if (col && col.type === 'cyl') {
      this.yaw = Math.atan2(p.x - col.x, p.z - col.z);
      const r = best.rail, clear = col.r + P.radius + 0.15;
      const away = (ss) => { r.pointAt(clamp(ss, 0, r.length), _v3); return Math.hypot(_v3.x - col.x, _v3.z - col.z); };
      const step = away(best.s + 0.3) >= away(best.s - 0.3) ? 0.15 : -0.15;
      for (let i = 0; i < 40 && away(best.s) < clear; i++) best.s = clamp(best.s + step, 0, r.length);
      if (away(best.s) < clear - 0.2) return false;
      this.railPos(r, best.s, best.top);
    }
    this.startMantle(best.top, false, 3, { rail: best.rail, s: best.s, trunk: col && col.type === 'cyl' ? col : null });
    if (col && col.type === 'cyl') this.yaw = Math.atan2(best.top.x - col.x, best.top.z - col.z);
    return true;
  }

  tryMantleAbove() {
    // Look for a standable surface just above the head (branch, deck).
    const col = this.wall.col || this.climb.col;
    let ox = 0, oz = 0;
    if (col && col.type === 'cyl') {
      ox = this.pos.x - col.x; oz = this.pos.z - col.z;
      const l = Math.hypot(ox, oz) || 1;
      ox /= l; oz /= l;
    }
    for (const k of [0, 0.5, 1.0, 1.5]) {
      const qx = this.pos.x + ox * k, qz = this.pos.z + oz * k;
      const hit = this.world.groundBelow(qx, this.pos.y + 3.4, qz, 2.4);
      if (hit && hit.normal.y > 0.7 && hit.point.y > this.pos.y + 0.6) {
        const stand = _v3.set(qx, hit.point.y + 0.02, qz);
        if (this.world.capsuleFree(stand, P.radius * 0.9, P.crouchHeight, 0.06)) {
          this.startMantle(stand.clone(), false, 3);
          return true;
        }
      }
    }
    return false;
  }

  wallKick() {
    const w = this.wall, d = this.inputDir, m = this.inputMag;
    let nx, nz;
    if (w.type === 'flat') { nx = w.normal.x; nz = w.normal.z; }
    else { nx = Math.cos(w.theta); nz = Math.sin(w.theta); }
    let vx, vz, vy = P.wallKickUp;
    if (w.type === 'spiral' || w.type === 'flat') {
      const tx = this.vel.x, tz = this.vel.z;
      const sp = Math.hypot(tx, tz) || 1;
      let dx = tx / sp * 0.7 + nx * 0.75, dz = tz / sp * 0.7 + nz * 0.75;
      if (m > 0.3 && d.x * nx + d.z * nz > -0.2) { dx = dx * 0.4 + d.x; dz = dz * 0.4 + d.z; }
      const l = Math.hypot(dx, dz) || 1;
      const s = Math.max(sp * 0.92, 8);
      vx = dx / l * s; vz = dz / l * s;
      vy = 9.5;
    } else {
      // Kick off the trunk backwards, or toward the stick direction.
      let dx = nx, dz = nz;
      if (m > 0.3 && d.x * nx + d.z * nz > -0.3) { dx = nx * 0.5 + d.x; dz = nz * 0.5 + d.z; }
      const l = Math.hypot(dx, dz) || 1;
      vx = dx / l * P.wallKick; vz = dz / l * P.wallKick;
    }
    this.vel.set(vx, vy, vz);
    this.yaw = Math.atan2(vx, vz);
    this.pos.x += nx * 0.08; this.pos.z += nz * 0.08;
    this.input.consume('jump');
    this.jumpCut = false;
    this.launchPos.copy(this.pos);
    this.lastWallActionTime = this.time;
    this.emitWallTrick();
    this.setState('air');
    this.airTime = 0.1;
    this.emit('wallKick', { pos: this.pos });
  }

  emitWallTrick() {
    const w = this.wall;
    if (this.state === 'wallrun') {
      if (w.type === 'spiral') this.emit('trick', { name: 'Trunk Spiral', base: 350 + w.dist * 25, kind: 'wall' });
      else if (w.type === 'flat') this.emit('trick', { name: 'Wall Run', base: 250 + w.dist * 25, kind: 'wall' });
      else this.emit('trick', { name: 'Trunk Run', base: 200 + w.dist * 30, kind: 'wall' });
    }
    if (this.state === 'climb' && this.climb.climbed > 1.5) {
      this.emit('trick', { name: 'Scramble', base: 50 + this.climb.climbed * 10, kind: 'climb' });
    }
  }

  endWallRun(bumped = false) {
    const w = this.wall;
    this.emitWallTrick();
    if (w.type === 'spiral') {
      const cx = Math.cos(w.theta), cz = Math.sin(w.theta);
      this.vel.x += cx * 2; this.vel.z += cz * 2;
    } else if (w.type === 'flat') {
      this.vel.x += w.normal.x * 2; this.vel.z += w.normal.z * 2;
    }
    if (bumped) { this.vel.x *= 0.3; this.vel.z *= 0.3; }
    this.jumpCut = false;
    this.launchPos.copy(this.pos);
    this.lastWallActionTime = this.time;
    this.setState('air');
    this.airTime = 0.1;
  }

  // ================================================================ CLIMB
  tryClimbAdjacent() {
    const cs = this.world.capsuleContacts(this.pos, P.radius + 0.25, P.height, this.contacts);
    for (const c of cs) {
      if (c.col && c.col.climbable && c.col.type === 'cyl' && Math.abs(c.ny) < 0.3) {
        this.startClimb(c.col);
        return true;
      }
    }
    return false;
  }

  startClimb(col, fromRun = false) {
    const c = this.climb;
    c.col = col;
    c.R = col.r + P.radius + 0.03;
    c.theta = Math.atan2(this.pos.z - col.z, this.pos.x - col.x);
    c.phase = 0;
    c.climbed = fromRun ? this.wall.dist : 0;
    c.moving = 0;
    this.wall.col = null;
    this.cancelTricks();
    this.vel.set(0, 0, 0);
    this.sliding = false;
    this.height = P.height;
    const np = _v.set(col.x + Math.cos(c.theta) * c.R, this.pos.y, col.z + Math.sin(c.theta) * c.R);
    this.snapTo(np);
    this.yaw = Math.atan2(-Math.cos(c.theta), -Math.sin(c.theta));
    this.setState('climb');
    this.emit('climb', { pos: this.pos });
  }

  updateClimb(dt) {
    const c = this.climb, inp = this.input, col = c.col, p = this.pos;
    const my = inp.moveY, mx = inp.moveX;
    let vy = 0, vth = 0;
    if (my > 0.2) vy = P.climbUp * my;
    else if (my < -0.2) vy = P.climbDown * my;
    if (Math.abs(mx) > 0.2) vth = -mx * P.climbSide / c.R;
    const oldY = p.y, oldTh = c.theta;
    p.y += vy * dt;
    c.theta += vth * dt;
    p.x = col.x + Math.cos(c.theta) * c.R;
    p.z = col.z + Math.sin(c.theta) * c.R;
    this.yaw = Math.atan2(-Math.cos(c.theta), -Math.sin(c.theta));
    c.moving = Math.hypot(vy, vth * c.R);
    c.phase += c.moving * dt * 1.4;
    if (vy > 0) c.climbed += vy * dt;
    this.vel.set(0, vy, 0);

    // Obstacles: branches above, decks, ground below.
    const cs = this.world.capsuleContacts(p, P.radius * 0.85, P.height, this.contacts);
    let blocked = false, onGround = false;
    for (const ct of cs) {
      if (ct.col === col) continue;
      if (ct.ny > 0.6 && vy <= 0) onGround = true;
      else if (ct.depth > 0.03) blocked = true;
    }
    if (onGround) {
      const hit = this.probeGround(0.4);
      if (hit) {
        p.y = hit.point.y;
        this.groundCol = hit.col;
        this.groundTag = hit.tag;
        this.groundNormal.copy(hit.normal);
      }
      this.setState('ground');
      this.grounded = true;
      return;
    }
    if (vy >= 0 && this.stateTime > 0.15 && this.tryPerchAbove()) return;
    if (blocked || p.y + P.height > col.y1 - 0.05) {
      if (vy > 0 && this.tryMantleAbove()) return;
      p.y = oldY; c.theta = oldTh;
      p.x = col.x + Math.cos(c.theta) * c.R;
      p.z = col.z + Math.sin(c.theta) * c.R;
      c.moving = 0;
    }
    if (inp.pressed('jump', 0.12)) {
      if (inp.moveY > 0.5 && Math.abs(inp.moveX) < 0.6 && p.y + P.height < col.y1 - 1) {
        // Climb leap: bound further up the trunk.
        inp.consume('jump');
        this.startTrunkRun(col, 0);
        this.wall.vy = P.climbLeap;
        this.wall.dist = c.climbed;
        this.emit('climbLeap', { pos: this.pos });
        return;
      }
      this.wall.type = 'up';
      this.wall.theta = c.theta;
      this.wallKick();
      return;
    }
    if (inp.pressed('grab') || inp.pressed('slide')) {
      inp.consume('grab'); inp.consume('slide');
      this.vel.set(Math.cos(c.theta) * 2, 0, Math.sin(c.theta) * 2);
      this.lastWallActionTime = this.time;
      this.lastWallCol = col;
      this.setState('air');
    }
  }

  // ================================================================ GRIND / BRANCH RUN
  // A rail can be ridden two ways: 'grind' (THPS-style slide, momentum, tricks)
  // or 'run' (feet on the branch, the stick drives you along it). Landing on a
  // branch puts you in run mode; grab or slide kicks it into a grind.
  tryGrabRail(opts) {
    const g = this.grind;
    const exclude = (r) => (r === g.lastRail && this.time - g.lastTime < (opts.auto ? 0.2 : 0.45));
    let snapOpts;
    // Auto-perching only happens on natural walkable rails (branches, logs).
    if (opts.auto) snapOpts = { reachH: 0.85, upReach: 0.4, downReach: 1.0, exclude: (r) => exclude(r) || r.hang || (opts.mode !== 'grind' && r.kind !== 'branch' && r.kind !== 'log') };
    else if (opts.fromGround) snapOpts = { reachH: 1.4, upReach: 1.5, downReach: 0.6, exclude };
    else snapOpts = { reachH: 1.5, exclude };
    const snap = this.rails.findSnap(this.pos, this.vel, snapOpts);
    if (!snap) return false;
    const rail = snap.rail;
    let mode = opts.mode || 'grind';
    if (mode === 'run' && Math.abs(rail.tangentAt(snap.s, _t).y) > P.runMaxSlope) mode = 'grind';
    if (rail.hang) mode = 'grind';
    this.startGrind(rail, snap.s, mode);
    return true;
  }

  startGrind(rail, s, mode = 'grind') {
    const g = this.grind;
    const t = rail.tangentAt(s, _t);
    const v = this.vel;
    const along = v.dot(t);
    const hs = Math.hypot(v.x, v.z);
    let dir;
    if (rail.oneWay) dir = rail.pts[rail.pts.length - 1].y <= rail.pts[0].y ? 1 : -1;
    else if (Math.abs(along) > 1.5) dir = Math.sign(along);
    else {
      const ref = this.inputMag > 0.3 ? this.inputDir : _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir = ref.x * t.x + ref.z * t.z >= 0 ? 1 : -1;
    }
    const fromAir = this.state === 'air';
    g.rail = rail;
    g.s = s;
    g.dir = dir;
    g.mode = mode;
    g.speed = mode === 'run' ? Math.abs(along) : Math.max(Math.abs(along), hs * 0.85, rail.minSpeed);
    g.dist = 0;
    g.runDist = 0;
    g.trickT = -1;
    g.switch = false;
    g.lean = 0;
    g.entryTime = this.time;
    g.balance = 0;
    this.cancelTricksForGrind();
    this.sliding = false;
    this.height = P.height;
    const np = this.railPos(rail, s, _v2);
    this.snapTo(np);
    if (fromAir) this.landImpact = clamp(-v.y / 26, 0.1, 0.6);
    this.setState('grind');
    if (mode === 'grind') this.emit('grindStart', { rail, speed: g.speed, pos: this.pos });
    else this.emit('perch', { rail, speed: g.speed, pos: this.pos, fromAir, impact: Math.max(0, -v.y) });
  }

  /** Switch between running on a branch and grinding it, keeping momentum. */
  setRailMode(mode) {
    const g = this.grind;
    if (g.mode === mode) return;
    g.mode = mode;
    g.dist = 0;
    if (mode === 'grind') {
      g.speed = Math.max(g.speed, g.rail.minSpeed + 1.5);
      // Face along the stick if it points along the rail.
      const t = g.rail.tangentAt(g.s, _t);
      const st = (this.inputDir.x * t.x + this.inputDir.z * t.z) * this.inputMag;
      if (g.speed < 3 && Math.abs(st) > 0.3) g.dir = Math.sign(st);
      this.emit('grindStart', { rail: g.rail, speed: g.speed, pos: this.pos });
    } else {
      this.emit('grindEnd', { rail: g.rail, dist: g.dist });
    }
  }

  cancelTricksForGrind() {
    // Landing on a rail mid-flip is forgiving: finish it if nearly done.
    if (this.flip.active) {
      if (this.flip.target - this.flip.angle < 1.2 && this.flip.angle > 0.5) this.completeFlip(true);
      this.flip.active = false;
    }
    if (this.spin.active) this.completeSpin(true);
    if (this.pose.active) this.endPose(true);
  }

  railPos(rail, s, out) {
    rail.pointAt(s, out);
    if (rail.hang) out.y -= P.handHeight;
    else out.y += rail.radiusAt(s);
    return out;
  }

  updateGrind(dt) {
    const g = this.grind, inp = this.input, rail = g.rail;
    const t = rail.tangentAt(g.s, _t).multiplyScalar(g.dir);
    if (g.mode === 'run') {
      // Feet on the branch: the stick (projected on the branch) drives you.
      if (Math.abs(t.y) > P.runMaxSlope) { this.setRailMode('grind'); }
      else {
        const stick = (this.inputDir.x * t.x + this.inputDir.z * t.z) * this.inputMag; // + forward along dir
        const target = Math.abs(stick) > 0.2 ? Math.sign(stick) * P.runSpeed * Math.min(1, Math.abs(stick) * 1.15) : 0;
        let u = g.speed; // signed speed along dir
        if (target === 0) u = approach(u, 0, P.decel * 0.8 * dt);
        else if (Math.sign(target) === Math.sign(u) && Math.abs(u) > Math.abs(target)) u = approach(u, target, (P.overDecay + (Math.abs(u) - Math.abs(target)) * 0.12) * dt);
        else u = approach(u, target, P.accel * (Math.sign(target) !== Math.sign(u) && Math.abs(u) > 1 ? 1.6 : 1.1) * dt);
        u += -t.y * 9 * dt; // downhill helps, uphill drags
        // Holding the stick across the branch steps off it.
        const side = (this.inputDir.x * -t.z + this.inputDir.z * t.x) * this.inputMag;
        g.sideT = Math.abs(stick) < 0.45 && Math.abs(side) > 0.7 ? (g.sideT || 0) + dt : 0;
        if (g.sideT > 0.22) {
          g.sideT = 0;
          this.exitRail(false);
          this.vel.x += this.inputDir.x * 3.5; this.vel.z += this.inputDir.z * 3.5;
          this.vel.y = 2;
          return;
        }
        if (u < 0) { g.dir = -g.dir; u = -u; t.multiplyScalar(-1); }
        g.speed = u;
      }
    }
    if (g.mode === 'grind') {
      // Gravity along the rail.
      g.speed += -P.grindGravity * t.y * dt;
      g.speed -= g.speed * P.grindFriction * dt;
      if (inp.held('slide') && !rail.hang) g.speed += 1.2 * dt; // tuck for speed
      if (g.speed < 0) {
        // Rolled back on an uphill section.
        g.dir = -g.dir;
        g.speed = -g.speed;
        if (rail.oneWay) { this.exitRail(false); return; }
      }
      if (Math.abs(t.y) < 0.15 && g.speed < rail.minSpeed * 0.7) g.speed = approach(g.speed, rail.minSpeed * 0.7, 4 * dt);
      // Above cruising speed, grinds bleed speed a little faster (keeps long descents sane).
      if (g.speed > 17) g.speed -= (g.speed - 17) * 0.35 * dt;
      g.speed = Math.min(g.speed, P.grindMax);
      if (rail.hang) {
        // Zip vines brake near the end so you can stick the landing.
        const remaining = g.dir > 0 ? rail.length - g.s : g.s;
        if (remaining < 9) g.speed = approach(g.speed, 6.5, 16 * dt);
      }
    }
    const ds = g.dir * g.speed * dt;
    g.s += ds;
    if (g.mode === 'grind') g.dist += Math.abs(ds); else g.runDist += Math.abs(ds);
    const tt = rail.tangentAt(clamp(g.s, 0, rail.length), _t).multiplyScalar(g.dir);

    // Steering input leans the body.
    const right = _v.set(-tt.z, 0, tt.x);
    const lean = (this.inputDir.x * right.x + this.inputDir.z * right.z) * this.inputMag;
    g.lean = lerp(g.lean, lean, 1 - Math.exp(-dt * 8));

    if (g.s < 0 || g.s > rail.length) {
      if (this.continueRail()) return;
      g.s = clamp(g.s, 0, rail.length);
      // The branch ends at a trunk: grab on and climb.
      const trunk = this.trunkNear(this.railPos(rail, g.s, _v3), 1.4);
      if (trunk) { this.exitRail(false, false, false, true); this.startClimb(trunk); return; }
      this.exitRail(false);
      return;
    }
    this.railPos(rail, g.s, this.pos);
    if (g.trickT >= 0) {
      g.trickT += dt;
      const dur = g.trickKind === 'switch' ? 0.38 : 0.62;
      if (g.trickT >= dur) {
        if (g.trickKind === 'switch') { g.switch = !g.switch; this.emit('trick', { name: 'Switch Hop', base: 150, kind: 'grindtrick' }); }
        else this.emit('trick', { name: 'Flip Grind', base: 400, kind: 'grindtrick' });
        g.trickT = -1;
      }
    }
    this.vel.copy(tt).multiplyScalar(g.speed);
    if (g.mode === 'grind' || g.speed > 0.4) this.yaw = Math.atan2(tt.x, tt.z);
    else if (this.inputMag > 0.3) this.yaw = approachAngle(this.yaw, Math.atan2(this.inputDir.x, this.inputDir.z), 10 * dt);

    if (g.mode === 'run') {
      const strideLen = clamp(1.0 + g.speed * 0.36, 1.2, 5.2);
      this.footPhase += (g.speed * dt) / strideLen;
      if (Math.floor(this.footPhase * 2) !== Math.floor(this.lastStepPhase * 2) && g.speed > 1) this.emit('footstep', { tag: 'bark', speed: g.speed, pos: this.pos });
      this.lastStepPhase = this.footPhase;
    }

    // Actions.
    if (inp.pressed('jump', P.jumpBuffer)) { this.exitRail(true); return; }
    if (!rail.hang) {
      if (g.mode === 'run' && (inp.pressed('grab', 0.1) || inp.pressed('slide', 0.1))) {
        inp.consume('grab'); inp.consume('slide');
        this.setRailMode('grind');
      } else if (g.mode === 'grind' && g.trickT < 0 && this.time - g.entryTime > 0.1) {
        if (inp.pressed('trick', 0.1)) { inp.consume('trick'); g.trickT = 0; g.trickKind = 'flip'; this.emit('grindTrick', { kind: 'flip' }); }
        else if (inp.pressed('spinL', 0.1) || inp.pressed('spinR', 0.1)) {
          inp.consume('spinL'); inp.consume('spinR');
          g.trickT = 0; g.trickKind = 'switch'; this.emit('grindTrick', { kind: 'switch' });
        }
      }
    } else if (inp.pressed('grab') && this.time - g.entryTime > 0.25) { inp.consume('grab'); this.exitRail(false, true); return; }
    // Ran into something solid (a trunk at the base of the branch, a wall)?
    const cs = this.world.capsuleContacts(this.pos, P.radius * 0.8, P.height * 0.9, this.contacts);
    for (const c of cs) {
      if (Math.abs(c.ny) < 0.45 && c.depth > 0.12 && !(c.col && c.col.data && c.col.data.rail === rail)) {
        const fwd = c.nx * tt.x + c.nz * tt.z;
        if (fwd < -0.4) {
          if (c.col && c.col.climbable && c.col.type === 'cyl') { this.exitRail(false, false, false, true); this.startClimb(c.col); return; }
          if (g.mode === 'run') {
            // Stop against it.
            g.s -= ds;
            g.speed = 0;
            this.railPos(rail, g.s, this.pos);
            break;
          }
          if (c.depth > 0.22) { this.exitRail(false, true, true); return; }
        }
      }
    }
    this.checkWater();
  }

  /** A climbable trunk whose surface is within `reach` of p. */
  trunkNear(p, reach) {
    const cs = this.world.query(p.x - reach - 3, p.y - 1, p.z - reach - 3, p.x + reach + 3, p.y + 2, p.z + reach + 3, []);
    let best = null, bd = reach;
    for (const c of cs) {
      if (c.type !== 'cyl' || !c.climbable || p.y < c.y0 || p.y > c.y1 - 1) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z) - c.r;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  continueRail() {
    const g = this.grind;
    const endS = g.s < 0 ? 0 : g.rail.length;
    const endPt = g.rail.pointAt(endS, _v2);
    const tan = g.rail.tangentAt(endS, _v3).multiplyScalar(g.dir);
    const overshoot = g.s < 0 ? -g.s : g.s - g.rail.length;
    let best = null;
    const tmp = { s: 0, dist: 0 };
    for (const r of this.rails.rails) {
      if (r === g.rail || r.hang !== g.rail.hang) continue;
      if (endPt.x < r.min.x - 1.2 || endPt.x > r.max.x + 1.2 || endPt.z < r.min.z - 1.2 || endPt.z > r.max.z + 1.2 || endPt.y < r.min.y - 1.2 || endPt.y > r.max.y + 1.2) continue;
      r.closest(endPt, tmp);
      if (tmp.dist > 1.0) continue;
      const rt = r.tangentAt(tmp.s, _n);
      const al = rt.dot(tan);
      if (Math.abs(al) < 0.55) continue;
      if (!best || tmp.dist < best.dist) best = { rail: r, s: tmp.s, dir: Math.sign(al), dist: tmp.dist };
    }
    if (!best) return false;
    if (g.mode === 'grind') this.emit('trick', { name: g.rail.name, base: 100 + g.dist * 30 * g.rail.info.points, kind: 'grind', dist: g.dist });
    g.rail = best.rail;
    g.s = best.s + best.dir * overshoot;
    g.dir = best.dir;
    g.dist = 0;
    this.railPos(g.rail, clamp(g.s, 0, g.rail.length), _v);
    this.snapTo(_v);
    if (g.mode === 'grind') this.emit('railTransfer', { rail: g.rail });
    return true;
  }

  exitRail(jump, hop = false, bumped = false, quiet = false) {
    const g = this.grind, inp = this.input, rail = g.rail;
    const t = rail.tangentAt(clamp(g.s, 0, rail.length), _t).multiplyScalar(g.dir);
    const v = this.vel;
    v.copy(t).multiplyScalar(g.speed);
    if (bumped) v.multiplyScalar(-0.2);
    if (g.trickT >= 0) {
      if (g.trickKind === 'flip') this.emit('trick', { name: 'Flip Grind', base: 300, kind: 'grindtrick' });
      g.trickT = -1;
    }
    if (g.mode === 'grind' && g.dist > 0.6) this.emit('trick', { name: rail.name, base: 100 + g.dist * 30 * rail.info.points, kind: 'grind', dist: g.dist });
    if (g.mode === 'run' && g.runDist > 5) this.emit('trick', { name: 'Branch Run', base: 30 + g.runDist * 6, kind: 'run' });
    if (jump) {
      inp.consume('jump');
      const right = _v.set(-t.z, 0, t.x).normalize();
      const lat = (this.inputDir.x * right.x + this.inputDir.z * right.z) * this.inputMag;
      if (g.mode === 'run') {
        // Jumping off a branch works like a ground jump: the stick steers freely.
        const hs = Math.hypot(v.x, v.z);
        if (this.inputMag > 0.3) {
          const sp = Math.max(hs, P.runSpeed * this.inputMag * 0.85);
          const fx = this.inputDir.x * 0.75 + (hs > 0.5 ? v.x / hs : 0) * 0.25, fz = this.inputDir.z * 0.75 + (hs > 0.5 ? v.z / hs : 0) * 0.25;
          const fl = Math.hypot(fx, fz) || 1;
          v.x = fx / fl * sp; v.z = fz / fl * sp;
        }
        v.y = P.jumpVel + Math.max(0, v.y) * 0.4;
      } else {
        v.y = Math.max(v.y, 0) * 0.5 + (rail.hang ? 6 : P.grindJump);
        v.x += right.x * lat * 4.5; v.z += right.z * lat * 4.5;
      }
      this.jumpCut = true;
      this.emit('jump', { name: rail.hang ? 'Zip Drop' : g.mode === 'run' ? 'Branch Hop' : 'Rail Hop', kind: 'rail', pos: this.pos });
    } else {
      if (!rail.hang && g.mode === 'grind') v.y += hop ? 4 : 0.8;
      this.jumpCut = false;
    }
    if (g.mode === 'grind') this.emit('grindEnd', { rail, dist: g.dist, quiet });
    g.lastRail = rail;
    g.lastTime = this.time;
    g.rail = null;
    this.launchPos.copy(this.pos);
    this.pos.y += 0.02;
    this.setState('air');
    this.airTime = 0.08;
  }

  // ================================================================ SWING
  tryGrabVine(reach, auto = false) {
    const sw = this.swing;
    const exclude = (v) => v === sw.lastVine && this.time - sw.lastTime < (auto ? 0.6 : 0.45);
    const hand = _v.set(this.pos.x, this.pos.y + P.handHeight - 0.1, this.pos.z);
    let g = this.vines.findGrab(hand, reach, exclude);
    if (!g) {
      hand.y = this.pos.y + 1.1;
      g = this.vines.findGrab(hand, reach * 0.85, exclude);
    }
    if (!g) return false;
    this.startSwing(g.vine, g.along, g.point);
    return true;
  }

  startSwing(vine, along, point) {
    const sw = this.swing;
    sw.vine = vine;
    sw.d = clamp(along, 2.5, vine.length - 0.2);
    // Hand on the rope; project onto the constraint sphere.
    const A = vine.anchor;
    const H = sw.hand.copy(point);
    const dir = _v.subVectors(H, A);
    const l = dir.length();
    if (l > sw.d) H.copy(A).addScaledVector(dir, sw.d / l);
    sw.flipT = -1;
    sw.startTime = this.time;
    sw.maxSpeed = 0;
    sw.startY = this.pos.y;
    vine.held = true;
    vine.holdDist = sw.d;
    vine.hand.copy(H);
    // Catching a vine at speed soaks up some of it (keeps the arc sane).
    if (this.vel.length() > P.swingCatchMax) this.vel.setLength(P.swingCatchMax);
    if (this.vel.length() < 3) {
      const f = this.inputMag > 0.2 ? this.inputDir : _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.vel.addScaledVector(f, 3);
    }
    this.cancelTricksForGrind();
    this.sliding = false;
    this.height = P.height;
    const ropeDir = _v2.subVectors(H, A).normalize();
    const feet = _v3.copy(H).addScaledVector(ropeDir, P.handHeight);
    this.snapTo(feet);
    this.setState('swing');
    this.emit('swingGrab', { vine, speed: this.vel.length(), pos: this.pos });
  }

  updateSwing(dt) {
    const sw = this.swing, inp = this.input, v = this.vel, vine = sw.vine;
    const A = vine.anchor, H = sw.hand;
    v.y -= P.gravity * dt;
    const rope = _v.subVectors(H, A);
    const rl = rope.length() || 1;
    rope.multiplyScalar(1 / rl);
    // Pump: push along the swing plane with the stick.
    if (this.inputMag > 0.1) {
      const d = this.inputDir;
      const dn = d.x * rope.x + d.z * rope.z;
      _v2.set(d.x - rope.x * dn, -rope.y * dn, d.z - rope.z * dn);
      const sp = v.length();
      // Pumping works through the bottom of the arc, like on a real swing.
      const bottom = smoothstep(0.55, 0.95, -rope.y);
      if (sp < P.swingMax || _v2.dot(v) < 0) v.addScaledVector(_v2, P.swingPump * this.inputMag * dt * (0.25 + 0.75 * bottom));
    }
    v.multiplyScalar(1 - 0.06 * dt);
    H.addScaledVector(v, dt);
    // Rope constraint (taut only).
    rope.subVectors(H, A);
    const L = rope.length();
    if (L > sw.d) {
      rope.multiplyScalar(1 / L);
      H.copy(A).addScaledVector(rope, sw.d);
      const vr = v.dot(rope);
      if (vr > 0) v.addScaledVector(rope, -vr);
    } else rope.multiplyScalar(1 / (L || 1));
    sw.maxSpeed = Math.max(sw.maxSpeed, v.length());
    // Body hangs below the hand along the rope.
    const feet = _v2.copy(H).addScaledVector(rope, P.handHeight);
    this.pos.copy(feet);
    vine.hand.copy(H);
    sw.angle = Math.acos(clamp(-rope.y, -1, 1));
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1) this.yaw = approachAngle(this.yaw, Math.atan2(v.x, v.z), 6 * dt);

    // Collision of the body with the world.
    this.resolve(dt);
    const push = _v3.subVectors(this.pos, feet);
    if (push.lengthSq() > 1e-8) {
      H.add(push);
      if (this.hitGround && v.length() < 6) {
        this.releaseVine(false);
        this.setState('ground');
        return;
      }
    }

    // Swing flip.
    if (sw.flipT >= 0) {
      sw.flipT += dt;
      if (sw.flipT > 0.6) { sw.flipT = -1; this.emit('trick', { name: 'Vine Flip', base: 450, kind: 'swingtrick' }); }
    } else if (inp.pressed('trick', 0.1)) { inp.consume('trick'); sw.flipT = 0; this.emit('flipStart', { kind: 'Vine Flip' }); }

    if (inp.pressed('jump', 0.12)) { this.releaseVine(true); return; }
    if (inp.pressed('grab') && this.time - sw.startTime > 0.25) { inp.consume('grab'); this.releaseVine(false); return; }
    if (inp.pressed('slide')) { inp.consume('slide'); this.releaseVine(false); return; }
    this.checkWater();
  }

  releaseVine(jump) {
    const sw = this.swing, v = this.vel, vine = sw.vine;
    vine.held = false;
    vine.pushImpulse.set(-v.x * 0.4, 0, -v.z * 0.4);
    const sp = v.length();
    if (sw.flipT >= 0) { this.emit('trick', { name: 'Vine Flip', base: 300, kind: 'swingtrick' }); sw.flipT = -1; }
    if (jump) {
      v.multiplyScalar(P.swingReleaseMult);
      v.y += P.swingReleaseUp;
      this.input.consume('jump');
    }
    const t = this.time - sw.startTime;
    if (t > 0.35) this.emit('trick', { name: jump && v.y > 6 ? 'Vine Launch' : 'Vine Swing', base: 200 + sw.maxSpeed * 20 + (jump && v.y > 6 ? 150 : 0), kind: 'swing' });
    this.emit('swingRelease', { vine, speed: sp, jump, pos: this.pos });
    sw.lastVine = vine;
    sw.lastTime = this.time;
    sw.vine = null;
    this.jumpCut = false;
    this.launchPos.copy(this.pos);
    this.setState('air');
    this.airTime = 0.1;
  }

  // ================================================================ WATER
  checkWater() {
    const w = this.world.waterAt(this.pos.x, this.pos.z);
    if (this.pos.y < w - 0.95 && this.state !== 'swim') {
      const impact = Math.max(0, -this.vel.y);
      if (this.state === 'swing') this.releaseVine(false);
      if (this.state === 'grind') { this.grind.rail = null; }
      const cannonball = this.pose.active && this.pose.type === 'cannonball';
      if (this.flip.active) this.flip.active = false;
      if (this.spin.active) this.spin.active = false;
      if (this.pose.active) this.endPose(true);
      if (cannonball && impact > 8) this.emit('trick', { name: 'Splashdown', base: 300 + impact * 15, kind: 'water' });
      this.sliding = false;
      this.height = P.height;
      this.setState('swim');
      this.emit('splash', { impact, pos: this.pos, waterY: w });
      return true;
    }
    return false;
  }

  updateSwim(dt) {
    const v = this.vel, inp = this.input, d = this.inputDir, m = this.inputMag;
    const w = this.world.waterAt(this.pos.x, this.pos.z);
    const target = w - 1.32;
    v.y += ((target - this.pos.y) * 40 - v.y * 7) * dt;
    const tx = d.x * P.swimSpeed * m, tz = d.z * P.swimSpeed * m;
    v.x = approach(v.x, tx, 9 * dt);
    v.z = approach(v.z, tz, 9 * dt);
    if (Math.hypot(v.x, v.z) > 0.5) this.yaw = approachAngle(this.yaw, Math.atan2(v.x, v.z), 6 * dt);
    this.pos.addScaledVector(v, dt);
    this.resolve(dt);
    this.swim.t += dt * (0.6 + Math.hypot(v.x, v.z) * 0.4);
    if (inp.pressed('jump', 0.12) && this.pos.y > w - 1.6) {
      inp.consume('jump');
      v.y = 9.5;
      v.x = d.x * 5 * m + v.x * 0.5; v.z = d.z * 5 * m + v.z * 0.5;
      this.jumpCut = true;
      this.launchPos.copy(this.pos);
      this.pos.y = Math.max(this.pos.y, w - 0.9);
      this.setState('air');
      this.emit('jump', { name: 'Water Hop', kind: 'water', pos: this.pos });
      return;
    }
    if (this.hitGround && this.pos.y > w - 0.95) {
      this.setState('ground');
      this.grounded = true;
    } else if (w === -Infinity || this.pos.y > w - 0.7) {
      // Waded out of shallow water.
      this.setState('air');
    }
  }

  // ================================================================ BAIL
  startBail(reason) {
    this.cancelTricks();
    this.releaseHolds();
    this.sliding = false;
    this.bail.t = 0;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    this.vel.y = Math.max(this.vel.y, 2);
    this.height = P.height;
    this.setState('bail');
    this.emit('bail', { reason, pos: this.pos });
  }

  updateBail(dt) {
    const v = this.vel;
    this.bail.t += dt;
    v.y = Math.max(v.y - P.gravity * dt, -P.maxFall);
    if (this.grounded) {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1e-4) { const k = approach(hs, 0, 9 * dt) / hs; v.x *= k; v.z *= k; }
    }
    this.pos.addScaledVector(v, dt);
    this.resolve(dt);
    this.grounded = this.hitGround || !!this.probeGround(0.1);
    if (this.grounded && v.y < 0) v.y = 0;
    if (this.bail.t > 1.15 && this.grounded) {
      this.setState('ground');
    }
    if (this.checkWater()) return;
  }
}
