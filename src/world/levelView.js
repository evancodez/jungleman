// Turns level build output into renderable meshes: merged static geometry,
// instanced foliage, terrain, water, waterfall, torches, light shafts,
// animated mushroom caps and dynamic vines.
import * as THREE from 'three';
import { mergeGeometries, normalizeAttrs, leafCardGeo } from './geom.js';
import { getMaterials, addWind, shared } from '../fx/materials.js';
import { getTextures } from '../fx/textures.js';
import { createWater, createWaterfall } from '../fx/water.js';
import { WORLD, terrainHeight, terrainSplat, riverDist } from './terrain.js';
import { VINE_NODES } from '../physics/vines.js';
import { clamp, smoothstep, rng } from '../core/math.js';
import { SUN_DIR } from '../fx/sky.js';

export class LevelView {
  constructor(level, scene, quality) {
    this.level = level;
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    const T = getTextures(quality.textures);
    const M = getMaterials();
    this.T = T;
    this.M = M;
    const ctx = level.ctx;

    this.buildTerrain();

    // Merge static geometry per material.
    for (const [name, list] of Object.entries(ctx.geo)) {
      const mat = M[name];
      if (!mat) { console.warn('missing material', name); continue; }
      // Split into spatial chunks so frustum culling still works.
      const chunks = new Map();
      for (const g of list) {
        g.computeBoundingSphere();
        const c = g.boundingSphere.center;
        const key = Math.floor(c.x / 48) + ',' + Math.floor(c.z / 48);
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(normalizeAttrs(g));
      }
      for (const arr of chunks.values()) {
        const merged = mergeGeometries(arr, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = name !== 'face';
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }

    // Decorative hanging vines (keep the per-vertex sway weights).
    if (ctx.decoVines.length) {
      const swayed = ctx.decoVines.map((g) => {
        const ng = g.index ? g.toNonIndexed() : g;
        const keep = ng.attributes.sway;
        const out = normalizeAttrs(ng.clone());
        out.setAttribute('sway', keep);
        return out;
      });
      const merged = mergeGeometries(swayed, false);
      const mesh = new THREE.Mesh(merged, M.hanging);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    this.buildFoliage();
    this.buildMushrooms();
    this.buildWater();
    this.buildTorches();
    this.buildShafts();
    this.vineView = new VineView(level.vines, this.group, M, T);
  }

  buildTerrain() {
    const size = WORLD.size, res = this.quality.terrainRes;
    const g = new THREE.PlaneGeometry(size, size, res, res);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const n = p.count;
    const splat = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const uv = g.attributes.uv;
    const hf = this.level.world.terrain;
    const nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainHeight(x, z);
      p.setY(i, h);
      hf.normalAt(x, z, nrm);
      const [a, b, c, d] = terrainSplat(x, z, h, nrm.y);
      splat.set([a, b, c, d], i * 4);
      // AO: darker in the river bed and near the cliff base.
      let ao = 1 - smoothstep(-1.5, -3.5, h) * 0.35;
      ao *= 1 - smoothstep(1.5, 0, Math.abs(riverDist(x, z) - 7)) * 0.08;
      col.set([ao, ao, ao], i * 3);
      uv.setXY(i, x / 4, z / 4);
    }
    g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.M.terrain);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrain = mesh;
  }

  buildFoliage() {
    const ctx = this.level.ctx;
    const M = this.M;
    const density = this.quality.foliage;
    const defs = {
      leafCluster: { geo: leafCardGeo(0, { planes: 3, flat: true }), mat: M.leaves, shadow: true },
      leafSmall: { geo: leafCardGeo(0, { planes: 2 }), mat: M.leaves, shadow: false },
      fern: { geo: fernGeo(), mat: M.fern, shadow: false, thin: true },
      bush: { geo: leafCardGeo(0, { planes: 3, upright: true }), mat: M.leaves, shadow: false, thin: true },
      grass: { geo: leafCardGeo(3, { planes: 3, upright: true }), mat: M.fern, shadow: false, thin: true },
      monstera: { geo: monsteraGeo(), mat: M.fern, shadow: false, thin: true },
      smallShroom: { geo: smallShroomGeo(), mat: M.mushroomCap, shadow: false },
    };
    const R = rng(5);
    for (const [kind, mats] of Object.entries(ctx.inst)) {
      const def = defs[kind];
      if (!def) continue;
      let list = mats;
      if (def.thin && density < 1) list = mats.filter(() => R() < density);
      const mesh = new THREE.InstancedMesh(def.geo, def.mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = def.shadow && this.quality.foliageShadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  buildMushrooms() {
    const ctx = this.level.ctx;
    this.caps = [];
    const capGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    capGeo.scale(1, 0.55, 1);
    // spots
    const spotGeo = new THREE.CircleGeometry(0.12, 8);
    const spotMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.7 });
    const gillGeo = new THREE.CircleGeometry(1, 24);
    gillGeo.rotateX(Math.PI / 2);
    const gillMat = new THREE.MeshStandardMaterial({ color: 0xc8b38d, roughness: 0.9, side: THREE.DoubleSide });
    for (const b of ctx.bounceVisuals) {
      const grp = new THREE.Group();
      grp.position.set(b.x, b.top - 0.7, b.z);
      const cap = new THREE.Mesh(capGeo, this.M.mushroomCapSolid);
      cap.scale.set(b.r * 1.12, b.r * 1.12, b.r * 1.12);
      cap.castShadow = true;
      cap.receiveShadow = true;
      grp.add(cap);
      const gill = new THREE.Mesh(gillGeo, gillMat);
      gill.scale.setScalar(b.r * 1.05);
      gill.position.y = 0.02;
      grp.add(gill);
      const R = rng(Math.floor(b.x * 3 + b.z));
      for (let i = 0; i < 9; i++) {
        const a = R() * Math.PI * 2, el = 0.25 + R() * 0.9;
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(el), Math.cos(el) * 0.55, Math.sin(a) * Math.sin(el)).normalize();
        const s = new THREE.Mesh(spotGeo, spotMat);
        const pt = new THREE.Vector3(Math.cos(a) * Math.sin(el), Math.cos(el) * 0.55, Math.sin(a) * Math.sin(el)).multiplyScalar(b.r * 1.12 * 1.005);
        s.position.copy(pt);
        s.lookAt(pt.clone().add(dir));
        s.scale.setScalar(b.r * (0.8 + R() * 1.4));
        grp.add(s);
      }
      this.group.add(grp);
      this.caps.push({ grp, col: b.col, squash: 0, vel: 0 });
    }
  }

  bounce(col, strength = 1) {
    const c = this.caps.find((k) => k.col === col);
    if (c) c.vel -= 6 * strength;
  }

  buildWater() {
    this.water = createWater(this.T);
    this.group.add(this.water);
    this.waterfalls = [];
    for (const wf of this.level.ctx.waterfalls) {
      const m = createWaterfall(this.T, wf);
      this.group.add(m);
      this.waterfalls.push(m);
    }
    // Cliff-top stream surface.
    const g = new THREE.PlaneGeometry(8, 30, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, WORLD.cliffTop - 0.4, -89);
    const stream = new THREE.Mesh(g, this.water.material);
    const depth = new Float32Array(4).fill(1.2);
    const flow = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
    g.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    g.setAttribute('flow', new THREE.BufferAttribute(flow, 2));
    this.group.add(stream);
  }

  buildTorches() {
    const T = this.T;
    const torches = this.level.ctx.torches;
    this.torchPos = torches;
    const mat = new THREE.SpriteMaterial({ map: T.glow, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flames = [];
    for (const p of torches) {
      const s = new THREE.Sprite(mat);
      s.position.copy(p);
      s.scale.setScalar(1.4);
      this.group.add(s);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xfff0b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      core.position.copy(p).add(new THREE.Vector3(0, 0.05, 0));
      core.scale.setScalar(0.55);
      this.group.add(core);
      this.flames.push({ s, core, phase: Math.random() * 10 });
    }
    // A small pool of point lights that follow the nearest torches.
    this.torchLights = [];
    const n = this.quality.torchLights;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 14, 1.6);
      this.group.add(l);
      this.torchLights.push(l);
    }
  }

  setTorchLights(n) {
    while (this.torchLights.length < n) {
      const l = new THREE.PointLight(0xff9a40, 0, 14, 1.6);
      this.group.add(l);
      this.torchLights.push(l);
    }
    while (this.torchLights.length > n) {
      const l = this.torchLights.pop();
      this.group.remove(l);
      l.dispose();
    }
  }

  buildShafts() {
    const T = this.T;
    const mat = new THREE.MeshBasicMaterial({ map: T.shaft, color: 0xfff1c8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.shafts = [];
    const dir = SUN_DIR.clone();
    for (const s of this.level.ctx.shafts) {
      const h = 34 * s.scale;
      const grp = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const g = new THREE.PlaneGeometry(7 * s.scale, h);
        const m = new THREE.Mesh(g, mat);
        m.rotation.y = (i / 3) * Math.PI;
        grp.add(m);
      }
      const base = new THREE.Vector3(s.pos.x, terrainHeight(s.pos.x, s.pos.z), s.pos.z);
      grp.position.copy(base).addScaledVector(dir, h / 2 / dir.y * 0.98);
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.group.add(grp);
      this.shafts.push(grp);
    }
  }

  update(dt, time, focus, camera) {
    // Torch flicker + nearest-torch lights.
    for (const f of this.flames) {
      const k = 1 + Math.sin(time * 13 + f.phase) * 0.08 + Math.sin(time * 23 + f.phase * 2) * 0.06;
      f.s.scale.setScalar(1.4 * k);
      f.core.scale.setScalar(0.55 * (2 - k));
    }
    if (this.torchLights.length) {
      const sorted = this.torchPos.map((p, i) => [p.distanceToSquared(focus), i]).sort((a, b) => a[0] - b[0]);
      this.torchLights.forEach((l, k) => {
        const e = sorted[k];
        if (!e) { l.intensity = 0; return; }
        const p = this.torchPos[e[1]];
        l.position.copy(p);
        const d = Math.sqrt(e[0]);
        const fade = clamp(1 - (d - 25) / 15, 0, 1);
        l.intensity = (14 + Math.sin(time * 17 + k) * 2 + Math.sin(time * 7.3 + k * 2) * 1.5) * fade;
      });
    }
    // Mushroom cap springs.
    for (const c of this.caps) {
      c.vel += (-c.squash * 120 - c.vel * 9) * dt;
      c.squash += c.vel * dt;
      const s = c.squash;
      c.grp.scale.set(1 - s * 0.6, 1 + s, 1 - s * 0.6);
    }
    // Light shafts fade when the camera is close (avoid flat-card look).
    if (camera) {
      for (const s of this.shafts) {
        const d = s.position.distanceTo(camera.position);
        s.visible = d > 6;
      }
    }
    this.vineView.update();
  }
}

// ------------------------------------------------------------------ foliage geos
function fernGeo() {
  // Rosette of arching fronds using the fern tile.
  const geos = [];
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const g = new THREE.PlaneGeometry(0.45, 1.4, 1, 4);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.5 + uv.getX(k) * 0.5, 0.5 + uv.getY(k) * 0.5);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 0.7; // 0..1.4
      const t = y / 1.4;
      p.setXYZ(k, p.getX(k), Math.sin(t * 2.2) * 0.65, t * 1.25);
    }
    g.rotateY((i / fronds) * Math.PI * 2 + i * 0.3);
    geos.push(g.toNonIndexed());
  }
  const m = mergeGeometries(geos);
  const p = m.attributes.position;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) sway[i] = Math.hypot(p.getX(i), p.getZ(i)) * 0.8;
  m.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  m.computeVertexNormals();
  const n = m.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 0.9, n.getZ(i) * 0.3);
  return m;
}

function monsteraGeo() {
  const geos = [];
  const leaves = 5;
  for (let i = 0; i < leaves; i++) {
    const g = new THREE.PlaneGeometry(1.0, 1.0, 2, 3);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.5, uv.getY(k) * 0.5);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k) + 0.5;
      p.setXYZ(k, x, 0.5 + Math.sin(y * 2.0) * 0.35 - Math.abs(x) * 0.2, y * 0.9 + 0.2);
    }
    g.rotateY((i / leaves) * Math.PI * 2 + 0.4);
    geos.push(g.toNonIndexed());
  }
  const m = mergeGeometries(geos);
  const p = m.attributes.position;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) sway[i] = Math.hypot(p.getX(i), p.getZ(i)) * 0.6;
  m.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  m.computeVertexNormals();
  return m;
}

function smallShroomGeo() {
  const cap = new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, 0.6, 1);
  cap.translate(0, 0.45, 0);
  const stem = new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6);
  stem.translate(0, 0.22, 0);
  const g = mergeGeometries([cap.toNonIndexed(), stem.toNonIndexed()]);
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    const top = g.attributes.position.getY(i) > 0.44;
    c.set(top ? [1, 1, 1] : [1.3, 1.25, 1.1], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// ------------------------------------------------------------------ dynamic vines
class VineView {
  constructor(vineSet, parent, M, T) {
    this.vines = vineSet.vines;
    this.radial = 5;
    const n = VINE_NODES;
    const vertsPer = n * (this.radial + 1);
    const total = vertsPer * this.vines.length;
    this.pos = new Float32Array(total * 3);
    this.nrm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const idx = [];
    for (let v = 0; v < this.vines.length; v++) {
      const base = v * vertsPer;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= this.radial; j++) {
          const k = base + i * (this.radial + 1) + j;
          uv[k * 2] = j / this.radial;
          uv[k * 2 + 1] = i * 0.7;
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < this.radial; j++) {
        const a = base + i * (this.radial + 1) + j, b = a + this.radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, M.vine);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    parent.add(this.mesh);
    // Leaves attached to vine nodes.
    const leafGeo = leafCardGeo(0, { planes: 2 });
    this.leafCount = this.vines.length * 6;
    this.leaves = new THREE.InstancedMesh(leafGeo, M.leaves, this.leafCount);
    this.leaves.frustumCulled = false;
    parent.add(this.leaves);
    this.leafRand = Array.from({ length: this.leafCount }, (_, i) => rng(i + 1)());
    this.m = new THREE.Matrix4();
    this.update();
  }

  update() {
    const n = VINE_NODES, rad = this.radial;
    const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), N = new THREE.Vector3();
    for (let v = 0; v < this.vines.length; v++) {
      const vine = this.vines[v];
      const base = v * n * (rad + 1);
      for (let i = 0; i < n; i++) {
        const p = vine.p[i];
        const p0 = vine.p[Math.max(0, i - 1)], p1 = vine.p[Math.min(n - 1, i + 1)];
        t.subVectors(p1, p0).normalize();
        a.set(0, 0, 1);
        if (Math.abs(t.z) > 0.9) a.set(1, 0, 0);
        b.crossVectors(t, a).normalize();
        a.crossVectors(b, t).normalize();
        const r = 0.085 * (1 - i / n * 0.45);
        for (let j = 0; j <= rad; j++) {
          const ang = (j / rad) * Math.PI * 2;
          N.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
          const k = (base + i * (rad + 1) + j) * 3;
          this.pos[k] = p.x + N.x * r; this.pos[k + 1] = p.y + N.y * r; this.pos[k + 2] = p.z + N.z * r;
          this.nrm[k] = N.x; this.nrm[k + 1] = N.y; this.nrm[k + 2] = N.z;
        }
      }
      // Leaves.
      for (let l = 0; l < 6; l++) {
        const li = v * 6 + l;
        const node = 2 + Math.floor(l * (n - 3) / 6);
        const p = vine.p[node];
        const s = 0.7 + this.leafRand[li] * 0.6;
        this.m.makeRotationY(this.leafRand[li] * 6.28 + l);
        this.m.scale(new THREE.Vector3(s, s, s));
        this.m.setPosition(p.x, p.y, p.z);
        this.leaves.setMatrixAt(li, this.m);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
  }
}

export { addWind, shared };
