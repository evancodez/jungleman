import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeGame, run } from './helpers.js';

test('player stands on spawn deck', () => {
  const g = makeGame();
  run(g, 1.5);
  assert.equal(g.player.state, 'ground');
  assert.ok(Math.abs(g.player.pos.y - g.level.spawn.pos.y) < 0.15, `y=${g.player.pos.y}`);
});

test('running accelerates to run speed and jump leaves ground', () => {
  const g = makeGame();
  g.player.placeAt(new THREE.Vector3(-28, g.game.world.terrain.heightAt(-28, -4) + 0.1, -4), Math.PI / 2);
  run(g, 0.5);
  g.input.moveY = 1;
  run(g, 0.45, { dir: [1, 0] }); // run east across open floor
  assert.ok(g.player.hspeed > 8, `speed ${g.player.hspeed}`);
  g.input.tap('jump');
  run(g, 0.1, { dir: [1, 0] });
  assert.equal(g.player.state, 'air');
});

test('falls off the deck and lands on the ground', () => {
  const g = makeGame();
  g.player.placeAt(new THREE.Vector3(0, 8.1, 7.8), 0);
  g.input.moveY = 1;
  const states = run(g, 4, { dir: [0, 1] });
  g.input.moveY = 0;
  run(g, 1);
  assert.ok(states.has('air'));
  assert.ok(['ground', 'swim'].includes(g.player.state), g.player.state);
  assert.ok(g.player.pos.y < 6);
});

test('grab onto a branch rail and grind it', () => {
  const g = makeGame();
  // Above the South Arm branch, falling.
  const rail = g.game.rails.rails.find((r) => r.name === 'West Spoke');
  const p = rail.pointAt(rail.length * 0.3, new THREE.Vector3());
  g.player.placeAt(p.clone().add(new THREE.Vector3(0.3, 1.4, 0)), 0);
  g.player.vel.set(0, -2, 6);
  g.input.press('grab');
  let grinded = false;
  run(g, 0.5, { each: (c) => { if (c.player.state === 'grind') grinded = true; } });
  g.input.release('grab');
  assert.ok(grinded, 'never entered grind');
  const ends = g.log.filter((e) => e.name === 'grindStart');
  assert.ok(ends.length >= 1);
});

test('grab a vine, swing, and release with a jump', () => {
  const g = makeGame();
  const v = g.game.vines.vines[0];
  run(g, 0.1);
  g.player.placeAt(v.anchor.clone().add(new THREE.Vector3(-1.5, -9, 0.5)), Math.PI / 2);
  g.player.vel.set(8, 2, 0);
  g.input.press('grab');
  run(g, 0.2);
  g.input.release('grab');
  assert.equal(g.player.state, 'swing');
  run(g, 1.0);
  g.input.tap('jump');
  run(g, 0.1);
  assert.equal(g.player.state, 'air');
  assert.ok(g.log.some((e) => e.name === 'swingRelease'));
});

test('jumping into a trunk runs up it, then clings', () => {
  const g = makeGame();
  const col = g.game.world.colliders.find((c) => c.name === 'Elder Tree');
  // Place player south-east of trunk on ground level and run at it.
  const start = new THREE.Vector3(col.x + 0, 0, col.z + col.r + 7);
  start.y = g.game.world.terrain.heightAt(start.x, start.z) + 0.5;
  g.player.placeAt(start, Math.PI);
  run(g, 0.5);
  g.input.moveY = 1;
  let ran = false, climbed = false;
  run(g, 0.6, { dir: [0, -1] });
  g.input.tap('jump');
  run(g, 1.5, { dir: [0, -1], each: (c) => { if (c.player.state === 'wallrun') ran = true; if (c.player.state === 'climb') climbed = true; } });
  assert.ok(ran || climbed, 'no trunk interaction: ' + g.player.state);
});
