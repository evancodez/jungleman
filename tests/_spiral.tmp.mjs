import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const g = makeGame();
const W=g.game.world;
const col = W.colliders.find((c) => c.name === 'Great Tree');
// find an angle around the trunk where ground near the trunk is free of roots
for (const a of [0.3, 1.0, 1.6, 2.2, 2.8, 3.5, 4.2, 5.0, 5.7]) {
  const g = makeGame();
  const R = col.r + 0.36 + 0.03;
  const x = col.x + Math.cos(a)*R, z = col.z + Math.sin(a)*R;
  g.player.placeAt(V(x, W.terrain.heightAt(x,z)+0.6, z), 0);
  g.player.startSpiral(col, 1, 12, -2);
  run(g, 1.5);
  const seq = g.log.filter(e=>['trick','land','state'].includes(e.name)).map(e=>e.name==='state'?`[${e.data.from}->${e.data.to}]`:e.name==='trick'?`trick:${e.data.name}`:e.name);
  console.log('angle', a, seq.join(' '));
}
