// The power bubble on screen (gameplay.md §13): it pops in with a ring and sparkles, bobs and
// jiggles while it waits, flickers when it's about to go, and either bursts (its icon can fly to the
// slot) or drifts away. It owns its burst sprites, so wiring it is set(), update(), and one of
// collect() or fade() before destroy().

import { POWER, POWER_COLORS, type PowerKind } from '../powers.ts';
import { TAU, clamp, hash, hexNum, lerp } from '../util.ts';
import { VFX, type VfxName } from '../vfx.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { ImageLike } from './types.ts';

const use = (img: ImageLike, r: TexRef) => img.setTexture(r.key, r.frame).setOrigin(r.originX, r.originY);
const ADD = 1; // Phaser.BlendModes.ADD
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** A burst sprite flying out from the bubble's centre. Sizes in blocks, speeds in blocks per second. */
interface Bit { img: ImageLike; name: VfxName; at: number; life: number; a: number; r0: number; dist: number; s0: number; s1: number; spin: number; tangent: boolean }

export class PowerBubble {
  readonly kind: PowerKind;
  reduceMotion = false;
  private tex: ArtTextures;
  private depth: number;
  private body: ImageLike;
  private icon: ImageLike;
  private gloss: ImageLike;
  private bits: Bit[] = [];
  private x = 0;
  private y = 0;
  private t = 0;
  private mode: 'live' | 'collect' | 'fade' = 'live';
  private endAt = 0;
  private warn = false;
  private target: { x: number; y: number } | null = null;
  private from = { x: 0, y: 0 };
  private col: number;

  constructor(tex: ArtTextures, kind: PowerKind, depth = 30) {
    this.tex = tex;
    this.kind = kind;
    this.depth = depth;
    this.col = hexNum(POWER_COLORS[kind]);
    const add = tex.scene.add, px = tex.pixel().key;
    this.body = use(add.image(0, 0, px), tex.bubble(kind)).setDepth(depth);
    this.icon = use(add.image(0, 0, px), tex.powerIcon(kind)).setDepth(depth + 0.01);
    this.gloss = use(add.image(0, 0, px), tex.bubbleGloss()).setDepth(depth + 0.02);
    // Spawn: a ring and six sparkles.
    this.bit('ring', 0, 0.3, 0, 0, 0, 1.0, 2.2, 0, false);
    for (let i = 0; i < 6; i++) this.bit('sparkle', 0.04 + i * 0.01, 0.42, (i / 6) * TAU + 0.3, 0.5, 0.7, 0.45, 0.08, 5, false);
    this.update(0);
  }

  /** True once collect() or fade() has finished playing; then destroy() it. */
  get done(): boolean { return this.mode !== 'live' && this.t - this.endAt >= (this.mode === 'collect' ? POWER.collect : POWER.fade); }

  /** Centre in world px (the sim's bubble position). The bob is added on top. */
  set(x: number, y: number): this {
    if (this.mode === 'live') { this.x = x; this.y = y; }
    return this;
  }

  /** Flicker: the bubble is on its last shape. */
  ending(on = true): this { this.warn = on; return this; }

  /**
   * Burst: a ring, film shards and sparkles in the power's color. With `to` (world px), the icon
   * hops and flies there on an arc, e.g. to the slot it fills; without, it pops up and fades.
   */
  collect(to?: { x: number; y: number }): this {
    if (this.mode !== 'live') return this;
    this.mode = 'collect';
    this.endAt = this.t;
    this.target = to ?? null;
    this.from = { x: this.icon.x, y: this.icon.y };
    const t = this.t;
    this.bit('ring', t, 0.35, 0, 0, 0, POWER.bubbleR * 2, POWER.bubbleR * 4, 0, false);
    for (let i = 0; i < 6; i++) {
      const j = hash(i * 7.7 + this.kind.length);
      this.bit('shard', t, 0.34 + 0.12 * j, (i / 6) * TAU + 0.5 * j, POWER.bubbleR * 0.9, 0.7 + 0.7 * j, 0.7 + 0.5 * j, 0.3, 0, true, i % 2 === 0);
    }
    for (let i = 0; i < 6; i++) this.bit('sparkle', t + 0.03, 0.5, (i / 6) * TAU + 1.1, POWER.bubbleR, 0.9 + 0.5 * hash(i * 3.3), 0.45, 0.08, 6, false);
    return this;
  }

  /** Expire: the bubble drifts up, shrinks and fades. */
  fade(): this {
    if (this.mode !== 'live') return this;
    this.mode = 'fade';
    this.endAt = this.t;
    for (let i = 0; i < 4; i++) this.bit('dot', this.t + 0.12, 0.3, -Math.PI / 2 + (i - 1.5) * 0.7, POWER.bubbleR * 0.7, 0.4, 0.3, 0.05, 0, false);
    return this;
  }

  update(dt: number): void {
    this.t += dt;
    const k = this.tex.scale, cell = this.tex.cellPx, t = this.t, calm = this.reduceMotion;
    const bob = calm ? 0 : POWER.bob * Math.sin(t * POWER.bobRate) * cell;
    let sc = 1, sx = 1, sy = 1, alpha = 1, dy = bob;
    if (this.mode === 'live') {
      sc = calm ? 1 : easeOutBack(clamp(t / POWER.spawn, 0, 1));
      const j = calm ? 0 : 0.035 * Math.sin(t * 4.4);
      sx = 1 + j; sy = 1 - j;
      if (this.warn) alpha = calm ? 0.7 : 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(t * TAU * 3));
    } else if (this.mode === 'collect') {
      const f = clamp((t - this.endAt) / 0.16, 0, 1);
      sc = 1 + 0.45 * easeOut(f); alpha = 1 - f;
    } else {
      const f = clamp((t - this.endAt) / POWER.fade, 0, 1);
      sc = 1 - 0.3 * f; alpha = 1 - f; dy = bob - 0.3 * cell * easeOut(f);
    }
    const bx = this.x, by = this.y + dy;
    this.body.setPosition(bx, by).setScale(k * sc * sx, k * sc * sy).setAlpha(alpha).setVisible(alpha > 0.01);
    this.gloss.setPosition(bx, by).setScale(k * sc * sx, k * sc * sy).setAlpha(alpha).setVisible(alpha > 0.01);

    // The icon lags the bob a little, like it floats inside.
    if (this.mode === 'collect') {
      const e = t - this.endAt;
      if (this.target) {
        const hop = clamp(e / 0.08, 0, 1), u = easeInOut(clamp((e - 0.08) / 0.36, 0, 1));
        const x = lerp(this.from.x, this.target.x, u), y = lerp(this.from.y, this.target.y, u) - Math.sin(u * Math.PI) * 1.2 * cell;
        const s = u > 0 ? lerp(1.25, 0.6, u) : 1 + 0.25 * hop;
        this.icon.setPosition(x, y).setRotation(Math.sin(u * Math.PI) * 0.45).setScale(k * s).setAlpha(u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15).setVisible(u < 1);
      } else {
        const f = clamp(e / 0.4, 0, 1);
        this.icon.setPosition(this.from.x, this.from.y - 0.6 * cell * easeOut(f)).setRotation(0).setScale(k * (1 + 0.35 * easeOut(f))).setAlpha(1 - f * f).setVisible(f < 1);
      }
    } else {
      const lag = calm ? 0 : POWER.bob * 0.35 * Math.sin(t * POWER.bobRate - 0.8) * cell;
      this.icon.setPosition(bx, by + lag).setRotation(calm ? 0 : POWER.sway * Math.sin(t * POWER.swayRate)).setScale(k * sc).setAlpha(alpha).setVisible(alpha > 0.01);
    }

    for (const b of this.bits) {
      const f = (t - b.at) / b.life;
      if (f < 0 || f >= 1 || (calm && b.name !== 'ring')) { b.img.setVisible(false); continue; }
      const d = (b.r0 + b.dist * easeOut(f)) * cell, x = this.x + Math.cos(b.a) * d, y = this.y + dy + Math.sin(b.a) * d;
      const s = lerp(b.s0, b.s1, easeOut(f)) / VFX[b.name as keyof typeof VFX];
      const fadeFrom = b.name === 'ring' ? 0 : 0.5;
      b.img.setVisible(true).setPosition(x, y).setScale(k * s).setAlpha(f < fadeFrom ? 1 : 1 - (f - fadeFrom) / (1 - fadeFrom))
        .setRotation(b.tangent ? b.a + Math.PI / 2 : b.spin * (t - b.at));
    }
  }

  destroy(): void {
    for (const o of [this.body, this.icon, this.gloss, ...this.bits.map(b => b.img)]) o.destroy();
    this.bits = [];
  }

  /** Add a burst sprite: starts at `at` (s), flies from r0 to r0 + dist blocks along angle a, sized s0 to s1 blocks. Tinted in the power's color unless white. */
  private bit(name: VfxName, at: number, life: number, a: number, r0: number, dist: number, s0: number, s1: number, spin: number, tangent: boolean, white = false): void {
    const img = use(this.tex.scene.add.image(0, 0, this.tex.pixel().key), this.tex.vfx(name)).setDepth(this.depth + 0.03).setVisible(false);
    img.setTint(white ? 0xFFFFFF : this.col);
    if (name === 'sparkle') img.setBlendMode(ADD);
    this.bits.push({ img, name, at, life, a, r0, dist, s0, s1, spin, tangent });
  }
}
