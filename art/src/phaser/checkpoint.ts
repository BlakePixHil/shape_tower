// The checkpoint line on screen (art-direction.md §7.1-7.2): a cream rope with bunting in the shape
// colors and a numbered plaque, a gold glow that brightens as the tower gets close, the hold-steady
// ring, and the claim: the bunting pops off, the rope turns gold and a flag plants on it.
// Also the personal-best marker: a dashed white line with a mint flag.
//
// Pennants hang at fixed world positions, so the bunting never slides when the camera moves.

import { CHECKPOINT } from '../checkpoint.ts';
import { SIGNAL } from '../config.ts';
import { TAU, clamp, hexNum, smooth } from '../util.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { DisplayLike, ImageLike, TileSpriteLike } from './types.ts';

const use = (img: ImageLike, r: TexRef) => img.setTexture(r.key, r.frame).setOrigin(r.originX, r.originY);
const GOLD = hexNum(SIGNAL.gold), MINT = hexNum(SIGNAL.mint), INK_SOFT = 0x5B4F7A;
const easeOutBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

export interface CheckpointLayout {
  /** Line height, world px (y down). */
  y: number;
  /** Span to draw, world px: the visible width plus a block or so either side. */
  x0: number;
  x1: number;
  /** 0..1, how close the tower top is. Brightens the glow and speeds up the bunting. */
  near?: number;
  /** 0..1 hold-steady progress. 0 hides the ring. */
  hold?: number;
  /** Plaque centre, world px. Default: 2.3 blocks in from x1, which is 1.3 blocks inside the view when x1 has a 1-block margin. */
  plaqueX?: number;
}

interface Pennant { img: ImageLike; k: number }

export class CheckpointLine {
  readonly n: number;
  reduceMotion = false;
  private tex: ArtTextures;
  private depth: number;
  private rope: TileSpriteLike;
  private glow: ImageLike;
  private plaque: ImageLike;
  private label: ImageLike;
  private glint: ImageLike;
  private flag: ImageLike;
  private ticks: ImageLike[] = [];
  private pennants: Pennant[] = [];
  private l: CheckpointLayout = { y: 0, x0: 0, x1: 0 };
  private t = 0;
  private holdShown = 0;
  private holdSince = -1;
  private claimAt = -1;
  private span = { from: [0, 0], to: [0, 0], flagX: 0 };
  private ropeKey = '';

  constructor(tex: ArtTextures, n: number, depth = 900) {
    this.tex = tex;
    this.n = n;
    this.depth = depth;
    const add = tex.scene.add, px = tex.pixel(), rope = tex.rope(false), glow = tex.glowBand();
    this.glow = add.image(0, 0, glow.key).setOrigin(0.5, 0.5).setTint(GOLD).setDepth(depth - 0.05);
    this.rope = add.tileSprite(0, 0, 8, 8, rope.key).setOrigin(rope.originX, rope.originY).setDepth(depth);
    this.ropeKey = rope.key;
    this.glint = use(add.image(0, 0, px.key), tex.glint()).setDepth(depth + 0.015).setVisible(false);
    this.flag = use(add.image(0, 0, px.key), tex.flag(0)).setDepth(depth + 0.02).setVisible(false);
    this.plaque = use(add.image(0, 0, px.key), tex.plaque(n)).setDepth(depth + 0.03);
    this.label = use(add.image(0, 0, px.key), tex.label('HOLD STEADY!')).setDepth(depth + 0.05).setVisible(false);
    const tick = tex.holdTick();
    for (let i = 0; i < CHECKPOINT.holdTicks; i++) this.ticks.push(use(add.image(0, 0, tick.key, tick.frame), tick).setDepth(depth + 0.04).setVisible(false));
  }

  get claimed(): boolean { return this.claimAt >= 0; }

  /** Place the active line. Call every frame until claim(). */
  set(l: CheckpointLayout): this {
    if (!this.claimed) this.l = l;
    return this;
  }

  /**
   * Claim the line: the flag plants, the bunting pops off, and the rope turns gold and shrinks to
   * the claimed span x0..x1 (world px; usually the tower's width). The flag stands at flagX,
   * 0.6 blocks left of x0 by default.
   */
  claim(x0: number, x1: number, flagX?: number): this {
    if (this.claimed) return this;
    const cell = this.tex.cellPx, fx = flagX ?? x0 - 0.6 * cell;
    this.claimAt = this.t;
    this.span = { from: [this.l.x0, this.l.x1], to: [Math.min(fx, x0) - 0.15 * cell, x1 + 0.6 * cell], flagX: fx };
    return this;
  }

  update(dt: number): void {
    this.t += dt;
    const tex = this.tex, k = tex.scale, cell = tex.cellPx, l = this.l, t = this.t;
    const near = clamp(l.near ?? 0, 0, 1);
    const claimT = this.claimed ? t - this.claimAt : -1;
    const DROP = 0.25;
    const landed = claimT >= DROP || (this.claimed && this.reduceMotion);

    // Rope: cream while active; gold from the moment the flag lands, shrinking to the claimed span.
    let x0 = l.x0, x1 = l.x1;
    if (this.claimed) {
      const e = this.reduceMotion ? 1 : smooth(0, 1, (claimT - DROP) / 0.35);
      x0 = this.span.from[0] + (this.span.to[0] - this.span.from[0]) * e;
      x1 = this.span.from[1] + (this.span.to[1] - this.span.from[1]) * e;
    }
    const rope = tex.rope(this.claimed && landed);
    const tileW = rope.width;
    if (rope.key !== this.ropeKey) { this.ropeKey = rope.key; this.rope.setTexture(rope.key).setOrigin(rope.originX, rope.originY); }
    this.rope.setSize(Math.max(1, Math.ceil((x1 - x0) / k)), rope.height);
    this.rope.setPosition(x0, l.y).setScale(k, k);
    this.rope.tilePositionX = ((x0 / k) % tileW + tileW) % tileW;
    this.rope.tilePositionY = 0;

    // Glow: brighter and faster as the tower closes in; gone once claimed.
    const pulse = this.reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(t * TAU / (near > 0.75 ? 0.18 : 0.5));
    const glowA = this.claimed ? Math.max(0, 1 - claimT / 0.2) * 0.5 : (0.12 + 0.4 * near) * pulse;
    this.glow.setVisible(glowA > 0.01).setPosition((x0 + x1) / 2, l.y).setDisplaySize(x1 - x0, (0.9 + 1.1 * near) * cell).setAlpha(glowA);

    // Bunting on fixed world slots; skip the slots behind the plaque.
    const plaqueX = l.plaqueX ?? l.x1 - 2.3 * cell;
    const sp = CHECKPOINT.pennantSpacing * cell, first = Math.ceil(l.x0 / sp), last = Math.floor(l.x1 / sp);
    const slots: number[] = [];
    for (let i = first; i <= last; i++) if (Math.abs(i * sp - plaqueX) > (CHECKPOINT.plaqueR + 0.25) * cell) slots.push(i);
    while (this.pennants.length < slots.length) {
      const img = this.tex.scene.add.image(0, 0, this.tex.pixel().key).setDepth(this.depth + 0.01);
      this.pennants.push({ img, k: NaN });
    }
    const rate = 2.2 + 5 * near, swing = (4 + 5 * near) * Math.PI / 180;
    this.pennants.forEach((p, j) => {
      const i = slots[j];
      if (i === undefined) { p.img.setVisible(false); return; }
      if (p.k !== i) { use(p.img, tex.pennant(((i % 7) + 7) % 7)); p.k = i; }
      const x = i * sp, phase = i * 0.9;
      let sc = 1, dy = 0;
      if (this.claimed) {
        // Pop off in a wave that starts at the flag.
        const d = Math.abs(x - this.span.flagX) / cell, pt = (claimT - DROP - d * 0.02) / 0.18;
        if (pt >= 1 || this.reduceMotion) { p.img.setVisible(false); return; }
        if (pt > 0) { sc = 1 - pt; dy = -Math.sin(pt * Math.PI) * 0.3 * cell; }
      }
      const a = this.reduceMotion ? 0 : Math.sin(t * rate + phase) * swing;
      p.img.setVisible(true).setPosition(x, l.y + CHECKPOINT.rope * 0.3 * cell + dy).setRotation(a)
        .setScale(k * sc, k * sc * (this.reduceMotion ? 1 : 1 + 0.05 * Math.sin(t * rate * 1.3 + phase)));
    });

    // Plaque: sits on the rope; shrinks away when the line is claimed.
    const plaqueSc = this.claimed ? Math.max(0, 1 - claimT / 0.25) : 1;
    this.plaque.setVisible(plaqueSc > 0.01).setPosition(plaqueX, l.y).setScale(k * plaqueSc, k * plaqueSc);

    // Hold-steady ring and label, with a glint running along the rope.
    const hold = this.claimed ? (claimT < 0.3 ? 1 : 0) : clamp(l.hold ?? 0, 0, 1);
    if (hold > 0 && this.holdShown === 0) this.holdSince = t;
    this.holdShown = hold;
    const pop = this.reduceMotion ? 1 : easeOutBack(clamp((t - this.holdSince) / 0.25, 0, 1));
    const n = this.ticks.length, lit = hold * n;
    this.ticks.forEach((tk, i) => {
      if (hold <= 0) { tk.setVisible(false); return; }
      const ang = -Math.PI / 2 + (i / n) * TAU, r = CHECKPOINT.holdR * cell * pop;
      const on = clamp(lit - i, 0, 1);
      tk.setVisible(true).setPosition(plaqueX + Math.cos(ang) * r, l.y + Math.sin(ang) * r).setRotation(ang + Math.PI / 2)
        .setScale(k * pop, k * pop).setTint(on > 0 ? MINT : INK_SOFT).setAlpha(on > 0 ? 0.4 + 0.6 * on : 0.45);
    });
    // The label sits up and to the left of the ring, since the plaque hugs the right edge of the view.
    const lw = tex.label('HOLD STEADY!').width * k;
    this.label.setVisible(hold > 0).setPosition(plaqueX + 0.35 * cell - lw / 2, l.y - (CHECKPOINT.holdR + 0.5) * cell).setScale(k * pop, k * pop);
    if (hold > 0 && !this.reduceMotion && !this.claimed) {
      const f = (t * 1.4) % 1;
      this.glint.setVisible(true).setPosition(l.x0 + f * (l.x1 - l.x0), l.y).setScale(k, k).setAlpha(Math.sin(f * Math.PI) * 0.9);
    } else this.glint.setVisible(false);

    // Flag: drops in, squashes on landing, then waves.
    if (this.claimed) {
      const fr = this.reduceMotion ? 0 : Math.floor(t * 8) % CHECKPOINT.flagFrames;
      use(this.flag, tex.flag(fr));
      let y = l.y, sx = 1, sy = 1;
      if (!this.reduceMotion) {
        if (claimT < DROP) { const e = claimT / DROP; y = l.y - (1 - e * e) * 2.5 * cell; sy = 1.1; sx = 0.92; }
        else { const e = clamp((claimT - DROP) / 0.35, 0, 1), sq = Math.sin(e * Math.PI * 2.5) * (1 - e) * 0.22; sy = 1 - sq; sx = 1 + sq * 0.6; }
      }
      this.flag.setVisible(true).setPosition(this.span.flagX, y).setScale(k * sx, k * sy);
    } else this.flag.setVisible(false);
  }

  destroy(): void { for (const o of this.all()) o.destroy(); this.pennants = []; this.ticks = []; }

  private all(): DisplayLike[] {
    return [this.rope, this.glow, this.plaque, this.label, this.glint, this.flag, ...this.ticks, ...this.pennants.map(p => p.img)];
  }
}

/** The personal-best line: dashed white with a small mint flag and "BEST". */
export class PbMarker {
  reduceMotion = false;
  private tex: ArtTextures;
  private dash: TileSpriteLike;
  private flag: ImageLike;
  private label: ImageLike;
  private t = 0;
  private popAt = -10;
  private y = 0;
  private x0 = 0;
  private x1 = 0;
  private flagX = 0;
  private on = false;

  constructor(tex: ArtTextures, depth = 899) {
    this.tex = tex;
    const add = tex.scene.add, d = tex.pbDash(), px = tex.pixel();
    this.dash = add.tileSprite(0, 0, 8, 8, d.key).setOrigin(d.originX, d.originY).setAlpha(0.75).setDepth(depth);
    this.flag = use(add.image(0, 0, px.key), tex.pbFlag()).setDepth(depth + 0.01);
    this.label = use(add.image(0, 0, px.key), tex.label('BEST', 0.3)).setDepth(depth + 0.02);
    this.hide();
  }

  /** Place the marker: line height and span in world px; the flag stands at flagX (default 0.5 blocks in from x0). */
  set(y: number, x0: number, x1: number, flagX?: number): this {
    this.on = true; this.y = y; this.x0 = x0; this.x1 = x1; this.flagX = flagX ?? x0 + 0.5 * this.tex.cellPx;
    return this;
  }

  /** The tower just passed the best: the flag and label pop. */
  pop(): this { this.popAt = this.t; return this; }

  hide(): this { this.on = false; for (const o of [this.dash, this.flag, this.label]) o.setVisible(false); return this; }

  update(dt: number): void {
    this.t += dt;
    if (!this.on) return;
    const tex = this.tex, k = tex.scale, cell = tex.cellPx, d = tex.pbDash();
    this.dash.setVisible(true).setSize(Math.max(1, Math.ceil((this.x1 - this.x0) / k)), d.height).setPosition(this.x0, this.y).setScale(k, k);
    this.dash.tilePositionX = ((this.x0 / k) % d.width + d.width) % d.width;
    const e = (this.t - this.popAt) / 0.5;
    const sc = this.reduceMotion || e >= 1 || e < 0 ? 1 : 1 + Math.sin(e * Math.PI) * 0.45 * (1 - e);
    this.flag.setVisible(true).setPosition(this.flagX, this.y).setScale(k * sc, k * sc);
    const lb = tex.label('BEST', 0.3);
    this.label.setVisible(true).setPosition(this.flagX + 0.55 * cell + lb.width * k / 2, this.y - 0.62 * cell).setScale(k * sc, k * sc);
  }

  destroy(): void { this.dash.destroy(); this.flag.destroy(); this.label.destroy(); }
}
