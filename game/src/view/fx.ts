// Juice helpers that live on the render side only (gameplay.md §11: juice never changes physics).

import * as Phaser from 'phaser';

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number; vy: number; spin: number;
  life: number; age: number;
  gravity: number; drag: number;
  s0: number; s1: number; a0: number;
}

export interface ParticleOpts {
  tex: string;
  frame?: string;     // atlas frame (the art kit's effects)
  tint?: number;
  scale?: number;
  endScale?: number;
  life?: number;
  gravity?: number;   // px/s², +y is down
  drag?: number;      // per second
  spin?: number;
  angle?: number;     // fixed starting rotation (default: random)
  alpha?: number;
  blend?: Phaser.BlendModes;
}

/** A small pooled particle system, capped at 250 live particles (art-direction.md §7.4). */
export class Particles {
  private live: Particle[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  /** Off when juice is off (Gate 1). */
  enabled = true;
  constructor(private scene: Phaser.Scene, private depth: number, private cap = 250) {}

  spawn(x: number, y: number, vx: number, vy: number, o: ParticleOpts): void {
    if (!this.enabled) return;
    if (this.live.length >= this.cap) {
      const old = this.live.shift()!;
      this.recycle(old.img);
    }
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, o.tex, o.frame).setDepth(this.depth);
    img.setTexture(o.tex, o.frame).setPosition(x, y).setVisible(true).setAlpha(o.alpha ?? 1).setRotation(o.angle ?? Math.random() * 6.28);
    img.setTint(o.tint ?? 0xffffff);
    img.setBlendMode(o.blend ?? Phaser.BlendModes.NORMAL);
    const s = o.scale ?? 1;
    img.setScale(s);
    this.live.push({ img, vx, vy, spin: o.spin ?? 0, life: o.life ?? 0.5, age: 0, gravity: o.gravity ?? 0, drag: o.drag ?? 0, s0: s, s1: o.endScale ?? s * 0.3, a0: o.alpha ?? 1 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life) { this.live.splice(i, 1); this.recycle(p.img); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.gravity * dt;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.img.rotation += p.spin * dt;
      const t = p.age / p.life;
      p.img.setScale(p.s0 + (p.s1 - p.s0) * t);
      p.img.setAlpha(p.a0 * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4));
    }
  }

  clear(): void {
    for (const p of this.live) this.recycle(p.img);
    this.live = [];
  }

  private recycle(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    this.pool.push(img);
  }
}

/** Trauma-based screen shake: offset = trauma² × max, smooth noise, decay 1.6/s (§7.4). */
export class Shaker {
  trauma = 0;
  private t = 0;
  scale = 1; // 0 off, 0.5 low, 1 full
  add(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt: number, maxPx: number): { x: number; y: number } {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - 1.6 * dt);
    const s = this.trauma * this.trauma * maxPx * this.scale;
    if (s <= 0.01) return { x: 0, y: 0 };
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    return { x: n(31, 0) * s, y: n(37, 2) * s };
  }
}

/** Slow motion and hit-stop. Both change how many fixed steps run per second, never the step size. */
export class TimeControl {
  private stopUntil = 0;
  private slowUntil = 0;
  private slowScale = 1;
  enabled = true;
  hitstop(now: number, ms: number): void { if (this.enabled) this.stopUntil = Math.max(this.stopUntil, now + ms); }
  slowmo(now: number, scale: number, ms: number): void {
    if (!this.enabled) return;
    if (now < this.slowUntil && this.slowScale <= scale) { this.slowUntil = Math.max(this.slowUntil, now + ms); return; }
    this.slowScale = scale;
    this.slowUntil = now + ms;
  }
  scale(now: number): number {
    if (now < this.stopUntil) return 0;
    if (now < this.slowUntil) return this.slowScale;
    return 1;
  }
}

export const easeBackOut = (t: number, s = 1.7): number => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const easeElasticOut = (t: number): number => t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

/** A soft round particle, white, for tinting. */
export function bakeDot(size: number, soft = true): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  if (soft) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** A tiny square with an Ink edge, white inside for tinting: confetti and stone chips. */
export function bakeChip(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#22183A';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#FFFFFF';
  const b = Math.max(1, size * 0.18);
  ctx.fillRect(b, b, size - 2 * b, size - 2 * b);
  return c;
}
