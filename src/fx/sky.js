// Sky dome with a hazy jungle gradient, sun glow and drifting cloud layer.
import * as THREE from 'three';
import { shared } from './materials.js';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.55).normalize();
export const SKY = {
  zenith: new THREE.Color(0x4d86c4),
  horizon: new THREE.Color(0xc9d8b8),
  fog: new THREE.Color(0xa9bf98),
  sun: new THREE.Color(0xfff0d0),
};

export function createSky(noiseTex) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: SKY.zenith },
      horizon: { value: SKY.horizon },
      sunColor: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
      noise: { value: noiseTex },
      time: shared.time,
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // at far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith, horizon, sunColor, sunDir;
      uniform sampler2D noise;
      uniform float time;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 600.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
        // soft clouds
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.25) * 0.35 + vec2(time * 0.004, time * 0.002);
          float c = texture2D(noise, uv).r * 0.65 + texture2D(noise, uv * 2.7).g * 0.35;
          c = smoothstep(0.52, 0.8, c) * smoothstep(0.0, 0.25, d.y);
          col = mix(col, vec3(1.0, 0.98, 0.94) * (0.9 + s * 0.3), c * 0.65);
        }
        col = mix(col, horizon * 0.85, smoothstep(0.05, -0.15, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** Distant hazy mountain/jungle silhouettes on cylinders around the level. */
export function createBackdrop() {
  const group = new THREE.Group();
  const layers = [
    { r: 340, h: 120, y: -10, color: 0x7f9a86, seed: 1, amp: 0.45 },
    { r: 260, h: 80, y: -8, color: 0x5d7a55, seed: 2, amp: 0.35 },
    { r: 190, h: 55, y: -6, color: 0x3f5c33, seed: 3, amp: 0.3 },
  ];
  for (const L of layers) {
    const seg = 160;
    const pos = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = Math.sin(a * 5 + L.seed) * 0.3 + Math.sin(a * 13 + L.seed * 2) * 0.2 + Math.sin(a * 29 + L.seed * 3) * 0.1 + Math.sin(a * 61) * 0.05;
      const top = L.y + L.h * (0.55 + n * L.amp);
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r;
      pos.push(x, L.y - 40, z, x, top, z);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: L.color, side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
