// Avatar hats (art-direction.md §8.4, §9.6: "avatar builder parts, about 6 hats to start"). Stickers like
// the icons: flat fills, a light lip on top, a shade lip below and the Ink outline. Each draws in units
// of its base width with the origin at the middle of its base (where it sits on the head), y up negative.
// Levels give the first six (HATS); the Builder's Pass, the Workshop sets and the Supporter Pack give the
// rest (cosmetics.ts). A hat's key travels to the Daily ladder, so keys are letters and underscores only:
// a later variant is its base key plus a Roman numeral ('hardhat_ii'), drawn with its hues turned. A
// key this copy doesn't know draws nothing.

import { INK } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { circlePath, heart, ink, part, rrPath, twinkle } from '../sticker.ts';
import { type Ctx, TAU, cpuBaked, ctx2d, makeCanvas, roman, turnCanvas, variantTurn } from '../util.ts';

/** The level hats, then the Builder's Pass hats, the Workshop sets' hats and the Supporter Pack's. */
export type HatKey =
  | 'party' | 'cap' | 'propeller' | 'daisies' | 'tophat' | 'crown'
  | 'hardhat' | 'beanie' | 'wizard' | 'chef' | 'pirate' | 'viking' | 'beret' | 'bunny' | 'halo' | 'cowboy' | 'gradcap'
  | 'cupcake' | 'robot' | 'horns' | 'heart_crown';
/** A hat key, or a later variant of one: the key plus a lower-case Roman numeral ('hardhat_ii'). */
export type Hat = HatKey | `${HatKey}_${string}`;

export interface HatInfo { key: Hat; name: string; /** Profile level that unlocks it (0: not a level reward; see cosmetics.ts). */ level: number; /** Height over base width. */ h: number }

/** The hats in unlock order. The party hat comes with every profile. */
export const HATS: HatInfo[] = [
  { key: 'party', name: 'Party hat', level: 1, h: 1.02 },
  { key: 'cap', name: 'Sky cap', level: 4, h: 0.56 },
  { key: 'propeller', name: 'Propeller beanie', level: 7, h: 0.86 },
  { key: 'daisies', name: 'Daisy chain', level: 9, h: 0.36 },
  { key: 'tophat', name: 'Top hat', level: 12, h: 0.86 },
  { key: 'crown', name: 'Crown', level: 16, h: 0.66 },
];

/** Every hat: the level hats, then the rest (cosmetics.ts says what unlocks each). */
export const ALL_HATS: HatInfo[] = [
  ...HATS,
  { key: 'hardhat', name: 'Hard hat', level: 0, h: 0.62 },
  { key: 'beanie', name: 'Bobble beanie', level: 0, h: 0.8 },
  { key: 'wizard', name: 'Wizard hat', level: 0, h: 1.2 },
  { key: 'chef', name: "Chef's hat", level: 0, h: 0.95 },
  { key: 'pirate', name: 'Pirate hat', level: 0, h: 0.56 },
  { key: 'viking', name: 'Viking helmet', level: 0, h: 0.62 },
  { key: 'beret', name: 'Beret', level: 0, h: 0.42 },
  { key: 'bunny', name: 'Bunny ears', level: 0, h: 1.1 },
  { key: 'halo', name: 'Halo', level: 0, h: 0.5 },
  { key: 'cowboy', name: 'Cowboy hat', level: 0, h: 0.56 },
  { key: 'gradcap', name: 'Grad cap', level: 0, h: 0.62 },
  { key: 'cupcake', name: 'Cupcake', level: 0, h: 1.0 },
  { key: 'robot', name: 'Robot antenna', level: 0, h: 0.95 },
  { key: 'horns', name: 'Dragon horns', level: 0, h: 0.72 },
  { key: 'heart_crown', name: 'Heart crown', level: 0, h: 0.7 },
];

const INFO = new Map<string, HatInfo>(ALL_HATS.map(h => [h.key, h]));

/** A hat's base key and variant (0 = as drawn), or null for a key this copy doesn't know. */
export function hatVariant(hat: string): [HatKey, number] | null {
  if (INFO.has(hat)) return [hat as HatKey, 0];
  const i = hat.lastIndexOf('_'), base = hat.slice(0, i), num = hat.slice(i + 1);
  if (i < 1 || !INFO.has(base) || !/^[ivxlcdm]+$/.test(num)) return null;
  for (let n = 2; n < 4000; n++) if (roman(n).toLowerCase() === num) return [base as HatKey, n - 1];
  return null;
}

/** What a hat key stands for (a variant gets its base's shape and a numbered name), or undefined if unknown. */
export function hatInfo(hat: string | null | undefined): HatInfo | undefined {
  const hv = hat ? hatVariant(hat) : null;
  if (!hv) return undefined;
  const b = INFO.get(hv[0])!;
  return hv[1] ? { ...b, key: hat as Hat, name: `${b.name} ${roman(hv[1] + 1)}` } : b;
}

/** The key of variant `v` of `base` (0: the base itself). */
export const hatKey = (base: HatKey, v = 0): Hat => (v ? `${base}_${roman(v + 1).toLowerCase()}` as Hat : base);

const O = 0.085;
const C = (k: string): [string, string, string] => { const s = ART_SHAPES[k]; return [s.base, s.light, s.shade]; };
const GOLD: [string, string, string] = ['#FFC23D', '#FFE69A', '#E0961A'];

function party(c: Ctx): void {
  const cone = new Path2D(); cone.moveTo(-0.42, 0); cone.quadraticCurveTo(-0.1, -0.5, 0.06, -0.9); cone.lineTo(0.42, 0); cone.closePath();
  part(c, cone, ...C('T'));
  // Gold stripes across the cone, clipped to it.
  c.save(); c.clip(cone); c.strokeStyle = GOLD[0]; c.lineWidth = 0.1;
  for (const y of [-0.2, -0.5]) { c.beginPath(); c.moveTo(-0.6, y + 0.12); c.lineTo(0.6, y - 0.12); c.stroke(); }
  c.restore();
  ink(c, cone, O);
  const pom = circlePath(0.06, -0.92, 0.12);
  part(c, pom, '#FFFFFF', '#FFFFFF', '#DCE6F7', 0.04); ink(c, pom, O);
}

function cap(c: Ctx): void {
  const brim = new Path2D(); brim.moveTo(0.1, -0.02); brim.quadraticCurveTo(0.6, -0.16, 0.84, -0.04); brim.quadraticCurveTo(0.7, 0.06, 0.1, 0.06); brim.closePath();
  const [base, light, shade] = C('J');
  part(c, brim, shade, base, shade, 0.03);
  const dome = new Path2D(); dome.moveTo(-0.45, 0.02); dome.bezierCurveTo(-0.45, -0.66, 0.45, -0.66, 0.45, 0.02); dome.closePath();
  part(c, dome, base, light, shade);
  c.save(); c.clip(dome); c.strokeStyle = 'rgba(34,24,58,0.35)'; c.lineWidth = 0.035;
  c.beginPath(); c.moveTo(0, -0.5); c.quadraticCurveTo(-0.08, -0.25, -0.05, 0.05); c.stroke(); c.restore();
  ink(c, dome, O);
  const button = circlePath(0, -0.5, 0.07); c.fillStyle = shade; c.fill(button); ink(c, button, O * 0.7);
}

function propeller(c: Ctx): void {
  const dome = new Path2D(); dome.moveTo(-0.44, 0.02); dome.bezierCurveTo(-0.44, -0.6, 0.44, -0.6, 0.44, 0.02); dome.closePath();
  // Four panels in four shape colors.
  c.save(); c.clip(dome);
  const cols = [C('Z')[0], C('O')[0], C('J')[0], C('S')[0]];
  cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(-0.44 + i * 0.22, -0.7, 0.22, 0.8); });
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(-0.5, -0.7, 1, 0.12);
  c.fillStyle = 'rgba(34,24,58,0.18)'; c.fillRect(-0.5, -0.04, 1, 0.1);
  c.restore(); ink(c, dome, O);
  const stem = rrPath(-0.035, -0.62, 0.07, 0.2, 0.03); c.fillStyle = '#AEB4C6'; c.fill(stem); ink(c, stem, O * 0.7);
  for (const [dx, col] of [[-1, C('Z')], [1, C('O')]] as [number, [string, string, string]][]) {
    const blade = new Path2D(); blade.ellipse(dx * 0.22, -0.66, 0.22, 0.07, dx * -0.12, 0, TAU);
    part(c, blade, ...col, 0.02); ink(c, blade, O * 0.8);
  }
  const hub = circlePath(0, -0.66, 0.06); c.fillStyle = GOLD[0]; c.fill(hub); ink(c, hub, O * 0.7);
}

function daisies(c: Ctx): void {
  const vine = new Path2D(); vine.moveTo(-0.5, -0.04); vine.quadraticCurveTo(0, -0.2, 0.5, -0.04);
  c.lineCap = 'round'; c.lineWidth = 0.1 + O; c.strokeStyle = INK; c.stroke(vine);
  c.lineWidth = 0.1; c.strokeStyle = C('S')[0]; c.stroke(vine);
  for (const [x, y, r, rot] of [[-0.42, -0.08, 0.13, 0.2], [-0.15, -0.16, 0.15, 0.7], [0.15, -0.16, 0.15, 0.3], [0.42, -0.08, 0.13, 0.9]]) {
    const petals = new Path2D();
    for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6; petals.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.5, r * 0.3, a, 0, TAU); }
    ink(c, petals, O * 1.6); c.fillStyle = '#FFFFFF'; c.fill(petals);
    const mid = circlePath(x, y, r * 0.38); c.fillStyle = GOLD[0]; c.fill(mid); ink(c, mid, O * 0.6);
  }
}

function tophat(c: Ctx): void {
  const crown = rrPath(-0.3, -0.84, 0.6, 0.78, 0.06);
  part(c, crown, '#4A3A78', '#6D5BA3', '#2E2350');
  const band = new Path2D(); band.rect(-0.3, -0.26, 0.6, 0.14);
  c.save(); c.clip(crown); c.fillStyle = C('Z')[0]; c.fill(band); c.restore();
  ink(c, crown, O);
  const brim = rrPath(-0.5, -0.1, 1.0, 0.13, 0.065);
  part(c, brim, '#4A3A78', '#6D5BA3', '#2E2350', 0.03); ink(c, brim, O);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(-0.2, -0.76, 0.06, 0.44);
}

function crown(c: Ctx): void {
  const p = new Path2D();
  p.moveTo(-0.4, 0); p.lineTo(-0.44, -0.5); p.lineTo(-0.2, -0.28); p.lineTo(0, -0.58); p.lineTo(0.2, -0.28); p.lineTo(0.44, -0.5); p.lineTo(0.4, 0); p.closePath();
  part(c, p, ...GOLD);
  for (const [x, y] of [[-0.44, -0.52], [0, -0.6], [0.44, -0.52]]) { const b = circlePath(x, y, 0.06); part(c, b, ...GOLD, 0.02); ink(c, b, O * 0.7); }
  for (const [x, col] of [[-0.22, C('Z')], [0, C('J')], [0.22, C('S')]] as [number, [string, string, string]][]) {
    const g = new Path2D(); g.moveTo(x, -0.2); g.lineTo(x + 0.07, -0.12); g.lineTo(x, -0.04); g.lineTo(x - 0.07, -0.12); g.closePath();
    c.fillStyle = col[0]; c.fill(g); ink(c, g, O * 0.6);
  }
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-0.3, -0.18, 0.03, 0.08, 0.2, 0, TAU); c.fill();
}


const ROSE: [string, string, string] = ['#F7A6B8', '#FFD3DC', '#D9708A'];
const STEEL: [string, string, string] = ['#B9C2D6', '#E4E9F2', '#7D879E'];
const CREAM: [string, string, string] = ['#FFF3D6', '#FFFFFF', '#E3CFA3'];
const DARK: [string, string, string] = ['#3A2E5C', '#5A4C85', '#231A3D'];

function dome(r: number, top: number): Path2D {
  const p = new Path2D(); p.moveTo(-r, 0.02); p.bezierCurveTo(-r, top, r, top, r, 0.02); p.closePath(); return p;
}

function hardhat(c: Ctx): void {
  const d = dome(0.42, -0.74); part(c, d, ...C('O'));
  const ridge = rrPath(-0.07, -0.53, 0.14, 0.5, 0.06); c.save(); c.clip(d); c.fillStyle = C('O')[1]; c.fill(ridge); c.restore();
  c.lineWidth = 0.035; c.strokeStyle = 'rgba(34,24,58,0.35)'; c.stroke(ridge); ink(c, d, O);
  const brim = rrPath(-0.54, -0.1, 1.08, 0.15, 0.075); part(c, brim, ...C('O'), 0.03); ink(c, brim, O);
}

function beanie(c: Ctx): void {
  const d = dome(0.44, -0.78); part(c, d, ...C('Z'));
  c.save(); c.clip(d); c.strokeStyle = 'rgba(34,24,58,0.22)'; c.lineWidth = 0.04;
  for (let x = -0.36; x <= 0.37; x += 0.12) { c.beginPath(); c.moveTo(x, -0.1); c.quadraticCurveTo(x * 0.7, -0.4, x * 0.3, -0.6); c.stroke(); }
  c.restore(); ink(c, d, O);
  const cuff = rrPath(-0.48, -0.2, 0.96, 0.24, 0.08); part(c, cuff, '#FFFFFF', '#FFFFFF', '#DCE6F7', 0.03);
  c.save(); c.clip(cuff); c.strokeStyle = 'rgba(34,24,58,0.18)'; c.lineWidth = 0.03;
  for (let x = -0.42; x < 0.48; x += 0.09) { c.beginPath(); c.moveTo(x, -0.18); c.lineTo(x, 0.02); c.stroke(); }
  c.restore(); ink(c, cuff, O);
  const pom = new Path2D();
  for (let i = 0; i < 9; i++) { const a = i * TAU / 9; pom.moveTo(Math.cos(a) * 0.15, -0.74 + Math.sin(a) * 0.15); pom.arc(Math.cos(a) * 0.1, -0.74 + Math.sin(a) * 0.1, 0.07, 0, TAU); }
  pom.addPath(circlePath(0, -0.74, 0.12));
  ink(c, pom, O * 1.8); c.fillStyle = C('Z')[1]; c.fill(pom);
}

function wizard(c: Ctx): void {
  const cone = new Path2D(); cone.moveTo(-0.34, -0.06); cone.bezierCurveTo(-0.2, -0.5, -0.02, -0.9, 0.3, -1.12); cone.quadraticCurveTo(0.12, -0.7, 0.34, -0.06); cone.closePath();
  part(c, cone, ...C('T'));
  c.fillStyle = GOLD[0];
  for (const [x, y, r] of [[-0.08, -0.36, 0.08], [0.12, -0.62, 0.06], [0.16, -0.2, 0.05]]) { const t = twinkle(x, y, r); c.fill(t); ink(c, t, O * 0.5); }
  const moon = new Path2D(); moon.arc(-0.02, -0.12, 0.07, 0, TAU); moon.arc(0.02, -0.14, 0.06, 0, TAU, true);
  c.fill(moon, 'evenodd');
  ink(c, cone, O);
  const brim = new Path2D(); brim.ellipse(0, -0.04, 0.56, 0.1, 0, 0, TAU); part(c, brim, ...C('T'), 0.03); ink(c, brim, O);
}

function chef(c: Ctx): void {
  const puffs = new Path2D();
  for (const [x, y, r] of [[-0.24, -0.5, 0.22], [0.24, -0.5, 0.22], [0, -0.68, 0.26]]) puffs.addPath(circlePath(x, y, r));
  puffs.addPath(rrPath(-0.36, -0.52, 0.72, 0.36, 0.06));
  ink(c, puffs, O * 2); c.fillStyle = '#FFFFFF'; c.fill(puffs);
  c.strokeStyle = 'rgba(34,24,58,0.2)'; c.lineWidth = 0.035;
  for (const x of [-0.12, 0.12]) { c.beginPath(); c.moveTo(x, -0.48); c.quadraticCurveTo(x * 1.2, -0.38, x, -0.22); c.stroke(); }
  const band = rrPath(-0.36, -0.22, 0.72, 0.22, 0.04); part(c, band, '#FFFFFF', '#FFFFFF', '#DCE6F7', 0.03); ink(c, band, O);
}

function pirate(c: Ctx): void {
  const hat = new Path2D(); hat.moveTo(-0.58, -0.08); hat.quadraticCurveTo(-0.42, -0.6, 0, -0.56); hat.quadraticCurveTo(0.42, -0.6, 0.58, -0.08);
  hat.quadraticCurveTo(0, -0.22, -0.58, -0.08); hat.closePath();
  part(c, hat, ...DARK);
  c.save(); c.clip(hat); c.strokeStyle = GOLD[0]; c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.6, -0.1); c.quadraticCurveTo(0, -0.26, 0.6, -0.1); c.stroke(); c.restore();
  ink(c, hat, O);
  // A friendly skull and crossbones.
  c.strokeStyle = '#FFFFFF'; c.lineWidth = 0.05; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-0.12, -0.24); c.lineTo(0.12, -0.44); c.moveTo(0.12, -0.24); c.lineTo(-0.12, -0.44); c.stroke();
  const sk = new Path2D(); sk.arc(0, -0.38, 0.09, Math.PI * 0.85, Math.PI * 2.15); sk.lineTo(0.05, -0.28); sk.lineTo(-0.05, -0.28); sk.closePath();
  c.fillStyle = '#FFFFFF'; c.fill(sk); ink(c, sk, O * 0.5);
  c.fillStyle = INK; for (const x of [-0.035, 0.035]) { c.beginPath(); c.arc(x, -0.37, 0.022, 0, TAU); c.fill(); }
}

function viking(c: Ctx): void {
  for (const sx of [-1, 1]) {
    const horn = new Path2D(); horn.moveTo(sx * 0.34, -0.22); horn.quadraticCurveTo(sx * 0.62, -0.26, sx * 0.66, -0.62); horn.quadraticCurveTo(sx * 0.48, -0.4, sx * 0.3, -0.38); horn.closePath();
    part(c, horn, ...CREAM, 0.03); ink(c, horn, O);
  }
  const d = dome(0.42, -0.72); part(c, d, ...STEEL);
  c.save(); c.clip(d); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(-0.24, -0.6, 0.08, 0.5); c.restore(); ink(c, d, O);
  const band = rrPath(-0.45, -0.16, 0.9, 0.18, 0.05); part(c, band, ...GOLD, 0.03); ink(c, band, O);
  c.fillStyle = GOLD[2]; for (const x of [-0.3, -0.1, 0.1, 0.3]) { c.beginPath(); c.arc(x, -0.07, 0.025, 0, TAU); c.fill(); }
}

function beret(c: Ctx): void {
  const b = new Path2D(); b.moveTo(-0.46, -0.04); b.bezierCurveTo(-0.62, -0.38, 0.3, -0.48, 0.56, -0.16); b.quadraticCurveTo(0.5, 0.02, 0.38, 0.02); b.lineTo(-0.4, 0.02); b.closePath();
  part(c, b, ...C('J')); ink(c, b, O);
  const stalk = rrPath(-0.03, -0.46, 0.06, 0.12, 0.03); c.fillStyle = C('J')[2]; c.fill(stalk); ink(c, stalk, O * 0.7);
  const band = rrPath(-0.42, -0.06, 0.82, 0.08, 0.04); c.fillStyle = C('J')[2]; c.fill(band); ink(c, band, O * 0.8);
}

function bunny(c: Ctx): void {
  for (const [x, rot] of [[-0.18, -0.16], [0.18, 0.2]] as [number, number][]) {
    c.save(); c.translate(x, -0.1); c.rotate(rot);
    const ear = new Path2D(); ear.ellipse(0, -0.48, 0.15, 0.46, 0, 0, TAU);
    part(c, ear, '#FFFFFF', '#FFFFFF', '#DCE6F7', 0.04);
    const inner = new Path2D(); inner.ellipse(0, -0.46, 0.07, 0.34, 0, 0, TAU); c.fillStyle = ROSE[0]; c.fill(inner);
    ink(c, ear, O); c.restore();
  }
  const band = new Path2D(); band.moveTo(-0.46, 0.02); band.quadraticCurveTo(0, -0.24, 0.46, 0.02); band.lineTo(0.4, 0.06); band.quadraticCurveTo(0, -0.14, -0.4, 0.06); band.closePath();
  part(c, band, ...C('Domino'), 0.02); ink(c, band, O);
}

function halo(c: Ctx): void {
  // A thick gold ring drawn as strokes: Ink, glow, gold, then a light highlight along its top.
  const ring = new Path2D(); ring.ellipse(0, -0.34, 0.34, 0.1, 0, 0, TAU);
  c.save(); c.shadowColor = 'rgba(255,214,102,0.9)'; c.shadowBlur = 0.2 * c.getTransform().a; c.lineWidth = 0.2; c.strokeStyle = 'rgba(255,226,140,0.5)'; c.stroke(ring); c.restore();
  c.lineWidth = 0.13 + O * 2; c.strokeStyle = INK; c.stroke(ring);
  c.lineWidth = 0.13; c.strokeStyle = GOLD[0]; c.stroke(ring);
  c.lineWidth = 0.05; c.strokeStyle = GOLD[1]; c.beginPath(); c.ellipse(0, -0.36, 0.33, 0.09, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  c.strokeStyle = GOLD[2]; c.beginPath(); c.ellipse(0, -0.31, 0.33, 0.09, 0, Math.PI * 0.1, Math.PI * 0.9); c.stroke();
  c.fillStyle = '#FFFFFF';
  for (const [x, y, r] of [[-0.46, -0.54, 0.08], [0.48, -0.22, 0.06]]) { const t = twinkle(x, y, r); c.fill(t); ink(c, t, O * 0.5); }
}

function cowboy(c: Ctx): void {
  const brown: [string, string, string] = ['#B9773E', '#D99A5B', '#87532A'];
  const brim = new Path2D(); brim.moveTo(-0.66, -0.2); brim.quadraticCurveTo(-0.5, 0.06, 0, 0.04); brim.quadraticCurveTo(0.5, 0.06, 0.66, -0.2);
  brim.quadraticCurveTo(0.5, -0.06, 0, -0.08); brim.quadraticCurveTo(-0.5, -0.06, -0.66, -0.2); brim.closePath();
  const crown = new Path2D(); crown.moveTo(-0.3, -0.06); crown.lineTo(-0.34, -0.42); crown.quadraticCurveTo(-0.2, -0.56, -0.06, -0.46); crown.quadraticCurveTo(0, -0.42, 0.06, -0.46);
  crown.quadraticCurveTo(0.2, -0.56, 0.34, -0.42); crown.lineTo(0.3, -0.06); crown.closePath();
  part(c, crown, ...brown);
  c.save(); c.clip(crown); c.fillStyle = C('Z')[0]; c.fillRect(-0.4, -0.2, 0.8, 0.1); c.restore(); ink(c, crown, O);
  part(c, brim, ...brown, 0.03); ink(c, brim, O);
}

function gradcap(c: Ctx): void {
  const cap = new Path2D(); cap.moveTo(-0.32, 0.02); cap.lineTo(-0.3, -0.3); cap.quadraticCurveTo(0, -0.22, 0.3, -0.3); cap.lineTo(0.32, 0.02); cap.quadraticCurveTo(0, -0.06, -0.32, 0.02); cap.closePath();
  part(c, cap, ...DARK); ink(c, cap, O);
  const board = new Path2D(); board.moveTo(0, -0.52); board.lineTo(0.58, -0.34); board.lineTo(0, -0.18); board.lineTo(-0.58, -0.34); board.closePath();
  part(c, board, ...DARK, 0.03); ink(c, board, O);
  c.strokeStyle = GOLD[0]; c.lineWidth = 0.04;
  c.beginPath(); c.moveTo(0, -0.35); c.quadraticCurveTo(0.34, -0.32, 0.42, -0.24); c.lineTo(0.42, -0.04); c.stroke();
  const tassel = rrPath(0.37, -0.08, 0.1, 0.16, 0.03); part(c, tassel, ...GOLD, 0.02); ink(c, tassel, O * 0.7);
  const btn = circlePath(0, -0.35, 0.04); c.fillStyle = GOLD[0]; c.fill(btn); ink(c, btn, O * 0.5);
}

function cupcake(c: Ctx): void {
  const cup = new Path2D(); cup.moveTo(-0.3, 0.02); cup.lineTo(-0.38, -0.34); cup.lineTo(0.38, -0.34); cup.lineTo(0.3, 0.02); cup.closePath();
  part(c, cup, ...C('I'));
  c.save(); c.clip(cup); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.05;
  for (let x = -0.3; x <= 0.31; x += 0.12) { c.beginPath(); c.moveTo(x * 1.25, -0.36); c.lineTo(x, 0.04); c.stroke(); }
  c.restore(); ink(c, cup, O);
  const icing = new Path2D();
  for (const [x, y, r] of [[-0.3, -0.36, 0.13], [-0.1, -0.4, 0.15], [0.12, -0.4, 0.15], [0.3, -0.36, 0.13], [-0.14, -0.58, 0.15], [0.12, -0.58, 0.15], [0, -0.74, 0.13]]) icing.addPath(circlePath(x, y, r));
  ink(c, icing, O * 2); c.fillStyle = '#FFB3CF'; c.fill(icing);
  c.save(); c.clip(icing); c.fillStyle = '#FFD6E5'; c.beginPath(); c.ellipse(-0.12, -0.66, 0.16, 0.06, -0.3, 0, TAU); c.fill(); c.restore();
  const sprinkles = ['#FFE066', '#7FE3F5', '#B9F27F', '#FFFFFF'];
  sprinkles.forEach((col, i) => { c.save(); c.translate(-0.24 + i * 0.16, -0.46 - (i % 2) * 0.14); c.rotate(i * 1.3); c.fillStyle = col; c.fill(rrPath(-0.045, -0.015, 0.09, 0.03, 0.015)); c.restore(); });
  const cherry = circlePath(0.04, -0.9, 0.09); part(c, cherry, ...C('Z'), 0.02); ink(c, cherry, O * 0.8);
  c.strokeStyle = INK; c.lineWidth = 0.03; c.beginPath(); c.moveTo(0.06, -0.98); c.quadraticCurveTo(0.12, -1.06, 0.18, -1.05); c.stroke();
}

function robot(c: Ctx): void {
  c.strokeStyle = INK; c.lineWidth = 0.05 + O; c.beginPath(); c.moveTo(0, -0.5); c.lineTo(0, -0.78); c.stroke();
  c.strokeStyle = STEEL[2]; c.lineWidth = 0.05; c.stroke();
  const bulb = circlePath(0, -0.84, 0.1);
  c.save(); c.shadowColor = 'rgba(255,77,109,0.9)'; c.shadowBlur = 0.15 * c.getTransform().a; c.fillStyle = C('Z')[0]; c.fill(bulb); c.restore();
  part(c, bulb, ...C('Z'), 0.02); ink(c, bulb, O * 0.8);
  const d = dome(0.4, -0.66); part(c, d, ...STEEL); ink(c, d, O);
  c.fillStyle = STEEL[2]; for (const [x, y] of [[-0.24, -0.16], [0.24, -0.16], [0, -0.38]]) { c.beginPath(); c.arc(x, y, 0.035, 0, TAU); c.fill(); }
  for (const sx of [-1, 1]) { const ear = rrPath(sx * 0.46 - 0.07, -0.34, 0.14, 0.28, 0.05); part(c, ear, ...C('I'), 0.02); ink(c, ear, O * 0.8); }
}

function horns(c: Ctx): void {
  const scale: [string, string, string] = ['#2FA36B', '#66D39A', '#1C7049'], bone: [string, string, string] = ['#F2D8A6', '#FFF0CF', '#C9A66B'];
  for (const sx of [-1, 1]) {
    const h = new Path2D(); h.moveTo(sx * 0.1, -0.1); h.bezierCurveTo(sx * 0.1, -0.44, sx * 0.34, -0.62, sx * 0.6, -0.72); h.bezierCurveTo(sx * 0.5, -0.52, sx * 0.48, -0.32, sx * 0.44, -0.1); h.closePath();
    part(c, h, ...bone, 0.03);
    c.save(); c.clip(h); c.strokeStyle = 'rgba(150,105,50,0.5)'; c.lineWidth = 0.035;
    for (const t of [0.26, 0.4, 0.54]) { c.beginPath(); c.moveTo(sx * 0.05, -t + 0.04); c.quadraticCurveTo(sx * 0.3, -t - 0.02, sx * 0.62, -t - 0.08); c.stroke(); }
    c.restore(); ink(c, h, O);
  }
  // A row of back spikes along a scaly band.
  for (const [x, hgt] of [[-0.14, 0.2], [0.02, 0.28], [0.17, 0.2]] as [number, number][]) {
    const sp = new Path2D(); sp.moveTo(x - 0.08, -0.1); sp.lineTo(x, -0.1 - hgt); sp.lineTo(x + 0.08, -0.1); sp.closePath();
    part(c, sp, C('Z')[0], C('Z')[1], C('Z')[2], 0.02); ink(c, sp, O * 0.8);
  }
  const band = rrPath(-0.48, -0.16, 0.96, 0.18, 0.07); part(c, band, ...scale, 0.03);
  c.save(); c.clip(band); c.strokeStyle = 'rgba(20,70,45,0.6)'; c.lineWidth = 0.025;
  for (let x = -0.48; x < 0.5; x += 0.1) { c.beginPath(); c.arc(x + 0.05, -0.13, 0.05, 0, Math.PI); c.stroke(); }
  c.restore(); ink(c, band, O);
}

function heartCrown(c: Ctx): void {
  const p = new Path2D();
  p.moveTo(-0.42, 0); p.lineTo(-0.46, -0.42); p.lineTo(-0.22, -0.26); p.lineTo(0, -0.5); p.lineTo(0.22, -0.26); p.lineTo(0.46, -0.42); p.lineTo(0.42, 0); p.closePath();
  part(c, p, ...ROSE);
  c.save(); c.clip(p); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(-0.5, -0.12, 1, 0.05); c.restore(); ink(c, p, O);
  for (const [x, y, k] of [[-0.46, -0.46, 0.17], [0.46, -0.46, 0.17], [0, -0.58, 0.22]]) { const h = heart(x, y, k); part(c, h, ...C('Z'), 0.015); ink(c, h, O * 0.7); }
  const gem = heart(0, -0.17, 0.26); part(c, gem, '#FFFFFF', '#FFFFFF', '#F2C6D3', 0.02); ink(c, gem, O * 0.7);
  const t = twinkle(0.32, -0.66, 0.08); c.fillStyle = '#FFFFFF'; c.fill(t); ink(c, t, O * 0.5);
}

const DRAW: Record<HatKey, (c: Ctx) => void> = {
  party, cap, propeller, daisies, tophat, crown, hardhat, beanie, wizard, chef, pirate, viking, beret, bunny, halo, cowboy, gradcap,
  cupcake, robot, horns, heart_crown: heartCrown,
};

/**
 * Draw `hat` with the middle of its base at (x, y), `w` px across its base. A variant draws with its hues
 * turned; a key this copy doesn't know draws nothing.
 */
export function drawHat(c: Ctx, hat: string, x: number, y: number, w: number): void {
  const hv = hatVariant(hat);
  if (!hv) return;
  const [key, v] = hv;
  if (!v) {
    c.save(); c.translate(x, y); c.scale(w, w);
    c.lineJoin = 'round'; c.lineCap = 'round';
    DRAW[key](c);
    c.restore();
    return;
  }
  // Variants: draw on the side, turn the hues, stamp it in.
  const k = Math.max(1, Math.ceil(w * 1.6)), cv = cpuBaked(() => {
    const cv = makeCanvas(k, k), cc = ctx2d(cv);
    drawHat(cc, key, k / 2, k * 0.8, w);
    turnCanvas(cv, variantTurn(v));
    return cv;
  });
  c.drawImage(cv, x - k / 2, y - k * 0.8);
}

const urls = new Map<string, string>();

/** A hat on its own, centred in a `px` square, as a cached PNG data URL (for pickers and unlock cards). Empty for an unknown key. */
export function hatUrl(hat: string, cssPx = 48, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr), id = `${hat}:${px}`;
  let u = urls.get(id);
  if (u) return u;
  const info = hatInfo(hat), h = info?.h ?? 1, w = px * 0.8 / Math.max(1.35, h + 0.1);
  const cv = cpuBaked(() => { const cv = makeCanvas(px, px); if (info) drawHat(ctx2d(cv), hat, px / 2, px / 2 + h * w / 2, w); return cv; });
  u = cv.toDataURL('image/png');
  urls.set(id, u);
  return u;
}
