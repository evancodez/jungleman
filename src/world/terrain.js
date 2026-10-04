// Terrain shape for "The Grotto": a compact jungle bowl ringed by cliffs.
// A waterfall drops off the north rim into a pool, the floor rises into
// skateable banks toward the cliff base, and a mud chute curls down the
// east bank from a cliff ledge.
import { clamp, smoothstep, fbm2, noise2, lerp } from '../core/math.js';

export const WORLD = {
  size: 128,
  min: -64,
  res: 128,
  waterLevel: -0.7,
  bounds: 41, // invisible boundary radius
  cliffTop: 23,
};

export const POOL = { x: -1, z: -24, r: 8.5 };
// Waterfall: lip on the north rim, splashing into the pool.
export const FALLS = { x: -1, top: 21.6, zTop: -39.2, bottom: -0.7, zBottom: -31.2, width: 5.2 };

// Mud chute centerline (x, z, ground y) from the east cliff ledge down to the floor.
export const MUDSLIDE = [
  [33.5, -10, 12.6], [34.2, -1, 10.6], [32.6, 8, 8.2], [29, 15.4, 5.6], [23.4, 20.2, 3.0], [18.2, 21.4, 1.4], [14.2, 18.4, 0.9],
];

function distToPolyline(x, z, pts) {
  let best = Infinity, bt = 0, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; bt = t; bi = i; }
  }
  return { d: best, i: bi, t: bt };
}

function mudInfo(x, z) {
  const r = distToPolyline(x, z, MUDSLIDE);
  const a = MUDSLIDE[r.i], b = MUDSLIDE[r.i + 1];
  return { d: r.d, y: lerp(a[2], b[2], r.t), i: r.i, t: r.t };
}

/** Distance from the bowl center, slightly elliptical and wobbly so the rim reads natural. */
function rimDist(x, z) {
  const a = Math.atan2(z, x);
  const wob = Math.sin(a * 3 + 0.7) * 1.2 + Math.sin(a * 7 + 2.1) * 0.6 + noise2(Math.cos(a) * 2.5, Math.sin(a) * 2.5) * 1.6;
  return Math.hypot(x, z * 1.04) + wob;
}

function baseHeight(x, z) {
  // Gentle floor undulation.
  let h = fbm2(x * 0.045 + 3.1, z * 0.045 - 1.7, 3) * 0.6 + noise2(x * 0.15, z * 0.15) * 0.12;
  const r = rimDist(x, z);
  // Skate-bowl banks rising toward the cliffs.
  const bankT = smoothstep(27, 37.5, r);
  h += bankT * bankT * 6.5;
  // Cliff wall with bulges, capped by the rim plateau.
  const cliffT = smoothstep(37.2, 41.5, r + noise2(x * 0.11, z * 0.11) * 1.4);
  const top = WORLD.cliffTop + fbm2(x * 0.05, z * 0.05, 3) * 2.5;
  h = lerp(h, top, cliffT);
  h += cliffT * (1 - cliffT) * 4 * fbm2(x * 0.17, z * 0.17 + 4.0, 3) * 3.5;
  // East shelf: a ledge partway up the east cliff where the mud chute starts.
  const shelf = smoothstep(27, 30, x) * smoothstep(-20, -14, z) * smoothstep(12, 5, z);
  h = Math.max(h, shelf * 12.6 + (1 - shelf) * -10);
  return h;
}

export function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  // Mud chute: a smooth trough down the east bank.
  const m = mudInfo(x, z);
  if (m.d < 9 && x > 8) {
    const trough = m.y - 0.55 + Math.pow(m.d / 4.2, 2) * 1.1;
    const lip = m.y + 1.1 - m.d * 0.05;
    const w = smoothstep(9, 4.5, m.d);
    // Build the chute up out of the bank where needed, then carve the trough.
    let hh = Math.max(h, lerp(h, lip, w * 0.85));
    if (m.d < 4.6) hh = trough;
    else hh = lerp(hh, Math.min(hh, trough + (m.d - 4.6) * 0.8), smoothstep(9, 4.6, m.d));
    h = hh;
  }
  // Waterfall pool.
  const pd = Math.hypot(x - POOL.x, (z - POOL.z) * 0.92);
  if (pd < POOL.r + 4.5) {
    const t = smoothstep(POOL.r + 4.5, POOL.r - 2, pd);
    h = lerp(h, -3.2 + noise2(x * 0.3, z * 0.3) * 0.3, t);
  }
  // Plunge basin under the falls carved into the cliff foot.
  const fx = Math.abs(x - FALLS.x);
  if (fx < 7 && z < -28 && z > -40) {
    const t = smoothstep(7, 3, fx) * smoothstep(-40, -35, z);
    h = lerp(h, Math.min(h, -2.8), t);
  }
  // Cliff-top stream channel feeding the falls.
  if (z < -38.5 && fx < 5) {
    const t = smoothstep(5, 2.5, fx) * smoothstep(-39, -41, z);
    h = lerp(h, WORLD.cliffTop - 1.6, t);
  }
  return h;
}

export function terrainTag(x, z) {
  const m = mudInfo(x, z);
  if (m.d < 3.8 && x > 8) return 'mud';
  if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 2.5) return 'sand';
  if (rimDist(x, z) > 37.5) return 'rock';
  return 'ground';
}

/** Water surface height at (x,z) or -Infinity if dry. */
export function waterHeight(x, z) {
  if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r + 5 || (Math.abs(x - FALLS.x) < 7 && z < -27 && z > -40.5)) return WORLD.waterLevel;
  if (z < -38.5 && Math.abs(x - FALLS.x) < 4) return WORLD.cliffTop - 0.9;
  return -Infinity;
}

/** Surface flow direction of the water (for the water shader). */
export function waterFlow(x, z) {
  if (z < -38.5) return [0, 1];
  // Spread away from where the falls land.
  const dx = x - FALLS.x, dz = z - FALLS.zBottom;
  const d = Math.hypot(dx, dz) || 1;
  const k = clamp(1.2 - d / 10, 0.1, 1);
  return [dx / d * k, dz / d * k];
}

/** Rough distance to moving water (for ambience). */
export function waterDist(x, z) {
  return Math.max(0, Math.hypot(x - POOL.x, z - POOL.z) - POOL.r);
}

/** Splat weights (grass, dirt, mud, rock) for terrain shading. */
export function terrainSplat(x, z, h, ny) {
  let grass = 1, dirt = 0, mud = 0, rock = 0;
  const n = fbm2(x * 0.05, z * 0.05, 3);
  dirt = clamp(0.2 + n * 0.9, 0, 1);
  // Worn dirt paths between the trees.
  dirt = Math.max(dirt, smoothstep(3.5, 1, Math.abs(Math.hypot(x, z - 4) - 13)) * 0.7);
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  mud = Math.max(mud, smoothstep(POOL.r + 3.5, POOL.r, pd));
  const md = mudInfo(x, z);
  if (x > 8) mud = Math.max(mud, smoothstep(5.5, 3, md.d));
  rock = smoothstep(0.8, 0.58, ny);
  rock = Math.max(rock, smoothstep(37, 39, rimDist(x, z)) * 0.85);
  grass *= 1 - mud;
  dirt *= 1 - mud;
  grass *= 1 - rock;
  dirt *= 1 - rock;
  mud *= 1 - rock;
  if (h < -1.2) rock = Math.max(rock, 0.4);
  // Grass returns on the rim plateau.
  if (h > WORLD.cliffTop - 3 && ny > 0.85) { grass = 0.8; rock = 0.2; mud = 0; dirt = 0; }
  return [grass, dirt, mud, rock];
}
