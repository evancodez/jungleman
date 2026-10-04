// Menu system: title, main menu, pause, settings, controls, gaps & results.
// Every screen is navigable with keyboard, mouse and gamepad.
import { glyph } from './hud.js';
import { GLYPHS } from '../core/input.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * Generic list menu. items: {type, label, ...}
 *  button: {action}
 *  toggle: {get, set}
 *  choice: {options:[[value,label]], get, set}
 *  slider: {min, max, step, get, set, fmt}
 *  header: {}
 */
class ListScreen {
  constructor(ui, { title, items, onBack, className = '', footer = '', extra = '' }) {
    this.ui = ui;
    this.items = items;
    this.onBack = onBack;
    this.el = document.createElement('div');
    this.el.className = 'screen dim';
    this.el.innerHTML = `<div class="panel ${className}">${title ? `<h3>${title}</h3>` : ''}${extra}<div class="items"></div>${footer}<div class="hint"></div></div>`;
    this.list = this.el.querySelector('.items');
    this.focus = items.findIndex((i) => i.type !== 'header' && !i.disabled);
    this.render();
  }
  render() {
    this.list.innerHTML = '';
    this.rows = this.items.map((it, idx) => {
      const d = document.createElement('div');
      d.className = 'item' + (it.type === 'header' ? ' header' : '') + (it.disabled ? ' disabled' : '');
      d.innerHTML = this.rowHtml(it);
      if (it.type !== 'header' && !it.disabled) {
        d.addEventListener('mouseenter', () => { if (this.focus !== idx) { this.focus = idx; this.updateFocus(); this.ui.sound('move'); } });
        d.addEventListener('click', (e) => this.click(idx, e, d));
      }
      this.list.appendChild(d);
      return d;
    });
    this.updateFocus();
    this.renderHint();
  }
  rowHtml(it) {
    if (it.type === 'header') return it.label;
    let val = '';
    if (it.type === 'toggle') val = `<span class="arrow">◀</span>${it.get() ? 'On' : 'Off'}<span class="arrow">▶</span>`;
    else if (it.type === 'choice') {
      const cur = it.get();
      const o = it.options.find((x) => x[0] === cur) || it.options[0];
      val = `<span class="arrow">◀</span>${o[1]}<span class="arrow">▶</span>`;
    } else if (it.type === 'slider') {
      const v = it.get();
      const f = (v - it.min) / (it.max - it.min);
      val = `<div class="slider"><div style="width:${(f * 100).toFixed(1)}%"></div></div><span style="min-width:44px;text-align:right">${it.fmt ? it.fmt(v) : v.toFixed(2)}</span>`;
    } else if (it.value) val = it.value();
    return `<span>${it.label}</span><span class="val">${val}</span>`;
  }
  refreshRow(idx) { this.rows[idx].innerHTML = this.rowHtml(this.items[idx]); }
  renderHint() {
    const i = this.ui.game.input;
    const h = this.el.querySelector('.hint');
    const dev = i.lastDevice;
    const confirm = dev === 'gamepad' ? glyph(i, 'jump') : '<span class="g">Enter</span>';
    const back = dev === 'gamepad' ? (i.padType === 'ps' ? '<span class="g ps circle">○</span>' : '<span class="g">B</span>') : '<span class="g">Esc</span>';
    h.innerHTML = `<span>${confirm} Select</span>${this.onBack ? `<span>${back} Back</span>` : ''}<span><span class="g">◀ ▶</span> Adjust</span>`;
    this.hintDev = dev;
  }
  updateFocus() {
    this.rows.forEach((r, i) => r.classList.toggle('focus', i === this.focus));
    const r = this.rows[this.focus];
    if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
  }
  move(d) {
    const n = this.items.length;
    let i = this.focus;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      const it = this.items[i];
      if (it.type !== 'header' && !it.disabled) break;
    }
    if (i !== this.focus) { this.focus = i; this.updateFocus(); this.ui.sound('move'); }
  }
  adjust(d) {
    const it = this.items[this.focus];
    if (!it) return;
    if (it.type === 'toggle') it.set(!it.get());
    else if (it.type === 'choice') {
      const idx = it.options.findIndex((o) => o[0] === it.get());
      const n = it.options.length;
      it.set(it.options[(idx + d + n) % n][0]);
    } else if (it.type === 'slider') {
      const v = Math.min(it.max, Math.max(it.min, Math.round((it.get() + d * it.step) / it.step) * it.step));
      it.set(+v.toFixed(3));
    } else return;
    this.refreshRow(this.focus);
    this.ui.sound('adjust');
  }
  activate() {
    const it = this.items[this.focus];
    if (!it) return;
    if (it.type === 'button') { this.ui.sound('confirm'); it.action(); }
    else if (it.type === 'toggle' || it.type === 'choice') this.adjust(1);
  }
  click(idx, e, row) {
    this.focus = idx;
    this.updateFocus();
    const it = this.items[idx];
    if (it.type === 'slider') {
      const s = row.querySelector('.slider');
      const r = s.getBoundingClientRect();
      if (e.clientX >= r.left - 10) {
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const v = it.min + f * (it.max - it.min);
        it.set(+(Math.round(v / it.step) * it.step).toFixed(3));
        this.refreshRow(idx);
        this.ui.sound('adjust');
      }
      return;
    }
    if (it.type === 'toggle' || it.type === 'choice') {
      const r = row.getBoundingClientRect();
      this.adjust(e.clientX < r.left + r.width * 0.5 && it.type === 'choice' ? -1 : 1);
      return;
    }
    this.activate();
  }
  nav(ev) {
    if (ev === 'up') this.move(-1);
    else if (ev === 'down') this.move(1);
    else if (ev === 'left') this.adjust(-1);
    else if (ev === 'right') this.adjust(1);
    else if (ev === 'confirm') this.activate();
    else if ((ev === 'back' || ev === 'start') && this.onBack) { this.ui.sound('back'); this.onBack(); }
  }
  tick() { if (this.ui.game.input.lastDevice !== this.hintDev) this.renderHint(); }
}

/** Static info screen (controls, gaps) with a single Back action. */
class InfoScreen extends ListScreen {
  constructor(ui, { title, html, onBack, className = '' }) {
    super(ui, { title, items: [{ type: 'button', label: 'Back', action: onBack }], onBack, className, extra: `<div class="info">${html}</div>` });
  }
}

export class Menus {
  constructor(root, game, hooks) {
    this.root = root;
    this.game = game;
    this.hooks = hooks; // {startFree, startAttack, resume, restart, quitToTitle, onSettingsChanged}
    this.stack = [];
    this.titleEl = null;
  }

  sound(kind) { if (this.hooks.sound) this.hooks.sound(kind); }

  get open() { return this.stack.length > 0 || !!this.titleEl; }

  push(screen) {
    if (this.stack.length) this.stack[this.stack.length - 1].el.style.display = 'none';
    this.stack.push(screen);
    this.root.appendChild(screen.el);
  }
  pop() {
    const s = this.stack.pop();
    if (s) s.el.remove();
    if (this.stack.length) this.stack[this.stack.length - 1].el.style.display = '';
  }
  clear() {
    while (this.stack.length) this.pop();
    if (this.titleEl) { this.titleEl.remove(); this.titleEl = null; }
  }

  nav(events) {
    if (this.titleEl && !this.stack.length) {
      if (events.length || this.game.input.takeAny()) { this.sound('confirm'); this.showMain(); }
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    for (const e of events) top.nav(e);
    top.tick();
  }

  // ---------------------------------------------------------------- screens
  showTitle() {
    this.clear();
    const el = document.createElement('div');
    el.className = 'screen title';
    el.innerHTML = `<div class="logo"><h1>JUNGLE MAN</h1><h2>Untamed Movement</h2></div><div class="press">Press any button</div>`;
    el.addEventListener('click', () => { this.sound('confirm'); this.showMain(); });
    this.root.appendChild(el);
    this.titleEl = el;
    this.game.input.clearNav();
  }

  showMain() {
    if (this.titleEl) { this.titleEl.querySelector('.press').style.display = 'none'; this.titleEl.classList.add('menu-open'); }
    while (this.stack.length) this.pop();
    const best = this.game.save.bestScore || 0;
    const s = new ListScreen(this, {
      title: '',
      className: 'menu-main',
      items: [
        { type: 'button', label: 'Free Roam', action: () => this.hooks.startFree() },
        { type: 'button', label: 'Score Attack', action: () => this.hooks.startAttack() },
        { type: 'button', label: 'Controls', action: () => this.showControls(() => this.pop()) },
        { type: 'button', label: 'Settings', action: () => this.showSettings(() => this.pop()) },
        { type: 'button', label: 'Gaps & Secrets', action: () => this.showGaps(() => this.pop()) },
      ],
      onBack: () => { this.pop(); if (this.titleEl) { this.titleEl.querySelector('.press').style.display = ''; this.titleEl.classList.remove('menu-open'); } },
      footer: `<div class="small-note">Score Attack best: <b>${fmt(best)}</b></div>`,
    });
    s.el.classList.remove('dim');
    s.el.style.alignItems = 'flex-end';
    s.el.style.paddingBottom = '7vh';
    s.el.style.boxSizing = 'border-box';
    this.push(s);
  }

  showPause() {
    const s = new ListScreen(this, {
      title: 'Paused',
      items: [
        { type: 'button', label: 'Resume', action: () => this.hooks.resume() },
        { type: 'button', label: 'Back to Last Safe Spot', action: () => this.hooks.restart(false) },
        { type: 'button', label: 'Restart at Spawn', action: () => this.hooks.restart(true) },
        { type: 'button', label: 'Gaps & Secrets', action: () => this.showGaps(() => this.pop()) },
        { type: 'button', label: 'Controls', action: () => this.showControls(() => this.pop()) },
        { type: 'button', label: 'Settings', action: () => this.showSettings(() => this.pop()) },
        { type: 'button', label: 'Quit to Title', action: () => this.hooks.quitToTitle() },
      ],
      onBack: () => this.hooks.resume(),
    });
    this.push(s);
  }

  showSettings(onBack) {
    const g = this.game;
    const S = g.settings;
    const set = (k) => (v) => { S[k] = v; g.saveSettings(); if (this.hooks.onSettingsChanged) this.hooks.onSettingsChanged(k); };
    const get = (k) => () => S[k];
    const pct = (v) => `${Math.round(v * 100)}%`;
    let screen;
    const items = [
      { type: 'header', label: 'Gameplay' },
      { type: 'choice', label: 'Trick Scoring', options: [['full', 'Full'], ['names', 'Names Only'], ['off', 'Off']], get: get('scoring'), set: set('scoring') },
      { type: 'toggle', label: 'Grind Assist (auto-catch)', get: get('autoGrind'), set: set('autoGrind') },
      { type: 'toggle', label: 'Button Prompts', get: get('prompts'), set: set('prompts') },
      { type: 'header', label: 'Camera & Controls' },
      { type: 'toggle', label: 'Auto Camera', get: get('autoCam'), set: set('autoCam') },
      { type: 'slider', label: 'Mouse Sensitivity', min: 0.2, max: 3, step: 0.1, get: get('mouseSens'), set: set('mouseSens'), fmt: (v) => v.toFixed(1) },
      { type: 'slider', label: 'Stick Sensitivity', min: 0.3, max: 2.5, step: 0.1, get: get('padSens'), set: set('padSens'), fmt: (v) => v.toFixed(1) },
      { type: 'toggle', label: 'Invert Y', get: get('invertY'), set: set('invertY') },
      { type: 'toggle', label: 'Controller Rumble', get: get('rumble'), set: set('rumble') },
      { type: 'header', label: 'Video' },
      { type: 'choice', label: 'Quality', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], get: get('quality'), set: set('quality') },
      { type: 'slider', label: 'Field of View', min: 60, max: 95, step: 1, get: get('fov'), set: set('fov'), fmt: (v) => v.toFixed(0) },
      { type: 'toggle', label: 'Camera Shake', get: get('shake'), set: set('shake') },
      { type: 'toggle', label: 'Speed Effects', get: get('speedFx'), set: set('speedFx') },
      { type: 'header', label: 'Audio' },
      { type: 'slider', label: 'Master Volume', min: 0, max: 1, step: 0.05, get: get('master'), set: set('master'), fmt: pct },
      { type: 'slider', label: 'Music Volume', min: 0, max: 1, step: 0.05, get: get('music'), set: set('music'), fmt: pct },
      { type: 'slider', label: 'Effects Volume', min: 0, max: 1, step: 0.05, get: get('sfx'), set: set('sfx'), fmt: pct },
      { type: 'header', label: 'Data' },
      { type: 'button', label: 'Reset Collectibles & Gaps', action: () => this.confirm('Reset all collectibles, gaps and best score?', () => { this.hooks.resetProgress(); }) },
      { type: 'button', label: 'Back', action: () => onBack() },
    ];
    screen = new ListScreen(this, { title: 'Settings', items, onBack, footer: '<div class="small-note">Quality changes to textures and foliage density apply on next launch.</div>' });
    this.push(screen);
  }

  confirm(text, yes) {
    const s = new ListScreen(this, {
      title: 'Are you sure?',
      extra: `<div style="font-size:20px;margin-bottom:12px">${text}</div>`,
      items: [
        { type: 'button', label: 'No', action: () => this.pop() },
        { type: 'button', label: 'Yes', action: () => { yes(); this.pop(); } },
      ],
      onBack: () => this.pop(),
    });
    this.push(s);
  }

  controlsHtml() {
    const i = this.game.input;
    const K = GLYPHS.kbm, PS = GLYPHS.ps;
    const ps = (a) => {
      const l = PS[a];
      const cls = { '✕': 'cross', '○': 'circle', '□': 'square', '△': 'triangle' }[l];
      return cls ? `<span class="g ps ${cls}">${l}</span>` : `<span class="g ps wide">${l}</span>`;
    };
    const kb = (a) => K[a].split(' / ').map((x) => `<span class="g">${x}</span>`).join(' ');
    const rows = [
      ['Move', 'move'], ['Camera', 'look'], ['Jump (hold for height)', 'jump'], ['Grab: grind / vine / zip / climb', 'grab'],
      ['Flip trick (stick picks direction)', 'trick'], ['Slide · Roll on landing · Air pose (hold)', 'slide'],
      ['Spin left / right (air)', 'spinL'], ['', 'spinR'], ['Reset camera', 'camReset'], ['Jungle call (taunt)', 'taunt'], ['Respawn at start', 'respawn'], ['Pause', 'pause'],
    ];
    void i;
    let html = '<div class="controls-grid"><div class="h">Action</div><div class="h">Keyboard &amp; Mouse</div><div class="h">PS5 Controller</div>';
    for (const [label, a] of rows) html += `<div>${label}</div><div class="k">${kb(a)}</div><div class="k">${ps(a)}</div>`;
    html += '</div>';
    html += `<div class="tips">
      <b>Grind</b> — tap or hold Grab near a branch, rope, railing or ledge. Downhill builds speed; jump at the end to keep it.<br>
      <b>Swing</b> — Grab a vine in the air, push the stick to pump, release with Jump at the top of the arc for big air.<br>
      <b>Trees</b> — jump into a trunk head-on to run up it, at an angle to spiral around it. Jump to kick off.<br>
      <b>Momentum</b> — hold Slide when landing to roll and keep speed; slide-jump for a long jump. Mushrooms bounce you (hold Jump for more).<br>
      <b>Combos</b> — chain moves without touching the ground for long. Landing a flip half-way = bail!
    </div>`;
    return html;
  }

  showControls(onBack) {
    this.push(new InfoScreen(this, { title: 'Controls', html: this.controlsHtml(), onBack }));
  }

  showGaps(onBack) {
    const g = this.game;
    const found = new Set(g.save.gaps || []);
    const gaps = g.level.ctx.gaps;
    const c = g.collectibles.counts();
    let html = `<div class="row" style="font-size:20px;margin-bottom:8px">Letters: <b>${c.letters.length}/${c.lettersTotal}</b> &nbsp; Idols: <b>${c.idols}/${c.idolsTotal}</b> &nbsp; Gaps: <b>${found.size}/${gaps.length}</b></div><div class="gaplist">`;
    for (const gp of gaps) {
      const f = found.has(gp.name);
      html += `<div class="${f ? 'found' : 'missing'}">${f ? '✔ ' + gp.name + ' Gap' : '??? — find this gap'}</div><div class="${f ? 'found' : 'missing'}">${fmt(gp.points)}</div>`;
    }
    html += '</div>';
    this.push(new InfoScreen(this, { title: 'Gaps & Secrets', html, onBack }));
  }

  showResults(r) {
    const s = new ListScreen(this, {
      title: "Time's Up!",
      className: 'results',
      extra: `<div class="big">${fmt(r.score)}</div>${r.record ? '<div class="rec">NEW RECORD!</div>' : ''}
        <div class="row">Best combo: <b>${fmt(r.bestCombo)}</b></div>
        <div class="row">Previous best: ${fmt(r.prevBest)}</div><div style="height:10px"></div>`,
      items: [
        { type: 'button', label: 'Try Again', action: () => this.hooks.startAttack() },
        { type: 'button', label: 'Free Roam', action: () => this.hooks.startFree() },
        { type: 'button', label: 'Main Menu', action: () => this.hooks.quitToTitle() },
      ],
      onBack: null,
    });
    this.push(s);
  }
}
