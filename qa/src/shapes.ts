// Shape outlines in blocks, at rot 0, as the fewest rectangles (gameplay.md §3.2 and §4.1).
// Rect origins are cell coordinates from the bottom-left of the shape's bounding box.

export interface CellRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface ShapeDef {
  id: string;
  width: number;
  height: number;
  rects: CellRect[];
}

const defs: ShapeDef[] = [
  { id: 'O', width: 2, height: 2, rects: [{ x0: 0, y0: 0, w: 2, h: 2 }] },
  { id: 'I', width: 4, height: 1, rects: [{ x0: 0, y0: 0, w: 4, h: 1 }] },
  // T points up at rot 0 (flat side down).
  { id: 'T', width: 3, height: 2, rects: [{ x0: 0, y0: 0, w: 3, h: 1 }, { x0: 1, y0: 1, w: 1, h: 1 }] },
  { id: 'L', width: 3, height: 2, rects: [{ x0: 0, y0: 0, w: 3, h: 1 }, { x0: 2, y0: 1, w: 1, h: 1 }] },
  { id: 'J', width: 3, height: 2, rects: [{ x0: 0, y0: 0, w: 3, h: 1 }, { x0: 0, y0: 1, w: 1, h: 1 }] },
  { id: 'S', width: 3, height: 2, rects: [{ x0: 0, y0: 0, w: 2, h: 1 }, { x0: 1, y0: 1, w: 2, h: 1 }] },
  { id: 'Z', width: 3, height: 2, rects: [{ x0: 1, y0: 0, w: 2, h: 1 }, { x0: 0, y0: 1, w: 2, h: 1 }] },
  { id: 'Domino', width: 2, height: 1, rects: [{ x0: 0, y0: 0, w: 2, h: 1 }] },
  { id: 'Plank', width: 5, height: 1, rects: [{ x0: 0, y0: 0, w: 5, h: 1 }] },
  { id: 'P', width: 2, height: 3, rects: [{ x0: 0, y0: 0, w: 2, h: 2 }, { x0: 0, y0: 2, w: 1, h: 1 }] },
  { id: 'U', width: 3, height: 2, rects: [{ x0: 0, y0: 0, w: 3, h: 1 }, { x0: 0, y0: 1, w: 1, h: 1 }, { x0: 2, y0: 1, w: 1, h: 1 }] },
  { id: 'V', width: 3, height: 3, rects: [{ x0: 0, y0: 0, w: 3, h: 1 }, { x0: 0, y0: 1, w: 1, h: 2 }] },
  { id: 'Plus', width: 3, height: 3, rects: [{ x0: 0, y0: 1, w: 3, h: 1 }, { x0: 1, y0: 0, w: 1, h: 1 }, { x0: 1, y0: 2, w: 1, h: 1 }] },
  { id: 'Arch', width: 3, height: 2, rects: [{ x0: 0, y0: 1, w: 3, h: 1 }, { x0: 0, y0: 0, w: 1, h: 1 }, { x0: 2, y0: 0, w: 1, h: 1 }] },
];

export const SHAPES: Record<string, ShapeDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Tier 0 and 1 shapes, the ones every build must handle first. */
export const CORE_SHAPES = ['O', 'I', 'T', 'L', 'J', 'S', 'Z'];
export const RECT_SHAPES = defs.map((d) => d.id);

/** Exact quarter-turn rotation, with no trig: [cos, sin] for rot 0..3. */
export const QUARTER: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function normRot(rot: number): number {
  return ((rot % 4) + 4) % 4;
}

/** A rect relative to the bounding-box centre, in the shape's rot 0 frame. */
export interface LocalRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function localRects(shape: string): LocalRect[] {
  const d = SHAPES[shape];
  if (!d) throw new Error(`Unknown shape ${shape}`);
  return d.rects.map((r) => ({
    cx: r.x0 + r.w / 2 - d.width / 2,
    cy: r.y0 + r.h / 2 - d.height / 2,
    w: r.w,
    h: r.h,
  }));
}

/** Bounding-box size after rotation. */
export function rotatedSize(shape: string, rot: number): { w: number; h: number } {
  const d = SHAPES[shape];
  return normRot(rot) % 2 === 0 ? { w: d.width, h: d.height } : { w: d.height, h: d.width };
}

/** Centre of mass relative to the bbox centre at rot 0 (uniform density, cell based). */
export function localCentreOfMass(shape: string): { x: number; y: number } {
  let area = 0;
  let mx = 0;
  let my = 0;
  for (const r of localRects(shape)) {
    const a = r.w * r.h;
    area += a;
    mx += r.cx * a;
    my += r.cy * a;
  }
  return { x: mx / area, y: my / area };
}

export interface Corner {
  x: number;
  y: number;
}

/**
 * World-space corners of each rect of a piece at (x, y, angle), shrunk by `inset` per side.
 * Harness-side geometry only, so trig is fine here.
 */
export function worldRects(shape: string, x: number, y: number, angle: number, inset = 0): Corner[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return localRects(shape).map((r) => {
    const hw = r.w / 2 - inset;
    const hh = r.h / 2 - inset;
    const pts: [number, number][] = [
      [r.cx - hw, r.cy - hh],
      [r.cx + hw, r.cy - hh],
      [r.cx + hw, r.cy + hh],
      [r.cx - hw, r.cy + hh],
    ];
    return pts.map(([px, py]) => ({ x: x + c * px - s * py, y: y + s * px + c * py }));
  });
}

/** Separating-axis overlap depth of two convex quads; 0 when they don't overlap. */
export function overlapDepth(a: Corner[], b: Corner[]): number {
  let min = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y);
      const ay = q.x - p.x;
      const len = Math.hypot(ax, ay);
      const nx = ax / len;
      const ny = ay / len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.y * ny;
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      for (const v of b) {
        const d = v.x * nx + v.y * ny;
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      const o = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (o <= 0) return 0;
      min = Math.min(min, o);
    }
  }
  return min;
}
