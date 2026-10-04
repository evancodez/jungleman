// Entry point: loading screen, system wiring (events -> audio/FX/HUD) and
// the game-mode flow (title, free roam, score attack, pause).
import * as THREE from 'three';
import { Game } from './game/game.js';
import { Particles } from './fx/particles.js';
import { Audio } from './audio/audio.js';
import { ComboSystem } from './game/tricks.js';
import { Collectibles } from './game/collectibles.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menu.js';
import { riverDist } from './world/terrain.js';
import { clamp } from './core/math.js';

const params = new URLSearchParams(location.search);
const ATTACK_TIME = 120;

const setLoad = (f, tip) => {
  const el = document.getElementById('load-fill');
  if (el) el.style.width = `${Math.round(f * 100)}%`;
  if (tip) { const t = document.getElementById('load-tip'); if (t) t.textContent = tip; }
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  setLoad(0.15, 'Growing the jungle…');
  await nextFrame();
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  const audio = new Audio();
  let game;
  const S = { attack: false, timer: 0, ending: false, endT: 0, swimSoundT: 0, grindFxT: 0 };

  const hooks = {
    init(g) {
      g.particles = new Particles(g.scene);
      g.audio = audio;
      g.combo = new ComboSystem(g);
      g.collectibles = new Collectibles(g);
      g.hud = new Hud(uiRoot, g);
      g.hud.renderCollect(g.collectibles.counts());
      g.showFps = params.has('fps');
    },
    applySettings(g, s) {
      audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    },
    preUpdate(g) {
      const nav = g.input.takeNav();
      if (g.menus && g.menus.open) g.menus.nav(nav);
    },
    pause(g) { pause(g); },
    update(g, dt, realDt) {
      g.particles.setScale(window.innerHeight, g.camera.fov);
      const playing = g.mode === 'playing';
      if (playing && g.input.pressed('scoring')) {
        g.input.consume('scoring');
        const order = ['full', 'names', 'off'];
        g.settings.scoring = order[(order.indexOf(g.settings.scoring) + 1) % order.length];
        g.saveSettings();
        g.hud.popup(`Scoring: ${{ full: 'Full', names: 'Names Only', off: 'Off' }[g.settings.scoring]}`, 'med');
      }
      if (playing) {
        g.combo.update(dt);
        g.collectibles.update(dt, g.time);
        perFrameFx(g, dt);
        if (S.attack) updateAttack(g, realDt);
      } else g.collectibles.update(0, g.time);
      g.particles.ambient(dt, playing ? g.player.pos : g.camera.position, g.level.ctx.waterfalls, g.time);
      g.particles.update(dt);
      g.hud.update(realDt);
      const p = g.player;
      const wf = g.level.ctx.waterfalls[0];
      audio.update(realDt, {
        playing,
        menu: !playing,
        speed: playing ? p.speed : 0,
        airborne: p.state === 'air',
        grind: { active: playing && p.state === 'grind', speed: p.grind.speed, kind: p.grind.rail ? p.grind.rail.kind : 'bark' },
        waterfallDist: wf ? Math.hypot(g.camera.position.x - wf.x, g.camera.position.y - 10, g.camera.position.z - wf.zBottom) : 200,
        riverDist: riverDist(g.camera.position.x, g.camera.position.z) + Math.max(0, g.camera.position.y - 2) * 0.5,
      });
      const comboHeat = g.combo.active ? clamp(0.35 + g.combo.mult * 0.06, 0, 1) : 0;
      audio.setIntensity(playing ? Math.max(0.2, comboHeat, clamp((p.speed - 8) / 16, 0, 0.6)) : 0.1);
    },
  };

  setLoad(0.35, 'Carving the temple…');
  await nextFrame();
  game = new Game(canvas, hooks);
  window.__game = game;
  setLoad(0.9, 'Hanging the vines…');
  await nextFrame();

  // ------------------------------------------------------------------ menus
  const menus = new Menus(uiRoot, game, {
    sound: (k) => audio.ui(k),
    startFree: () => startPlay(false),
    startAttack: () => startPlay(true),
    resume: () => resume(),
    restart: (toSpawn) => { game.player.respawn(toSpawn); game.rig.reset(game.player); resume(); },
    quitToTitle: () => toTitle(),
    onSettingsChanged: (key) => { game.applySettings(); if (key === 'quality') game.applyQuality(); },
    resetProgress: () => {
      game.save.gaps = []; game.save.bestScore = 0;
      game.combo.gapsFound.clear();
      game.collectibles.resetAll();
      game.hud.renderCollect(game.collectibles.counts());
    },
  });
  game.menus = menus;

  function startPlay(attack) {
    audio.unlock();
    menus.clear();
    S.attack = attack;
    S.ending = false;
    game.combo.reset();
    game.combo.total = 0;
    game.combo.bestCombo = 0;
    game.hud.timer = attack ? ATTACK_TIME : null;
    if (attack || game.mode === 'title') game.player.placeAt(game.level.spawn.pos, game.level.spawn.yaw);
    game.rig.reset(game.player);
    game.mode = 'playing';
    game.hud.show(true);
    game.input.consumeAll();
    game.input.gameplayActive = true;
    S.timer = ATTACK_TIME;
    if (game.input.lastDevice === 'kbm') game.input.requestPointerLock();
    const c = game.collectibles.counts();
    if (attack) game.hud.banner('SCORE ATTACK', 'Two minutes. Chain everything. Land your combos.');
    else game.hud.banner('FREE ROAM', `Letters ${c.letters.length}/${c.lettersTotal} · Idols ${c.idols}/${c.idolsTotal} · Gaps ${game.combo.gapsFound.size}/${game.level.ctx.gaps.length}`);
  }
  function pause(g) {
    if (g.mode !== 'playing') return;
    g.mode = 'paused';
    g.input.gameplayActive = false;
    g.input.exitPointerLock();
    menus.showPause();
  }
  function resume() {
    menus.clear();
    game.mode = 'playing';
    game.input.consumeAll();
    game.input.gameplayActive = true;
    if (game.input.lastDevice === 'kbm') game.input.requestPointerLock();
  }
  function toTitle() {
    menus.clear();
    game.mode = 'title';
    S.attack = false;
    game.hud.timer = null;
    game.hud.show(false);
    game.input.gameplayActive = false;
    game.input.exitPointerLock();
    menus.showTitle();
  }
  function updateAttack(g, dt) {
    if (!S.ending) {
      S.timer -= dt;
      g.hud.timer = S.timer;
      if (S.timer <= 0) {
        S.ending = true;
        S.endT = 0;
        g.hud.popup("TIME'S UP!", 'big');
      }
    } else {
      S.endT += dt;
      // Let the current combo finish (up to 8s).
      if (!g.combo.active || S.endT > 8) {
        if (g.combo.active) g.combo.bank();
        const prev = g.save.bestScore || 0;
        const score = g.combo.total;
        const record = score > prev;
        if (record) { g.save.bestScore = score; g.writeSave(); }
        g.mode = 'paused';
        g.input.exitPointerLock();
        g.input.gameplayActive = false;
        S.attack = false;
        g.hud.timer = null;
        menus.showResults({ score, bestCombo: g.combo.bestCombo, record, prevBest: prev });
      }
    }
  }

  // ------------------------------------------------------------------ pointer lock
  canvas.addEventListener('mousedown', () => {
    audio.unlock();
    if (game.mode === 'playing' && !game.input.pointerLocked) game.input.requestPointerLock();
  });
  game.input.onPointerLockChange = (locked) => {
    if (!locked && game.mode === 'playing' && game.input.lastDevice === 'kbm' && !game.input.noLock) pause(game);
  };
  window.addEventListener('keydown', () => audio.unlock(), { once: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(game); });
  window.addEventListener('blur', () => { if (game.input.lastDevice === 'kbm') pause(game); });
  // Gamepad-only players: browsers may need a click/key before audio can start.
  const audioHint = document.createElement('div');
  audioHint.className = 'lockhint';
  audioHint.textContent = 'Click or press any key to enable sound';
  audioHint.style.display = 'none';
  uiRoot.appendChild(audioHint);
  const lockHint = document.createElement('div');
  lockHint.className = 'lockhint';
  lockHint.style.bottom = '54px';
  lockHint.textContent = 'Click the game to capture the mouse for camera control';
  lockHint.style.display = 'none';
  uiRoot.appendChild(lockHint);
  setInterval(() => {
    const i = game.input;
    lockHint.style.display = game.mode === 'playing' && i.lastDevice === 'kbm' && !i.pointerLocked && !i.noLock ? '' : 'none';
    const blocked = !audio.ctx || audio.ctx.state !== 'running';
    audioHint.style.display = blocked && game.mode !== 'title' && game.input.lastDevice === 'gamepad' ? '' : 'none';
    if (audio.ctx && audio.ctx.state === 'suspended' && game.input.lastDevice === 'gamepad') audio.ctx.resume().catch(() => {});
  }, 1000);
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') { game.showFps = !game.showFps; e.preventDefault(); } });

  // ------------------------------------------------------------------ event -> feedback
  wireFeedback(game);

  document.getElementById('loading')?.classList.add('hide');
  setTimeout(() => document.getElementById('loading')?.remove(), 700);
  if (params.has('play')) startPlay(false);
  else { game.mode = 'title'; menus.showTitle(); }
  if (!params.has('manual')) game.start();
}

function wireFeedback(game) {
  const ev = game.events;
  const a = game.audio, fx = game.particles, rig = game.rig, input = game.input;
  const pl = game.player;
  ev.on('footstep', (e) => {
    a.footstep(e.tag, e.speed);
    if (e.speed > 9 && Math.random() < 0.5) fx.dust(e.pos, e.tag, 2, 0.4);
  });
  ev.on('jump', (e) => {
    a.jump();
    if (e.kind !== 'rail' && e.kind !== 'water') fx.dust(e.pos, pl.groundTag, 6, 0.6);
    if (e.kind === 'water') { const w = game.world.waterAt(e.pos.x, e.pos.z); fx.splash(e.pos, w, 0.3); a.swim(); }
  });
  ev.on('land', (e) => {
    a.land(e.impact, e.tag);
    fx.dust(e.pos, e.tag, Math.floor(6 + e.impact * 0.6), clamp(e.impact / 12, 0.4, 1.8));
    if (e.rolled) a.roll();
    if (e.impact > 16) { rig.shake(clamp((e.impact - 16) / 18, 0, 0.8)); input.rumble(clamp(e.impact / 30, 0.2, 1), 0.3, 140); }
    else input.rumble(0.08, 0.15, 60);
  });
  ev.on('skid', () => { a.skid(); fx.dust(pl.pos, pl.groundTag, 8, 0.8); });
  ev.on('slide', () => { a.slide(); fx.dust(pl.pos, pl.groundTag, 6, 0.7); });
  ev.on('grindStart', (e) => {
    a.grindStart(e.rail.kind);
    if (e.rail.kind === 'branch' || e.rail.kind === 'log') fx.leaves(e.pos, 5, pl.vel);
    fx.chips(e.pos, e.rail.kind === 'stone' ? 'stone' : 'bark', 6, pl.vel);
    input.rumble(0.1, 0.4, 90);
  });
  ev.on('railTransfer', () => a.grindStart('bark'));
  ev.on('swingGrab', (e) => { a.vineGrab(); fx.leaves(e.pos.clone().add(new THREE.Vector3(0, 2, 0)), 4); input.rumble(0.2, 0.3, 100); });
  ev.on('swingRelease', (e) => { a.whoosh(clamp(e.speed / 15, 0.5, 1.5)); if (e.jump) a.jump('quiet'); });
  ev.on('wallrun', () => { a.wallrun(); input.rumble(0.05, 0.3, 80); });
  ev.on('wallKick', (e) => { a.jump(); fx.chips(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'bark', 6); });
  ev.on('climb', () => a.mantle());
  ev.on('climbLeap', (e) => { a.jump('quiet'); fx.chips(e.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 'bark', 4); });
  ev.on('mantle', () => a.mantle());
  ev.on('bounce', (e) => {
    a.bounce(e.super ? 1.3 : 1);
    fx.spores(e.pos, e.super ? 24 : 14);
    game.levelView.bounce(e.col, e.super ? 1.4 : 1);
    rig.shake(0.15);
    input.rumble(0.3, 0.5, 120);
  });
  ev.on('splash', (e) => {
    const power = clamp(e.impact / 14, 0.2, 1.6);
    a.splash(power);
    fx.splash(e.pos, e.waterY, power);
    if (e.impact > 12) rig.shake(0.2);
  });
  ev.on('bail', (e) => {
    a.bail();
    fx.dust(e.pos, pl.groundTag, 14, 1.2);
    rig.shake(0.6);
    input.rumble(0.9, 0.6, 300);
  });
  ev.on('flipStart', () => a.whoosh(0.8));
  ev.on('poseStart', () => a.whoosh(0.5));
  ev.on('trick', () => { if (game.settings.scoring !== 'off') a.trickTick(Math.min(game.combo.mult, 9)); });
  ev.on('comboBank', (e) => {
    if (game.settings.scoring === 'off') return;
    a.combo(e.score, e.mult);
    if (e.score > 6000) { game.post.doFlash(0xffd27a, 0.5); input.rumble(0.3, 0.6, 200); }
  });
  ev.on('comboLost', () => a.comboLost());
  ev.on('gap', () => { if (game.settings.scoring !== 'off') a.gap(); });
  ev.on('collect', (e) => {
    a.pickup(e.kind);
    fx.sparkle(e.pos, [1, 0.85, 0.35], 40, 1.4);
    game.post.doFlash(0xfff0b0, 0.6);
    input.rumble(0.2, 0.7, 180);
  });
  ev.on('taunt', () => {
    for (let i = 0; i < 6; i++) setTimeout(() => a.chestPound(), i * 190);
    setTimeout(() => a.yell(), 1050);
  });
}

function perFrameFx(g, dt) {
  const p = g.player, fx = g.particles;
  // Grinding sparks/leaves.
  if (p.state === 'grind' && p.grind.rail) {
    g._grindFx = (g._grindFx || 0) + dt * p.grind.speed;
    while (g._grindFx > 1.2) {
      g._grindFx -= 1.2;
      const kind = p.grind.rail.kind;
      if (kind === 'stone') fx.chips(p.pos, 'stone', 2, p.vel);
      else if (kind === 'branch' || kind === 'log') { fx.chips(p.pos, 'bark', 1, p.vel); if (Math.random() < 0.35) fx.leaves(p.pos, 1, p.vel); }
      else fx.chips(p.pos, 'wood', 1, p.vel);
    }
  }
  // Speed trail from the hands at high speed.
  if (p.speed > 16 && g.settings.speedFx) {
    const c = g.character.joints;
    const v = new THREE.Vector3();
    c.handL.getWorldPosition(v); fx.trail(v, [1, 0.95, 0.75], 0.2);
    c.handR.getWorldPosition(v); fx.trail(v, [1, 0.95, 0.75], 0.2);
  }
  // Swimming strokes.
  if (p.state === 'swim') {
    g._swimT = (g._swimT || 0) - dt;
    if (g._swimT <= 0) {
      g._swimT = 0.55;
      g.audio.swim();
      fx.ripple(p.pos, g.world.waterAt(p.pos.x, p.pos.z));
    }
  }
  // Wall run dust.
  if (p.state === 'wallrun' && Math.random() < dt * 20) fx.chips(p.pos.clone().setY(p.pos.y + 0.2), 'bark', 1);
}

boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-tip');
  if (t) t.textContent = 'Failed to start: ' + e.message;
});
