// Bakes art on first use and packs it into shared atlas pages (2048² canvases registered as Phaser
// textures with one frame per image). Packing keeps a whole tower in one or two draw calls.
// Images are drawn at cellPx × texScale pixels per block, so sprites display at scale 1 / texScale.

import { ART } from '../config.ts';
import { bakeFlag, bakeGlint, bakeGlowBand, bakeHoldTick, bakeLabel, bakePbDash, bakePbFlag, bakePennant, bakePlaque, bakeRopeTile } from '../checkpoint.ts';
import { type Expression, FACE, drawEyes, drawMouth, drawPupil, drawSpiral, drawSweat } from '../face.ts';
import { type GlyphState, bakeBeamFill, bakeChevron, bakeContactDot, bakeContactRing, bakeGhostEdge, bakeGlyph } from '../guide.ts';
import { type Baked, type Finish, bakePiece, bakeRim, bakeSilhouette } from '../piece.ts';
import { type Grade, bakeGradeStamp, bakePedestal, bakeSlab } from '../slab.ts';
import { ctx2d, makeCanvas } from '../util.ts';
import { VFX_NAMES, type VfxName, bakeVfx } from '../vfx.ts';
import type { CanvasTextureLike, SceneLike } from './types.ts';

/** A texture key, the frame inside it, and the pivot as fractions of the frame. */
export interface TexRef { key: string; frame: string; originX: number; originY: number; width: number; height: number }

export interface ArtTexturesOptions {
  /** Screen (game) pixels per block. Gameplay: view width / 12. */
  cellPx: number;
  /**
   * Texture pixels per game pixel. Default: device pixel ratio, capped at 2. Pass 1 if your game
   * canvas already renders at device resolution.
   */
  texScale?: number;
  /** "High-contrast guides" setting (§5.3). */
  highContrastGuide?: boolean;
  /** Atlas page size in px (default 2048, safe on every phone). */
  pageSize?: number;
}

export type FacePart = `eyes_${Expression}` | `mouth_${Expression}` | 'pupil' | 'spiral' | 'sweat';

interface Page { key: string; canvas: HTMLCanvasElement; tex: CanvasTextureLike; x: number; y: number; rowH: number; dirty: boolean }

const GAP = 2;
let bankId = 0;

export class ArtTextures {
  readonly scene: SceneLike;
  readonly cellPx: number;
  /** Texture px per game px. */
  readonly k: number;
  /** Texture px per block. */
  readonly s: number;
  /** Faces drop cheeks, catch-lights and sweat below 28 pt per block (§2). */
  readonly detail: boolean;
  highContrastGuide: boolean;
  private refs = new Map<string, TexRef>();
  private pages: Page[] = [];
  private pageSize: number;
  private flushQueued = false;
  private id = ++bankId;

  constructor(scene: SceneLike, o: ArtTexturesOptions) {
    this.scene = scene;
    this.cellPx = o.cellPx;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.k = o.texScale ?? Math.min(2, Math.max(1, dpr));
    this.s = Math.round(o.cellPx * this.k);
    this.detail = o.cellPx >= ART.piece.faceMinCellPx;
    this.highContrastGuide = !!o.highContrastGuide;
    this.pageSize = o.pageSize ?? 2048;
  }

  /** Display scale for a sprite showing one of these textures at its natural size. */
  get scale(): number { return 1 / this.k; }

  /** Upload any atlas pages changed since the last upload. Runs on its own after each burst of bakes. */
  flush(): void {
    this.flushQueued = false;
    for (const p of this.pages) if (p.dirty) { p.dirty = false; p.tex.refresh(); }
  }

  /** Bake ahead of time (e.g. on a loading screen) so nothing bakes mid-run. */
  prewarm(keys: string[], o: { finishes?: (Finish | null)[]; stone?: boolean; rim?: boolean; vfx?: boolean } = {}): void {
    for (const key of keys) for (let q = 0; q < 4; q++) {
      for (const f of o.finishes ?? [null]) this.piece(key, q, { finish: f });
      if (o.stone ?? true) this.piece(key, q, { stone: true });
      if (o.rim) this.rim(key, q);
      this.silhouette(key, q);
      this.ghostEdge(key, q);
    }
    for (const ex of ['idle', 'falling', 'impact', 'proud', 'worried', 'panic', 'blink'] as Expression[]) { this.face(`eyes_${ex}`); this.face(`mouth_${ex}`); }
    for (const p of ['pupil', 'spiral', 'sweat'] as FacePart[]) this.face(p);
    if (o.vfx ?? true) for (const v of VFX_NAMES) this.vfx(v);
    this.flush();
  }

  // ---- pieces ----

  piece(key: string, q: number, o: { stone?: boolean; finish?: Finish | null; pattern?: boolean } = {}): TexRef {
    return this.packed(this.name('piece', key, q, o.stone ? 'stone' : 'live', o.stone ? '-' : (o.finish ?? '-'), o.pattern ? 'pat' : ''),
      () => bakePiece(key, q, this.s, { stone: o.stone, finish: o.finish, pattern: o.pattern, detail: this.cellPx >= 20 }));
  }
  /** Space rim: layer under the body. */
  rim(key: string, q: number): TexRef { return this.packed(this.name('rim', key, q), () => bakeRim(key, q, this.s)); }
  /** White silhouette: ghost fill, flashes, shine sweeps (tint it). */
  silhouette(key: string, q: number): TexRef { return this.packed(this.name('sil', key, q), () => bakeSilhouette(key, q, this.s)); }

  // ---- faces ----

  /** One face part, centred on the face anchor, FACE.box blocks square. */
  face(part: FacePart): TexRef {
    return this.packed(this.name('face', part, this.detail ? 'd' : ''), () => {
      const size = Math.ceil(FACE.box * this.s), cv = makeCanvas(size, size), c = ctx2d(cv), m = size / 2;
      c.translate(m, m);
      if (part === 'pupil') drawPupil(c, 0, 0, this.s, 1, this.detail);
      else if (part === 'spiral') drawSpiral(c, 0, 0, this.s);
      else if (part === 'sweat') drawSweat(c, this.s);
      else if (part.startsWith('eyes_')) drawEyes(c, this.s, part.slice(5) as Expression);
      else drawMouth(c, this.s, part.slice(6) as Expression, this.detail);
      return cv;
    });
  }

  // ---- landing guide ----

  /** White dashed edge with Ink sides; tint it with the state color. */
  ghostEdge(key: string, q: number): TexRef {
    return this.packed(this.name('gedge', key, q, this.highContrastGuide ? 'hc' : ''), () => bakeGhostEdge(key, q, this.s, this.highContrastGuide));
  }
  dot(): TexRef { return this.packed(this.name('dot'), () => bakeContactDot(this.s)); }
  ring(): TexRef { return this.packed(this.name('ring'), () => bakeContactRing(this.s)); }
  glyph(st: GlyphState): TexRef { return this.packed(this.name('glyph', st), () => bakeGlyph(st, this.s)); }
  /** Chevron tile for the beam's TileSprite (its own texture, so it can repeat). */
  chevron(): TexRef { return this.single(this.name('chevron'), () => bakeChevron(this.s), 0.5, 0); }
  /** Beam fill gradient (its own texture, so stretching it never bleeds). */
  beamFill(): TexRef { return this.single('st:beamfill', () => bakeBeamFill(), 0.5, 0); }
  /** A small white texture for lines and flat fills (tint and stretch it). */
  pixel(): TexRef { return this.single('st:px', () => { const c = makeCanvas(4, 4), x = ctx2d(c); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, 4, 4); return c; }); }

  // ---- foundations ----

  /** Biome `bi`'s slab, `width` blocks wide. Origin: centre of the top surface. */
  slab(bi: number, width: number): TexRef { return this.packed(this.name('slab', bi, width), () => bakeSlab(bi, width, this.s)); }
  /** The Meadow's first wooden pedestal. Origin: centre of the top surface. */
  pedestal(width: number, legs = 1.6): TexRef { return this.packed(this.name('pedestal', width, legs), () => bakePedestal(width, this.s, legs)); }
  gradeStamp(g: Grade): TexRef { return this.packed(this.name('grade', g), () => bakeGradeStamp(g, this.s)); }

  // ---- checkpoint line ----

  /** Rope tile for a TileSprite: cream for the active line, gold once claimed. Origin: left, middle. */
  rope(claimed: boolean): TexRef { return this.single(this.name('rope', claimed ? 'gold' : 'live'), () => bakeRopeTile(this.s, claimed), 0, 0.5); }
  /** Bunting pennant in shape color i (BUNTING_KEYS order). Origin: top centre. */
  pennant(i: number): TexRef { const n = ((i % 7) + 7) % 7; return this.packed(this.name('pennant', n), () => bakePennant(n, this.s)); }
  /** The numbered checkpoint plaque. Origin: centre. */
  plaque(n: number): TexRef { return this.packed(this.name('plaque', n), () => bakePlaque(n, this.s)); }
  /** One hold-steady ring tick (white; tint mint when lit). */
  holdTick(): TexRef { return this.packed(this.name('holdtick'), () => bakeHoldTick(this.s)); }
  /** A display-face word with an Ink edge, e.g. "HOLD STEADY!". Origin: centre. */
  label(text: string, size = 0.36): TexRef { return this.packed(this.name('label', text, size), () => bakeLabel(text, this.s, size)); }
  /** Claimed-line flag, wave frame f. Origin: foot of the pole. */
  flag(f: number): TexRef { return this.packed(this.name('flag', f), () => bakeFlag(f, this.s)); }
  pbFlag(): TexRef { return this.packed(this.name('pbflag'), () => bakePbFlag(this.s)); }
  /** Personal-best dash tile for a TileSprite. Origin: left, middle. */
  pbDash(): TexRef { return this.single(this.name('pbdash'), () => bakePbDash(this.s), 0, 0.5); }
  /** Soft glow band (its own texture, so stretching it never bleeds). Tint it. */
  glowBand(): TexRef { return this.single('st:glowband', () => bakeGlowBand()); }
  glint(): TexRef { return this.packed(this.name('glint'), () => bakeGlint(this.s)); }

  // ---- effects ----

  /** An effect texture for particles (see VFX for natural sizes in blocks). Origin: centre. */
  vfx(name: VfxName): TexRef { return this.packed(this.name('vfx', name), () => bakeVfx(name, this.s)); }

  // ---- internals ----

  private name(...parts: (string | number)[]): string { return parts.join(':') + '@' + this.s; }

  private unpack(made: HTMLCanvasElement | Baked, ox: number, oy: number): { canvas: HTMLCanvasElement; originX: number; originY: number } {
    return made instanceof HTMLCanvasElement ? { canvas: made, originX: ox, originY: oy } : made;
  }

  /** Bake into an atlas page. */
  private packed(name: string, make: () => HTMLCanvasElement | Baked, ox = 0.5, oy = 0.5): TexRef {
    const hit = this.refs.get(name);
    if (hit) return hit;
    const { canvas, originX, originY } = this.unpack(make(), ox, oy);
    const w = canvas.width, h = canvas.height;
    if (w + GAP * 2 > this.pageSize || h + GAP * 2 > this.pageSize) return this.single('st:big:' + name, () => canvas, originX, originY);
    let page = this.pages[this.pages.length - 1];
    if (page && page.x + w + GAP > this.pageSize) { page.x = GAP; page.y += page.rowH + GAP; page.rowH = 0; }
    if (!page || page.y + h + GAP > this.pageSize) page = this.newPage();
    page.canvas.getContext('2d')!.drawImage(canvas, page.x, page.y);
    page.tex.add(name, 0, page.x, page.y, w, h);
    const ref: TexRef = { key: page.key, frame: name, originX, originY, width: w, height: h };
    page.x += w + GAP; page.rowH = Math.max(page.rowH, h);
    page.dirty = true;
    this.refs.set(name, ref);
    if (!this.flushQueued) { this.flushQueued = true; queueMicrotask(() => this.flush()); }
    return ref;
  }

  /** Bake into a texture of its own (repeating or stretched images). */
  private single(key: string, make: () => HTMLCanvasElement | Baked, ox = 0.5, oy = 0.5): TexRef {
    const hit = this.refs.get(key);
    if (hit && this.scene.textures.exists(key)) return hit;
    const { canvas, originX, originY } = this.unpack(make(), ox, oy);
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.scene.textures.addCanvas(key, canvas);
    const ref: TexRef = { key, frame: '__BASE', originX, originY, width: canvas.width, height: canvas.height };
    this.refs.set(key, ref);
    return ref;
  }

  private newPage(): Page {
    const key = `st:atlas:${this.id}:${this.pages.length}`;
    const canvas = makeCanvas(this.pageSize, this.pageSize);
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.addCanvas(key, canvas);
    if (!tex) throw new Error('Could not create an atlas page');
    const page: Page = { key, canvas, tex, x: GAP, y: GAP, rowH: 0, dirty: true };
    this.pages.push(page);
    return page;
  }
}
