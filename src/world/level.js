// "The Grotto": one compact jungle bowl built as a chain of lines.
// Coordinates: x east, z south, y up (meters).
//
// Layout (top view):
//                     waterfall + pool (north)
//        Falls Tree (T1)  ~~ vine swing ~~  Pool Tree (T2)     east shelf
//   Ruin Tree (T5)          ELDER TREE (hub)            East Tree (T3)  mud chute
//            ruin shrine                 Glade Tree (T4)
//
// The Elder Tree has a ring deck (spawn), fungus steps up the trunk and a
// crown deck; downhill "spoke" branches run from the crown to the ring trees.
// The ring trees link up through a vine swing over the pool, a long branch,
// a ruin branch + vine and a rope bridge, so you can loop the whole bowl
// without touching the floor. Mushrooms, a leaning log and trunk runs get you
// back up from the ground, and a zip-vine feeds the mud chute whose kicker
// throws you onto a vine that swings you back to the Elder deck.
import * as THREE from 'three';
import { CollisionWorld, Heightfield, BoxCollider, CylinderCollider } from '../physics/world.js';
import { RailSet } from '../physics/rails.js';
import { VineSet } from '../physics/vines.js';
import { rng, clamp, lerp } from '../core/math.js';
import { WORLD, terrainHeight, terrainTag, waterHeight, POOL, FALLS, MUDSLIDE } from './terrain.js';
import {
  createContext, tree, branch, solid, ropeBridge, vine, zipLine, mushroom, boulder, torch,
  pillar, stairs, collectible, gap, lightShaft, addInst, crown, railing, log, ringDeck, fungusStep, hangingVine, V,
} from './builders.js';

const H = (x, z) => terrainHeight(x, z);
const DEG = Math.PI / 180;

/** Point on a trunk surface (or at distance r from its axis) at angle a (deg, from +x toward +z). */
const around = (T, aDeg, r, y) => V(T.x + Math.cos(aDeg * DEG) * r, y, T.z + Math.sin(aDeg * DEG) * r);
/** Point at distance d from tree A toward tree B. */
const toward = (A, B, d, y) => {
  const dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz);
  return V(A.x + dx / l * d, y, A.z + dz / l * d);
};

// Tree positions and deck heights.
export const HUB = { x: 0, z: 3, r: 2.5, rTop: 2.0, deck: 8, crown: 17 };
export const T1 = { x: -15, z: -13, r: 1.8, deck: 10.5, name: 'Falls Tree' };
export const T2 = { x: 14, z: -14, r: 1.8, deck: 11, name: 'Pool Tree' };
export const T3 = { x: 24, z: 6, r: 1.8, deck: 9, name: 'East Tree' };
export const T4 = { x: 5, z: 24, r: 1.8, deck: 9, name: 'Glade Tree' };
export const T5 = { x: -21, z: 13, r: 1.8, deck: 9.5, name: 'Ruin Tree' };
const DECK_R = 4.4;

export function buildLevel({ visual = true } = {}) {
  const world = new CollisionWorld();
  const rails = new RailSet();
  const vines = new VineSet();
  world.terrain = new Heightfield(WORLD.min, WORLD.min, WORLD.size, WORLD.res, terrainHeight, terrainTag);
  world.waterFn = waterHeight;
  const ctx = createContext(world, rails, vines, visual);

  // ------------------------------------------------------------------ bounds
  // Invisible ring behind the cliffs (the cliffs themselves stop you first).
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const R = WORLD.bounds + 6;
    solid(ctx, { c: [Math.cos(a) * R, 30, Math.sin(a) * R], size: [16, 90, 3], rotY: Math.atan2(Math.cos(a), Math.sin(a)), visible: false, tag: 'rock', noCamera: true, noMantle: true });
  }

  // ================================================================== ELDER TREE (hub)
  tree(ctx, { x: HUB.x, z: HUB.z, y0: H(HUB.x, HUB.z) - 1.5, height: 36, r: HUB.r, rTop: HUB.rTop, roots: 6, crownY: 31, crownR: 14, crownTrim: 3, seed: 11, name: 'Elder Tree', buttress: 2.2, nButtress: 6 });
  crown(ctx, V(HUB.x, 26, HUB.z), 9, 12, 0.6);
  ringDeck(ctx, HUB.x, HUB.z, HUB.deck, 2.1, 6.2);
  ringDeck(ctx, HUB.x, HUB.z, HUB.crown, 1.8, 5.0, { rot: 0 });
  // Bracket-fungus steps spiralling up the trunk from the ring deck to the crown deck.
  const steps = [[200, 9.7], [242, 11.15], [284, 12.6], [326, 14.05], [8, 15.5]];
  for (const [a, y] of steps) fungusStep(ctx, HUB.x, HUB.z, 2.25, a * DEG, y, 1.25);
  torch(ctx, around(HUB, 60, 5.6, HUB.deck));
  torch(ctx, around(HUB, 160, 5.6, HUB.deck));
  torch(ctx, around(HUB, 300, 5.6, HUB.deck));
  torch(ctx, around(HUB, 120, 4.5, HUB.crown));

  // Spokes: downhill grinds from the crown deck out to the ring trees.
  const spoke = (T, name, extra = {}) => {
    const a0 = Math.atan2(T.z - HUB.z, T.x - HUB.x) / DEG;
    const start = around(HUB, a0, 2.0, HUB.crown + 0.75);
    const end = toward(T, HUB, DECK_R + 0.3, T.deck + 0.2);
    const mid1 = start.clone().lerp(end, 0.35); mid1.y = lerp(start.y, end.y, 0.25) + 0.3;
    const mid2 = start.clone().lerp(end, 0.7); mid2.y = lerp(start.y, end.y, 0.62);
    return branch(ctx, [start, mid1, mid2, end], { r0: 0.62, r1: 0.42, name, leafRange: [0.45, 0.95], ...extra });
  };
  const eastSpoke = spoke(T2, 'East Spoke');
  spoke(T5, 'West Spoke');
  const southSpoke = spoke(T4, 'South Spoke');
  // Vine hanging off the South Spoke: the mud-chute kicker throws you onto it.
  const sv = southSpoke.curve.getPointAt(0.66);
  vine(ctx, V(sv.x, sv.y - 0.45, sv.z), 7.8, { name: 'Spoke Vine' });

  // Kicker limb: the mud-chute kicker throws you onto the vine at its tip,
  // which swings you back over the ring deck.
  {
    const a = 58;
    branch(ctx, [around(HUB, a, 2.0, 15.6), around(HUB, a, 6.5, 15.9), around(HUB, a, 11.0, 15.2)], { r0: 0.55, r1: 0.32, name: 'Kicker Limb', leafRange: [0.4, 1] });
    vine(ctx, around(HUB, a, 10.6, 14.8), 9.8, { name: 'Kicker Vine' });
  }
  // Leaning log: a walkable ramp from the floor up to the ring deck.
  {
    const top = around(HUB, 30, 5.6, HUB.deck + 0.15);
    const fp = around(HUB, 30, 17, 0);
    const foot = V(fp.x, H(fp.x, fp.z) + 0.55, fp.z);
    log(ctx, foot, top, 0.62, { name: 'Ramp Log', arch: 0.05, taper: 0.8 });
  }

  // Zip-vine from the crown deck to the east shelf (top of the mud chute).
  zipLine(ctx, around(HUB, -8, 4.2, HUB.crown + 2.8), V(31.5, 15.2, -8.6), { name: 'Shelf Zip', sag: 0.8 });
  zipPost(ctx, around(HUB, -8, 4.2, HUB.crown), 2.8);

  // ================================================================== RING TREES
  for (const T of [T1, T2, T3, T4, T5]) {
    tree(ctx, { x: T.x, z: T.z, y0: H(T.x, T.z) - 1.5, height: T.deck + 17, r: T.r, rTop: T.r * 0.8, roots: 4, crownY: T.deck + 14, crownR: 9, seed: Math.floor(T.x * 7 + T.z * 3), name: T.name, buttress: 1.4 });
    ringDeck(ctx, T.x, T.z, T.deck, T.r - 0.2, DECK_R, { rot: (T.x * 0.37) % 1 });
  }
  torch(ctx, around(T1, 20, 3.8, T1.deck));
  torch(ctx, around(T2, 160, 3.8, T2.deck));
  torch(ctx, around(T3, 250, 3.8, T3.deck));
  torch(ctx, around(T4, 300, 3.8, T4.deck));
  torch(ctx, around(T5, 60, 3.8, T5.deck));

  // T2 -> T1: two vines hanging from a high arching limb across the pool.
  {
    const a = around(T2, 182, 1.2, 19.2), b = around(T1, -2, 1.2, 18.8);
    branch(ctx, [a, V(6, 21.4, -16.2), V(-5, 21.3, -15.6), b], { r0: 0.75, r1: 0.6, name: 'Falls Arch', leafRange: [0.1, 0.9], tipLeaves: false });
    vine(ctx, V(5.5, 20.7, -16.1), 8.6, { name: 'Falls Vine' });
    vine(ctx, V(-4.5, 20.6, -15.6), 8.6, { name: 'Falls Vine' });
  }
  // T1 -> T5: a long branch reaching south along the west side.
  {
    const s = around(T1, 95, 1.4, T1.deck + 1.0);
    const e = toward(T5, T1, DECK_R + 0.2, T5.deck + 0.25);
    branch(ctx, [s, V(-16.8, 10.8, -5), V(-19.2, 10.2, 2), e], { r0: 0.6, r1: 0.42, name: 'West Run' });
  }
  // T5 -> ruin: downhill onto the shrine roof.
  const RUIN = { x: -7, z: 27 };
  const roofY = 6.6;
  {
    const s = around(T5, 30, 1.4, T5.deck + 0.9);
    const e = V(RUIN.x - 3.6, roofY + 0.4, RUIN.z - 0.4);
    branch(ctx, [s, V(-15.8, 9.2, 18.8), V(-12.6, 7.9, 22.2), e], { r0: 0.58, r1: 0.38, name: 'Ruin Branch' });
  }
  // Ruin -> T4: a vine hanging off a limb of the Glade Tree.
  {
    const s = around(T4, 182, 1.2, 15.2);
    branch(ctx, [s, V(0.2, 15.6, 24.6), V(-2.8, 15.4, 25.6)], { r0: 0.5, r1: 0.3, name: 'Glade Limb', leafRange: [0.3, 1] });
    vine(ctx, V(-2.2, 15.1, 25.5), 7.6, { name: 'Ruin Vine' });
  }
  // T4 -> T3: rope bridge with grindable hand ropes.
  {
    const a = toward(T4, T3, DECK_R - 0.4, T4.deck), b = toward(T3, T4, DECK_R - 0.4, T3.deck);
    ropeBridge(ctx, a, b, { sag: 1.1, width: 2.0 });
  }
  // T3 -> T2: a high branch reached by running up the East Tree trunk.
  {
    const s = around(T3, -95, 1.3, T3.deck + 4.6);
    const e = toward(T2, T3, DECK_R + 0.2, T2.deck + 0.25);
    branch(ctx, [s, V(22.2, 13.2, -1.8), V(19, 12.2, -7.6), e], { r0: 0.6, r1: 0.42, name: 'North Reach' });
  }
  // T2 -> east shelf: another trunk-run branch.
  {
    const s = around(T2, 20, 1.3, T2.deck + 4.4);
    branch(ctx, [s, V(21, 15.0, -12.2), V(26, 13.9, -11.2), V(31.2, 13.4, -10.6)], { r0: 0.55, r1: 0.38, name: 'Shelf Branch' });
  }
  // Glade hop: a short branch off the Glade Tree toward the hub, over the floor.
  branch(ctx, [around(T4, 230, 1.3, T4.deck + 0.6), V(-1.2, 8.9, 18.2), V(-3.2, 8.3, 15.6)], { r0: 0.5, r1: 0.32, name: 'Glade Hop' });

  // ================================================================== RUIN
  {
    const { x, z } = RUIN;
    solid(ctx, { c: [x, 0.0, z], size: [12, 4, 10], mat: 'stone', tile: 3, wallRun: true, aoBase: -1 });
    solid(ctx, { c: [x, 2.6, z + 0.6], size: [8, 1.2, 7], mat: 'stone', tile: 3, wallRun: true, aoBase: 2 });
    // Stairs up the north face, with grindable balustrades.
    stairs(ctx, { from: [x, H(x, z - 10.5) + 0.1, z - 10.5], to: [x, 3.2, z - 2.9], width: 4.4 });
    // Shrine: four pillars and a walkable roof with grindable edges.
    for (const [px, pz] of [[-2.4, -1.8], [2.4, -1.8], [-2.4, 2.8], [2.4, 2.8]]) {
      solid(ctx, { c: [x + px, 3.2 + (roofY - 3.8) / 2, z + pz], size: [0.9, roofY - 3.8, 0.9], mat: 'stone', tile: 2 });
    }
    solid(ctx, { c: [x, roofY - 0.3, z + 0.5], size: [6.4, 0.6, 6.4], mat: 'stone', tile: 3 });
    const e = 3.1, y = roofY, cz = z + 0.5;
    const c = [V(x - e, y, cz - e), V(x + e, y, cz - e), V(x + e, y, cz + e), V(x - e, y, cz + e)];
    for (let i = 0; i < 4; i++) railing(ctx, c[i], c[(i + 1) % 4], { h: 0.25, kind: 'stone' });
    torch(ctx, V(x - 2.6, H(x - 2.6, z - 9.6), z - 9.6));
    torch(ctx, V(x + 2.6, H(x + 2.6, z - 9.6), z - 9.6));
    // Broken pillars around the ruin to hop between.
    pillar(ctx, { x: x + 8.5, z: z - 4, h: 3.2, s: 1.6, faces: [] });
    pillar(ctx, { x: x + 10.5, z: z + 1, h: 4.4, s: 1.6, faces: [] });
    pillar(ctx, { x: x - 8.5, z: z - 2, h: 2.6, s: 1.7, faces: [3] });
    lightShaft(ctx, V(x, 0, z), 0.9);
  }

  // ================================================================== MUD CHUTE + KICKER
  {
    const top = MUDSLIDE[0];
    solid(ctx, { c: [top[0] - 1.5, H(top[0] - 1.5, top[1] - 1) + 0.2, top[1] - 1], size: [4, 0.4, 3.5], mat: 'planks', tag: 'wood' });
    torch(ctx, V(top[0] + 1.6, H(top[0] + 1.6, top[1] - 2.5), top[1] - 2.5));
    const end = MUDSLIDE[MUDSLIDE.length - 1], prev = MUDSLIDE[MUDSLIDE.length - 2];
    const dx = end[0] - prev[0], dz = end[1] - prev[1], l = Math.hypot(dx, dz);
    const fx = dx / l, fz = dz / l;
    const kx = end[0] + fx * 1.2, kz = end[1] + fz * 1.2;
    const ky = H(kx, kz);
    const yaw = Math.atan2(fx, fz);
    // Ramp: tilted plank slab rising toward the launch direction.
    solid(ctx, { c: [kx, ky + 0.55, kz], size: [3.6, 0.4, 4.2], rotY: yaw, rotX: -0.5, mat: 'planks', tag: 'wood', tile: 2 });
    solid(ctx, { c: [kx + fx * 1.2, ky - 0.4, kz + fz * 1.2], size: [3.2, 1.8, 1.8], rotY: yaw, mat: 'wood', tag: 'wood', tile: 2 });
    gap(ctx, 'Mud Rocket', 750, [[kx - 4, ky - 2, kz - 4], [kx + 4, ky + 5, kz + 4]], [[-8, 2, 6], [8, 20, 20]], { land: 'vine' });
    collectible(ctx, 'letter', V(kx + fx * 4.2, ky + 3.6, kz + fz * 4.2 - 0.6), 'L');
  }

  // ================================================================== MUSHROOMS (ways back up)
  // Each bounce is tuned to reach the nearby deck; hold jump for a super bounce.
  const shroom = (x, z, deckY, r = 1.7) => {
    const top = Math.max(1.0, H(x, z) + 1.1);
    mushroom(ctx, { x, z, y0: H(x, z), top, r, bounce: Math.sqrt(2 * 32 * (deckY + 0.7 - top)) });
  };
  shroom(-7.8, 7.2, HUB.deck);
  shroom(18.8, 1.2, T3.deck);
  shroom(-10.2, -7.0, T1.deck);
  shroom(-14.8, 19.4, T5.deck);

  // ================================================================== FLOOR LINES
  log(ctx, V(5.5, H(5.5, -9) + 0.5, -9), V(12.5, H(12.5, -4.5) + 0.55, -4.5), 0.6, { name: 'Bank Log' });
  log(ctx, V(-25, H(-25, 21) + 0.55, 21), V(-20, H(-20, 29.5) + 0.6, 29.5), 0.65, { name: 'Glade Log' });
  log(ctx, V(-24.5, H(-24.5, -2) + 0.6, -2), V(-27.5, H(-27.5, 7) + 0.6, 7), 0.7, { name: 'Bank Log' });
  log(ctx, V(16.5, H(16.5, 28.5) + 0.5, 28.5), V(25.5, H(25.5, 24.5) + 0.6, 24.5), 0.6, { name: 'Glade Log' });
  // Stepping stones across the pool toward the falls.
  for (const [x, z, s] of [[-6.2, -19.8, 1.3], [-3.0, -22.6, 1.4], [0.6, -25.4, 1.3], [3.8, -28.3, 1.4]]) {
    boulder(ctx, x, -0.55, z, s, { flatTop: true, sy: 0.85 });
  }

  // ================================================================== WATERFALL
  ctx.waterfalls.push({ ...FALLS });
  // Rocks framing the falls.
  boulder(ctx, FALLS.x - 6.5, 0.4, -33.5, 3.2, { sy: 0.9 });
  boulder(ctx, FALLS.x + 6.8, 0.6, -33, 3.4, { sy: 1.0 });
  boulder(ctx, FALLS.x - 3.8, 21.6, -39.6, 2.0);
  boulder(ctx, FALLS.x + 3.6, 21.8, -39.4, 2.2);

  // ================================================================== COLLECTIBLES
  const eastMid = eastSpoke.curve.getPointAt(0.5);
  collectible(ctx, 'letter', eastMid.clone().add(V(0, 1.6, 0)), 'J');
  collectible(ctx, 'letter', V(0.5, 14.6, -15.9), 'U');
  collectible(ctx, 'letter', V(RUIN.x, roofY + 1.6, RUIN.z + 0.5), 'N');
  collectible(ctx, 'letter', toward(T4, T3, 12.5, T4.deck + 2.4), 'G');
  collectible(ctx, 'letter', V(22.2, 14.6, -1.8), 'E');
  collectible(ctx, 'idol', V(HUB.x + 2.2, HUB.crown + 1.3, HUB.z - 3.6), 'Crown Idol');
  collectible(ctx, 'idol', V(FALLS.x + 3.8, 1.4, -28.3), 'Falls Idol');
  collectible(ctx, 'idol', V(31.5, 14.1, -14), 'Shelf Idol');
  collectible(ctx, 'idol', V(-5.5, 22.6, -15.8), 'Arch Idol');
  collectible(ctx, 'idol', V(RUIN.x + 10.5, 5.0, RUIN.z + 1), 'Pillar Idol');

  // ================================================================== GAPS
  gap(ctx, 'Falls Swing', 900, [[7, 9, -20], [20, 18, -8]], [[-20, 9, -18], [-10, 16, -8]]);
  gap(ctx, 'Pool Plunge', 600, [[-14, 12, -24], [14, 30, -8]], [[-12, -6, -34], [10, 0, -14]], { land: 'water' });
  gap(ctx, 'Ruin Swing', 600, [[-12, 5.5, 22], [-2, 10, 32]], [[0, 8, 19], [10, 13, 29]]);
  gap(ctx, 'Canopy Express', 400, [[-6, 16, -3], [6, 22, 9]], [[9, 10, -19], [19, 15, -9]]);
  gap(ctx, 'Shelf Hop', 500, [[10, 10, -19], [19, 18, -9]], [[27, 11, -16], [36, 18, 0]]);
  gap(ctx, 'Fungus Ladder', 300, [[-6, 7.5, -3], [6, 9, 9]], [[-5, 16.5, -2], [5, 19, 8]]);

  // ================================================================== DECOR
  decorate(ctx);

  const spawn = { pos: around(HUB, 90, 4.4, HUB.deck + 0.05), yaw: 0 };
  return { world, rails, vines, ctx, spawn };
}

// -------------------------------------------------------------------- helpers
function zipPost(ctx, base, h) {
  solid(ctx, { c: [base.x, base.y + h / 2, base.z], size: [0.4, h, 0.4], mat: 'wood', tag: 'wood' });
}

/** Scatter foliage, rocks, cliff dressing and background trees. */
function decorate(ctx) {
  const R = rng(777);
  const world = ctx.world;
  const occupied = (x, z, y, rad) => {
    const cs = world.query(x - rad, y - 1, z - rad, x + rad, y + 3, z + rad, []);
    if (cs.some((c) => c.tag !== 'rock' || c.max.y - c.min.y < 50)) return true;
    // Keep the mud chute and pool clear.
    if (x > 8 && terrainTag(x, z) === 'mud') return true;
    return Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 2;
  };
  const rimR = (a) => 37 + Math.sin(a * 3 + 0.7) * 1.2;

  // Boulders along the cliff foot.
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2;
    const d = rimR(a) - R.range(0, 4);
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.96;
    const y = terrainHeight(x, z);
    const s = R.range(1.0, 3.2);
    if (occupied(x, z, y, s * 0.8)) continue;
    boulder(ctx, x, y + s * 0.15, z, s, { collide: s > 1.4, sy: R.range(0.6, 0.95) });
  }
  // Small rocks on the floor.
  for (let i = 0; i < 30; i++) {
    const x = R.range(-34, 34), z = R.range(-34, 34);
    const y = terrainHeight(x, z);
    const s = R.range(0.4, 1.0);
    if (y < -0.5 || occupied(x, z, y, s + 0.6)) continue;
    boulder(ctx, x, y + s * 0.1, z, s, { collide: false });
  }
  // Ferns, bushes, grass on the floor and banks.
  for (let i = 0; i < 2600; i++) {
    const x = R.range(-46, 46), z = R.range(-46, 46);
    const y = terrainHeight(x, z);
    if (waterHeight(x, z) > y - 0.2) continue;
    if (x > 8 && terrainTag(x, z) === 'mud') continue;
    const roll = R();
    if (roll < 0.42) addInst(ctx, 'fern', V(x, y - 0.05, z), R.range(0.9, 2.0), R() * 6.28, 0.4);
    else if (roll < 0.6) addInst(ctx, 'bush', V(x, y + 0.2, z), R.range(1.2, 2.6), R() * 6.28, 0.3);
    else if (roll < 0.9) addInst(ctx, 'grass', V(x, y - 0.05, z), R.range(0.6, 1.3), R() * 6.28, 0.2);
    else addInst(ctx, 'monstera', V(x, y - 0.05, z), R.range(1.2, 2.2), R() * 6.28, 0.3);
  }
  // Reeds around the pool.
  for (let i = 0; i < 160; i++) {
    const a = R() * Math.PI * 2, d = POOL.r + R.range(0.5, 3.5);
    const x = POOL.x + Math.cos(a) * d, z = POOL.z + Math.sin(a) * d;
    const y = terrainHeight(x, z);
    if (y < WORLD.waterLevel - 0.3) continue;
    addInst(ctx, 'grass', V(x, y - 0.05, z), R.range(1.0, 1.8), R() * 6.28, 0.2);
  }
  // Lianas draped down the cliff faces.
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2;
    const d = 41.5 + R() * 1.5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x - FALLS.x) < 7 && z < 0) continue;
    const top = terrainHeight(x, z);
    hangingVine(ctx, V(x * 0.985, top + 0.3, z * 0.985), R.range(6, 16), i + 300);
  }
  // Ferns on the rim plateau.
  for (let i = 0; i < 500; i++) {
    const a = R() * Math.PI * 2, d = R.range(42, 60);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    addInst(ctx, R() < 0.6 ? 'fern' : 'bush', V(x, terrainHeight(x, z) - 0.05, z), R.range(1.2, 2.6), R() * 6.28, 0.3);
  }
  // A few slim trees on the bowl floor and banks (climbable, out of the main lines).
  const spots = [[-28, -20], [28, -24], [-30, 20], [26, 30], [-4, 34], [12, 34], [-33, 2], [8, -34], [-14, 32], [33, 17]];
  for (const [i, [x, z]] of spots.entries()) {
    const y = terrainHeight(x, z);
    if (occupied(x, z, y, 3)) continue;
    const h = R.range(18, 26);
    tree(ctx, { x, z, y0: y - 1, height: h, r: R.range(0.7, 1.1), roots: 0, crownY: y + h - 2, crownR: R.range(5, 7), climbable: true, buttress: 0.6, seed: i * 7 + 3, crownDensity: 0.8, limbs: 3 });
  }
  // Rim forest: big trees on the plateau around the bowl.
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + R() * 0.06;
    const d = R.range(45, 58);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x - FALLS.x) < 9 && z < 0) continue;
    const y = terrainHeight(x, z);
    tree(ctx, { x, z, y0: y - 2, height: R.range(22, 34), r: R.range(1.4, 2.4), roots: 0, crownR: R.range(8, 12), climbable: false, seed: 500 + i, crownDensity: 0.7 });
  }
  lightShaft(ctx, V(-10, 0, -2), 1.2);
  lightShaft(ctx, V(12, 0, 14), 1.0);
  lightShaft(ctx, V(-2, 0, -22), 1.3);
}

export { BoxCollider, CylinderCollider, clamp };
