// Procedural texture generation on 2D canvases (all tileable). Each texture
// generator produces an albedo canvas and a height field that is turned into
// a normal map, so materials get convincing surface relief without any
// external image assets.
import * as THREE from 'three';
import { rng, clamp, lerp, smoothstep } from '../core/math.js';

// ------------------------------------------------------------ tileable noise
class TileNoise {
  constructor(period, seed) {
    this.p = period;
    const r = rng(seed);
    this.v = new Float32Array(period * period);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r() * 2 - 1;
  }
  sample(x, y) {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = this.v[y0 * p + x0], b = this.v[y0 * p + x1], c = this.v[y1 * p + x0], d = this.v[y1 * p + x1];
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  }
}

/** Tileable fBm over [0,1)^2 with base frequency `freq` cells. */
function makeFbm(freq, octaves, seed) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(new TileNoise(freq << o, seed + o * 101));
  return (u, v) => {
    let s = 0, a = 1, n = 0;
    for (let o = 0; o < octaves; o++) {
      const f = freq << o;
      s += layers[o].sample(u * f, v * f) * a;
      n += a;
      a *= 0.5;
    }
    return s / n;
  };
}

// Voronoi (tileable) returning distance to nearest and second nearest.
function makeVoronoi(cells, seed, cellsY = cells, stretch = 1) {
  const r = rng(seed);
  const pts = [];
  const cx = cells, cy = cellsY;
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) pts.push([(i + r()) / cx, (j + r()) / cy, r()]);
  return (u, v) => {
    const ci = Math.floor(u * cx), cj = Math.floor(v * cy);
    let d1 = 9, d2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + cx) % cx, jj = (cj + dj + cy) % cy;
      const p = pts[jj * cx + ii];
      const px = p[0] + Math.floor((ci + di) / cx), py = p[1] + Math.floor((cj + dj) / cy);
      const d = Math.hypot((u - px) * cx, (v - py) * cx * stretch);
      if (d < d1) { d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
    }
    return [d1, d2, id];
  };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Fill a canvas from a per-pixel function returning [r,g,b,(a)] in 0..1 and a height. */
function paint(size, fn) {
  const col = canvas(size);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const out = [0, 0, 0, 1, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[3] = 1;
      fn(x / size, y / size, out);
      const i = (y * size + x) * 4;
      img.data[i] = clamp(out[0], 0, 1) * 255;
      img.data[i + 1] = clamp(out[1], 0, 1) * 255;
      img.data[i + 2] = clamp(out[2], 0, 1) * 255;
      img.data[i + 3] = clamp(out[3], 0, 1) * 255;
      height[y * size + x] = out[4];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: col, height, size };
}

function normalFromHeight(height, size, strength = 2) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function pair(result, strength) {
  return { map: tex(result.canvas), normalMap: tex(normalFromHeight(result.height, result.size, strength), { srgb: false }) };
}

// ------------------------------------------------------------ generators
function barkTex(size) {
  // Furrowed bark: vertically elongated plates separated by deep, wandering furrows.
  const n1 = makeFbm(4, 5, 11);
  const n2 = makeFbm(16, 3, 12);
  const n3 = makeFbm(2, 3, 13);
  const vor = makeVoronoi(9, 14, 3, 0.35);
  const vor2 = makeVoronoi(18, 15, 5, 0.4);
  return paint(size, (u, v, o) => {
    const wu = u + n1(u, v) * 0.025;
    const [a1, a2, id] = vor(wu, v);
    const [b1, b2] = vor2(wu + 0.5, v);
    const plate = smoothstep(0.0, 0.22, a2 - a1);
    const sub = smoothstep(0.0, 0.18, b2 - b1);
    const fiber = n2(u * 1, v * 0.2) * 0.5 + 0.5;
    // Long vertical ridges, irregular and wandering.
    const warp = n1(u, v) * 0.55 + n3(u, v * 0.5) * 0.35;
    const ridge = 1 - Math.pow(Math.abs(Math.sin((u * 7 + warp * 1.6) * Math.PI * 2)), 0.6);
    const h = ridge * 0.4 + plate * 0.35 + sub * 0.1 + fiber * 0.15 + n1(u, v) * 0.08;
    const tint = n3(u, v) * 0.5 + 0.5;
    const base = 0.15 + ridge * 0.09 + plate * 0.08 + sub * 0.03 + fiber * 0.04 + id * 0.02;
    o[0] = base * (1.05 + tint * 0.05);
    o[1] = base * (0.9 + tint * 0.04);
    o[2] = base * 0.7;
    // Lichen and green algae streaks on the plates.
    const lich = smoothstep(0.62, 0.8, n2(u * 2 + 0.3, v * 2)) * plate;
    o[0] = lerp(o[0], 0.5, lich * 0.4); o[1] = lerp(o[1], 0.54, lich * 0.4); o[2] = lerp(o[2], 0.42, lich * 0.4);
    const alg = smoothstep(0.35, 0.75, n3(u + 0.4, v * 0.6)) * (1 - plate * 0.5);
    o[0] = lerp(o[0], 0.12, alg * 0.35); o[1] = lerp(o[1], 0.2, alg * 0.35); o[2] = lerp(o[2], 0.07, alg * 0.35);
    o[4] = h;
  });
}

function mossTex(size) {
  const n1 = makeFbm(8, 5, 21);
  const n2 = makeFbm(32, 2, 22);
  const n3 = makeFbm(3, 3, 23);
  return paint(size, (u, v, o) => {
    const clump = n1(u, v) * 0.7 + n3(u, v) * 0.5;
    const fine = n2(u, v);
    const h = clump * 0.6 + fine * 0.4;
    const b = 0.5 + h * 0.5;
    o[0] = (0.16 + clump * 0.05) * b + 0.02;
    o[1] = (0.34 + clump * 0.08 + fine * 0.05) * b + 0.03;
    o[2] = (0.07 + fine * 0.02) * b;
    const yellow = smoothstep(0.2, 0.6, n3(u + 0.5, v));
    o[0] += yellow * 0.06; o[1] += yellow * 0.04;
    o[4] = h;
  });
}

function stoneBlocksTex(size) {
  const n1 = makeFbm(8, 5, 31);
  const n2 = makeFbm(24, 3, 32);
  const r = rng(33);
  const rows = 4;
  const offs = Array.from({ length: rows }, () => r());
  const shades = Array.from({ length: 64 }, () => r());
  return paint(size, (u, v, o) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const cols = 2;
    const uu = u * cols + offs[row] + (row % 2) * 0.5;
    const col = Math.floor(uu);
    const fu = uu - col;
    const shade = shades[(row * 8 + ((col % 8) + 8) % 8) % 64];
    const edge = Math.min(fu, 1 - fu, (fv) * 0.5 * cols, (1 - fv) * 0.5 * cols);
    const mortar = smoothstep(0.0, 0.05, edge);
    const bevel = smoothstep(0.0, 0.12, edge);
    const nn = n1(u, v);
    const crack = smoothstep(0.03, 0.0, Math.abs(n2(u, v) * 0.6 + n1(u * 2, v * 2) * 0.3));
    const base = 0.42 + shade * 0.12 + nn * 0.1;
    o[0] = base * 0.98; o[1] = base * 0.95; o[2] = base * 0.86;
    // Moss in mortar.
    const m = (1 - mortar) * smoothstep(-0.2, 0.3, n1(u * 2 + 1, v * 2));
    o[0] = lerp(o[0] * (0.5 + 0.5 * mortar), 0.16, m * 0.8);
    o[1] = lerp(o[1] * (0.5 + 0.5 * mortar), 0.27, m * 0.8);
    o[2] = lerp(o[2] * (0.5 + 0.5 * mortar), 0.08, m * 0.8);
    o[0] *= 1 - crack * 0.5; o[1] *= 1 - crack * 0.5; o[2] *= 1 - crack * 0.5;
    o[4] = bevel * 0.8 + nn * 0.2 - crack * 0.3;
  });
}

function rockTex(size) {
  // Weathered stone with sedimentary strata, sparse cracks and pitting.
  const n1 = makeFbm(4, 6, 41);
  const n2 = makeFbm(16, 3, 42);
  const n3 = makeFbm(2, 3, 44);
  const vor = makeVoronoi(5, 43, 5, 0.6);
  return paint(size, (u, v, o) => {
    const nn = n1(u, v), fine = n2(u, v), big = n3(u, v);
    const warp = nn * 0.9 + big * 0.6;
    const strata = Math.sin((v * 9 + warp) * Math.PI * 2);
    const layer = smoothstep(0.75, 1.0, Math.abs(strata));
    const band = Math.sin((v * 3 + big) * Math.PI * 2) * 0.5 + 0.5;
    const [d1, d2] = vor(u + nn * 0.05, v);
    const crack = smoothstep(0.05, 0.0, d2 - d1) * smoothstep(-0.1, 0.3, fine);
    const pit = smoothstep(0.35, 0.6, fine) * 0.3;
    const h = 0.55 + nn * 0.35 - layer * 0.25 - crack * 0.45 - pit * 0.3 + band * 0.1;
    const base = 0.32 + nn * 0.1 + band * 0.07 + fine * 0.04;
    o[0] = base * 1.0 - layer * 0.05; o[1] = base * 0.95 - layer * 0.05; o[2] = base * 0.84 - layer * 0.04;
    o[0] *= 1 - crack * 0.45; o[1] *= 1 - crack * 0.45; o[2] *= 1 - crack * 0.42;
    // Warm iron staining.
    const stain = smoothstep(0.2, 0.6, big + fine * 0.3) * 0.18;
    o[0] += stain * 0.12; o[1] += stain * 0.05;
    o[4] = h;
  });
}

function planksTex(size) {
  const n1 = makeFbm(4, 4, 51);
  const n2 = makeFbm(32, 2, 52);
  const r = rng(53);
  const boards = 5;
  const tones = Array.from({ length: boards * 4 }, () => r());
  const offs = Array.from({ length: boards }, () => r());
  return paint(size, (u, v, o) => {
    const b = Math.floor(v * boards);
    const fv = v * boards - b;
    const seg = Math.floor(u * 2 + offs[b]);
    const fu = u * 2 + offs[b] - seg;
    const tone = tones[(b * 4 + (seg & 3)) % tones.length];
    const grain = Math.sin((v * boards * 6 + n1(u, v) * 4 + n2(u, v) * 0.6) * Math.PI * 2) * 0.5 + 0.5;
    const edge = Math.min(fv, 1 - fv) * 6;
    const gap = smoothstep(0.0, 0.25, edge) * smoothstep(0.0, 0.02, Math.min(fu, 1 - fu));
    const base = 0.32 + tone * 0.12 + grain * 0.06;
    o[0] = base * 1.0; o[1] = base * 0.78; o[2] = base * 0.55;
    o[0] *= 0.35 + 0.65 * gap; o[1] *= 0.35 + 0.65 * gap; o[2] *= 0.35 + 0.65 * gap;
    // Nails.
    const nail = Math.hypot((fu - 0.06) * 4, (fv - 0.5)) < 0.06 || Math.hypot((fu - 0.94) * 4, (fv - 0.5)) < 0.06;
    if (nail) { o[0] = 0.2; o[1] = 0.18; o[2] = 0.16; }
    // Weathering.
    const w = smoothstep(0.2, 0.7, n1(u * 2, v * 2));
    o[0] = lerp(o[0], 0.36, w * 0.25); o[1] = lerp(o[1], 0.34, w * 0.25); o[2] = lerp(o[2], 0.3, w * 0.25);
    o[4] = gap * 0.6 + grain * 0.2;
  });
}

function thatchTex(size) {
  const n1 = makeFbm(4, 4, 61);
  const r = rng(62);
  // Pre-draw straw strands into a height buffer.
  const height = new Float32Array(size * size);
  const colr = new Float32Array(size * size);
  for (let i = 0; i < 2600; i++) {
    const x0 = r() * size, y0 = r() * size;
    const len = 30 + r() * 60;
    const ang = Math.PI / 2 + (r() - 0.5) * 0.35;
    const tone = r();
    for (let k = 0; k < len; k++) {
      const x = Math.floor(x0 + Math.cos(ang) * k + size) % size;
      const y = Math.floor(y0 + Math.sin(ang) * k + size) % size;
      const idx = y * size + x;
      height[idx] = Math.max(height[idx], 0.5 + tone * 0.5);
      colr[idx] = tone;
      const idx2 = y * size + ((x + 1) % size);
      height[idx2] = Math.max(height[idx2], 0.3 + tone * 0.3);
    }
  }
  return paint(size, (u, v, o) => {
    const x = Math.floor(u * size), y = Math.floor(v * size);
    const h = height[y * size + x];
    const t = colr[y * size + x];
    const band = smoothstep(0.0, 0.15, (v * 6) % 1) * 0.3 + 0.7;
    const nn = n1(u, v);
    const base = (0.25 + h * 0.35 + nn * 0.08) * band;
    o[0] = base * (0.95 + t * 0.1); o[1] = base * (0.8 + t * 0.08); o[2] = base * 0.48;
    o[4] = h * band;
  });
}

function ropeTex(size) {
  return paint(size, (u, v, o) => {
    const s = Math.sin((u * 6 + v * 3) * Math.PI * 2) * 0.5 + 0.5;
    const s2 = Math.sin((u * 30 + v * 15) * Math.PI * 2) * 0.5 + 0.5;
    const h = s * 0.8 + s2 * 0.2;
    const base = 0.3 + h * 0.25;
    o[0] = base * 1.0; o[1] = base * 0.85; o[2] = base * 0.6;
    o[4] = h;
  });
}

function vineTex(size) {
  const n1 = makeFbm(4, 3, 71);
  return paint(size, (u, v, o) => {
    const s = Math.sin((u * 4 + v * 2 + n1(u, v) * 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const base = 0.18 + s * 0.12;
    o[0] = base * 0.75; o[1] = base * 1.15 + 0.05; o[2] = base * 0.4;
    o[4] = s;
  });
}

function groundTex(size, kind) {
  const n1 = makeFbm(4, 5, kind === 'grass' ? 81 : kind === 'dirt' ? 82 : 83);
  const n2 = makeFbm(32, 3, 84);
  const n3 = makeFbm(12, 3, 86);
  const res = paint(size, (u, v, o) => {
    const nn = n1(u, v), fine = n2(u, v), mid = n3(u, v);
    if (kind === 'grass') {
      // Mossy forest floor: patches of moss over dark soil.
      const moss = smoothstep(-0.25, 0.25, nn + mid * 0.5);
      const g = 0.55 + fine * 0.3 + mid * 0.15;
      const sr = 0.2 * g, sg = 0.15 * g, sb = 0.09 * g; // soil
      const mr = 0.17 * g + 0.02, mg = 0.29 * g + 0.04, mb = 0.07 * g; // moss
      o[0] = lerp(sr, mr, moss); o[1] = lerp(sg, mg, moss); o[2] = lerp(sb, mb, moss);
      o[4] = nn * 0.3 + fine * 0.4 + moss * 0.3;
    } else if (kind === 'dirt') {
      const b = 0.55 + nn * 0.25 + fine * 0.2 + mid * 0.1;
      o[0] = 0.3 * b; o[1] = 0.22 * b; o[2] = 0.14 * b;
      o[4] = nn * 0.4 + fine * 0.4 + mid * 0.2;
    } else {
      // Wet mud.
      const b = 0.5 + nn * 0.4 + fine * 0.1;
      o[0] = 0.24 * b; o[1] = 0.17 * b; o[2] = 0.1 * b;
      const puddle = smoothstep(0.1, 0.3, nn);
      o[0] *= 1 - puddle * 0.3; o[1] *= 1 - puddle * 0.3; o[2] *= 1 - puddle * 0.25;
      o[4] = nn * 0.6 + fine * 0.15;
    }
  });
  if (kind !== 'mud') {
    // Leaf litter and twigs drawn on top (wrapped so the texture still tiles).
    const ctx = res.canvas.getContext('2d');
    const R = rng(kind === 'grass' ? 501 : 502);
    const count = kind === 'grass' ? 170 : 90;
    for (let i = 0; i < count; i++) {
      const x = R() * size, y = R() * size;
      const len = size * (0.012 + R() * 0.02), wid = len * (0.35 + R() * 0.2);
      const ang = R() * Math.PI * 2;
      const t = R();
      const col = t < 0.5 ? `rgba(${90 + R() * 50},${60 + R() * 30},${25 + R() * 15},0.85)` : `rgba(${60 + R() * 30},${55 + R() * 25},${22},0.8)`;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
        if (x + dx < -len || x + dx > size + len || y + dy < -len || y + dy > size + len) continue;
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(ang);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(40,25,10,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.restore();
      }
    }
    // Twigs.
    ctx.strokeStyle = 'rgba(50,35,20,0.7)';
    for (let i = 0; i < 40; i++) {
      const x = R() * size, y = R() * size, l = size * (0.02 + R() * 0.05), a = R() * Math.PI;
      ctx.lineWidth = 1 + R() * 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  }
  return res;
}

/** Leaf atlas: 2x2 tiles of different jungle foliage cards (with alpha). */
function leafAtlas(size) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const half = size / 2;
  const r = rng(91);
  const drawLeaf = (cx, cy, len, wid, ang, color, vein = true) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const grd = ctx.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, shade(color, -0.25));
    grd.addColorStop(0.6, color);
    grd.addColorStop(1, shade(color, 0.12));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.9, len, 0);
    ctx.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.3, wid, 0, 0);
    ctx.fill();
    if (vein) {
      ctx.strokeStyle = shade(color, 0.25);
      ctx.lineWidth = Math.max(1, wid * 0.08);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
      ctx.lineWidth = Math.max(0.5, wid * 0.03);
      for (let k = 1; k < 7; k++) {
        const x = len * k / 7.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + len * 0.08, -wid * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + len * 0.08, wid * 0.6); ctx.stroke();
      }
    }
    ctx.restore();
  };
  const greens = ['#3f6b22', '#4d7a28', '#36601e', '#5a8a2e', '#2f5419', '#46752a'];
  // Tile 0 (top-left): broad leaf cluster.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, half, half); ctx.clip();
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * half * 0.28;
    drawLeaf(half / 2 + Math.cos(a) * d, half / 2 + Math.sin(a) * d, half * (0.22 + r() * 0.16), half * (0.07 + r() * 0.04), a + (r() - 0.5) * 0.8, greens[i % greens.length]);
  }
  ctx.restore();
  // Tile 1 (top-right): fern frond.
  ctx.save();
  ctx.beginPath(); ctx.rect(half, 0, half, half); ctx.clip();
  {
    const x0 = half + half * 0.5, y0 = half * 0.96;
    ctx.strokeStyle = '#3a5a1c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + half * 0.05, half * 0.5, x0 - half * 0.02, half * 0.04); ctx.stroke();
    for (let k = 0; k < 22; k++) {
      const t = k / 22;
      const y = y0 - t * half * 0.9;
      const l = half * 0.42 * Math.sin((1 - t * 0.85) * Math.PI * 0.5) * (1 - t * 0.5);
      drawLeaf(x0, y, l, half * 0.022, -0.35 - t * 0.3, greens[(k + 1) % 6], false);
      drawLeaf(x0, y, l, half * 0.022, Math.PI + 0.35 + t * 0.3, greens[k % 6], false);
    }
  }
  ctx.restore();
  // Tile 2 (bottom-left): monstera / big tropical leaf.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, half, half, half); ctx.clip();
  {
    const cx = half * 0.5, cy = half * 1.5;
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    const len = half * 0.9, wid = half * 0.36;
    const grd = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
    grd.addColorStop(0, '#2d5418'); grd.addColorStop(1, '#4f8a2a');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.bezierCurveTo(-len * 0.3, -wid * 1.3, len * 0.3, -wid * 1.2, len / 2, 0);
    ctx.bezierCurveTo(len * 0.3, wid * 1.2, -len * 0.3, wid * 1.3, -len / 2, 0);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 6; k++) {
      const x = -len * 0.32 + k * len * 0.14;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + len * 0.04, s * wid * 0.75, len * 0.025, wid * 0.42, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#6a9a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
  }
  ctx.restore();
  // Tile 3 (bottom-right): grass / reed tuft.
  ctx.save();
  ctx.beginPath(); ctx.rect(half, half, half, half); ctx.clip();
  for (let i = 0; i < 70; i++) {
    const x = half + half * (0.15 + r() * 0.7);
    const h = half * (0.4 + r() * 0.55);
    const bend = (r() - 0.5) * half * 0.35;
    const w = 2 + r() * 4;
    ctx.fillStyle = greens[i % 6];
    ctx.beginPath();
    ctx.moveTo(x - w, half * 2);
    ctx.quadraticCurveTo(x + bend * 0.3, half * 2 - h * 0.5, x + bend, half * 2 - h);
    ctx.quadraticCurveTo(x + bend * 0.3 + w * 0.3, half * 2 - h * 0.5, x + w, half * 2);
    ctx.fill();
  }
  ctx.restore();
  const t = tex(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt > 0) c.lerp(new THREE.Color(1, 1, 0.8), amt);
  else c.multiplyScalar(1 + amt);
  return '#' + c.getHexString();
}

/** Carved stone face relief (temple pillars). */
function carvedFaceTex(size) {
  const n1 = makeFbm(8, 4, 101);
  const hc = canvas(size);
  const ctx = hc.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const s = size;
  const g = (v) => `rgb(${v},${v},${v})`;
  // Frame.
  ctx.strokeStyle = g(60); ctx.lineWidth = s * 0.035;
  ctx.strokeRect(s * 0.08, s * 0.06, s * 0.84, s * 0.88);
  // Brow.
  ctx.fillStyle = g(175);
  ctx.fillRect(s * 0.18, s * 0.24, s * 0.64, s * 0.09);
  // Eyes.
  ctx.fillStyle = g(40);
  for (const ex of [0.33, 0.67]) {
    ctx.beginPath(); ctx.ellipse(s * ex, s * 0.4, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = g(150);
  for (const ex of [0.33, 0.67]) {
    ctx.beginPath(); ctx.arc(s * ex, s * 0.4, s * 0.025, 0, Math.PI * 2); ctx.fill();
  }
  // Nose.
  ctx.fillStyle = g(190);
  ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.38); ctx.lineTo(s * 0.42, s * 0.6); ctx.lineTo(s * 0.58, s * 0.6); ctx.closePath(); ctx.fill();
  // Mouth.
  ctx.fillStyle = g(45);
  ctx.fillRect(s * 0.3, s * 0.7, s * 0.4, s * 0.06);
  ctx.fillStyle = g(170);
  for (let k = 0; k < 6; k++) ctx.fillRect(s * (0.32 + k * 0.065), s * 0.7, s * 0.035, s * 0.03);
  // Ears/side spirals.
  ctx.strokeStyle = g(170); ctx.lineWidth = s * 0.02;
  for (const ex of [0.14, 0.86]) {
    ctx.beginPath(); ctx.arc(s * ex, s * 0.48, s * 0.05, 0, Math.PI * 1.7); ctx.stroke();
  }
  ctx.filter = 'blur(2px)';
  ctx.drawImage(hc, 0, 0);
  ctx.filter = 'none';
  const hdata = ctx.getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) height[i] = hdata[i * 4] / 255;
  const stone = stoneBlocksTex(size);
  const res = paint(size, (u, v, o) => {
    const x = Math.floor(u * size), y = Math.floor(v * size);
    const h = height[y * size + x];
    const nn = n1(u, v);
    const base = 0.38 + nn * 0.1 + (h - 0.5) * 0.3;
    o[0] = base * 0.98; o[1] = base * 0.95; o[2] = base * 0.85;
    const cav = smoothstep(0.35, 0.15, h);
    const m = cav * smoothstep(-0.3, 0.2, n1(u * 2, v * 2));
    o[0] = lerp(o[0], 0.14, m * 0.7); o[1] = lerp(o[1], 0.24, m * 0.7); o[2] = lerp(o[2], 0.07, m * 0.7);
    o[4] = h + nn * 0.08;
  });
  void stone;
  return res;
}

function waterNormalTex(size) {
  const n1 = makeFbm(6, 4, 111);
  const n2 = makeFbm(12, 3, 112);
  const res = paint(size, (u, v, o) => {
    const h = n1(u, v) * 0.7 + n2(u, v) * 0.3;
    o[0] = o[1] = o[2] = 0.5 + h * 0.5;
    o[4] = h;
  });
  return tex(normalFromHeight(res.height, size, 5), { srgb: false });
}

function noiseTex(size) {
  const n1 = makeFbm(4, 5, 121);
  const n2 = makeFbm(8, 4, 122);
  const res = paint(size, (u, v, o) => {
    o[0] = 0.5 + n1(u, v) * 0.6;
    o[1] = 0.5 + n2(u, v) * 0.6;
    o[2] = 0.5 + n1(u + 0.37, v + 0.21) * 0.6;
    o[4] = 0;
  });
  return tex(res.canvas, { srgb: false });
}

function glowTex(size) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = tex(c, { repeat: false });
  return t;
}

function smokeTex(size) {
  const n1 = makeFbm(4, 5, 131);
  const res = paint(size, (u, v, o) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = smoothstep(1, 0.2, d) * (0.6 + n1(u, v) * 0.8);
    o[0] = o[1] = o[2] = 1;
    o[3] = clamp(a, 0, 1);
    o[4] = 0;
  });
  return tex(res.canvas, { repeat: false });
}

function shaftTex(w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const r = rng(141);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    const x = r() * w;
    const bw = 4 + r() * w * 0.12;
    const g = ctx.createLinearGradient(x - bw, 0, x + bw, 0);
    const a = 0.15 + r() * 0.35;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - bw, 0, bw * 2, h);
  }
  // Fade top & bottom.
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.15, 'rgba(0,0,0,0)');
  fade.addColorStop(0.7, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  return tex(c, { repeat: false, srgb: true });
}

function skinTex(size) {
  const n1 = makeFbm(16, 3, 151);
  const res = paint(size, (u, v, o) => {
    const nn = n1(u, v);
    o[0] = 0.7 + nn * 0.04; o[1] = 0.53 + nn * 0.035; o[2] = 0.42 + nn * 0.03;
    o[4] = nn;
  });
  return pair(res, 0.6);
}

function clothTex(size) {
  const n1 = makeFbm(8, 4, 161);
  const n2 = makeFbm(64, 2, 162);
  const res = paint(size, (u, v, o) => {
    const nn = n1(u, v), fine = n2(u, v);
    const fur = 0.5 + fine * 0.5;
    const base = 0.48 + nn * 0.1;
    o[0] = base * 1.05 * fur + 0.08; o[1] = base * 0.74 * fur + 0.04; o[2] = base * 0.45 * fur + 0.01;
    // stripes like an animal hide
    const stripe = smoothstep(0.2, 0.4, Math.sin((u * 6 + nn * 2) * Math.PI * 2) * 0.5 + 0.5);
    o[0] *= 1 - stripe * 0.25; o[1] *= 1 - stripe * 0.25; o[2] *= 1 - stripe * 0.2;
    o[4] = fine * 0.6 + nn * 0.3;
  });
  return pair(res, 1.5);
}

let CACHE = null;

/** Build (once) and return all textures. `quality` scales resolution. */
export function getTextures(quality = 'high') {
  if (CACHE) return CACHE;
  const S = quality === 'low' ? 256 : 512;
  const t0 = performance.now();
  const bark = pair(barkTex(S), 3);
  const moss = pair(mossTex(S), 2);
  const stone = pair(stoneBlocksTex(S), 3);
  const rock = pair(rockTex(S), 3);
  const planks = pair(planksTex(S), 2.5);
  const thatch = pair(thatchTex(S), 2.5);
  const rope = pair(ropeTex(128), 2);
  const vine = pair(vineTex(128), 2);
  const grass = pair(groundTex(S, 'grass'), 2);
  const dirt = pair(groundTex(S, 'dirt'), 2);
  const mud = pair(groundTex(S, 'mud'), 1.5);
  const face = pair(carvedFaceTex(S), 5);
  const leaves = leafAtlas(quality === 'low' ? 512 : 1024);
  const waterNormal = waterNormalTex(256);
  const noise = noiseTex(256);
  const glow = glowTex(128);
  const smoke = smokeTex(128);
  const shaft = shaftTex(256, 512);
  const skin = skinTex(256);
  const cloth = clothTex(256);
  CACHE = { bark, moss, stone, rock, planks, thatch, rope, vine, grass, dirt, mud, face, leaves, waterNormal, noise, glow, smoke, shaft, skin, cloth };
  CACHE.buildMs = performance.now() - t0;
  return CACHE;
}
