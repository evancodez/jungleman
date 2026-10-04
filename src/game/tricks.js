// Trick/combo scoring (THPS-style): tricks add base points and +1 multiplier;
// the combo stays alive while you're airborne, grinding, swinging, wall
// running or sliding, with a short flow window on the ground.
import { clamp } from '../core/math.js';

const FLOW_WINDOW = 1.25;
const SMALL = {
  'Long Jump': 100, 'Skid Flip': 0, 'Rail Hop': 0, 'Water Hop': 0, 'Zip Drop': 0,
};
const PRAISE = [[50000, 'JUNGLE KING!'], [25000, 'UNTAMED!'], [12000, 'WILD!'], [6000, 'SAVAGE!'], [2500, 'SWEET!'], [900, 'NICE!']];

export class ComboSystem {
  constructor(game) {
    this.game = game;
    this.reset();
    this.total = 0;
    this.bestCombo = 0;
    this.gapsFound = new Set(game.save.gaps || []);
    const ev = game.events;
    ev.on('trick', (e) => this.add(e.name, e.base, e));
    ev.on('jump', (e) => { if (SMALL[e.name]) this.add(e.name, SMALL[e.name], e); else this.keepAlive(); });
    ev.on('bounce', (e) => { this.add(e.super ? 'Super Bounce' : 'Shroom Bounce', e.super ? 250 : 150, e); this.checkGap(e.pos, 'any'); });
    ev.on('mantle', (e) => { this.add(e.vault ? 'Vault' : 'Ledge Grab', e.vault ? 80 : 60, e); this.checkGap(e.pos, 'any'); });
    ev.on('wallKick', () => this.add('Wall Kick', 120, {}));
    ev.on('railTransfer', () => this.add('Transfer', 150, {}));
    ev.on('land', (e) => { if (e.rolled) this.add('Roll', 100, e); this.checkGap(e.pos, 'any'); });
    ev.on('grindStart', (e) => { this.keepAlive(); this.checkGap(e.pos, 'grind'); });
    ev.on('swingGrab', (e) => { this.keepAlive(); this.checkGap(e.pos, 'vine'); });
    ev.on('wallrun', (e) => { this.keepAlive(); this.checkGap(e.pos, 'any'); });
    ev.on('climb', () => this.keepAlive());
    ev.on('climbLeap', () => this.keepAlive());
    ev.on('splash', (e) => { this.checkGap(e.pos, 'water'); this.bank(); });
    ev.on('bail', () => this.lose());
    ev.on('respawn', () => this.lose(true));
    ev.on('slideEnd', () => { if (this.slideDist > 4) this.add('Power Slide', 40 + this.slideDist * 12, {}); this.slideDist = 0; });
    this.slideDist = 0;
  }

  get enabled() { return this.game.settings.scoring !== 'off'; }

  reset() {
    this.active = false;
    this.list = [];
    this.base = 0;
    this.mult = 0;
    this.flow = 0;
    this.counts = new Map();
    this.climbT = 0;
  }

  keepAlive() {
    if (this.active) this.flow = FLOW_WINDOW;
  }

  add(name, base, e = {}) {
    if (!base) { this.keepAlive(); return; }
    if (!this.active) { this.active = true; this.list = []; this.base = 0; this.mult = 0; this.counts.clear(); }
    const n = this.counts.get(name) || 0;
    this.counts.set(name, n + 1);
    const repeat = [1, 0.75, 0.5, 0.25][Math.min(n, 3)];
    let pts = Math.round(base * repeat * (e.sketchy ? 0.5 : 1) / 5) * 5;
    pts = Math.max(5, pts);
    let label = name;
    if (e.sketchy) label = 'Sketchy ' + name;
    if (e.lastSecond) { pts += 100; label += ' (Last Second)'; }
    this.base += pts;
    this.mult += 1;
    this.list.push({ name: label, pts, kind: e.kind || '', t: this.game.time });
    if (this.list.length > 40) this.list.shift();
    this.flow = FLOW_WINDOW;
    this.game.events.emit('comboUpdate', { name: label, pts, base: this.base, mult: this.mult, gap: e.kind === 'gap' });
  }

  checkGap(pos, landKind) {
    const pl = this.game.player;
    const from = pl.launchPos;
    if (!pos || !from) return;
    for (const g of this.game.level.ctx.gaps) {
      if (g.land !== 'any' && g.land !== landKind) continue;
      if (!g.from.containsPoint(from) || !g.to.containsPoint(pos)) continue;
      if (this._lastGap === g && this.game.time - this._lastGapT < 1.5) continue;
      this._lastGap = g; this._lastGapT = this.game.time;
      this.add(g.name + ' Gap', g.points, { kind: 'gap' });
      const first = !this.gapsFound.has(g.name);
      this.gapsFound.add(g.name);
      if (first) {
        this.game.save.gaps = [...this.gapsFound];
        this.game.writeSave();
      }
      this.game.events.emit('gap', { name: g.name, points: g.points, first });
    }
  }

  bank() {
    if (!this.active) return;
    const score = this.base * Math.max(1, this.mult);
    this.total += score;
    if (score > this.bestCombo) this.bestCombo = score;
    let praise = '';
    for (const [min, word] of PRAISE) if (score >= min) { praise = word; break; }
    this.game.events.emit('comboBank', { score, base: this.base, mult: this.mult, praise, count: this.list.length });
    this.reset();
  }

  lose(silent = false) {
    if (!this.active) return;
    const score = this.base * Math.max(1, this.mult);
    this.reset();
    if (!silent) this.game.events.emit('comboLost', { score });
  }

  update(dt) {
    const pl = this.game.player;
    if (pl.state === 'ground' && pl.sliding) this.slideDist += pl.hspeed * dt;
    else this.slideDist = 0;
    if (!this.active) return;
    const st = pl.state;
    const sliding = st === 'ground' && pl.sliding && pl.hspeed > 4;
    if (st === 'ground' && !sliding) {
      this.flow -= dt;
      if (this.flow <= 0) this.bank();
    } else if (st === 'climb') {
      this.climbT += dt;
      if (this.climbT > 3.5) { this.flow -= dt; if (this.flow <= 0) this.bank(); }
    } else if (st === 'swim') {
      this.bank();
    } else {
      this.climbT = 0;
      this.flow = FLOW_WINDOW;
    }
  }

  get flowFraction() { return this.active ? clamp(this.flow / FLOW_WINDOW, 0, 1) : 0; }
  get comboScore() { return this.base * Math.max(1, this.mult); }
}
