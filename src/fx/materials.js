// Material library with shader patches: world-space moss on upward-facing
// surfaces, wind sway for foliage, splat-mapped terrain.
import * as THREE from 'three';
import { getTextures } from './textures.js';

export const shared = {
  time: { value: 0 },
  wind: { value: 1 },
  playerPos: { value: new THREE.Vector3() },
};

const WORLD_VARYINGS_VERT = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNormal;
`;
const WORLD_VARYINGS_CALC = /* glsl */`
{
  vec4 jmWp = vec4(transformed, 1.0);
  vec3 jmN = objectNormal;
  #ifdef USE_INSTANCING
    jmWp = instanceMatrix * jmWp;
    jmN = mat3(instanceMatrix) * jmN;
  #endif
  jmWp = modelMatrix * jmWp;
  vWPos = jmWp.xyz;
  vWNormal = normalize(mat3(modelMatrix) * jmN);
}
`;

/**
 * Blend moss onto upward-facing surfaces in world space.
 * opts: {amount, lo, hi, scale}
 */
export function addMoss(mat, opts = {}) {
  const T = getTextures();
  const uniforms = {
    mossMap: { value: T.moss.map },
    mossNoise: { value: T.noise },
    mossAmount: { value: opts.amount ?? 1 },
    mossLo: { value: opts.lo ?? 0.25 },
    mossHi: { value: opts.hi ?? 0.75 },
    mossScale: { value: opts.scale ?? 0.4 },
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_VARYINGS_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_VARYINGS_CALC);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform sampler2D mossMap;
        uniform sampler2D mossNoise;
        uniform float mossAmount, mossLo, mossHi, mossScale;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 n = normalize(vWNormal);
          float nz = texture2D(mossNoise, vWPos.xz * 0.045 + vWPos.y * 0.02).r;
          float nz2 = texture2D(mossNoise, vWPos.xz * 0.21 + vWPos.y * 0.07).g;
          float m = smoothstep(mossLo, mossHi, n.y + (nz - 0.5) * 0.9 + (nz2 - 0.5) * 0.35) * mossAmount;
          vec3 an = abs(n);
          vec2 muv = an.y > 0.5 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
          vec3 mc = texture2D(mossMap, muv * mossScale).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, mc, clamp(m, 0.0, 1.0));
          jmMoss = m;
        }`)
      .replace('void main() {', 'float jmMoss = 0.0;\nvoid main() {')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, jmMoss);`);
  };
  mat.customProgramCacheKey = () => 'moss' + (opts.key || '');
  return mat;
}

/** Vertex wind sway. Displacement scales with the `sway` attribute (or uv.y). */
export function addWind(mat, opts = {}) {
  const strength = opts.strength ?? 0.25;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uWind;
        attribute float sway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 jwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            jwp = instanceMatrix * jwp;
          #endif
          jwp = modelMatrix * jwp;
          float ph = jwp.x * 0.21 + jwp.z * 0.17;
          float w = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 2.3) * 0.3 + sin(uTime * 5.1 + ph * 4.1) * 0.1;
          float s = sway * ${strength.toFixed(3)} * uWind;
          transformed.x += w * s;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * s * 0.6;
          transformed.y += sin(uTime * 2.0 + ph) * s * 0.25;
        }`);
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + 'wind' + strength;
  return mat;
}

/** Dither foliage away when the camera gets very close (no leaf walls in your face). */
export function addNearFade(mat, near = 1.2, far = 3.4) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 fw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fw = instanceMatrix * fw;
          #endif
          vFadeWPos = (modelMatrix * fw).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWPos;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float fd = distance(vFadeWPos, cameraPosition);
          float fk = clamp((fd - ${near.toFixed(2)}) / ${(far - near).toFixed(2)}, 0.0, 1.0);
          float dth = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (fk < dth) discard;
        }`);
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + 'nearfade';
  return mat;
}

/** Fake subsurface/back-lighting for leaves. */
function addLeafTranslucency(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight += diffuseColor.rgb * vec3(0.10, 0.16, 0.03);
      #include <opaque_fragment>`);
  };
  return mat;
}

export function terrainMaterial() {
  const T = getTextures();
  const mat = new THREE.MeshStandardMaterial({
    map: T.grass.map,
    normalMap: T.dirt.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  });
  const uniforms = {
    dirtMap: { value: T.dirt.map },
    mudMap: { value: T.mud.map },
    rockMap: { value: T.rock.map },
    noiseMap: { value: T.noise },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec2 vWorldXZ;
        varying vec3 vTWPos;
        varying vec3 vTWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat;
        vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldXZ = vTWPos.xz;
        vTWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D dirtMap, mudMap, rockMap, noiseMap;
        varying vec4 vSplat;
        varying vec2 vWorldXZ;
        varying vec3 vTWPos;
        varying vec3 vTWN;`)
      .replace('#include <map_fragment>', `
        vec4 nzA = texture2D(noiseMap, vWorldXZ * 0.008);
        vec4 nzB = texture2D(noiseMap, vWorldXZ * 0.05);
        vec3 g1 = texture2D(map, vMapUv).rgb;
        vec3 g2 = texture2D(map, vMapUv * 0.27 + 0.31).rgb;
        vec3 g = mix(g1, g2, 0.45) * (0.75 + nzA.r * 0.5);
        vec3 d = texture2D(dirtMap, vMapUv * 0.8).rgb;
        vec3 m = texture2D(mudMap, vMapUv * 0.6).rgb;
        vec3 tn = abs(normalize(vTWN));
        tn = pow(tn, vec3(4.0));
        tn /= (tn.x + tn.y + tn.z);
        vec3 rk = texture2D(rockMap, vTWPos.zy * 0.11).rgb * tn.x
                + texture2D(rockMap, vTWPos.xz * 0.09).rgb * tn.y
                + texture2D(rockMap, vTWPos.xy * 0.11).rgb * tn.z;
        rk *= 0.85 + texture2D(noiseMap, vTWPos.xy * 0.02 + vTWPos.zy * 0.013).r * 0.3;
        vec4 w = vSplat;
        // noisy transitions
        float b = (nzB.g - 0.5) * 0.6;
        w.x = max(0.0, w.x + b);
        w.y = max(0.0, w.y - b * 0.5);
        w /= max(1e-3, w.x + w.y + w.z + w.w);
        vec3 col = g * w.x + d * w.y + m * w.z + rk * w.w;
        diffuseColor.rgb *= col;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.45, vSplat.z * 0.8);`);
  };
  mat.customProgramCacheKey = () => 'terrain';
  return mat;
}

let LIB = null;

export function getMaterials() {
  if (LIB) return LIB;
  const T = getTextures();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });

  const bark = addMoss(std({ map: T.bark.map, normalMap: T.bark.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), vertexColors: true }), { amount: 1, lo: 0.2, hi: 0.7, key: 'bark' });
  const branch = addMoss(std({ map: T.bark.map, normalMap: T.bark.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), vertexColors: true }), { amount: 1, lo: 0.05, hi: 0.55, key: 'branch' });
  const stone = addMoss(std({ map: T.stone.map, normalMap: T.stone.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), vertexColors: true }), { amount: 0.85, lo: 0.4, hi: 0.85, scale: 0.3, key: 'stone' });
  const face = addMoss(std({ map: T.face.map, normalMap: T.face.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), vertexColors: true }), { amount: 0.8, lo: 0.5, hi: 0.9, key: 'face' });
  const rock = addMoss(std({ map: T.rock.map, normalMap: T.rock.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), vertexColors: true }), { amount: 1, lo: 0.3, hi: 0.75, scale: 0.25, key: 'rock' });
  const planks = addMoss(std({ map: T.planks.map, normalMap: T.planks.normalMap, roughness: 0.85, vertexColors: true }), { amount: 0.35, lo: 0.6, hi: 1.2, key: 'planks' });
  const wood = addMoss(std({ map: T.bark.map, normalMap: T.bark.normalMap, color: 0xb59a7a, vertexColors: true }), { amount: 0.4, lo: 0.5, hi: 1.0, key: 'wood' });
  const thatch = std({ map: T.thatch.map, normalMap: T.thatch.normalMap, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1, vertexColors: true });
  const rope = std({ map: T.rope.map, normalMap: T.rope.normalMap, roughness: 1, color: 0xd8c39a });
  const vine = std({ map: T.vine.map, normalMap: T.vine.normalMap, roughness: 0.8, color: 0x9fbf6a });
  const mushroomCap = std({ color: 0xd8573a, roughness: 0.55, vertexColors: true });
  const mushroomCapSolid = std({ color: 0xc9472c, roughness: 0.5 });
  const mushroomStem = std({ color: 0xc9bda2, roughness: 0.8, vertexColors: true });
  const mud = std({ map: T.mud.map, normalMap: T.mud.normalMap, roughness: 0.4, vertexColors: true });

  const leaves = addNearFade(addLeafTranslucency(addWind(std({
    map: T.leaves, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd0e0b0,
  }), { strength: 0.18 })));
  const fern = addNearFade(addLeafTranslucency(addWind(std({
    map: T.leaves, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xc0d8a0,
  }), { strength: 0.12 })), 0.5, 1.6);
  const hanging = addWind(std({ map: T.vine.map, roughness: 0.85, color: 0x7d9d4a, side: THREE.DoubleSide }), { strength: 0.35 });

  const endGrain = std({ map: T.endGrain.map, normalMap: T.endGrain.normalMap, roughness: 0.9 });
  const fungus = addMoss(std({ color: 0xd9b27a, roughness: 0.7, vertexColors: true, map: T.mud.map }), { amount: 0.4, lo: 0.7, hi: 1.1, key: 'fungus' });
  const fungusUnder = std({ color: 0xeedcb8, roughness: 0.9, side: THREE.DoubleSide });

  const torchWood = std({ color: 0x4a3524, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc845, metalness: 1, roughness: 0.28, emissive: 0x6a4400, emissiveIntensity: 0.6 });
  const letter = new THREE.MeshStandardMaterial({ color: 0xfff1c0, metalness: 0.2, roughness: 0.4, emissive: 0xffaa22, emissiveIntensity: 1.2 });

  LIB = { bark, branch, stone, face, rock, planks, wood, thatch, rope, vine, mushroomCap, mushroomCapSolid, mushroomStem, mud, leaves, fern, hanging, torchWood, gold, letter, endGrain, fungus, fungusUnder, terrain: terrainMaterial() };
  return LIB;
}
