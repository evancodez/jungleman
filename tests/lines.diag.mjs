// Traversal-line diagnostics for the Grotto: plays out the designed lines
// with scripted input and prints what happened. Run: node tests/lines.diag.mjs
import * as THREE from 'three';
import { makeGame, run, camYawFor } from './helpers.js';
import { HUB, T1, T2, T3, T4, T5 } from '../src/world/level.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const f = (v) => v.toArray().map((x) => x.toFixed(1)).join(',');
const trace = (g) => {
  const out = [];
  let last = '';
  const fn = (c, t) => {
    const p = c.player;
    const key = p.state + (p.state === 'grind' ? ':' + p.grind.mode + ':' + p.grind.rail.name : p.state === 'swing' ? ':' + p.swing.vine.name : '');
    if (key !== last) { out.push(`${t.toFixed(2)}s ${key} @ ${f(p.pos)} v=${p.speed.toFixed(1)}`); last = key; }
  };
  fn.out = out;
  return fn;
};
function report(name, g, lines) {
  console.log(`\n=== ${name}`);
  for (const l of lines) console.log('  ' + l);
  const names = g.log.filter((e) => e.name === 'trick' || e.name === 'gap').map((e) => e.data.name);
  if (names.length) console.log('  tricks: ' + names.join(', '));
}

// 1. Spawn on the Elder deck.
{
  const g = makeGame();
  run(g, 1);
  console.log('spawn state', g.player.state, f(g.player.pos));
}

// 2. Drop onto the East Spoke from just above, then grind it to the Pool Tree deck.
{
  const g = makeGame();
  const rail = g.game.rails.rails.find((r) => r.name === 'East Spoke');
  const p = rail.pointAt(1.5, V());
  g.player.placeAt(V(p.x, p.y + 1.5, p.z), 0);
  const tr = trace(g);
  const dir = rail.tangentAt(1.5, V());
  g.input.moveY = 1;
  run(g, 0.4, { dir: [dir.x, dir.z], each: (c, t) => tr(c, t) });
  g.input.tap('grab');
  run(g, 3.5, { dir: [dir.x, dir.z], each: (c, t) => tr(c, t + 0.4) });
  report('East Spoke drop + grind', g, tr.out || []);
}

// 3. Pool Tree deck -> Falls Vines -> Falls Tree deck. Sweep release timings.
{
  const results = [];
  for (const r1 of [0.5, 0.7, 0.9, 1.1, 1.3]) for (const r2 of [0.5, 0.8, 1.1, 1.4]) {
    const g = makeGame();
    g.player.placeAt(V(13, T2.deck + 0.05, -16.4), -Math.PI / 2);
    run(g, 0.2);
    const tr = trace(g);
    g.input.moveY = 1;
    let jumped = false, phase = 0, tSwing = 0;
    run(g, 6, { dir: [-1, 0.05], each: (c, t) => {
      tr(c, t);
      const p = c.player;
      if (!jumped && p.pos.x < 10.3) { c.input.tap('jump'); jumped = true; }
      if (p.state === 'swing') {
        tSwing += 1 / 60;
        if (phase === 0 && tSwing > r1) { c.input.tap('jump'); phase = 1; tSwing = 0; }
        else if (phase === 1 && p.swing.vine.anchor.x < 0 && tSwing > r2) { c.input.tap('jump'); phase = 2; }
      }
    } });
    const vines = new Set(g.log.filter((e) => e.name === 'swingGrab').map((e) => e.data.vine.anchor.x.toFixed(0)));
    results.push(`r1=${r1} r2=${r2}: vines[${[...vines]}] end ${g.player.state} @ ${f(g.player.pos)}`);
    if (r1 === 0.9 && r2 === 0.8) report('Falls swing sample', g, tr.out);
  }
  console.log('\n=== Falls swing sweep');
  for (const r of results) console.log('  ' + r);
}

// 4. Mud chute from the shelf -> kicker -> Spoke Vine -> Elder deck.
import { MUDSLIDE } from '../src/world/terrain.js';
{
  const out = [];
  for (const rel of [0.4, 0.6, 0.8, 1.0]) {
    const g = makeGame();
    const [x, z] = MUDSLIDE[0];
    g.player.placeAt(V(x, g.game.world.terrain.heightAt(x, z) + 0.3, z + 1), 0);
    run(g, 0.3);
    const tr = trace(g);
    g.input.moveY = 1;
    let slid = false, sw = 0, released = false;
    // Steer along the chute centerline.
    const camYawFn = (c) => {
      const p = c.player.pos;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < MUDSLIDE.length; i++) { const d = Math.hypot(MUDSLIDE[i][0] - p.x, MUDSLIDE[i][1] - p.z); if (d < bd) { bd = d; bi = i; } }
      const n = MUDSLIDE.length;
      const ext = [MUDSLIDE[n - 1][0] * 2 - MUDSLIDE[n - 2][0], MUDSLIDE[n - 1][1] * 2 - MUDSLIDE[n - 2][1]];
      const tgt = bi + 1 >= n - 1 ? ext : MUDSLIDE[bi + 1];
      if (c.player.state === 'swing' || c.player.state === 'air' && sw > 0) return camYawFor([-0.3, -1]);
      return camYawFor([tgt[0] - p.x, tgt[1] - p.z]);
    };
    run(g, 7, { camYawFn, each: (c, t) => {
      tr(c, t);
      const p = c.player;
      if (!slid && p.hspeed > 6) { c.input.press('slide'); slid = true; }
      if (p.state === 'air' && sw === 0) c.input.moveY = 0;
      if (p.state === 'swing') c.input.moveY = 1;
      if (p.state === 'swing') { sw += 1 / 60; if (sw > rel && !released) { c.input.tap('jump'); released = true; } }
    } });
    if (rel === 0.6) report('Mud chute -> kicker -> vine', g, tr.out);
    out.push(`release ${rel}: end ${g.player.state} @ ${f(g.player.pos)}`);
  }
  console.log('  ' + out.join('\n  '));
}

// 5. Ruin roof -> Ruin Vine -> Glade Tree deck.
{
  const out = [];
  for (const rel of [0.4, 0.7, 1.0]) {
    const g = makeGame();
    g.player.placeAt(V(-9.5, 6.65, 26.5), Math.PI / 2);
    run(g, 0.2);
    const tr = trace(g);
    g.input.moveY = 1;
    let jumped = false, sw = 0, rl = false;
    run(g, 4, { dir: [1, -0.15], each: (c, t) => {
      tr(c, t);
      const p = c.player;
      if (!jumped && p.pos.x > -4.6) { c.input.tap('jump'); jumped = true; }
      if (p.state === 'swing') { sw += 1 / 60; if (sw > rel && !rl) { c.input.tap('jump'); rl = true; } }
    } });
    if (rel === 0.7) report('Ruin swing', g, tr.out);
    out.push(`release ${rel}: end ${g.player.state} @ ${f(g.player.pos)}`);
  }
  console.log('  ' + out.join('\n  '));
}

// 6. Glade deck -> rope bridge -> East deck (just running).
{
  const g = makeGame();
  g.player.placeAt(V(7.2, T4.deck + 0.05, 21.7), 0);
  run(g, 0.2);
  const tr = trace(g);
  g.input.moveY = 1;
  run(g, 3, { dir: [T3.x - T4.x, T3.z - T4.z], each: (c, t) => tr(c, t) });
  report('Rope bridge run', g, tr.out);
}

// 7. Mushroom near the hub -> Elder deck.
{
  const g = makeGame();
  g.player.placeAt(V(-12, 0.3, 9.5), 0);
  run(g, 0.3);
  const tr = trace(g);
  g.input.moveY = 1;
  let j = false;
  run(g, 3, { dir: [4.2, -2.2], each: (c, t) => { tr(c, t); if (!j && c.player.pos.x > -10.6) { c.input.tap('jump'); j = true; } } });
  report('Hub mushroom', g, tr.out);
}

// 8. East Tree deck: run into the trunk -> North Reach.
{
  const g = makeGame();
  g.player.placeAt(V(T3.x - 1, T3.deck + 0.05, T3.z + 4), 0);
  run(g, 0.2);
  const tr = trace(g);
  g.input.moveY = 1;
  run(g, 2.5, { dir: [0.25, -1], each: (c, t) => tr(c, t) });
  report('East trunk -> North Reach', g, tr.out);
}

// 9. Ramp log from the floor to the Elder deck.
{
  const g = makeGame();
  const rail = g.game.rails.rails.find((r) => r.name === 'Ramp Log');
  const foot = rail.pts[0];
  g.player.placeAt(V(foot.x + 3, g.game.world.terrain.heightAt(foot.x + 3, foot.z + 2) + 0.1, foot.z + 2), 0);
  run(g, 0.2);
  const tr = trace(g);
  g.input.moveY = 1;
  let j = false;
  run(g, 3, { dir: [rail.pts.at(-1).x - foot.x, rail.pts.at(-1).z - foot.z], each: (c, t) => { tr(c, t); if (!j && c.player.pos.distanceTo(foot) < 2.2) { c.input.tap('jump'); j = true; } } });
  report('Ramp log', g, tr.out);
}

// 10. Shelf zip from the crown deck.
{
  const g = makeGame();
  const rail = g.game.rails.rails.find((r) => r.name === 'Shelf Zip');
  const a = rail.pts[0];
  g.player.placeAt(V(a.x - 0.8, 17.05, a.z + 0.8), 0);
  run(g, 0.2);
  const tr = trace(g);
  g.input.moveY = 1;
  const d = rail.tangentAt(1, V());
  run(g, 0.25, { dir: [d.x, d.z], each: (c, t) => tr(c, t) });
  g.input.tap('jump');
  g.input.press('grab');
  run(g, 4, { dir: [d.x, d.z], each: (c, t) => tr(c, t + 0.25) });
  report('Shelf zip', g, tr.out);
}

// 11. Falls Tree deck -> West Run -> Ruin Tree.
{
  const g = makeGame();
  const rail = g.game.rails.rails.find((r) => r.name === 'West Run');
  const p = rail.pointAt(2.5, V());
  g.player.placeAt(V(p.x, p.y + 1.2, p.z), Math.PI);
  run(g, 0.1);
  const tr = trace(g);
  g.input.moveY = 1;
  run(g, 3.5, { dir: [-0.2, 1], each: (c, t) => tr(c, t) });
  report('West Run', g, tr.out);
}
