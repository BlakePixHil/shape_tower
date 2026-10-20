// Silhouette paths and face anchors for a posed shape (art-direction.md §4.1-4.3).
// Everything is in canvas space with the pose's bounding box at (0,0) and `s` pixels per block.

import { ART } from './config.ts';
import { pose, type Pose } from './shapes.ts';
import { TAU } from './util.ts';

/** Boundary corners of a polyomino, walked clockwise on screen: [x, y, +1 convex | -1 concave]. */
export function outlineCorners(cells: [number, number][]): [number, number, number][] {
  const set = new Set(cells.map(c => c[0] + ',' + c[1]));
  const has = (x: number, y: number) => set.has(x + ',' + y);
  const edges = new Map<string, [number, number]>();
  for (const [x, y] of cells) {
    if (!has(x, y - 1)) edges.set(x + ',' + y, [x + 1, y]);
    if (!has(x + 1, y)) edges.set((x + 1) + ',' + y, [x + 1, y + 1]);
    if (!has(x, y + 1)) edges.set((x + 1) + ',' + (y + 1), [x, y + 1]);
    if (!has(x - 1, y)) edges.set(x + ',' + (y + 1), [x, y]);
  }
  const start = edges.keys().next().value as string;
  const pts: [number, number][] = [];
  let cur = start;
  do {
    const [x, y] = cur.split(',').map(Number);
    pts.push([x, y]);
    const n = edges.get(cur)!;
    cur = n[0] + ',' + n[1];
  } while (cur !== start && pts.length < 400);
  const out: [number, number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr !== 0) out.push([b[0], b[1], cr > 0 ? 1 : -1]);
  }
  return out;
}

/** The piece silhouette as a Path2D. Convex corners use the shared physics radius; concave corners stay sharp. */
export function silhouette(p: Pose, s: number, radius: number = ART.cornerRadius): Path2D {
  const path = new Path2D();
  const r = Math.max(0.001, radius * s);
  if (p.circle) {
    path.arc(p.w * s / 2, p.h * s / 2, p.circle * s / 2, 0, TAU);
  } else if (p.tri) {
    const v = p.tri;
    const m: [number, number] = [(v[2][0] + v[0][0]) / 2, (v[2][1] + v[0][1]) / 2];
    path.moveTo(m[0] * s, m[1] * s);
    for (let i = 0; i < 3; i++) { const a = v[i], b = v[(i + 1) % 3]; path.arcTo(a[0] * s, a[1] * s, b[0] * s, b[1] * s, r); }
    path.closePath();
  } else {
    const vs = outlineCorners(p.cells);
    const n = vs.length, last = vs[n - 1], first = vs[0];
    path.moveTo((last[0] + first[0]) / 2 * s, (last[1] + first[1]) / 2 * s);
    for (let i = 0; i < n; i++) {
      const a = vs[i], b = vs[(i + 1) % n];
      path.arcTo(a[0] * s, a[1] * s, b[0] * s, b[1] * s, a[2] > 0 ? r : 0.001);
    }
    path.closePath();
  }
  return path;
}

/**
 * Where the face sits, in blocks from the pose's top-left (y down): the centroid when a
 * 0.6-block square around it is inside the shape, otherwise the centre of the nearest cell (§4.3).
 */
export function faceAnchor(p: Pose): [number, number] {
  if (p.circle) return [p.w / 2, p.h / 2 + 0.04];
  if (p.tri) {
    const cx = (p.tri[0][0] + p.tri[1][0] + p.tri[2][0]) / 3, cy = (p.tri[0][1] + p.tri[1][1] + p.tri[2][1]) / 3;
    return [cx, cy + 0.05];
  }
  const set = new Set(p.cells.map(c => c[0] + ',' + c[1]));
  const inside = (x: number, y: number) => set.has(Math.floor(x) + ',' + Math.floor(y));
  let cx = 0, cy = 0;
  for (const [x, y] of p.cells) { cx += x + 0.5; cy += y + 0.5; }
  cx /= p.cells.length; cy /= p.cells.length;
  const d = 0.3;
  if (inside(cx - d, cy - d) && inside(cx + d, cy - d) && inside(cx - d, cy + d) && inside(cx + d, cy + d)) return [cx, cy];
  let best: [number, number] = [p.cells[0][0] + 0.5, p.cells[0][1] + 0.5], bd = Infinity;
  for (const [x, y] of p.cells) {
    const dd = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
    if (dd < bd) { bd = dd; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}

/** Face anchor for a shape key and rotation. */
export const faceAt = (key: string, q: number): [number, number] => faceAnchor(pose(key, q));
