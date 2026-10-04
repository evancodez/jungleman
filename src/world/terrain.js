// Terrain shape: rolling jungle floor, a river gorge fed by a waterfall pool,
// a northern cliff, a western mud-slide hill and rising rim hills.
import { clamp, smoothstep, fbm2, noise2, lerp } from '../core/math.js';

export const WORLD = {
  size: 240,
  min: -120,
  res: 240,
  waterLevel: -1.0,
  bounds: 92, // invisible boundary (half extent)
  cliffTop: 26,
};

// River centerline from the waterfall pool to the south edge.
export const RIVER = [
  [0, -56], [5, -42], [3, -28], [-4, -14], [-3, 0], [4, 14], [9, 28], [7, 44], [3, 58], [9, 74], [16, 92], [22, 120],
];
export const POOL = { x: 0, z: -60, r: 13 };

// Mud slide centerline (x, z, groundY target) down the west hill.
export const MUDSLIDE = [
  [-70, -46, 16.5], [-71, -34, 14.5], [-68, -22, 12.2], [-62, -10, 9.5], [-57, 2, 6.8], [-54, 13, 4.2], [-51, 22, 2.2], [-48, 28, 1.4],
];

function distToPolyline(x, z, pts) {
  let best = Infinity, bt = 0, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bt = t; bi = i; }
  }
  return { d: best, i: bi, t: bt };
}

export function riverDist(x, z) {
  return distToPolyline(x, z, RIVER).d;
}

function mudInfo(x, z) {
  const r = distToPolyline(x, z, MUDSLIDE);
  const a = MUDSLIDE[r.i], b = MUDSLIDE[r.i + 1];
  return { d: r.d, y: lerp(a[2], b[2], r.t), end: r.i === MUDSLIDE.length - 2 && r.t > 0.95 };
}

const RIVER_HALF = 6.5; // half width of the water channel
const BANK = 5.0;

/** Base terrain height before carving. */
function baseHeight(x, z) {
  let h = fbm2(x * 0.018 + 3.1, z * 0.018 - 1.7, 4) * 2.2 + noise2(x * 0.09, z * 0.09) * 0.35;
  // Rim hills rising toward the boundary.
  const rim = Math.max(Math.abs(x), Math.abs(z * 1.0));
  h += smoothstep(80, 104, rim) * (18 + fbm2(x * 0.05, z * 0.05, 3) * 8);
  // Northern cliff plateau.
  const away = smoothstep(7, 18, Math.abs(x));
  const edgeN = noise2(x * 0.08, 7.3) * 1.2 + (noise2(x * 0.05, 2.1) * 2.2 + noise2(x * 0.21, 5.5) * 0.7) * away;
  const cliffT = smoothstep(-67.5, -74.5, z + edgeN);
  h = lerp(h, WORLD.cliffTop + fbm2(x * 0.06, z * 0.06, 3) * 0.6, cliffT);
  // Bulges and ledges on the cliff face.
  h += cliffT * (1 - cliffT) * 4 * (fbm2(x * 0.12, z * 0.3 + 4.0, 3) * 5) * away;
  // Western hill for the mud slide.
  const hill = smoothstep(-44, -70, x) * smoothstep(40, 5, z) * smoothstep(-80, -55, z) * 17;
  h = Math.max(h, hill + fbm2(x * 0.05, z * 0.05, 3) * 1.2 * smoothstep(-44, -60, x));
  return h;
}

export function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  // Mud slide trough.
  const m = mudInfo(x, z);
  if (m.d < 8 && x < -40) {
    const trough = m.y - 0.6 + Math.pow(m.d / 4.5, 2) * 0.9;
    const w = smoothstep(8, 4.5, m.d);
    h = lerp(h, Math.min(h, trough), w);
    if (m.d < 4.5) h = Math.min(h, trough);
  }
  // River channel.
  const rd = riverDist(x, z);
  if (rd < RIVER_HALF + BANK) {
    const bed = -3.4 + noise2(x * 0.2, z * 0.2) * 0.3;
    const bankT = smoothstep(RIVER_HALF + BANK, RIVER_HALF - 1.5, rd);
    h = lerp(h, bed, bankT);
  }
  // Waterfall pool.
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  if (pd < POOL.r + 5 && z > -72) {
    const t = smoothstep(POOL.r + 5, POOL.r - 2, pd);
    h = lerp(h, -4.5, t);
  }
  return h;
}

export function terrainTag(x, z) {
  const m = mudInfo(x, z);
  if (m.d < 3.6 && x < -40) return 'mud';
  const rd = riverDist(x, z);
  if (rd < RIVER_HALF + 2.5) return 'sand';
  if (z < -68) return 'rock';
  return 'ground';
}

/** Water surface height at (x,z) or -Infinity if dry. */
export function waterHeight(x, z) {
  const rd = riverDist(x, z);
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  if (rd < RIVER_HALF + BANK + 1 || pd < POOL.r + 4) return WORLD.waterLevel;
  // Cliff-top stream feeding the waterfall.
  if (z < -74 && Math.abs(x) < 4.5) return WORLD.cliffTop - 0.4;
  return -Infinity;
}

/** Splat weights (grass, dirt, mud, rock) for terrain shading. */
export function terrainSplat(x, z, h, ny) {
  let grass = 1, dirt = 0, mud = 0, rock = 0;
  const n = fbm2(x * 0.04, z * 0.04, 3);
  dirt = clamp(0.25 + n * 0.8, 0, 1);
  const rd = riverDist(x, z);
  const bank = smoothstep(RIVER_HALF + 4, RIVER_HALF, rd);
  mud = Math.max(mud, bank);
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  mud = Math.max(mud, smoothstep(POOL.r + 4, POOL.r, pd));
  const md = mudInfo(x, z);
  if (x < -40) mud = Math.max(mud, smoothstep(5.5, 3, md.d));
  rock = smoothstep(0.82, 0.6, ny);
  grass *= 1 - mud;
  dirt *= 1 - mud;
  grass *= 1 - rock;
  dirt *= 1 - rock;
  mud *= 1 - rock;
  if (h < -1.5) { rock = Math.max(rock, 0.4); }
  return [grass, dirt, mud, rock];
}
