// The sky and parallax backdrop (art-direction.md §6.4-6.5). Screen-space layers: the sky gradient
// is fixed, and each prop layer slides with the world at its scroll factor. Works under a zoomed
// camera: positions and scales are corrected so the backdrop always fills the screen 1:1.
//
// Only the Meadow's props exist so far; the sky already blends through all ten biomes.

import { presence, skyColors } from '../biomes.ts';
import { type BackdropPart, bakeMeadow } from '../meadow.ts';
import { ctx2d, makeCanvas } from '../util.ts';
import type { CanvasTextureLike, ImageLike, SceneLike } from './types.ts';

export interface BackdropOptions {
  /** View size in game px. */
  width: number;
  height: number;
  /** Texture px per game px (default: device pixel ratio, capped at 2). */
  texScale?: number;
  /** Depth of the sky; layers stack just above it. Keep it under the playfield. */
  depth?: number;
  /** "Reduce motion": no cloud drift (§7.5). */
  reduceMotion?: boolean;
}

interface Live { part: BackdropPart; img: ImageLike; biome: number }

let uid = 0;

export class Backdrop {
  private scene: SceneLike;
  private W: number;
  private H: number;
  private k: number;
  private depth: number;
  reduceMotion: boolean;
  private sky: ImageLike;
  private skyCanvas: HTMLCanvasElement;
  private skyTex: CanvasTextureLike | null;
  private skyKey: string;
  private lastSp = NaN;
  private layers: Live[] = [];
  private ground0: number | null = null;
  private t = 0;
  private id = ++uid;

  constructor(scene: SceneLike, o: BackdropOptions) {
    this.scene = scene;
    this.W = o.width; this.H = o.height;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.k = o.texScale ?? Math.min(2, Math.max(1, dpr));
    this.depth = o.depth ?? -1000;
    this.reduceMotion = !!o.reduceMotion;
    this.skyCanvas = makeCanvas(4, 256);
    this.skyKey = `st:sky:${this.id}`;
    this.skyTex = scene.textures.addCanvas(this.skyKey, this.skyCanvas);
    this.sky = scene.add.image(0, 0, this.skyKey).setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth);
    this.build();
  }

  /** Rebuild for a new view size. */
  resize(width: number, height: number): void {
    this.clearLayers();
    this.W = width; this.H = height; this.ground0 = null;
    this.build();
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
    const at = (img: ImageLike, sx: number, sy: number, sc: number) =>
      img.setPosition(cx + (sx - cx) / z, cy + (sy - cy) / z).setScale(sc / z, sc / z);
    at(this.sky, 0, 0, 1);
    this.sky.setDisplaySize(this.W / z, this.H / z);
    const lift = groundScreenY - this.ground0;
    for (const L of this.layers) {
      const P = L.part, a = presence(L.biome, sp);
      L.img.setVisible(a > 0.01).setAlpha(a);
      if (a <= 0.01) continue;
      let x = P.x;
      if (P.drift && !this.reduceMotion) {
        const half = L.img.width / this.k / 2, span = this.W + half * 2;
        x = (((P.x + this.t * P.drift + half) % span) + span) % span - half;
      }
      const y = this.ground0 + P.y + lift * P.factor + (P.bob ? Math.sin(this.t * 1.7) * P.bob : 0);
      at(L.img, x, y, 1 / this.k);
      if (P.spin) L.img.setRotation(this.reduceMotion ? 0 : this.t * P.spin);
    }
  }

  destroy(): void {
    this.clearLayers();
    this.sky.destroy();
    this.scene.textures.remove(this.skyKey);
  }

  private paintSky(sp: number): void {
    this.lastSp = sp;
    const [a, b, c] = skyColors(sp), x = ctx2d(this.skyCanvas);
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c);
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    this.skyTex?.refresh();
  }

  private build(): void {
    const parts = bakeMeadow(this.W, this.H, this.k).sort((p, q) => p.z - q.z);
    for (const part of parts) {
      const key = `st:bg:${this.id}:${part.key}:${this.W}x${this.H}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.addCanvas(key, part.canvas);
      const img = this.scene.add.image(0, 0, key).setOrigin(part.originX ?? 0, part.originY ?? 0).setScrollFactor(0).setDepth(this.depth + part.z * 0.01);
      this.layers.push({ part, img, biome: 0 });
    }
  }

  private clearLayers(): void {
    for (const L of this.layers) {
      L.img.destroy();
      this.scene.textures.remove(`st:bg:${this.id}:${L.part.key}:${this.W}x${this.H}`);
    }
    this.layers = [];
  }
}
