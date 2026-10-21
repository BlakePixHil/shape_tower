// A made-up tower for the panorama and share card previews: pieces dropped Tetris-style onto a
// 6-wide foundation, a new slab (a little off-centre) at each checkpoint, everything under a claim in stone.

import { pose, type PanoramaData, type TowerPiece, type TowerSlab } from '../src/index.ts';

const KEYS = ['I', 'O', 'T', 'L', 'J', 'S', 'Z', 'Domino', 'Plank'];

export function demoTower(height = 63.4, seed = 7): PanoramaData {
  let r = seed * 2654435761 % 4294967296 || 1;
  const rnd = (): number => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const cps: number[] = [];
  for (let n = 1, h = 0; n <= 30; n++) { h += 10 + Math.min(n, 14) * 0.6; cps.push(Math.round(h * 2) / 2); }
  const slabs: TowerSlab[] = [{ x: 0, top: 0, width: 6 }], pieces: TowerPiece[] = [];
  let base = 0, cx = 0, hm = [0, 0, 0, 0, 0, 0], claimed = 0, segStart = 0;
  while (base + Math.max(...hm) < height) {
    const key = KEYS[Math.floor(rnd() * KEYS.length)], q = Math.floor(rnd() * 4), p = pose(key, q);
    if (p.w > 6) continue;
    const col = Math.floor(rnd() * (7 - p.w));
    // Lowest rest: every cell clears the column heights under it (cells are y down inside the pose).
    let land = 0;
    for (const [x, y] of p.cells) land = Math.max(land, hm[col + x] - (p.h - 1 - y));
    for (const [x, y] of p.cells) hm[col + x] = Math.max(hm[col + x], land + (p.h - y));
    pieces.push({ shape: key, x: cx - 3 + col + p.w / 2, y: base + land + p.h / 2, angle: q * Math.PI / 2 + (rnd() - 0.5) * 0.06 });
    // A checkpoint: the stretch below turns to stone and a new slab lands on top, a little off-centre.
    const top = base + Math.min(...hm);
    if (claimed < cps.length && top >= cps[claimed] - 0.5) {
      for (let i = segStart; i < pieces.length; i++) pieces[i].stone = true;
      segStart = pieces.length;
      base = base + Math.max(...hm) + 0.2;
      cx += (rnd() - 0.5) * 1.2;
      slabs.push({ x: cx, top: base, width: 6 });
      hm = [0, 0, 0, 0, 0, 0];
      while (claimed < cps.length && cps[claimed] < base + 4) claimed++;
    }
  }
  return { pieces, slabs, top: height, pb: height * 0.82 };
}
