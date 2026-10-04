// Unified input: keyboard + mouse + gamepad (DualSense / DualShock / XInput).
// Gameplay reads actions (held / buffered presses) and analog move/look vectors.
// Menus read a navigation event queue that all three devices feed.

const KEY_BINDS = {
  jump: ['Space'],
  grab: ['KeyF', 'Mouse0'],
  trick: ['KeyR', 'Mouse2'],
  slide: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  spinL: ['KeyQ'],
  spinR: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  camReset: ['KeyV', 'Mouse1'],
  respawn: ['KeyT'],
  taunt: ['KeyG'],
  scoring: ['KeyH'],
};

// Standard Gamepad mapping (Chrome/Edge/Safari, Firefox on Windows).
const STD = {
  cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7,
  create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, pad: 17,
  axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
};
// Raw HID layout reported for Sony pads when the browser cannot remap (e.g. Firefox/Linux).
const SONY_RAW = {
  cross: 0, circle: 1, triangle: 2, square: 3, l1: 4, r1: 5, l2: 6, r2: 7,
  create: 8, options: 9, ps: 10, l3: 11, r3: 12, pad: 13,
  axes: { lx: 0, ly: 1, rx: 3, ry: 4, l2: 2, r2: 5, dx: 6, dy: 7 },
};

const PAD_BINDS = {
  jump: ['cross'],
  grab: ['triangle'],
  trick: ['square'],
  slide: ['circle', 'r2', 'l2'],
  spinL: ['l1'],
  spinR: ['r1'],
  pause: ['options'],
  camReset: ['r3'],
  respawn: ['create'],
  taunt: ['l3'],
  scoring: ['pad'],
};

const NAV_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  Escape: 'back', Backspace: 'back',
};

export class Input {
  constructor(target) {
    this.target = target;
    this.time = 0;
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pointerLocked = false;
    this.noLock = false;
    this.lastDevice = 'kbm';
    this.padType = 'ps'; // 'ps' | 'xbox'
    this.padConnected = false;
    this.pad = null;
    this.padMap = STD;
    this.padPrev = {};
    this.padNow = {};
    this.lastPress = {};
    this.consumed = {};
    this.prevHeld = {};
    this.navQueue = [];
    this.navRepeat = { dir: null, t: 0 };
    this.anyPressed = false;
    this.moveX = 0; // right +
    this.moveY = 0; // forward +
    this.lookX = 0; // radians this frame (yaw delta, + = turn right)
    this.lookY = 0; // radians this frame (pitch delta, + = look up)
    this.settings = { mouseSens: 1, padSens: 1, invertY: false, rumble: true };
    this.onPointerLockChange = null;
    this.gameplayActive = false;
    for (const a of Object.keys(KEY_BINDS)) { this.lastPress[a] = -1e9; this.consumed[a] = true; }

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    target.addEventListener('mousedown', (e) => this._onMouse(e, true));
    window.addEventListener('mouseup', (e) => this._onMouse(e, false));
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || (this.gameplayActive && (this.noLock || this.mouseButtons.has('Mouse1drag')))) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.lastDevice = 'kbm';
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => { this.noLock = true; });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.target;
      if (this.pointerLocked) this.noLock = false;
      if (this.onPointerLockChange) this.onPointerLockChange(this.pointerLocked);
    });
    window.addEventListener('gamepadconnected', () => { this.lastDevice = 'gamepad'; });
  }

  requestPointerLock() {
    if (this.pointerLocked) return;
    // Without pointer lock (sandboxed iframes, some browsers) the camera still
    // follows plain mouse movement while the cursor is over the game.
    const fallback = () => { this.noLock = true; };
    if (!this.target.requestPointerLock) { fallback(); return; }
    try {
      const p = this.target.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try {
          const q = this.target.requestPointerLock();
          if (q && q.catch) q.catch(fallback);
        } catch { fallback(); }
      });
    } catch { fallback(); }
  }
  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onKey(e, down) {
    const code = e.code;
    if (down) {
      this.lastDevice = 'kbm';
      if (!e.repeat) {
        this.anyPressed = true;
        const nav = NAV_KEYS[code];
        if (nav) this.navQueue.push(nav);
      }
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
    // Stop the page from scrolling / browser shortcuts on game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(code)) e.preventDefault();
  }

  _onMouse(e, down) {
    const code = 'Mouse' + e.button;
    this.lastDevice = 'kbm';
    if (down) {
      this.mouseButtons.add(code);
      this.anyPressed = true;
      if (e.button === 1) this.mouseButtons.add('Mouse1drag');
    } else {
      this.mouseButtons.delete(code);
      if (e.button === 1) this.mouseButtons.delete('Mouse1drag');
    }
  }

  _readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        if (!pad || p.timestamp > pad.timestamp) pad = p;
      }
    }
    this.pad = pad;
    this.padConnected = !!pad;
    this.padPrev = this.padNow;
    this.padNow = {};
    if (!pad) return;
    const id = (pad.id || '').toLowerCase();
    const sony = id.includes('054c') || id.includes('dualsense') || id.includes('dualshock') || id.includes('wireless controller') || id.includes('playstation');
    this.padType = sony || !(id.includes('xbox') || id.includes('xinput') || id.includes('045e')) ? 'ps' : 'xbox';
    const map = pad.mapping === 'standard' || !sony ? STD : SONY_RAW;
    this.padMap = map;
    const b = pad.buttons;
    const val = (i) => (i !== undefined && b[i] ? (typeof b[i] === 'object' ? b[i].value || (b[i].pressed ? 1 : 0) : b[i]) : 0);
    for (const name of ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'create', 'options', 'l3', 'r3', 'ps', 'pad', 'up', 'down', 'left', 'right']) {
      this.padNow[name] = val(map[name]);
    }
    const ax = pad.axes;
    const A = map.axes;
    this.padNow.lx = ax[A.lx] || 0;
    this.padNow.ly = ax[A.ly] || 0;
    this.padNow.rx = ax[A.rx] || 0;
    this.padNow.ry = ax[A.ry] || 0;
    if (map === SONY_RAW) {
      // Triggers as axes (-1..1) and d-pad as hat axes.
      if (A.l2 !== undefined && ax[A.l2] !== undefined) this.padNow.l2 = Math.max(this.padNow.l2, (ax[A.l2] + 1) / 2);
      if (A.r2 !== undefined && ax[A.r2] !== undefined) this.padNow.r2 = Math.max(this.padNow.r2, (ax[A.r2] + 1) / 2);
      const dx = ax[A.dx] || 0, dy = ax[A.dy] || 0;
      if (dx < -0.5) this.padNow.left = 1;
      if (dx > 0.5) this.padNow.right = 1;
      if (dy < -0.5) this.padNow.up = 1;
      if (dy > 0.5) this.padNow.down = 1;
      if (ax.length === 10 && ax[9] !== undefined && Math.abs(ax[9]) <= 1.01) {
        // Hat switch encoded as a single axis (macOS/Firefox): -1 up, clockwise in 1/7 steps.
        const h = ax[9];
        const dir = Math.round((h + 1) * 3.5);
        if (h <= 1.0 && dir >= 0 && dir <= 7) {
          if (dir === 7 || dir === 0 || dir === 1) this.padNow.up = 1;
          if (dir >= 1 && dir <= 3) this.padNow.right = 1;
          if (dir >= 3 && dir <= 5) this.padNow.down = 1;
          if (dir >= 5 && dir <= 7) this.padNow.left = 1;
        }
      }
    }
    // Device activity detection.
    let active = false;
    for (const k in this.padNow) {
      const v = this.padNow[k];
      if (['lx', 'ly', 'rx', 'ry'].includes(k)) { if (Math.abs(v) > 0.35) active = true; }
      else if (v > 0.5 && !(this.padPrev[k] > 0.5)) { active = true; this.anyPressed = true; }
    }
    if (active) this.lastDevice = 'gamepad';
  }

  padDown(name) { return (this.padNow[name] || 0) > 0.5; }
  padPressed(name) { return (this.padNow[name] || 0) > 0.5 && !((this.padPrev[name] || 0) > 0.5); }

  /** Called once per rendered frame before game logic. */
  update(dt) {
    this.time += dt;
    this._readPad();

    // Actions: detect rising edges from all devices.
    for (const action of Object.keys(KEY_BINDS)) {
      const h = this._heldRaw(action);
      if (h && !this.prevHeld[action]) {
        this.lastPress[action] = this.time;
        this.consumed[action] = false;
      }
      this.prevHeld[action] = h;
    }

    // Movement vector.
    let mx = 0, my = 0;
    if (this.keys.has('KeyW')) my += 1;
    if (this.keys.has('KeyS')) my -= 1;
    if (this.keys.has('KeyD')) mx += 1;
    if (this.keys.has('KeyA')) mx -= 1;
    const kl = Math.hypot(mx, my);
    if (kl > 1) { mx /= kl; my /= kl; }
    if (this.pad) {
      const [sx, sy] = radialDeadzone(this.padNow.lx, this.padNow.ly, 0.14);
      if (Math.abs(sx) + Math.abs(sy) > 0.001) { mx = sx; my = -sy; }
      if (this.padDown('up')) my = 1;
      if (this.padDown('down')) my = -1;
      if (this.padDown('left')) mx = -1;
      if (this.padDown('right')) mx = 1;
      const l = Math.hypot(mx, my);
      if (l > 1) { mx /= l; my /= l; }
    }
    this.moveX = mx;
    this.moveY = my;

    // Look vector (radians).
    const s = this.settings;
    let lx = this.mouseDX * 0.0022 * s.mouseSens;
    let ly = -this.mouseDY * 0.0022 * s.mouseSens;
    this.mouseDX = this.mouseDY = 0;
    const arrowRate = 2.6 * dt;
    if (this.keys.has('ArrowLeft')) lx -= arrowRate;
    if (this.keys.has('ArrowRight')) lx += arrowRate;
    if (this.keys.has('ArrowUp')) ly += arrowRate * 0.6;
    if (this.keys.has('ArrowDown')) ly -= arrowRate * 0.6;
    if (this.pad) {
      const [rx, ry] = radialDeadzone(this.padNow.rx, this.padNow.ry, 0.12);
      // Non-linear response curve for precision near center.
      const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
      lx += curve(rx) * 3.4 * s.padSens * dt;
      ly += -curve(ry) * 2.2 * s.padSens * dt;
    }
    if (s.invertY) ly = -ly;
    this.lookX = lx;
    this.lookY = ly;

    // Menu navigation from the gamepad (with auto-repeat).
    if (this.pad) {
      if (this.padPressed('cross')) this.navQueue.push('confirm');
      if (this.padPressed('circle')) this.navQueue.push('back');
      if (this.padPressed('options')) this.navQueue.push('start');
      let dir = null;
      const ly2 = this.padNow.ly, lx2 = this.padNow.lx;
      if (this.padDown('up') || ly2 < -0.6) dir = 'up';
      else if (this.padDown('down') || ly2 > 0.6) dir = 'down';
      else if (this.padDown('left') || lx2 < -0.6) dir = 'left';
      else if (this.padDown('right') || lx2 > 0.6) dir = 'right';
      if (dir) {
        if (this.navRepeat.dir !== dir) { this.navQueue.push(dir); this.navRepeat = { dir, t: 0.38 }; }
        else {
          this.navRepeat.t -= dt;
          if (this.navRepeat.t <= 0) { this.navQueue.push(dir); this.navRepeat.t = 0.11; }
        }
      } else this.navRepeat.dir = null;
    }
  }

  _heldRaw(action) {
    for (const k of KEY_BINDS[action]) {
      if (k.startsWith('Mouse') ? this.mouseButtons.has(k) : this.keys.has(k)) return true;
    }
    if (this.pad) for (const b of PAD_BINDS[action]) if (this.padDown(b)) return true;
    return false;
  }

  held(action) { return !!this.prevHeld[action]; }

  /** True if the action was pressed within `buffer` seconds and not yet consumed. */
  pressed(action, buffer = 0) {
    if (this.consumed[action]) return false;
    return this.time - this.lastPress[action] <= buffer + 1e-6;
  }
  consume(action) { this.consumed[action] = true; }
  consumeAll() { for (const a in this.consumed) this.consumed[a] = true; }

  takeNav() {
    const q = this.navQueue;
    this.navQueue = [];
    return q;
  }
  clearNav() { this.navQueue = []; this.anyPressed = false; }
  takeAny() { const a = this.anyPressed; this.anyPressed = false; return a; }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (!this.settings.rumble || !this.pad || this.lastDevice !== 'gamepad') return;
    const act = this.pad.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }).catch(() => {});
    }
  }
}

function radialDeadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

// Button glyph descriptions for prompts. Returns {kind, label} items rendered by the UI.
export const GLYPHS = {
  kbm: {
    jump: 'Space', grab: 'LMB / F', trick: 'RMB / R', slide: 'Shift', spinL: 'Q', spinR: 'E',
    pause: 'Esc', camReset: 'V', respawn: 'T', taunt: 'G', scoring: 'H', move: 'WASD', look: 'Mouse',
  },
  ps: {
    jump: '✕', grab: '△', trick: '□', slide: '○', spinL: 'L1', spinR: 'R1',
    pause: 'OPTIONS', camReset: 'R3', respawn: 'CREATE', taunt: 'L3', scoring: 'TOUCHPAD', move: 'L-Stick', look: 'R-Stick',
  },
  xbox: {
    jump: 'A', grab: 'Y', trick: 'X', slide: 'B', spinL: 'LB', spinR: 'RB',
    pause: 'MENU', camReset: 'RS', respawn: 'VIEW', taunt: 'LS', scoring: '—', move: 'L-Stick', look: 'R-Stick',
  },
};
