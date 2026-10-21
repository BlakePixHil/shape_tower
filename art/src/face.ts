// Blockling faces (art-direction.md §4.3). Drawn around (0,0) = the face anchor, `s` pixels per block.
// The same code draws whole faces (stone pieces, previews) and the separate parts the Phaser view
// layers as sprites (eye whites, pupils, mouth, sweat), so pupils can hang toward gravity live.

import { INK } from './config.ts';
import { type Ctx, TAU } from './util.ts';

/** `squint` is for faces on the tower's top during a gust (§6.3): eyes screwed shut against the wind. */
export type Expression = 'idle' | 'falling' | 'impact' | 'proud' | 'worried' | 'panic' | 'dizzy' | 'carved' | 'blink' | 'squint';
export const EXPRESSIONS: Expression[] = ['idle', 'falling', 'impact', 'proud', 'worried', 'panic', 'dizzy', 'carved', 'blink', 'squint'];

/** Face layout in blocks. */
export const FACE = {
  eyeX: 0.2,      // eye centres at ±eyeX
  eyeY: -0.07,
  eyeR: 0.13,
  pupilR: 0.062,
  /** Texture size of one face part, in blocks (square, centred on the anchor). */
  box: 1.0,
} as const;

/** Per expression: whether googly pupils show, and the eye and pupil scale. */
export const PUPILS: Record<Expression, { show: boolean; eye: number; pupil: number }> = {
  idle: { show: true, eye: 1, pupil: 1 },
  falling: { show: true, eye: 1.1, pupil: 0.9 },
  worried: { show: true, eye: 1.05, pupil: 0.72 },
  panic: { show: true, eye: 1.18, pupil: 0.42 },
  impact: { show: false, eye: 1, pupil: 1 },
  proud: { show: false, eye: 1, pupil: 1 },
  dizzy: { show: false, eye: 1, pupil: 1 },
  carved: { show: false, eye: 1, pupil: 1 },
  blink: { show: false, eye: 1, pupil: 1 },
  squint: { show: false, eye: 1, pupil: 1 },
};

/** How far (in blocks) a pupil can travel from its eye centre for an expression. */
export const pupilTravel = (ex: Expression): number => {
  const p = PUPILS[ex];
  return (FACE.eyeR * p.eye - FACE.pupilR * p.pupil) * 0.62;
};

const lw = (s: number) => Math.max(1.1, s * 0.045);

function stroke(c: Ctx, s: number, color = INK): void {
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = color; c.lineWidth = lw(s);
}

/** Eye whites (with outline) and brows, without pupils. For expressions with no open eyes, draws their eye marks. */
export function drawEyes(c: Ctx, s: number, ex: Expression): void {
  const er = FACE.eyeR * s, ey = FACE.eyeY * s, L = -FACE.eyeX * s, R = FACE.eyeX * s;
  c.save(); stroke(c, s);
  const p = PUPILS[ex];
  if (p.show) {
    for (const ox of [L, R]) {
      c.beginPath(); c.ellipse(ox, ey, er * 0.92 * p.eye, er * 1.08 * p.eye, 0, 0, TAU);
      c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = lw(s) * 0.75; c.stroke();
    }
    c.lineWidth = lw(s);
    if (ex === 'worried' || ex === 'panic') {
      const up = ex === 'worried';
      for (const [ox, d] of [[L, 1], [R, -1]]) {
        c.beginPath(); c.moveTo(ox - d * er * 0.75, ey - er * (up ? 1.3 : 1.45)); c.lineTo(ox + d * er * 0.6, ey - er * 1.7); c.stroke();
      }
    }
  } else if (ex === 'blink') {
    for (const ox of [L, R]) { c.beginPath(); c.moveTo(ox - er * 0.8, ey); c.lineTo(ox + er * 0.8, ey); c.stroke(); }
  } else if (ex === 'impact') {
    for (const [ox, d] of [[L, 1], [R, -1]]) {
      c.beginPath(); c.moveTo(ox - d * er * 0.7, ey - er * 0.6); c.lineTo(ox + d * er * 0.5, ey); c.lineTo(ox - d * er * 0.7, ey + er * 0.6); c.stroke();
    }
  } else if (ex === 'squint') {
    // Two tight wavy lids, the outer ends pulled down, and brows pushed in.
    for (const [ox, d] of [[L, 1], [R, -1]]) {
      c.beginPath(); c.moveTo(ox - d * er * 0.85, ey + er * 0.25); c.quadraticCurveTo(ox - d * er * 0.2, ey - er * 0.35, ox + d * er * 0.75, ey - er * 0.05); c.stroke();
      c.beginPath(); c.moveTo(ox - d * er * 0.8, ey - er * 0.95); c.lineTo(ox + d * er * 0.55, ey - er * 0.65); c.stroke();
    }
  } else if (ex === 'proud') {
    for (const ox of [L, R]) { c.beginPath(); c.arc(ox, ey + er * 0.35, er * 0.7, 1.1 * Math.PI, 1.9 * Math.PI); c.stroke(); }
  } else if (ex === 'carved') {
    c.strokeStyle = 'rgba(60,50,40,0.55)';
    for (const ox of [L, R]) { c.beginPath(); c.arc(ox, ey - er * 0.15, er * 0.6, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
  }
  // dizzy: the eyes are spirals drawn by drawSpiral, so the view can spin them.
  c.restore();
}

/** A googly pupil centred at (x, y), with a catch-light when there is room for detail. */
export function drawPupil(c: Ctx, x: number, y: number, s: number, scale = 1, detail = true): void {
  const pr = FACE.pupilR * s * scale;
  c.beginPath(); c.arc(x, y, pr, 0, TAU); c.fillStyle = INK; c.fill();
  if (detail) { c.beginPath(); c.arc(x - pr * 0.35, y - pr * 0.4, pr * 0.32, 0, TAU); c.fillStyle = '#FFFFFF'; c.fill(); }
}

/** One dizzy spiral eye centred at (x, y), turned by `spin` radians. */
export function drawSpiral(c: Ctx, x: number, y: number, s: number, spin = 0): void {
  const er = FACE.eyeR * s;
  c.save(); stroke(c, s); c.beginPath();
  for (let i = 0; i <= 26; i++) {
    const a = i * 0.42 + spin, r = er * 0.9 * i / 26;
    const xx = x + Math.cos(a) * r, yy = y + Math.sin(a) * r;
    if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy);
  }
  c.stroke(); c.restore();
}

/** Mouth, plus cheeks for the happy faces when there is room for detail. */
export function drawMouth(c: Ctx, s: number, ex: Expression, detail = true, wobble = 0): void {
  const er = FACE.eyeR * s, ey = FACE.eyeY * s, my = ey + er * 1.9, sp = FACE.eyeX * s;
  c.save(); stroke(c, s); c.fillStyle = INK;
  const cheeks = () => {
    if (!detail) return;
    c.fillStyle = 'rgba(255,105,140,0.38)';
    for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * sp * 1.75, ey + er * 1.3, er * 0.55, er * 0.32, 0, 0, TAU); c.fill(); }
    c.fillStyle = INK;
  };
  const wavy = () => {
    c.beginPath();
    for (let i = 0; i <= 8; i++) { const xx = -er * 0.8 + i * er * 0.2, yy = my + Math.sin(i * 1.6 + wobble) * er * 0.16; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
    c.stroke();
  };
  switch (ex) {
    case 'idle': case 'blink':
      cheeks(); c.beginPath(); c.arc(0, my - er * 0.55, er * 0.62, 0.18 * Math.PI, 0.82 * Math.PI); c.stroke(); break;
    case 'falling':
      c.beginPath(); c.ellipse(0, my, er * 0.32, er * 0.42, 0, 0, TAU); c.fill(); break;
    case 'impact':
      c.beginPath(); c.moveTo(-er * 0.6, my); c.lineTo(er * 0.6, my); c.stroke(); break;
    case 'proud':
      cheeks(); c.beginPath(); c.moveTo(-er * 0.85, my - er * 0.4); c.quadraticCurveTo(0, my + er * 1.0, er * 0.85, my - er * 0.4); c.closePath(); c.fill(); break;
    case 'worried': case 'dizzy':
      wavy(); break;
    case 'squint':
      // Gritted: a flat little mouth with teeth lines.
      c.beginPath(); c.moveTo(-er * 0.6, my - er * 0.05); c.lineTo(er * 0.6, my - er * 0.05); c.lineTo(er * 0.5, my + er * 0.3); c.lineTo(-er * 0.5, my + er * 0.3); c.closePath();
      c.fillStyle = '#FFFFFF'; c.fill(); c.stroke();
      c.lineWidth = lw(s) * 0.6; c.beginPath(); for (const x of [-0.2, 0.2]) { c.moveTo(x * er, my - er * 0.05); c.lineTo(x * er, my + er * 0.3); } c.stroke();
      break;
    case 'panic':
      c.beginPath(); c.ellipse(0, my + er * 0.15, er * 0.45, er * 0.62, 0, 0, TAU); c.fill(); break;
    case 'carved':
      c.strokeStyle = 'rgba(60,50,40,0.55)'; c.beginPath(); c.arc(0, my - er * 0.3, er * 0.35, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); break;
  }
  c.restore();
}

/** Sweat drop beside the right eye (tension ≥ 0.6). */
export function drawSweat(c: Ctx, s: number): void {
  const er = FACE.eyeR * s, x = FACE.eyeX * s + er * 1.75, y = FACE.eyeY * s - er * 0.6, r = er * 0.5;
  c.save();
  c.beginPath(); c.moveTo(x, y - r * 1.5);
  c.bezierCurveTo(x + r * 1.1, y - r * 0.2, x + r * 0.85, y + r, x, y + r);
  c.bezierCurveTo(x - r * 0.85, y + r, x - r * 1.1, y - r * 0.2, x, y - r * 1.5);
  c.fillStyle = '#9BE6FF'; c.fill(); c.lineWidth = lw(s) * 0.6; c.strokeStyle = INK; c.stroke();
  c.restore();
}

/**
 * A complete face at (x, y). `look` is the pupils' direction in screen space (unit vector, default
 * straight down = gravity). Used for baked stone faces and previews; the live game uses the parts.
 */
export function drawFace(c: Ctx, x: number, y: number, s: number, ex: Expression, o: { look?: [number, number]; detail?: boolean; sweat?: boolean; spin?: number } = {}): void {
  const detail = o.detail ?? true;
  c.save(); c.translate(x, y);
  drawEyes(c, s, ex);
  const p = PUPILS[ex];
  if (p.show) {
    const [gx, gy] = o.look ?? [0, 1], k = pupilTravel(ex) * s;
    for (const ox of [-FACE.eyeX * s, FACE.eyeX * s]) drawPupil(c, ox + gx * k, FACE.eyeY * s + gy * k * 1.1, s, p.pupil, detail);
  }
  if (ex === 'dizzy') for (const ox of [-FACE.eyeX * s, FACE.eyeX * s]) drawSpiral(c, ox, FACE.eyeY * s, s, o.spin ?? 0);
  drawMouth(c, s, ex, detail);
  if (o.sweat && detail) drawSweat(c, s);
  c.restore();
}

