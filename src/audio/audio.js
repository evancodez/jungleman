// Procedural audio: every sound is synthesized with WebAudio at runtime.
// Buses: sfx, ambience, music → master → compressor → output, with a shared
// reverb send for a sense of jungle space.
import { clamp, rng } from '../core/math.js';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.8, music: 0.45, sfx: 0.85 };
    this.r = rng(17);
    this.loops = {};
    this.musicIntensity = 0;
    this.musicTarget = 0;
    this.nextBeat = 0;
    this.step = 0;
    this.birdT = 2;
    this.callT = 8;
    this.enabled = true;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    this.musBus = ctx.createGain(); this.musBus.connect(this.master);
    // Reverb.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.2);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb);
    this.reverb.connect(this.master);
    // Noise buffers.
    this.white = this.makeNoise('white', 2);
    this.pink = this.makeNoise('pink', 4);
    this.brown = this.makeNoise('brown', 4);
    this.applyVolumes();
    this.startAmbience();
    this.ready = true;
    this.nextBeat = ctx.currentTime + 0.2;
  }

  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.9, t, 0.05);
    this.musBus.gain.setTargetAtTime(this.vol.music * 0.8, t, 0.05);
  }

  makeNoise(kind, seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // ------------------------------------------------------------- primitives
  noise(buf, { t = 0, dur = 0.2, gain = 0.5, type = 'bandpass', freq = 1000, q = 1, freqEnd = null, attack = 0.005, bus = this.sfxBus, rev = 0, pan = 0, rate = 1 } = {}) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, now); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g);
    const out = pan ? this.panner(g, pan) : g;
    out.connect(bus);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; out.connect(s); s.connect(this.revSend); }
    src.start(now, Math.random() * (buf.duration - dur - 0.1));
    src.stop(now + dur + 0.05);
  }

  tone({ t = 0, type = 'sine', freq = 440, freqEnd = null, dur = 0.2, gain = 0.3, attack = 0.005, bus = this.sfxBus, rev = 0, pan = 0, curve = 'exp', vibrato = 0, vibRate = 6, filter = null }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    if (freqEnd) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
      else o.frequency.linearRampToValueAtTime(freqEnd, now + dur);
    }
    if (vibrato) {
      const l = ctx.createOscillator(); const lg = ctx.createGain();
      l.frequency.value = vibRate; lg.gain.value = vibrato;
      l.connect(lg); lg.connect(o.frequency);
      l.start(now); l.stop(now + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass'; f.frequency.value = filter.freq; f.Q.value = filter.q || 1;
      o.connect(f); node = f;
    }
    node.connect(g);
    const out = pan ? this.panner(g, pan) : g;
    out.connect(bus);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; out.connect(s); s.connect(this.revSend); }
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  panner(node, pan) {
    if (!this.ctx.createStereoPanner) return node;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    node.connect(p);
    return p;
  }

  /** Persistent filtered-noise loop with controllable gain/frequency. */
  loop(name, buf, type, freq, q = 1, bus = this.sfxBus) {
    if (this.loops[name]) return this.loops[name];
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(0, Math.random() * buf.duration);
    const L = { src, f, g };
    this.loops[name] = L;
    return L;
  }
  setLoop(name, gain, freq, tc = 0.06) {
    const L = this.loops[name];
    if (!L) return;
    const t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(gain, t, tc);
    if (freq) L.f.frequency.setTargetAtTime(freq, t, tc);
  }

  // ------------------------------------------------------------- ambience
  startAmbience() {
    this.loop('bed', this.brown, 'lowpass', 380, 0.5, this.ambBus);
    this.loop('leaves', this.pink, 'bandpass', 2600, 0.6, this.ambBus);
    this.loop('insects', this.white, 'bandpass', 5200, 8, this.ambBus);
    this.loop('falls', this.pink, 'bandpass', 520, 0.5, this.ambBus);
    this.loop('river', this.pink, 'bandpass', 1500, 0.9, this.ambBus);
    this.loop('wind', this.pink, 'lowpass', 300, 0.8, this.sfxBus);
    this.loop('grind', this.white, 'bandpass', 1200, 1.2, this.sfxBus);
    this.loop('grind2', this.brown, 'lowpass', 500, 1, this.sfxBus);
    // Insect amplitude LFO.
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 32; lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(this.loops.insects.g.gain);
    lfo.start();
  }

  /** Called every frame. env: {speed, grind:{active,speed,kind}, waterfallDist, riverDist, playing, intensity} */
  update(dt, env) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amb = env.playing ? 1 : 0.7;
    this.setLoop('bed', 0.18 * amb, null, 0.5);
    this.setLoop('leaves', (0.02 + Math.sin(t * 0.3) * 0.012) * amb, 2200 + Math.sin(t * 0.17) * 600, 0.5);
    this.setLoop('insects', (0.012 + Math.max(0, Math.sin(t * 0.11)) * 0.02) * amb, null, 0.8);
    const fd = env.waterfallDist ?? 200;
    this.setLoop('falls', clamp(1 - fd / 90, 0, 1) ** 2 * 0.65, 420 + clamp(1 - fd / 90, 0, 1) * 300, 0.3);
    const rd = env.riverDist ?? 200;
    this.setLoop('river', clamp(1 - rd / 28, 0, 1) ** 2 * 0.12, null, 0.3);
    // Wind rush with speed.
    const sp = env.speed || 0;
    const wn = clamp((sp - 6) / 22, 0, 1);
    this.setLoop('wind', env.playing ? wn * wn * 0.5 + (env.airborne ? 0.03 : 0) : 0, 250 + wn * 1800, 0.12);
    // Grinding.
    const g = env.grind;
    if (g && g.active) {
      const k = clamp(g.speed / 18, 0.2, 1);
      const spec = GRIND_SOUND[g.kind] || GRIND_SOUND.bark;
      this.setLoop('grind', spec.gain * k, spec.freq * (0.8 + k * 0.5), 0.04);
      this.setLoop('grind2', spec.low * k, spec.lowFreq, 0.04);
    } else {
      this.setLoop('grind', 0, null, 0.05);
      this.setLoop('grind2', 0, null, 0.05);
    }
    // Birds and calls.
    if (env.playing || env.menu) {
      this.birdT -= dt;
      if (this.birdT <= 0) { this.bird(); this.birdT = 1.2 + this.r() * 4.5; }
      this.callT -= dt;
      if (this.callT <= 0) { this.distantCall(); this.callT = 9 + this.r() * 14; }
    }
    this.updateMusic(dt, env);
  }

  bird() {
    const R = this.r;
    const kind = Math.floor(R() * 4);
    const pan = (R() - 0.5) * 1.6;
    const base = 1800 + R() * 2200;
    const g = 0.03 + R() * 0.035;
    if (kind === 0) {
      // Rising whistle pair.
      for (let i = 0; i < 2; i++) this.tone({ t: i * 0.22, freq: base, freqEnd: base * 1.5, dur: 0.16, gain: g, bus: this.ambBus, rev: 0.6, pan });
    } else if (kind === 1) {
      // Trill.
      const n = 5 + Math.floor(R() * 6);
      for (let i = 0; i < n; i++) this.tone({ t: i * 0.055, freq: base * (1 + (i % 2) * 0.12), freqEnd: base * 0.9, dur: 0.05, gain: g * 0.8, bus: this.ambBus, rev: 0.6, pan });
    } else if (kind === 2) {
      // Descending call.
      this.tone({ freq: base * 1.4, freqEnd: base * 0.7, dur: 0.35, gain: g, bus: this.ambBus, rev: 0.7, pan, vibrato: 60, vibRate: 25 });
    } else {
      // Two-tone hoot (dove-ish).
      this.tone({ freq: 520, freqEnd: 480, dur: 0.35, gain: g * 0.9, bus: this.ambBus, rev: 0.8, pan, type: 'sine' });
      this.tone({ t: 0.45, freq: 440, freqEnd: 420, dur: 0.5, gain: g * 0.9, bus: this.ambBus, rev: 0.8, pan, type: 'sine' });
    }
  }

  distantCall() {
    // Far-off monkey hoots.
    const R = this.r;
    const pan = (R() - 0.5) * 1.8;
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const f = 380 + i * 40 + R() * 30;
      this.tone({ t: i * 0.18, type: 'triangle', freq: f, freqEnd: f * 1.25, dur: 0.16, gain: 0.025, bus: this.ambBus, rev: 1.2, pan, filter: { type: 'lowpass', freq: 1200 } });
    }
  }

  // ------------------------------------------------------------- music
  setIntensity(x) { this.musicTarget = clamp(x, 0, 1); }

  updateMusic(dt, env) {
    if (this.vol.music <= 0.001) return;
    const ctx = this.ctx;
    this.musicIntensity += (this.musicTarget - this.musicIntensity) * Math.min(1, dt * 0.8);
    const I = env.playing ? this.musicIntensity : 0.15;
    const bpm = 100;
    const s16 = 60 / bpm / 4;
    while (this.nextBeat < ctx.currentTime + 0.12) {
      const t = this.nextBeat - ctx.currentTime;
      const st = this.step % 32;
      const R = this.r;
      // Kalimba melody (always, sparse when calm).
      if (st % 2 === 0 && R() < 0.22 + I * 0.4) {
        const deg = PENTA[Math.floor(R() * (5 + I * 4))];
        const f = 220 * Math.pow(2, (deg + 3) / 12);
        this.tone({ t, type: 'sine', freq: f, dur: 0.6, gain: 0.05, bus: this.musBus, rev: 0.5, pan: (R() - 0.5) * 0.6 });
        this.tone({ t, type: 'sine', freq: f * 4.02, dur: 0.15, gain: 0.012, bus: this.musBus, rev: 0.3 });
      }
      if (I > 0.25) {
        // Low toms.
        const tomPat = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
        if (tomPat[st % 16]) this.tone({ t, freq: 140, freqEnd: 60, dur: 0.35, gain: 0.16 * I, bus: this.musBus });
        if (st % 16 === 12 && I > 0.5) this.tone({ t, freq: 190, freqEnd: 90, dur: 0.25, gain: 0.1 * I, bus: this.musBus });
      }
      if (I > 0.45) {
        // Shaker 16ths with accents.
        const acc = st % 4 === 2 ? 1 : 0.45;
        this.noise(this.white, { t, dur: 0.05, gain: 0.03 * acc * I, type: 'highpass', freq: 6000, q: 0.7, bus: this.musBus });
      }
      if (I > 0.6) {
        // Bass pluck on root/fifth.
        const bassPat = { 0: 55, 6: 55, 10: 82.4, 16: 49, 22: 49, 26: 73.4 };
        const bf = bassPat[st];
        if (bf) this.tone({ t, type: 'triangle', freq: bf, dur: 0.4, gain: 0.12 * I, bus: this.musBus, filter: { type: 'lowpass', freq: 400 } });
        // Clave.
        const clave = [0, 3, 6, 10, 12];
        if (clave.includes(st % 16)) this.tone({ t, type: 'square', freq: 1800, dur: 0.03, gain: 0.015 * I, bus: this.musBus, filter: { type: 'bandpass', freq: 2200, q: 4 } });
      }
      this.nextBeat += s16;
      this.step++;
    }
  }

  // ------------------------------------------------------------- sfx
  footstep(tag, speed) {
    if (!this.ready) return;
    const k = clamp(speed / 12, 0.3, 1);
    const R = this.r;
    const v = 0.9 + R() * 0.2;
    switch (tag) {
      case 'wood': case 'thatch':
        this.tone({ freq: 180 * v, freqEnd: 120, dur: 0.07, gain: 0.12 * k, type: 'triangle' });
        this.noise(this.white, { dur: 0.05, gain: 0.05 * k, freq: 1400 * v, q: 2 });
        break;
      case 'stone': case 'rock':
        this.noise(this.white, { dur: 0.04, gain: 0.07 * k, type: 'highpass', freq: 2200 * v });
        this.tone({ freq: 110, freqEnd: 70, dur: 0.05, gain: 0.08 * k });
        break;
      case 'mud': case 'sand':
        this.noise(this.brown, { dur: 0.12, gain: 0.25 * k, type: 'lowpass', freq: 700 * v, freqEnd: 300 });
        break;
      case 'bark':
        this.noise(this.white, { dur: 0.06, gain: 0.06 * k, freq: 900 * v, q: 1.5 });
        this.tone({ freq: 140, freqEnd: 90, dur: 0.06, gain: 0.08 * k });
        break;
      default:
        this.noise(this.pink, { dur: 0.08, gain: 0.12 * k, type: 'lowpass', freq: 1300 * v, freqEnd: 500 });
        this.tone({ freq: 90, freqEnd: 55, dur: 0.07, gain: 0.08 * k });
        if (R() < 0.4) this.noise(this.white, { t: 0.02, dur: 0.06, gain: 0.025 * k, freq: 3500, q: 1 }); // leaf crunch
    }
  }

  jump(kind) {
    if (!this.ready) return;
    this.noise(this.pink, { dur: 0.22, gain: 0.12, freq: 500, freqEnd: 1600, q: 1.5 });
    if (kind !== 'quiet') this.noise(this.white, { dur: 0.09, gain: 0.03, freq: 900, q: 3, attack: 0.01 }); // breath
  }

  land(impact, tag) {
    if (!this.ready) return;
    const k = clamp(impact / 20, 0.15, 1.2);
    this.tone({ freq: 95, freqEnd: 40, dur: 0.2 + k * 0.1, gain: 0.25 * k });
    this.footstep(tag, 12 * k);
    if (k > 0.6) this.noise(this.brown, { dur: 0.3, gain: 0.2 * k, type: 'lowpass', freq: 600, freqEnd: 150 });
  }

  roll() { if (this.ready) this.noise(this.pink, { dur: 0.45, gain: 0.12, type: 'lowpass', freq: 1200, freqEnd: 300 }); }
  slide() { if (this.ready) this.noise(this.pink, { dur: 0.5, gain: 0.1, type: 'bandpass', freq: 900, freqEnd: 500, q: 0.8 }); }
  skid() { if (this.ready) this.noise(this.white, { dur: 0.35, gain: 0.08, type: 'bandpass', freq: 1800, freqEnd: 900, q: 1.2 }); }

  whoosh(power = 1) {
    if (!this.ready) return;
    this.noise(this.pink, { dur: 0.3, gain: 0.1 * power, freq: 700, freqEnd: 2600, q: 2.5 });
  }

  grindStart(kind) {
    if (!this.ready) return;
    const spec = GRIND_SOUND[kind] || GRIND_SOUND.bark;
    this.noise(this.white, { dur: 0.12, gain: 0.12, freq: spec.freq * 1.5, q: 1.5 });
    this.tone({ freq: kind === 'stone' ? 900 : 220, freqEnd: kind === 'stone' ? 600 : 140, dur: 0.1, gain: 0.08, type: 'triangle' });
  }

  creak() {
    if (!this.ready) return;
    const f = 160 + this.r() * 80;
    this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 1.4, dur: 0.25, gain: 0.04, vibrato: 25, vibRate: 30, filter: { type: 'bandpass', freq: 700, q: 3 }, rev: 0.2 });
  }

  vineGrab() {
    if (!this.ready) return;
    this.noise(this.pink, { dur: 0.12, gain: 0.12, freq: 1800, q: 1 });
    this.creak();
  }

  bounce(power = 1) {
    if (!this.ready) return;
    this.tone({ freq: 160, freqEnd: 520 * power, dur: 0.35, gain: 0.18, vibrato: 18, vibRate: 22, curve: 'exp' });
    this.tone({ freq: 70, freqEnd: 40, dur: 0.15, gain: 0.2 });
  }

  splash(power = 1) {
    if (!this.ready) return;
    const k = clamp(power, 0.3, 1.5);
    this.noise(this.white, { dur: 0.6 * k, gain: 0.25 * k, type: 'lowpass', freq: 3500, freqEnd: 400, rev: 0.3 });
    this.tone({ freq: 120, freqEnd: 50, dur: 0.25, gain: 0.2 * k });
    for (let i = 0; i < 6; i++) this.tone({ t: 0.08 + i * 0.07 * this.r(), freq: 500 + this.r() * 900, freqEnd: 900 + this.r() * 1200, dur: 0.06, gain: 0.03 });
  }

  swim() { if (this.ready) this.noise(this.pink, { dur: 0.3, gain: 0.06, type: 'bandpass', freq: 900, freqEnd: 400 }); }

  mantle() {
    if (!this.ready) return;
    this.noise(this.pink, { dur: 0.15, gain: 0.08, freq: 600, q: 1 });
    this.noise(this.white, { t: 0.05, dur: 0.06, gain: 0.04, freq: 1100, q: 4, attack: 0.01 });
  }

  wallrun() { if (this.ready) this.noise(this.white, { dur: 0.25, gain: 0.07, type: 'bandpass', freq: 1300, freqEnd: 2200, q: 1.5 }); }

  bail() {
    if (!this.ready) return;
    this.tone({ freq: 110, freqEnd: 40, dur: 0.4, gain: 0.3 });
    this.noise(this.brown, { dur: 0.4, gain: 0.3, type: 'lowpass', freq: 900, freqEnd: 200 });
    this.tone({ t: 0.05, type: 'sawtooth', freq: 180, freqEnd: 120, dur: 0.22, gain: 0.05, filter: { type: 'bandpass', freq: 650, q: 4 } }); // "oof"
  }

  combo(points, mult) {
    if (!this.ready) return;
    const notes = clamp(Math.floor(Math.log2(1 + points / 400)) + 1, 1, 7);
    const root = 523.25;
    for (let i = 0; i < notes; i++) {
      const f = root * Math.pow(2, PENTA[i] / 12);
      this.tone({ t: i * 0.07, type: 'triangle', freq: f, dur: 0.35, gain: 0.07, rev: 0.4 });
      this.tone({ t: i * 0.07, type: 'sine', freq: f * 2, dur: 0.2, gain: 0.025, rev: 0.4 });
    }
    void mult;
  }

  trickTick(n = 0) {
    if (!this.ready) return;
    const f = 660 * Math.pow(2, PENTA[Math.min(n, PENTA.length - 1)] / 12);
    this.tone({ type: 'triangle', freq: f, dur: 0.12, gain: 0.035 });
  }

  comboLost() {
    if (!this.ready) return;
    this.tone({ type: 'triangle', freq: 330, freqEnd: 165, dur: 0.4, gain: 0.07 });
  }

  pickup(kind) {
    if (!this.ready) return;
    const seq = kind === 'letter' ? [0, 4, 7, 12, 16] : [0, 7, 12, 19];
    seq.forEach((s, i) => {
      const f = 880 * Math.pow(2, s / 12);
      this.tone({ t: i * 0.06, freq: f, dur: 0.4, gain: 0.07, rev: 0.6 });
      this.tone({ t: i * 0.06, type: 'triangle', freq: f * 2.01, dur: 0.15, gain: 0.02, rev: 0.6 });
    });
  }

  gap() {
    if (!this.ready) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone({ t: i * 0.09, type: 'square', freq: 392 * Math.pow(2, s / 12), dur: 0.22, gain: 0.03, filter: { type: 'lowpass', freq: 2400 }, rev: 0.3 }));
  }

  chestPound(i = 0) {
    if (!this.ready) return;
    this.tone({ t: i * 0.0, freq: 110, freqEnd: 60, dur: 0.15, gain: 0.25 });
    this.noise(this.brown, { dur: 0.08, gain: 0.2, type: 'lowpass', freq: 500 });
  }

  /** The jungle call: a yodelling vowel-formant voice. */
  yell() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const pat = [[0, 300], [0.25, 300], [0.32, 470], [0.5, 470], [0.56, 300], [0.72, 300], [0.78, 470], [0.95, 470], [1.0, 330], [1.35, 260]];
    o.frequency.setValueAtTime(pat[0][1], now);
    for (const [t, f] of pat) o.frequency.linearRampToValueAtTime(f, now + t);
    const vib = ctx.createOscillator(); const vg = ctx.createGain();
    vib.frequency.value = 6.5; vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8;
    // "aah" (800/1200) -> "ee" (300/2300) yodel.
    const vow = [[0, 800, 1200], [0.3, 400, 2200], [0.55, 800, 1200], [0.75, 400, 2200], [1.0, 750, 1150], [1.35, 650, 1000]];
    f1.frequency.setValueAtTime(800, now); f2.frequency.setValueAtTime(1200, now);
    for (const [t, a, b] of vow) { f1.frequency.linearRampToValueAtTime(a, now + t); f2.frequency.linearRampToValueAtTime(b, now + t); }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.06);
    g.gain.setValueAtTime(0.16, now + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);
    o.connect(f1); o.connect(f2);
    f1.connect(g); f2.connect(g);
    g.connect(this.sfxBus);
    const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(this.revSend);
    o.start(now); vib.start(now);
    o.stop(now + 1.5); vib.stop(now + 1.5);
  }

  ui(kind) {
    if (!this.ready) return;
    if (kind === 'move') this.tone({ type: 'triangle', freq: 880, dur: 0.05, gain: 0.03, bus: this.master });
    else if (kind === 'confirm') { this.tone({ type: 'triangle', freq: 660, dur: 0.08, gain: 0.05, bus: this.master }); this.tone({ t: 0.06, type: 'triangle', freq: 990, dur: 0.12, gain: 0.05, bus: this.master }); }
    else if (kind === 'back') this.tone({ type: 'triangle', freq: 520, freqEnd: 390, dur: 0.12, gain: 0.05, bus: this.master });
    else if (kind === 'adjust') this.tone({ type: 'sine', freq: 740, dur: 0.04, gain: 0.03, bus: this.master });
  }
}

const GRIND_SOUND = {
  bark: { gain: 0.09, freq: 900, low: 0.12, lowFreq: 300 },
  log: { gain: 0.08, freq: 700, low: 0.15, lowFreq: 250 },
  rope: { gain: 0.05, freq: 1500, low: 0.06, lowFreq: 400 },
  stone: { gain: 0.11, freq: 3200, low: 0.06, lowFreq: 600 },
  thatch: { gain: 0.08, freq: 2200, low: 0.05, lowFreq: 500 },
  zip: { gain: 0.07, freq: 2600, low: 0.05, lowFreq: 700 },
  wood: { gain: 0.08, freq: 1100, low: 0.1, lowFreq: 350 },
};
