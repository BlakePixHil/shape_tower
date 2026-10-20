// The landing guide on screen (art-direction.md §5): drop beam with flowing chevrons, the ghost
// (pulsing fill, dashed double edge, gold shimmer sweep on a perfect fit, rocking when it will tip),
// contact dots with expanding rings, and the state glyph.
//
// No smoothing: every call to show() places everything exactly where Gameplay says, on the same
// frame. Tint hysteresis is Gameplay's. Give the guide a depth above weather and particles.

import { ART, GUIDE_TINT, SIGNAL, type GuideState } from '../config.ts';
import { ART_SHAPES, pose } from '../shapes.ts';
import { TAU, clamp, hexNum, smooth } from '../util.ts';
import type { ArtTextures, TexRef } from './textures.ts';
import type { DisplayLike, ImageLike, TileSpriteLike } from './types.ts';

export interface GuideShow {
  key: string;
  /** Quarter turns of the active piece (the ghost shows the same rotation). */
  q: number;
  /** Active piece pivot, world px. */
  pieceX: number;
  pieceY: number;
  /** Ghost pivot at its landing pose, world px. Ignored for 'miss'. */
  ghostX: number;
  ghostY: number;
  state: GuideState;
  perfect?: boolean;
  /** First-contact points, world px. */
  contacts?: [number, number][];
  /** For 'miss': where the red beam ends (bottom of the view), world px. */
  missBottomY?: number;
  /** Visible world x range, so the glyph stays on screen. */
  viewLeft?: number;
  viewRight?: number;
}

const use = (img: ImageLike, r: TexRef) => img.setTexture(r.key, r.frame).setOrigin(r.originX, r.originY);

export class GuideView {
  private tex: ArtTextures;
  private depth: number;
  private beam: ImageLike;
  private edgeL: ImageLike;
  private edgeR: ImageLike;
  private chev: TileSpriteLike;
  private fill: ImageLike;
  private edge: ImageLike;
  private shine: ImageLike;
  private glyph: ImageLike;
  private dots: { dot: ImageLike; ring: ImageLike }[] = [];
  private g: GuideShow | null = null;
  private t = 0;
  /** "Guide opacity" setting, 0.5–1.5 (§5.3). */
  opacity = 1;
  reduceMotion = false;

  constructor(tex: ArtTextures, depth = 1000) {
    this.tex = tex;
    this.depth = depth;
    const add = tex.scene.add, px = tex.pixel();
    const bf = tex.beamFill();
    this.beam = add.image(0, 0, bf.key).setOrigin(0.5, 0);
    this.edgeL = add.image(0, 0, px.key).setOrigin(0.5, 0);
    this.edgeR = add.image(0, 0, px.key).setOrigin(0.5, 0);
    const ch = tex.chevron();
    this.chev = add.tileSprite(0, 0, 8, 8, ch.key).setOrigin(0.5, 0);
    this.fill = add.image(0, 0, px.key);
    this.edge = add.image(0, 0, px.key);
    this.shine = add.image(0, 0, px.key);
    const gl = tex.glyph('risky');
    this.glyph = add.image(0, 0, gl.key, gl.frame);
    [this.beam, this.edgeL, this.edgeR, this.chev].forEach(o => o.setDepth(depth));
    [this.fill, this.shine].forEach(o => o.setDepth(depth + 0.1));
    this.edge.setDepth(depth + 0.2);
    this.glyph.setDepth(depth + 0.4);
    this.hide();
  }

  show(g: GuideShow): void { this.g = g; this.layout(); }

  hide(): void {
    this.g = null;
    for (const o of this.all()) o.setVisible(false);
  }

  /** Animate chevrons, pulse, shimmer, rocking and contact rings. Call every frame. */
  update(dt: number): void {
    this.t += dt;
    if (this.g) this.layout();
  }

  destroy(): void { for (const o of this.all()) o.destroy(); this.dots = []; }

  private all(): DisplayLike[] {
    return [this.beam, this.edgeL, this.edgeR, this.chev, this.fill, this.edge, this.shine, this.glyph, ...this.dots.flatMap(d => [d.dot, d.ring])];
  }

  private layout(): void {
    const g = this.g!, tex = this.tex, k = tex.scale, cell = tex.cellPx, G = ART.guide, t = this.t;
    const q = ((Math.round(g.q) % 4) + 4) % 4, p = pose(g.key, q);
    const miss = g.state === 'miss';
    const tint = hexNum(g.perfect && !miss ? SIGNAL.gold : GUIDE_TINT[g.state]);
    const w = p.w * cell, h = p.h * cell;
    const pieceBottom = g.pieceY + h / 2, ghostTop = g.ghostY - h / 2;
    // The ghost fades out as the piece closes in, so they never overlap (§5.3).
    const near = miss ? 1 : smooth(0.15, G.fadeNear, (ghostTop - pieceBottom) / cell);
    const op = Math.min(1, clamp(this.opacity, 0.5, 1.5));
    const boost = clamp(this.opacity, 0.5, 1.5) / op;

    // Beam: from the piece's bottom edge down to the ghost (or the bottom of the view on a miss).
    const top = pieceBottom - 2, bot = miss ? (g.missBottomY ?? pieceBottom + 20 * cell) : g.ghostY;
    const len = bot - top, showBeam = len > 4;
    this.beam.setVisible(showBeam);
    this.edgeL.setVisible(showBeam);
    this.edgeR.setVisible(showBeam);
    this.chev.setVisible(showBeam && len > 12);
    if (showBeam) {
      this.beam.setPosition(g.pieceX, top).setDisplaySize(w, len).setTint(tint).setAlpha(op);
      for (const [e, x] of [[this.edgeL, g.pieceX - w / 2 + 0.5], [this.edgeR, g.pieceX + w / 2 - 0.5]] as [ImageLike, number][]) {
        e.setPosition(x, top).setDisplaySize(1, len).setTint(tint).setAlpha(G.beamEdgeAlpha * op);
      }
      const ch = tex.chevron(), tileH = Math.ceil(G.chevronSpacing * tex.s);
      this.chev.setSize(ch.width, Math.max(1, Math.floor((len - 12) / k)));
      this.chev.setOrigin(ch.originX, ch.originY).setPosition(g.pieceX, top).setScale(k, k).setTint(tint).setAlpha(op);
      const flow = this.reduceMotion ? 0 : t * G.chevronSpeed * tex.s;
      this.chev.tilePositionY = -(flow % tileH);
    }

    // Ghost: base-color fill (white silhouette, tinted), tinted dashed edge, gold sweep when perfect.
    const ghostOn = !miss && near > 0.01;
    this.fill.setVisible(ghostOn);
    this.edge.setVisible(ghostOn);
    this.shine.setVisible(ghostOn && !!g.perfect);
    if (ghostOn) {
      const pulse = G.pulseMin + (G.pulseMax - G.pulseMin) * (0.5 + 0.5 * Math.sin(t * TAU * G.pulseHz));
      const rock = g.state === 'tip' && !this.reduceMotion ? Math.sin(t * TAU * G.tipRockHz) * G.tipRockDeg * Math.PI / 180 : 0;
      const sil = tex.silhouette(g.key, q), e = tex.ghostEdge(g.key, q);
      use(this.fill, sil).setPosition(g.ghostX, g.ghostY).setRotation(rock).setScale(k, k)
        .setTint(hexNum(ART_SHAPES[g.key].base)).setAlpha(clamp(G.ghostFill * pulse * near * boost, 0, 1));
      use(this.edge, e).setPosition(g.ghostX, g.ghostY).setRotation(rock).setScale(k, k)
        .setTint(tint).setAlpha(Math.min(1, pulse + 0.25) * near * op);
      if (g.perfect) {
        // A soft gold band sweeping left to right, cropped from the silhouette.
        const band = 0.7 * tex.s, span = sil.width + band, ph = (t / G.shimmerSeconds) % 1;
        const x0 = -band + ph * span, cx = Math.max(0, x0), cw = Math.max(0, Math.min(sil.width, x0 + band) - cx);
        use(this.shine, sil).setPosition(g.ghostX, g.ghostY).setRotation(rock).setScale(k, k)
          .setCrop(cx, 0, cw, sil.height).setTint(0xFFE28C).setAlpha(0.75 * Math.sin(Math.PI * ph) * near);
      }
    }

    // Contact dots with a looping expanding ring.
    const contacts = ghostOn ? (g.contacts ?? []) : [];
    while (this.dots.length < contacts.length) {
      const add = tex.scene.add, d = tex.dot(), r = tex.ring();
      const dot = add.image(0, 0, d.key, d.frame).setDepth(this.depth + 0.3);
      const ring = add.image(0, 0, r.key, r.frame).setDepth(this.depth + 0.25);
      this.dots.push({ dot, ring });
    }
    const f = (t * 1.1) % 1;
    this.dots.forEach((d, i) => {
      const c = contacts[i];
      d.dot.setVisible(!!c); d.ring.setVisible(!!c && !this.reduceMotion);
      if (!c) return;
      d.dot.setPosition(c[0], c[1]).setScale(k, k).setAlpha(near);
      d.ring.setPosition(c[0], c[1]).setScale(k * (0.27 + 0.73 * f), k * (0.27 + 0.73 * f)).setTint(tint).setAlpha(0.9 * (1 - f) * near);
    });

    // Glyph: beside the ghost's lower right for risky, tip and perfect; at the beam's end for a miss.
    const pt = cell / 32;
    if (miss) {
      use(this.glyph, tex.glyph('miss')).setPosition(g.pieceX, bot - 22 * pt).setScale(k, k).setAlpha(1).setVisible(true);
    } else if (g.state !== 'stable' || g.perfect) {
      const gs = g.perfect && g.state === 'stable' ? 'perfect' : (g.state as 'risky' | 'tip');
      let gx = g.ghostX + w / 2 + 13 * pt;
      if (g.viewRight != null && gx > g.viewRight - 14 * pt) gx = g.ghostX - w / 2 - 13 * pt;
      if (g.viewLeft != null) gx = Math.max(gx, g.viewLeft + 14 * pt);
      use(this.glyph, tex.glyph(gs)).setPosition(gx, g.ghostY + h / 2 - 12 * pt).setScale(k, k).setAlpha(Math.max(near, 0.6)).setVisible(true);
    } else this.glyph.setVisible(false);
  }
}
