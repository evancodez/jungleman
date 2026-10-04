import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const g0 = makeGame(); const T = g0.game.world.terrain; const n = new THREE.Vector3();
// find terrain spots with normal.y in [0.72, 0.84], away from colliders
const spots=[];
for (let x=-80;x<=80 && spots.length<5;x+=1.3) for (let z=-60;z<=80 && spots.length<5;z+=1.7){
  T.normalAt(x,z,n); if (n.y>0.74&&n.y<0.83){ const c=g0.game.world.query(x-3,-50,z-3,x+3,100,z+3,[]); if(c.length===0) spots.push([x,z,n.clone()]); }
}
for (const [x,z,nn] of spots){
  const g = makeGame();
  // run uphill direction = -horizontal normal
  const up = [-nn.x, -nn.z]; const L=Math.hypot(...up); up[0]/=L; up[1]/=L;
  // test downhill slide then release
  const down=[-up[0],-up[1]];
  g.player.placeAt(V(x+up[0]*3, T.heightAt(x+up[0]*3,z+up[1]*3)+0.05, z+up[1]*3), Math.atan2(down[0],down[1]));
  run(g,0.2);
  g.player.vel.set(down[0]*8,0,down[1]*8);
  g.input.moveY=1; g.input.press('slide'); run(g,0.2,{dir:down});
  const s1=g.player.sliding;
  g.input.release('slide'); g.input.moveY=0;
  run(g,0.5,{dir:down});
  console.log(`slope ny=${nn.y.toFixed(2)} (${(Math.acos(nn.y)*180/Math.PI).toFixed(0)}deg): slidingBefore=${s1} afterRelease0.5s sliding=${g.player.sliding} state=${g.player.state} hs=${g.player.hspeed.toFixed(1)} ny=${g.player.groundNormal.y.toFixed(2)}`);
}
// Uphill: slide up the slope, release, then hold the stick uphill for 2s.
{
  const [x,z,nn] = spots[0];
  const g = makeGame();
  const up = [-nn.x, -nn.z]; const L=Math.hypot(...up); up[0]/=L; up[1]/=L;
  g.player.placeAt(V(x-up[0]*2, T.heightAt(x-up[0]*2,z-up[1]*2)+0.05, z-up[1]*2), Math.atan2(up[0],up[1]));
  run(g,0.2);
  g.player.vel.set(up[0]*9,0,up[1]*9);
  g.input.moveY=1; g.input.press('slide'); run(g,0.15,{dir:up});
  g.input.release('slide');
  run(g,2.0,{dir:up});
  const p=g.player;
  console.log('uphill: after 2s holding stick uphill (slide released): sliding', p.sliding, 'hs', p.hspeed.toFixed(2), 'state', p.state,
    'capsuleFree(standing)=', g.game.world.capsuleFree(p.pos, 0.36, 1.8, 0.05),
    'contacts:', g.game.world.capsuleContacts(p.pos,0.36,1.8,[]).map(c=>`${c.col?c.col.type:'terrain'} ny=${c.ny.toFixed(2)} depth=${c.depth.toFixed(3)}`).join('; '));
}
// Control: gentle slope
{
  const g = makeGame();
  g.player.placeAt(V(40, T.heightAt(40,34)+0.1, 34), 0); run(g,0.3);
  g.input.moveY=1; run(g,1.0,{dir:[1,0]}); g.input.press('slide'); run(g,0.3,{dir:[1,0]}); g.input.release('slide'); run(g,0.1,{dir:[1,0]});
  console.log('control flat ground: sliding after release =', g.player.sliding);
}
