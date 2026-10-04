// Headless harness: builds the level without visuals and drives the player
// with scripted input.
import { buildLevel } from '../src/world/level.js';
import { Player } from '../src/player/player.js';
import { Events } from '../src/core/events.js';

export class FakeInput {
  constructor() {
    this.time = 0;
    this.moveX = 0; this.moveY = 0;
    this.heldSet = new Set();
    this.last = {};
    this.consumed = {};
  }
  press(a) { this.heldSet.add(a); this.last[a] = this.time; this.consumed[a] = false; }
  release(a) { this.heldSet.delete(a); }
  tap(a) { this.press(a); this._tap = a; }
  held(a) { return this.heldSet.has(a); }
  pressed(a, buf = 0) { return !this.consumed[a] && this.last[a] !== undefined && this.time - this.last[a] <= buf + 1e-6; }
  consume(a) { this.consumed[a] = true; }
}

let LEVEL = null;
export function makeGame() {
  if (!LEVEL) LEVEL = buildLevel({ visual: false });
  const events = new Events();
  const input = new FakeInput();
  const log = [];
  events.on('*', (name, data) => log.push({ name, data, t: input.time }));
  const game = { world: LEVEL.world, rails: LEVEL.rails, vines: LEVEL.vines, events, input };
  const player = new Player(game);
  player.placeAt(LEVEL.spawn.pos, LEVEL.spawn.yaw);
  return { game, player, input, log, level: LEVEL };
}

/** Advance the simulation. camYaw such that moveY=1 means world direction (dx,dz). */
export function run(ctx, seconds, opts = {}) {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  const states = new Set();
  for (let i = 0; i < n; i++) {
    if (opts.each) opts.each(ctx, i * dt);
    ctx.game.vines.update(dt, ctx.input.time, ctx.player.pos);
    ctx.player.update(dt, opts.camYawFn ? opts.camYawFn(ctx) ?? 0 : opts.camYaw ?? camYawFor(opts.dir ?? [0, -1]));
    states.add(ctx.player.state);
    if (ctx.input._tap) { ctx.input.release(ctx.input._tap); ctx.input._tap = null; }
    ctx.input.time += dt;
  }
  return states;
}

/** Camera yaw whose forward vector is (dx, dz). forward = (-sin y, -cos y). */
export function camYawFor([dx, dz]) {
  return Math.atan2(-dx, -dz);
}
