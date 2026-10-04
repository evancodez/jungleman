// Diagnostic runs of key traversal lines (prints outcomes; not a strict test).
import * as THREE from 'three';
import { makeGame, run, camYawFor } from './helpers.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const summary = (g, label) => {
  const ev = g.log.map((e) => e.name).filter((n) => !['footstep', 'state'].includes(n));
  const tricks = g.log.filter((e) => e.name === 'trick').map((e) => e.data.name);
  console.log(`\n== ${label}: state=${g.player.state} pos=(${g.player.pos.x.toFixed(1)}, ${g.player.pos.y.toFixed(1)}, ${g.player.pos.z.toFixed(1)}) speed=${g.player.speed.toFixed(1)}`);
  console.log('   events:', [...new Set(ev)].join(', '));
  if (tricks.length) console.log('   tricks:', tricks.join(' + '));
};
function rail(g, name) { return g.game.rails.rails.find((r) => r.name === name); }
function startOnRail(g, name, s = 0.5, speed = 8, dir = 1) {
  const r = rail(g, name);
  g.player.startGrind(r, s);
  g.player.grind.dir = dir; g.player.grind.speed = speed;
  return r;
}
function trackStates(g, seconds, opts = {}) {
  const seq = [];
  run(g, seconds, { ...opts, each: (c, t) => { const s = c.player.state; if (seq[seq.length - 1]?.s !== s) seq.push({ s, t: +t.toFixed(2), y: +c.player.pos.y.toFixed(1) }); if (opts.each) opts.each(c, t); } });
  console.log('   states:', seq.map((x) => `${x.s}@${x.t}(y${x.y})`).join(' → '));
  return seq;
}

// A: Spiral slide.
{
  const g = makeGame();
  const r = rail(g, 'Spiral Slide');
  console.log('Spiral length', r.length.toFixed(1), 'from', r.pts[0].toArray().map((v) => v.toFixed(1)), 'to', r.pts[r.pts.length - 1].toArray().map((v) => v.toFixed(1)));
  startOnRail(g, 'Spiral Slide', 0.3, 6);
  trackStates(g, 8);
  summary(g, 'Spiral slide');
}
// B: East Reach -> jump -> vine.
{
  const g = makeGame();
  const r = startOnRail(g, 'East Reach', 0.5, 9);
  let jumped = false;
  trackStates(g, 5, { dir: [1, 0], each: (c) => {
    if (!jumped && c.player.state === 'grind' && c.player.grind.s > r.length - 1.5) { c.input.tap('jump'); jumped = true; }
    if (jumped && c.player.state === 'air') { c.input.press('grab'); c.input.moveY = 1; }
  } });
  summary(g, 'East Reach -> vine');
}
// C: South Arm -> mushrooms.
{
  const g = makeGame();
  const r = startOnRail(g, 'South Arm', 0.5, 9);
  let jumped = false;
  trackStates(g, 6, { dir: [0, 1], each: (c) => {
    if (!jumped && c.player.state === 'grind' && c.player.grind.s > r.length - 1.0) { c.input.tap('jump'); jumped = true; c.input.moveY = 1; }
  } });
  summary(g, 'South Arm -> mushrooms');
}
// D: Zip lines.
for (const name of ['Temple Zip', 'Hill Zip', 'Garden Zip', 'Village Zip']) {
  const g = makeGame();
  const r = rail(g, name);
  g.player.startGrind(r, 0.5);
  trackStates(g, 12);
  summary(g, name + ` (len ${r.length.toFixed(0)}m)`);
}
// E: Mud slide.
{
  const g = makeGame();
  const top = V(-70, 0, -44);
  top.y = g.game.world.terrain.heightAt(top.x, top.z) + 0.3;
  g.player.placeAt(top, Math.PI);
  run(g, 0.3);
  g.input.moveY = 1;
  run(g, 0.6, { dir: [0, 1] });
  g.input.press('slide'); g.input.last.slide = g.input.time;
  const path = [[-71, -34], [-68, -22], [-62, -10], [-57, 2], [-54, 13], [-51, 22], [-48, 28], [-40, 36]];
  let k = 0;
  trackStates(g, 9, { each: (c) => {
    const p = c.player.pos;
    while (k < path.length - 1 && Math.hypot(p.x - path[k][0], p.z - path[k][1]) < 6) k++;
    const dx = path[k][0] - p.x, dz = path[k][1] - p.z, l = Math.hypot(dx, dz);
    c.player.camYawOverride = Math.atan2(-dx / l, -dz / l);
  }, camYawFn: (c) => c.player.camYawOverride });
  summary(g, 'Mud slide');
}
// F: Temple branch.
{
  const g = makeGame();
  startOnRail(g, 'Temple Branch', 0.5, 8);
  trackStates(g, 6);
  summary(g, 'Temple Branch');
}
// G: Climb Great Tree north side to the Cliff Branch.
{
  const g = makeGame();
  const col = g.game.world.colliders.find((c) => c.name === 'Great Tree');
  const p = V(col.x + 0.8, 26, col.z - col.r - 0.4);
  g.player.placeAt(p, Math.PI);
  g.player.startClimb(col);
  g.input.moveY = 1;
  trackStates(g, 5);
  summary(g, 'Climb to Cliff Branch');
}
// H: Shrine branch from East Tree deck.
{
  const g = makeGame();
  startOnRail(g, 'Shrine Branch', 0.5, 7);
  trackStates(g, 6);
  summary(g, 'Shrine Branch');
}
// I: Log ride.
{
  const g = makeGame();
  startOnRail(g, 'Log Ride', 0.5, 8);
  trackStates(g, 6);
  summary(g, 'Log ride');
}
