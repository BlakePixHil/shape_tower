// Celebrations on screen (art-direction.md §7.1): fireworks for pb_crossed, and the milestone
// celebrations: a balloon release, a rainbow arc and a comet shower. Screen space, in the background
// layer: over the backdrop and the wind, under the tower. Fire one and call update(dt) every frame.

import { BALLOONS, CELEB, type CelebTex } from '../celebrate.ts';
import { BUNTING_KEYS } from '../checkpoint.ts';
import { ART_SHAPES } from '../shapes.ts';
import { clamp, hexNum, lerp } from '../util.ts';
import type { VfxName } from '../vfx.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { ImageLike } from './types.ts';

export type FireworkKind = 'peony' | 'ring' | 'willow';
export const FIREWORK_KINDS: FireworkKind[] = ['peony', 'ring', 'willow'];

export interface CelebrationOptions {
  /** Screen size in game px. */
  width: number;
  height: number;
  /** Depth (default -9: over the backdrop and the wind, under the tower). */
  depth?: number;
  /** Seed for placement. */
  seed?: number;
}

/** Firework colors: the shape colors' light tones read best as light. */
const FW_COLORS = BUNTING_KEYS.map(k => hexNum(ART_SHAPES[k].base));
const GOLD = 0xFFC23D;
const COMET_TINTS = [0xFFFFFF, 0xBFE6FF, 0xFFE7A8, 0xFFC4E1];

/** Pop-in scale over t = 0..1: overshoots to about 1.1, then settles at 1. */
const pop = (t: number): number => { const k = Math.min(1, t) - 1; return 1 + 2.70158 * k * k * k + 1.70158 * k * k; };

interface Bit {
  img: ImageLike;
  x: number; y: number; vx: number; vy: number;
  /** Gravity (px/s²) and drag (per second). */
  g: number; drag: number;
  age: number; life: number; delay: number;
  s0: number; s1: number; a: number;
  /** star: stretched along its velocity; streak: a willow streak, longer the faster; trail: a rising shell; flat: pops in and spins. */
  mode: 'star' | 'streak' | 'trail' | 'flat' | 'balloon' | 'comet' | 'rainbow';
  rot: number; spin: number; phase: number;
  /** A burst to set off when this shell's life ends. */
  burst?: () => void;
  /** Spawns a sparkle every so often along the way (comets). */
  dust?: number;
}

export class Celebration {
  /** Fewer stars, no sway or sweep: the rainbow fades in, comets and balloons fly straight. */
  reduceMotion = false;
  private tex: ArtTextures;
  private W: number;
  private H: number;
  private depth: number;
  private bits: Bit[] = [];
  private pool: ImageLike[] = [];
  private rng: number;
  private n = 0;

  constructor(tex: ArtTextures, o: CelebrationOptions) {
    this.tex = tex;
    this.W = o.width; this.H = o.height;
    this.depth = o.depth ?? -9;
    this.rng = (o.seed ?? 1) * 2654435761 % 4294967296 || 1;
  }

  resize(width: number, height: number): this { this.W = width; this.H = height; return this; }

  /** True while anything is on screen. */
  get active(): boolean { return this.bits.length > 0; }

  /**
   * One firework: a shell climbs from below the screen and bursts at (x, y) after `delay` s. `color` is
   * a shape color (0 to 6, BUNTING_KEYS order); the willow is always gold.
   */
  firework(x: number, y: number, kind: FireworkKind = 'peony', color = Math.floor(this.rand() * FW_COLORS.length), delay = 0): this {
    const u = this.tex.cellPx, rise = 0.7, x0 = x + (this.rand() - 0.5) * u * 1.5, y0 = this.H + u;
    const tint = kind === 'willow' ? GOLD : FW_COLORS[color % FW_COLORS.length];
    // Constant deceleration to a stop at the burst point.
    const vy = 2 * (y - y0) / rise, g = -vy / rise;
    this.add('trail', {
      x: x0, y: y0, vx: (x - x0) / rise, vy, g, drag: 0, life: rise, delay, s0: 0.9, s1: 0.5, a: 0.9, mode: 'trail',
      burst: () => this.burst(x, y, kind, tint, color),
    }, 0xFFE9B0);
    return this;
  }

  /**
   * The best-height volley (pb_crossed): `n` fireworks over about 1.6 s in the upper sky, the kinds in
   * turn, alternating sides so the falling shape in the middle stays clear.
   */
  fireworks(n = 5): this {
    const m = this.reduceMotion ? Math.min(n, 3) : n;
    for (let i = 0; i < m; i++) {
      const side = (this.n + i) % 2 ? 1 : -1, x = this.W * (0.5 + side * lerp(0.17, 0.36, this.rand()));
      const y = this.H * lerp(0.1, 0.36, this.rand());
      this.firework(x, y, FIREWORK_KINDS[(this.n + i) % 3], Math.floor(this.rand() * FW_COLORS.length), i * 1.6 / m);
    }
    this.n += m;
    return this;
  }

  /**
   * A balloon release: `n` party balloons in the shape colors pop up low on both sides of the screen,
   * beside the tower, and float up and away, swaying and drifting outward, over about 5 s.
   */
  balloons(n = 14): this {
    const u = this.tex.cellPx, m = this.reduceMotion ? Math.ceil(n / 2) : n;
    for (let i = 0; i < m; i++) {
      const life = 4.2 + this.rand() * 1.6, vy = -(this.H * 0.9 + u * 3) / life, side = i % 2 ? 1 : -1;
      this.add(`balloon${(i + this.n) % BALLOONS}` as CelebTex, {
        x: this.W * (0.5 + side * lerp(0.24, 0.46, this.rand())), y: this.H * lerp(0.62, 0.86, this.rand()),
        vx: side * this.rand() * u * 0.5, vy,
        g: 0, drag: 0, life, delay: i * 0.05 + this.rand() * 0.25, s0: 1 + this.rand() * 0.35, s1: 1.1, a: 1, mode: 'balloon',
        phase: this.rand() * 6,
      });
    }
    this.n += m;
    return this;
  }

  /**
   * A rainbow arc: it sweeps across the sky left to right in 0.8 s with a cloud at each foot, holds,
   * then fades, about 3 s in all. Its feet sit at `y` (default 46% down), centred on `x`.
   */
  rainbow(x = this.W / 2, y = this.H * 0.46): this {
    const u = this.tex.cellPx, half = CELEB.rainbow[0] / 2 - 0.55;
    this.add('rainbow', { x, y, vx: 0, vy: 0, g: 0, drag: 0, life: 3, delay: 0, s0: 1, s1: 1, a: 1, mode: 'rainbow' });
    this.add('cloud', { x: x - half * u, y: y + u * 0.15, vx: 0, vy: 0, g: 0, drag: 0, life: 2.95, delay: 0, s0: 0.95, s1: 0.95, a: 1, mode: 'flat' });
    this.add('cloud', { x: x + half * u, y: y + u * 0.15, vx: 0, vy: 0, g: 0, drag: 0, life: 2.95 - 0.7, delay: this.reduceMotion ? 0 : 0.7, s0: -0.9, s1: -0.9, a: 1, mode: 'flat' });
    return this;
  }

  /** A comet shower: `n` comets streak down across the sky over about 2 s, `dir` 1 heading right. */
  comets(n = 10, dir: -1 | 1 = 1): this {
    const u = this.tex.cellPx, m = this.reduceMotion ? Math.ceil(n / 2) : n, ang = 0.42;
    for (let i = 0; i < m; i++) {
      const sp = u * (20 + this.rand() * 10), life = 1.1 + this.rand() * 0.5;
      const x = dir > 0 ? lerp(-0.3, 0.75, this.rand()) * this.W : lerp(0.25, 1.3, this.rand()) * this.W;
      this.add('comet', {
        x, y: this.H * lerp(-0.08, 0.32, this.rand()), vx: Math.cos(ang) * sp * dir, vy: Math.sin(ang) * sp,
        g: 0, drag: 0, life, delay: i * 1.8 / m + this.rand() * 0.12, s0: 0.55 + this.rand() * 0.5, s1: 1, a: 1, mode: 'comet',
        dust: 0,
      }, COMET_TINTS[Math.floor(this.rand() * COMET_TINTS.length)]);
    }
    return this;
  }

  update(dt: number): void {
    const S = this.tex.scale, u = this.tex.cellPx;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      if (b.delay > 0) { b.delay -= dt; if (b.delay > 0) continue; b.img.setVisible(true); }
      b.age += dt;
      if (b.age >= b.life) {
        b.burst?.();
        this.release(b); this.bits.splice(i, 1);
        continue;
      }
      const t = b.age / b.life, k = Math.exp(-b.drag * dt);
      b.vx *= k; b.vy = b.vy * k + b.g * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const sc = lerp(b.s0, b.s1, t) * S;
      if (b.mode === 'star' || b.mode === 'streak' || b.mode === 'trail') {
        // Stretched along the way they move: streaky as they fly out, round as they slow.
        const v = Math.hypot(b.vx, b.vy);
        const stretch = b.mode === 'trail' ? 1 : b.mode === 'streak' ? clamp(0.35 + v / (u * 5), 0.35, 1.3) : 1 + clamp(v / (u * 6), 0, 1.6);
        const fade = b.mode === 'trail' ? 1 : clamp((1 - t) / 0.45, 0, 1);
        b.img.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx)).setScale(sc * stretch, sc).setAlpha(b.a * fade);
      } else if (b.mode === 'balloon') {
        const sway = this.reduceMotion ? 0 : Math.sin(b.age * 2.2 + b.phase), s = sc * pop(b.age / 0.3);
        b.img.setPosition(b.x + sway * u * 0.3, b.y).setRotation(sway * 0.12).setScale(s).setAlpha(b.a * clamp((b.life - b.age) / 0.6, 0, 1));
      } else if (b.mode === 'comet') {
        b.img.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx)).setScale(sc).setAlpha(clamp(b.age / 0.15, 0, 1) * clamp((b.life - b.age) / 0.35, 0, 1));
        b.dust = (b.dust ?? 0) + dt * 18;
        while (b.dust >= 1 && !this.reduceMotion) { b.dust -= 1; this.sparkle(b.x - b.vx * 0.04, b.y - b.vy * 0.04); }
      } else if (b.mode === 'rainbow') {
        // The arc sweeps in left to right, holds, then fades out.
        const fr = this.tex.celebration('rainbow'), w = fr.width, sweep = this.reduceMotion ? 1 : clamp(b.age / 0.8, 0, 1);
        const e = 1 - (1 - sweep) ** 3;
        b.img.setCrop(0, 0, w * e, fr.height).setPosition(b.x, b.y).setScale(S)
          .setAlpha((this.reduceMotion ? clamp(b.age / 0.5, 0, 1) : 1) * clamp((b.life - b.age) / 0.6, 0, 1));
      } else {
        // Flat (clouds, mini shapes): pop in, spin, fade out. A negative scale mirrors it.
        const s = this.reduceMotion ? 1 : pop(b.age / 0.25);
        b.rot += b.spin * dt;
        b.img.setPosition(b.x, b.y).setRotation(b.rot).setScale(sc * s, Math.abs(sc) * s).setAlpha(clamp((b.life - b.age) / 0.6, 0, 1));
      }
    }
  }

  /** Remove everything at once (a restart, the run ending). */
  clear(): this {
    for (const b of this.bits) this.release(b);
    this.bits = [];
    return this;
  }

  destroy(): void {
    for (const b of this.bits) b.img.destroy();
    for (const img of this.pool) img.destroy();
    this.bits = []; this.pool = [];
  }

  // ---- internals ----

  /** The burst itself: stars (and for a peony, a few mini shapes) flying out from (x, y). */
  private burst(x: number, y: number, kind: FireworkKind, tint: number, color: number): void {
    const u = this.tex.cellPx, rm = this.reduceMotion ? 0.5 : 1;
    if (kind === 'peony') {
      const n = Math.round(34 * rm);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.rand() * 0.2, v = u * (6.5 + this.rand() * 2.5);
        this.star(x, y, Math.cos(a) * v, Math.sin(a) * v, tint, 1.1 + this.rand() * 0.4, 2.2, u * 3);
      }
      for (let i = 0; i < 6 * rm; i++) {
        const a = this.rand() * Math.PI * 2, v = u * (2 + this.rand() * 3);
        this.add(`mini_${BUNTING_KEYS[(color + i) % 7]}` as VfxName, {
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: u * 4, drag: 1.2, life: 1.4, delay: 0, s0: 1, s1: 0.8, a: 1, mode: 'flat',
          spin: (this.rand() - 0.5) * 10,
        }, undefined, true);
      }
    } else if (kind === 'ring') {
      // A tilted ring in the burst's color, and a smaller one inside in the next color.
      const tilt = (this.rand() - 0.5) * 1.2, inner = FW_COLORS[(color + 2) % FW_COLORS.length];
      for (const [n, v, col] of [[Math.round(26 * rm), u * 7.5, tint], [Math.round(10 * rm), u * 3.4, inner]] as [number, number, number][]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, rx = Math.cos(a) * v, ry = Math.sin(a) * v * 0.55;
          this.star(x, y, rx * Math.cos(tilt) - ry * Math.sin(tilt), rx * Math.sin(tilt) + ry * Math.cos(tilt), col, 1.2, 2.4, u * 2.5);
        }
      }
    } else {
      // Willow: slow gold stars that droop into long streaks.
      const n = Math.round(30 * rm);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.rand() * 0.25, v = u * (4.5 + this.rand() * 1.5);
        this.add('trail', {
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: u * 3.2, drag: 1.1, life: 1.9 + this.rand() * 0.5, delay: 0,
          s0: 0.75, s1: 0.45, a: 0.95, mode: 'streak',
        }, tint);
      }
    }
    // A white flash of a core so every burst reads as light, day or night.
    this.add('star', { x, y, vx: 0, vy: 0, g: 0, drag: 0, life: 0.28, delay: 0, s0: 3.2, s1: 4.4, a: 0.8, mode: 'star' });
  }

  private star(x: number, y: number, vx: number, vy: number, tint: number, life: number, drag: number, g: number): void {
    this.add('star', { x, y, vx, vy, g, drag, life, delay: 0, s0: 1.3, s1: 0.7, a: 1, mode: 'star' }, tint);
  }

  private sparkle(x: number, y: number): void {
    const u = this.tex.cellPx;
    this.add('star', {
      x: x + (this.rand() - 0.5) * u * 0.3, y: y + (this.rand() - 0.5) * u * 0.3, vx: 0, vy: u * 0.5, g: 0, drag: 0,
      life: 0.45, delay: 0, s0: 0.5, s1: 0.15, a: 0.9, mode: 'star',
    });
  }

  private add(name: CelebTex | VfxName, b: Omit<Bit, 'img' | 'age' | 'rot' | 'spin' | 'phase'> & Partial<Pick<Bit, 'phase' | 'spin'>>, tint?: number, vfx = false): void {
    const r: TexRef = vfx ? this.tex.vfx(name as VfxName) : this.tex.celebration(name as CelebTex);
    const img = (this.pool.pop() ?? this.tex.scene.add.image(0, 0, r.key, r.frame).setScrollFactor(0))
      .setTexture(r.key, r.frame).setOrigin(r.originX, r.originY).setVisible(b.delay <= 0).setAlpha(0).setRotation(0)
      .setDepth(this.depth + (b.mode === 'balloon' ? 0.1 : b.mode === 'rainbow' || b.mode === 'flat' ? -0.1 : 0))
      .setCrop();
    if (tint === undefined) img.clearTint(); else img.setTint(tint);
    this.bits.push({ img, age: 0, rot: 0, spin: 0, phase: 0, ...b });
  }

  private release(b: Bit): void { b.img.setVisible(false).setCrop(); this.pool.push(b.img); }

  private rand(): number {
    let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0;
    return this.rng / 4294967296;
  }
}
