// Art kit preview: the Meadow, a small tower, an active piece and its landing guide, all through
// the Phaser 4 adapter exactly as the game will use it.
// URL options: ?state=stable|perfect|risky|tip|miss (else cycles) &climb=<blocks> &zoom=<n>
// &sp=<sky position> &tension=<0..1> &gallery=1 (every shape, rotation and look).
// &cp=near|hold|claim holds one checkpoint-line phase (else it cycles near, hold, claim).
// &vfx=1 shows every effect texture, tinted, over a day and a night sky, with a looping claim burst.
// &tour=1 climbs from the Meadow through Treetops into Cloudlands, playing each arrival.
// &arrive=1 replays the current biome's arrival every 4 s (with &sp=1.2 or &sp=2.2).
// Options also work after a # (e.g. #gallery), for hosts that drop the query string.

import * as Phaser from 'phaser';
import {
  ART_SHAPES, ArtTextures, BIOMES, SIGNAL, VFX, VFX_NAMES, hexNum, Backdrop, BlocklingView, CheckpointLine, GuideView, PbMarker, SkyClock, pedestalHeight, pose, rimAmount,
  type Expression, type GuideShow, type SceneLike,
} from '../src/index.ts';

const qs = new URLSearchParams(location.search || location.hash.slice(1));
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);

interface Placed { view: BlocklingView; key: string; q: number; c: number; r: number; angle?: number; stone?: number; dx?: number }

class Preview extends Phaser.Scene {
  private tex!: ArtTextures;
  private backdrop!: Backdrop;
  private guide!: GuideView;
  private sky = new SkyClock();
  private tower: Placed[] = [];
  private active!: BlocklingView;
  private groundY = 0;
  private cell = 0;
  private left = 0;
  private top = 0;
  private time0 = 0;
  private line: CheckpointLine | null = null;
  private lineBorn = 0;
  private pb!: PbMarker;
  private lastBiome = 0;

  constructor() { super('preview'); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    const scene: SceneLike = this; // The adapter's structural types must accept a real Phaser scene.
    this.cell = W / 12;
    this.tex = new ArtTextures(scene, { cellPx: this.cell });
    if (qs.has('gallery')) { this.gallery(W); return; }
    if (qs.has('vfx')) { this.vfxSheet(W, H); return; }

    this.cameras.main.setZoom(num('zoom', 1));
    this.backdrop = new Backdrop(scene, { width: W, height: H });
    this.sky.set(num('sp', 0.15));

    this.groundY = H * 0.8;
    const pedW = 6;
    this.left = W / 2 - pedW / 2 * this.cell;
    this.top = this.groundY - pedestalHeight() * this.cell;
    const ped = this.tex.pedestal(pedW);
    this.add.image(W / 2, this.top, ped.key, ped.frame).setOrigin(ped.originX, ped.originY).setScale(this.tex.scale).setDepth(5);

    const T: Omit<Placed, 'view'>[] = [
      { key: 'I', q: 0, c: 0, r: 0, stone: 1 },
      { key: 'O', q: 0, c: 4, r: 0, stone: 1 },
      { key: 'S', q: 0, c: 0, r: 1 },
      { key: 'Domino', q: 0, c: 2, r: 1 },
      { key: 'L', q: 0, c: 3, r: 2 },
      { key: 'Z', q: 0, c: 0, r: 3 },
      { key: 'T', q: 2, c: 2, r: 4, angle: -0.06 },
      { key: 'J', q: 1, c: 4, r: 4, angle: 0.04 },
    ];
    T.forEach((p, i) => {
      const view = new BlocklingView(this.tex, p.key, { seed: i * 3 + 1, depth: 10 + i * 0.01, finish: 'wood' });
      this.tower.push({ ...p, view });
    });
    this.active = new BlocklingView(this.tex, 'L', { seed: 99, depth: 20, finish: 'wood' }).setExpression('falling');
    this.guide = new GuideView(this.tex, 1000);
    this.pb = new PbMarker(this.tex, 899);
    this.time0 = this.time.now;
  }

  private gallery(W: number): void {
    this.cameras.main.setBackgroundColor('#2B2F7A');
    const keys = Object.keys(ART_SHAPES), cell = this.cell * 0.5;
    const tex = new ArtTextures(this, { cellPx: cell });
    let x = 8, y = 8, rowH = 0;
    const looks: { stone?: boolean; rim?: boolean; ex?: Expression }[] = [{}, { ex: 'worried' }, { stone: true }, { rim: true, ex: 'panic' }];
    for (const k of keys) for (let q = 0; q < 4; q++) {
      const look = looks[q];
      const p = pose(k, q), w = p.w * cell, h = p.h * cell;
      if (x + w + 10 > W) { x = 8; y += rowH + 14; rowH = 0; }
      const v = new BlocklingView(tex, k, { seed: q }).setPose(x + w / 2 + 4, y + h / 2 + 4, q * Math.PI / 2 + num('res', 0));
      if (look.stone) v.setStone(1);
      if (look.rim) v.setRim(1);
      if (look.ex) v.setExpression(look.ex);
      v.update(0.016);
      x += w + 14; rowH = Math.max(rowH, h);
    }
  }

  private sparks: { img: Phaser.GameObjects.Image; vx: number; vy: number; spin: number; age: number; life: number; s0: number; s1: number }[] = [];
  private burstAt = -10;

  private vfxSheet(W: number, H: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x6EC3FF, 1).fillRect(0, 0, W, H * 0.42);
    g.fillStyle(0x0B1230, 1).fillRect(0, H * 0.42, W, H * 0.58);
    const tint: Record<string, number> = {
      puff: hexNum(BIOMES[0].dust), ring: hexNum(SIGNAL.gold), shockwave: hexNum(SIGNAL.gold), sparkle: hexNum(SIGNAL.gold),
      stardust: hexNum(BIOMES[5].dust), chip: 0xB9B1A6, confetti: hexNum(ART_SHAPES.T.base), rays: hexNum('#FFE58F'), flash: 0xFFFFFF,
    };
    const names = VFX_NAMES, cols = 6, cell = W / cols;
    for (const [half, y0] of [[0, 14], [1, H * 0.42 + 14]] as [number, number][]) {
      names.forEach((n, i) => {
        const r = this.tex.vfx(n), cx = (i % cols + 0.5) * cell, cy = y0 + Math.floor(i / cols) * cell * 1.05 + cell * 0.45;
        const nat = (n in VFX ? VFX[n as keyof typeof VFX] : 0.4) * this.cell;
        const fit = Math.min(1, (cell * 0.72) / Math.max(1, nat)) * this.tex.scale;
        const img = this.add.image(cx, cy, r.key, r.frame).setScale(fit);
        if (tint[n]) img.setTint(tint[n]);
        if (half === 0) this.add.text(cx, cy + cell * 0.42, n, { fontFamily: 'sans-serif', fontSize: '10px', color: '#22183A' }).setOrigin(0.5, 0.5);
      });
    }
  }

  private vfxUpdate(t: number, dt: number): void {
    const W = this.scale.width, H = this.scale.height, cx = W / 2, cy = H * 0.8, u = this.cell;
    if (t - this.burstAt > 2.4) {
      this.burstAt = t;
      const add = (name: Parameters<ArtTextures['vfx']>[0], vx: number, vy: number, o: { tint?: number; life?: number; s0?: number; s1?: number; spin?: number } = {}) => {
        const r = this.tex.vfx(name), img = this.add.image(cx, cy, r.key, r.frame).setTint(o.tint ?? 0xFFFFFF).setRotation(Math.random() * 6.28);
        this.sparks.push({ img, vx, vy, spin: o.spin ?? 0, age: 0, life: o.life ?? 1.2, s0: o.s0 ?? 1, s1: o.s1 ?? 0.6 });
      };
      add('shockwave', 0, 0, { tint: hexNum(SIGNAL.gold), life: 0.5, s0: 0.3, s1: 2.2 });
      add('rays', 0, 0, { tint: 0xFFE58F, life: 0.9, s0: 0.6, s1: 1.4, spin: 0.8 });
      add('flash', 0, 0, { life: 0.25, s0: 1, s1: 2 });
      const minis = ['mini_I', 'mini_O', 'mini_T', 'mini_L', 'mini_J', 'mini_S', 'mini_Z'] as const;
      for (let i = 0; i < 36; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = u * (5 + Math.random() * 6);
        add(i % 3 ? minis[i % 7] : 'confetti', Math.cos(a) * v, Math.sin(a) * v, { tint: i % 3 ? 0xFFFFFF : hexNum(ART_SHAPES[minis[i % 7].slice(5)].base), life: 1.6 + Math.random() * 0.6, spin: (Math.random() - 0.5) * 12, s1: 0.8 });
      }
      for (let i = 0; i < 8; i++) add('sparkle', (Math.random() - 0.5) * u * 6, -u * (2 + Math.random() * 4), { tint: hexNum(SIGNAL.gold), life: 0.8, s0: 1, s1: 0.2 });
    }
    for (const p of this.sparks) {
      p.age += dt;
      const f = p.age / p.life;
      p.vy += u * 12 * dt * (p.vx || p.vy ? 1 : 0); p.vx *= Math.exp(-1.2 * dt); p.vy *= Math.exp(-1.2 * dt);
      p.img.x += p.vx * dt; p.img.y += p.vy * dt; p.img.rotation += p.spin * dt;
      p.img.setScale((p.s0 + (p.s1 - p.s0) * f) * this.tex.scale).setAlpha(f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4));
      if (f >= 1) p.img.destroy();
    }
    this.sparks = this.sparks.filter(p => p.age < p.life);
  }

  update(time: number, deltaMs: number): void {
    if (qs.has('gallery')) return;
    if (qs.has('vfx')) { this.vfxUpdate((time - this.time0) / 1000, Math.min(0.05, deltaMs / 1000)); return; }
    const dt = Math.min(0.05, deltaMs / 1000), t = (time - this.time0) / 1000;
    const cell = this.cell, cam = this.cameras.main;
    const tour = qs.has('tour');
    cam.scrollY = -(tour ? Math.max(0, t - 1) * 2.2 : num('climb', 0)) * cell;

    const clock = this.sky.update(dt, 0, 0.2);
    const sp = tour ? Math.min(2.6, Math.max(0, t - 1) * 0.3) : qs.has('sp') ? num('sp', 0) : clock;
    const ground = (this.groundY - cam.worldView.y) * cam.zoom;
    this.backdrop.update(dt, ground, sp);
    const bi = Math.floor(sp + 0.02);
    if (tour && bi > this.lastBiome) this.backdrop.arrival(bi);
    if (qs.has('arrive') && Math.floor((t - 0.5) / 4) !== Math.floor((t - 0.5 - dt) / 4)) this.backdrop.arrival(bi);
    this.lastBiome = bi;
    const rim = rimAmount(sp);

    const tension = qs.has('tension') ? num('tension', 0) : 0.5 + 0.5 * Math.sin(t * 0.5);
    const topEx: Expression = tension >= 0.85 ? 'panic' : tension >= 0.3 ? 'worried' : 'idle';
    for (const p of this.tower) {
      const P = pose(p.key, p.q);
      const x = this.left + (p.c + P.w / 2) * cell, y = this.top - (p.r + P.h / 2) * cell;
      p.view.setPose(x, y, p.q * Math.PI / 2 + (p.angle ?? 0)).setStone(p.stone ?? 0).setRim(rim);
      p.view.setLively(p.r >= 2).setExpression(p.r >= 4 ? topEx : 'idle').setSweat(tension >= 0.6);
      p.view.update(dt);
    }

    // Active piece and its guide.
    const states: GuideShow['state'][] = ['stable', 'stable', 'risky', 'tip', 'miss'];
    const pick = qs.get('state');
    const idx = pick ? ['stable', 'perfect', 'risky', 'tip', 'miss'].indexOf(pick) : Math.floor(t / 2.4) % 5;
    const state = states[Math.max(0, idx)], perfect = idx === 1;
    const AQ = 2, A = pose('L', AQ), aw = A.w * cell, ah = A.h * cell;
    // Landing columns per state: flat on the T (stable/perfect), hanging off an edge (risky, tip), beside the tower (miss).
    const col = [1, 1.5, 3.5, 4.5, 6.6][Math.max(0, idx)];
    const pieceX = this.left + (col + A.w / 2) * cell, pieceY = this.top - 10.5 * cell + Math.sin(t * 1.5) * 3;
    const landTop = this.top - 6 * cell;
    const ghostY = landTop - ah / 2;
    this.active.setPose(pieceX, pieceY, AQ * Math.PI / 2 + Math.sin(t * 1.3) * 0.03).setRim(rim);
    this.active.update(dt);
    const contacts: [number, number][] = state === 'miss' ? [] : [0, 1, 2].filter(i => col + i < 6.5 && col + i >= 0).map(i => [pieceX - aw / 2 + (i + 0.5) * cell, landTop]);
    this.guide.show({
      key: 'L', q: AQ, pieceX, pieceY, ghostX: pieceX, ghostY, state, perfect,
      contacts: state === 'tip' ? contacts.slice(0, 1) : contacts,
      missBottomY: cam.worldView.y + cam.worldView.height,
      viewLeft: cam.worldView.x, viewRight: cam.worldView.x + cam.worldView.width,
    });
    this.guide.update(dt);
    void aw;

    // Checkpoint line 8 blocks up: the tower closes in (0-2.5 s), holds steady (2.5-4.5 s), claims, and starts over.
    const pedW = 6, cpY = this.top - 8 * cell, view = cam.worldView;
    const cycle = 7.5, phase = qs.get('cp');
    if (!this.line || (!phase && t - this.lineBorn > cycle)) { this.line?.destroy(); this.line = new CheckpointLine(this.tex, 3, 900); this.lineBorn = t; }
    const lt = phase === 'near' ? 2 : phase === 'hold' ? 3.8 : phase === 'claim' ? 99 : t - this.lineBorn;
    this.line.set({ y: cpY, x0: view.x - cell, x1: view.x + view.width + cell, near: Math.min(1, lt / 2.5), hold: lt > 2.5 ? Math.min(1, (lt - 2.5) / 2) : 0 });
    if (lt >= 4.5 && !this.line.claimed) this.line.claim(this.left, this.left + pedW * cell);
    this.line.update(dt);
    this.pb.set(this.top - 4.5 * cell, view.x - cell, view.x + view.width + cell, this.left - 1.4 * cell).update(dt);
    if (Math.floor(t / cycle) !== Math.floor((t - dt) / cycle)) this.pb.pop();
  }
}

new Phaser.Game({
  type: qs.get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#FFF7E8',
  render: qs.has('maxtex') ? { maxTextures: num('maxtex', 1) } : {},
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [Preview],
});
