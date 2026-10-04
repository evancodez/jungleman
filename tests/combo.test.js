import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
import { ComboSystem } from '../src/game/tricks.js';

function withCombo() {
  const g = makeGame();
  const game = g.game;
  game.settings = { scoring: 'full' };
  game.save = { gaps: [] };
  game.writeSave = () => {};
  game.level = g.level;
  game.player = g.player;
  game.time = 0;
  const combo = new ComboSystem(game);
  const step = (sec, opts = {}) => run(g, sec, { ...opts, each: (c, t) => { game.time = c.input.time; combo.update(1 / 60); if (opts.each) opts.each(c, t); } });
  return { ...g, combo, step };
}

test('flip in the air builds a combo that banks after landing', () => {
  const g = withCombo();
  const banks = [];
  g.game.events.on('comboBank', (e) => banks.push(e));
  g.step(0.5);
  g.input.press('jump');
  g.step(0.1);
  g.input.tap('trick');
  g.step(0.7);
  g.input.release('jump');
  g.step(2.5);
  assert.equal(banks.length, 1, 'combo did not bank');
  assert.ok(banks[0].score >= 400, 'score ' + banks[0].score);
});

test('bailing loses the combo', () => {
  const g = withCombo();
  const lost = [];
  g.game.events.on('comboLost', (e) => lost.push(e));
  g.combo.add('Test Trick', 500, {});
  g.player.placeAt(new THREE.Vector3(-10, g.game.world.terrain.heightAt(-10, 20) + 1.2, 20), 0);
  g.player.setState('air');
  g.player.startFlip('back');
  g.player.flip.angle = 1.5;
  g.step(0.8);
  assert.equal(lost.length, 1);
  assert.equal(g.combo.active, false);
});

test('repeating a trick is worth less each time', () => {
  const g = withCombo();
  g.combo.add('Back Flip', 400, {});
  g.combo.add('Back Flip', 400, {});
  g.combo.add('Back Flip', 400, {});
  const pts = g.combo.list.map((t) => t.pts);
  assert.deepEqual(pts, [400, 300, 200]);
  assert.equal(g.combo.mult, 3);
});

test('gap is detected from launch region to landing region', () => {
  const g = withCombo();
  const gaps = [];
  g.game.events.on('gap', (e) => gaps.push(e));
  const gap = g.level.ctx.gaps.find((x) => x.name === 'Hut Hop');
  const from = gap.from.getCenter(new THREE.Vector3());
  const to = gap.to.getCenter(new THREE.Vector3());
  g.player.launchPos.copy(from);
  g.game.events.emit('land', { pos: to, impact: 5, tag: 'wood' });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'Hut Hop');
});
