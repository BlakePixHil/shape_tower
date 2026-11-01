// Piece bodies (art-direction.md §4): shadow, Ink outline, shade and light lips, base, material,
// finish, pattern, seams, gloss, and for stone the carved sleeping face.
// Drawn with the pose's bounding box at (0,0), `s` pixels per block, canvas y down.

import { ART, INK } from './config.ts';
import { drawFace, type Expression } from './face.ts';
import { faceAnchor, silhouette } from './geometry.ts';
import { ART_SHAPES, pose, type Pose } from './shapes.ts';
import { type SkinLook, drawSkin, skinColors } from './skins.ts';
import { type Ctx, circ, ctx2d, hash, makeCanvas, rgba, rr, star4 } from './util.ts';

/** Biome finishes (§4.6). Meadow and Treetops use wood; Cloudlands and Moon have none. */
export type Finish = 'wood' | 'panel' | 'frost' | 'jelly' | 'glass';

export interface PieceStyle {
  /** Claimed / Solid Row stone (§4.4). Bakes the carved sleeping face in. */
  stone?: boolean;
  finish?: Finish | null;
  /** Colorblind patterns (§4.5). */
  pattern?: boolean;
  /** Draw the soft drop shadow. Off for stone. */
  shadow?: boolean;
  /** Draw small details (gloss, cheeks). Pass false when a block is under 20 pt on screen. */
  detail?: boolean;
  /** Bake a whole face in (previews, icons). The game draws live faces as separate sprites. */
  face?: Expression | null;
  /** A cosmetic skin (cosmetics.ts skinFor(id)), drawn instead of the finish. Stone ignores it. */
  skin?: SkinLook | null;
  /**
   * Pull the body this many blocks inside its cells (Blockling Pop: half the outline, so the Ink stroke's
   * outer edge sits on the cell edge and neighbouring pieces sit flush instead of overlapping).
   */
  inset?: number;
}

function patternFor(c: Ctx, key: string, p: Pose, s: number): void {
  c.save();
  c.strokeStyle = 'rgba(34,24,58,0.32)'; c.fillStyle = 'rgba(34,24,58,0.32)';
  c.lineWidth = Math.max(1.2, s * 0.06); c.lineCap = 'round';
  for (const [x, y] of p.cells) {
    const X = x * s, Y = y * s;
    c.beginPath();
    if (key === 'I') { for (let i = 1; i < 4; i++) { c.moveTo(X + i * s / 4, Y + s * 0.24); c.lineTo(X + i * s / 4, Y + s * 0.76); } c.stroke(); }
    else if (key === 'O') { for (const [a, b] of [[.32, .36], [.68, .36], [.32, .7], [.68, .7]]) circ(c, X + a * s, Y + b * s, s * 0.065); c.fill(); }
    else if (key === 'T') { c.moveTo(X + .25 * s, Y + .64 * s); c.lineTo(X + .5 * s, Y + .38 * s); c.lineTo(X + .75 * s, Y + .64 * s); c.stroke(); }
    else if (key === 'S') { c.moveTo(X + .26 * s, Y + .74 * s); c.lineTo(X + .74 * s, Y + .26 * s); c.stroke(); }
    else if (key === 'Z') { c.moveTo(X + .26 * s, Y + .26 * s); c.lineTo(X + .74 * s, Y + .74 * s); c.stroke(); }
    else if (key === 'L') { c.moveTo(X + .8 * s, Y + .42 * s); c.lineTo(X + .8 * s, Y + .8 * s); c.lineTo(X + .42 * s, Y + .8 * s); c.closePath(); c.fill(); }
    else if (key === 'J') { c.moveTo(X + .2 * s, Y + .42 * s); c.lineTo(X + .2 * s, Y + .8 * s); c.lineTo(X + .58 * s, Y + .8 * s); c.closePath(); c.fill(); }
  }
  c.restore();
}

/** Grain lines that run along a piece's long axis. */
function grain(c: Ctx, p: Pose, s: number, W: number, H: number, n: number, color: string, amp: number): void {
  const along = p.w >= p.h;
  c.save(); c.strokeStyle = color; c.lineWidth = Math.max(1, s * 0.03);
  const len = along ? W : H;
  for (let i = 0; i < n; i++) {
    const o0 = s * (0.18 + i * (0.66 / Math.max(1, n - 1)));
    c.beginPath();
    for (let u = 0; u <= len; u += 6) {
      const v = o0 + Math.sin(u / (s * 0.6) + i * 1.7) * s * amp;
      if (along) { if (u) c.lineTo(u, v); else c.moveTo(u, v); } else { if (u) c.lineTo(v, u); else c.moveTo(v, u); }
    }
    c.stroke();
  }
  c.restore();
}

function material(c: Ctx, key: string, p: Pose, s: number, W: number, H: number): void {
  const sh = ART_SHAPES[key], m = sh.material;
  if (!m) return;
  c.save();
  if (m === 'wood') grain(c, p, s, W, H, 4, rgba(sh.shade, 0.35), 0.03);
  else if (m === 'candy') { c.strokeStyle = 'rgba(255,255,255,0.38)'; c.lineWidth = s * 0.12; for (let x = -H; x < W + H; x += s * 0.48) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + H, 0); c.stroke(); } }
  else if (m === 'glass') { c.fillStyle = 'rgba(255,255,255,0.55)'; const cx = p.w * s * 0.32, cy = p.h * s * 0.6; c.beginPath(); c.moveTo(cx - s * 0.1, cy + s * 0.2); c.lineTo(cx + s * 0.1, cy - s * 0.05); c.lineTo(cx + s * 0.2, cy + s * 0.05); c.lineTo(cx, cy + s * 0.8); c.closePath(); c.fill(); }
  else if (m === 'basalt') { for (let i = 0; i < 18; i++) { c.fillStyle = i % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(20,18,30,0.3)'; c.beginPath(); circ(c, hash(i * 3.1) * W, hash(i * 5.7) * H, s * (0.025 + hash(i) * 0.03)); c.fill(); } }
  else if (m === 'brick') {
    c.strokeStyle = rgba(sh.light, 0.65); c.lineWidth = Math.max(1, s * 0.035);
    for (const [x, y] of p.cells) {
      c.beginPath(); c.moveTo(x * s + s * 0.1, y * s + s * 0.5); c.lineTo(x * s + s * 0.9, y * s + s * 0.5);
      const ox = (y % 2 ? 0.3 : 0.65) * s; c.moveTo(x * s + ox, y * s + s * 0.16); c.lineTo(x * s + ox, y * s + s * 0.5);
      const ox2 = (y % 2 ? 0.7 : 0.35) * s; c.moveTo(x * s + ox2, y * s + s * 0.5); c.lineTo(x * s + ox2, y * s + s * 0.84); c.stroke();
    }
  } else if (m === 'gem') {
    // The gem sits in the top arm, clear of the face in the centre cell.
    const top = p.cells.reduce((a, b) => (b[1] < a[1] || (b[1] === a[1] && Math.abs(b[0] + 0.5 - p.w / 2) < Math.abs(a[0] + 0.5 - p.w / 2)) ? b : a), p.cells[0] ?? [0, 0]);
    const cx = (top[0] + 0.5) * s, cy = (top[1] + 0.52) * s, r = s * 0.22;
    c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath();
    c.fillStyle = '#FFC23D'; c.fill(); c.lineWidth = Math.max(1, s * 0.04); c.strokeStyle = INK; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); circ(c, cx - r * 0.25, cy - r * 0.3, r * 0.18); c.fill();
  }
  c.restore();
}

function finish(c: Ctx, f: Finish | null | undefined, key: string, p: Pose, path: Path2D, s: number, W: number, H: number): void {
  if (!f) return;
  const sh = ART_SHAPES[key];
  const cells = p.cells.length ? p.cells : [[0, 0] as [number, number]];
  c.save();
  if (f === 'wood') grain(c, p, s, W, H, 5, rgba(sh.shade, 0.22), 0.025);
  else if (f === 'panel') {
    c.strokeStyle = rgba(sh.shade, 0.5); c.lineWidth = Math.max(1, s * 0.03); c.fillStyle = rgba(sh.shade, 0.6);
    for (const [x, y] of cells) { c.strokeRect(x * s + s * 0.18, y * s + s * 0.2, s * 0.64, s * 0.6); c.beginPath(); circ(c, x * s + s * 0.28, y * s + s * 0.3, s * 0.035); circ(c, x * s + s * 0.72, y * s + s * 0.7, s * 0.035); c.fill(); }
  } else if (f === 'frost') {
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = s * 0.08; c.setLineDash([s * 0.06, s * 0.1]); c.stroke(path); c.setLineDash([]);
    c.fillStyle = '#FFFFFF';
    for (let i = 0; i < cells.length * 2; i++) { const [x, y] = cells[i % cells.length]; c.globalAlpha = 0.5 + 0.5 * hash(i * 2.7); star4(c, (x + 0.25 + hash(i) * 0.5) * s, (y + 0.25 + hash(i * 3) * 0.5) * s, s * 0.08); }
  } else if (f === 'jelly') {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < cells.length * 2; i++) { const [x, y] = cells[i % cells.length]; c.globalAlpha = 0.5 + 0.5 * hash(i * 2.3); c.beginPath(); circ(c, (x + 0.2 + hash(i * 7) * 0.6) * s, (y + 0.25 + hash(i * 11) * 0.5) * s, s * 0.03); c.fill(); }
    c.globalAlpha = 0.25; c.strokeStyle = '#FFFFFF'; c.lineWidth = s * 0.12; c.stroke(path);
  } else if (f === 'glass') {
    c.fillStyle = 'rgba(255,255,255,0.28)';
    for (const [x, y] of cells) { c.beginPath(); c.moveTo(x * s + s * 0.1, y * s + s * 0.55); c.lineTo(x * s + s * 0.55, y * s + s * 0.1); c.lineTo(x * s + s * 0.7, y * s + s * 0.1); c.lineTo(x * s + s * 0.1, y * s + s * 0.7); c.closePath(); c.fill(); }
  }
  c.restore();
}

/** Draw one piece body with its bounding box at the current origin. */
export function drawPiece(c: Ctx, key: string, q: number, s: number, o: PieceStyle = {}): void {
  drawPose(c, key, pose(key, q), s, o);
}

/**
 * Any connected set of cells (y down, bounding box at 0,0) drawn as a body in `key`'s colours and
 * material: Blockling Pop's fragments, the cells left of a shape after a line pops through it.
 */
export function drawCells(c: Ctx, key: string, cells: [number, number][], s: number, o: PieceStyle = {}): void {
  drawPose(c, key, cellsPose(key, cells), s, o);
}

/** A pose for a set of cells, moved so its bounding box sits at (0,0). */
export function cellsPose(key: string, cells: [number, number][]): Pose {
  const x0 = Math.min(...cells.map(v => v[0])), y0 = Math.min(...cells.map(v => v[1]));
  const cs = cells.map(([x, y]) => [x - x0, y - y0] as [number, number]);
  return { key, q: 0, w: Math.max(...cs.map(v => v[0])) + 1, h: Math.max(...cs.map(v => v[1])) + 1, cells: cs };
}

function drawPose(c: Ctx, key: string, p: Pose, s: number, o: PieceStyle): void {
  const P = ART.piece, path = silhouette(p, s, undefined, o.inset ?? 0), W = p.w * s + 4, H = p.h * s + 4;
  const stone = !!o.stone, detail = o.detail ?? true, skin = stone ? null : o.skin ?? null;
  // A skin may wash the shape's colors (same hue family); everything below draws in them.
  const sh = skin ? { ...ART_SHAPES[key], ...skinColors(skin, ART_SHAPES[key]) } : ART_SHAPES[key];
  c.save();
  if ((o.shadow ?? true) && !stone) {
    c.save(); c.translate(s * P.shadow.x, s * P.shadow.y); c.fillStyle = rgba(INK, P.shadow.alpha); c.fill(path); c.restore();
  }
  c.lineJoin = 'round';
  c.lineWidth = s * P.outline; c.strokeStyle = INK; c.stroke(path);

  c.save(); c.clip(path);
  if (sh.material === 'glass') c.globalAlpha *= P.glassAlpha;
  // Lips: shade everywhere, light where the shape continues above (clip shifted up),
  // base where it also continues below (clip shifted down). Leaves bands on top and bottom edges.
  c.fillStyle = sh.shade; c.fillRect(-2, -2, W, H);
  c.save(); c.translate(0, -s * P.shadeLip); c.clip(path); c.translate(0, s * P.shadeLip);
  c.fillStyle = sh.light; c.fillRect(-2, -2, W, H);
  c.save(); c.translate(0, s * P.lightLip); c.clip(path); c.translate(0, -s * P.lightLip);
  c.fillStyle = sh.base; c.fillRect(-2, -2, W, H);
  c.restore(); c.restore();
  c.globalAlpha = 1;
  material(c, key, p, s, W, H);
  if (skin) drawSkin(c, skin, p, path, s, W, H, sh);
  if (o.pattern) patternFor(c, key, p, s);
  if (!stone && !skin) finish(c, o.finish, key, p, path, s, W, H);

  // Seams between neighbouring cells.
  if (p.cells.length) {
    c.strokeStyle = stone ? 'rgba(70,58,46,0.55)' : rgba(sh.shade, 0.45);
    c.lineWidth = Math.max(1, s * (stone ? 0.05 : 0.035)); c.lineCap = 'round';
    const set = new Set(p.cells.map(v => v[0] + ',' + v[1])), a = P.seamInset, b = 1 - P.seamInset;
    c.beginPath();
    for (const [x, y] of p.cells) {
      if (set.has((x + 1) + ',' + y)) { c.moveTo((x + 1) * s, (y + a) * s); c.lineTo((x + 1) * s, (y + b) * s); }
      if (set.has(x + ',' + (y + 1))) { c.moveTo((x + a) * s, (y + 1) * s); c.lineTo((x + b) * s, (y + 1) * s); }
    }
    c.stroke();
  }
  // Gloss pills, top-left of each cell.
  if (detail && !stone) {
    c.fillStyle = 'rgba(255,255,255,0.5)';
    const spots: [number, number][] = p.cells.length ? p.cells : [[p.w * 0.12, p.h * 0.08]];
    for (const [x, y] of spots) { rr(c, (x + 0.16) * s, (y + 0.2) * s, s * 0.24, s * 0.11, s * 0.055); c.fill(); }
  }
  if (stone) {
    const S = ART.stone;
    c.globalCompositeOperation = 'saturation'; c.fillStyle = `rgba(128,128,128,${S.desaturate})`; c.fillRect(-2, -2, W, H);
    c.globalCompositeOperation = 'source-over'; c.fillStyle = rgba(S.warm, S.warmAlpha); c.fillRect(-2, -2, W, H);
    c.fillStyle = S.grain;
    for (let i = 0; i < p.w * p.h * 7; i++) { c.beginPath(); circ(c, hash(i * 1.3 + p.w) * p.w * s, hash(i * 2.9 + p.h) * p.h * s, s * 0.022); c.fill(); }
  }
  c.restore();

  const fx = stone ? 'carved' : o.face;
  // Boulder never sleeps (§4.4).
  if (fx && !(stone && sh.custom === 'boulder')) {
    const [ax, ay] = faceAnchor(p);
    drawFace(c, ax * s, ay * s, s, fx, { detail });
  }
  c.restore();
}

/** A baked texture plus where its pivot (the centre of the cell bounding box) sits. */
export interface Baked {
  canvas: HTMLCanvasElement;
  /** Pivot as a fraction of the canvas size, for setOrigin(). */
  originX: number;
  originY: number;
  /** Pixels per block the texture was drawn at. */
  s: number;
}

/** Padding around a body, in blocks: outline, shadow and space rim all fit. */
export const PIECE_PAD = 0.2;

export function bakePiece(key: string, q: number, s: number, o: PieceStyle = {}): Baked {
  const p = pose(key, q), pad = Math.ceil(PIECE_PAD * s);
  const canvas = makeCanvas(p.w * s + pad * 2, p.h * s + pad * 2), c = ctx2d(canvas);
  c.translate(pad, pad);
  drawPiece(c, key, q, s, o);
  return { canvas, originX: (pad + p.w * s / 2) / canvas.width, originY: (pad + p.h * s / 2) / canvas.height, s };
}

/** drawCells baked, padded like bakePiece; the pivot is the centre of the cells' bounding box. */
export function bakeCells(key: string, cells: [number, number][], s: number, o: PieceStyle = {}): Baked {
  const p = cellsPose(key, cells), pad = Math.ceil(PIECE_PAD * s);
  const canvas = makeCanvas(p.w * s + pad * 2, p.h * s + pad * 2), c = ctx2d(canvas);
  c.translate(pad, pad);
  drawPose(c, key, p, s, o);
  return { canvas, originX: (pad + p.w * s / 2) / canvas.width, originY: (pad + p.h * s / 2) / canvas.height, s };
}

/** The space rim (§6.4): a light ring that shows outside the outline. Layer it under the body. */
export function bakeRim(key: string, q: number, s: number): Baked {
  const p = pose(key, q), pad = Math.ceil(PIECE_PAD * s);
  const canvas = makeCanvas(p.w * s + pad * 2, p.h * s + pad * 2), c = ctx2d(canvas);
  c.translate(pad, pad);
  c.lineJoin = 'round'; c.lineWidth = s * (ART.piece.outline + ART.piece.rimWidth);
  c.strokeStyle = `rgba(255,255,255,${ART.piece.rimAlpha})`; c.stroke(silhouette(p, s));
  return { canvas, originX: (pad + p.w * s / 2) / canvas.width, originY: (pad + p.h * s / 2) / canvas.height, s };
}

/** A white silhouette for flashes and shine sweeps (tint it, fade it). */
export function bakeSilhouette(key: string, q: number, s: number): Baked {
  const p = pose(key, q), pad = Math.ceil(PIECE_PAD * s);
  const canvas = makeCanvas(p.w * s + pad * 2, p.h * s + pad * 2), c = ctx2d(canvas);
  c.translate(pad, pad); c.fillStyle = '#FFFFFF'; c.fill(silhouette(p, s));
  return { canvas, originX: (pad + p.w * s / 2) / canvas.width, originY: (pad + p.h * s / 2) / canvas.height, s };
}
