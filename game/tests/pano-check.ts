// The run-over panorama's camera path (view/panoTrack.ts) on made-up towers: a straight one stays put,
// a crooked one stays whole in frame at every height of the glide, the camera moves smoothly (no jumps
// in where it looks or how far out it is), and a lean wider than the most zoom keeps its middle in view.
//   npm run pano:check

import { panoTrack, pieceBoxes, trackAt, type PanoBox } from '../src/view/panoTrack.ts';
import { geometry } from '../src/sim/shapes.ts';

const ACROSS = 12, MAX = 30, ASPECT = 825 / 448; // Blake's phone
const MARGIN = 1, SLAB = 3;
let failed = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`);
  if (!ok) failed++;
};

interface Tower { cells: PanoBox[]; boxes: PanoBox[]; top: number }

/** A tower of shapes at the given centres, one row of shapes per 2 blocks, with a plinth and slabs every 20 blocks. */
function tower(xAt: (y: number) => number, height: number, angle = 0): Tower {
  const cells: PanoBox[] = [], boxes: PanoBox[] = [];
  const add = (b: PanoBox[], m: number) => {
    for (let y = 1; y < height; y += 2) {
      const c = Math.cos(angle), s = Math.sin(angle);
      pieceBoxes(b, geometry('O').cells, xAt(y), y, c, s, m);
      pieceBoxes(b, geometry('I').cells, xAt(y) + 2, y - 0.5, 0, 1, m); // stood up beside it
    }
  };
  add(cells, 0);
  add(boxes, MARGIN);
  const slab = (x: number, w: number, top: number, t: number) => {
    cells.push({ x0: x - w / 2, x1: x + w / 2, y0: top - t, y1: top });
    boxes.push({ x0: x - (w + SLAB) / 2, x1: x + (w + SLAB) / 2, y0: top - t, y1: top });
  };
  slab(0, 12, 0, 1);
  for (let y = 20; y < height; y += 20) slab(Math.round(xAt(y)), 6, y, 0.5);
  return { cells, boxes, top: height };
}

/** Glides the path from the top to the ground like the scene does and measures it. */
function glide(t: Tower) {
  const from = t.top + 0.1 * ACROSS * ASPECT;
  const track = panoTrack(t.boxes, -1, from, { aspect: ASPECT, minAcross: ACROSS, maxAcross: MAX, fallbackX: 0 });
  let to = -1 + 0.3 * ASPECT * trackAt(track, -1).across;
  for (let i = 0; i < 4; i++) to = -1 + 0.3 * ASPECT * trackAt(track, to).across;
  let cut = 0, worst = 0, cutAt = NaN, maxDx = 0, maxDa = 0, maxAcross = 0, prev: { x: number; across: number } | null = null;
  let jerk = 0, prevD: { x: number; across: number } | null = null;
  const frames = 270; // 4.5 s at 60 FPS, the longest glide
  for (let f = 0; f <= frames; f++) {
    const u = f / frames, e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const y = from + (to - from) * e;
    const at = trackAt(track, y);
    const half = (at.across * ASPECT) / 2, l = at.x - at.across / 2, r = at.x + at.across / 2;
    for (const c of t.cells) {
      if (c.y1 < y - half || c.y0 > y + half) continue;
      const out = Math.max(l - c.x0, c.x1 - r, 0);
      if (out > 1e-6) { cut++; if (out > worst) { worst = out; cutAt = y; } }
    }
    if (prev) {
      const d = { x: at.x - prev.x, across: at.across - prev.across };
      if (prevD) jerk = Math.max(jerk, Math.abs(d.x - prevD.x), Math.abs(d.across - prevD.across));
      prevD = d;
    }
    maxAcross = Math.max(maxAcross, at.across);
    prev = at;
  }
  // How fast it moves sideways and zooms per block of the glide down.
  for (let i = 1; i < track.x.length; i++) {
    maxDx = Math.max(maxDx, Math.abs(track.x[i] - track.x[i - 1]) / track.step);
    maxDa = Math.max(maxDa, Math.abs(track.across[i] - track.across[i - 1]) / track.step);
  }
  return { track, to, cut, worst, cutAt, maxDx, maxDa, maxAcross, jerk };
}

// A straight tower: nothing moves, nothing zooms.
{
  const g = glide(tower(() => 0, 80));
  const xs = [...g.track.x];
  check('straight tower: whole in frame', g.cut === 0, `${g.cut} cut, worst ${g.worst.toFixed(2)}`);
  check('straight tower: camera barely moves sideways', Math.max(...xs) - Math.min(...xs) < 1.2, `x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}`);
  check('straight tower: no zoom past the plinth view', g.maxAcross <= 15.01, `most ${g.maxAcross.toFixed(2)} across`);
}

// A tower that drifts right 14 blocks over 90 (the case Blake saw): the old camera stayed on the top.
{
  const lean = (y: number) => (14 * y) / 90;
  const t = tower(lean, 90);
  const g = glide(t);
  check('leaning tower: whole in frame at every height', g.cut === 0, `${g.cut} cut, worst ${g.worst.toFixed(2)} at y ${g.cutAt.toFixed(1)}`);
  check('leaning tower: follows the lean', Math.abs(trackAt(g.track, 70).x - (lean(70) + 1)) < 2 && Math.abs(trackAt(g.track, 25).x - (lean(25) + 1)) < 2,
    `x at 70: ${trackAt(g.track, 70).x.toFixed(2)}, at 25: ${trackAt(g.track, 25).x.toFixed(2)}`);
  check('leaning tower: eases sideways (under 0.6 blocks across per block down)', g.maxDx < 0.6, `${g.maxDx.toFixed(3)}`);
  check('leaning tower: no sudden starts or stops (under 0.02 blocks a frame change)', g.jerk < 0.02, `${g.jerk.toFixed(4)}`);
  // The old panorama: x fixed at the top, 12 across.
  const half = (ACROSS * ASPECT) / 2, x = lean(88);
  let old = 0;
  for (let y = g.to; y <= 90; y += 0.5) for (const c of t.cells) if (!(c.y1 < y - half || c.y0 > y + half) && (c.x0 < x - 6 || c.x1 > x + 6)) { old++; break; }
  check('leaning tower: the old fixed camera cut it off (the bug)', old > 0, `${old} heights cut`);
}

// A zigzag: shifts of 6 blocks every 20, sharp corners in the tower.
{
  const zig = (y: number) => (Math.floor(y / 20) % 2 ? 6 : 0);
  const g = glide(tower(zig, 100));
  check('zigzag tower: whole in frame at every height', g.cut === 0, `${g.cut} cut, worst ${g.worst.toFixed(2)} at y ${g.cutAt.toFixed(1)}`);
  check('zigzag tower: eases sideways (under 0.6 blocks per block down)', g.maxDx < 0.6, `${g.maxDx.toFixed(3)}`);
  check('zigzag tower: eases its zoom (under 0.8 blocks per block down)', g.maxDa < 0.8, `${g.maxDa.toFixed(3)}`);
  check('zigzag tower: no sudden starts or stops (under 0.02 blocks a frame change)', g.jerk < 0.02, `${g.jerk.toFixed(4)}`);
}

// Wider than one screen within one screen's height: zooms out, still whole.
{
  const wide = (y: number) => 10 * Math.sin(y / 6);
  const g = glide(tower(wide, 60));
  check('wild tower: zooms out to fit', g.maxAcross > 20, `most ${g.maxAcross.toFixed(1)} across`);
  check('wild tower: never past the most zoom', g.maxAcross <= MAX + 1e-6);
  check('wild tower: whole in frame at every height', g.cut === 0, `${g.cut} cut, worst ${g.worst.toFixed(2)} at y ${g.cutAt.toFixed(1)}`);
  check('wild tower: eases its zoom (under 0.8 blocks per block down)', g.maxDa < 0.8, `${g.maxDa.toFixed(3)}`);
  check('wild tower: no sudden starts or stops (under 0.03 blocks a frame change)', g.jerk < 0.03, `${g.jerk.toFixed(4)}`);
}

// Too wide for the most zoom: the middle stays in view.
{
  const cells: PanoBox[] = [{ x0: -40, x1: -38, y0: 0, y1: 4 }, { x0: 38, x1: 40, y0: 0, y1: 4 }];
  const track = panoTrack(cells, -1, 10, { aspect: ASPECT, minAcross: ACROSS, maxAcross: MAX, fallbackX: 0 });
  const at = trackAt(track, 4);
  check('too wide: most zoom, centred on the middle', Math.abs(at.across - MAX) < 1e-6 && Math.abs(at.x) < 1e-6, `${at.across.toFixed(1)} across at x ${at.x.toFixed(2)}`);
}

// Nothing to show: the fallback.
{
  const track = panoTrack([], -1, 10, { aspect: ASPECT, minAcross: ACROSS, maxAcross: MAX, fallbackX: 3 });
  const at = trackAt(track, 5);
  check('empty: looks at the fallback, no zoom', at.x === 3 && at.across === ACROSS);
}

// A tall tower stays quick to plan (it runs once, as the run ends).
{
  const t = tower(y => 5 * Math.sin(y / 40), 1200);
  const t0 = performance.now();
  panoTrack(t.boxes, -1, 1210, { aspect: ASPECT, minAcross: ACROSS, maxAcross: MAX, fallbackX: 0 });
  const ms = performance.now() - t0;
  check('1,200-block tower plans in under 60 ms', ms < 60, `${ms.toFixed(1)} ms, ${t.boxes.length} boxes`);
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('pano check: all passed');
