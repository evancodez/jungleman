import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeGame, run } from './helpers.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ground = (g, x, z) => g.game.world.terrain.heightAt(x, z);
const states = (g) => new Set(g.log.filter((e) => e.name === 'state').map((e) => e.data.to));
const events = (g) => new Set(g.log.map((e) => e.name));

test('wall run along the broken temple wall and kick off', () => {
  const g = makeGame();
  // Wall segment x 20..31 at z=20 (thickness 1.4). Approach diagonally from the south side.
  g.player.placeAt(V(21, ground(g, 21, 22.4) + 1.0, 22.4), Math.PI / 2);
  run(g, 0.05);
  g.player.setState('air');
  g.player.vel.set(11, 6, -4.5);
  g.player.setState('air');
  g.input.moveY = 1;
  let ran = false;
  run(g, 0.6, { dir: [1, -0.3], each: (c) => { if (c.player.state === 'wallrun') ran = true; } });
  assert.ok(ran, 'did not wall run; state=' + g.player.state);
  g.input.tap('jump');
  run(g, 0.3, { dir: [1, -0.3] });
  assert.ok(events(g).has('wallKick'));
});

test('landing mid-flip bails, then recovers', () => {
  const g = makeGame();
  g.player.placeAt(V(-10, ground(g, -10, 20) + 1.2, 20), 0);
  g.player.setState('air');
  g.player.vel.set(0, 1, 0);
  g.player.startFlip('back');
  g.player.flip.angle = 1.5;
  run(g, 0.6);
  assert.ok(events(g).has('bail'), 'expected bail');
  run(g, 1.6);
  assert.equal(g.player.state, 'ground');
});

test('falling into the river swims, then hops out at the bank', () => {
  const g = makeGame();
  g.player.placeAt(V(-3, 4, 0), 0);
  run(g, 1.5);
  assert.equal(g.player.state, 'swim');
  g.input.moveX = -1; // swim west to the bank
  let out = false;
  run(g, 6, { dir: [0, -1], each: (c, t) => { if (Math.floor(t * 4) % 2 === 0) c.input.tap('jump'); if (c.player.state === 'ground') out = true; } });
  assert.ok(out, 'never got out of the water: ' + g.player.state + ' ' + g.player.pos.toArray());
});

test('mushroom bounces and super-bounces', () => {
  const g = makeGame();
  const cap = g.game.world.colliders.find((c) => c.bounce > 0);
  g.player.placeAt(V(cap.x, cap.y1 + 3, cap.z), 0);
  run(g, 0.6);
  const b = g.log.filter((e) => e.name === 'bounce');
  assert.ok(b.length >= 1, 'no bounce');
  assert.ok(g.player.vel.y > 5 || g.player.state === 'air');
  g.input.press('jump');
  run(g, 2.5);
  assert.ok(g.log.some((e) => e.name === 'bounce' && e.data.super), 'no super bounce');
});

test('jumping at the temple base mantles onto tier 1', () => {
  const g = makeGame();
  // Tier 1 spans x 31..61, top y=4. Approach its west face from x=27 at z=-20.
  g.player.placeAt(V(28.5, ground(g, 28.5, -20) + 0.1, -20), Math.PI / 2);
  run(g, 0.3);
  g.input.moveY = 1;
  run(g, 0.25, { dir: [1, 0] });
  g.input.press('jump');
  run(g, 1.2, { dir: [1, 0] });
  assert.ok(events(g).has('mantle'), 'no mantle');
  assert.ok(g.player.pos.y > 3.5, 'y=' + g.player.pos.y);
});

test('slide into a long jump, spin and pose register as tricks', () => {
  const g = makeGame();
  // Flat open ground near the village.
  g.player.placeAt(V(40, ground(g, 40, 34) + 0.1, 34), 0);
  run(g, 0.3);
  g.input.moveY = 1;
  run(g, 1.0, { dir: [1, 0] });
  g.input.press('slide');
  run(g, 0.3, { dir: [1, 0] });
  assert.ok(g.player.sliding, 'not sliding');
  g.input.press('jump');
  run(g, 0.05, { dir: [1, 0] });
  g.input.release('slide');
  g.input.tap('spinL');
  run(g, 0.3, { dir: [1, 0] });
  g.input.release('jump');
  run(g, 0.9, { dir: [1, 0] });
  // Second jump with a held pose.
  g.input.press('jump');
  run(g, 0.15, { dir: [1, 0] });
  g.input.press('slide');
  run(g, 1.0, { dir: [1, 0] });
  g.input.release('slide');
  const names = g.log.filter((e) => e.name === 'trick' || e.name === 'jump').map((e) => e.data.name);
  assert.ok(names.includes('Long Jump'), names.join(','));
  assert.ok(names.some((n) => /Spin/.test(n)), names.join(','));
  assert.ok(names.some((n) => ['Cannonball', 'Superman', 'Starfish', 'Jungle Call', 'Chest Pound'].includes(n)), names.join(','));
});

test('respawn returns to spawn and taunt plays', () => {
  const g = makeGame();
  run(g, 0.5);
  g.input.tap('taunt');
  run(g, 0.2);
  assert.ok(events(g).has('taunt'));
  g.player.pos.set(30, 2, 30);
  g.input.tap('respawn');
  run(g, 0.1);
  assert.ok(events(g).has('respawn'));
  assert.ok(g.player.pos.distanceTo(g.level.spawn.pos) < 1);
});

test('no NaNs over a long random input session', () => {
  const g = makeGame();
  const acts = ['jump', 'grab', 'trick', 'slide', 'spinL', 'spinR'];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  run(g, 60, { each: (c, t) => {
    if (Math.floor(t * 60) % 20 === 0) { c.input.moveX = r() * 2 - 1; c.input.moveY = r() * 2 - 1; }
    if (r() < 0.04) c.input.tap(acts[Math.floor(r() * acts.length)]);
    if (r() < 0.01) c.input.press('grab'); if (r() < 0.02) c.input.release('grab');
  }, camYawFn: (c) => c.input.time * 0.3 });
  const p = g.player.pos;
  assert.ok(Number.isFinite(p.x + p.y + p.z), 'NaN position');
  console.log('random session states:', [...states(g)].join(','));
});

test('running up the temple stairs stays grounded and reaches the top tier', () => {
  const g = makeGame();
  g.player.placeAt(V(22, ground(g, 22, -8) + 0.1, -8), Math.PI / 2);
  run(g, 0.3);
  g.input.moveY = 1;
  let airFrames = 0, frames = 0;
  run(g, 3.0, { dir: [1, 0], each: (c) => { frames++; if (c.player.state === 'air' && c.player.pos.x > 27 && c.player.pos.x < 38) airFrames++; } });
  assert.ok(g.player.pos.y > 11.5, 'y=' + g.player.pos.y.toFixed(2) + ' x=' + g.player.pos.x.toFixed(1));
  assert.ok(airFrames < 6, 'bounced into the air ' + airFrames + ' frames on the stairs');
});

test('jumping at a big trunk at an angle spirals around it', () => {
  const g = makeGame();
  const col = g.game.world.colliders.find((c) => c.name === 'Great Tree');
  // Start south of the trunk, offset east, running west (tangent), steering slightly toward it.
  const start = V(col.x + 8, 0, col.z + col.r + 1.2);
  start.y = ground(g, start.x, start.z) + 4.5;
  g.player.placeAt(start, -Math.PI / 2);
  g.player.setState('air');
  g.player.vel.set(-12, 3, -1.5);
  g.input.moveY = 1;
  let spiral = false;
  run(g, 1.0, { dir: [-1, -0.35], each: (c) => { if (c.player.state === 'wallrun' && c.player.wall.type === 'spiral') spiral = true; } });
  assert.ok(spiral, 'no spiral; state=' + g.player.state);
});

test('brushing past a thin tree does not grab it', () => {
  const g = makeGame();
  const col = g.game.world.colliders.find((c) => c.type === 'cyl' && c.climbable && c.r < 1.4 && c.r > 0.6 && Math.abs(c.x) < 80 && Math.abs(c.z) < 80);
  // Pass with the capsule just clipping the trunk's side (a glancing contact).
  const start = V(col.x - 6, 0, col.z + (col.r + 0.36) * 0.9);
  start.y = ground(g, start.x, start.z) + 0.1;
  g.player.placeAt(start, Math.PI / 2);
  run(g, 0.2);
  g.player.setState('air');
  g.player.vel.set(10, 5, 0);
  g.input.moveY = 1;
  let grabbed = false;
  run(g, 1.0, { dir: [1, 0], each: (c) => { if (['wallrun', 'climb'].includes(c.player.state)) grabbed = true; } });
  assert.ok(!grabbed, 'grabbed the tree while just passing by');
});

test('climb leaps bound up the trunk faster than climbing', () => {
  const g = makeGame();
  const col = g.game.world.colliders.find((c) => c.name === 'Great Tree');
  g.player.placeAt(V(col.x + 1, 3, col.z + col.r + 0.4), Math.PI, false);
  g.player.startClimb(col);
  g.input.moveY = 1;
  const y0 = g.player.pos.y;
  run(g, 2.0, { each: (c, t) => { if (c.player.state === 'climb' && Math.floor(t * 10) % 3 === 0) c.input.tap('jump'); } });
  const gained = g.player.pos.y - y0;
  assert.ok(g.log.some((e) => e.name === 'climbLeap'), 'no leap');
  assert.ok(gained > 2.0 * 3.4 * 1.15, 'gained only ' + gained.toFixed(1));
});
