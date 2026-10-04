import * as THREE from 'three';
import { makeGame, run } from './helpers.js';
import { rng } from '../src/core/math.js';
const ACTS=['jump','grab','trick','slide','spinL','spinR'];
const issues = {};
function note(k, s){ (issues[k] ||= []).push(s); }
for (let seed=1; seed<=60; seed++){
  const R = rng(seed);
  const g = makeGame();
  const W = g.game.world;
  const x = R.range(-85,85), z = R.range(-85,85);
  g.player.placeAt(new THREE.Vector3(x, W.terrain.heightAt(x,z)+R.range(1,20), z), 0);
  let camYaw = R.range(-3,3);
  let stateSince=0, last=g.player.state;
  const N = 60*40;
  for (let i=0;i<N;i++){
    const inp=g.input;
    if (i%20===0){ inp.moveX = R.range(-1,1); inp.moveY = R.range(-0.3,1); camYaw += R.range(-0.5,0.5); }
    for (const a of ACTS){ if (R() < 0.03) { if (inp.held(a)) inp.release(a); else inp.press(a);} }
    g.game.vines.update(1/60, inp.time, g.player.pos);
    g.player.update(1/60, camYaw);
    inp.time += 1/60;
    const p=g.player;
    if (!Number.isFinite(p.pos.x)||!Number.isFinite(p.pos.y)||!Number.isFinite(p.pos.z)||!Number.isFinite(p.vel.y)) { note('nan', `seed ${seed} t=${inp.time.toFixed(2)} state=${p.state}`); break; }
    const th = W.terrain.heightAt(p.pos.x,p.pos.z);
    if (p.pos.y < th - 1.0 && p.state!=='swim') note('underground', `seed ${seed} t=${inp.time.toFixed(2)} state=${p.state} y=${p.pos.y.toFixed(2)} th=${th.toFixed(2)}`);
    if (p.state!==last){ last=p.state; stateSince=inp.time; }
    else if (inp.time-stateSince>8 && !['ground','swim','climb','air'].includes(p.state)) { note('stuck', `seed ${seed} state=${p.state} for 8s at ${p.pos.toArray().map(v=>v.toFixed(1))}`); stateSince=inp.time; }
    else if (inp.time-stateSince>12 && p.state==='air') { note('stuckAir', `seed ${seed} air 12s at ${p.pos.toArray().map(v=>v.toFixed(1))} vel=${p.vel.toArray().map(v=>v.toFixed(1))}`); stateSince=inp.time; }
    if (p.state!=='swing' ) { for (const v of g.game.vines.vines) if (v.held) { note('vineHeld', `seed ${seed} state=${p.state} t=${inp.time.toFixed(2)}`); v.held=false; } }
  }
}
for (const k in issues) console.log(k, issues[k].length, '\n  ' + issues[k].slice(0,6).join('\n  '));
console.log('done');
