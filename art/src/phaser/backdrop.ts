// The sky and parallax backdrop (art-direction.md §6.4-6.5). Screen-space layers: the sky gradient
// is fixed, and each prop layer slides with the world at its scroll factor. Works under a zoomed
// camera: positions and scales are corrected so the backdrop always fills the screen 1:1.
//
// Every biome has props, and the star field fades in from the Stratosphere up. A biome's props are
// baked when the climb is about halfway through the biome before it, and freed two biomes later
// (§9.7). Deep Cosmos is endless: its nebula changes palette every 6 checkpoints (setCosmos).
//
// The run-over panorama glides through every biome in a few seconds, and a biome takes 100 to 500 ms
// to bake and upload, so baking on the way stutters. prepareTour bakes the path during a beat before
// the glide instead (the ground's biome first, then from the top down, one per frame, smaller);
// tourGlide stops baking as the glide starts, and a biome that wasn't ready shows just its sky.

import { BIOME_BAKERS as BAKERS } from '../backdrops.ts';
import { BIOMES, presence, skyColors, starAmount } from '../biomes.ts';
import { bakePunchThrough } from '../cloudlands.ts';
import { COSMOS_PALETTES, LANDMARKS, bakeLandmark } from '../cosmos.ts';
import type { BackdropPart } from '../meadow.ts';
import { bakeDustDevil, bakeRingArc } from '../space.ts';
import { STAR_LAYERS, bakeStarTile } from '../stars.ts';
import { bakeFlare, bakeRumble } from '../storm.ts';
import { bird } from '../treetops.ts';
import { TAU, clamp, cpuBaked, ctx2d, hash, makeCanvas } from '../util.ts';
import type { CanvasTextureLike, ImageLike, SceneLike, TileSpriteLike } from './types.ts';

export interface BackdropOptions {
  /** View size in game px. */
  width: number;
  height: number;
  /** Texture px per game px (default: device pixel ratio, capped at 2). */
  texScale?: number;
  /** Depth of the sky; layers stack just above it. Keep it under the playfield. */
  depth?: number;
  /** Depth for arrival effects that pass in front of the tower (the Cloudlands punch-through). Keep it under the guide. */
  frontDepth?: number;
  /** "Reduce motion": no drift, sway or sweeping arrivals (§7.5). */
  reduceMotion?: boolean;
}

/** A flash's brightness at time t: a fast rise, a flicker and a slow decay, `dur` s long every `every` s. */
function flashAt(t: number, f: NonNullable<BackdropPart['flash']>): number {
  const ph = ((t % f.every) + f.every) % f.every;
  if (ph >= f.dur) return 0;
  const x = ph / f.dur, env = x < 0.12 ? x / 0.12 : (1 - (x - 0.12) / 0.88) ** 2;
  return env * (0.75 + 0.25 * Math.sin(x * 40)) * f.alpha;
}

interface Live { part: BackdropPart; img: ImageLike; key: string; keys: string[]; phase: number }
interface Stars { img: TileSpriteLike; key: string; i: number; m?: number }
interface Fx { imgs: ImageLike[]; keys: string[]; t: number; dur: number; step: (f: Fx, p: number) => void }

let uid = 0;

export class Backdrop {
  private scene: SceneLike;
  private W: number;
  private H: number;
  private k: number;
  private depth: number;
  private frontDepth: number;
  reduceMotion: boolean;
  private sky: ImageLike;
  private skyCanvas: HTMLCanvasElement;
  private skyTex: CanvasTextureLike | null;
  private skyKey: string;
  private lastSp = NaN;
  private biomes = new Map<number, Live[]>();
  /** The texture scale each loaded biome was baked at (k, or smaller for a tour). */
  private biomeK = new Map<number, number>();
  private tour: { queue: { i: number; k: number }[] } | null = null;
  private entry = new Map<number, number>();
  private entryT = new Map<number, number>();
  private pal = { cur: 0, prev: 0, t: -99 };
  private stars: Stars[] = [];
  private fx: Fx[] = [];
  private ground0: number | null = null;
  private fxKeys = new Set<string>();
  private t = 0;
  private id = ++uid;
  private tilt = 0;

  constructor(scene: SceneLike, o: BackdropOptions) {
    this.scene = scene;
    this.W = o.width; this.H = o.height;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.k = o.texScale ?? Math.min(2, Math.max(1, dpr));
    this.depth = o.depth ?? -1000;
    this.frontDepth = o.frontDepth ?? 950;
    this.reduceMotion = !!o.reduceMotion;
    this.skyCanvas = makeCanvas(4, 256);
    this.skyKey = `st:sky:${this.id}`;
    this.skyTex = scene.textures.addCanvas(this.skyKey, this.skyCanvas);
    this.sky = scene.add.image(0, 0, this.skyKey).setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth);
    this.load(0);
  }

  /**
   * Tilt the whole backdrop about the screen centre, in radians (clockwise on screen), for the Ringed
   * Giant's tidal sway: follow the gravity tilt, at most ±0.06 (about 3.4°). Off under reduceMotion.
   */
  setTilt(rad: number): void { this.tilt = clamp(rad, -0.06, 0.06); }

  /**
   * The run-over panorama: the sky will sweep from position `from` down to `to` (from > to). Bakes
   * the biomes on that path one per update(): first the one at `to` at full scale (it stays behind
   * the run summary), then the rest from the top down at `scale` × the texture scale. Nothing is
   * freed until endTour(). Start the glide once `tourReady` is true, or when you can't wait longer.
   */
  prepareTour(from: number, to: number, scale = 0.5): void {
    const end: { i: number; k: number }[] = [], path: { i: number; k: number }[] = [];
    for (let i = BAKERS.length - 1; i >= 0; i--) {
      const lo = i === 0 ? -Infinity : i - 0.75, hi = i === 0 ? 2.6 : i + 1.6;
      if (hi <= to || lo >= from || this.biomes.has(i)) continue;
      if (to > lo && to < hi) end.push({ i, k: this.k }); else path.push({ i, k: this.k * scale });
    }
    this.tour = { queue: [...end, ...path] };
  }

  /** True once every biome on the tour's path is baked. */
  get tourReady(): boolean { return !this.tour || this.tour.queue.length === 0; }

  /** The glide is starting: bake nothing more until endTour(), so it never stutters. */
  tourGlide(): void { if (this.tour) this.tour.queue = []; }

  /** The panorama is over: free the tour's smaller bakes and stream as usual again. */
  endTour(): void {
    if (!this.tour) return;
    this.tour = null;
    for (const [i, k] of [...this.biomeK]) if (k !== this.k) this.unload(i);
  }

  /** Rebuild for a new view size. */
  resize(width: number, height: number): void {
    const loaded = [...this.biomes.keys()];
    for (const i of loaded) this.unload(i);
    this.clearStars();
    this.W = width; this.H = height; this.ground0 = null;
    for (const i of loaded) this.load(i);
  }

  /**
   * groundScreenY: where world ground (the top of the grass) is on screen right now, in game px.
   * sp: sky position (SkyClock.sp).
   */
  update(dt: number, groundScreenY: number, sp: number): void {
    this.t += dt;
    if (this.ground0 === null) this.ground0 = groundScreenY;
    if (!(Math.abs(sp - this.lastSp) <= 0.002)) this.paintSky(sp);
    const cam = this.scene.cameras.main, z = cam.zoom || 1, cx = cam.width / 2, cy = cam.height / 2;
    const tilt = this.reduceMotion ? 0 : this.tilt, tc = Math.cos(tilt), ts = Math.sin(tilt);
    // Place an object at screen point (sx, sy) at screen scale `sc`, whatever the camera zoom (and turned by the tilt).
    const at = (img: ImageLike | TileSpriteLike, sx: number, sy: number, sc: number) => {
      const dx = sx - cx, dy = sy - cy;
      img.setPosition(cx + (dx * tc - dy * ts) / z, cy + (dx * ts + dy * tc) / z).setScale(sc / z, sc / z);
    };
    // When tilted, the sky and stars overhang the screen so its corners stay covered.
    const m = tilt ? Math.ceil((this.W + this.H) * Math.abs(ts) * 0.6) : 0;
    at(this.sky, -m, -m, 1);
    this.sky.setDisplaySize((this.W + m * 2) / z, (this.H + m * 2) / z).setRotation(tilt);
    const lift = groundScreenY - this.ground0;
    this.stream(sp, lift);

    for (const [bi, layers] of this.biomes) {
      const a = presence(bi, sp), e = this.entry.get(bi) ?? lift, age = this.t - (this.entryT.get(bi) ?? this.t);
      for (const L of layers) {
        const P = L.part, still = this.reduceMotion;
        let alpha = a, enterDy = 0;
        if (P.palette !== undefined) alpha *= this.palWeight(P.palette);
        if (P.flash) alpha *= still ? 0 : flashAt(this.t + (P.flash.offset ?? 0), P.flash);
        if (P.pulse) alpha *= still ? (1 + P.pulse[1]) / 2 : P.pulse[1] + (1 - P.pulse[1]) * (0.5 + 0.5 * Math.sin(this.t * P.pulse[0] * TAU + L.phase));
        if (P.enter) {
          const f = clamp((age - (P.enter.delay ?? 0)) / P.enter.dur, 0, 1), ee = 1 - (1 - f) ** 3;
          if (P.enter.fade) alpha *= ee;
          if (P.enter.dy && !still) enterDy = P.enter.dy * (1 - ee);
        }
        L.img.setVisible(alpha > 0.01).setAlpha(alpha);
        if (alpha <= 0.01) continue;
        const r = (this.biomeK.get(bi) ?? this.k) * (P.res ?? 1);
        let x = P.x;
        if (P.drift && !still) {
          const half = L.img.width / r / 2, span = this.W + half * 2;
          x = (((P.x + this.t * P.drift + half) % span) + span) % span - half;
        }
        let y = P.anchor === 'entry' ? P.y + (lift - e) * P.factor : this.ground0 + P.y + lift * P.factor;
        if (P.fall && !still) y += this.t * P.fall;
        if (P.wrapY) {
          const h = L.img.height / r, oy = P.originY ?? 0, top = y - oy * h, w = P.wrapY;
          y = (P.tile ? -((((-top) % w) + w) % w) : ((((top + h) % w) + w) % w) - h) + oy * h;
        }
        y += enterDy;
        if (P.bob && !still) y += Math.sin(this.t * 1.7 + L.phase) * P.bob;
        if (L.keys.length > 1) L.img.setTexture(L.keys[still ? 0 : Math.floor(this.t * (P.fps ?? 4) + L.phase) % L.keys.length]);
        at(L.img, x, y, 1 / r);
        if (P.spin) L.img.setRotation(tilt + (still ? 0 : this.t * P.spin));
        else if (P.sway) L.img.setRotation(tilt + (still ? 0 : Math.sin(this.t * 1.3 + L.phase) * P.sway));
        else L.img.setRotation(tilt);
      }
    }

    // Stars: three repeating tiles that scroll and twinkle at their own rates.
    const sa = starAmount(sp);
    if (sa > 0.005 && !this.stars.length) this.makeStars();
    for (const S of this.stars) {
      const L = STAR_LAYERS[S.i];
      S.img.setVisible(sa > 0.005);
      if (sa <= 0.005) continue;
      at(S.img, -m, -m, 1 / this.k);
      if (S.m !== m) { S.img.setSize(Math.ceil((this.W + m * 2) * this.k), Math.ceil((this.H + m * 2) * this.k)); S.m = m; }
      S.img.setRotation(tilt);
      S.img.tilePositionX = 0;
      S.img.tilePositionY = -lift * L.factor * this.k;
      const tw = this.reduceMotion ? 0 : L.twinkle * (0.5 + 0.5 * Math.sin(this.t * L.hz * Math.PI * 2 + S.i * 2.1));
      S.img.setAlpha(sa * (1 - tw));
    }

    // Arrival effects.
    for (const f of this.fx) { f.t += dt; f.step(f, clamp(f.t / f.dur, 0, 1)); }
    for (const f of this.fx.filter(f => f.t >= f.dur)) this.endFx(f);
    this.fx = this.fx.filter(f => f.t < f.dur);
  }

  /**
   * Play a biome's arrival moment (§6.1). Call on biome_entered with the new biome's index.
   * Treetops: a bird flock scatters past the camera. Cloudlands: a cloud layer punches down
   * past the camera, whiting out the screen edges for a beat.
   */
  arrival(biome: number): void {
    if (biome === 1) this.flockScatter();
    else if (biome === 2) this.punchThrough();
    else if (biome === 3) this.stormRumble();
    else if (biome === 4) this.sunFlare();
    else if (biome === 5) this.horizonDrop();
    else if (biome === 7) this.dustSweep();
    else if (biome === 8) this.ringSweep();
    else if (biome === 9) this.landmark(this.pal.cur);
    // Moon (6): the Moon rises into frame on its own as the biome arrives.
  }

  /**
   * Deep Cosmos: call on each checkpoint claim (any biome is fine). Every 6 checkpoints into Deep
   * Cosmos the nebula cross-fades to the next of its 4 palettes and a surprise landmark drifts by.
   */
  setCosmos(checkpoint: number): void {
    const p = Math.floor(Math.max(0, checkpoint - BIOMES[9].firstCp) / 6) % COSMOS_PALETTES.length;
    if (p === this.pal.cur) return;
    this.pal = { prev: this.pal.cur, cur: p, t: this.t };
    if (this.biomes.has(9)) this.landmark(p);
  }

  destroy(): void {
    for (const i of [...this.biomes.keys()]) this.unload(i);
    this.clearStars();
    for (const f of this.fx) this.endFx(f);
    this.fx = [];
    for (const key of this.fxKeys) this.scene.textures.remove(key);
    this.sky.destroy();
    this.scene.textures.remove(this.skyKey);
  }

  // ---- internals ----

  private palWeight(p: number): number {
    const f = clamp((this.t - this.pal.t) / 3, 0, 1);
    if (p === this.pal.cur) return this.pal.prev === p ? 1 : f;
    return p === this.pal.prev ? 1 - f : 0;
  }

  private paintSky(sp: number): void {
    this.lastSp = sp;
    const [a, b, c] = skyColors(sp), x = ctx2d(this.skyCanvas);
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c);
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    this.skyTex?.refresh();
  }

  /** Keep the biomes near the sky position baked, free the rest, and note where each biome arrived. */
  private stream(sp: number, lift: number): void {
    if (this.tour) {
      // One bake per frame, in the order the glide reaches them; nothing is freed until it's over.
      const next = this.tour.queue.shift();
      if (next && !this.biomes.has(next.i)) this.load(next.i, next.k);
    } else {
      for (let i = 0; i < BAKERS.length; i++) {
        const want = i === 0 ? sp < 2.6 : sp > i - 0.75 && sp < i + 1.6;
        if (want && !this.biomes.has(i)) this.load(i);
        else if (!want && this.biomes.has(i)) this.unload(i);
      }
    }
    for (let i = 1; i < 10; i++) {
      if (presence(i, sp) > 0 && !this.entry.has(i)) { this.entry.set(i, lift); this.entryT.set(i, this.t); }
      else if (sp < i - 0.3) { this.entry.delete(i); this.entryT.delete(i); }
    }
  }

  private load(i: number, k = this.k): void {
    const bake = BAKERS[i];
    if (!bake || this.biomes.has(i)) return;
    const layers: Live[] = [];
    // baked in CPU memory, so addCanvas's read-back (its CanvasTexture's getImageData) is a copy, not a GPU wait (#33)
    for (const part of cpuBaked(() => bake(this.W, this.H, k)).sort((p, q) => p.z - q.z)) {
      const key = `st:bg:${this.id}:${part.key}:${this.W}x${this.H}`;
      const keys = (part.frames ?? [part.canvas]).map((cv, n) => {
        const fk = n ? `${key}#${n}` : key;
        if (this.scene.textures.exists(fk)) this.scene.textures.remove(fk);
        this.scene.textures.addCanvas(fk, cv);
        return fk;
      });
      const depth = part.front ? this.frontDepth - 0.5 + part.z * 0.001 : this.depth + 0.01 + i * 0.1 + part.z * 0.01;
      const img = this.scene.add.image(0, 0, key).setOrigin(part.originX ?? 0, part.originY ?? 0).setScrollFactor(0).setDepth(depth).setVisible(false);
      layers.push({ part, img, key, keys, phase: hash(part.z * 13.7 + part.x) * 6.28 });
    }
    this.biomes.set(i, layers);
    this.biomeK.set(i, k);
  }

  private unload(i: number): void {
    for (const L of this.biomes.get(i) ?? []) { L.img.destroy(); for (const k of L.keys) this.scene.textures.remove(k); }
    this.biomes.delete(i);
    this.biomeK.delete(i);
  }

  private makeStars(): void {
    STAR_LAYERS.forEach((_, i) => {
      const key = `st:stars:${this.id}:${i}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.addCanvas(key, cpuBaked(() => bakeStarTile(i, this.k)));
      const img = this.scene.add.tileSprite(0, 0, Math.ceil(this.W * this.k), Math.ceil(this.H * this.k), key)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth + 0.005 + i * 0.001);
      this.stars.push({ img, key, i });
    });
  }

  private clearStars(): void {
    for (const S of this.stars) { S.img.destroy(); this.scene.textures.remove(S.key); }
    this.stars = [];
  }

  private fxTexture(name: string, make: () => HTMLCanvasElement): string {
    const key = `st:fx:${this.id}:${name}:${this.W}x${this.H}`;
    if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, cpuBaked(make));
    this.fxKeys.add(key);
    return key;
  }

  private endFx(f: Fx): void { for (const img of f.imgs) img.destroy(); }

  /** Nine birds burst up and across the screen, flapping, in front of the backdrop. */
  private flockScatter(): void {
    const s = this.W / 12, r = s * 0.55, k = this.k;
    const frame = (n: number) => this.fxTexture(`bird${n}`, () => {
      const cv = makeCanvas(r * 2.4 * k, r * 1.6 * k), c = ctx2d(cv); c.scale(k, k);
      bird(c, r * 1.2, r * 0.8, r, n, 'rgba(58,74,106,0.85)'); return cv;
    });
    const keys = [frame(0), frame(1)];
    const imgs: ImageLike[] = [];
    const birds = Array.from({ length: 9 }, (_, i) => ({
      x0: -s * (1.5 + hash(i) * 4), y0: this.H * (0.45 + hash(i * 3.3) * 0.4),
      vx: this.W * (0.8 + hash(i * 5.1) * 0.5), vy: -this.H * (0.25 + hash(i * 7.9) * 0.25), sc: 0.8 + hash(i * 2.2) * 0.8, ph: hash(i * 9.1),
    }));
    for (let i = 0; i < birds.length; i++) imgs.push(this.scene.add.image(0, 0, keys[0]).setScrollFactor(0).setDepth(this.depth + 0.99));
    const cam = this.scene.cameras.main;
    this.fx.push({ imgs, keys, t: 0, dur: this.reduceMotion ? 0.01 : 1.8, step: (f, p) => {
      const z = cam.zoom || 1, cx = cam.width / 2, cy = cam.height / 2;
      birds.forEach((b, i) => {
        const tt = f.t, x = b.x0 + b.vx * tt, y = b.y0 + b.vy * tt + Math.sin(tt * 9 + b.ph * 6) * s * 0.1;
        const img = imgs[i].setTexture(keys[Math.floor(tt * 12 + b.ph * 2) % 2]);
        img.setPosition(cx + (x - cx) / z, cy + (y - cy) / z).setScale(b.sc / k / z).setAlpha(Math.min(1, (1 - p) * 4));
      });
    } });
  }

  /** Put an fx image at screen point (x, y) at screen scale sc, whatever the camera zoom. */
  private place(img: ImageLike, x: number, y: number, sc: number): ImageLike {
    const cam = this.scene.cameras.main, z = cam.zoom || 1, cx = cam.width / 2, cy = cam.height / 2;
    return img.setPosition(cx + (x - cx) / z, cy + (y - cy) / z).setScale(sc / z, sc / z);
  }

  private fxImage(key: string, depth: number, ox = 0.5, oy = 0.5): ImageLike {
    return this.scene.add.image(0, 0, key).setOrigin(ox, oy).setScrollFactor(0).setDepth(depth).setVisible(false);
  }

  /** Storm Belt: the sky dims for a beat while a low rumble of light rolls across the far clouds. */
  private stormRumble(): void {
    const dimKey = this.fxTexture('dim', () => { const cv = makeCanvas(4, 4), c = ctx2d(cv); c.fillStyle = '#141A2C'; c.fillRect(0, 0, 4, 4); return cv; });
    const dim = this.fxImage(dimKey, this.depth + 1.5, 0, 0);
    const roll = this.fxImage(this.fxTexture('rumble', () => bakeRumble(this.W, this.H, this.k)), this.depth + 0.355);
    const still = this.reduceMotion;
    this.fx.push({ imgs: [dim, roll], keys: [], t: 0, dur: 1.8, step: (_f, p) => {
      const z = this.scene.cameras.main.zoom || 1;
      this.place(dim, 0, 0, 1).setDisplaySize(this.W / z, this.H / z).setVisible(true).setAlpha(Math.sin(p * Math.PI) * 0.32);
      if (!still) this.place(roll, this.W * (-0.3 + 1.6 * p), this.H * 0.42, 1 / this.k).setVisible(true).setAlpha(Math.sin(p * Math.PI) * 0.2);
    } });
  }

  /** Stratosphere: a sun flare sweeps across the screen as the tower clears the storm tops. */
  private sunFlare(): void {
    if (this.reduceMotion) return;
    const img = this.fxImage(this.fxTexture('flare', () => bakeFlare(this.W, this.H, this.k)), this.depth + 1.5).setBlendMode(1);
    this.fx.push({ imgs: [img], keys: [], t: 0, dur: 1.6, step: (_f, p) => {
      const e = p * p * (3 - 2 * p);
      this.place(img, this.W * (0.95 - 0.9 * e), this.H * (0.78 - 0.45 * e), 1 / this.k).setVisible(true).setAlpha(Math.sin(p * Math.PI) * 0.55);
    } });
  }

  /** Orbit: the blue glow of the horizon drops away below, then a quiet beat. */
  private horizonDrop(): void {
    const key = this.fxTexture('horizon', () => {
      const w = 8, h = 256, cv = makeCanvas(w, h), c = ctx2d(cv), g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(120,190,255,0)'); g.addColorStop(0.12, 'rgba(120,190,255,0)'); g.addColorStop(0.7, 'rgba(120,190,255,0.45)'); g.addColorStop(1, 'rgba(150,210,255,0.7)');
      c.fillStyle = g; c.fillRect(0, 0, w, h); return cv;
    });
    const img = this.fxImage(key, this.depth + 1.5, 0, 0), still = this.reduceMotion;
    this.fx.push({ imgs: [img], keys: [], t: 0, dur: 2.6, step: (_f, p) => {
      const z = this.scene.cameras.main.zoom || 1, e = 1 - (1 - p) ** 2;
      this.place(img, 0, this.H * (0.35 + (still ? 0 : 0.65 * e)), 1).setDisplaySize(this.W / z, this.H * 0.65 / z).setVisible(true).setAlpha(1 - e);
    } });
  }

  /** Red Planet: a big dust devil sweeps across the far layer. */
  private dustSweep(): void {
    if (this.reduceMotion) return;
    const keys = [0, 1, 2].map(f => this.fxTexture(`devil${f}`, () => bakeDustDevil(f, this.W / 12 * 3, this.k)));
    const img = this.fxImage(keys[0], this.depth + 0.735, 0.5, 1);
    this.fx.push({ imgs: [img], keys, t: 0, dur: 3.4, step: (f, p) => {
      img.setTexture(keys[Math.floor(f.t * 10) % 3]);
      this.place(img, this.W * (-0.2 + 1.4 * p), this.H * 0.7, 1 / this.k).setVisible(true).setAlpha(Math.min(1, Math.sin(p * Math.PI) * 1.6) * 0.55);
    } });
  }

  /** Ringed Giant: a bright ring arc sweeps across the far layer, behind the tower. */
  private ringSweep(): void {
    if (this.reduceMotion) return;
    const img = this.fxImage(this.fxTexture('ringarc', () => bakeRingArc(this.W, this.H, this.k)), this.depth + 0.835).setBlendMode(1);
    this.fx.push({ imgs: [img], keys: [], t: 0, dur: 2.6, step: (_f, p) => {
      const e = p * p * (3 - 2 * p);
      this.place(img, this.W * (1.4 - 0.9 * e), this.H * 0.3, 1 / this.k).setVisible(true).setAlpha(Math.sin(p * Math.PI) * 0.6).setRotation(-0.21 + 0.1 * (1 - e));
    } });
  }

  /** Deep Cosmos: surprise landmark n drifts by in the far layer. */
  private landmark(n: number): void {
    const L = LANDMARKS[n % LANDMARKS.length], still = this.reduceMotion;
    const img = this.fxImage(this.fxTexture(`landmark${n}`, () => bakeLandmark(n, this.W, this.H, this.k)), this.depth + 0.915);
    this.fx.push({ imgs: [img], keys: [], t: 0, dur: L.dur, step: (_f, p) => {
      const q = L.path(still ? 0.5 : p, this.W, this.H), env = Math.min(1, p * 6, (1 - p) * 6);
      this.place(img, q.x, q.y, q.sc / this.k).setVisible(true).setAlpha(env * q.alpha).setRotation(still ? 0 : q.rot);
    } });
  }

  /** A cloud layer sweeps down past the camera, heavy at the edges, light over the tower. */
  private punchThrough(): void {
    const key = this.fxTexture('punch', () => bakePunchThrough(this.W, this.H, this.k));
    const img = this.scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(this.frontDepth);
    const cam = this.scene.cameras.main, h = this.H * 0.6, still = this.reduceMotion;
    this.fx.push({ imgs: [img], keys: [key], t: 0, dur: still ? 0.6 : 0.85, step: (_f, p) => {
      const z = cam.zoom || 1, cx = cam.width / 2, cy = cam.height / 2;
      const y = still ? this.H * 0.2 : -h + (this.H + h) * (p * p * (3 - 2 * p));
      img.setPosition(cx + (0 - cx) / z, cy + (y - cy) / z).setScale(1 / this.k / z).setAlpha(still ? Math.sin(p * Math.PI) * 0.6 : 0.97);
    } });
  }
}
