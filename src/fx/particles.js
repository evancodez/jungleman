// CPU-simulated particle pools rendered as point sprites: dust, leaves,
// water splashes, waterfall mist, sparkles, fireflies and pollen.
import * as THREE from 'three';
import { rng } from '../core/math.js';

const MAX = 2400;

function makeMaterial(additive) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
    vertexShader: /* glsl */`
      attribute float size;
      attribute vec4 color;
      attribute vec2 kind; // x: type (0 soft, 1 leaf, 2 spark), y: rotation
      varying vec4 vColor;
      varying vec2 vKind;
      uniform float scale;
      #include <fog_pars_vertex>
      void main() {
        vColor = color;
        vKind = kind;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float depth = -mvPosition.z;
        gl_PointSize = min(size * scale / max(0.1, depth), 220.0);
        // Fade out sprites that get too close to the lens.
        vColor.a *= smoothstep(0.4, 1.6, depth);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vColor;
      varying vec2 vKind;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float a;
        if (vKind.x < 0.5) {
          a = smoothstep(0.5, 0.0, length(p));
          a *= a;
        } else if (vKind.x < 1.5) {
          float c = cos(vKind.y), s = sin(vKind.y);
          vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          float leaf = 1.0 - smoothstep(0.0, 0.05, length(q * vec2(2.4, 1.0)) - 0.42);
          a = leaf;
          if (a < 0.4) discard;
        } else {
          float d = length(p);
          a = smoothstep(0.5, 0.0, d);
          a = a * a * 0.6 + smoothstep(0.12, 0.0, d);
        }
        gl_FragColor = vec4(vColor.rgb, vColor.a * a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

class Pool {
  constructor(scene, additive) {
    this.n = 0;
    this.p = new Float32Array(MAX * 3);
    this.v = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.size1 = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 4);
    this.alpha0 = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.kindA = new Float32Array(MAX * 2);
    this.spin = new Float32Array(MAX);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 4), 4);
    this.kindAttr = new THREE.BufferAttribute(new Float32Array(MAX * 2), 2);
    for (const a of [this.posAttr, this.sizeAttr, this.colAttr, this.kindAttr]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('size', this.sizeAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setAttribute('kind', this.kindAttr);
    this.mat = makeMaterial(additive);
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(o) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.life[i] = 0;
    this.maxLife[i] = o.life || 1;
    this.size0[i] = o.size ?? 0.3;
    this.size1[i] = o.size1 ?? this.size0[i];
    this.col[i * 4] = o.r ?? 1; this.col[i * 4 + 1] = o.g ?? 1; this.col[i * 4 + 2] = o.b ?? 1;
    this.alpha0[i] = o.a ?? 1;
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.grav ?? 0;
    this.kindA[i * 2] = o.kind ?? 0;
    this.kindA[i * 2 + 1] = o.rot ?? Math.random() * 6.28;
    this.spin[i] = o.spin ?? 0;
  }
  update(dt) {
    let j = 0;
    const pa = this.posAttr.array, sa = this.sizeAttr.array, ca = this.colAttr.array, ka = this.kindAttr.array;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] + dt;
      if (life >= this.maxLife[i]) continue;
      // compact
      if (j !== i) {
        for (let k = 0; k < 3; k++) { this.p[j * 3 + k] = this.p[i * 3 + k]; this.v[j * 3 + k] = this.v[i * 3 + k]; }
        for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
        this.maxLife[j] = this.maxLife[i]; this.size0[j] = this.size0[i]; this.size1[j] = this.size1[i];
        this.alpha0[j] = this.alpha0[i]; this.drag[j] = this.drag[i]; this.grav[j] = this.grav[i];
        this.kindA[j * 2] = this.kindA[i * 2]; this.kindA[j * 2 + 1] = this.kindA[i * 2 + 1]; this.spin[j] = this.spin[i];
      }
      this.life[j] = life;
      const d = Math.exp(-this.drag[j] * dt);
      this.v[j * 3] *= d; this.v[j * 3 + 1] = this.v[j * 3 + 1] * d - this.grav[j] * dt; this.v[j * 3 + 2] *= d;
      this.p[j * 3] += this.v[j * 3] * dt; this.p[j * 3 + 1] += this.v[j * 3 + 1] * dt; this.p[j * 3 + 2] += this.v[j * 3 + 2] * dt;
      this.kindA[j * 2 + 1] += this.spin[j] * dt;
      const t = life / this.maxLife[j];
      pa[j * 3] = this.p[j * 3]; pa[j * 3 + 1] = this.p[j * 3 + 1]; pa[j * 3 + 2] = this.p[j * 3 + 2];
      sa[j] = this.size0[j] + (this.size1[j] - this.size0[j]) * t;
      ca[j * 4] = this.col[j * 4]; ca[j * 4 + 1] = this.col[j * 4 + 1]; ca[j * 4 + 2] = this.col[j * 4 + 2];
      const fadeIn = Math.min(1, t * 8);
      ca[j * 4 + 3] = this.alpha0[j] * fadeIn * (1 - t) * (1 - t * 0.3);
      ka[j * 2] = this.kindA[j * 2]; ka[j * 2 + 1] = this.kindA[j * 2 + 1];
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.colAttr.needsUpdate = this.kindAttr.needsUpdate = true;
    this.posAttr.clearUpdateRanges();
  }
}

const SURFACE_COLORS = {
  ground: [0.42, 0.34, 0.22], sand: [0.55, 0.48, 0.36], mud: [0.3, 0.22, 0.13], rock: [0.5, 0.48, 0.44],
  stone: [0.58, 0.56, 0.5], wood: [0.5, 0.4, 0.28], bark: [0.36, 0.32, 0.22], thatch: [0.6, 0.5, 0.3], bounce: [0.9, 0.6, 0.5],
};

export class Particles {
  constructor(scene) {
    this.soft = new Pool(scene, false);
    this.glow = new Pool(scene, true);
    this.r = rng(99);
    this.ambientT = 0;
    this.mistT = 0;
  }

  setScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.soft.mat.uniforms.scale.value = s;
    this.glow.mat.uniforms.scale.value = s;
  }

  dust(pos, tag, n = 8, power = 1) {
    const c = SURFACE_COLORS[tag] || SURFACE_COLORS.ground;
    const R = this.r;
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, s = (1 + R() * 2) * power;
      this.soft.spawn({ x: pos.x + Math.cos(a) * 0.3, y: pos.y + 0.1, z: pos.z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: R() * 1.2 * power, vz: Math.sin(a) * s, life: 0.6 + R() * 0.6, size: 0.35, size1: 1.2 + power * 0.6, r: c[0] * 0.55, g: c[1] * 0.55, b: c[2] * 0.55, a: 0.4, drag: 3.5, grav: -0.3 });
    }
  }

  leaves(pos, n = 4, vel = null) {
    const R = this.r;
    for (let i = 0; i < n; i++) {
      const g = 0.2 + R() * 0.15;
      this.soft.spawn({
        x: pos.x + (R() - 0.5) * 0.6, y: pos.y + (R() - 0.2) * 0.4, z: pos.z + (R() - 0.5) * 0.6,
        vx: (vel ? vel.x * 0.2 : 0) + (R() - 0.5) * 3, vy: 1 + R() * 2.5, vz: (vel ? vel.z * 0.2 : 0) + (R() - 0.5) * 3,
        life: 1.4 + R() * 1.4, size: 0.16, size1: 0.15, r: 0.13 + R() * 0.12, g, b: 0.05, a: 1, drag: 2.2, grav: 2.2, kind: 1, spin: (R() - 0.5) * 10,
      });
    }
  }

  chips(pos, tag, n = 3, vel = null) {
    const c = SURFACE_COLORS[tag] || SURFACE_COLORS.bark;
    const R = this.r;
    for (let i = 0; i < n; i++) {
      this.soft.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (vel ? -vel.x * 0.1 : 0) + (R() - 0.5) * 2, vy: R() * 2, vz: (vel ? -vel.z * 0.1 : 0) + (R() - 0.5) * 2, life: 0.5 + R() * 0.4, size: 0.12, size1: 0.3, r: c[0] * 1.2, g: c[1] * 1.2, b: c[2] * 1.2, a: 0.7, drag: 2, grav: 4 });
    }
  }

  splash(pos, waterY, power = 1) {
    const R = this.r;
    const n = Math.floor(20 + power * 30);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, s = (1 + R() * 3) * (0.5 + power * 0.6);
      this.soft.spawn({ x: pos.x + Math.cos(a) * 0.4, y: waterY + 0.1, z: pos.z + Math.sin(a) * 0.4, vx: Math.cos(a) * s, vy: (3 + R() * 6) * (0.5 + power * 0.7), vz: Math.sin(a) * s, life: 0.8 + R() * 0.6, size: 0.25, size1: 0.6, r: 0.85, g: 0.95, b: 1, a: 0.8, drag: 0.8, grav: 18 });
    }
    for (let i = 0; i < 10; i++) {
      const a = R() * 6.28;
      this.soft.spawn({ x: pos.x + Math.cos(a) * 0.6, y: waterY + 0.2, z: pos.z + Math.sin(a) * 0.6, vx: Math.cos(a) * 2, vy: 0.5, vz: Math.sin(a) * 2, life: 1.2, size: 0.8, size1: 2.8, r: 0.9, g: 0.95, b: 0.95, a: 0.35, drag: 2.5 });
    }
  }

  ripple(pos, waterY) {
    this.soft.spawn({ x: pos.x, y: waterY + 0.05, z: pos.z, life: 0.7, size: 0.5, size1: 2.2, r: 0.9, g: 0.95, b: 1, a: 0.25, drag: 1 });
  }

  sparkle(pos, color = [1, 0.85, 0.4], n = 18, power = 1) {
    const R = this.r;
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, e = (R() - 0.3) * 3, s = (2 + R() * 4) * power;
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: e * s * 0.5 + 1, vz: Math.sin(a) * s, life: 0.6 + R() * 0.7, size: 0.35, size1: 0.05, r: color[0], g: color[1], b: color[2], a: 1, drag: 3, grav: 2, kind: 2 });
    }
  }

  trail(pos, color = [1, 0.9, 0.6], size = 0.25) {
    this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.35, size, size1: 0.02, r: color[0], g: color[1], b: color[2], a: 0.55, drag: 0, kind: 2 });
  }

  spores(pos, n = 14) {
    const R = this.r;
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, s = 1 + R() * 3;
      this.glow.spawn({ x: pos.x + Math.cos(a) * 0.8, y: pos.y + 0.2, z: pos.z + Math.sin(a) * 0.8, vx: Math.cos(a) * s, vy: 1 + R() * 3, vz: Math.sin(a) * s, life: 1 + R(), size: 0.18, size1: 0.05, r: 1, g: 0.8, b: 0.55, a: 0.8, drag: 2.5, grav: -0.2, kind: 2 });
    }
  }

  /** Ambient life around the focus point: fireflies in shade, pollen motes, falling leaves. */
  ambient(dt, focus, waterfalls, time) {
    const R = this.r;
    this.ambientT += dt;
    while (this.ambientT > 0.05) {
      this.ambientT -= 0.05;
      const a = R() * 6.28, d = 6 + R() * 26;
      const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      const y = focus.y + (R() - 0.3) * 8;
      const roll = R();
      if (roll < 0.18) {
        // Fireflies, mostly low to the ground.
        this.glow.spawn({ x, y: Math.min(y, focus.y + 1), z, vx: (R() - 0.5) * 0.6, vy: (R() - 0.5) * 0.3, vz: (R() - 0.5) * 0.6, life: 3 + R() * 3, size: 0.08, size1: 0.07, r: 0.8, g: 1, b: 0.35, a: 0.55, drag: 0.2, kind: 2 });
      } else if (roll < 0.55) {
        // Pollen motes catching the light.
        this.glow.spawn({ x, y: y + 2, z, vx: 0.3, vy: -0.05, vz: 0.15, life: 5, size: 0.045, size1: 0.045, r: 1, g: 0.95, b: 0.8, a: 0.4, drag: 0, kind: 2 });
      } else if (roll < 0.75) {
        this.soft.spawn({ x, y: y + 12, z, vx: 0.4 + (R() - 0.5), vy: -0.6, vz: (R() - 0.5), life: 8, size: 0.16, size1: 0.16, r: 0.16 + R() * 0.12, g: 0.2 + R() * 0.1, b: 0.05, a: 1, drag: 0.6, grav: 0.25, kind: 1, spin: (R() - 0.5) * 4 });
      }
    }
    // Waterfall mist & splash spray.
    this.mistT += dt;
    if (this.mistT > 0.03) {
      this.mistT = 0;
      for (const wf of waterfalls) {
        if (Math.hypot(focus.x - wf.x, focus.z - wf.zBottom) > 90) continue;
        const x = wf.x + (R() - 0.5) * wf.width, z = wf.zBottom + (R() - 0.5) * 2;
        this.soft.spawn({ x, y: wf.bottom + 0.3, z, vx: (R() - 0.5) * 3, vy: 1.5 + R() * 3, vz: 1 + R() * 3, life: 2.2, size: 1.2, size1: 5.5, r: 0.92, g: 0.96, b: 0.98, a: 0.22, drag: 1.2, grav: -0.3 });
        this.soft.spawn({ x, y: wf.bottom + 0.5, z, vx: (R() - 0.5) * 5, vy: 3 + R() * 5, vz: 1 + R() * 4, life: 0.9, size: 0.2, size1: 0.35, r: 0.9, g: 0.97, b: 1, a: 0.7, drag: 0.5, grav: 14 });
      }
    }
    void time;
  }

  update(dt) {
    this.soft.update(dt);
    this.glow.update(dt);
  }
}
