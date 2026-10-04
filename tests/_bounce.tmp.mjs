import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
const W0 = makeGame().game.world;
const cap = W0.colliders.find(c=>c.bounce>0 && Math.abs(c.x+18.6)<0.1);
const trunk = W0.colliders.find(c=>c.type==='cyl'&&c.climbable&&Math.abs(c.x+32)<0.1);
const dx=trunk.x-cap.x, dz=trunk.z-cap.z, L=Math.hypot(dx,dz), ux=dx/L, uz=dz/L;
for (const sp of [3,4,5,6,7]) {
  const g = makeGame();
  const W = g.game.world;
  g.player.placeAt(new THREE.Vector3(cap.x-ux*1.5, cap.y1+0.8, cap.z-uz*1.5), Math.atan2(ux,uz));
  g.player.vel.set(ux*sp, 0, uz*sp);
  g.input.moveY = 1;
  let phase=0; const out=[];
  run(g, 6, { dir:[ux,uz], each:(c)=>{
    const p=c.player;
    if (phase===0 && (p.state==='climb')) { phase=1; c.input.moveY=-1; out.push(`climb at y=${p.pos.y.toFixed(2)} t=${c.input.time.toFixed(2)}`); }
    if (phase===1 && p.state!=='climb') { phase=2; c.input.moveY=0; out.push(`left climb -> ${p.state} at y=${p.pos.y.toFixed(2)} groundCol.bounce=${p.groundCol?.bounce} t=${c.input.time.toFixed(2)}`); }
  }});
  const b = g.log.filter(e=>e.name==='bounce').map(e=>`bounce t=${e.t.toFixed(2)} col=(${e.data.col.x},${e.data.col.z})`);
  console.log('speed',sp, out.join(' | '), '\n   ', b.join(' ; '), '\n    final', g.player.state, g.player.pos.toArray().map(v=>v.toFixed(1)).join(','));
}
