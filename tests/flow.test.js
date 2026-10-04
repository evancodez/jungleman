// The new flow mechanics (branch running, vine catching, trunk -> branch) and
// the Grotto's designed lines, played out end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeGame, run, camYawFor } from './helpers.js';
import { T1, T2 } from '../src/world/level.js';
import { MUDSLIDE } from '../src/world/terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const railNamed = (g, n) => g.game.rails.rails.find((r) => r.name === n);

test('landing on a branch perches you; the stick runs along it and grab grinds', () => {
  const g = makeGame();
  const rail = railNamed(g, 'West Run');
  const p = rail.pointAt(6, V());
  g.player.placeAt(V(p.x + 0.3, p.y + 1.5, p.z), 0);
  run(g, 0.5);
  assert.equal(g.player.state, 'grind');
  assert.equal(g.player.grind.mode, 'run');
  const t = rail.tangentAt(6, V());
  const s0 = g.player.grind.s;
  g.input.moveY = 1;
  run(g, 0.5, { dir: [t.x, t.z] });
  assert.ok(g.player.grind.s > s0 + 2, 'did not run along the branch');
  assert.ok(g.player.grind.speed > 6, 'speed ' + g.player.grind.speed);
  g.input.tap('grab');
  run(g, 0.1, { dir: [t.x, t.z] });
  assert.equal(g.player.grind.mode, 'grind');
  assert.ok(g.log.some((e) => e.name === 'perch'));
});

test('holding the stick across a branch steps off it', () => {
  const g = makeGame();
  const rail = railNamed(g, 'West Run');
  const p = rail.pointAt(8, V());
  g.player.placeAt(V(p.x, p.y + 1.2, p.z), 0);
  run(g, 0.4);
  assert.equal(g.player.state, 'grind');
  const t = rail.tangentAt(8, V());
  g.input.moveY = 1;
  run(g, 0.5, { dir: [-t.z, t.x] });
  assert.notEqual(g.player.state, 'grind');
});

test('touching a vine in the air catches it without pressing grab', () => {
  const g = makeGame();
  const v = g.game.vines.vines.find((x) => x.name === 'Falls Vine');
  run(g, 0.05);
  g.player.placeAt(v.anchor.clone().add(V(3, -8.6, 0)), -Math.PI / 2);
  g.player.setState('air');
  g.player.vel.set(-9, 3, 0);
  run(g, 0.5);
  assert.equal(g.player.state, 'swing');
});

test('East Spoke grind lands on the Pool Tree deck with speed', () => {
  const g = makeGame();
  const rail = railNamed(g, 'East Spoke');
  const p = rail.pointAt(1.5, V());
  g.player.placeAt(V(p.x, p.y + 1.5, p.z), 0);
  run(g, 0.4);
  g.input.press('grab');
  run(g, 0.1);
  g.input.release('grab');
  let landSpeed = 0;
  run(g, 2, { each: (c) => { if (c.player.state === 'ground' && !landSpeed) landSpeed = c.player.hspeed; } });
  assert.ok(landSpeed > 10, 'landed at ' + landSpeed.toFixed(1));
  assert.ok(Math.abs(g.player.pos.y - T2.deck) < 1, 'y ' + g.player.pos.y.toFixed(2));
});

test('running into a trunk runs up it and pulls you onto the branch above', () => {
  const g = makeGame();
  g.player.placeAt(V(T2.x - 2.5, T2.deck + 0.05, T2.z + 3.2), 0);
  run(g, 0.2);
  g.input.moveY = 1;
  let perched = null;
  run(g, 2.5, { dir: [0.75, -1], each: (c) => { if (!perched && c.player.state === 'grind') perched = c.player.grind.rail.name; } });
  assert.equal(perched, 'Shelf Branch');
});

test('running a branch into its trunk grabs the trunk', () => {
  const g = makeGame();
  const rail = railNamed(g, 'West Run');
  const p = rail.pointAt(5, V());
  g.player.placeAt(V(p.x, p.y + 1.0, p.z), Math.PI);
  run(g, 0.4);
  const t = rail.tangentAt(1, V());
  g.input.moveY = 1;
  let climbed = false;
  run(g, 1.5, { dir: [-t.x, -t.z], each: (c) => { if (c.player.state === 'climb' || c.player.state === 'wallrun') climbed = true; } });
  assert.ok(climbed, 'state ' + g.player.state);
});

test('Falls swing: two vines carry you from the Pool Tree to the Falls Tree', () => {
  const g = makeGame();
  g.player.placeAt(V(13, T2.deck + 0.05, -16.4), -Math.PI / 2);
  run(g, 0.2);
  g.input.moveY = 1;
  let jumped = false, phase = 0, tSwing = 0, landedOnDeck = false;
  run(g, 5, { dir: [-1, 0.05], each: (c) => {
    const p = c.player;
    if (!jumped && p.pos.x < 10.3) { c.input.tap('jump'); jumped = true; }
    if (p.state === 'swing') {
      tSwing += 1 / 60;
      // Release like a player would: on the forward upswing.
      const rising = p.vel.x < -4 && p.vel.y > 1.5 && tSwing > 0.3;
      if (phase === 0 && rising) { c.input.tap('jump'); phase = 1; tSwing = 0; }
      else if (phase === 1 && p.swing.vine.anchor.x < 0 && rising) { c.input.tap('jump'); phase = 2; }
    }
    if (phase === 2 && p.state === 'ground' && Math.abs(p.pos.y - T1.deck) < 0.3) landedOnDeck = true;
  } });
  const vines = new Set(g.log.filter((e) => e.name === 'swingGrab').map((e) => e.data.vine.id));
  assert.equal(vines.size, 2, 'caught ' + vines.size + ' vines');
  assert.ok(landedOnDeck, 'did not land on the Falls Tree deck');
});

test('mud chute kicker throws you onto the Kicker Vine', () => {
  const g = makeGame();
  const [x, z] = MUDSLIDE[0];
  g.player.placeAt(V(x, g.game.world.terrain.heightAt(x, z) + 0.3, z + 1), 0);
  run(g, 0.3);
  g.input.moveY = 1;
  let slid = false;
  const n = MUDSLIDE.length;
  const ext = [MUDSLIDE[n - 1][0] * 2 - MUDSLIDE[n - 2][0], MUDSLIDE[n - 1][1] * 2 - MUDSLIDE[n - 2][1]];
  const camYawFn = (c) => {
    const p = c.player.pos;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.hypot(MUDSLIDE[i][0] - p.x, MUDSLIDE[i][1] - p.z); if (d < bd) { bd = d; bi = i; } }
    const tgt = bi + 1 >= n - 1 ? ext : MUDSLIDE[bi + 1];
    return camYawFor([tgt[0] - p.x, tgt[1] - p.z]);
  };
  run(g, 5, { camYawFn, each: (c) => {
    const p = c.player;
    if (!slid && p.hspeed > 6) { c.input.press('slide'); slid = true; }
    if (p.state === 'air') c.input.moveY = 0;
  } });
  assert.ok(g.log.some((e) => e.name === 'swingGrab' && e.data.vine.name === 'Kicker Vine'), 'missed the vine');
});
