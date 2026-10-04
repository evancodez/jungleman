// River/pool water surface and the waterfall.
import * as THREE from 'three';
import { shared } from './materials.js';
import { SUN_DIR, SKY } from './sky.js';
import { terrainHeight, RIVER, WORLD, POOL } from '../world/terrain.js';
import { clamp } from '../core/math.js';

function riverFlowAt(x, z) {
  // Direction of the nearest river segment.
  let best = Infinity, fx = 0, fz = 1;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; const l = Math.sqrt(l2); fx = dx / l; fz = dz / l; }
  }
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  const k = clamp((pd - 6) / 8, 0.15, 1);
  return [fx * k, fz * k];
}

export function createWater(textures) {
  const level = WORLD.waterLevel;
  const x0 = -30, x1 = 45, z0 = -76, z1 = 125, step = 1;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos = [], depth = [], flow = [], idx = [];
  const vid = new Map();
  const vert = (i, j) => {
    const key = i * 10000 + j;
    if (vid.has(key)) return vid.get(key);
    const x = x0 + i * step, z = z0 + j * step;
    const h = terrainHeight(x, z);
    pos.push(x, level, z);
    depth.push(level - h);
    const [fx, fz] = riverFlowAt(x, z);
    flow.push(fx, fz);
    const id = pos.length / 3 - 1;
    vid.set(key, id);
    return id;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const hs = [terrainHeight(x, z), terrainHeight(x + step, z), terrainHeight(x, z + step), terrainHeight(x + step, z + step)];
      if (Math.min(...hs) > level + 0.05) continue;
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
        float foam = smoothstep(0.3, 0.0, vDepth + (nz - 0.5) * 0.35) * 0.6;
        float nz2 = texture2D(noise, vWPos.xz * 0.043 - f * time * 0.21).g;
        foam += smoothstep(0.7, 0.85, nz * 0.6 + nz2 * 0.6) * sp * 0.25;
        float poolDist = length(vWPos.xz - vec2(0.0, -66.5));
        foam += smoothstep(9.0, 2.0, poolDist) * smoothstep(0.35, 0.7, texture2D(noise, vWPos.xz * 0.3 + vec2(0.0, time * 0.4)).g);
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
