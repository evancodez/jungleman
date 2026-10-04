// Minimal event emitter used to decouple gameplay from audio/FX/scoring.
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const arr = this.map.get(name);
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  emit(name, data) {
    const arr = this.map.get(name);
    if (arr) for (const fn of arr.slice()) fn(data);
    const any = this.map.get('*');
    if (any) for (const fn of any.slice()) fn(name, data);
  }
}
