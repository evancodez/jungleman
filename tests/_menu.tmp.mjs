// Minimal DOM shim to drive Menus + Input headlessly.
class El {
  constructor(){ this.children=[]; this.style={}; this._q={}; this.listeners={}; this.parent=null; this.innerHTML=''; this.className='';
    const self=this; this.classList={ add(){}, remove(){}, toggle(){}, }; }
  appendChild(c){ c.parent=this; this.children.push(c); return c; }
  remove(){ if(this.parent){ const i=this.parent.children.indexOf(this); if(i>=0) this.parent.children.splice(i,1);} }
  querySelector(s){ return this._q[s] ||= new El(); }
  addEventListener(n,f){ (this.listeners[n] ||= []).push(f); }
  getBoundingClientRect(){ return {left:0,width:100}; }
}
const winL={};
globalThis.window = { addEventListener(n,f){ (winL[n] ||= []).push(f); } };
globalThis.document = { createElement(){ return new El(); }, addEventListener(){}, pointerLockElement:null };
Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => [] }, configurable: true });
const { Input } = await import('../src/core/input.js');
const { Menus } = await import('../src/ui/menu.js');
const canvas = new El();
const input = new Input(canvas);
const game = { input, save: { bestScore: 0 }, settings: {}, level: { ctx: { gaps: [] } } };
const root = new El();
const menus = new Menus(root, game, { sound(){}, startFree(){}, startAttack(){} });
const key = (code, down) => winL[down?'keydown':'keyup'].forEach(f=>f({ code, repeat:false, preventDefault(){} }));
const frame = () => { input.update(1/60); const nav = input.takeNav(); if (menus.open) menus.nav(nav); };
const where = () => menus.stack.length ? `main menu (stack ${menus.stack.length})` : (menus.titleEl ? 'title ("Press any button")' : 'none');
menus.showTitle(); frame();
console.log('start:', where());
key('Enter', true); frame(); key('Enter', false); frame();
console.log('after Enter:', where());
key('Escape', true); frame(); key('Escape', false);
console.log('after Escape (same frame):', where());
frame();
console.log('one frame later, no input:', where());
