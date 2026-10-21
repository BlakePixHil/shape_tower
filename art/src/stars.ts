// The star field (art-direction.md §9.3): three depths of procedural stars as small repeating
// tiles, so they cost almost no memory. The Backdrop scrolls each at its own rate and twinkles it,
// fading the whole field in with starAmount(sky position).

import { circ, ctx2d, hash, makeCanvas } from './util.ts';

export interface StarLayer {
  /** Tile size in texture px. Different sizes per layer hide the repeat. */
  size: number;
  count: number;
  /** Star radius range in texture px. */
  r: [number, number];
  /** Scroll factor while climbing. */
  factor: number;
  /** Twinkle depth 0..1 and rate in Hz. */
  twinkle: number;
  hz: number;
}

/** Far to near. Sizes are in texture px at 1 texture px per screen px; scale them by k. */
export const STAR_LAYERS: StarLayer[] = [
  { size: 384, count: 70, r: [0.5, 1.1], factor: 0.01, twinkle: 0.2, hz: 0.31 },
  { size: 448, count: 34, r: [0.9, 1.6], factor: 0.025, twinkle: 0.35, hz: 0.47 },
  { size: 512, count: 12, r: [1.4, 2.4], factor: 0.05, twinkle: 0.5, hz: 0.73 },
];

const TINTS = ['#FFFFFF', '#FFFFFF', '#FFF4D6', '#DDE8FF', '#FFE3F4'];

/** One repeating tile of stars for layer `i`, at k texture px per screen px. */
export function bakeStarTile(i: number, k: number): HTMLCanvasElement {
  const L = STAR_LAYERS[i], size = Math.round(L.size * k), cv = makeCanvas(size, size), c = ctx2d(cv);
  for (let n = 0; n < L.count; n++) {
    const x = hash(i * 1000 + n * 3.1) * size, y = hash(i * 1000 + n * 7.3) * size;
    const r = (L.r[0] + (L.r[1] - L.r[0]) * hash(i * 1000 + n * 1.7)) * k, col = TINTS[n % TINTS.length];
    // Draw wrapped copies near the edges so the tile repeats seamlessly.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const px = x + dx, py = y + dy;
      if (px < -r * 4 || px > size + r * 4 || py < -r * 4 || py > size + r * 4) continue;
      const g = c.createRadialGradient(px, py, 0, px, py, r * 3);
      g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); circ(c, px, py, r * 3); c.fill();
      c.fillStyle = col; c.beginPath(); circ(c, px, py, r); c.fill();
      if (i === 2 && n % 3 === 0) {
        c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(0.5, r * 0.35);
        c.beginPath(); c.moveTo(px - r * 3, py); c.lineTo(px + r * 3, py); c.moveTo(px, py - r * 3); c.lineTo(px, py + r * 3); c.stroke();
      }
    }
  }
  return cv;
}
