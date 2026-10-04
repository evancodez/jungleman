import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
const g = makeGame();
const rails = g.game.rails.rails;
// For each rail end and direction heading off that end, emulate continueRail and see where it lands.
let issues=0;
for (const rail of rails) for (const end of [0,1]) {
  const p = g.player;
  p.placeAt(rail.pointAt(end? rail.length: 0, new THREE.Vector3()), 0);
  p.setState('grind');
  const gr = p.grind; gr.rail = rail; gr.dir = end?1:-1; gr.s = end? rail.length+0.05 : -0.05; gr.speed = 10; gr.dist = 5;
  const ok = p.continueRail();
  if (!ok) continue;
  const nr = gr.rail; const off = gr.s < 0 || gr.s > nr.length;
  // follow up to 20 transfers emulating stepping 0.01 each time
  let chain=[rail.name+'#'+rail.id, nr.name+'#'+nr.id], n=0;
  while ((gr.s<0||gr.s>gr.rail.length) && n<20) { if(!p.continueRail()) break; chain.push(gr.rail.name+'#'+gr.rail.id); n++; }
  if (off) { issues++; console.log('transfer lands off-end:', chain.join(' -> '), 'final s', gr.s.toFixed(2), 'len', gr.rail.length.toFixed(2), 'loops', n); }
}
console.log('rails', rails.length, 'off-end transfers', issues);
