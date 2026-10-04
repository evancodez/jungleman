// River/pool water surface and the waterfall.
import * as THREE from 'three';
import { shared } from './materials.js';
import { SUN_DIR, SKY } from './sky.js';
import { terrainHeight, waterHeight, waterFlow, WORLD, FALLS } from '../world/terrain.js';
import { clamp } from '../core/math.js';

// Water level at a point, sampled with a little slack so shorelines get covered.
function levelAt(x, z) {
  let best = -Infinity;
  for (const [dx, dz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) best = Math.max(best, waterHeight(x + dx, z + dz));
  return best;
}

export function createWater(textures) {
  const x0 = -16, x1 = 15, z0 = -60, z1 = -10, step = 0.5;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos = [], depth = [], flow = [], idx = [];
  const vid = new Map();
  const vert = (i, j) => {
    const key = i * 10000 + j;
    if (vid.has(key)) return vid.get(key);
    const x = x0 + i * step, z = z0 + j * step;
    const h = terrainHeight(x, z);
    const level = levelAt(x, z);
    pos.push(x, level, z);
    depth.push(level - h);
    const [fx, fz] = waterFlow(x, z);
    flow.push(fx, fz);
    const id = pos.length / 3 - 1;
    vid.set(key, id);
    return id;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const level = levelAt(x + step / 2, z + step / 2);
      if (level === -Infinity) continue;
      const hs = [terrainHeight(x, z), terrainHeight(x + step, z), terrainHeight(x, z + step), terrainHeight(x + step, z + step)];
      if (Math.min(...hs) > level + 0.05) continue;
      if ([[x, z], [x + step, z], [x, z + step], [x + step, z + step]].some(([a, b]) => levelAt(a, b) !== level)) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        normalMap: { value: textures.waterNormal },
        noise: { value: textures.noise },
        time: shared.time,
        sunDir: { value: SUN_DIR },
        sunColor: { value: new THREE.Color(0xfff2d8) },
        skyColor: { value: SKY.zenith.clone().lerp(SKY.horizon, 0.4) },
        horizon: { value: SKY.horizon },
        deep: { value: new THREE.Color(0x0b2e2a) },
        shallow: { value: new THREE.Color(0x3c6648) },
      },
    ]),
    vertexShader: /* glsl */`
      attribute float depth;
      attribute vec2 flow;
      varying float vDepth;
      varying vec2 vFlow;
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vDepth = depth;
        vFlow = flow;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D normalMap, noise;
      uniform float time;
      uniform vec3 sunDir, sunColor, skyColor, horizon, deep, shallow;
      varying float vDepth;
      varying vec2 vFlow;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      vec3 sampleN(vec2 uv) {
        vec3 n = texture2D(normalMap, uv).xyz * 2.0 - 1.0;
        return vec3(n.x, n.z, n.y);
      }
      void main() {
        vec2 f = vFlow * 0.6;
        float sp = length(vFlow);
        // Two-phase flow mapping to avoid stretching.
        float ph0 = fract(time * 0.25);
        float ph1 = fract(time * 0.25 + 0.5);
        float w = abs(ph0 - 0.5) * 2.0;
        vec2 uvA = vWPos.xz * 0.09 - f * ph0 * 3.0;
        vec2 uvB = vWPos.xz * 0.09 - f * ph1 * 3.0 + 0.37;
        vec3 n1 = mix(sampleN(uvA), sampleN(uvB), w);
        vec3 n2 = sampleN(vWPos.xz * 0.23 + vec2(time * 0.03, -time * 0.025));
        vec3 n = normalize(n1 * 0.7 + n2 * 0.5 + vec3(0.0, 1.6, 0.0));
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 4.0);
        vec3 R = reflect(-V, n);
        vec3 refl = mix(horizon, skyColor, clamp(R.y, 0.0, 1.0));
        float d = clamp(vDepth / 2.4, 0.0, 1.0);
        vec3 col = mix(shallow, deep, d);
        col = mix(col, refl * 0.85, 0.08 + fres * 0.45);
        float spec = pow(max(dot(R, sunDir), 0.0), 180.0);
        col += sunColor * spec * 2.5;
        // Foam at shores and on fast water.
        float nz = texture2D(noise, vWPos.xz * 0.15 - f * time * 0.5).r;
        float foam = smoothstep(0.18, 0.0, vDepth + (nz - 0.5) * 0.25) * 0.35;
        // Thin flow streaks (stretched along the current).
        vec2 fd = normalize(vFlow + vec2(1e-4));
        vec2 sv = vec2(dot(vWPos.xz, vec2(-fd.y, fd.x)) * 0.35, dot(vWPos.xz, fd) * 0.04 - time * 0.35 * sp);
        float streak = smoothstep(0.72, 0.9, texture2D(noise, sv).b);
        foam += streak * sp * 0.22;
        float poolDist = length((vWPos.xz - vec2(${FALLS.x.toFixed(1)}, ${FALLS.zBottom.toFixed(1)})) * vec2(0.7, 1.0));
        float bub = texture2D(noise, vWPos.xz * 0.55 + vec2(0.0, time * 0.5)).g * 0.6 + texture2D(noise, vWPos.xz * 1.3 - vec2(time * 0.2, 0.0)).r * 0.4;
        foam += smoothstep(8.0, 1.5, poolDist) * smoothstep(0.5, 0.75, bub) * 0.9;
        col = mix(col, vec3(0.88, 0.92, 0.88), clamp(foam, 0.0, 1.0) * 0.7);
        float alpha = mix(0.25, 0.94, smoothstep(0.0, 1.2, vDepth));
        alpha = max(alpha, clamp(foam, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 1;
  mesh.receiveShadow = false;
  return mesh;
}

/** Waterfall ribbon falling from the cliff lip into the pool. */
export function createWaterfall(textures, wf) {
  const segY = 40, segX = 10;
  const pos = [], uv = [], idx = [];
  const fallH = wf.top - wf.bottom;
  for (let j = 0; j <= segY; j++) {
    const t = j / segY;
    // Arc: leaves the lip outward, then falls nearly straight.
    const y = wf.top - t * fallH;
    const z = wf.zTop + (wf.zBottom - wf.zTop) * Math.sqrt(t) ;
    for (let i = 0; i <= segX; i++) {
      const s = i / segX - 0.5;
      const spread = 1 + t * 0.25;
      pos.push(wf.x + s * wf.width * spread, y, z + Math.sin(s * Math.PI) * -0.4);
      uv.push(i / segX, t * fallH / 6);
    }
  }
  for (let j = 0; j < segY; j++) for (let i = 0; i < segX; i++) {
    const a = j * (segX + 1) + i, b = a + segX + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { noise: { value: textures.noise }, time: shared.time }]),
    vertexShader: /* glsl */`
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D noise;
      uniform float time;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vec2(vUv.x * 2.0, vUv.y * 0.35 - time * 1.1);
        float n = texture2D(noise, uv).r * 0.6 + texture2D(noise, uv * vec2(3.0, 1.5) + 0.3).g * 0.4;
        float streak = smoothstep(0.35, 0.75, n);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        vec3 col = mix(vec3(0.55, 0.72, 0.7), vec3(0.95, 0.98, 1.0), streak);
        float a = (0.45 + streak * 0.5) * edge;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}
