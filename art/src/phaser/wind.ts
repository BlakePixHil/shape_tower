// Gusts on screen (art-direction.md §6.3, gameplay.md §8.2, §8.3). During the telegraph, curled
// streaks build at the upwind edge and leaves or cloud wisps start to drift in; when the gust starts,
// long streaks race across the background and the drifters fly through; when it ends, it tails off.
// Screen space, behind the tower. Wiring: warn() on hazard_warning, start() on hazard_start, end() on
// hazard_end, update(dt) every frame. `dir` is the way the wind blows: 1 = left to right.
// Crosswind (Storm Belt, Stratosphere) is steady(strength, dir): thin streaks drifting the whole time,
// under any gusts; call it again with the other dir when the wind flips at a checkpoint.

import { clamp, lerp } from '../util.ts';
import { WIND_VARIANTS, type WindKind, type WindTex } from '../wind.ts';
import type { ArtTextures } from './textures.ts';
import type { ImageLike } from './types.ts';

export type WindDir = -1 | 1;
export type Drifters = 'leaves' | 'wisps' | 'none';

export interface WindOptions {
  /** Screen size in game px. */
  width: number;
  height: number;
  /** Depth of the streaks; drifters sit just above. Default -10: over the backdrop, under the tower. */
  depth?: number;
  /** What the wind carries (default leaves). windDrifters(biome) picks per biome. */
  drifters?: Drifters;
  /** Seed for the streaks' placement (default 1). */
  seed?: number;
}

interface Bit {
  img: ImageLike; kind: WindKind; d: WindDir; x: number; y: number; vx: number; vy: number;
  age: number; life: number; sx: number; sy: number; grow: number; a: number;
  rot: number; spin: number; amp: number; freq: number; phase: number;
}

/** Spawns per second at full telegraph (curls, short streaks, drifters) and in a gust of intensity 1. */
const RATE = { warnCurl: 8, warnStreak: 4, warnDrift: 4, gustStreak: 20, gustCurl: 3, gustDrift: 6, steadyStreak: 7, steadyDrift: 1.2 };

export class WindView {
  /** Fewer streaks, no flutter or spin. The telegraph still shows in full. */
  reduceMotion = false;
  drifters: Drifters;
  private tex: ArtTextures;
  private W: number;
  private H: number;
  private depth: number;
  private bits: Bit[] = [];
  private pool: ImageLike[] = [];
  private mode: 'calm' | 'warn' | 'gust' | 'tail' = 'calm';
  private dir: WindDir = 1;
  private eta = 2;
  private t = 0;
  private I = 1;
  private steadyI = 0;
  private steadyDir: WindDir = 1;
  private acc: Record<string, number> = {};
  private rng: number;

  constructor(tex: ArtTextures, o: WindOptions) {
    this.tex = tex;
    this.W = o.width; this.H = o.height;
    this.depth = o.depth ?? -10;
    this.drifters = o.drifters ?? 'leaves';
    this.rng = (o.seed ?? 1) * 2654435761 % 4294967296 || 1;
  }

  /** The telegraph: streaks build at the upwind edge over `eta` seconds (gameplay sends 2). */
  warn(dir: WindDir, eta = 2): this {
    this.mode = 'warn'; this.dir = dir; this.eta = Math.max(0.5, eta); this.t = 0;
    return this;
  }

  /** The gust itself. `strength` in g (0.05 to 0.15 in the slice); it scales the streaks' count and speed. */
  start(strength: number, dir: WindDir = this.dir): this {
    this.mode = 'gust'; this.dir = dir; this.t = 0;
    this.I = clamp(strength / 0.1, 0.4, 1.6);
    return this;
  }

  /** Same as start(strength, dir), argument order as the game's gust hook. */
  blow(dir: WindDir, strength: number): this { return this.start(strength, dir); }

  /** The gust ends: spawning tails off over about half a second and what's on screen flies out. */
  end(): this {
    if (this.mode !== 'calm') { this.mode = 'tail'; this.t = 0; }
    return this;
  }

  /**
   * Crosswind: a steady push of `strength` in g (0.03 to 0.06 in the doc), thin streaks drifting `dir`
   * the whole time, alongside any gusts. 0 stops it. A flip just calls it with the other dir: the
   * streaks on screen fly out and new ones come from the other side.
   */
  steady(strength: number, dir: WindDir = this.steadyDir): this {
    this.steadyI = strength > 0 ? clamp(strength / 0.045, 0.4, 1.5) : 0;
    this.steadyDir = dir;
    return this;
  }

  /** Clear everything at once (a restart, the run ending), crosswind included. */
  clear(): this {
    for (const b of this.bits) this.release(b);
    this.bits = [];
    this.mode = 'calm';
    this.steadyI = 0;
    return this;
  }

  /** How far the telegraph has run, 0 to 1 (1 during the gust). */
  get progress(): number { return this.mode === 'warn' ? clamp(this.t / this.eta, 0, 1) : this.mode === 'calm' ? 0 : 1; }

  /** True while anything is on screen or spawning. */
  get active(): boolean { return this.mode !== 'calm' || this.steadyI > 0 || this.bits.length > 0; }

  resize(width: number, height: number): this { this.W = width; this.H = height; return this; }

  update(dt: number): void {
    this.t += dt;
    const u = this.tex.cellPx, rm = this.reduceMotion ? 0.5 : 1;
    if (this.mode === 'warn') {
      const p = this.progress;
      this.spawn('warnCurl', lerp(0.35, 1, p) * RATE.warnCurl * rm * dt, () => this.curl(p));
      if (p > 0.35) this.spawn('warnStreak', p * RATE.warnStreak * rm * dt, () => this.streak(lerp(4, 8, p) * u, 0.55, true));
      if (p > 0.25 && this.drifters !== 'none') this.spawn('warnDrift', p * RATE.warnDrift * rm * dt, () => this.drift(lerp(1.2, 3.5, p) * u));
    } else if (this.mode === 'gust' || this.mode === 'tail') {
      const f = this.mode === 'tail' ? clamp(1 - this.t / 0.6, 0, 1) : clamp(this.t / 0.25, 0.3, 1);
      if (this.mode === 'tail' && f === 0) this.mode = 'calm';
      const k = this.I * f * rm, sp = Math.sqrt(this.I) * lerp(0.6, 1, f);
      this.spawn('gustStreak', RATE.gustStreak * k * dt, () => this.streak((16 + 8 * this.rand()) * sp * u, 1, false));
      this.spawn('gustCurl', RATE.gustCurl * k * dt, () => this.streak((11 + 5 * this.rand()) * sp * u, 1, false, 'curl'));
      if (this.drifters !== 'none') this.spawn('gustDrift', RATE.gustDrift * k * dt, () => this.drift((9 + 6 * this.rand()) * sp * u));
    }
    if (this.steadyI > 0) {
      const k = this.steadyI * rm, sp = Math.sqrt(this.steadyI), sd = this.steadyDir;
      this.spawn('steadyStreak', RATE.steadyStreak * k * dt, () => this.streak((8 + 5 * this.rand()) * sp * u, 0.68, false, 'streak', sd, 0.7));
      if (this.drifters !== 'none') this.spawn('steadyDrift', RATE.steadyDrift * k * dt, () => this.drift((5 + 3 * this.rand()) * sp * u, sd));
    }

    const S = this.tex.scale;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.age += dt;
      if (b.age >= b.life) { this.release(b); this.bits.splice(i, 1); continue; }
      const t = b.age / b.life;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const fl = this.reduceMotion ? 0 : Math.sin(b.age * b.freq + b.phase) * b.amp;
      b.rot += b.spin * dt;
      const fade = Math.min(1, b.age / 0.18, (b.life - b.age) / 0.3);
      const g = lerp(1, b.grow, t);
      b.img.setPosition(b.x, b.y + fl * u).setAlpha(b.a * clamp(fade, 0, 1))
        .setScale(b.sx * g * S * b.d, b.sy * g * S).setRotation(b.kind === 'leaf' || b.kind === 'wisp' ? b.rot * b.d : 0);
    }
  }

  destroy(): void {
    for (const b of this.bits) b.img.destroy();
    for (const img of this.pool) img.destroy();
    this.bits = []; this.pool = [];
  }

  // ---- internals ----

  private rand(): number {
    // xorshift32: placement varies, but the same seed gives the same weather.
    let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  private spawn(key: string, n: number, make: () => void): void {
    this.acc[key] = (this.acc[key] ?? this.rand()) + n;
    while (this.acc[key] >= 1) { this.acc[key] -= 1; make(); }
  }

  private add(kind: WindKind, b: Omit<Bit, 'img' | 'kind' | 'age' | 'd'>, d: WindDir = this.dir): void {
    const name = `${kind}${Math.floor(this.rand() * WIND_VARIANTS[kind])}` as WindTex, r = this.tex.wind(name);
    const img = (this.pool.pop() ?? this.tex.scene.add.image(0, 0, r.key, r.frame).setScrollFactor(0))
      .setTexture(r.key, r.frame).setOrigin(r.originX, r.originY).setVisible(true).setAlpha(0)
      .setDepth(this.depth + (kind === 'leaf' || kind === 'wisp' ? 0.1 : 0));
    this.bits.push({ img, kind, d, age: 0, ...b });
  }

  private release(b: Bit): void { b.img.setVisible(false); this.pool.push(b.img); }

  /** Where streaks may appear: the upper three quarters, where the tower's top usually is. */
  private y(): number { return this.H * lerp(0.08, 0.78, this.rand()); }

  /** A telegraph curl near the upwind edge, drifting downwind a little faster as the gust nears. */
  private curl(p: number): void {
    const u = this.tex.cellPx, edge = this.dir > 0 ? 0 : this.W;
    this.add('curl', {
      x: edge + this.dir * this.W * lerp(0.03, 0.2 + 0.12 * p, this.rand()), y: this.y(),
      vx: this.dir * lerp(0.6, 2.6, p) * u * (0.8 + 0.4 * this.rand()), vy: 0,
      life: 0.9 + 0.5 * this.rand(), sx: 0.75 + 0.3 * this.rand(), sy: 0.75 + 0.3 * this.rand(), grow: 1.18, a: lerp(0.55, 0.85, p),
      rot: 0, spin: 0, amp: 0.06, freq: 5, phase: this.rand() * 6,
    });
  }

  /** A streak entering from the upwind edge at `speed` px/s. `short` ones die young near the edge (telegraph). */
  private streak(speed: number, a: number, short: boolean, kind: WindKind = 'streak', dir: WindDir = this.dir, thin = 1): void {
    const u = this.tex.cellPx, len = (kind === 'curl' ? 2.1 : 3.4) * u, edge = dir > 0 ? -len / 2 : this.W + len / 2;
    const life = short ? 0.5 + 0.3 * this.rand() : (this.W + len * 1.5) / speed;
    this.add(kind, {
      x: edge, y: this.y(), vx: dir * speed, vy: (this.rand() - 0.5) * 0.4 * u,
      life, sx: short ? 0.55 : 0.8 + 0.6 * this.rand(), sy: (0.9 + 0.3 * this.rand()) * thin, grow: short ? 1.3 : 1, a: a * (0.6 + 0.35 * this.rand()),
      rot: 0, spin: 0, amp: kind === 'curl' ? 0.08 : 0.03, freq: 3, phase: this.rand() * 6,
    }, dir);
  }

  /** A leaf or wisp blown in from just past the upwind edge. */
  private drift(speed: number, dir: WindDir = this.dir): void {
    const u = this.tex.cellPx, leaf = this.drifters === 'leaves', edge = dir > 0 ? -u : this.W + u;
    const life = (this.W + u * 2) / speed;
    this.add(leaf ? 'leaf' : 'wisp', {
      x: edge, y: this.y(), vx: dir * speed, vy: (leaf ? 0.4 : 0.1) * u * (this.rand() - 0.3),
      life, sx: leaf ? 0.8 + 0.5 * this.rand() : 0.9 + 0.6 * this.rand(), sy: leaf ? 0.8 + 0.5 * this.rand() : 0.8 + 0.3 * this.rand(), grow: 1,
      a: leaf ? 1 : 0.85, rot: leaf ? this.rand() * 6 : 0, spin: leaf && !this.reduceMotion ? (3 + 5 * this.rand()) * (this.rand() < 0.3 ? -1 : 1) : 0,
      amp: leaf ? 0.35 : 0.1, freq: leaf ? 4 + 3 * this.rand() : 2, phase: this.rand() * 6,
    }, dir);
  }
}
