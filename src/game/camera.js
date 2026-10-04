// Third-person orbit camera with momentum-aware framing, auto-follow,
// collision avoidance, speed FOV and impact shake.
import * as THREE from 'three';
import { clamp, lerp, dampT, wrapAngle, dampAngle, smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.28;
    this.dist = 5.4;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.idleLook = 0;
    this.fov = 70;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.collDist = 5.4;
    this.settings = { autoCam: true, fov: 70, shake: true };
    this.mode = 'play';
    this.orbitT = 0;
  }

  reset(player) {
    this.yaw = player.yaw + Math.PI;
    this.pitch = 0.28;
    this.smoothTarget.copy(player.pos).add(_v.set(0, 1.5, 0));
    this.collDist = this.dist;
  }

  shake(amount) {
    if (!this.settings.shake) return;
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  /** Behind-the-player yaw for a facing direction. */
  static behind(yaw) { return yaw + Math.PI; }

  update(dt, player, input) {
    const cam = this.camera;
    // ---- manual look
    const lx = input.lookX, ly = input.lookY;
    if (Math.abs(lx) + Math.abs(ly) > 1e-5) this.idleLook = 0; else this.idleLook += dt;
    this.yaw -= lx;
    this.pitch = clamp(this.pitch - ly, -0.55, 1.3);
    if (input.pressed('camReset')) {
      input.consume('camReset');
      this.yaw = player.yaw + Math.PI;
      this.pitch = 0.3;
    }

    const st = player.state;
    const hs = player.hspeed;
    const speed = player.speed;

    // Trunk runs force a readable framing regardless of auto-cam.
    if (st === 'wallrun' && player.wall.type !== 'flat' && this.idleLook > 0.25) {
      const w = player.wall;
      const ox = Math.cos(w.theta), oz = Math.sin(w.theta);
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
      const k = w.type === 'up' ? 0.25 : 0.75;
      this.yaw = dampAngle(this.yaw, Math.atan2(ox - fx * k, oz - fz * k), 5, dt);
      this.pitch = lerp(this.pitch, w.type === 'up' ? -0.1 : 0.2, dampT(3, dt));
    }
    // ---- auto follow (THPS-style): swing the camera behind the motion.
    if (this.settings.autoCam && this.idleLook > 0.7) {
      let want = null, rate = 0;
      if (st === 'wallrun' && player.wall.type !== 'flat') { /* framed above */ }
      else if (st === 'grind' || st === 'wallrun') { want = player.yaw + Math.PI; rate = 3.2; }
      else if (st === 'swing') { if (hs > 3) { want = Math.atan2(player.vel.x, player.vel.z) + Math.PI; rate = 1.2; } }
      else if (st === 'climb') { want = player.yaw + Math.PI; rate = 1.5; }
      else if (hs > 4) { want = Math.atan2(player.vel.x, player.vel.z) + Math.PI; rate = clamp((hs - 4) * 0.18, 0.4, 2.4); }
      if (want !== null) {
        // Don't fight the player when they move toward the camera.
        const d = Math.abs(wrapAngle(want - this.yaw));
        if (d < 2.6 || st === 'grind') this.yaw = dampAngle(this.yaw, want, rate * smoothstep(0.7, 1.6, this.idleLook) + 0.001, dt);
      }
      // Pitch: settle toward a pleasant angle, look down more when falling far.
      let wantPitch = 0.26 + clamp(-player.vel.y * 0.012, 0, 0.35);
      if (st === 'climb') wantPitch = 0.05;
      if (st === 'swing') wantPitch = 0.22;
      this.pitch = lerp(this.pitch, wantPitch, dampT(0.8, dt) * smoothstep(1.2, 2.5, this.idleLook));
    }

    // ---- target framing
    _t.copy(player.pos).add(player.visOffset);
    let headY = 1.45;
    if (st === 'swing' && player.swing.vine) headY = 1.2;
    if (st === 'ground' && player.sliding) headY = 1.0;
    _t.y += headY;
    // Lead slightly in the direction of motion.
    _t.x += player.vel.x * 0.06;
    _t.z += player.vel.z * 0.06;
    // Smooth: fast horizontally, softer vertically for jumps.
    const kxz = dampT(st === 'grind' ? 22 : 14, dt);
    const ky = dampT(st === 'air' ? 5 : st === 'swing' ? 8 : 10, dt);
    this.smoothTarget.x = lerp(this.smoothTarget.x, _t.x, kxz);
    this.smoothTarget.z = lerp(this.smoothTarget.z, _t.z, kxz);
    this.smoothTarget.y = lerp(this.smoothTarget.y, _t.y, ky);
    // Never let the target lag too far (teleports, high speeds).
    if (this.smoothTarget.distanceTo(_t) > 6) this.smoothTarget.lerp(_t, 0.5);

    // ---- distance & fov from speed
    let wantDist = 5.0 + clamp(speed - 6, 0, 18) * 0.11;
    if (st === 'swing') wantDist += 1.6;
    if (st === 'climb') wantDist -= 0.6;
    if (st === 'wallrun') wantDist += 0.6;
    this.dist = lerp(this.dist, wantDist, dampT(2.5, dt));
    const wantFov = this.settings.fov + clamp(speed - 8, 0, 20) * 0.75;
    this.fov = lerp(this.fov, wantFov, dampT(3, dt));

    // ---- position
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _d.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp); // from target toward camera
    // Collision: cast from target outward.
    let allowed = this.dist;
    const hit = this.world.raycast(this.smoothTarget, _d, this.dist + 0.4, { camera: true });
    if (hit) allowed = Math.max(0.6, hit.t - 0.35);
    // Pull in fast, ease out slowly.
    this.collDist = allowed < this.collDist ? lerp(this.collDist, allowed, dampT(30, dt)) : lerp(this.collDist, allowed, dampT(3, dt));
    _v.copy(this.smoothTarget).addScaledVector(_d, this.collDist);
    // Keep above terrain.
    const th = this.world.terrain.heightAt(_v.x, _v.z) + 0.4;
    if (_v.y < th) _v.y = th;
    const wl = this.world.waterAt(_v.x, _v.z);
    if (wl > -1e8 && _v.y < wl + 0.3) _v.y = wl + 0.3;

    // ---- shake
    this.shakeT += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const sa = this.shakeAmt * this.shakeAmt * 0.35;
    cam.position.copy(_v);
    cam.position.x += Math.sin(this.shakeT * 47) * sa;
    cam.position.y += Math.sin(this.shakeT * 61 + 1) * sa;
    cam.lookAt(this.smoothTarget);
    this.tooClose = this.collDist < 0.9;
    if (cam.fov !== this.fov) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** Cinematic orbit for menus. */
  updateOrbit(dt, center, radius = 46, height = 26) {
    this.orbitT += dt * 0.05;
    const cam = this.camera;
    cam.position.set(center.x + Math.cos(this.orbitT) * radius, center.y + height + Math.sin(this.orbitT * 0.7) * 4, center.z + Math.sin(this.orbitT) * radius);
    cam.lookAt(center.x, center.y + 6, center.z);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }
}
