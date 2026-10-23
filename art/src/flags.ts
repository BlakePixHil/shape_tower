// Flag styles (monetisation plan v2: Builder's Pass rewards and Workshop sets): the flag planted on a
// claimed checkpoint, in place of the gold star flag (checkpoint.ts). Made from parts: a cloth shape, a
// field pattern and an emblem, all invented (no real country's or movement's flag). The cloth waves like
// the gold one: it's drawn flat, then laid down in thin strips that follow the wave. Purely visual.

import { INK, SIGNAL } from './config.ts';
import { heart, twinkle } from './sticker.ts';
import { type Ctx, TAU, circ, ctx2d, makeCanvas, rr, turnHex } from './util.ts';

export type FlagShape = 'rect' | 'pennant' | 'swallow';
export type FlagPattern = 'solid' | 'checks' | 'border' | 'hoist' | 'waves' | 'quarters' | 'candy' | 'rivets' | 'scales';
export type FlagEmblem = 'none' | 'star' | 'heart' | 'moon' | 'bolt' | 'daisy' | 'cloud' | 'crown' | 'comet' | 'paw' | 'lolly' | 'gear' | 'flame';

export interface FlagDesign {
  shape: FlagShape;
  pattern: FlagPattern;
  emblem: FlagEmblem;
  /** Field, pattern colour, emblem colour. */
  colors: [string, string, string];
  /** The finial's colour (default gold). */
  finial?: string;
}

export const FLAG_DESIGNS = {
  pennant: { shape: 'pennant', pattern: 'hoist', emblem: 'star', colors: ['#FF4F64', '#FFFFFF', '#FFFFFF'] },
  checkered: { shape: 'rect', pattern: 'checks', emblem: 'none', colors: ['#FFFFFF', '#2A2148', '#FFFFFF'] },
  heart: { shape: 'rect', pattern: 'border', emblem: 'heart', colors: ['#FF7FA0', '#FFFFFF', '#FFFFFF'] },
  moon: { shape: 'swallow', pattern: 'solid', emblem: 'moon', colors: ['#2C3A7A', '#FFFFFF', '#FFD666'] },
  bolt: { shape: 'swallow', pattern: 'hoist', emblem: 'bolt', colors: ['#FFCC33', '#2A2148', '#FFFFFF'] },
  daisy: { shape: 'rect', pattern: 'solid', emblem: 'daisy', colors: ['#5ED15A', '#FFFFFF', '#FFFFFF'] },
  surf: { shape: 'rect', pattern: 'waves', emblem: 'none', colors: ['#33C3F0', '#FFFFFF', '#FFFFFF'] },
  cloud: { shape: 'pennant', pattern: 'solid', emblem: 'cloud', colors: ['#9BE6FF', '#FFFFFF', '#FFFFFF'] },
  royal: { shape: 'swallow', pattern: 'border', emblem: 'crown', colors: ['#A35CFF', '#FFC23D', '#FFC23D'] },
  blocks: { shape: 'rect', pattern: 'quarters', emblem: 'none', colors: ['#FF4F64', '#FFCC33', '#4A72FF'] },
  comet: { shape: 'pennant', pattern: 'solid', emblem: 'comet', colors: ['#3D46B8', '#FFFFFF', '#FFD666'] },
  paw: { shape: 'rect', pattern: 'hoist', emblem: 'paw', colors: ['#FFF3D6', '#FF9A2E', '#A8723E'] },
  candy: { shape: 'rect', pattern: 'candy', emblem: 'lolly', colors: ['#FFB3CF', '#FFFFFF', '#FF4F7A'], finial: '#7FE3F5' },
  robot: { shape: 'rect', pattern: 'rivets', emblem: 'gear', colors: ['#9AA6BC', '#5E6880', '#FFC23D'], finial: '#FF4F64' },
  dragon: { shape: 'swallow', pattern: 'scales', emblem: 'flame', colors: ['#CC2E48', '#8E1F33', '#FFC23D'] },
} satisfies Record<string, FlagDesign>;
export type FlagKind = keyof typeof FLAG_DESIGNS;

/** A flag style (cosmetics.ts flagFor(id)): which design, and how far its hues turn (later variants). */
export interface FlagLook { kind: FlagKind; turn: number }

/** The cloth's outline in flat cloth coordinates (0..W, 0..H). */
function clothPoints(shape: FlagShape, W: number, H: number): [number, number][] {
  if (shape === 'pennant') return [[0, 0], [W, H / 2], [0, H]];
  if (shape === 'swallow') return [[0, 0], [W, 0], [W * 0.72, H / 2], [W, H], [0, H]];
  return [[0, 0], [W, 0], [W, H], [0, H]];
}

/** Where the emblem sits, as a fraction of the cloth width. */
const EMBLEM_AT: Record<FlagShape, number> = { rect: 0.5, pennant: 0.33, swallow: 0.42 };

function emblem(c: Ctx, e: FlagEmblem, x: number, y: number, r: number, col: string, T: (h: string) => string, lw: number): void {
  const fillInk = (p: Path2D, fill: string, w = lw) => { c.fillStyle = fill; c.fill(p); c.lineWidth = w; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke(p); };
  switch (e) {
    case 'star': { const p = new Path2D(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.45 : r; if (i) p.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else p.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } p.closePath(); fillInk(p, col); break; }
    case 'heart': fillInk(heart(x, y + r * 0.05, r * 2.1), col); break;
    case 'moon': {
      const p = new Path2D(); p.arc(x, y, r, Math.PI * 0.35, Math.PI * 1.65); p.arc(x + r * 0.45, y - r * 0.1, r * 0.78, Math.PI * 1.45, Math.PI * 0.55, true); p.closePath();
      fillInk(p, col);
      c.fillStyle = '#FFFFFF'; for (const [dx, dy, k] of [[1.0, -0.7, 0.3], [1.3, 0.4, 0.22]]) c.fill(twinkle(x + dx * r, y + dy * r, k * r));
      break;
    }
    case 'bolt': { const p = new Path2D(); p.moveTo(x + r * 0.2, y - r); p.lineTo(x - r * 0.55, y + r * 0.12); p.lineTo(x - r * 0.02, y + r * 0.12); p.lineTo(x - r * 0.22, y + r); p.lineTo(x + r * 0.6, y - r * 0.18); p.lineTo(x + r * 0.06, y - r * 0.18); p.closePath(); fillInk(p, col); break; }
    case 'daisy': {
      const p = new Path2D(); for (let i = 0; i < 7; i++) { const a = i * TAU / 7; p.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.42, r * 0.24, a, 0, TAU); }
      c.lineWidth = lw * 1.8; c.strokeStyle = INK; c.stroke(p); c.fillStyle = col; c.fill(p);
      const m = new Path2D(); circ(m, x, y, r * 0.34); fillInk(m, T('#FFC23D'));
      break;
    }
    case 'cloud': {
      const p = new Path2D(); for (const [dx, dy, k] of [[-0.45, 0.15, 0.45], [0.05, -0.15, 0.6], [0.5, 0.15, 0.45], [0, 0.3, 0.42]]) { p.moveTo(x + dx * r + k * r, y + dy * r); p.arc(x + dx * r, y + dy * r, k * r, 0, TAU); }
      c.lineWidth = lw * 1.8; c.strokeStyle = INK; c.stroke(p); c.fillStyle = col; c.fill(p);
      break;
    }
    case 'crown': {
      const p = new Path2D(); p.moveTo(x - r * 0.8, y + r * 0.55); p.lineTo(x - r * 0.9, y - r * 0.5); p.lineTo(x - r * 0.4, y); p.lineTo(x, y - r * 0.75); p.lineTo(x + r * 0.4, y); p.lineTo(x + r * 0.9, y - r * 0.5); p.lineTo(x + r * 0.8, y + r * 0.55); p.closePath();
      fillInk(p, col); c.fillStyle = '#FFFFFF'; c.beginPath(); circ(c, x, y + r * 0.2, r * 0.14); c.fill();
      break;
    }
    case 'comet': {
      const g = c.createLinearGradient(x - r * 1.6, y + r * 0.8, x, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
      c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = r * 0.5; c.beginPath(); c.moveTo(x - r * 1.5, y + r * 0.75); c.lineTo(x, y); c.stroke();
      const p = new Path2D(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.3 : r * 0.62; if (i) p.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else p.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } p.closePath();
      fillInk(p, col);
      break;
    }
    case 'paw': {
      const p = new Path2D(); p.ellipse(x, y + r * 0.3, r * 0.5, r * 0.4, 0, 0, TAU);
      for (const [dx, dy] of [[-0.62, -0.25], [-0.22, -0.62], [0.22, -0.62], [0.62, -0.25]]) { p.moveTo(x + dx * r + r * 0.2, y + dy * r); p.arc(x + dx * r, y + dy * r, r * 0.2, 0, TAU); }
      c.fillStyle = col; c.fill(p);
      break;
    }
    case 'lolly': {
      c.strokeStyle = INK; c.lineWidth = r * 0.18 + lw; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + r * 1.25); c.stroke();
      c.strokeStyle = '#FFFFFF'; c.lineWidth = r * 0.18; c.stroke();
      const disc = new Path2D(); circ(disc, x, y - r * 0.1, r * 0.8); fillInk(disc, '#FFFFFF');
      c.save(); c.clip(disc); c.strokeStyle = col; c.lineWidth = r * 0.22; c.beginPath();
      for (let a = 0; a < TAU * 2.2; a += 0.15) { const d = r * 0.08 + a * r * 0.055; c.lineTo(x + Math.cos(a) * d, y - r * 0.1 + Math.sin(a) * d); }
      c.stroke(); c.restore();
      break;
    }
    case 'gear': {
      const p = new Path2D(), n = 8;
      for (let i = 0; i < n * 2; i++) { const a0 = i / (n * 2) * TAU, a1 = (i + 1) / (n * 2) * TAU, d = i % 2 ? r * 0.72 : r; if (!i) p.moveTo(x + Math.cos(a0) * d, y + Math.sin(a0) * d); else p.lineTo(x + Math.cos(a0) * d, y + Math.sin(a0) * d); p.lineTo(x + Math.cos(a1) * d, y + Math.sin(a1) * d); }
      p.closePath(); fillInk(p, col);
      const hole = new Path2D(); circ(hole, x, y, r * 0.32); fillInk(hole, T('#5E6880'));
      break;
    }
    case 'flame': {
      const p = new Path2D(); p.moveTo(x, y + r); p.bezierCurveTo(x - r * 0.9, y + r * 0.9, x - r * 0.8, y - r * 0.1, x - r * 0.2, y - r);
      p.bezierCurveTo(x - r * 0.15, y - r * 0.4, x + r * 0.2, y - r * 0.3, x + r * 0.25, y - r * 0.7); p.bezierCurveTo(x + r * 0.9, y - r * 0.1, x + r * 0.8, y + r * 0.9, x, y + r); p.closePath();
      fillInk(p, col);
      const q = new Path2D(); q.moveTo(x, y + r * 0.85); q.bezierCurveTo(x - r * 0.45, y + r * 0.8, x - r * 0.4, y + r * 0.1, x - r * 0.05, y - r * 0.3); q.bezierCurveTo(x + r * 0.2, y + r * 0.1, x + r * 0.45, y + r * 0.8, x, y + r * 0.85); q.closePath();
      c.fillStyle = '#FFFFFF'; c.globalAlpha = 0.85; c.fill(q); c.globalAlpha = 1;
      break;
    }
    case 'none': break;
  }
}

/** Paint the flat cloth: `W` by `H` px, (0,0) at the top of the hoist. */
function paintCloth(c: Ctx, d: FlagDesign, W: number, H: number, pt: number, turn: number): void {
  const T = (h: string) => turnHex(h, turn), [field, acc, emb] = d.colors.map(T);
  const pts = clothPoints(d.shape, W, H), path = new Path2D();
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y))); path.closePath();
  c.save(); c.clip(path);
  c.fillStyle = field; c.fillRect(0, 0, W, H);
  switch (d.pattern) {
    case 'checks': { const g = H / 4; c.fillStyle = acc; for (let r = 0; r < 4; r++) for (let i = 0; i * g < W; i++) if ((i + r) % 2) c.fillRect(i * g, r * g, g, g); break; }
    case 'border': c.strokeStyle = acc; c.lineWidth = H * 0.16; c.stroke(path); break;
    case 'hoist': c.fillStyle = acc; c.fillRect(0, 0, W * 0.16, H); break;
    case 'waves': {
      c.fillStyle = acc;
      for (const [y0, k] of [[0.62, 1], [0.84, 0.8]] as [number, number][]) { c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 2) c.lineTo(x, H * y0 + Math.sin(x / W * TAU * 2) * H * 0.06 * k); c.lineTo(W, H); c.closePath(); c.globalAlpha = k * 0.9; c.fill(); }
      c.globalAlpha = 1;
      break;
    }
    case 'quarters': { c.fillStyle = acc; c.fillRect(W / 2, 0, W / 2, H / 2); c.fillStyle = emb; c.fillRect(0, H / 2, W / 2, H / 2); c.fillStyle = T('#5ED15A'); c.fillRect(W / 2, H / 2, W / 2, H / 2); break; }
    case 'candy': { c.fillStyle = acc; c.globalAlpha = 0.7; for (let x = -H; x < W + H; x += H * 0.5) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + H * 0.2, H); c.lineTo(x + H * 1.2, 0); c.lineTo(x + H, 0); c.closePath(); c.fill(); } c.globalAlpha = 1; break; }
    case 'rivets': { c.strokeStyle = acc; c.lineWidth = 1.2 * pt; c.strokeRect(H * 0.12, H * 0.12, W - H * 0.24, H * 0.76); c.fillStyle = acc; for (const [x, y] of [[0.2, 0.2], [W / H - 0.2, 0.2], [0.2, 0.8], [W / H - 0.2, 0.8]]) { c.beginPath(); circ(c, x * H, y * H, H * 0.05); c.fill(); } break; }
    case 'scales': { c.strokeStyle = acc; c.lineWidth = 1.2 * pt; const g = H * 0.28; for (let r = 0, y = 0; y < H + g; r++, y += g * 0.6) for (let x = -g + (r % 2) * g / 2; x < W + g; x += g) { c.beginPath(); c.arc(x + g / 2, y, g / 2, 0, Math.PI); c.stroke(); } break; }
    case 'solid': break;
  }
  // Light along the top edge, shade along the bottom.
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, 0, W, H * 0.12);
  c.fillStyle = 'rgba(34,24,58,0.12)'; c.fillRect(0, H * 0.88, W, H * 0.12);
  emblem(c, d.emblem, W * EMBLEM_AT[d.shape], H / 2, H * 0.3, emb, T, 1.4 * pt);
  c.restore();
}

/**
 * Draw a styled flag with the pole's foot at the origin, `s` px per block: pole `pole` blocks tall, cloth
 * `cloth` blocks, wave `phase` (radians). Same footprint as the gold flag.
 */
export function drawStyledFlag(c: Ctx, s: number, pt: number, pole: number, cloth: [number, number], look: FlagLook, phase: number): void {
  const d: FlagDesign = FLAG_DESIGNS[look.kind], [cw, ch] = cloth, top = -pole * s, amp = 0.06 * s;
  const W = Math.ceil(cw * s), H = Math.ceil(ch * s), x0 = 0.05 * s, y0 = top + 0.06 * s;
  const wave = (x: number) => Math.sin(phase + (x / W) * Math.PI * 1.6) * amp * (x / W);
  // Pole.
  rr(c, -0.05 * s, top, 0.1 * s, pole * s, 0.05 * s); c.fillStyle = '#FFF7E8'; c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke();
  // Cloth: painted flat, laid down in strips along the wave.
  const flat = makeCanvas(W, H);
  paintCloth(ctx2d(flat), d, W, H, pt, look.turn);
  const strip = Math.max(1, Math.round(pt * 1.5));
  for (let x = 0; x < W; x += strip) { const sw = Math.min(strip + 1, W - x); c.drawImage(flat, x, 0, sw, H, x0 + x, y0 + wave(x + strip / 2), sw, H); }
  // Outline: the cloth's points, densified so the edges wave too.
  const pts = clothPoints(d.shape, W, H), out = new Path2D();
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (4 * pt)));
    for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n; if (!i && !k) out.moveTo(x0 + x, y0 + y + wave(x)); else out.lineTo(x0 + x, y0 + y + wave(x)); }
  }
  out.closePath();
  c.lineJoin = 'round'; c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke(out);
  // Finial.
  c.beginPath(); circ(c, 0, top, 0.1 * s); c.fillStyle = turnHex(d.finial ?? SIGNAL.gold, look.turn); c.fill(); c.lineWidth = 1.8 * pt; c.strokeStyle = INK; c.stroke();
}
