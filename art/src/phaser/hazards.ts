// The space hazards on screen (art-direction.md §6.3, gameplay.md §8.2, §8.3). Telegraphs: a target
// reticle that locks onto the tower over the warning, a dashed trajectory whose dashes march toward it,
// faint incoming streaks for meteors, and the dust devil's spinning swirl marker. Objects: space junk
// with its blinking light, meteors with their trails, and the dust devil's column, plus a dim over the
// backdrop while dust blows (never over the tower or the guide). Positions are world px with y down,
// like BlocklingView; the game moves the objects from the sim and calls update(dt) every frame.

import { COLUMN_FRAMES, HAZARD, JUNK_LIGHT, type HazardTex, type JunkKind } from '../hazards.ts';
import { clamp, lerp } from '../util.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { ImageLike, TileSpriteLike } from './types.ts';

export interface HazardFxOptions {
  /** Depth of the objects (default 30, over the tower); marks sit just above, the dust column just below. */
  depth?: number;
  /** Depth of the dust dim (default -9.5: over the backdrop and the wind, under the tower). */
  dimDepth?: number;
}

type Id = string | number;
interface Mark {
  kind: 'reticle' | 'trajectory' | 'incoming' | 'swirl';
  img: ImageLike | TileSpriteLike;
  t: number; eta: number; dir: number; len: number;
  out: number | null;
}
interface Obj {
  kind: 'junk' | 'meteor' | 'column';
  img: ImageLike;
  extra: ImageLike | null;
  junk: JunkKind | null;
  x: number; y: number; angle: number; heading: number; dir: number;
  t: number; out: number | null;
}

const OUT = 0.2;

export class HazardFx {
  /** No spinning, pulsing or swaying; telegraphs still lock on and blink. */
  reduceMotion = false;
  private tex: ArtTextures;
  private depth: number;
  private dimDepth: number;
  private marks = new Map<Id, Mark>();
  private objs = new Map<Id, Obj>();
  private dimImg: ImageLike | null = null;
  private dimTo = 0;
  private dimAt = 0;
  private t = 0;

  constructor(tex: ArtTextures, o: HazardFxOptions = {}) {
    this.tex = tex;
    this.depth = o.depth ?? 30;
    this.dimDepth = o.dimDepth ?? -9.5;
  }

  // ---- telegraphs ----

  /** A target reticle at (x, y): it appears wide and turning and locks onto the spot over `eta` s, then pulses. */
  reticle(id: Id, x: number, y: number, eta = 2): this {
    this.mark(id, 'reticle', this.image('reticle'), eta).img.setPosition(x, y);
    return this;
  }

  /** A dashed line from (x0, y0) to (x1, y1), its dashes marching toward (x1, y1): where the junk will fly. */
  trajectory(id: Id, x0: number, y0: number, x1: number, y1: number): this {
    const len = Math.hypot(x1 - x0, y1 - y0), k = this.tex.k, r = this.dashTile();
    const old = this.marks.get(id);
    const img = old?.kind === 'trajectory' ? old.img as TileSpriteLike : this.tex.scene.add.tileSprite(0, 0, Math.max(1, len * k), r.height, r.key);
    img.setSize(Math.max(1, len * k), r.height);
    img.setOrigin(0, 0.5).setScale(1 / k).setPosition(x0, y0).setRotation(Math.atan2(y1 - y0, x1 - x0)).setDepth(this.depth + 1);
    const m = old?.kind === 'trajectory' ? old : this.mark(id, 'trajectory', img, 0.3);
    m.len = len;
    return this;
  }

  /** A faint streak out from (x, y) along `angle` (radians, y down: the way back to where a meteor comes from). */
  incoming(id: Id, x: number, y: number, angle: number, length = HAZARD.incoming[0] * this.tex.cellPx): this {
    const m = this.mark(id, 'incoming', this.image('incoming'), 0.4);
    m.img.setPosition(x, y).setRotation(angle).setScale(this.tex.scale * length / (HAZARD.incoming[0] * this.tex.cellPx), this.tex.scale);
    return this;
  }

  /** The dust devil's swirl marker at (x, y), forming over `eta` s and spinning; `dir` 1 = clockwise (it travels right). */
  swirl(id: Id, x: number, y: number, eta = 2, dir: -1 | 1 = 1): this {
    const m = this.mark(id, 'swirl', this.image('swirl'), eta);
    m.dir = dir; m.img.setPosition(x, y);
    return this;
  }

  /** Remove a telegraph: it pops out. */
  unmark(id: Id): this {
    const m = this.marks.get(id);
    if (m && m.out === null) m.out = 0;
    return this;
  }

  // ---- objects ----

  /** Space junk `kind` at (x, y), angle in radians (y down). Call again each frame to move it. */
  junk(id: Id, kind: JunkKind, x: number, y: number, angle = 0): this {
    let o = this.objs.get(id);
    if (!o || o.kind !== 'junk') {
      o = this.obj(id, 'junk', this.image(kind), this.image('blink').setBlendMode(1));
      o.junk = kind;
    }
    o.x = x; o.y = y; o.angle = angle;
    return this;
  }

  /** A meteor at (x, y). Its trail points back along the way it has been moving. */
  meteor(id: Id, x: number, y: number): this {
    let o = this.objs.get(id);
    if (!o || o.kind !== 'meteor') {
      o = this.obj(id, 'meteor', this.image('meteor'), this.image('trail').setBlendMode(1));
      o.x = x; o.y = y;
    }
    const dx = x - o.x, dy = y - o.y;
    if (dx * dx + dy * dy > 0.25) o.heading = Math.atan2(dy, dx);
    o.x = x; o.y = y;
    return this;
  }

  /** The dust devil's column with its foot at (x, y), travelling in `dir`. */
  column(id: Id, x: number, y: number, dir: -1 | 1 = 1): this {
    let o = this.objs.get(id);
    if (!o || o.kind !== 'column') o = this.obj(id, 'column', this.image('column0'), null);
    o.x = x; o.y = y; o.dir = dir;
    return this;
  }

  /** Remove an object: it fades out. Your particles do the contact puff (README, "Space hazards"). */
  remove(id: Id): this {
    const o = this.objs.get(id);
    if (o && o.out === null) o.out = 0;
    return this;
  }

  /** Darken the backdrop for dust devils, 0 to 1 (eases over half a second). Screen space, under the tower. */
  dim(amount: number): this {
    this.dimTo = clamp(amount, 0, 1);
    if (!this.dimImg && this.dimTo > 0) {
      const p = this.tex.pixel();
      this.dimImg = this.tex.scene.add.image(0, 0, p.key, p.frame).setOrigin(0, 0).setScrollFactor(0).setDepth(this.dimDepth).setTint(0x1c0a08).setAlpha(0);
    }
    return this;
  }

  /** True while any telegraph or object is on screen. */
  get active(): boolean { return this.marks.size > 0 || this.objs.size > 0 || this.dimAt > 0.005; }

  update(dt: number): void {
    this.t += dt;
    const S = this.tex.scale, still = this.reduceMotion;
    for (const [id, m] of this.marks) {
      m.t += dt;
      let a = clamp(m.t / 0.2, 0, 1), sc = 1;
      const p = clamp(m.t / Math.max(0.1, m.eta), 0, 1), e = 1 - (1 - p) ** 3;
      if (m.out !== null) {
        m.out += dt; a *= 1 - m.out / OUT; sc = 1 + 0.3 * (m.out / OUT);
        if (m.out >= OUT) { m.img.destroy(); this.marks.delete(id); continue; }
      }
      if (m.kind === 'reticle') {
        // Lock on: wide and turning, then on the spot; a pulse once locked.
        const pulse = p >= 1 && !still ? 1 + 0.07 * Math.sin(m.t * 12) : 1;
        m.img.setScale(S * lerp(1.9, 1, e) * pulse * sc).setRotation(still ? 0 : (1 - e) * 1.4).setAlpha(a);
      } else if (m.kind === 'trajectory') {
        const ts = m.img as TileSpriteLike;
        ts.tilePositionX -= dt * this.tex.s * (still ? 0 : 3);
        ts.setAlpha(a * 0.95);
      } else if (m.kind === 'incoming') {
        m.img.setAlpha(a * 0.9 * (still ? 1 : 0.85 + 0.15 * Math.sin(m.t * 9)));
      } else {
        const grow = lerp(0.35, 1, clamp(m.t / (m.eta * 0.6), 0, 1));
        m.img.setScale(S * grow * sc * -m.dir, S * grow * sc).setRotation(still ? 0 : m.t * 2.6 * m.dir).setAlpha(a * 0.95);
      }
    }

    for (const [id, o] of this.objs) {
      o.t += dt;
      let a = clamp(o.t / 0.15, 0, 1);
      if (o.out !== null) {
        o.out += dt; a *= 1 - o.out / OUT;
        if (o.out >= OUT) { o.img.destroy(); o.extra?.destroy(); this.objs.delete(id); continue; }
      }
      if (o.kind === 'junk') {
        o.img.setPosition(o.x, o.y).setRotation(o.angle).setScale(S).setAlpha(a);
        const [lx, ly] = JUNK_LIGHT[o.junk!], u = this.tex.cellPx, c = Math.cos(o.angle), s = Math.sin(o.angle);
        const on = still || (o.t % 0.6) < 0.32;
        o.extra!.setPosition(o.x + (lx * c - ly * s) * u, o.y + (lx * s + ly * c) * u).setScale(S).setAlpha(on ? a : a * 0.15);
      } else if (o.kind === 'meteor') {
        o.img.setPosition(o.x, o.y).setRotation(o.heading).setScale(S).setAlpha(a);
        o.extra!.setPosition(o.x, o.y).setRotation(o.heading).setScale(S * (still ? 0.6 : 1), S).setAlpha(a * 0.9);
      } else {
        const f = still ? 0 : Math.floor(o.t * 9) % COLUMN_FRAMES, r = this.ref(`column${f}` as HazardTex);
        o.img.setTexture(r.key, r.frame).setOrigin(r.originX, r.originY);
        o.img.setPosition(o.x, o.y).setScale(S * o.dir, S).setRotation(still ? 0 : Math.sin(o.t * 3.1) * 0.05).setAlpha(a * 0.9);
      }
    }

    if (this.dimImg) {
      this.dimAt += (this.dimTo - this.dimAt) * Math.min(1, dt * 4);
      const cam = this.tex.scene.cameras.main, z = cam.zoom || 1;
      // Cover the screen whatever the zoom (the image is screen-fixed but still scales about the camera centre).
      this.dimImg.setPosition(cam.width / 2 * (1 - 1 / z), cam.height / 2 * (1 - 1 / z)).setDisplaySize(cam.width / z, cam.height / z).setAlpha(this.dimAt * 0.45);
      this.dimImg.setVisible(this.dimAt > 0.005);
    }
  }

  /** Remove everything at once (a restart, the run ending). */
  clear(): this {
    for (const m of this.marks.values()) m.img.destroy();
    for (const o of this.objs.values()) { o.img.destroy(); o.extra?.destroy(); }
    this.marks.clear(); this.objs.clear();
    this.dimTo = this.dimAt = 0;
    this.dimImg?.setVisible(false);
    return this;
  }

  destroy(): void { this.clear(); this.dimImg?.destroy(); this.dimImg = null; }

  // ---- internals ----

  private ref(name: HazardTex): TexRef { return this.tex.hazard(name); }

  private image(name: HazardTex): ImageLike {
    const r = this.ref(name);
    return this.tex.scene.add.image(0, 0, r.key, r.frame).setOrigin(r.originX, r.originY).setScale(this.tex.scale).setAlpha(0);
  }

  private dashTile(): TexRef { return this.tex.hazardDash(); }

  private mark(id: Id, kind: Mark['kind'], img: ImageLike | TileSpriteLike, eta: number): Mark {
    const old = this.marks.get(id);
    if (old && old.img !== img) old.img.destroy();
    img.setDepth(this.depth + (kind === 'swirl' ? -2.5 : 1));
    const m: Mark = { kind, img, t: 0, eta, dir: 1, len: 0, out: null };
    this.marks.set(id, m);
    return m;
  }

  private obj(id: Id, kind: Obj['kind'], img: ImageLike, extra: ImageLike | null): Obj {
    const old = this.objs.get(id);
    if (old) { old.img.destroy(); old.extra?.destroy(); }
    const d = kind === 'column' ? this.depth - 2 : this.depth;
    img.setDepth(d);
    extra?.setDepth(kind === 'meteor' ? d - 0.1 : d + 0.1);
    const o: Obj = { kind, img, extra, junk: null, x: 0, y: 0, angle: 0, heading: Math.PI * 0.6, dir: 1, t: 0, out: null };
    this.objs.set(id, o);
    return o;
  }
}

