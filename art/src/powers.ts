// Power-up art (gameplay.md §13): icons for the five powers and Second Wind, the power bubble, and
// the CSS for the game's DOM power bar. Icons are stickers like the rest of the UI (art-direction.md
// §8): flat fills with a light lip and an Ink outline, so they read on the Paper slot buttons and
// inside the translucent bubbles alike. Each icon draws in a unit box, so one drawing serves every size.

import { INK, INK_SOFT, PAPER, SIGNAL } from './config.ts';
import { O, circlePath, heart, ink, part, rrPath, turn, twinkle } from './sticker.ts';
import { type Ctx, TAU, ctx2d, labToHex, makeCanvas, mixLab, oklab, rgba } from './util.ts';

export const POWER_KINDS = ['clean', 'quickset', 'undo', 'glue', 'slowmo'] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
/** Everything with an icon: the five powers and Second Wind. */
export type PowerIcon = PowerKind | 'wind';
export const POWER_ICON_NAMES: PowerIcon[] = [...POWER_KINDS, 'wind'];

/** Each power's color, for its bubble rim, its effects and its slot. The same values as the game's. */
export const POWER_COLORS: Record<PowerIcon, string> = {
  clean: '#3EE6A8',
  quickset: '#B9B1A6',
  undo: '#B18CFF',
  glue: '#FFAA2B',
  slowmo: '#7FD8FF',
  wind: '#7FD8FF',
};

export const POWER = {
  /** Bubble radius, blocks (the sim's pickup circle). */
  bubbleR: 0.6,
  /** Icon size inside a bubble, blocks. */
  bubbleIcon: 0.8,
  /** DOM buttons in CSS px, and the share of the button the icon fills. */
  slotPx: 54,
  windPx: 62,
  iconFill: 0.74,
  /** Bubble motion: spawn pop (s), idle bob (blocks, rad/s), icon sway (rad, rad/s). */
  spawn: 0.34,
  bob: 0.08,
  bobRate: 3,
  sway: 0.08,
  swayRate: 1.7,
  /** How long a collect burst and an expiry fade run, s. */
  collect: 0.6,
  fade: 0.45,
} as const;

// ---- icons ----

/** Clean Slate: a broom mid-sweep with a mint band, leaving sparkles. */
function drawClean(c: Ctx): void {
  const A = 35, X = 0.05, Y = -0.02;
  const handle = rrPath(-0.05, -0.5, 0.1, 0.54, 0.05);
  const bristles = new Path2D();
  bristles.moveTo(-0.13, 0.05); bristles.lineTo(0.13, 0.05); bristles.lineTo(0.25, 0.36); bristles.quadraticCurveTo(0, 0.47, -0.25, 0.36); bristles.closePath();
  part(c, turn(handle, A, X, Y), '#D99A5B', '#F2C38E', '#A8693A', 0.04);
  part(c, turn(bristles, A, X, Y), '#FFD36B', '#FFEDB0', '#E0A93A');
  c.save(); c.translate(X, Y); c.rotate(A * Math.PI / 180);
  c.strokeStyle = 'rgba(166,104,34,0.6)'; c.lineWidth = 0.024; c.lineCap = 'round';
  for (const f of [-0.6, -0.2, 0.2, 0.6]) { c.beginPath(); c.moveTo(f * 0.13, 0.13); c.lineTo(f * 0.24, 0.37); c.stroke(); }
  c.restore();
  part(c, turn(rrPath(-0.155, -0.05, 0.31, 0.12, 0.04), A, X, Y), POWER_COLORS.clean, '#B4FADF', '#1FB884', 0.035);
  for (const [x, y, r] of [[0.3, 0.27, 0.13], [0.43, 0.04, 0.08]]) { const s = twinkle(x, y, r); c.fillStyle = '#FFFFFF'; c.fill(s); ink(c, s, O * 0.7); }
}

/** Quick-Set: a content stone Blockling with a gold lightning bolt. */
function drawQuickset(c: Ctx): void {
  c.save(); c.translate(0, 0.04);
  part(c, rrPath(-0.43, -0.2, 0.59, 0.59, 0.09), '#B9B1A6', '#DCD5CB', '#8E867B', 0.07);
  c.fillStyle = 'rgba(80,68,56,0.35)';
  for (const [x, y, r] of [[-0.31, -0.06, 0.022], [-0.05, 0.25, 0.018], [-0.34, 0.26, 0.016], [0.06, -0.09, 0.015]]) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  // Closed, happy eyes and a small smile: set and settled.
  c.strokeStyle = INK; c.lineWidth = 0.036; c.lineCap = 'round';
  for (const x of [-0.23, -0.03]) { c.beginPath(); c.arc(x, 0.11, 0.048, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
  c.beginPath(); c.arc(-0.13, 0.17, 0.055, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
  const bolt = new Path2D();
  for (const [i, [x, y]] of ([[0.3, -0.46], [0.06, -0.06], [0.2, -0.06], [0.08, 0.27], [0.43, -0.16], [0.27, -0.16], [0.4, -0.46]] as [number, number][]).entries()) {
    if (i) bolt.lineTo(x, y); else bolt.moveTo(x, y);
  }
  bolt.closePath();
  part(c, bolt, SIGNAL.gold, '#FFE58F', '#E0A100', 0.05);
  c.restore();
}

/** Undo: a fat violet arrow that hooks back to the left. */
function drawUndo(c: Ctx): void {
  c.save(); c.translate(0.04, -0.01);
  const W = 0.17, r = 0.21, cx = 0.06, cy = 0.06, col = POWER_COLORS.undo;
  const line = new Path2D(); line.moveTo(-0.2, cy - r); line.lineTo(cx, cy - r); line.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); line.lineTo(-0.14, cy + r);
  const head = new Path2D(); head.moveTo(-0.45, cy - r); head.lineTo(-0.16, cy - r - 0.2); head.lineTo(-0.16, cy - r + 0.2); head.closePath();
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = INK; c.lineWidth = W + O * 2; c.stroke(line);
  c.fillStyle = INK; c.fill(head); c.lineWidth = O * 2; c.stroke(head);
  c.strokeStyle = col; c.lineWidth = W; c.stroke(line);
  c.fillStyle = col; c.fill(head);
  c.lineWidth = W * 0.26;
  const hi = new Path2D(); hi.moveTo(-0.3, cy - r - 0.08); hi.lineTo(-0.2, cy - r - 0.14); hi.moveTo(-0.12, cy - r - W * 0.24); hi.lineTo(cx, cy - r - W * 0.24); hi.arc(cx, cy, r + W * 0.24, -Math.PI / 2, -0.2);
  c.strokeStyle = '#E4D6FF'; c.stroke(hi);
  const lo = new Path2D(); lo.arc(cx, cy, r + W * 0.26, 0.45, Math.PI / 2); lo.lineTo(-0.13, cy + r + W * 0.26);
  c.strokeStyle = '#8A63E0'; c.stroke(lo);
  c.restore();
}

/** Glue: a glass jar of honey with a wooden lid, dripping. */
function drawGlue(c: Ctx): void {
  c.save(); c.translate(0, -0.02);
  const jar = rrPath(-0.33, -0.16, 0.66, 0.6, 0.2);
  c.fillStyle = '#FFF4DE'; c.fill(jar);
  c.save(); c.clip(jar);
  const hp = new Path2D();
  hp.moveTo(-0.4, 0.04); hp.bezierCurveTo(-0.2, -0.02, -0.05, 0.09, 0.1, 0.03); hp.bezierCurveTo(0.22, -0.01, 0.3, 0.06, 0.4, 0.03);
  hp.lineTo(0.4, 0.5); hp.lineTo(-0.4, 0.5); hp.closePath();
  const g = c.createLinearGradient(0, 0, 0, 0.44); g.addColorStop(0, '#FFC94D'); g.addColorStop(1, '#F28C12');
  c.fillStyle = g; c.fill(hp);
  const surf = new Path2D(); surf.moveTo(-0.4, 0.05); surf.bezierCurveTo(-0.2, -0.01, -0.05, 0.1, 0.1, 0.04); surf.bezierCurveTo(0.22, 0, 0.3, 0.07, 0.4, 0.04);
  c.strokeStyle = '#FFE59A'; c.lineWidth = 0.04; c.stroke(surf);
  // A honeycomb cell on the honey, and the glass's shine.
  const hex = new Path2D();
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, x = 0.1 + Math.cos(a) * 0.075, y = 0.25 + Math.sin(a) * 0.075; if (i) hex.lineTo(x, y); else hex.moveTo(x, y); }
  hex.closePath(); c.strokeStyle = '#C7650A'; c.lineWidth = 0.03; c.lineJoin = 'round'; c.stroke(hex);
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill(rrPath(-0.27, -0.08, 0.06, 0.34, 0.03));
  c.restore();
  ink(c, jar);
  for (const [x0, x1, cx, cy, r] of [[0.12, 0.21, 0.165, -0.04, 0.062], [-0.16, -0.1, -0.13, -0.1, 0.036]]) {
    const d = new Path2D();
    d.moveTo(x0, -0.18); d.lineTo(x0, cy - r * 0.3); d.arc(cx, cy, r, Math.PI * 1.1, Math.PI * -0.1, true); d.lineTo(x1, -0.18); d.closePath();
    part(c, d, SIGNAL.amber, '#FFD27A', '#E07F12', 0.02);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(cx - r * 0.35, cy - r * 0.1, r * 0.25, 0, TAU); c.fill();
  }
  part(c, rrPath(-0.37, -0.35, 0.74, 0.19, 0.06), '#C98B4F', '#E8B27A', '#9A5E2E', 0.05);
  c.restore();
}

/** Slow-Mo: a snail with a sky-blue spiral shell. */
function drawSlowmo(c: Ctx): void {
  c.save(); c.translate(0, -0.01);
  c.strokeStyle = INK; c.lineWidth = 0.036; c.lineCap = 'round';
  for (const [x0, x1] of [[0.28, 0.23], [0.37, 0.42]]) { c.beginPath(); c.moveTo(x0, 0); c.lineTo(x1, -0.28); c.stroke(); }
  const body = new Path2D();
  body.moveTo(-0.47, 0.38); body.quadraticCurveTo(-0.32, 0.25, -0.1, 0.24); body.lineTo(0.22, 0.24); body.lineTo(0.22, 0.02);
  body.arc(0.32, 0.02, 0.1, Math.PI, 0); body.lineTo(0.42, 0.3); body.quadraticCurveTo(0.42, 0.38, 0.34, 0.38); body.closePath();
  part(c, body, '#FFD9A8', '#FFEDCF', '#E9AC6B', 0.045);
  for (const x of [0.23, 0.42]) {
    const e = circlePath(x, -0.29, 0.058); c.fillStyle = '#FFFFFF'; c.fill(e); ink(c, e, 0.036);
    c.fillStyle = INK; c.beginPath(); c.arc(x + 0.012, -0.282, 0.026, 0, TAU); c.fill();
  }
  c.strokeStyle = INK; c.lineWidth = 0.03; c.beginPath(); c.arc(0.335, 0.08, 0.042, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
  c.fillStyle = 'rgba(255,110,150,0.45)'; c.beginPath(); c.arc(0.385, 0.13, 0.028, 0, TAU); c.fill();
  const shell = circlePath(-0.08, 0, 0.27);
  part(c, shell, POWER_COLORS.slowmo, '#CBF1FF', '#3FA9D9', 0.05);
  c.beginPath();
  for (let i = 0; i <= 64; i++) { const f = i / 64, a = -Math.PI / 2 + f * Math.PI * 2.7, rr = 0.025 + 0.19 * f; const x = -0.08 + Math.cos(a) * rr, y = 0.01 + Math.sin(a) * rr; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
  c.strokeStyle = '#2E86B8'; c.lineWidth = 0.036; c.lineJoin = 'round'; c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 0.04; c.beginPath(); c.arc(-0.08, 0, 0.2, Math.PI * 1.08, Math.PI * 1.42); c.stroke();
  c.restore();
}

/** Second Wind: three curling gusts and a heart, for the run's one rescue. */
function drawWind(c: Ctx): void {
  c.save(); c.scale(0.94, 0.94); c.translate(-0.04, 0.05);
  const lines = [new Path2D(), new Path2D(), new Path2D()];
  lines[0].moveTo(-0.42, -0.1); lines[0].lineTo(0.1, -0.1); lines[0].arc(0.1, -0.23, 0.13, Math.PI / 2, -Math.PI, true);
  lines[1].moveTo(-0.46, 0.08); lines[1].lineTo(0.22, 0.08); lines[1].arc(0.22, 0.2, 0.12, -Math.PI / 2, Math.PI);
  lines[2].moveTo(-0.38, 0.32); lines[2].lineTo(-0.1, 0.32);
  const W = 0.085;
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = INK; c.lineWidth = W + O * 2; for (const l of lines) c.stroke(l);
  c.strokeStyle = '#FFFFFF'; c.lineWidth = W; for (const l of lines) c.stroke(l);
  c.restore();
  part(c, heart(0.33, -0.3, 0.36), SIGNAL.danger, '#FF9AAE', '#D6284A', 0.04);
  c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(0.28, -0.33, 0.035, 0.022, -0.6, 0, TAU); c.fill();
}

const DRAW: Record<PowerIcon, (c: Ctx) => void> = { clean: drawClean, quickset: drawQuickset, undo: drawUndo, glue: drawGlue, slowmo: drawSlowmo, wind: drawWind };

/** Draw icon `kind` centred at (x, y), `size` px across. */
export function drawPowerIcon(c: Ctx, kind: PowerIcon, x: number, y: number, size: number): void {
  c.save(); c.translate(x, y); c.scale(size, size);
  DRAW[kind](c);
  c.restore();
}

/** Bake icon `kind` into a canvas `px` square. Origin: centre. */
export function bakePowerIcon(kind: PowerIcon, px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px);
  drawPowerIcon(ctx2d(cv), kind, cv.width / 2, cv.height / 2, cv.width);
  return cv;
}

const urls = new Map<string, string>();

/**
 * A PNG data URL of icon `kind` for the DOM HUD, `cssPx` CSS px square at the device's resolution.
 * Cached, so it's cheap to call on every HUD update. Show it with `<img class="st-icon">`.
 */
export function powerIconUrl(kind: PowerIcon, cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const key = `${kind}:${Math.round(cssPx * dpr)}`;
  let u = urls.get(key);
  if (!u) { u = bakePowerIcon(kind, Math.round(cssPx * dpr)).toDataURL('image/png'); urls.set(key, u); }
  return u;
}

// ---- the bubble ----

/** The power bubble's body: a soap bubble tinted in the power's color, with white and colored rims and an Ink edge. Origin: centre. */
export function bakeBubble(kind: PowerKind, s: number): HTMLCanvasElement {
  const pt = s / 32, r = POWER.bubbleR * s, size = Math.ceil(2 * r + 6 * pt), cv = makeCanvas(size, size), c = ctx2d(cv), m = size / 2, col = POWER_COLORS[kind];
  const disc = (rad: number) => { c.beginPath(); c.arc(m, m, rad, 0, TAU); };
  disc(r); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill();
  const g = c.createRadialGradient(m - r * 0.25, m - r * 0.3, 0, m, m, r);
  g.addColorStop(0, rgba(col, 0.06)); g.addColorStop(0.55, rgba(col, 0.2)); g.addColorStop(0.85, rgba(col, 0.45)); g.addColorStop(1, rgba(col, 0.7));
  c.fillStyle = g; c.fill();
  // A soft rainbow sheen low on the right, like soap film.
  const lg = c.createLinearGradient(m + r, m, m, m + r);
  lg.addColorStop(0, 'rgba(255,140,200,0.45)'); lg.addColorStop(0.5, 'rgba(255,232,120,0.45)'); lg.addColorStop(1, 'rgba(120,230,255,0.45)');
  c.beginPath(); c.arc(m, m, r * 0.8, 0.06 * Math.PI, 0.52 * Math.PI); c.strokeStyle = lg; c.lineWidth = r * 0.12; c.lineCap = 'round'; c.stroke();
  // Rims, outside in: Ink, the power's color, then a thin white film edge.
  disc(r - 5 * pt); c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.3 * pt; c.stroke();
  disc(r - 2.6 * pt); c.strokeStyle = col; c.lineWidth = 3.4 * pt; c.stroke();
  disc(r); c.strokeStyle = rgba(INK, 0.9); c.lineWidth = 2 * pt; c.stroke();
  return cv;
}

/** The bubble's highlights, drawn over its icon so the icon sits inside. White. Origin: centre. */
export function bakeBubbleGloss(s: number): HTMLCanvasElement {
  const pt = s / 32, r = POWER.bubbleR * s, size = Math.ceil(2 * r + 6 * pt), cv = makeCanvas(size, size), c = ctx2d(cv), m = size / 2;
  c.beginPath(); c.arc(m, m, r * 0.8, Math.PI * 1.08, Math.PI * 1.48); c.arc(m + r * 0.1, m + r * 0.1, r * 0.8, Math.PI * 1.44, Math.PI * 1.12, true); c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.88)'; c.fill();
  c.beginPath(); c.arc(m + r * 0.29, m - r * 0.74, r * 0.065, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
  c.beginPath(); c.arc(m, m, r * 0.78, Math.PI * 0.12, Math.PI * 0.36); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = r * 0.055; c.lineCap = 'round'; c.stroke();
  return cv;
}

// ---- the DOM power bar ----

const wash = (col: string, t: number) => labToHex(mixLab(oklab(PAPER), oklab(col), t));

/**
 * CSS for the game's power bar (hud.ts markup: .st-slot, .st-wind, .st-tag), to add after the HUD's
 * own CSS. Slots get a wash of their power's color (set `data-kind` on the button) and hold an
 * `<img class="st-icon">`. Second Wind's states are classes on .st-wind: `earn` (greyed, "CP 2"),
 * none (ready), `armed` (gold, pulsing, "TAP AGAIN"), `glow` (ready and the run is in trouble), and
 * `spent` (it blows away over 450 ms; hide it after).
 */
export function powerBarCss(): string {
  const slots = POWER_KINDS.map(k => `.st-slot[data-kind="${k}"] { background: radial-gradient(circle at 50% 36%, #FFFFFF 0 26%, ${wash(POWER_COLORS[k], 0.2)} 62%, ${wash(POWER_COLORS[k], 0.45)} 100%); }`).join('\n');
  const sky = 'rgba(127,216,255,', gold = 'rgba(255,194,61,';
  return `${slots}
.st-icon { width: ${POWER.iconFill * 100}%; height: ${POWER.iconFill * 100}%; display: block; pointer-events: none; -webkit-user-drag: none; user-select: none; }
.st-chip .st-icon { display: inline-block; width: 1.25em; height: 1.25em; vertical-align: -0.25em; margin-right: 2px; }
.st-wind { background: linear-gradient(#E6FAFF, #7FD8FF); }
.st-wind .st-icon { animation: st-wind-breathe 2.4s ease-in-out infinite; }
.st-wind.earn { opacity: 1; filter: none; background: #ECE6DA; border-style: dashed; box-shadow: none; }
.st-wind.earn .st-icon { filter: grayscale(1) brightness(1.15); opacity: 0.42; animation: none; }
.st-wind.earn .st-tag { background: ${INK_SOFT}; }
.st-wind.armed { background: linear-gradient(#FFF6C2, ${SIGNAL.gold}); animation: st-wind-armed 500ms ease-in-out infinite; }
.st-wind.armed .st-icon { animation: st-wind-wiggle 250ms ease-in-out infinite alternate; }
.st-wind.armed .st-tag { background: ${SIGNAL.gold}; color: ${INK}; box-shadow: 0 0 0 2px ${INK}; }
.st-wind.glow { animation: st-wind-glow 900ms ease-in-out infinite; }
.st-wind.spent { animation: st-wind-spent 450ms cubic-bezier(.5,0,.75,0) forwards; pointer-events: none; }
@keyframes st-wind-breathe { 0%, 100% { transform: scale(1) rotate(-3deg); } 50% { transform: scale(1.06) rotate(3deg); } }
@keyframes st-wind-wiggle { from { transform: rotate(-8deg) scale(1.05); } to { transform: rotate(8deg) scale(1.1); } }
@keyframes st-wind-armed { 0%, 100% { transform: scale(1); box-shadow: 0 4px 0 ${INK}, 0 0 0 0 ${gold}0); } 50% { transform: scale(1.09); box-shadow: 0 4px 0 ${INK}, 0 0 0 6px ${gold}0.75); } }
@keyframes st-wind-glow { 0%, 100% { transform: scale(1) rotate(0); box-shadow: 0 4px 0 ${INK}, 0 0 0 0 ${sky}0); } 40% { transform: scale(1.07) rotate(-4deg); box-shadow: 0 4px 0 ${INK}, 0 0 0 7px ${sky}0.85), 0 0 22px 10px ${sky}0.55); } 60% { transform: scale(1.07) rotate(4deg); } }
@keyframes st-wind-spent { 0% { transform: scale(1); opacity: 1; } 30% { transform: scale(1.22) rotate(-6deg); opacity: 1; } 100% { transform: translate(46px, -34px) scale(0.25) rotate(30deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .st-wind, .st-wind .st-icon { animation: none !important; } .st-wind.spent { opacity: 0; } }
`;
}
