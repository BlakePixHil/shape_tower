// The sky and parallax backdrop (art-direction.md §6.4-6.5). Screen-space layers: the sky gradient
// is fixed, and each prop layer slides with the world at its scroll factor. Works under a zoomed
// camera: positions and scales are corrected so the backdrop always fills the screen 1:1.
//
// Biomes with props so far: Meadow, Treetops, Cloudlands. The sky blends through all ten, and the
// star field fades in from the Stratosphere up. A biome's props are baked when the climb is
// about halfway through the biome before it, and freed two biomes later (§9.7).

import { presence, skyColors, starAmount } from '../biomes.ts';
import { bakeCloudlands, bakePunchThrough } from '../cloudlands.ts';
import { type BackdropPart, bakeMeadow } from '../meadow.ts';
import { STAR_LAYERS, bakeStarTile } from '../stars.ts';
import { bakeTreetops, bird } from '../treetops.ts';
import { clamp, ctx2d, hash, makeCanvas } from '../util.ts';
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

/** Prop bakers by biome index. Biomes past the end show the sky (and stars) only. */
const BAKERS: ((W: number, H: number, k: number) => BackdropPart[])[] = [bakeMeadow, bakeTreetops, bakeCloudlands];

interface Live { part: BackdropPart; img: ImageLike; key: string; phase: number }
interface Stars { img: TileSpriteLike; key: string; i: number }
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
  private entry = new Map<number, number>();
  private stars: Stars[] = [];
  private fx: Fx[] = [];
  private ground0: number | null = null;
  private fxKeys = new Set<string>();
  private t = 0;
  private id = ++uid;

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
    // Place an object at screen point (sx, sy) at screen scale `sc`, whatever the camera zoom.
    const at = (img: ImageLike | TileSpriteLike, sx: number, sy: number, sc: number) =>
      img.setPosition(cx + (sx - cx) / z, cy + (sy - cy) / z).setScale(sc / z, sc / z);
    at(this.sky, 0, 0, 1);
    this.sky.setDisplaySize(this.W / z, this.H / z);
    const lift = groundScreenY - this.ground0;
    this.stream(sp, lift);

    for (const [bi, layers] of this.biomes) {
      const a = presence(bi, sp), e = this.entry.get(bi) ?? lift;
      for (const L of layers) {
        const P = L.part;
        L.img.setVisible(a > 0.01).setAlpha(a);
        if (a <= 0.01) continue;
        const still = this.reduceMotion;
        let x = P.x;
        if (P.drift && !still) {
          const half = L.img.width / this.k / 2, span = this.W + half * 2;
          x = (((P.x + this.t * P.drift + half) % span) + span) % span - half;
        }
        let y = P.anchor === 'entry' ? P.y + (lift - e) * P.factor : this.ground0 + P.y + lift * P.factor;
        if (P.wrapY) {
          const h = L.img.height / this.k, oy = P.originY ?? 0, top = y - oy * h;
          y = ((((top + h) % P.wrapY) + P.wrapY) % P.wrapY) - h + oy * h;
        }
        if (P.bob && !still) y += Math.sin(this.t * 1.7 + L.phase) * P.bob;
        at(L.img, x, y, 1 / this.k);
        if (P.spin) L.img.setRotation(still ? 0 : this.t * P.spin);
        else if (P.sway) L.img.setRotation(still ? 0 : Math.sin(this.t * 1.3 + L.phase) * P.sway);
      }
    }

    // Stars: three repeating tiles that scroll and twinkle at their own rates.
    const sa = starAmount(sp);
    if (sa > 0.005 && !this.stars.length) this.makeStars();
    for (const S of this.stars) {
      const L = STAR_LAYERS[S.i];
      S.img.setVisible(sa > 0.005);
      if (sa <= 0.005) continue;
      at(S.img, 0, 0, 1 / this.k);
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
    for (let i = 0; i < BAKERS.length; i++) {
      const want = i === 0 ? sp < 2.6 : sp > i - 0.75 && sp < i + 1.6;
      if (want && !this.biomes.has(i)) this.load(i);
      else if (!want && this.biomes.has(i)) this.unload(i);
    }
    for (let i = 1; i < 10; i++) {
      if (presence(i, sp) > 0 && !this.entry.has(i)) this.entry.set(i, lift);
      else if (sp < i - 0.3) this.entry.delete(i);
    }
  }

  private load(i: number): void {
    const bake = BAKERS[i];
    if (!bake || this.biomes.has(i)) return;
    const layers: Live[] = [];
    for (const part of bake(this.W, this.H, this.k).sort((p, q) => p.z - q.z)) {
      const key = `st:bg:${this.id}:${part.key}:${this.W}x${this.H}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.addCanvas(key, part.canvas);
      const img = this.scene.add.image(0, 0, key).setOrigin(part.originX ?? 0, part.originY ?? 0).setScrollFactor(0)
        .setDepth(this.depth + 0.01 + i * 0.1 + part.z * 0.01).setVisible(false);
      layers.push({ part, img, key, phase: hash(part.z * 13.7 + part.x) * 6.28 });
    }
    this.biomes.set(i, layers);
  }

  private unload(i: number): void {
    for (const L of this.biomes.get(i) ?? []) { L.img.destroy(); this.scene.textures.remove(L.key); }
    this.biomes.delete(i);
  }

  private makeStars(): void {
    STAR_LAYERS.forEach((_, i) => {
      const key = `st:stars:${this.id}:${i}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.addCanvas(key, bakeStarTile(i, this.k));
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
    if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, make());
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
