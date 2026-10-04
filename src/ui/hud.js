// In-game HUD: score, combo chain, flow meter, popups, collectibles and
// context-sensitive button prompts that match the active input device.
import { GLYPHS } from '../core/input.js';
import { POSE_NAMES } from '../player/player.js';

const PS_CLASS = { '✕': 'cross', '○': 'circle', '□': 'square', '△': 'triangle' };

export function glyph(input, action) {
  const dev = input.lastDevice === 'gamepad' ? input.padType : 'kbm';
  const label = GLYPHS[dev][action] || action;
  if (dev === 'ps') {
    const cls = PS_CLASS[label];
    if (cls) return `<span class="g ps ${cls}">${label}</span>`;
    return `<span class="g ps wide">${label}</span>`;
  }
  return label.split(' / ').map((l) => `<span class="g">${l}</span>`).join('<span style="opacity:.6">/</span>');
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class Hud {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-score"><span class="sv">0</span><small>SCORE</small></div>
      <div class="hud-timer" style="display:none"></div>
      <div class="hud-collect"><div class="letters"></div><div class="idols"></div></div>
      <div class="popups"></div>
      <div class="combo hidden">
        <div class="combo-list"></div>
        <div class="combo-score"></div>
        <div class="flow"><div></div></div>
      </div>
      <div class="current" style="position:absolute;left:50%;transform:translateX(-50%);bottom:calc(9vh + 120px)"></div>
      <div class="prompts"></div>
      <div class="fps"></div>`;
    root.appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this.scoreEl = this.$('.sv');
    this.scoreBox = this.$('.hud-score');
    this.timerEl = this.$('.hud-timer');
    this.lettersEl = this.$('.letters');
    this.idolsEl = this.$('.idols');
    this.popEl = this.$('.popups');
    this.comboEl = this.$('.combo');
    this.listEl = this.$('.combo-list');
    this.cscoreEl = this.$('.combo-score');
    this.flowEl = this.$('.flow > div');
    this.currentEl = this.$('.current');
    this.promptEl = this.$('.prompts');
    this.fpsEl = this.$('.fps');
    this.cache = {};
    this.promptT = 0;
    this.shownTotal = 0;
    this.lastListLen = -1;
    this.timer = null;
    const ev = game.events;
    ev.on('comboUpdate', () => { this.lastListLen = -1; });
    ev.on('comboBank', (e) => {
      if (this.mode() !== 'full') return;
      if (e.praise) this.popup(e.praise, 'big');
      this.popup('+' + fmt(e.score), 'med');
    });
    ev.on('comboLost', () => { if (this.mode() !== 'off') this.popup('BAIL!', 'bad'); });
    ev.on('bail', () => { if (this.mode() === 'off') this.popup('OOF!', 'bad'); });
    ev.on('gap', (e) => { if (this.mode() !== 'off') this.popup(`${e.name} Gap${e.first ? '  — NEW!' : ''}`, 'gap'); });
    ev.on('collect', (e) => {
      this.renderCollect(e.counts);
      if (e.kind === 'letter') this.popup(`Letter ${e.label}!`, 'collect');
      else this.popup(`Golden Idol ${e.counts.idols}/${e.counts.idolsTotal}`, 'collect');
      if (e.kind === 'letter' && e.counts.letters.length === e.counts.lettersTotal) this.popup('J-U-N-G-L-E COMPLETE!', 'big');
    });
  }

  mode() { return this.game.settings.scoring; }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  banner(title, sub) {
    const d = document.createElement('div');
    d.className = 'banner';
    d.innerHTML = `<div class="bt">${title}</div><div class="bs">${sub}</div>`;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  popup(text, cls) {
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    this.popEl.appendChild(d);
    while (this.popEl.children.length > 4) this.popEl.firstChild.remove();
    setTimeout(() => d.remove(), 1900);
  }

  renderCollect(c) {
    const order = ['J', 'U', 'N', 'G', 'L', 'E'];
    this.lettersEl.innerHTML = order.map((l) => `<span class="${c.letters.includes(l) ? 'on' : ''}">${l}</span>`).join('');
    this.idolsEl.innerHTML = `Idols <b>${c.idols}</b> / ${c.idolsTotal}`;
  }

  update(dt) {
    const g = this.game;
    const combo = g.combo;
    const mode = this.mode();
    const full = mode === 'full';
    this.scoreBox.style.display = full ? '' : 'none';
    // Smoothly count the total up.
    this.shownTotal += (combo.total - this.shownTotal) * Math.min(1, dt * 8);
    if (Math.abs(combo.total - this.shownTotal) < 1) this.shownTotal = combo.total;
    this.set('score', this.scoreEl, 'textContent', fmt(this.shownTotal));

    // Timer (score attack).
    if (this.timer !== null) {
      const t = Math.max(0, this.timer);
      const s = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      this.timerEl.style.display = '';
      this.set('timer', this.timerEl, 'textContent', s);
      this.timerEl.classList.toggle('low', t < 10);
    } else this.timerEl.style.display = 'none';

    // Combo panel.
    const showCombo = mode !== 'off' && combo.active;
    this.comboEl.classList.toggle('hidden', !showCombo);
    if (showCombo) {
      if (combo.list.length !== this.lastListLen) {
        this.lastListLen = combo.list.length;
        const items = combo.list.slice(-7);
        this.listEl.innerHTML = items.map((t, i) => `<span class="t ${i === items.length - 1 ? 'new' : ''} ${t.kind === 'gap' ? 'gap' : ''}">${t.name}</span>`).join('<span class="sep">+</span>');
      }
      const cs = full ? `${fmt(combo.base)}<span class="x">×</span>${combo.mult}` : '';
      this.set('cscore', this.cscoreEl, 'innerHTML', cs);
      this.flowEl.style.transform = `scaleX(${combo.flowFraction})`;
    }

    // Live trick (current state).
    let cur = '';
    if (mode !== 'off') {
      const p = g.player;
      if (p.state === 'grind' && p.grind.rail) cur = `${p.grind.rail.name}  ${p.grind.dist.toFixed(1)}m`;
      else if (p.state === 'swing') cur = 'Vine Swing';
      else if (p.state === 'wallrun') cur = p.wall.type === 'spiral' ? 'Trunk Spiral' : p.wall.type === 'flat' ? 'Wall Run' : 'Trunk Run';
      else if (p.state === 'air' && p.pose.active) cur = `${POSE_NAMES[p.pose.type]}  ${p.pose.time.toFixed(1)}s`;
    }
    this.set('cur', this.currentEl, 'textContent', cur);

    // Prompts.
    this.promptT -= dt;
    if (this.promptT <= 0) {
      this.promptT = 0.15;
      const html = g.settings.prompts ? this.prompts() : '';
      this.set('prompts', this.promptEl, 'innerHTML', html);
    }
    this.set('fps', this.fpsEl, 'textContent', g.showFps ? `${g.fps.toFixed(0)} fps` : '');
  }

  prompts() {
    const g = this.game, p = g.player, i = g.input;
    const P = (a, text) => `<div class="prompt">${glyph(i, a)} ${text}</div>`;
    const out = [];
    switch (p.state) {
      case 'grind':
        if (p.grind.rail && p.grind.rail.hang) out.push(P('jump', 'Drop'));
        else out.push(P('jump', 'Jump off'), P('trick', 'Flip grind'), P('spinR', 'Switch'));
        break;
      case 'swing':
        out.push(P('jump', 'Release (time it!)'), P('trick', 'Vine flip'), `<div class="prompt">${glyph(i, 'move')} Pump the swing</div>`);
        break;
      case 'climb':
        out.push(`<div class="prompt">${glyph(i, 'move')} Climb</div>`, P('jump', 'Up + Jump: leap · Jump: kick off'), P('grab', 'Let go'));
        break;
      case 'wallrun':
        out.push(P('jump', 'Wall kick'));
        break;
      case 'swim':
        out.push(P('jump', 'Hop out'));
        break;
      case 'air': {
        const near = this.nearGrab();
        if (near) out.push(P('grab', near));
        if (p.airTime > 0.15 && !p.flip.active && !p.pose.active) out.push(P('trick', 'Flip'), P('slide', 'Pose (hold)'));
        break;
      }
      case 'ground': {
        const near = this.nearGrab(true);
        if (near) out.push(P('grab', near));
        if (p.hspeed > 6 && !p.sliding) out.push(P('slide', 'Slide'));
        if (p.sliding) out.push(P('jump', 'Long jump'));
        break;
      }
    }
    return out.join('');
  }

  nearGrab(ground = false) {
    const g = this.game, p = g.player;
    const hand = p.pos.clone(); hand.y += 2;
    const v = g.vines.findGrab(hand, ground ? 1.4 : 3.2);
    if (v) return 'Grab vine';
    const r = g.rails.findSnap(p.pos, p.vel, ground ? { reachH: 1.4, upReach: 1.5, downReach: 0.6 } : { reachH: 2.6, upReach: 1.6, downReach: 2.6 });
    if (r) return r.rail.hang ? 'Zip vine' : 'Grind';
    return null;
  }
}
