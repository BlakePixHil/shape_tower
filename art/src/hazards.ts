// Hazard textures for the space biomes (art-direction.md §6.3, §9.4). Telegraphs are amber with an Ink
// edge, like the HUD's hazard chip: the target reticle and the trajectory dashes for space junk and
// meteors, the faint incoming-angle streak for meteors, and the dust devil's swirl marker. Hazard
// objects are gameplay objects, so they get the Ink outline: the junk (a bolt, a solar-panel shard, a
// wrench) with its blinking light, and the meteor with its trail. The dust devil's column is weather and
// has none. Sizes are in blocks (HAZARD); everything is centred unless noted.

import { INK, SIGNAL } from './config.ts';
import type { Baked } from './piece.ts';
import { bakeDustDevil } from './space.ts';
import { O, ink, part, rrPath } from './sticker.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from './util.ts';

/** Natural size of each texture in blocks, [width, height] (padding for the outline comes on top). */
export const HAZARD = {
  reticle: [1.8, 1.8],
  dash: [0.5, 0.2],
  bolt: [1.0, 0.56],
  panel: [1.15, 0.8],
  wrench: [1.3, 0.5],
  blink: [0.6, 0.6],
  meteor: [0.5, 0.5],
  trail: [2.8, 0.42],
  incoming: [6, 0.14],
  swirl: [2.4, 2.4],
  column: [3.2, 5.9],
} as const;

export const JUNK_KINDS = ['bolt', 'panel', 'wrench'] as const;
export type JunkKind = (typeof JUNK_KINDS)[number];
/** Frames in the dust devil column's loop. */
export const COLUMN_FRAMES = 3;
export type HazardTex = Exclude<keyof typeof HAZARD, 'column'> | `column${0 | 1 | 2}`;
export const HAZARD_TEX: HazardTex[] = [
  'reticle', 'dash', 'bolt', 'panel', 'wrench', 'blink', 'meteor', 'trail', 'incoming', 'swirl', 'column0', 'column1', 'column2',
];

const STEEL = ['#AEB4C6', '#E3E7F2', '#737A92'] as const;
const AMBER = SIGNAL.amber;

/** Stroke a path twice: a wide Ink edge, then the color on top. Widths in blocks. */
function edged(c: Ctx, p: Path2D, color: string, w: number, edge = 0.07): void {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.lineWidth = w + edge * 2; c.strokeStyle = INK; c.stroke(p);
  c.lineWidth = w; c.strokeStyle = color; c.stroke(p);
}

function reticle(c: Ctx): void {
  const r = 0.62, glow = c.createRadialGradient(0, 0, 0, 0, 0, r);
  glow.addColorStop(0, 'rgba(255,170,43,0.08)'); glow.addColorStop(1, 'rgba(255,170,43,0.28)');
  c.fillStyle = glow; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  const ring = new Path2D(); ring.arc(0, 0, r, 0, TAU);
  edged(c, ring, AMBER, 0.11);
  // Four ticks that cross the ring, and a dot in the middle.
  const ticks = new Path2D();
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4, cs = Math.cos(a), sn = Math.sin(a);
    ticks.moveTo(cs * (r - 0.2), sn * (r - 0.2)); ticks.lineTo(cs * (r + 0.26), sn * (r + 0.26));
  }
  edged(c, ticks, AMBER, 0.12);
  const dot = new Path2D(); dot.arc(0, 0, 0.09, 0, TAU);
  c.fillStyle = AMBER; c.fill(dot); ink(c, dot, 0.06);
  // A white glint on the ring so it reads on a dark sky too.
  c.lineWidth = 0.04; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(0, 0, r, -2.4, -1.7); c.stroke();
}

function bolt(c: Ctx): void {
  // Threaded shaft to the right, hex head on the left.
  const shaft = rrPath(-0.18, -0.11, 0.68, 0.22, 0.05);
  part(c, shaft, STEEL[0], STEEL[1], STEEL[2], 0.04);
  c.save(); c.clip(shaft); c.strokeStyle = 'rgba(34,24,58,0.45)'; c.lineWidth = 0.035;
  for (let x = -0.08; x < 0.5; x += 0.09) { c.beginPath(); c.moveTo(x, -0.12); c.lineTo(x + 0.05, 0.12); c.stroke(); }
  c.restore();
  const head = new Path2D();
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6, x = -0.3 + Math.cos(a) * 0.17, y = Math.sin(a) * 0.25; if (i) head.lineTo(x, y); else head.moveTo(x, y); }
  head.closePath();
  part(c, head, STEEL[0], STEEL[1], STEEL[2], 0.05);
  c.fillStyle = 'rgba(34,24,58,0.35)'; c.beginPath(); c.arc(-0.3, 0, 0.06, 0, TAU); c.fill();
}

function panel(c: Ctx): void {
  // A shard of solar panel: a silver frame, blue cells, one torn edge.
  const p = new Path2D();
  p.moveTo(-0.52, -0.32); p.lineTo(0.3, -0.32); p.lineTo(0.38, -0.16); p.lineTo(0.3, -0.04); p.lineTo(0.46, 0.08);
  p.lineTo(0.36, 0.2); p.lineTo(0.42, 0.32); p.lineTo(-0.52, 0.32); p.closePath();
  part(c, p, '#C9CCD8', '#EEF0F7', '#8C91A6', 0.04);
  c.save(); c.clip(p);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const cell = rrPath(-0.45 + i * 0.24, -0.25 + j * 0.26, 0.2, 0.22, 0.03);
    c.fillStyle = (i + j) % 2 ? '#2E58C9' : '#3D6FE0'; c.fill(cell);
    c.fillStyle = 'rgba(160,196,255,0.55)'; c.fillRect(-0.43 + i * 0.24, -0.23 + j * 0.26, 0.07, 0.03);
  }
  c.restore();
  ink(c, p, O);
}

function wrench(c: Ctx): void {
  // Ring end on the left, open jaw on the right. Edge first at double width, then the fill covers the inner edges.
  const R = 0.23, jx = 0.4, a = 0.42, ring = 0.17;
  const jaw = new Path2D(); jaw.moveTo(jx + Math.cos(a) * R, Math.sin(a) * R); jaw.arc(jx, 0, R, a, TAU - a); jaw.lineTo(jx + 0.03, -0.085); jaw.lineTo(jx + 0.03, 0.085); jaw.closePath();
  const shaft = rrPath(-0.48, -0.08, 0.8, 0.16, 0.06), end = new Path2D(); end.arc(-0.48, 0, ring, 0, TAU);
  c.lineJoin = 'round'; c.lineWidth = O * 2; c.strokeStyle = INK;
  for (const q of [jaw, shaft, end]) c.stroke(q);
  for (const q of [jaw, shaft, end]) { c.fillStyle = STEEL[0]; c.fill(q); }
  c.fillStyle = STEEL[1]; c.fillRect(-0.42, -0.07, 0.7, 0.04);
  c.fillStyle = STEEL[2]; c.fillRect(-0.4, 0.035, 0.68, 0.035);
  c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(-0.48, 0, 0.07, 0, TAU); c.fill(); c.restore();
  c.lineWidth = O; c.strokeStyle = INK; c.beginPath(); c.arc(-0.48, 0, 0.07, 0, TAU); c.stroke();
}

function blink(c: Ctx): void {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.3);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.22, '#FFE1E6'); g.addColorStop(0.4, 'rgba(255,77,109,0.75)'); g.addColorStop(1, 'rgba(255,77,109,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 0.3, 0, TAU); c.fill();
}

function meteor(c: Ctx): void {
  const glow = c.createRadialGradient(0, 0, 0.08, 0, 0, 0.25);
  glow.addColorStop(0, 'rgba(255,154,61,0.75)'); glow.addColorStop(1, 'rgba(255,154,61,0)');
  c.fillStyle = glow; c.beginPath(); c.arc(0, 0, 0.25, 0, TAU); c.fill();
  const p = new Path2D();
  for (let i = 0; i < 9; i++) { const a = i * TAU / 9, r = 0.15 + 0.035 * (hash(i * 3.7) - 0.5); if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r); else p.moveTo(r, 0); }
  p.closePath();
  part(c, p, '#8A6A5C', '#C08F78', '#5E4438', 0.035);
  // The hot side faces the way it flies (+x).
  c.save(); c.clip(p); c.fillStyle = 'rgba(255,190,90,0.55)'; c.beginPath(); c.arc(0.12, 0, 0.12, 0, TAU); c.fill(); c.restore();
  ink(c, p, 0.05);
}

function trail(c: Ctx, w: number): void {
  // Tail at the left, head at x = 0.9 w, where the meteor sits.
  const hx = w * 0.9, p = new Path2D();
  p.moveTo(0, 0); p.quadraticCurveTo(hx * 0.6, -0.1, hx, -0.16); p.arc(hx, 0, 0.16, -Math.PI / 2, Math.PI / 2); p.quadraticCurveTo(hx * 0.6, 0.1, 0, 0); p.closePath();
  const g = c.createLinearGradient(0, 0, hx + 0.16, 0);
  g.addColorStop(0, 'rgba(255,122,46,0)'); g.addColorStop(0.55, 'rgba(255,122,46,0.55)'); g.addColorStop(0.85, 'rgba(255,210,122,0.9)'); g.addColorStop(1, '#FFFFFF');
  c.fillStyle = g; c.fill(p);
}

function incoming(c: Ctx, w: number): void {
  // From the target (x = 0) out along +x: dashes that fade toward the sky end.
  c.lineCap = 'round';
  for (let x = 0.3; x < w - 0.2; x += 0.42) {
    const a = 1 - 0.85 * (x / w);
    c.strokeStyle = `rgba(255,255,255,${a})`; c.lineWidth = 0.08;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 0.22, 0); c.stroke();
  }
}

function swirl(c: Ctx): void {
  // A dashed ring turning counter-clockwise (flip x for clockwise), two arrowheads and a little dust inside.
  c.strokeStyle = 'rgba(214,140,104,0.55)'; c.lineWidth = 0.05; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, 0.28 + i * 0.16, i * 2.1, i * 2.1 + 2.4); c.stroke(); }
  const r = 0.9, n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = a0 + (TAU / n) * 0.55, p = new Path2D(); p.arc(0, 0, r, a0, a1);
    edged(c, p, AMBER, 0.11);
    if (i % 4 === 0) {
      // Arrowhead at the dash's leading end (counter-clockwise on screen = decreasing angle).
      const cs = Math.cos(a0), sn = Math.sin(a0), tx = sn, ty = -cs, h = new Path2D();
      h.moveTo(cs * r + tx * 0.2, sn * r + ty * 0.2); h.lineTo(cs * (r + 0.15), sn * (r + 0.15)); h.lineTo(cs * (r - 0.15), sn * (r - 0.15)); h.closePath();
      c.fillStyle = AMBER; c.fill(h); ink(c, h, 0.05);
    }
  }
}

/** Bake hazard texture `name` at `s` px per block. Origin: centre, except the trail (its head) and the incoming streak (its target end). */
export function bakeHazard(name: HazardTex, s: number): Baked {
  if (name.startsWith('column')) {
    // Two layers of the far dust devil, closer and thicker. Origin: the foot of the column.
    const u = s * HAZARD.column[0] / 1.4, f = Number(name.slice(-1)), one = bakeDustDevil(f, u, 1), cv = makeCanvas(one.width, one.height), c = ctx2d(cv);
    c.drawImage(one, 0, 0); c.drawImage(one, 0, 0); c.globalAlpha = 0.6; c.drawImage(one, 0, 0);
    return { canvas: cv, originX: 0.5, originY: (one.height - u * 0.12) / one.height, s };
  }
  const [bw, bh] = HAZARD[name as keyof typeof HAZARD], pad = Math.ceil(0.12 * s);
  const cv = makeCanvas(Math.ceil(bw * s + pad * 2), Math.ceil(bh * s + pad * 2)), c = ctx2d(cv);
  let ox = 0.5, oy = 0.5;
  if (name === 'trail') { c.translate(pad, cv.height / 2); ox = (pad + bw * 0.9 * s) / cv.width; }
  else if (name === 'incoming') { c.translate(pad, cv.height / 2); ox = pad / cv.width; }
  else c.translate(cv.width / 2, cv.height / 2);
  c.scale(s, s);
  if (name === 'dash') { const p = rrPath(-0.15, -0.055, 0.3, 0.11, 0.055); c.fillStyle = AMBER; c.fill(p); ink(c, p, 0.045); }
  else if (name === 'reticle') reticle(c);
  else if (name === 'bolt') bolt(c);
  else if (name === 'panel') panel(c);
  else if (name === 'wrench') wrench(c);
  else if (name === 'blink') blink(c);
  else if (name === 'meteor') meteor(c);
  else if (name === 'trail') trail(c, bw);
  else if (name === 'incoming') incoming(c, bw);
  else if (name === 'swirl') swirl(c);
  return { canvas: cv, originX: ox, originY: oy, s };
}

/** Where each junk kind's blinking light sits, in blocks from its centre. */
export const JUNK_LIGHT: Record<JunkKind, [number, number]> = { bolt: [-0.3, 0], panel: [-0.4, -0.25], wrench: [-0.48, 0] };
