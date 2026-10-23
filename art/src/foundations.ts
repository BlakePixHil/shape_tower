// Foundation styles (monetisation plan v2: Builder's Pass rewards and Workshop sets): one look for every
// checkpoint slab and the starting pedestal, in place of the biome's own (slab.ts). The top surface stays
// where pieces rest and nothing here changes a collider (QA F10.1). Slabs are gameplay objects, so they
// keep the Ink outline.

import { INK } from './config.ts';
import { type Ctx, TAU, circ, hash, rr, star4 } from './util.ts';

export type FoundationKind =
  | 'brick' | 'marble' | 'log' | 'ice' | 'gold' | 'moss' | 'crystal' | 'checker' | 'bamboo' | 'jelly' | 'toy' | 'cobble'
  | 'cake' | 'steel' | 'obsidian';

/** Each style's body colours: fill, lip (lighter top), and the darker colour its pedestal uses below. */
export const FOUNDATION_COLORS: Record<FoundationKind, [fill: string, lip: string, dark: string]> = {
  brick: ['#C9573C', '#E57B5C', '#94392A'],
  marble: ['#F1EEF6', '#FFFFFF', '#C9C3D6'],
  log: ['#A8723E', '#C68A4E', '#7A5230'],
  ice: ['#BDEBFF', '#E8F8FF', '#7FC4E8'],
  gold: ['#FFC23D', '#FFE08A', '#D9971A'],
  moss: ['#9AA0AE', '#BFC4CF', '#6E7487'],
  crystal: ['#B48CFF', '#DCC8FF', '#7A4FD9'],
  checker: ['#FFFFFF', '#FFFFFF', '#3A2E5C'],
  bamboo: ['#B8D86B', '#D8F09A', '#7FA33A'],
  jelly: ['#FF8FB8', '#FFC2D8', '#D9578A'],
  toy: ['#FF4F64', '#FF9DAA', '#CC2E48'],
  cobble: ['#B4AA9C', '#D6CFC3', '#857C70'],
  cake: ['#FFE0B8', '#FFF3E0', '#E8B98A'],
  steel: ['#9AA6BC', '#C9D1DE', '#5E6880'],
  obsidian: ['#2E2440', '#4A3C66', '#1A1426'],
};

/** How far a style's decorations reach outside its box, in px at `s` per block: [sides, top, bottom]. */
export function foundationPad(kind: FoundationKind, s: number): [number, number, number] {
  return [Math.ceil(s * 0.4), Math.ceil(s * (kind === 'crystal' ? 0.6 : 0.5)), Math.ceil(s * (kind === 'cake' || kind === 'moss' || kind === 'obsidian' ? 0.5 : 0.3))];
}

/**
 * Draw a slab in foundation style `kind` with its top-left at (x, y), w by h px (h = SLAB_DEPTH blocks).
 * `pt` is px per point (s / 32). Pieces rest on y.
 */
export function drawFoundation(c: Ctx, x: number, y: number, w: number, h: number, kind: FoundationKind, pt: number): void {
  const [fill, lip, dark] = FOUNDATION_COLORS[kind], r = h * 0.18;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  const shape = () => rr(c, x, y, w, h, r);
  const out = (lw = 2.5) => { shape(); c.lineWidth = lw * pt; c.strokeStyle = INK; c.stroke(); };
  // Drop shadow, body, lip.
  rr(c, x, y + 3 * pt, w, h, r); c.fillStyle = INK; c.fill();
  shape(); c.fillStyle = fill; c.fill();
  c.save(); shape(); c.clip();
  c.fillStyle = lip; c.fillRect(x, y, w, h * 0.22);
  const seed = (i: number) => hash(i * 3.17 + w * 0.013);
  switch (kind) {
    case 'brick': {
      c.strokeStyle = 'rgba(255,236,220,0.75)'; c.lineWidth = 1.6 * pt;
      const rows = 2, bh = h / rows, bw = h * 0.95;
      c.beginPath();
      for (let r0 = 0; r0 < rows; r0++) {
        const yy = y + r0 * bh; if (r0) { c.moveTo(x, yy); c.lineTo(x + w, yy); }
        for (let xx = x + (r0 % 2 ? bw / 2 : bw); xx < x + w; xx += bw) { c.moveTo(xx, yy); c.lineTo(xx, yy + bh); }
      }
      c.stroke();
      break;
    }
    case 'marble': {
      c.strokeStyle = 'rgba(150,140,175,0.55)'; c.lineWidth = 1.3 * pt;
      for (let i = 0; i < w / (h * 1.6); i++) {
        const x0 = x + (i + seed(i) * 0.6) * h * 1.6;
        c.beginPath(); c.moveTo(x0, y); c.bezierCurveTo(x0 + h * 0.4, y + h * 0.3, x0 - h * 0.2, y + h * 0.6, x0 + h * 0.5, y + h); c.stroke();
        c.lineWidth = 0.8 * pt; c.beginPath(); c.moveTo(x0 + h * 0.2, y + h * 0.4); c.lineTo(x0 + h * 0.7, y + h * 0.55); c.stroke(); c.lineWidth = 1.3 * pt;
      }
      c.fillStyle = '#D9B54A'; c.fillRect(x, y + h - h * 0.16, w, h * 0.06);
      break;
    }
    case 'log': {
      c.strokeStyle = 'rgba(90,50,20,0.45)'; c.lineWidth = 1.4 * pt;
      for (const f of [0.42, 0.66, 0.86]) { c.beginPath(); for (let xx = x; xx <= x + w; xx += 6 * pt) { const yy = y + h * f + Math.sin((xx - x) / (h * 0.9) + f * 9) * h * 0.04; if (xx > x) c.lineTo(xx, yy); else c.moveTo(xx, yy); } c.stroke(); }
      // Cut ends with rings.
      for (const ex of [x + h * 0.32, x + w - h * 0.32]) {
        c.fillStyle = '#E8C48E'; c.beginPath(); c.ellipse(ex, y + h * 0.52, h * 0.24, h * 0.36, 0, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(122,82,48,0.7)'; c.lineWidth = 1.2 * pt;
        for (const k of [0.2, 0.55, 0.9]) { c.beginPath(); c.ellipse(ex, y + h * 0.52, h * 0.24 * k, h * 0.36 * k, 0, 0, TAU); c.stroke(); }
      }
      break;
    }
    case 'ice': {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < w / (h * 1.4); i++) { const x0 = x + i * h * 1.4 + h * 0.2; c.beginPath(); c.moveTo(x0, y + h * 0.85); c.lineTo(x0 + h * 0.5, y + h * 0.25); c.lineTo(x0 + h * 0.66, y + h * 0.25); c.lineTo(x0 + h * 0.16, y + h * 0.85); c.closePath(); c.fill(); }
      c.fillStyle = '#FFFFFF'; for (let i = 0; i < w / (h * 2); i++) star4(c, x + (i + 0.5 + seed(i) * 0.4) * h * 2, y + h * (0.4 + seed(i + 7) * 0.3), 3 * pt);
      break;
    }
    case 'gold': {
      c.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < w / (h * 3); i++) { const x0 = x + i * h * 3 + h; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + h * 0.3, y); c.lineTo(x0 - h * 0.2, y + h); c.lineTo(x0 - h * 0.5, y + h); c.closePath(); c.fill(); }
      c.strokeStyle = 'rgba(160,100,10,0.55)'; c.lineWidth = 1.4 * pt;
      for (let xx = x + h * 1.5; xx < x + w - h * 0.5; xx += h * 1.5) { c.beginPath(); c.moveTo(xx, y + h * 0.3); c.lineTo(xx, y + h - 3 * pt); c.stroke(); }
      c.fillStyle = '#FFFFFF'; star4(c, x + w * 0.2, y + h * 0.4, 4 * pt); star4(c, x + w * 0.75, y + h * 0.6, 3 * pt);
      break;
    }
    case 'moss': {
      c.fillStyle = 'rgba(80,84,104,0.35)';
      for (let i = 0; i < w / (h * 0.8); i++) { c.beginPath(); c.ellipse(x + (i + 0.5) * h * 0.8, y + h * (0.5 + 0.2 * (i % 2)), h * 0.2, h * 0.12, 0, 0, TAU); c.fill(); }
      break;
    }
    case 'crystal': {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < w / h; i++) { const x0 = x + i * h; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + h * 0.5, y + h * 0.5); c.lineTo(x0, y + h); c.closePath(); c.fill(); }
      c.fillStyle = 'rgba(60,20,140,0.25)';
      for (let i = 0; i < w / h; i++) { const x0 = x + i * h + h * 0.5; c.beginPath(); c.moveTo(x0, y + h * 0.5); c.lineTo(x0 + h * 0.5, y); c.lineTo(x0 + h * 0.5, y + h); c.closePath(); c.fill(); }
      break;
    }
    case 'checker': {
      const g = h / 2; c.fillStyle = '#3A2E5C';
      for (let r0 = 0; r0 < 2; r0++) for (let i = 0; i * g < w; i++) if ((i + r0) % 2) c.fillRect(x + i * g, y + r0 * g, g, g);
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x, y, w, h * 0.16);
      break;
    }
    case 'bamboo': {
      c.strokeStyle = 'rgba(80,110,30,0.7)'; c.lineWidth = 1.6 * pt;
      c.beginPath(); c.moveTo(x, y + h * 0.5); c.lineTo(x + w, y + h * 0.5); c.stroke();
      for (const [f, off] of [[0.25, 0], [0.75, 0.5]]) for (let xx = x + h * (1.2 + off * 1.4); xx < x + w; xx += h * 2.8) {
        c.fillStyle = '#7FA33A'; c.fillRect(xx - 1.5 * pt, y + h * (f - 0.25), 3 * pt, h * 0.5);
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(xx + 2 * pt, y + h * (f - 0.2), 1.5 * pt, h * 0.4);
      }
      break;
    }
    case 'jelly': {
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.ellipse(x + w * 0.3, y + h * 0.3, w * 0.22, h * 0.1, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < w / (h * 0.7); i++) { c.beginPath(); circ(c, x + (i + seed(i)) * h * 0.7, y + h * (0.45 + seed(i + 3) * 0.35), h * (0.04 + seed(i + 5) * 0.04)); c.fill(); }
      break;
    }
    case 'toy': {
      const cols = ['#FF4F64', '#FFCC33', '#33C3F0', '#5ED15A', '#A35CFF', '#FF9A2E'], bw = h * 1.4;
      for (let i = 0; i * bw < w; i++) {
        c.fillStyle = cols[i % cols.length]; c.fillRect(x + i * bw, y, bw, h);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + i * bw, y, bw, h * 0.2);
        c.fillStyle = 'rgba(34,24,58,0.18)'; c.fillRect(x + i * bw, y + h * 0.82, bw, h * 0.18);
        c.strokeStyle = 'rgba(34,24,58,0.4)'; c.lineWidth = 1.2 * pt; c.beginPath(); c.moveTo(x + i * bw, y); c.lineTo(x + i * bw, y + h); c.stroke();
        for (const f of [0.3, 0.7]) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); circ(c, x + i * bw + bw * f, y + h * 0.52, h * 0.12); c.fill(); c.lineWidth = 1 * pt; c.strokeStyle = 'rgba(34,24,58,0.3)'; c.stroke(); }
      }
      break;
    }
    case 'cobble': {
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.strokeStyle = 'rgba(80,70,60,0.6)'; c.lineWidth = 1.3 * pt;
      for (let r0 = 0; r0 < 2; r0++) for (let i = 0, xx = x + (r0 ? -h * 0.3 : 0); xx < x + w; i++) {
        const sw = h * (0.7 + seed(i * 2 + r0) * 0.5);
        rr(c, xx + 1.5 * pt, y + r0 * h * 0.5 + 1.5 * pt, sw - 3 * pt, h * 0.5 - 3 * pt, h * 0.16); c.fill(); c.stroke();
        xx += sw;
      }
      break;
    }
    case 'cake': {
      // Sponge layers with a jam line, under pink icing.
      c.fillStyle = '#F2C891'; c.fillRect(x, y + h * 0.55, w, h * 0.45);
      c.fillStyle = '#E84F7A'; c.fillRect(x, y + h * 0.5, w, h * 0.1);
      c.fillStyle = '#FFB3CF'; c.fillRect(x, y, w, h * 0.34);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x, y, w, h * 0.08);
      const sp = ['#FFE066', '#7FE3F5', '#B9F27F', '#FFFFFF', '#A35CFF'];
      for (let i = 0; i < w / (h * 0.45); i++) {
        c.save(); c.translate(x + (i + 0.3 + seed(i) * 0.4) * h * 0.45, y + h * (0.12 + seed(i + 2) * 0.12)); c.rotate(seed(i + 9) * TAU);
        c.fillStyle = sp[i % sp.length]; rr(c, -h * 0.07, -h * 0.025, h * 0.14, h * 0.05, h * 0.025); c.fill(); c.restore();
      }
      break;
    }
    case 'steel': {
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x, y + h * 0.22, w, h * 0.06);
      c.strokeStyle = 'rgba(40,46,64,0.5)'; c.lineWidth = 1.3 * pt;
      for (let xx = x + h * 2; xx < x + w - h; xx += h * 2) { c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); }
      for (let i = 0; i < w / (h * 2); i++) for (const f of [0.22, 0.78]) {
        const bx = x + i * h * 2 + h * f * 2 * 0.5 + h * 0.25;
        c.fillStyle = '#5E6880'; c.beginPath(); circ(c, bx, y + h * 0.62, h * 0.07); c.fill();
        c.fillStyle = '#E4E9F2'; c.beginPath(); circ(c, bx - h * 0.02, y + h * 0.6, h * 0.035); c.fill();
      }
      // Status lights.
      for (let i = 0; i < w / (h * 4); i++) {
        const lx = x + (i + 0.5) * h * 4, ly = y + h * 0.48, g = c.createRadialGradient(lx, ly, 0, lx, ly, h * 0.22);
        g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.3, '#7FE3F5'); g.addColorStop(1, 'rgba(127,227,245,0)');
        c.fillStyle = g; c.fillRect(lx - h * 0.22, ly - h * 0.22, h * 0.44, h * 0.44);
      }
      break;
    }
    case 'obsidian': {
      // Glassy black rock with glowing lava cracks.
      c.fillStyle = 'rgba(160,140,220,0.3)';
      for (let i = 0; i < w / (h * 1.2); i++) { const x0 = x + i * h * 1.2; c.beginPath(); c.moveTo(x0, y + h * 0.2); c.lineTo(x0 + h * 0.6, y + h * 0.2); c.lineTo(x0 + h * 0.3, y + h * 0.6); c.closePath(); c.fill(); }
      c.lineWidth = 2.2 * pt;
      for (let i = 0; i < w / (h * 1.8); i++) {
        const x0 = x + (i + 0.3 + seed(i) * 0.4) * h * 1.8;
        c.save(); c.shadowColor = 'rgba(255,120,40,0.9)'; c.shadowBlur = 6 * pt; c.strokeStyle = '#FF7A2E';
        c.beginPath(); c.moveTo(x0, y + h * 0.3); c.lineTo(x0 + h * 0.15, y + h * 0.55); c.lineTo(x0 - h * 0.05, y + h * 0.75); c.lineTo(x0 + h * 0.1, y + h); c.stroke(); c.restore();
        c.strokeStyle = '#FFD666'; c.lineWidth = 0.9 * pt; c.beginPath(); c.moveTo(x0, y + h * 0.3); c.lineTo(x0 + h * 0.15, y + h * 0.55); c.lineTo(x0 - h * 0.05, y + h * 0.75); c.stroke(); c.lineWidth = 2.2 * pt;
      }
      break;
    }
  }
  c.restore();
  out();
  // Things that sit on or hang from the outline.
  if (kind === 'moss') {
    c.fillStyle = '#5ED15A';
    c.beginPath(); c.moveTo(x + r, y - 1 * pt);
    for (let xx = x + r; xx <= x + w - r; xx += h * 0.35) { const i = Math.round((xx - x) / (h * 0.35)), drip = seed(i) > 0.6 ? h * (0.3 + seed(i + 4) * 0.25) : h * 0.14; c.lineTo(xx, y + drip); c.lineTo(xx + h * 0.17, y + h * 0.1); }
    c.lineTo(x + w - r, y - 1 * pt); c.closePath(); c.fill(); c.lineWidth = 1.6 * pt; c.strokeStyle = INK; c.stroke();
    c.fillStyle = '#FFFFFF'; for (let i = 0; i < w / (h * 2.5); i++) { const fx = x + (i + 0.5) * h * 2.5; c.beginPath(); circ(c, fx, y + h * 0.08, h * 0.07); c.fill(); }
  } else if (kind === 'cake') {
    // Icing drips over the front.
    c.fillStyle = '#FFB3CF';
    for (let i = 0; i < w / (h * 0.6); i++) { if (seed(i + 11) < 0.45) continue; const dx = x + (i + 0.5) * h * 0.6, dl = h * (0.42 + seed(i + 13) * 0.2); rr(c, dx - h * 0.09, y + h * 0.2, h * 0.18, dl, h * 0.09); c.fill(); c.lineWidth = 1.4 * pt; c.strokeStyle = INK; c.stroke(); }
    c.fillStyle = '#FFB3CF'; c.fillRect(x + 2 * pt, y + 2 * pt, w - 4 * pt, h * 0.3);
    // Cherries on the ends.
    for (const cx of [x + h * 0.5, x + w - h * 0.5]) { c.beginPath(); circ(c, cx, y + h * 0.18, h * 0.16); c.fillStyle = '#FF4F64'; c.fill(); c.lineWidth = 1.6 * pt; c.strokeStyle = INK; c.stroke(); c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); circ(c, cx - h * 0.05, y + h * 0.13, h * 0.04); c.fill(); }
  } else if (kind === 'crystal') {
    // Crystals at the very ends, clear of the surface pieces rest on.
    for (const [cx, k] of [[x + h * 0.02, 0.9], [x + w - h * 0.02, 1.1]] as [number, number][]) {
      const ch = h * 0.7 * k;
      c.beginPath(); c.moveTo(cx - h * 0.18, y + h * 0.2); c.lineTo(cx - h * 0.12, y - ch * 0.4); c.lineTo(cx, y - ch * 0.7); c.lineTo(cx + h * 0.12, y - ch * 0.4); c.lineTo(cx + h * 0.18, y + h * 0.2); c.closePath();
      c.fillStyle = '#DCC8FF'; c.fill(); c.lineWidth = 1.8 * pt; c.strokeStyle = INK; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(cx - h * 0.1, y + h * 0.1); c.lineTo(cx - h * 0.07, y - ch * 0.35); c.lineTo(cx, y - ch * 0.6); c.lineTo(cx - h * 0.02, y + h * 0.1); c.closePath(); c.fill();
    }
  }
  c.restore();
  void dark;
}

/**
 * The starting pedestal in a foundation style: a tapered body down to the grass in the style's colours,
 * with its slab on top. Same footprint as slab.ts drawPedestal.
 */
export function drawFoundationPedestal(c: Ctx, x: number, y: number, w: number, h: number, s: number, legs: number, kind: FoundationKind, pt: number): void {
  const [fill, lip, dark] = FOUNDATION_COLORS[kind], by = y + h, bh = legs * s, inset = Math.min(w * 0.12, s * 0.7);
  c.save(); c.lineJoin = 'round';
  c.beginPath(); c.moveTo(x + inset, by - 2 * pt); c.lineTo(x + w - inset, by - 2 * pt); c.lineTo(x + w - inset * 0.6, by + bh); c.lineTo(x + inset * 0.6, by + bh); c.closePath();
  c.fillStyle = kind === 'checker' ? '#3A2E5C' : dark; c.fill(); c.lineWidth = 2.5 * pt; c.strokeStyle = INK; c.stroke();
  c.save(); c.clip();
  c.fillStyle = kind === 'checker' ? '#5A4C85' : fill; c.fillRect(x, by, w * 0.5, bh);
  c.fillStyle = 'rgba(34,24,58,0.22)'; c.fillRect(x, by + bh * 0.62, w, bh * 0.12);
  c.fillStyle = kind === 'checker' ? 'rgba(255,255,255,0.3)' : lip; c.globalAlpha = 0.7; c.fillRect(x, by + bh * 0.08, w, bh * 0.06); c.globalAlpha = 1;
  c.restore();
  c.fillStyle = dark;
  for (const fx of [x + inset * 0.6 - 2 * pt, x + w - inset * 0.6 - s * 0.45 + 2 * pt]) { rr(c, fx, by + bh - s * 0.12, s * 0.45, s * 0.2, s * 0.06); c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke(); }
  c.restore();
  drawFoundation(c, x, y, w, h, kind, pt);
}
