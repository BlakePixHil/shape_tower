// Blockling Pop's effects layer (Pop plan §8): confetti and sparkles from popping cells, floating
// points, the "Double!" banners, and trauma-based shake. Plain Canvas 2D, drawn over the board and
// never over the held shape. Times are ms; positions device px.

import { FONT_DISPLAY, INK } from '@art/index.ts';

interface Bit {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; size: number; color: string;
  age: number; life: number; kind: 'square' | 'spark';
}

interface Floater {
  text: string; x: number; y: number; age: number; life: number;
  size: number; fill: string; rise: number; pop: boolean;
}

interface Ring { x: number; y: number; r: number; age: number; life: number; delay: number; color: string; width: number }

/** Live particles at most (Pop plan §8 budget). */
const MAX_BITS = 250;

export class PopFx {
  private bits: Bit[] = [];
  private floats: Floater[] = [];
  private rings: Ring[] = [];
  private trauma = 0;
  private shakeT = 0;
  /** Device px per CSS px: shake and text scale with it. */
  private readonly k: number;
  constructor(k: number) { this.k = k; }

  get busy(): boolean { return this.bits.length > 0 || this.floats.length > 0 || this.rings.length > 0 || this.trauma > 0.001; }

  clear(): void { this.bits = []; this.floats = []; this.rings = []; this.trauma = 0; }

  /** A soft shockwave ring growing to radius `r` (device px), after `delay` ms. */
  ring(x: number, y: number, r: number, o: { delay?: number; life?: number; color?: string; width?: number } = {}): void {
    this.rings.push({ x, y, r, age: 0, life: o.life ?? 420, delay: o.delay ?? 0, color: o.color ?? '#FFF3B8', width: o.width ?? r * 0.12 });
  }

  /** A confetti cannon: a cone of squares fired from (x, y) at `angle` (radians, 0 = right, -π/2 = up). */
  cannon(x: number, y: number, angle: number, cell: number, colors: string[], n = 40): void {
    for (let i = 0; i < n && this.bits.length < MAX_BITS; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7, sp = (0.9 + Math.random() * 0.9) * cell * 0.03;
      this.bits.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.03,
        size: cell * (0.14 + Math.random() * 0.12), color: colors[i % colors.length], age: 0, life: 1100 + Math.random() * 700, kind: 'square',
      });
    }
  }

  /** A faint stardust mote behind a dragged shape. */
  dust2(x: number, y: number, cell: number): void {
    if (this.bits.length >= MAX_BITS - 40) return;
    this.bits.push({ x, y, vx: (Math.random() - 0.5) * cell * 0.001, vy: cell * 0.0006, rot: 0, vr: 0.003, size: cell * (0.12 + Math.random() * 0.1), color: 'rgba(255,250,215,0.9)', age: 0, life: 360, kind: 'spark' });
  }

  /** A cell bursting: confetti squares of its colours and a sparkle or two. */
  burst(x: number, y: number, cell: number, colors: string[], n = 7): void {
    for (let i = 0; i < n && this.bits.length < MAX_BITS; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.25 + Math.random() * 0.55) * cell * 0.012;
      this.bits.push({
        x: x + (Math.random() - 0.5) * cell * 0.5, y: y + (Math.random() - 0.5) * cell * 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cell * 0.006, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.02,
        size: cell * (0.12 + Math.random() * 0.1), color: colors[i % colors.length], age: 0, life: 520 + Math.random() * 380, kind: 'square',
      });
    }
    if (this.bits.length < MAX_BITS) {
      this.bits.push({ x, y, vx: 0, vy: -cell * 0.0015, rot: 0, vr: 0.004, size: cell * 0.5, color: '#FFFFFF', age: 0, life: 320, kind: 'spark' });
    }
  }

  /** A little dust at a placed shape's corners. */
  dust(x: number, y: number, cell: number): void {
    for (let i = 0; i < 4 && this.bits.length < MAX_BITS; i++) {
      const a = Math.PI + Math.random() * Math.PI;
      this.bits.push({
        x, y, vx: Math.cos(a) * cell * 0.004, vy: Math.sin(a) * cell * 0.003, rot: 0, vr: 0,
        size: cell * (0.08 + Math.random() * 0.06), color: 'rgba(255,255,255,0.9)', age: 0, life: 300, kind: 'square',
      });
    }
  }

  /** Floating text: points rising from a pop, or a banner that pops in. `size` is CSS px. */
  text(text: string, x: number, y: number, o: { size?: number; fill?: string; life?: number; rise?: number; pop?: boolean } = {}): void {
    this.floats.push({ text, x, y, age: 0, life: o.life ?? 900, size: (o.size ?? 24) * this.k, fill: o.fill ?? '#FFFFFF', rise: (o.rise ?? 40) * this.k, pop: !!o.pop });
  }

  /** Draws text in the banner style right now (no animation): the faint "Double!" preview. `size` is CSS px. */
  label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, alpha: number): void {
    const px = Math.round(size * this.k);
    c.save();
    c.globalAlpha = alpha;
    c.font = `700 ${px}px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = px * 0.22;
    c.strokeStyle = INK;
    c.strokeText(text, x, y);
    c.fillStyle = fill;
    c.fillText(text, x, y);
    c.restore();
  }

  /** Adds trauma (0 to 1); the shake is trauma² × 6 pt at most. */
  kick(t: number): void { this.trauma = Math.min(1, this.trauma + t); }

  /** The shake offset this frame, device px. */
  offset(): [number, number] {
    const s = this.trauma * this.trauma * 6 * this.k;
    if (s < 0.05) return [0, 0];
    return [Math.sin(this.shakeT * 0.11) * s, Math.cos(this.shakeT * 0.137) * s * 0.8];
  }

  step(dt: number): void {
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt / 600);
    const g = 0.0016 * this.k;
    for (const b of this.bits) {
      b.age += dt;
      if (b.kind === 'square') { b.vy += g * dt * 0.6; b.vx *= 0.995; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
    }
    this.bits = this.bits.filter(b => b.age < b.life);
    for (const f of this.floats) f.age += dt;
    this.floats = this.floats.filter(f => f.age < f.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter(r => r.age < r.delay + r.life);
  }

  draw(c: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const u = (r.age - r.delay) / r.life;
      if (u < 0) continue;
      const e = 1 - (1 - u) * (1 - u);
      c.globalAlpha = 0.85 * (1 - u);
      c.strokeStyle = r.color;
      c.lineWidth = Math.max(1, r.width * (1 - u * 0.6));
      c.beginPath();
      c.arc(r.x, r.y, Math.max(1, r.r * e), 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
    for (const b of this.bits) {
      const t = b.age / b.life;
      c.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      if (b.kind === 'spark') {
        const r = b.size * (0.4 + t * 0.9);
        c.globalAlpha = 1 - t;
        c.fillStyle = b.color;
        c.beginPath();
        c.moveTo(b.x, b.y - r); c.quadraticCurveTo(b.x, b.y, b.x + r, b.y); c.quadraticCurveTo(b.x, b.y, b.x, b.y + r);
        c.quadraticCurveTo(b.x, b.y, b.x - r, b.y); c.quadraticCurveTo(b.x, b.y, b.x, b.y - r);
        c.fill();
        continue;
      }
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.rot);
      c.fillStyle = b.color;
      c.fillRect(-b.size / 2, -b.size / 2, b.size, b.size);
      c.restore();
    }
    c.globalAlpha = 1;
    for (const f of this.floats) {
      const t = f.age / f.life;
      const sc = f.pop ? (t < 0.15 ? 0.4 + (t / 0.15) * 0.8 : t < 0.25 ? 1.2 - ((t - 0.15) / 0.1) * 0.2 : 1) : 1;
      c.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      c.save();
      c.translate(f.x, f.y - f.rise * Math.min(1, t * 1.6));
      c.scale(sc, sc);
      c.font = `700 ${Math.round(f.size)}px ${FONT_DISPLAY}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = f.size * 0.22;
      c.strokeStyle = INK;
      c.strokeText(f.text, 0, 0);
      c.fillStyle = f.fill;
      c.fillText(f.text, 0, 0);
      c.restore();
    }
    c.globalAlpha = 1;
  }
}
