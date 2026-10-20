// Art kit preview: the Meadow, a small tower, an active piece and its landing guide, all through
// the Phaser 4 adapter exactly as the game will use it.
// URL options: ?state=stable|perfect|risky|tip|miss (else cycles) &climb=<blocks> &zoom=<n>
// &sp=<sky position> &tension=<0..1> &gallery=1 (every shape, rotation and look).

import * as Phaser from 'phaser';
import {
  ART_SHAPES, ArtTextures, Backdrop, BlocklingView, GuideView, SkyClock, pedestalHeight, pose, rimAmount,
  type Expression, type GuideShow, type SceneLike,
} from '../src/index.ts';

const qs = new URLSearchParams(location.search);
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

  constructor() { super('preview'); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    const scene: SceneLike = this; // The adapter's structural types must accept a real Phaser scene.
    this.cell = W / 12;
    this.tex = new ArtTextures(scene, { cellPx: this.cell });
    if (qs.get('gallery')) { this.gallery(W); return; }

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

  update(time: number, deltaMs: number): void {
    if (qs.get('gallery')) return;
    const dt = Math.min(0.05, deltaMs / 1000), t = (time - this.time0) / 1000;
    const cell = this.cell, cam = this.cameras.main;
    cam.scrollY = -num('climb', 0) * cell;

    const sp = this.sky.update(dt, 0, 0.2);
    const ground = (this.groundY - cam.worldView.y) * cam.zoom;
    this.backdrop.update(dt, ground, qs.has('sp') ? num('sp', 0) : sp);
    const rim = rimAmount(qs.has('sp') ? num('sp', 0) : sp);

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
