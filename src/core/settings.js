// Persistent settings and save data (localStorage, failure tolerant).
const KEY = 'jungleman.settings.v1';
const SAVE_KEY = 'jungleman.save.v1';

export const DEFAULTS = {
  scoring: 'full', // 'off' | 'names' | 'full'
  autoGrind: false,
  prompts: true,
  mouseSens: 1.0,
  padSens: 1.0,
  invertY: false,
  autoCam: true,
  fov: 72,
  shake: true,
  speedFx: true,
  rumble: true,
  master: 0.8,
  music: 0.45,
  sfx: 0.85,
  quality: 'auto', // 'auto' | 'low' | 'medium' | 'high'
};

export const QUALITY = {
  low: { pixelRatio: 0.8, shadowMap: 1024, msaa: 0, bloom: false, foliage: 0.45, foliageShadows: false, torchLights: 2, terrainRes: 160, textures: 'low', shadowRange: 40 },
  medium: { pixelRatio: 1.0, shadowMap: 2048, msaa: 2, bloom: true, foliage: 0.75, foliageShadows: true, torchLights: 3, terrainRes: 200, textures: 'high', shadowRange: 55 },
  high: { pixelRatio: 1.5, shadowMap: 4096, msaa: 4, bloom: true, foliage: 1.0, foliageShadows: true, torchLights: 4, terrainRes: 240, textures: 'high', shadowRange: 65 },
};

function read(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    return { ...fallback, ...JSON.parse(s) };
  } catch {
    return fallback;
  }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
}

export function loadSettings() { return read(KEY, { ...DEFAULTS }); }
export function saveSettings(s) { write(KEY, s); }

export function loadSave() {
  return read(SAVE_KEY, { collected: [], gaps: [], bestScore: 0, bestCombo: 0, bestTime: 0 });
}
export function writeSave(s) { write(SAVE_KEY, s); }

export function resolveQuality(name) {
  if (name !== 'auto') return QUALITY[name] || QUALITY.medium;
  // Heuristic: small screens / low core counts get medium; others high.
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);
  if (mobile) return QUALITY.low;
  return cores >= 8 ? QUALITY.high : QUALITY.medium;
}
