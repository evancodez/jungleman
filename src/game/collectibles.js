// J-U-N-G-L-E letters and golden idols scattered along the best lines.
import * as THREE from 'three';
import { getTextures } from '../fx/textures.js';

function letterTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, '#ffe9a0');
  grd.addColorStop(0.75, '#e8a630');
  grd.addColorStop(1, '#9a5a10');
  g.fillStyle = grd;
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#7a4a08'; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#4a2a04';
  g.font = 'bold 76px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function idolGeometry() {
  // Small stylized idol: base, body, big head with brow.
  const parts = [];
  const base = new THREE.CylinderGeometry(0.28, 0.32, 0.12, 10); base.translate(0, 0.06, 0); parts.push(base);
  const body = new THREE.CylinderGeometry(0.16, 0.24, 0.42, 10); body.translate(0, 0.33, 0); parts.push(body);
  const head = new THREE.SphereGeometry(0.24, 14, 10); head.scale(1, 1.15, 0.95); head.translate(0, 0.78, 0); parts.push(head);
  const brow = new THREE.BoxGeometry(0.4, 0.06, 0.12); brow.translate(0, 0.86, 0.18); parts.push(brow);
  const nose = new THREE.ConeGeometry(0.05, 0.14, 6); nose.rotateX(Math.PI / 2); nose.translate(0, 0.76, 0.24); parts.push(nose);
  const crown = new THREE.ConeGeometry(0.18, 0.2, 6); crown.translate(0, 1.08, 0); parts.push(crown);
  return parts.map((p) => p.toNonIndexed());
}

export class Collectibles {
  constructor(game) {
    this.game = game;
    this.items = [];
    const scene = game.scene;
    const T = getTextures();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc845, metalness: 0.9, roughness: 0.3, emissive: 0x6a3a00, emissiveIntensity: 0.5 });
    const idolGeo = mergeParts(idolGeometry());
    const glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xffd070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
    const beamMat = new THREE.MeshBasicMaterial({ map: T.shaft, color: 0xffd27a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const collected = new Set(game.save.collected || []);
    for (const c of game.level.ctx.collectibles) {
      const id = c.kind + ':' + c.label;
      const grp = new THREE.Group();
      grp.position.copy(c.pos);
      let mesh;
      if (c.kind === 'letter') {
        const mat = new THREE.MeshStandardMaterial({ map: letterTexture(c.label), metalness: 0.6, roughness: 0.35, emissive: 0x5a3000, emissiveIntensity: 0.6 });
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 28), [gold, mat, mat]);
        mesh.rotation.x = Math.PI / 2;
        const holder = new THREE.Group();
        holder.add(mesh);
        mesh = holder;
      } else {
        mesh = new THREE.Mesh(idolGeo, gold);
        mesh.position.y = -0.5;
        const holder = new THREE.Group();
        holder.add(mesh);
        mesh = holder;
      }
      mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      grp.add(mesh);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(2.2);
      grp.add(glow);
      // Vertical beam visible from afar.
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 30), beamMat);
      beam.position.y = 14;
      const beam2 = beam.clone(); beam2.rotation.y = Math.PI / 2;
      grp.add(beam, beam2);
      scene.add(grp);
      const item = { ...c, id, grp, mesh, got: collected.has(id), phase: Math.random() * 6 };
      grp.visible = !item.got;
      this.items.push(item);
    }
  }

  counts() {
    const letters = this.items.filter((i) => i.kind === 'letter');
    const idols = this.items.filter((i) => i.kind === 'idol');
    return {
      letters: letters.filter((i) => i.got).map((i) => i.label),
      lettersTotal: letters.length,
      idols: idols.filter((i) => i.got).length,
      idolsTotal: idols.length,
    };
  }

  resetAll() {
    for (const i of this.items) { i.got = false; i.grp.visible = true; }
    this.game.save.collected = [];
    this.game.writeSave();
  }

  update(dt, time) {
    const p = this.game.player.pos;
    for (const it of this.items) {
      if (it.got) continue;
      it.mesh.rotation.y += dt * 2.2;
      it.mesh.position.y = Math.sin(time * 2 + it.phase) * 0.15;
      const dx = p.x - it.pos.x, dy = p.y + 1.0 - it.pos.y, dz = p.z - it.pos.z;
      if (dx * dx + dy * dy + dz * dz < 1.7 * 1.7) {
        it.got = true;
        it.grp.visible = false;
        this.game.save.collected = this.items.filter((i) => i.got).map((i) => i.id);
        this.game.writeSave();
        this.game.events.emit('collect', { kind: it.kind, label: it.label, pos: it.pos.clone(), counts: this.counts() });
      }
    }
  }
}

function mergeParts(parts) {
  // Minimal merge (position/normal/uv) without importing the utils twice.
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nrm.set(p.attributes.normal.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
