// The jungle playground layout. Coordinates: x east, z south, y up (meters).
//
// Hubs: Great Tree (west), river gorge with vines (center), temple ruins
// (east), cliff + waterfall (north), mud-slide hill (far west), mushroom
// garden (south-west) and a stilt village (south-east). Branches, bridges,
// vines and zip-vines connect them on several height layers.
import * as THREE from 'three';
import { CollisionWorld, Heightfield, BoxCollider } from '../physics/world.js';
import { RailSet } from '../physics/rails.js';
import { VineSet } from '../physics/vines.js';
import { rng, clamp, lerp } from '../core/math.js';
import { WORLD, terrainHeight, terrainTag, waterHeight, riverDist, POOL, MUDSLIDE } from './terrain.js';
import {
  createContext, tree, branch, solid, deck, ropeBridge, vine, zipLine, mushroom, boulder, torch, hut,
  pillar, stairs, collectible, gap, lightShaft, addInst, crown, railing, V,
} from './builders.js';

const H = (x, z) => terrainHeight(x, z);

/** Helix points around (cx, cz) from angle a0 to a1 (degrees) and heights y0..y1. */
function helix(cx, cz, R, a0, a1, y0, y1, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = THREE.MathUtils.degToRad(lerp(a0, a1, t));
    pts.push(V(cx + Math.cos(a) * R, lerp(y0, y1, t), cz + Math.sin(a) * R));
  }
  return pts;
}

export function buildLevel({ visual = true } = {}) {
  const world = new CollisionWorld();
  const rails = new RailSet();
  const vines = new VineSet();
  world.terrain = new Heightfield(WORLD.min, WORLD.min, WORLD.size, WORLD.res, terrainHeight, terrainTag);
  world.waterFn = waterHeight;
  const ctx = createContext(world, rails, vines, visual);

  // ------------------------------------------------------------------ bounds
  const B = WORLD.bounds;
  for (const [cx, cz, w, d] of [[0, -B - 2, 2 * B + 8, 4], [0, B + 2, 2 * B + 8, 4], [-B - 2, 0, 4, 2 * B + 8], [B + 2, 0, 4, 2 * B + 8]]) {
    solid(ctx, { c: [cx, 30, cz], size: [w, 120, d], visible: false, tag: 'rock', noCamera: true, noMantle: true });
  }

  // ================================================================== GREAT TREE
  const GT = { x: -32, z: -8 };
  tree(ctx, { ...GT, y0: H(GT.x, GT.z) - 1.5, height: 52, r: 4.0, rTop: 3.4, roots: 6, crownY: 46, crownR: 16, crownTrim: 6, seed: 11, name: 'Great Tree' });
  crown(ctx, V(GT.x, 40, GT.z), 11, 12, 0.6);
  // Deck A (spawn) – east side, y=12.
  deck(ctx, { c: [-25.5, 12, -8], size: [7, 10] });
  torch(ctx, V(-22.6, 12, -12.4));
  torch(ctx, V(-22.6, 12, -3.6));
  // Launch mushroom beside Deck A (super-bounce up to the deck from the ground).
  mushroom(ctx, { x: -18.6, z: -10.5, y0: H(-18.6, -10.5), top: H(-18.6, -10.5) + 4.2, r: 2.2, bounce: 16 });
  // Deck B – north-east, y=24.
  deck(ctx, { c: [-26.5, 24, -13.5], size: [6, 6] });
  torch(ctx, V(-24, 24, -16));
  // Hut C (lookout) – south-west, y=36, with a canopy roof on posts.
  deck(ctx, { c: [-36.5, 36, -2.5], size: [7, 7] });
  lookoutRoof(ctx, -37.2, 36, -1.8);
  // Spiral branch wrapping the Great Tree from the lookout down to Deck A.
  branch(ctx, helix(GT.x, GT.z, 6.3, 129, -280, 35.6, 14.8, 64), { r0: 0.75, r1: 0.5, name: 'Spiral Slide', leaves: true, hangers: true, leafRange: [0.05, 0.7], tipLeaves: false });
  // Branch stubs supporting the spiral (visual + walkable).
  for (const a of [60, -60, -180, -275]) {
    const rad = THREE.MathUtils.degToRad(a);
    const y = lerp(35.6, 14.8, (129 - a) / 409) - 0.4;
    branch(ctx, [V(GT.x + Math.cos(rad) * 3.2, y + 0.6, GT.z + Math.sin(rad) * 3.2), V(GT.x + Math.cos(rad) * 6.3, y, GT.z + Math.sin(rad) * 6.3)], { r0: 0.6, r1: 0.45, grind: false, leaves: false });
  }
  // East Reach: Deck B toward the river (ends near vine V1).
  branch(ctx, [V(-24, 24.3, -13.5), V(-16, 23, -16.5), V(-8, 20.8, -20.5), V(-2.5, 19.2, -22.8)], { r0: 0.7, r1: 0.35, name: 'East Reach' });
  // South Arm: Deck A toward the mushroom garden.
  branch(ctx, [V(-25, 12.2, -3.4), V(-21.5, 11, 7), V(-21, 9.6, 18), V(-23, 8.4, 29)], { r0: 0.7, r1: 0.35, name: 'South Arm', leafRange: [0.5, 1] });
  // West Arm: lookout down to the mud-slide hilltop.
  branch(ctx, [V(-40.2, 36.2, -2.5), V(-48, 32, -10), V(-56, 26.5, -18), V(-63.5, H(-63.5, -27) + 0.9, -27)], { r0: 0.8, r1: 0.4, name: 'West Arm' });
  // Cliff branch (north) from the trunk – reach it by climbing.
  branch(ctx, [V(-31.2, 30.5, -11.5), V(-29, 29.6, -24), V(-24.5, 28.6, -36), V(-21.4, 28.2, -46.5)], { r0: 0.75, r1: 0.5, name: 'Cliff Branch' });
  lightShaft(ctx, V(-18, 0, -2), 1.3);
  lightShaft(ctx, V(-40, 0, 14), 1.1);

  // ================================================================== RIVER CROSSINGS
  // River Tree (east bank) with an arm over the river carrying vines.
  const RT = { x: 14, z: -22 };
  tree(ctx, { ...RT, y0: H(RT.x, RT.z) - 1.5, height: 38, r: 2.1, roots: 4, crownY: 35, crownR: 10, seed: 21 });
  deck(ctx, { c: [10.6, 16, -19.6], size: [5, 5] });
  branch(ctx, [V(12.6, 31, -22.4), V(4, 30.6, -24), V(-4, 29.4, -25.6), V(-9, 28.4, -26)], { r0: 0.7, r1: 0.35, name: 'River Arm' });
  vine(ctx, V(2.5, 30.2, -24.2), 12.5);
  vine(ctx, V(-5.5, 28.8, -25.7), 10);
  // Temple branch: from the river tree down to the temple's top tier.
  branch(ctx, [V(15.6, 19.5, -20.5), V(23, 17, -15.5), V(31, 14, -11.5), V(38.2, 12.7, -9.5)], { r0: 0.7, r1: 0.4, name: 'Temple Branch' });

  // Bridge tree (east bank) + the high rope bridge from Deck A.
  const BT = { x: 17, z: 1 };
  tree(ctx, { ...BT, y0: H(BT.x, BT.z) - 1.5, height: 32, r: 1.9, roots: 4, crownY: 29.5, crownR: 9, seed: 31 });
  deck(ctx, { c: [13.8, 12, -0.6], size: [4.4, 5] });
  ropeBridge(ctx, V(-22.1, 12, -6.2), V(11.7, 12, -1.6), { sag: 1.6, width: 2.2 });
  branch(ctx, [V(15.4, 27, 0.4), V(6, 26.4, 2), V(-2, 25.5, 4), V(-7, 25, 4.5)], { r0: 0.6, r1: 0.32, name: 'Bridge Arm' });
  vine(ctx, V(3, 26.2, 2.6), 12);
  vine(ctx, V(-4, 25.3, 4.2), 10.5);

  // Fallen giant log across the river.
  {
    const a = V(-15, H(-15, -40) + 1.0, -40), b = V(16, H(16, -31) + 1.0, -31);
    const mid = V().addVectors(a, b).multiplyScalar(0.5);
    mid.y = Math.max(a.y, b.y) - 0.2;
    branch(ctx, [a, mid, b], { r0: 1.25, r1: 1.0, name: 'Log Ride', railKind: 'log', leaves: false, mat: 'bark' });
    boulder(ctx, -15.5, H(-15.5, -40) + 0.5, -42.5, 2.2);
    boulder(ctx, 17, H(17, -31) + 0.3, -28.5, 1.8);
  }
  // Stepping stones (south).
  for (const [x, z, s] of [[-1.5, 46, 1.4], [3, 44.2, 1.6], [7.2, 46.2, 1.5], [11.4, 44.4, 1.6], [15, 46.5, 1.3]]) {
    boulder(ctx, x, -0.85, z, s, { flatTop: true, sy: 0.9 });
  }
  // South tree with arm + vines over the southern river bend.
  const ST = { x: 23, z: 26 };
  tree(ctx, { ...ST, y0: H(ST.x, ST.z) - 1.5, height: 30, r: 2.0, roots: 4, crownY: 27.5, crownR: 9, seed: 41 });
  branch(ctx, [V(21.2, 24, 26.4), V(12, 23.5, 28), V(3, 22.5, 30), V(-3, 21.8, 30.6)], { r0: 0.6, r1: 0.3, name: 'South Reach' });
  vine(ctx, V(11, 23.3, 28.2), 11);
  vine(ctx, V(2.5, 22.3, 30), 10);
  deck(ctx, { c: [26.8, 14, 26], size: [4, 5] });

  // ================================================================== TEMPLE RUINS
  const TX = 46, TZ = -8;
  solid(ctx, { c: [TX, 0.5, TZ], size: [30, 7, 30], mat: 'stone', tile: 3, wallRun: true, aoBase: -1 });
  solid(ctx, { c: [TX, 5.0, TZ], size: [22, 6, 22], mat: 'stone', tile: 3, wallRun: true, aoBase: 4 });
  solid(ctx, { c: [TX, 9.0, TZ], size: [14, 6, 14], mat: 'stone', tile: 3, wallRun: true, aoBase: 8 });
  stairs(ctx, { from: [26.5, 0.2, TZ], to: [39, 12, TZ], width: 6 });
  // Shrine: four pillars and a walkable roof with grindable edges.
  for (const [px, pz] of [[42.4, -11.6], [49.6, -11.6], [42.4, -4.4], [49.6, -4.4]]) {
    solid(ctx, { c: [px, 14.25, pz], size: [1.2, 4.5, 1.2], mat: 'stone', tile: 2 });
  }
  solid(ctx, { c: [TX, 16.8, TZ], size: [9.5, 0.6, 9.5], mat: 'stone', tile: 3 });
  {
    const y = 17.1, e = 4.6;
    const c = [V(TX - e, y, TZ - e), V(TX + e, y, TZ - e), V(TX + e, y, TZ + e), V(TX - e, y, TZ + e)];
    for (let i = 0; i < 4; i++) railing(ctx, c[i], c[(i + 1) % 4], { h: 0.35, kind: 'stone' });
  }
  torch(ctx, V(26.5, H(26.5, -12.2), -12.2));
  torch(ctx, V(26.5, H(26.5, -3.8), -3.8));
  torch(ctx, V(39.6, 12, -12.4));
  torch(ctx, V(39.6, 12, -3.6));
  torch(ctx, V(52.5, 12, -14.5));
  // Tier-edge grind ledges (stone lips).
  railing(ctx, V(31.3, 4, -22.7), V(60.7, 4, -22.7), { h: 0.25, kind: 'stone' });
  railing(ctx, V(31.3, 4, 6.7), V(60.7, 4, 6.7), { h: 0.25, kind: 'stone' });
  // Carved face pillars with scaffolding.
  const tp1 = pillar(ctx, { x: 28, z: -31, h: 18.5, s: 3.6, faces: [0, 1] });
  scaffold(ctx, 28, -31, 3.6, [3.5, 7, 10.5, 14]);
  collectible(ctx, 'idol', V(28, tp1 + 1.2, -31), 'Pillar Idol');
  pillar(ctx, { x: 65, z: 14, h: 15, s: 3.2, faces: [0, 3] });
  scaffold(ctx, 65, 14, 3.2, [3.5, 7, 10.5]);
  pillar(ctx, { x: 33, z: 15, h: 10.5, s: 3, faces: [0, 2] });
  pillar(ctx, { x: 63, z: -31, h: 12.5, s: 3, faces: [1, 2] });
  // Broken stone wall for wall-running (two segments with a gap).
  for (const [x0, x1] of [[20, 31], [34.5, 47]]) {
    const cx = (x0 + x1) / 2;
    solid(ctx, { c: [cx, 2.2, 20], size: [x1 - x0, 7.4, 1.4], mat: 'stone', tile: 2.5, wallRun: true, aoBase: H(cx, 20) });
    railing(ctx, V(x0 + 0.2, 5.9, 20), V(x1 - 0.2, 5.9, 20), { h: 0.1, kind: 'stone' });
  }
  // Arch over the eastern path.
  solid(ctx, { c: [70, 3.5, -12], size: [2.4, 9, 2.4], mat: 'stone', tile: 2.5, wallRun: true });
  solid(ctx, { c: [70, 3.5, -2], size: [2.4, 9, 2.4], mat: 'stone', tile: 2.5, wallRun: true });
  solid(ctx, { c: [70, 8.6, -7], size: [3, 1.2, 12.4], mat: 'stone', tile: 2.5 });
  railing(ctx, V(70, 9.2, -13), V(70, 9.2, -1), { h: 0.05, kind: 'stone' });
  lightShaft(ctx, V(46, 0, 12), 1.4);

  // East Tree with a deck and a branch onto the shrine roof.
  const ET = { x: 68, z: -42 };
  tree(ctx, { ...ET, y0: H(ET.x, ET.z) - 1.5, height: 42, r: 2.6, roots: 5, crownY: 38, crownR: 12, seed: 51 });
  deck(ctx, { c: [63.9, 18, -40.5], size: [5, 5] });
  branch(ctx, [V(62, 18.5, -38.5), V(57, 18.2, -27), V(51.5, 17.8, -16), V(48.5, 17.6, -11.4)], { r0: 0.6, r1: 0.35, name: 'Shrine Branch' });
  vine(ctx, V(56.4, 17.9, -25.5), 8);
  collectible(ctx, 'idol', V(63.9, 19.3, -40.5), 'East Tree Idol');

  // ================================================================== CLIFF + WATERFALL
  // Cliff tree with two decks and bridges toward the Great Tree and the cliff top.
  const CT = { x: -20, z: -50 };
  tree(ctx, { ...CT, y0: H(CT.x, CT.z) - 1.5, height: 40, r: 2.3, roots: 4, crownY: 37, crownR: 10, seed: 61 });
  deck(ctx, { c: [-20.6, 28, -46.3], size: [5, 4] });
  deck(ctx, { c: [-20, 34, -53.6], size: [5, 4] });
  ropeBridge(ctx, V(-20, 34, -55.6), V(-20, 26.6, -77.5), { sag: 1.0, width: 2.0 });
  branch(ctx, [V(-18, 31, -51), V(-9, 29.6, -56), V(0, 28.4, -60), V(6, 27.6, -62)], { r0: 0.6, r1: 0.3, name: 'Falls Arm' });
  vine(ctx, V(-8.5, 29.2, -56.2), 13);
  vine(ctx, V(1, 28.1, -60.2), 14);
  // Cliff ledges climbing the face west of the falls.
  const ledges = [[-46, 3.5], [-41, 7], [-35.5, 10.5], [-29.5, 14], [-23, 17.5], [-16.5, 21], [-11, 24.5]];
  for (const [lx, top] of ledges) {
    const zf = cliffFaceZ(lx, top);
    solid(ctx, { c: [lx, top - 2.5, zf + 0.4], size: [4.2, 5, 6], mat: 'rock', tag: 'rock', tile: 3, rotY: (lx % 3) * 0.05, rocky: 0.35 });
  }
  collectible(ctx, 'idol', V(-29.5, 15.3, cliffFaceZ(-29.5, 14) + 1.5), 'Ledge Idol');
  // Waterfall cave: hollow behind the falls.
  waterfallCave(ctx);
  ctx.waterfalls.push({ x: 0, top: WORLD.cliffTop - 0.3, zTop: -74.2, bottom: -1, zBottom: -64.4, width: 7.5 });
  // Cliff top extras.
  torch(ctx, V(-17.5, H(-17.5, -78.5), -78.5));
  collectible(ctx, 'idol', V(-52, H(-52, -80) + 1.4, -80), 'Cliff Idol');
  boulder(ctx, 9, H(9, -80) + 0.6, -80, 2.2);
  boulder(ctx, -9, H(-9, -79) + 0.6, -79, 1.8);
  // Zip vines off the cliff.
  zipLine(ctx, V(34, H(34, -77) + 3.2, -77), V(44.8, 19.9, -11.2), { name: 'Temple Zip' });
  zipLine(ctx, V(-38, H(-38, -77) + 3.2, -77), V(-66, H(-66, -49) + 2.8, -49), { name: 'Hill Zip' });
  zipPost(ctx, 34, -77);
  zipPost(ctx, -38, -77);

  // ================================================================== MUD SLIDE HILL
  {
    const top = MUDSLIDE[0];
    deck(ctx, { c: [top[0] - 1, H(top[0] - 1, top[1] - 4) + 0.4, top[1] - 4], size: [6, 5] });
    torch(ctx, V(top[0] + 2, H(top[0] + 2, top[1] - 7), top[1] - 7));
    collectible(ctx, 'idol', V(top[0] - 1, H(top[0] - 1, top[1] - 4) + 1.8, top[1] - 4), 'Hilltop Idol');
    // Kicker ramp at the bottom (launches toward the mushroom garden).
    const end = MUDSLIDE[MUDSLIDE.length - 1];
    const kx = end[0] + 2.5, kz = end[1] + 2.0;
    const ky = H(kx, kz);
    solid(ctx, { c: [kx, ky + 0.9, kz], size: [4.4, 0.5, 6.5], rotY: THREE.MathUtils.degToRad(42), rotX: -0.5, mat: 'planks', tag: 'wood', tile: 2 });
    solid(ctx, { c: [kx + 1.0, ky - 0.6, kz + 1.0], size: [3.6, 2.2, 3], rotY: THREE.MathUtils.degToRad(42), mat: 'wood', tag: 'wood', tile: 2 });
    collectible(ctx, 'idol', V(kx + 11, ky + 8.5, kz + 9), 'Rocket Idol');
    gap(ctx, 'Mud Rocket', 750, [[kx - 5, ky - 2, kz - 5], [kx + 5, ky + 6, kz + 5]], [[-40, -3, 28], [-8, 30, 64]]);
  }

  // ================================================================== MUSHROOM GARDEN
  mushroom(ctx, { x: -34, z: 32, y0: H(-34, 32), top: H(-34, 32) + 3, r: 2.4, bounce: 14 });
  mushroom(ctx, { x: -23.6, z: 35.6, y0: H(-23.6, 35.6), top: 6.8, r: 2.7, bounce: 15 });
  mushroom(ctx, { x: -30, z: 44, y0: H(-30, 44), top: 10.2, r: 2.6, bounce: 15.5 });
  mushroom(ctx, { x: -22, z: 51.5, y0: H(-22, 51.5), top: 14, r: 3.0, bounce: 16 });
  mushroom(ctx, { x: -13, z: 43, y0: H(-13, 43), top: H(-13, 43) + 4, r: 2.0, bounce: 14 });
  mushroom(ctx, { x: -40, z: 55, y0: H(-40, 55), top: H(-40, 55) + 6, r: 2.2, bounce: 15 });
  collectible(ctx, 'letter', V(-22, 23.5, 51.5), 'G');
  const MT = { x: -13, z: 63 };
  tree(ctx, { ...MT, y0: H(MT.x, MT.z) - 1.5, height: 34, r: 2.3, roots: 4, crownY: 31, crownR: 10, seed: 71 });
  deck(ctx, { c: [-17, 18, 60.5], size: [5, 5] });
  collectible(ctx, 'idol', V(-17.5, 19.3, 61.5), 'Shroom Idol');
  branch(ctx, [V(-11, 22, 61), V(-3, 20.5, 57), V(4, 18.2, 52.5), V(9, 16, 50)], { r0: 0.6, r1: 0.3, name: 'Garden Branch' });
  vine(ctx, V(-3.5, 20.2, 57.2), 9);
  gap(ctx, 'Shroom Summit', 600, [[-26, 12, 48], [-16, 30, 58]], [[-20, 17, 57.5], [-14, 22, 63.5]]);
  zipLine(ctx, V(-38.5, 39.4, 0.2), V(-18.2, 20.6, 57.5), { name: 'Garden Zip' });
  collectible(ctx, 'letter', V(-28.4, 27.2, 29), 'E');
  lightShaft(ctx, V(-26, 0, 44), 1.2);

  // ================================================================== STILT VILLAGE
  const huts = [[29, 6.5, 44, 0], [42, 6.5, 51, 0.5], [32, 6.5, 63, -0.3]];
  for (const [x, y, z, rot] of huts) {
    deck(ctx, { c: [x, y, z], size: [8, 8], rotY: rot, stilts: true, groundY: H(x, z) });
    hut(ctx, { c: [x, y, z], w: 5, d: 5, rotY: rot });
  }
  ropeBridge(ctx, V(33.2, 6.5, 45.6), V(37.8, 6.5, 49.3), { sag: 0.5 });
  ropeBridge(ctx, V(39.4, 6.5, 54.5), V(35, 6.5, 59.6), { sag: 0.6 });
  // Ramp from the riverbank up to the first hut.
  solid(ctx, { c: [21.2, 3.3, 44.5], size: [3, 0.4, 9.6], rotY: Math.PI / 2, rotX: 0.72, mat: 'planks', tag: 'wood', tile: 2 });
  collectible(ctx, 'idol', V(32, 13.6, 63), 'Roof Idol');
  const VT = { x: 50, z: 66 };
  tree(ctx, { ...VT, y0: H(VT.x, VT.z) - 1.5, height: 30, r: 2.0, roots: 4, crownY: 27, crownR: 9, seed: 81 });
  branch(ctx, [V(48.4, 20, 64.5), V(43, 18.2, 58), V(38.5, 15.4, 52), V(35, 13.5, 47.4)], { r0: 0.55, r1: 0.3, name: 'Village Branch' });
  vine(ctx, V(43.3, 18, 58.5), 8);
  zipLine(ctx, V(44.5, 19.6, -2.5), V(29.3, 14.3, 42.6), { name: 'Village Zip' });
  gap(ctx, 'Hut Hop', 400, [[24, 9, 39], [34, 14, 49]], [[37, 9, 46], [47, 14, 56]]);

  // ================================================================== COLLECTIBLES + GAPS
  collectible(ctx, 'letter', V(0.4, 21.2, -23.6), 'J');
  collectible(ctx, 'letter', V(TX, 18.6, TZ), 'U');
  collectible(ctx, 'letter', V(-1.5, 2.4, -74.3), 'N');
  collectible(ctx, 'letter', V(GT.x + 6.3, 31.4, GT.z), 'L');
  collectible(ctx, 'idol', V(7.2, 0.9, 46.2), 'Stepping Stone Idol');
  collectible(ctx, 'idol', V(59, 5.2, -21), 'Temple Idol');

  gap(ctx, 'Vine Leap', 500, [[-10, 15, -27], [0, 26, -18]], [[-8, 10, -32], [10, 32, -16]], { land: 'vine' });
  gap(ctx, 'River Rocket', 800, [[-90, -5, -90], [-9, 60, 90]], [[13, -5, -90], [90, 60, 90]]);
  gap(ctx, 'Waterfall Plunge', 1200, [[-40, 24, -95], [40, 50, -73]], [[-14, -8, -75], [14, 0, -46]], { land: 'water' });
  gap(ctx, 'Shrine Leap', 900, [[41, 16.5, -13], [51, 24, -3]], [[25.5, 18, -33.5], [30.5, 24, -28.5]]);
  gap(ctx, 'Canopy Hop', 700, [[-30, 10, -18], [-20, 30, -2]], [[7.5, 14, -23], [14, 22, -16]]);
  gap(ctx, 'Wall Gap', 350, [[19, 4, 18], [31.5, 9, 22]], [[34, 4, 18], [48, 9, 22]]);
  gap(ctx, 'Leap of Faith', 1000, [[-41, 35, -7], [-32, 45, 2]], [[-90, -8, -90], [90, 0, 90]], { land: 'water' });
  gap(ctx, 'Temple Run', 600, [[38, 11, -16], [54, 25, 0]], [[60, 6, -50], [75, 30, -30]]);

  // ================================================================== GROUND LINES
  // Fallen logs: low grind lines for flow along the jungle floor.
  for (const [ax, az, bx, bz, r] of [[-60, 40, -46, 52, 0.9], [36, 30, 52, 34, 0.85], [56, 46, 66, 60, 0.8], [-8, 74, 8, 80, 0.9], [-50, -6, -42, 8, 0.8], [40, -40, 54, -46, 0.85]]) {
    const a = V(ax, H(ax, az) + r * 0.7, az), b = V(bx, H(bx, bz) + r * 0.7, bz);
    const m = V().addVectors(a, b).multiplyScalar(0.5);
    m.y = Math.max(a.y, b.y) + 0.15;
    branch(ctx, [a, m, b], { r0: r, r1: r * 0.8, name: 'Log Ride', railKind: 'log', leaves: false, mat: 'bark' });
  }

  // ================================================================== DECOR
  decorate(ctx);

  const spawn = { pos: V(-24.5, 12.1, -8), yaw: Math.PI / 2 };
  return { world, rails, vines, ctx, spawn };
}

// -------------------------------------------------------------------- helpers
function cliffFaceZ(x, y) {
  // Find z where terrain reaches height y on the cliff face (searching north).
  let z = -66;
  for (; z > -80; z -= 0.25) if (terrainHeight(x, z) >= y) break;
  return z;
}

function scaffold(ctx, x, z, s, levels) {
  const R = rng(Math.floor(x * 9 + z));
  levels.forEach((y, i) => {
    const side = i % 4;
    const a = side * Math.PI / 2;
    const ox = Math.sin(a) * (s / 2 + 1.25), oz = Math.cos(a) * (s / 2 + 1.25);
    deck(ctx, { c: [x + ox, y, z + oz], size: Math.abs(ox) > Math.abs(oz) ? [2.5, s + 1.5] : [s + 1.5, 2.5], stilts: false });
    // posts down to the ground
    if (ctx.visual) {
      for (const k of [-1, 1]) {
        const px = x + ox + (Math.abs(oz) > 0 ? k * (s / 2 + 0.4) : Math.sign(ox) * 1.0);
        const pz = z + oz + (Math.abs(ox) > 0 ? k * (s / 2 + 0.4) : Math.sign(oz) * 1.0);
        const g = new THREE.CylinderGeometry(0.12, 0.14, y + 1, 6);
        g.translate(px, (y - 1) / 2, pz);
        ctx.geo.wood ||= [];
        ctx.geo.wood.push(g);
      }
    }
    void R;
  });
}

function lookoutRoof(ctx, x, y, z) {
  for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    solid(ctx, { c: [x + px, y + 1.4, z + pz], size: [0.3, 2.8, 0.3], mat: 'wood', tag: 'wood' });
  }
  const rise = 1.6, half = 3.6;
  const slope = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    solid(ctx, { c: [x, y + 2.8 + rise / 2 + 0.1, z + s * half / 2], size: [7.2, 0.3, Math.hypot(rise, half)], rotX: s * slope, mat: 'thatch', tag: 'thatch', tile: 3, ao: false });
  }
  const rail = railing(ctx, V(x - 3.6, y + 2.8 + rise - 0.1, z), V(x + 3.6, y + 2.8 + rise - 0.1, z), { h: 0.25, kind: 'roof' });
  void rail;
  torch(ctx, V(x - 2.4, y, z + 2.4), { h: 1.2 });
}

function zipPost(ctx, x, z) {
  const y = terrainHeight(x, z);
  solid(ctx, { c: [x, y + 1.6, z], size: [0.5, 3.6, 0.5], mat: 'wood', tag: 'wood' });
  solid(ctx, { c: [x, y + 0.2, z + 2.2], size: [3.4, 0.4, 3], mat: 'planks', tag: 'wood' });
}

function waterfallCave(ctx) {
  // A rock alcove behind the waterfall, entered from a ledge on the west.
  const zBack = -76.5;
  solid(ctx, { c: [0, 0.6, -71.5], size: [9, 1.2, 9], mat: 'rock', tag: 'rock', tile: 3 }); // floor
  solid(ctx, { c: [-5.2, 4, -73.75], size: [1.6, 7, 5.5], mat: 'rock', tag: 'rock', tile: 3, rocky: 0.3 }); // west wall (open at the front for the ledge path)
  solid(ctx, { c: [5.2, 4, -72], size: [1.6, 7, 9], mat: 'rock', tag: 'rock', tile: 3, rocky: 0.3 }); // east wall
  solid(ctx, { c: [0, 7.8, -72.5], size: [12, 1.6, 9], mat: 'rock', tag: 'rock', tile: 3, rocky: 0.3 }); // roof
  solid(ctx, { c: [0, 4, zBack], size: [10, 8, 1.5], mat: 'rock', tag: 'rock', tile: 3, rocky: 0.3 });
  // Entry ledge path from the west bank of the pool.
  solid(ctx, { c: [-7.7, 0.5, -69], size: [6.6, 1.0, 3], mat: 'rock', tag: 'rock', tile: 3, rocky: 0.2 });
  boulder(ctx, -12.5, 0.2, -68, 1.6, { flatTop: true });
  torch(ctx, V(-3, 1.2, -74.5), { h: 1.2 });
  torch(ctx, V(3, 1.2, -74.5), { h: 1.2 });
}

/** Scatter foliage, rocks and background trees. */
function decorate(ctx) {
  const R = rng(777);
  const world = ctx.world;
  const onRoute = (x, z, rad) => {
    // Keep the mud slide trough and the main ground routes clear.
    for (let i = 0; i < MUDSLIDE.length - 1; i++) {
      const [ax, az] = MUDSLIDE[i], [bx, bz] = MUDSLIDE[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 7 + rad) return true;
    }
    if (Math.hypot(x + 42, z - 34) < 9 + rad) return true; // kicker landing zone
    // Designed flight paths: mushroom garden, temple stair approach, village ramp.
    const zones = [[-44, 26, -8, 60], [14, -15, 28, -1], [12, 38, 26, 52]];
    return zones.some(([x0, z0, x1, z1]) => x > x0 - rad && x < x1 + rad && z > z0 - rad && z < z1 + rad);
  };
  const occupied = (x, z, y, rad) => {
    if (onRoute(x, z, rad)) return true;
    const cs = world.query(x - rad, y - 1, z - rad, x + rad, y + 3, z + rad, []);
    return cs.some((c) => c.tag !== 'rock' || c.type !== 'box' || c.max.y - c.min.y < 50);
  };
  // Small boulders.
  for (let i = 0; i < 70; i++) {
    const x = R.range(-86, 86), z = R.range(-66, 86);
    if (riverDist(x, z) < 9 || Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 3) continue;
    const y = terrainHeight(x, z);
    const s = R.range(0.5, 1.6);
    if (occupied(x, z, y, s + 0.5)) continue;
    boulder(ctx, x, y + s * 0.2, z, s, { collide: s > 0.9 });
  }
  // Bigger boulders along the river banks.
  for (let i = 0; i < 26; i++) {
    const z = R.range(-48, 86);
    const side = R.sign();
    // find river x at z
    let bx = 0;
    for (let x = -30; x < 30; x += 0.5) if (riverDist(x, z) < 0.6) { bx = x; break; }
    const x = bx + side * R.range(7.5, 10.5);
    const y = terrainHeight(x, z);
    const s = R.range(1.2, 2.6);
    if (occupied(x, z, y, s)) continue;
    boulder(ctx, x, y + 0.2, z, s, { sy: 0.7 });
  }
  // Ferns, bushes and grass on the floor (instances are skipped in headless builds,
  // but the RNG sequence and the tree colliders below stay identical).
  for (let i = 0; i < 4000; i++) {
    const x = R.range(-92, 92), z = R.range(-70, 92);
    const rd = riverDist(x, z);
    if (rd < 6.5) continue;
    const y = terrainHeight(x, z);
    if (y > 20 && z > -70) continue;
    const roll = R();
    if (roll < 0.45) addInst(ctx, 'fern', V(x, y - 0.05, z), R.range(0.9, 2.0), R() * 6.28, 0.4);
    else if (roll < 0.62) addInst(ctx, 'bush', V(x, y + 0.2, z), R.range(1.2, 2.6), R() * 6.28, 0.3);
    else if (roll < 0.9) addInst(ctx, 'grass', V(x, y - 0.05, z), R.range(0.6, 1.3), R() * 6.28, 0.2);
    else addInst(ctx, 'monstera', V(x, y - 0.05, z), R.range(1.2, 2.2), R() * 6.28, 0.3);
  }
  // Reeds along the river.
  for (let i = 0; i < 500; i++) {
    const x = R.range(-30, 40), z = R.range(-50, 92);
    const rd = riverDist(x, z);
    if (rd < 6.2 || rd > 9.5) continue;
    addInst(ctx, 'grass', V(x, terrainHeight(x, z) - 0.05, z), R.range(1.0, 1.8), R() * 6.28, 0.2);
  }
  // Cliff top & plateau foliage.
  for (let i = 0; i < 300; i++) {
    const x = R.range(-90, 90), z = R.range(-95, -76);
    if (Math.abs(x) < 6) continue;
    addInst(ctx, R() < 0.6 ? 'fern' : 'bush', V(x, terrainHeight(x, z) - 0.05, z), R.range(1, 2.4), R() * 6.28, 0.3);
  }
  // Mid-size decorative trees (collidable trunks, not climbable).
  const spots = [];
  for (let i = 0; i < 90; i++) {
    const x = R.range(-88, 88), z = R.range(-68, 88);
    if (riverDist(x, z) < 11 || Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 5) continue;
    const y = terrainHeight(x, z);
    if (occupied(x, z, y, 5)) continue;
    if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 9)) continue;
    spots.push([x, z]);
    const h = R.range(14, 26);
    tree(ctx, { x, z, y0: y - 1, height: h, r: R.range(0.7, 1.3), roots: 0, crownY: y + h - 2, crownR: R.range(4, 7), climbable: true, buttress: 0.5, seed: i * 7 + 3, crownDensity: 0.7 });
  }
  // Background ring of giant trees beyond the boundary.
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + R() * 0.05;
    const d = R.range(97, 112);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z < -80) continue; // cliff side
    const y = terrainHeight(x, z);
    tree(ctx, { x, z, y0: y - 2, height: R.range(30, 46), r: R.range(1.6, 2.6), roots: 0, crownR: R.range(9, 13), climbable: false, seed: 500 + i, crownDensity: 0.6 });
  }
  // Cliff-top tree line.
  for (let i = 0; i < 26; i++) {
    const x = R.range(-90, 90), z = R.range(-100, -84);
    if (Math.abs(x) < 10) continue;
    const y = terrainHeight(x, z);
    tree(ctx, { x, z, y0: y - 1, height: R.range(16, 28), r: R.range(0.9, 1.6), roots: 0, crownR: R.range(5, 8), climbable: true, seed: 900 + i, crownDensity: 0.7 });
  }
}

export { BoxCollider, clamp };
