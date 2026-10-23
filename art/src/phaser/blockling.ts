// One piece on screen: body, optional space rim and stone cross-fade, and a live face whose googly
// pupils hang toward gravity (art-direction.md §4).
//
// Lighting stays on top: the body uses the baked rotation nearest the body's angle and only turns by
// the remainder (at most about 50°), so the light lip stays up and faces stay nearly upright.

import { ART } from '../config.ts';
import { type Expression, FACE, PUPILS, pupilTravel } from '../face.ts';
import { faceAt } from '../geometry.ts';
import { skinFor } from '../cosmetics.ts';
import type { Finish } from '../piece.ts';
import type { SkinLook } from '../skins.ts';
import { pose } from '../shapes.ts';
import { clamp, hash } from '../util.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { ImageLike } from './types.ts';

const HALF_PI = Math.PI / 2;
const use = (img: ImageLike, r: TexRef) => img.setTexture(r.key, r.frame).setOrigin(r.originX, r.originY);
/** Extra turn past 45° before switching to the next baked rotation, so pieces don't flicker at 45°. */
const SNAP_HYSTERESIS = 0.09;

export interface BlocklingOptions {
  /** Varies blink timing; use the piece id. */
  seed?: number;
  /** "Block faces" setting. */
  faces?: boolean;
  finish?: Finish | null;
  /** The player's shape skin: a cosmetic id ('skin_polka') or a look from skinFor. Drawn instead of the finish. */
  skin?: SkinLook | string | null;
  /** Colorblind patterns setting. */
  pattern?: boolean;
  depth?: number;
}

const lookOf = (s: SkinLook | string | null | undefined): SkinLook | null => (typeof s === 'string' ? skinFor(s) : s ?? null);

export class BlocklingView {
  readonly key: string;
  private tex: ArtTextures;
  private body: ImageLike;
  private rimImg: ImageLike | null = null;
  private stoneImg: ImageLike | null = null;
  private eyes: ImageLike;
  private pupils: [ImageLike, ImageLike];
  private mouth: ImageLike;
  private sweatImg: ImageLike | null = null;

  private q = 0;
  private x = 0;
  private y = 0;
  private angle = 0;
  private sx = 1;
  private sy = 1;
  private depth: number;
  private alpha = 1;
  private visible = true;

  private faces: boolean;
  private finish: Finish | null;
  private skin: SkinLook | null;
  private pattern: boolean;
  private stone = 0;
  private rim = 0;
  private base: Expression = 'idle';
  private flashExpr: Expression | null = null;
  private flashLeft = 0;
  private lively = true;
  private sweat = false;
  private seed: number;
  private nextBlink: number;
  private blinkLeft = 0;
  private spin = 0;
  // Pupil offset (blocks, screen space) and its velocity, for the googly spring.
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private shown: Expression | null = null;

  constructor(tex: ArtTextures, key: string, o: BlocklingOptions = {}) {
    this.tex = tex;
    this.key = key;
    this.seed = o.seed ?? 0;
    this.faces = o.faces ?? true;
    this.finish = o.finish ?? null;
    this.skin = lookOf(o.skin);
    this.pattern = !!o.pattern;
    this.depth = o.depth ?? 0;
    this.nextBlink = this.blinkGap();
    const add = this.tex.scene.add;
    const img = (r: TexRef) => use(add.image(0, 0, r.key, r.frame), r);
    this.body = img(this.tex.piece(key, 0, { finish: this.finish, pattern: this.pattern, skin: this.skin }));
    this.eyes = img(this.tex.face('eyes_idle'));
    const pk = this.tex.face('pupil');
    this.pupils = [img(pk), img(pk)];
    this.mouth = img(this.tex.face('mouth_idle'));
    this.applyDepth();
    this.refresh();
  }

  // ---- state ----

  /** Pivot position in world px and the body angle in radians, counter-clockwise (the sim's y-up angle). */
  setPose(x: number, y: number, angle: number): this {
    this.x = x; this.y = y; this.angle = angle;
    const want = angle / HALF_PI;
    if (Math.abs(want - this.q) > 0.5 + SNAP_HYSTERESIS / HALF_PI) {
      this.q = Math.round(want);
      this.applyBodyTextures();
    }
    this.layout();
    return this;
  }

  /** Render-only squash and stretch along the body's own axes (1 = none). */
  setSquash(sx: number, sy: number): this { this.sx = sx; this.sy = sy; this.layout(); return this; }

  /** The resting expression; tension and events pick it (§4.3). Temporary faces use flash(). */
  setExpression(e: Expression): this { this.base = e; this.refresh(); return this; }

  /** Show an expression for a moment, then go back to the resting one (Impact holds 150 ms). */
  flash(e: Expression, seconds: number = ART.faces.impactHold): this { this.flashExpr = e; this.flashLeft = seconds; this.refresh(); return this; }

  /** A hard landing: squeezed face and jiggling pupils. strength 0..1. */
  impact(strength: number): this {
    const k = clamp(strength, 0, 1) * 3.2;
    this.vx += (hash(this.seed + this.flashLeft * 7 + this.x) - 0.5) * k;
    this.vy -= k;
    if (strength > 0.35) this.flash('impact');
    return this;
  }

  /** Only pieces near the tower top animate expressions and blink (§4.3, noise control). */
  setLively(on: boolean): this { this.lively = on; if (!on) this.blinkLeft = 0; this.refresh(); return this; }

  /** Sweat drop for worried faces at tension ≥ 0.6. */
  setSweat(on: boolean): this { this.sweat = on; this.refresh(); return this; }

  /** 0 = live, 1 = stone. In between cross-fades, for the stone wave (§7.2). */
  setStone(amount: number): this {
    this.stone = clamp(amount, 0, 1);
    this.applyBodyTextures();
    this.refresh();
    return this;
  }

  /** Space rim strength 0..1 (biomes.rimAmount(skyPosition)). */
  setRim(amount: number): this {
    this.rim = clamp(amount, 0, 1);
    if (this.rim > 0 && !this.rimImg) {
      const r = this.tex.rim(this.key, ((this.q % 4) + 4) % 4);
      this.rimImg = use(this.tex.scene.add.image(0, 0, r.key, r.frame), r);
      this.applyDepth(); this.layout();
    }
    this.refresh();
    return this;
  }

  setFinish(f: Finish | null): this { this.finish = f; this.applyBodyTextures(); return this; }
  /** Change the shape skin (a cosmetic id or a look; null for the classic look). Purely visual. */
  setSkin(s: SkinLook | string | null): this { this.skin = lookOf(s); this.applyBodyTextures(); return this; }
  setFaces(on: boolean): this { this.faces = on; this.refresh(); return this; }
  setAlpha(a: number): this { this.alpha = a; this.refresh(); return this; }
  setVisible(v: boolean): this { this.visible = v; this.refresh(); return this; }
  setDepth(d: number): this { this.depth = d; this.applyDepth(); return this; }

  /** Call once per rendered frame. gravity: unit vector in screen space (default straight down). */
  update(dt: number, gravity: [number, number] = [0, 1]): void {
    if (this.flashLeft > 0) { this.flashLeft -= dt; if (this.flashLeft <= 0) { this.flashExpr = null; this.refresh(); } }
    const ex = this.expression();
    if (this.lively && ex === 'idle' && this.faces && this.stone < 1) {
      if (this.blinkLeft > 0) { this.blinkLeft -= dt; if (this.blinkLeft <= 0) { this.nextBlink = this.blinkGap(); this.refresh(); } }
      else { this.nextBlink -= dt; if (this.nextBlink <= 0) { this.blinkLeft = ART.faces.blinkLength; this.refresh(); } }
    }
    // Googly spring toward gravity.
    const travel = pupilTravel(ex), { stiffness, damping } = ART.faces.pupilSpring;
    const tx = gravity[0] * travel, ty = gravity[1] * travel * 1.1;
    const h = Math.min(dt, 1 / 30);
    this.vx += (stiffness * (tx - this.px) - damping * this.vx) * h;
    this.vy += (stiffness * (ty - this.py) - damping * this.vy) * h;
    this.px += this.vx * h; this.py += this.vy * h;
    const m = Math.hypot(this.px, this.py), lim = travel * 1.35;
    if (m > lim) { this.px *= lim / m; this.py *= lim / m; }
    if (ex === 'dizzy') this.spin += dt * 6;
    this.layout();
  }

  destroy(): void {
    for (const o of this.parts()) o.destroy();
    this.rimImg = this.stoneImg = this.sweatImg = null;
  }

  // ---- internals ----

  private blinkGap(): number {
    const [a, b] = ART.faces.blinkEvery;
    this.seed += 1;
    return a + (b - a) * hash(this.seed * 1.37);
  }

  private expression(): Expression {
    if (this.flashExpr) return this.flashExpr;
    if (this.blinkLeft > 0 && this.base === 'idle') return 'blink';
    if (!this.lively && this.base !== 'dizzy') return 'idle';
    return this.base;
  }

  private parts(): ImageLike[] {
    const out = [this.body, this.eyes, this.pupils[0], this.pupils[1], this.mouth];
    if (this.rimImg) out.push(this.rimImg);
    if (this.stoneImg) out.push(this.stoneImg);
    if (this.sweatImg) out.push(this.sweatImg);
    return out;
  }

  private applyBodyTextures(): void {
    const qq = ((this.q % 4) + 4) % 4;
    const full = this.stone >= 1;
    use(this.body, this.tex.piece(this.key, qq, { stone: full, finish: this.finish, pattern: this.pattern, skin: this.skin }));
    if (this.stone > 0 && this.stone < 1) {
      const st = this.tex.piece(this.key, qq, { stone: true });
      if (!this.stoneImg) { this.stoneImg = this.tex.scene.add.image(0, 0, st.key, st.frame); this.applyDepth(); }
      use(this.stoneImg, st);
    } else if (this.stoneImg) { this.stoneImg.destroy(); this.stoneImg = null; }
    if (this.rimImg) use(this.rimImg, this.tex.rim(this.key, qq));
  }

  private applyDepth(): void {
    const d = this.depth;
    this.rimImg?.setDepth(d - 0.004);
    this.body.setDepth(d);
    this.stoneImg?.setDepth(d + 0.001);
    this.eyes.setDepth(d + 0.002);
    this.mouth.setDepth(d + 0.002);
    this.pupils[0].setDepth(d + 0.003);
    this.pupils[1].setDepth(d + 0.003);
    this.sweatImg?.setDepth(d + 0.004);
  }

  /** Swap face textures and visibility for the current expression and state. */
  private refresh(): void {
    const ex = this.expression();
    const faceOn = this.visible && this.faces && this.stone < 1;
    if (ex !== this.shown) {
      this.shown = ex;
      if (ex !== 'dizzy') use(this.eyes, this.tex.face(`eyes_${ex}`));
      use(this.mouth, this.tex.face(`mouth_${ex}`));
      const pk = this.tex.face(ex === 'dizzy' ? 'spiral' : 'pupil');
      for (const p of this.pupils) use(p, pk);
    }
    const pupilsOn = PUPILS[ex].show || ex === 'dizzy';
    const fa = this.alpha * (1 - this.stone);
    this.body.setVisible(this.visible).setAlpha(this.alpha);
    this.eyes.setVisible(faceOn && ex !== 'dizzy').setAlpha(fa);
    this.mouth.setVisible(faceOn).setAlpha(fa);
    for (const p of this.pupils) p.setVisible(faceOn && pupilsOn).setAlpha(fa);
    if (this.stoneImg) this.stoneImg.setVisible(this.visible).setAlpha(this.alpha * this.stone);
    if (this.rimImg) this.rimImg.setVisible(this.visible && this.rim > 0).setAlpha(this.alpha * this.rim);
    const wantSweat = faceOn && this.sweat && this.tex.detail && (ex === 'worried' || ex === 'panic');
    if (wantSweat && !this.sweatImg) { const sw = this.tex.face('sweat'); this.sweatImg = use(this.tex.scene.add.image(0, 0, sw.key, sw.frame), sw); this.applyDepth(); }
    if (this.sweatImg) this.sweatImg.setVisible(wantSweat).setAlpha(fa);
  }

  /** Place every part from the pivot, angle, quarter and squash. */
  private layout(): void {
    const qq = ((this.q % 4) + 4) % 4, rot = -(this.angle - this.q * HALF_PI);
    const k = this.tex.scale, c = Math.cos(rot), s = Math.sin(rot), cell = this.tex.cellPx;
    const place = (img: ImageLike | null, lx: number, ly: number, sx = this.sx, sy = this.sy, extraRot = 0) => {
      if (!img) return;
      const ox = lx * this.sx, oy = ly * this.sy;
      img.setPosition(this.x + ox * c - oy * s, this.y + ox * s + oy * c).setRotation(rot + extraRot).setScale(sx * k, sy * k);
    };
    place(this.body, 0, 0);
    place(this.rimImg, 0, 0);
    place(this.stoneImg, 0, 0);
    // Face anchor relative to the pivot, in px.
    const p = pose(this.key, qq), [fx, fy] = faceAt(this.key, qq);
    const ax = (fx - p.w / 2) * cell, ay = (fy - p.h / 2) * cell;
    place(this.eyes, ax, ay);
    place(this.mouth, ax, ay);
    place(this.sweatImg, ax, ay);
    const ex = this.shown ?? 'idle', ps = PUPILS[ex].pupil;
    for (let i = 0; i < 2; i++) {
      const ex0 = (i ? 1 : -1) * FACE.eyeX * cell, ey0 = FACE.eyeY * cell;
      if (ex === 'dizzy') { place(this.pupils[i], ax + ex0, ay + ey0, this.sx, this.sy, this.spin); continue; }
      // Eye centre follows the body; the pupil offset is in screen space so it always hangs toward gravity.
      const lx = (ax + ex0) * this.sx, ly = (ay + ey0) * this.sy;
      const wx = this.x + lx * c - ly * s + this.px * cell, wy = this.y + lx * s + ly * c + this.py * cell;
      this.pupils[i].setPosition(wx, wy).setRotation(0).setScale(ps * k, ps * k);
    }
  }
}
