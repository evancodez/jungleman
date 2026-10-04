// Post-processing: MSAA scene render, bloom, color grade with vignette,
// speed-based radial blur and subtle film grain, then tone mapping.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    speed: { value: 0 },
    vignette: { value: 0.9 },
    flash: { value: 0 },
    flashColor: { value: new THREE.Color(1, 1, 1) },
    grain: { value: 0.025 },
    saturation: { value: 1.06 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, speed, vignette, flash, grain, saturation;
    uniform vec3 flashColor;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // Radial speed blur toward the edges.
      if (speed > 0.01) {
        float amt = speed * smoothstep(0.15, 0.7, r) * 0.06;
        vec3 acc = col;
        for (int i = 1; i < 8; i++) {
          float t = float(i) / 7.0;
          acc += texture2D(tDiffuse, vUv - c * amt * t).rgb;
        }
        col = acc / 8.0;
      }
      // Grade: gentle S-curve, warm highlights, teal-green shadows.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      vec3 shadowTint = vec3(0.92, 1.02, 1.0);
      vec3 highTint = vec3(1.04, 1.0, 0.94);
      col *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
      // Vignette.
      col *= mix(1.0, smoothstep(0.85, 0.25, r), vignette * 0.55);
      col = mix(col, flashColor, flash);
      col += (hash(vUv * resolution + fract(time * 13.0)) - 0.5) * grain * (0.6 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 0.82);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.flash = 0;
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.resolution.value.set(w, h);
  }
  render(dt, time, speedFx) {
    const u = this.grade.uniforms;
    u.time.value = time;
    u.speed.value = speedFx;
    this.flash = Math.max(0, this.flash - dt * 3);
    u.flash.value = this.flash * 0.35;
    this.composer.render(dt);
  }
  doFlash(color = 0xffffff, amt = 1) {
    this.grade.uniforms.flashColor.value.set(color);
    this.flash = Math.max(this.flash, amt);
  }
}
