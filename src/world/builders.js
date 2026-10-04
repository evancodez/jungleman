// Level building blocks. Each builder registers colliders/rails/vines for
// gameplay and (when ctx.visual) pushes world-space geometry for rendering.
import * as THREE from 'three';
import { BoxCollider, CylinderCollider, CapsuleCollider, SphereCollider } from '../physics/world.js';
import { Rail } from '../physics/rails.js';
import { Vine } from '../physics/vines.js';
import { rng, clamp, lerp, noise3 } from '../core/math.js';
import { boxGeo, taperedTube, trunkGeo, rockGeo, applyAO, tint, sagPoints } from './geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function createContext(world, rails, vines, visual) {
  return {
    world, rails, vines, visual,
    geo: {},
    inst: {}, // kind -> array of Matrix4
    torches: [],
    shafts: [],
    collectibles: [],
    gaps: [],
    bounceVisuals: [],
    waterfalls: [],
    decoVines: [],
    labels: [],
    r: rng(4242),
  };
}

export function addGeo(ctx, mat, g) {
  if (!ctx.visual) return;
  (ctx.geo[mat] ||= []).push(g);
}

export function addInst(ctx, kind, pos, scale, rotY = 0, tilt = 0) {
  if (!ctx.visual) return;
  _q.setFromEuler(new THREE.Euler(tilt * (ctx.r() - 0.5), rotY, tilt * (ctx.r() - 0.5)));
  _s.set(scale, scale, scale);
  if (Array.isArray(scale)) _s.set(scale[0], scale[1], scale[2]);
  (ctx.inst[kind] ||= []).push(new THREE.Matrix4().compose(pos.clone ? pos.clone() : V(pos[0], pos[1], pos[2]), _q.clone(), _s.clone()));
}

const groundAO = (base = 0, strength = 0.55, range = 3) => (x, y) => 1 - strength * Math.exp(-Math.max(0, y - base) / range);

// ---------------------------------------------------------------- trees
/**
 * Tree with climbable trunk, buttress roots and a leafy crown.
 * opts: {x, z, y0, height, r, rTop, crownY, crownR, roots, climbable, leaves, seed}
 */
export function tree(ctx, o) {
  const y0 = o.y0 ?? -1.5;
  const y1 = y0 + o.height;
  const r = o.r, rTop = o.rTop ?? r * 0.65;
  const seed = o.seed ?? Math.floor(o.x * 13 + o.z * 7);
  const col = new CylinderCollider(o.x, o.z, (r + rTop) * 0.5 + 0.05, y0 - 2, y1 - (o.crownTrim ?? 2), 'bark', { climbable: o.climbable !== false, name: o.name || 'tree' });
  ctx.world.add(col);
  if (ctx.visual) {
    const g = trunkGeo(o.x, o.z, y0, y1, r, rTop, { seed, buttress: o.buttress ?? r * 0.9, nButtress: o.nButtress ?? 5, radial: r > 2 ? 28 : 16 });
    applyAO(g, groundAO(y0 + 1.5, 0.6, 3.5));
    addGeo(ctx, 'bark', g);
  }
  // Big surface roots (walkable ramps).
  const nRoots = o.roots ?? 0;
  const R = rng(seed);
  for (let i = 0; i < nRoots; i++) {
    const a = (i / nRoots) * Math.PI * 2 + R() * 0.6;
    const len = r * 1.6 + R() * r;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [
      V(o.x + ca * r * 0.7, y0 + 2.6 + R(), o.z + sa * r * 0.7),
      V(o.x + ca * (r + len * 0.35), y0 + 2.2, o.z + sa * (r + len * 0.35)),
      V(o.x + ca * (r + len), y0 + 0.4, o.z + sa * (r + len)),
    ];
    branch(ctx, pts, { r0: 0.75, r1: 0.35, grind: false, leaves: false, kind: 'root', mat: 'bark' });
  }
  // Crown.
  const crownY = o.crownY ?? y1 - 2;
  const crownR = o.crownR ?? r * 3;
  // A few visual limbs reaching into the crown so trees don't read as bare poles.
  if (o.limbs && ctx.visual) {
    const nl = o.limbs;
    for (let i = 0; i < nl; i++) {
      const a = R() * Math.PI * 2;
      const y = crownY - 2 - R() * Math.min(6, o.height * 0.25);
      const len = crownR * (0.55 + R() * 0.35);
      const ca = Math.cos(a), sa = Math.sin(a);
      const p0 = V(o.x + ca * rTop * 0.6, y, o.z + sa * rTop * 0.6);
      const p1 = V(o.x + ca * len * 0.5, y + len * 0.35, o.z + sa * len * 0.5);
      const p2 = V(o.x + ca * len, y + len * 0.45 + R(), o.z + sa * len);
      branch(ctx, [p0, p1, p2], { r0: rTop * 0.55, r1: rTop * 0.18, walk: false, grind: false, leaves: true, hangers: false, leafRange: [0.5, 1] });
    }
  }
  if (o.leaves !== false) crown(ctx, V(o.x, crownY, o.z), crownR, seed, o.crownDensity ?? 1);
  return col;
}

export function crown(ctx, c, radius, seed = 0, density = 1) {
  if (!ctx.visual) return;
  const R = rng(seed + 99);
  const n = Math.floor(radius * radius * 1.4 * density + 8);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * radius;
    const y = (R() - 0.35) * radius * 0.5 * (1 - d / radius * 0.5);
    const p = V(c.x + Math.cos(a) * d, c.y + y, c.z + Math.sin(a) * d);
    addInst(ctx, 'leafCluster', p, 3.2 + R() * 2.6, R() * 6.28, 0.6);
  }
  // Some hanging lianas from the crown.
  const nh = Math.floor(radius * 0.8 * density);
  for (let i = 0; i < nh; i++) {
    const a = R() * Math.PI * 2;
    const d = (0.4 + R() * 0.6) * radius;
    hangingVine(ctx, V(c.x + Math.cos(a) * d, c.y - 0.5, c.z + Math.sin(a) * d), 4 + R() * 9, seed + i);
  }
}

/** Decorative drooping liana (not grabbable). */
export function hangingVine(ctx, top, len, seed = 0, leaves = true) {
  if (!ctx.visual) return;
  const R = rng(seed + 5);
  const pts = [];
  const n = 6;
  const dx = (R() - 0.5) * 1.2, dz = (R() - 0.5) * 1.2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(top.x + dx * Math.sin(t * 2.5), top.y - t * len, top.z + dz * Math.sin(t * 2.5)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = taperedTube(curve, 8, 4, (t) => lerp(0.06, 0.03, t), { noise: 0.2, seed, uvAround: 1, uvLen: 1 });
  const p = g.attributes.position;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) sway[i] = Math.max(0, (top.y - p.getY(i)) / len) * 1.2;
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  ctx.decoVines.push(g);
  // leaves along
  for (let i = 1; i < n && leaves; i += 1) {
    if (R() < 0.6) addInst(ctx, 'leafSmall', pts[i], 0.9 + R() * 0.8, R() * 6.28, 1.2);
  }
}

// ---------------------------------------------------------------- branches
/**
 * Curved branch along control points. Walkable (capsule colliders) and
 * grindable (rail) by default.
 */
export function branch(ctx, pts, o = {}) {
  const r0 = o.r0 ?? 0.6, r1 = o.r1 ?? 0.3;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  let rail = null;
  if (o.grind !== false) {
    // Rail runs along the top of the branch; trim the ends slightly.
    const rpts = [];
    const m = Math.max(4, Math.ceil(len / 1.5));
    const t0 = o.trimStart ?? 0, t1 = 1 - (o.trimEnd ?? 0);
    for (let i = 0; i <= m; i++) rpts.push(curve.getPointAt(t0 + (t1 - t0) * (i / m)));
    rail = new Rail(rpts, { kind: o.kind === 'root' ? 'log' : o.railKind || 'branch', r0: lerp(r0, r1, t0) * 0.95, r1: lerp(r0, r1, t1) * 0.95, name: o.name });
    ctx.rails.add(rail);
  }
  // Colliders: capsules every ~1.6m.
  if (o.walk !== false) {
    const n = Math.max(1, Math.ceil(len / 1.6));
    for (let i = 0; i < n; i++) {
      const a = curve.getPointAt(i / n), b = curve.getPointAt((i + 1) / n);
      const rr = lerp(r0, r1, (i + 0.5) / n) * 0.96;
      ctx.world.add(new CapsuleCollider(a, b, rr, 'bark', { noMantle: rr < 0.25, data: rail ? { rail } : null }));
    }
  }
  if (ctx.visual) {
    const segs = Math.max(8, Math.ceil(len * 1.5));
    const radial = r0 > 0.6 ? 12 : 8;
    const cut = o.cut ? 'flat' : 'dome';
    const g = taperedTube(curve, segs, radial, (t) => lerp(r0, r1, Math.pow(t, 0.9)), { noise: 0.1, seed: pts[0].x, uvAround: Math.max(1, Math.round(r0 * 3)), uvLen: 2.2, capStart: o.capStart ?? cut, capEnd: o.capEnd ?? cut });
    addGeo(ctx, o.mat || 'branch', g);
    for (const cg of g.userData.caps) addGeo(ctx, 'endGrain', cg);
    if (o.leaves !== false) {
      const R = rng(Math.floor(pts[0].x * 31 + pts[0].z * 17));
      // Leaf clumps along the outer half and at the tip.
      const nl = Math.floor(len / 3);
      const [l0, l1] = o.leafRange || [0.35, 1];
      for (let i = 0; i < nl; i++) {
        const t = l0 + R() * (l1 - l0);
        const p = curve.getPointAt(t);
        const side = R() < 0.5 ? -1 : 1;
        const tn = curve.getTangentAt(t);
        const sideV = V(-tn.z, 0, tn.x).normalize().multiplyScalar(side * (0.6 + R() * 1.4));
        addInst(ctx, 'leafCluster', p.add(sideV).add(V(0, -0.6 - R() * 1.0, 0)), 1.6 + R() * 1.8, R() * 6.28, 0.8);
      }
      const tip = curve.getPointAt(1);
      if (o.tipLeaves !== false) for (let i = 0; i < 3; i++) addInst(ctx, 'leafCluster', tip.clone().add(V((R() - 0.5) * 2, (R() - 0.3) * 1.5, (R() - 0.5) * 2)), 2.2 + R() * 1.6, R() * 6.28, 0.6);
      if (o.hangers !== false) {
        const nh = Math.floor(len / 6);
        for (let i = 0; i < nh; i++) {
          const p = curve.getPointAt(0.25 + R() * 0.7);
          hangingVine(ctx, p.add(V(0, -lerp(r0, r1, 0.5), 0)), 2 + R() * 5, i + Math.floor(p.x));
        }
      }
    }
  }
  return { curve, rail, len };
}

// ---------------------------------------------------------------- boxes / platforms
/**
 * Generic solid box. o: {c:[x,y,z], size:[w,h,d], rotY, rotX, rotZ, mat, tag, tile, wallRun, climbable, ao}
 */
export function solid(ctx, o) {
  const [w, h, d] = o.size;
  const c = V(...o.c);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotX || 0, o.rotY || 0, o.rotZ || 0, 'YXZ'));
  const col = new BoxCollider(c, V(w / 2, h / 2, d / 2), q, o.tag || 'stone', { wallRun: o.wallRun, climbable: o.climbable, noMantle: o.noMantle, noCamera: o.noCamera, bounce: o.bounce });
  if (o.collide !== false) ctx.world.add(col);
  if (ctx.visual && o.visible !== false) {
    const seg = o.rocky ? 1.2 : 4;
    const g = boxGeo(w, h, d, o.tile ?? 2.5, { sx: Math.max(1, Math.round(w / seg)), sy: Math.max(1, Math.round(h / seg)), sz: Math.max(1, Math.round(d / seg)), swapUV: o.swapUV });
    _m.compose(c, q, V(1, 1, 1));
    g.applyMatrix4(_m);
    if (o.rocky) rockyDisplace(g, o.rocky === true ? 0.45 : o.rocky);
    if (o.ao !== false) applyAO(g, groundAO(o.aoBase ?? -0.5, 0.5, 2.5));
    if (o.tint) tint(g, ...o.tint);
    addGeo(ctx, o.mat || 'stone', g);
  }
  return col;
}

/** Crack-free organic displacement (a smooth vector field of world position). */
export function rockyDisplace(g, amp) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.45;
    const dx = noise3(x * k, y * k, z * k) + noise3(x * k * 2.3, y * k * 2.3, z * k * 2.3) * 0.4;
    const dy = noise3(x * k + 7.1, y * k, z * k) * 0.25;
    const dz = noise3(x * k, y * k + 13.7, z * k) + noise3(x * k * 2.3 + 3, y * k * 2.3, z * k * 2.3) * 0.4;
    p.setXYZ(i, x + dx * amp, y + dy * amp, z + dz * amp);
  }
  g.computeVertexNormals();
  return g;
}

/** Wooden deck with support beams. */
export function deck(ctx, o) {
  const [x, y, z] = o.c;
  const [w, d] = o.size;
  const th = o.thick ?? 0.4;
  const col = solid(ctx, { c: [x, y - th / 2, z], size: [w, th, d], rotY: o.rotY || 0, mat: 'planks', tag: 'wood', tile: 2.2, ao: false });
  if (ctx.visual) {
    // Rim beams.
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), o.rotY || 0);
    const beams = [[0, -d / 2, w, 0.35], [0, d / 2, w, 0.35]];
    for (const [bx, bz, bl] of beams) {
      const g = boxGeo(bl + 0.3, 0.45, 0.35, 2);
      g.applyMatrix4(_m.compose(V(bx, -th - 0.1, bz).applyQuaternion(q).add(V(x, y, z)), q, V(1, 1, 1)));
      addGeo(ctx, 'wood', g);
    }
    // Diagonal braces to the trunk / stilts.
    if (o.stilts) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = sx * (w / 2 - 0.4), pz = sz * (d / 2 - 0.4);
        const wp = V(px, 0, pz).applyQuaternion(q).add(V(x, 0, z));
        const top = y - th;
        const bottom = (o.groundY ?? 0) - 1;
        ctx.world.add(new CylinderCollider(wp.x, wp.z, 0.25, bottom, top, 'wood', { climbable: false }));
        const g = new THREE.CylinderGeometry(0.22, 0.28, top - bottom, 8, 1);
        g.translate(wp.x, (top + bottom) / 2, wp.z);
        applyAO(g, groundAO(o.groundY ?? 0, 0.5, 2));
        addGeo(ctx, 'wood', g);
      }
    }
  }
  return col;
}

/** Simple post-and-rope railing segment that is also grindable. */
export function railing(ctx, a, b, o = {}) {
  const h = o.h ?? 1.0;
  const pa = a.clone().add(V(0, h, 0)), pb = b.clone().add(V(0, h, 0));
  const rail = new Rail([pa, pb], { kind: o.kind || 'rail', radius: 0.06 });
  ctx.rails.add(rail);
  if (ctx.visual) {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const g = new THREE.CylinderGeometry(0.07, 0.08, h, 6);
      g.translate(p.x, p.y + h / 2, p.z);
      addGeo(ctx, 'wood', g);
    }
    const curve = new THREE.LineCurve3(pa, pb);
    addGeo(ctx, o.mat || 'wood', taperedTube(curve, 2, 6, () => 0.07, { noise: 0, uvLen: 2 }));
  }
  return rail;
}

// ---------------------------------------------------------------- bridge
export function ropeBridge(ctx, a, b, o = {}) {
  const width = o.width ?? 2.2;
  const sag = o.sag ?? 1.0;
  const dir = V().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const side = V(-dir.z, 0, dir.x).normalize();
  const planks = Math.ceil(len / 0.55);
  const yaw = Math.atan2(dir.x, dir.z);
  // Colliders: piecewise boxes following the sag.
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const p0 = V().lerpVectors(a, b, t0); p0.y -= Math.sin(t0 * Math.PI) * sag;
    const p1 = V().lerpVectors(a, b, t1); p1.y -= Math.sin(t1 * Math.PI) * sag;
    const mid = V().addVectors(p0, p1).multiplyScalar(0.5);
    const l = p0.distanceTo(p1);
    const pitch = Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    ctx.world.add(new BoxCollider(mid.add(V(0, -0.12, 0)), V(width / 2, 0.12, l / 2 + 0.05), q, 'wood', { noCamera: true }));
  }
  // Hand ropes = grind rails.
  const rh = o.ropeH ?? 1.05;
  const ropes = [];
  for (const s of [-1, 1]) {
    const ra = a.clone().addScaledVector(side, s * (width / 2 + 0.05)).add(V(0, rh, 0));
    const rb = b.clone().addScaledVector(side, s * (width / 2 + 0.05)).add(V(0, rh, 0));
    const pts = sagPoints(ra, rb, sag * 0.9, 14);
    const rail = new Rail(pts, { kind: 'rope', radius: 0.05, name: 'Rope Walk' });
    ctx.rails.add(rail);
    ropes.push(pts);
  }
  if (ctx.visual) {
    const R = rng(Math.floor(a.x * 7 + b.z));
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks;
      const p = V().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * sag + 0.06;
      if (R() < 0.04) continue; // missing plank
      const g = boxGeo(width * (0.92 + R() * 0.1), 0.08, 0.42, 1.2);
      const slope = Math.cos(t * Math.PI) * sag * Math.PI / len;
      g.applyMatrix4(_m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(slope, yaw + (R() - 0.5) * 0.06, (R() - 0.5) * 0.04, 'YXZ')), V(1, 1, 1)));
      addGeo(ctx, 'planks', g);
    }
    for (const pts of ropes) {
      addGeo(ctx, 'rope', taperedTube(new THREE.CatmullRomCurve3(pts), 24, 5, () => 0.05, { noise: 0, uvLen: 0.5 }));
      // vertical hangers
      for (let i = 1; i < pts.length - 1; i += 1) {
        const top = pts[i];
        const t = i / (pts.length - 1);
        const bottom = top.clone();
        bottom.y = lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag;
        addGeo(ctx, 'rope', taperedTube(new THREE.LineCurve3(top, bottom), 1, 4, () => 0.025, { noise: 0, uvLen: 0.5 }));
      }
    }
    // under-ropes
    for (const s of [-1, 1]) {
      const pts = sagPoints(a.clone().addScaledVector(side, s * width * 0.45).add(V(0, -0.12, 0)), b.clone().addScaledVector(side, s * width * 0.45).add(V(0, -0.12, 0)), sag, 14);
      addGeo(ctx, 'rope', taperedTube(new THREE.CatmullRomCurve3(pts), 24, 5, () => 0.04, { noise: 0, uvLen: 0.5 }));
    }
  }
}

// ---------------------------------------------------------------- vines / zips
export function vine(ctx, anchor, length, o = {}) {
  const v = new Vine(anchor, length, o);
  ctx.vines.add(v);
  // Leafy knot at the anchor.
  addInst(ctx, 'leafCluster', anchor.clone().add(V(0, 0.4, 0)), 2.4, ctx.r() * 6, 0.5);
  return v;
}

export function zipLine(ctx, a, b, o = {}) {
  const pts = sagPoints(a, b, o.sag ?? 0.6, 16);
  const rail = new Rail(pts, { kind: 'zip', radius: 0.05, oneWay: true, name: o.name || 'Zip Vine' });
  ctx.rails.add(rail);
  if (ctx.visual) {
    addGeo(ctx, 'vine', taperedTube(new THREE.CatmullRomCurve3(pts), 40, 6, () => 0.09, { noise: 0.15, uvLen: 1 }));
    const R = rng(Math.floor(a.x * 3 + b.x));
    for (let i = 1; i < pts.length - 1; i++) if (R() < 0.7) addInst(ctx, 'leafSmall', pts[i].clone().add(V(0, -0.2, 0)), 1 + R(), R() * 6, 1);
  }
  return rail;
}

// ---------------------------------------------------------------- mushrooms
export function mushroom(ctx, o) {
  const { x, z } = o;
  const y0 = o.y0 ?? 0;
  const top = o.top;
  const r = o.r;
  const stemR = o.stemR ?? r * 0.25;
  const bounce = o.bounce ?? 15;
  ctx.world.add(new CylinderCollider(x, z, stemR, y0 - 1, top - 0.6, 'wood', { climbable: false }));
  const cap = new CylinderCollider(x, z, r, top - 0.9, top, 'bounce', { bounce, noMantle: true });
  ctx.world.add(cap);
  if (ctx.visual) {
    const stemH = top - y0 - 0.4;
    const sg = new THREE.CylinderGeometry(stemR * 0.85, stemR * 1.25, stemH + 1, 12, 4);
    sg.translate(x, y0 + (stemH - 1) / 2, z);
    applyAO(sg, groundAO(y0, 0.5, 2));
    const capGroup = { x, z, top, r, meshIndex: ctx.bounceVisuals.length, col: cap };
    // Cap geometry is rendered as a separate animated mesh so it can squash.
    capGroup.stemGeo = sg;
    ctx.bounceVisuals.push(capGroup);
    addGeo(ctx, 'mushroomStem', sg);
    // little mushrooms around base
    const R = rng(Math.floor(x * 11 + z));
    for (let i = 0; i < 4; i++) {
      const a = R() * 6.28, d = stemR + 0.6 + R() * 1.5;
      addInst(ctx, 'smallShroom', V(x + Math.cos(a) * d, y0 - 0.05, z + Math.sin(a) * d), 0.4 + R() * 0.5, R() * 6, 0.3);
    }
  }
  return cap;
}

// ---------------------------------------------------------------- rocks
export function boulder(ctx, x, y, z, s, o = {}) {
  const sx = s * (o.sx ?? 1), sy = s * (o.sy ?? 0.8), sz = s * (o.sz ?? 1);
  if (o.collide !== false) {
    if (o.flatTop) ctx.world.add(new CylinderCollider(x, z, Math.min(sx, sz) * 0.92, y - sy, y + sy * 0.72, 'rock', { climbable: false }));
    else ctx.world.add(new SphereCollider(V(x, y, z), Math.min(sx, sy, sz) * 0.98, 'rock'));
  }
  if (ctx.visual) {
    const g = rockGeo(sx, sy, sz, x * 0.1 + z * 0.3, s > 3 ? 3 : 2);
    g.rotateY(o.rotY ?? x * 0.37);
    g.translate(x, y, z);
    applyAO(g, groundAO(y - sy, 0.45, 1.5));
    addGeo(ctx, 'rock', g);
  }
}

// ---------------------------------------------------------------- torches
export function torch(ctx, pos, o = {}) {
  if (ctx.visual) {
    const h = o.h ?? 1.6;
    const g = new THREE.CylinderGeometry(0.07, 0.1, h, 6);
    g.translate(pos.x, pos.y + h / 2, pos.z);
    addGeo(ctx, 'wood', g);
    const bowl = new THREE.CylinderGeometry(0.28, 0.14, 0.3, 8);
    bowl.translate(pos.x, pos.y + h + 0.1, pos.z);
    addGeo(ctx, 'stone', bowl);
    ctx.torches.push(V(pos.x, pos.y + h + 0.45, pos.z));
  }
}

// ---------------------------------------------------------------- huts
export function hut(ctx, o) {
  const [x, y, z] = o.c; // floor center
  const w = o.w ?? 5, d = o.d ?? 5, wallH = o.wallH ?? 2.6, rot = o.rotY ?? 0;
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rot);
  const local = (lx, ly, lz) => V(lx, ly, lz).applyQuaternion(q).add(V(x, y, z));
  // Walls (with a doorway on +z side).
  const th = 0.25;
  const wall = (lx, lz, lw, ld) => {
    const c = local(lx, wallH / 2, lz);
    solid(ctx, { c: [c.x, c.y, c.z], size: [lw, wallH, ld], rotY: rot, mat: 'planks', tag: 'wood', tile: 2.6, wallRun: false, aoBase: y, swapUV: true });
  };
  wall(0, -d / 2 + th / 2, w, th);
  wall(-w / 2 + th / 2, 0, th, d);
  wall(w / 2 - th / 2, 0, th, d);
  wall(-w / 2 + w * 0.2, d / 2 - th / 2, w * 0.4, th);
  wall(w / 2 - w * 0.2, d / 2 - th / 2, w * 0.4, th);
  // Gable roof: two tilted slabs, ridge along local x.
  const overhang = 0.8;
  const roofRise = o.roofRise ?? 2.2;
  const halfD = d / 2 + overhang;
  const slope = Math.atan2(roofRise, halfD);
  const slabLen = Math.hypot(roofRise, halfD);
  for (const s of [-1, 1]) {
    const c = local(0, wallH + roofRise / 2 + 0.15, s * halfD / 2);
    solid(ctx, { c: [c.x, c.y, c.z], size: [w + overhang * 2, 0.35, slabLen], rotY: rot, rotX: s * slope, mat: 'thatch', tag: 'thatch', tile: 3, ao: false });
  }
  const ra = local(-w / 2 - overhang, wallH + roofRise + 0.3, 0), rb = local(w / 2 + overhang, wallH + roofRise + 0.3, 0);
  const rail = new Rail([ra, rb], { kind: 'roof', radius: 0.12, name: 'Ridge Run' });
  ctx.rails.add(rail);
  if (ctx.visual) {
    addGeo(ctx, 'wood', taperedTube(new THREE.LineCurve3(ra.clone().add(V(0, -0.1, 0)), rb.clone().add(V(0, -0.1, 0))), 2, 6, () => 0.16, { noise: 0 }));
    // A lamp inside the doorway.
    torch(ctx, local(w / 2 - 0.6, 0, d / 2 + 0.5), { h: 1.2 });
  }
  return rail;
}

// ---------------------------------------------------------------- temple pieces
export function pillar(ctx, o) {
  const { x, z } = o;
  const y0 = o.y0 ?? -1;
  const h = o.h;
  const s = o.s ?? 3;
  const top = y0 + h;
  const rot = o.rotY ?? 0;
  solid(ctx, { c: [x, y0 + h / 2, z], size: [s, h, s], rotY: rot, mat: 'stone', tag: 'stone', tile: 3, wallRun: true, aoBase: y0 + 1 });
  // Cap slab.
  solid(ctx, { c: [x, top + 0.25, z], size: [s + 0.6, 0.5, s + 0.6], rotY: rot, mat: 'stone', tag: 'stone', tile: 3 });
  if (ctx.visual) {
    // Carved face panel on two sides near the top.
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rot);
    for (const side of o.faces ?? [0, 2]) {
      const a = side * Math.PI / 2;
      const n = V(Math.sin(a), 0, Math.cos(a)).applyQuaternion(q);
      const g = new THREE.PlaneGeometry(s * 0.92, s * 1.15);
      const fq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
      g.applyMatrix4(_m.compose(V(x, top - s * 0.75, z).addScaledVector(n, s / 2 + 0.02), fq, V(1, 1, 1)));
      addGeo(ctx, 'face', g);
    }
  }
  return top + 0.5;
}

export function stairs(ctx, o) {
  // o: {from:[x,y,z], to:[x,y,z], width, steps}
  const a = V(...o.from), b = V(...o.to);
  const dir = V().subVectors(b, a);
  const hlen = Math.hypot(dir.x, dir.z);
  const rise = dir.y;
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = Math.atan2(rise, hlen);
  const len = Math.hypot(hlen, rise);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
  // Smooth ramp collider (thick, under the step tips). It starts below the
  // ground so there is no lip to trip over at the foot of the stairs.
  const th = 1.5;
  const sdir = V().subVectors(b, a).normalize();
  const a2 = a.clone().addScaledVector(sdir, -1.2);
  const len2 = a2.distanceTo(b);
  const mid2 = V().addVectors(a2, b).multiplyScalar(0.5);
  const off = V(0, -th / 2, 0).applyQuaternion(q);
  ctx.world.add(new BoxCollider(mid2.add(off), V(o.width / 2, th / 2, len2 / 2), q, 'stone', {}));
  if (ctx.visual) {
    const steps = o.steps ?? Math.round(rise / 0.4);
    const sh = rise / steps, sd = hlen / steps;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const qy = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    for (let i = 0; i < steps; i++) {
      const g = boxGeo(o.width, sh * (i + 1) + 1, sd, 2);
      const p = a.clone().addScaledVector(fwd, sd * (i + 0.5));
      p.y = a.y + (sh * (i + 1) - 1) / 2;
      g.applyMatrix4(_m.compose(p, qy, V(1, 1, 1)));
      applyAO(g, groundAO(a.y, 0.4, 2));
      addGeo(ctx, 'stone', g);
    }
  }
  // Balustrade rails (grindable).
  const side = V(Math.cos(yaw), 0, -Math.sin(yaw));
  for (const s of [-1, 1]) {
    const ra = a.clone().addScaledVector(side, s * (o.width / 2 + 0.35));
    const rb = b.clone().addScaledVector(side, s * (o.width / 2 + 0.35));
    const h = 0.9;
    const rail = new Rail([ra.clone().add(V(0, h + 0.3, 0)), rb.clone().add(V(0, h + 0.3, 0))], { kind: 'stone', radius: 0.3, name: 'Temple Rail' });
    ctx.rails.add(rail);
    const c = V().addVectors(ra, rb).multiplyScalar(0.5).add(V(0, h / 2, 0));
    solid(ctx, { c: [c.x, c.y, c.z], size: [0.6, h + 0.6, len], rotX: -pitch, rotY: yaw, mat: 'stone', tag: 'stone', tile: 2, noMantle: true });
  }
}

/** Fallen log lying on the ground: grindable, walkable, with sawn end-grain caps. */
export function log(ctx, a, b, r, o = {}) {
  const m = V().addVectors(a, b).multiplyScalar(0.5);
  m.y += o.arch ?? 0.1;
  return branch(ctx, [a, m, b], { r0: r, r1: r * (o.taper ?? 0.85), name: o.name || 'Log Ride', railKind: 'log', leaves: false, mat: 'bark', cut: true, hangers: false });
}

/**
 * Octagonal plank deck wrapped around a trunk (inner radius rIn, outer rOut).
 */
export function ringDeck(ctx, cx, cz, y, rIn, rOut, o = {}) {
  const n = 8;
  const th = 0.4;
  const rot0 = o.rot ?? Math.PI / 8;
  const mid = (rIn + rOut) / 2;
  const depth = rOut - rIn;
  for (let i = 0; i < n; i++) {
    const a = rot0 + (i / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Width of the octagon side at the middle radius (plus overlap).
    const w = 2 * Math.tan(Math.PI / n) * rOut + 0.1;
    const c = [cx + ca * mid, y - th / 2, cz + sa * mid];
    solid(ctx, { c, size: [w, th, depth], rotY: Math.atan2(ca, sa), mat: 'planks', tag: 'wood', tile: 2.2, ao: false, noMantle: false });
    if (ctx.visual) {
      // Rim beam under the outer edge.
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(ca, sa));
      const g = boxGeo(w + 0.1, 0.4, 0.3, 2);
      g.applyMatrix4(_m.compose(V(cx + ca * (rOut - 0.15), y - th - 0.15, cz + sa * (rOut - 0.15)), q, V(1, 1, 1)));
      addGeo(ctx, 'wood', g);
      // Diagonal brace from the trunk.
      const b0 = V(cx + ca * rIn * 0.9, y - 2.2, cz + sa * rIn * 0.9), b1 = V(cx + ca * (rOut - 0.5), y - th - 0.2, cz + sa * (rOut - 0.5));
      if (i % 2 === 0) addGeo(ctx, 'wood', taperedTube(new THREE.LineCurve3(b0, b1), 2, 6, () => 0.13, { noise: 0, uvLen: 2 }));
    }
  }
  // Low railing posts with a rope on part of the edge (purely visual).
  return { cx, cz, y, rOut };
}

/** Bracket fungus shelf on a trunk: a small walkable step. */
export function fungusStep(ctx, cx, cz, trunkR, angle, y, size = 1.3) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const px = cx + ca * (trunkR + size * 0.55), pz = cz + sa * (trunkR + size * 0.55);
  const col = new CylinderCollider(px, pz, size, y - 0.35, y, 'fungus', { climbable: false });
  ctx.world.add(col);
  if (ctx.visual) {
    const g = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    g.scale(size * 1.12, 0.32, size * 1.12);
    // Flatten the side touching the trunk.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = -(x * ca + z * sa);
      if (d > size * 0.45) { const k = size * 0.45 - d; p.setXYZ(i, x + ca * -k, p.getY(i), z + sa * -k); }
    }
    g.computeVertexNormals();
    const under = new THREE.CircleGeometry(size * 1.1, 18);
    under.rotateX(Math.PI / 2);
    under.scale(1, 1, 1);
    for (const gg of [g, under]) {
      gg.translate(px, y - 0.32, pz);
    }
    tint(g, 1, 1, 1);
    addGeo(ctx, 'fungus', g);
    addGeo(ctx, 'fungusUnder', under);
  }
  return col;
}

/** Collectible registration (rendered/animated by the collectibles system). */
export function collectible(ctx, kind, pos, label) {
  ctx.collectibles.push({ kind, pos: pos.clone(), label });
}

export function gap(ctx, name, points, from, to, o = {}) {
  ctx.gaps.push({ name, points, from: new THREE.Box3(V(...from[0]), V(...from[1])), to: new THREE.Box3(V(...to[0]), V(...to[1])), land: o.land || 'any' });
}

export function lightShaft(ctx, pos, scale = 1) {
  ctx.shafts.push({ pos: pos.clone(), scale });
}

export { V, clamp };
