// Game orchestrator: renderer, scene, systems and the main loop.
import * as THREE from 'three';
import { Input } from '../core/input.js';
import { Events } from '../core/events.js';
import { loadSettings, saveSettings, resolveQuality, loadSave, writeSave } from '../core/settings.js';
import { buildLevel } from '../world/level.js';
import { LevelView } from '../world/levelView.js';
import { Player } from '../player/player.js';
import { Character } from '../player/character.js';
import { Animator } from '../player/animator.js';
import { CameraRig } from './camera.js';
import { Post } from '../fx/post.js';
import { createSky, createBackdrop, SUN_DIR, SKY } from '../fx/sky.js';
import { getTextures } from '../fx/textures.js';
import { shared } from '../fx/materials.js';
import { clamp, lerp, dampT } from '../core/math.js';

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.settings = loadSettings();
    this.save = loadSave();
    const qp = new URLSearchParams(location.search).get('quality');
    this.quality = resolveQuality(qp || this.settings.quality);
    this.events = new Events();
    this.time = 0;
    this.mode = 'title'; // title | playing | paused
    this.timeScale = 1;
    this.hitStop = 0;

    // ---- renderer
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;

    // ---- scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(SKY.fog, 0.0062);
    scene.background = SKY.fog.clone();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera = camera;

    getTextures(this.quality.textures);
    scene.add(createSky(getTextures().noise));
    scene.add(createBackdrop());

    // Lights.
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5530, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    sun.castShadow = true;
    const sm = this.quality.shadowMap;
    sun.shadow.mapSize.set(sm, sm);
    const R = this.quality.shadowRange;
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    // Soft fill from the opposite side for character readability.
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.35);
    fill.position.set(-SUN_DIR.x, 0.5, -SUN_DIR.z);
    scene.add(fill);

    // ---- input
    this.input = new Input(canvas);
    this.applySettings();

    // ---- level
    this.level = buildLevel({ visual: true });
    this.world = this.level.world;
    this.rails = this.level.rails;
    this.vines = this.level.vines;
    this.levelView = new LevelView(this.level, scene, this.quality);

    // ---- player
    this.player = new Player(this);
    this.player.autoGrind = this.settings.autoGrind;
    this.character = new Character();
    scene.add(this.character.root);
    this.animator = new Animator(this.character);
    this.player.placeAt(this.level.spawn.pos, this.level.spawn.yaw);

    // ---- camera + post
    this.rig = new CameraRig(camera, this.world);
    this.rig.reset(this.player);
    this.post = new Post(r, scene, camera, this.quality);

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    if (hooks.init) hooks.init(this);
    this.last = performance.now();
    this.frames = 0;
    this.fpsT = 0;
    this.fps = 60;
  }

  applySettings() {
    const s = this.settings;
    Object.assign(this.input.settings, { mouseSens: s.mouseSens, padSens: s.padSens, invertY: s.invertY, rumble: s.rumble });
    if (this.rig) Object.assign(this.rig.settings, { autoCam: s.autoCam, fov: s.fov, shake: s.shake });
    if (this.player) this.player.autoGrind = s.autoGrind;
    if (this.hooks.applySettings) this.hooks.applySettings(this, s);
  }

  saveSettings() { saveSettings(this.settings); this.applySettings(); }

  /** Apply what can change live (resolution, shadows, bloom); the rest applies on reload. */
  applyQuality() {
    const q = resolveQuality(this.settings.quality);
    const old = this.quality;
    this.quality = { ...q, textures: old.textures, foliage: old.foliage, terrainRes: old.terrainRes, msaa: old.msaa };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (q.shadowMap !== old.shadowMap || q.shadowRange !== old.shadowRange) {
      const sh = this.sun.shadow;
      sh.mapSize.set(q.shadowMap, q.shadowMap);
      const R = q.shadowRange;
      Object.assign(sh.camera, { left: -R, right: R, top: R, bottom: -R });
      sh.camera.updateProjectionMatrix();
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    this.post.bloom.enabled = q.bloom;
    this.levelView.setTorchLights(q.torchLights);
    this.onResize();
  }
  writeSave() { writeSave(this.save); }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  /** Advance one frame (also callable manually for tests). */
  frame(forcedDt) {
    const now = performance.now();
    let dt = forcedDt ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fpsT += dt; this.frames++;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.fpsT = 0; this.frames = 0; }

    this.input.update(dt);
    if (this.hooks.preUpdate) this.hooks.preUpdate(this, dt);

    const playing = this.mode === 'playing';
    let gdt = dt * this.timeScale;
    if (this.hitStop > 0) { this.hitStop -= dt; gdt *= 0.15; }
    this.time += gdt;
    shared.time.value = this.time;

    if (playing) {
      if (this.input.pressed('pause')) { this.input.consume('pause'); if (this.hooks.pause) this.hooks.pause(this); }
      this.vines.update(gdt, this.time, this.player.pos);
      this.player.update(gdt, this.rig.yaw);
      this.rig.update(dt, this.player, this.input);
    } else {
      this.vines.update(gdt, this.time, this.player.pos);
      if (this.mode === 'title') this.rig.updateOrbit(dt, new THREE.Vector3(0, 6, 0));
      if (this.mode === 'debug' && this.debugCam) {
        this.camera.position.copy(this.debugCam.pos);
        this.camera.lookAt(this.debugCam.look);
        this.camera.fov = this.debugCam.fov || 60;
        this.camera.updateProjectionMatrix();
      }
    }
    this.animator.update(gdt, this.player, this.time);
    this.character.root.visible = !(playing && this.rig.tooClose);
    this.levelView.update(gdt, this.time, this.player.pos, this.camera);
    if (this.hooks.update) this.hooks.update(this, gdt, dt);

    // Shadow camera follows the focus point (snapped to texels to avoid shimmer).
    const focus = this.mode === 'title' ? this.camera.position : this.player.pos;
    const R = this.quality.shadowRange;
    const texel = (2 * R) / this.quality.shadowMap;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + SUN_DIR.x * 120, focus.y + SUN_DIR.y * 120, fz + SUN_DIR.z * 120);

    const sp = playing && this.settings.speedFx ? clamp((this.player.speed - 13) / 14, 0, 1) : 0;
    this.speedFx = lerp(this.speedFx || 0, sp, dampT(4, dt));
    this.post.render(dt, this.time, this.speedFx);
    if (this.hooks.postRender) this.hooks.postRender(this, dt);
  }
}
