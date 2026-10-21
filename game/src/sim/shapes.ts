// Shape definitions (gameplay.md §4.1) with Art's palette (art-direction.md §3.2).
// Cells are in rotation 0, x right, y up. Rects are the fewest rectangles covering the cells (§3.2).

export interface Rect { x: number; y: number; w: number; h: number }

export interface ShapeDef {
  key: string;
  name: string;
  tier: number;
  cells: [number, number][];
  rects: Rect[];
  colors: { hi: number; base: number; lo: number };
}

const S = (key: string, name: string, tier: number, cells: [number, number][], rects: Rect[], hi: number, base: number, lo: number): ShapeDef =>
  ({ key, name, tier, cells, rects, colors: { hi, base, lo } });

export const SHAPES: Record<string, ShapeDef> = {
  I: S('I', 'Sky Bar', 0, [[0, 0], [1, 0], [2, 0], [3, 0]], [{ x: 0, y: 0, w: 4, h: 1 }], 0x9be6ff, 0x33c3f0, 0x1e8bc3),
  O: S('O', 'Butterblock', 0, [[0, 0], [1, 0], [0, 1], [1, 1]], [{ x: 0, y: 0, w: 2, h: 2 }], 0xffe58f, 0xffcc33, 0xe0a100),
  T: S('T', 'Grape Tee', 0, [[0, 0], [1, 0], [2, 0], [1, 1]], [{ x: 0, y: 0, w: 3, h: 1 }, { x: 1, y: 1, w: 1, h: 1 }], 0xd0a8ff, 0xa35cff, 0x6f35d1),
  L: S('L', 'Tangerine Ell', 0, [[0, 0], [1, 0], [2, 0], [2, 1]], [{ x: 0, y: 0, w: 3, h: 1 }, { x: 2, y: 1, w: 1, h: 1 }], 0xffcb85, 0xff9a2e, 0xd96f0a),
  J: S('J', 'Berry Jay', 0, [[0, 0], [1, 0], [2, 0], [0, 1]], [{ x: 0, y: 0, w: 3, h: 1 }, { x: 0, y: 1, w: 1, h: 1 }], 0x9db3ff, 0x4a72ff, 0x2c4bd1),
  S: S('S', 'Lime Zig', 1, [[0, 0], [1, 0], [1, 1], [2, 1]], [{ x: 0, y: 0, w: 2, h: 1 }, { x: 1, y: 1, w: 2, h: 1 }], 0xa9f09a, 0x5ed15a, 0x34a13a),
  Z: S('Z', 'Cherry Zag', 1, [[1, 0], [2, 0], [0, 1], [1, 1]], [{ x: 1, y: 0, w: 2, h: 1 }, { x: 0, y: 1, w: 2, h: 1 }], 0xff9daa, 0xff4f64, 0xcc2e48),
  Domino: S('Domino', 'Gumdrop', 2, [[0, 0], [1, 0]], [{ x: 0, y: 0, w: 2, h: 1 }], 0xf7a3ec, 0xe84fd0, 0xb52ea0),
  Plank: S('Plank', 'Plank', 2, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], [{ x: 0, y: 0, w: 5, h: 1 }], 0xf2c891, 0xd9a066, 0xa8723e),
  // Tier 3 (Storm Belt) and tier 6 (Red Planet). Wedge (tier 4) and Boulder (tier 5) need a triangle
  // and a circle collider, which the engines don't take yet.
  P: S('P', 'Teal P', 3, [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]], [{ x: 0, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 1, h: 1 }], 0x8deedf, 0x22c7b2, 0x12907f),
  U: S('U', 'Lime U', 3, [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]], [{ x: 0, y: 0, w: 3, h: 1 }, { x: 0, y: 1, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 1 }], 0xd8f48a, 0xa9dd2f, 0x79a814),
  V: S('V', 'Navy V', 3, [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], [{ x: 0, y: 0, w: 3, h: 1 }, { x: 0, y: 1, w: 1, h: 2 }], 0x8e95f2, 0x3d46b8, 0x262c85),
  Arch: S('Arch', 'Brick Arch', 6, [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], [{ x: 0, y: 1, w: 3, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }], 0xf09a7c, 0xd2694a, 0xa3452c),
  Plus: S('Plus', 'Star Plus', 6, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [{ x: 1, y: 0, w: 1, h: 3 }, { x: 0, y: 1, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 1 }], 0xffffff, 0xe9e6fa, 0xb9b2de),
};

/** Local geometry relative to the shape's pivot (centre of its bounding box). */
export interface LocalBox { cx: number; cy: number; hw: number; hh: number }

export interface ShapeGeometry {
  def: ShapeDef;
  pivotX: number;
  pivotY: number;
  cells: [number, number][];   // cell centres relative to pivot
  boxes: LocalBox[];           // collider boxes before inset/rounding, relative to pivot
  com: [number, number];       // centre of mass (uniform density) relative to pivot
  width: number;
  height: number;
}

const cache = new Map<string, ShapeGeometry>();

export function geometry(key: string): ShapeGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const def = SHAPES[key];
  let maxX = 0, maxY = 0;
  for (const [x, y] of def.cells) { maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); }
  const px = maxX / 2, py = maxY / 2;
  const cells = def.cells.map(([x, y]) => [x + 0.5 - px, y + 0.5 - py] as [number, number]);
  let comX = 0, comY = 0;
  for (const [x, y] of cells) { comX += x; comY += y; }
  comX /= cells.length; comY /= cells.length;
  const boxes = def.rects.map(r => ({ cx: r.x + r.w / 2 - px, cy: r.y + r.h / 2 - py, hw: r.w / 2, hh: r.h / 2 }));
  const g: ShapeGeometry = { def, pivotX: px, pivotY: py, cells, boxes, com: [comX, comY], width: maxX, height: maxY };
  cache.set(key, g);
  return g;
}

/** Which sides of a rect are fully covered by other cells of the same shape (so they shouldn't be inset). */
export function internalSides(def: ShapeDef, r: Rect): { left: boolean; right: boolean; bottom: boolean; top: boolean } {
  const has = (x: number, y: number) => def.cells.some(([cx, cy]) => cx === x && cy === y);
  const range = (a: number, n: number) => Array.from({ length: n }, (_, i) => a + i);
  return {
    left: range(r.y, r.h).every(y => has(r.x - 1, y)),
    right: range(r.y, r.h).every(y => has(r.x + r.w, y)),
    bottom: range(r.x, r.w).every(x => has(x, r.y - 1)),
    top: range(r.x, r.w).every(x => has(x, r.y + r.h)),
  };
}

/** Collider boxes after inset and corner rounding: core half-extents plus the rounding radius. */
export interface ColliderBox { cx: number; cy: number; hw: number; hh: number; radius: number }

const colliderCache = new Map<string, ColliderBox[]>();

/**
 * Collider boxes for a shape placed at quarter turn q. The inset only applies to faces that point
 * sideways in the world, so neighbours never wedge but stacked pieces add up to exact heights.
 */
export function colliderBoxes(key: string, q: number, inset: number, radius: number): ColliderBox[] {
  const ck = `${key}|${((q % 4) + 4) % 4}|${inset}|${radius}`;
  const hit = colliderCache.get(ck);
  if (hit) return hit;
  const g = geometry(key);
  const sideways = ((q % 2) + 2) % 2 === 0;
  const ix = sideways ? inset : 0, iy = sideways ? 0 : inset;
  const out = g.def.rects.map(r => {
    const s = internalSides(g.def, r);
    // Outer sides shrink by the inset; internal sides reach into the neighbour so there is no notch.
    let x0 = r.x + (s.left ? -radius : ix), x1 = r.x + r.w - (s.right ? -radius : ix);
    let y0 = r.y + (s.bottom ? -radius : iy), y1 = r.y + r.h - (s.top ? -radius : iy);
    // Core polygon is shrunk by the radius; the radius adds it back as a rounded skin.
    x0 += radius; x1 -= radius; y0 += radius; y1 -= radius;
    return { cx: (x0 + x1) / 2 - g.pivotX, cy: (y0 + y1) / 2 - g.pivotY, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2, radius };
  });
  colliderCache.set(ck, out);
  return out;
}

// ---- Exact quarter-turn rotation (no trig in the sim) ----

export interface Rot { c: number; s: number }
export const QUARTER: Rot[] = [{ c: 1, s: 0 }, { c: 0, s: 1 }, { c: -1, s: 0 }, { c: 0, s: -1 }];

export function rotQ(q: number): Rot { return QUARTER[((q % 4) + 4) % 4]; }

export function rotate(r: Rot, x: number, y: number): [number, number] {
  return [r.c * x - r.s * y, r.s * x + r.c * y];
}

/** Axis-aligned extents of a shape at a quarter-turn rotation, relative to the pivot. */
export function extents(key: string, q: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const g = geometry(key);
  const r = rotQ(q);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [cx, cy] of g.cells) {
    const [x, y] = rotate(r, cx, cy);
    minX = Math.min(minX, x - 0.5); maxX = Math.max(maxX, x + 0.5);
    minY = Math.min(minY, y - 0.5); maxY = Math.max(maxY, y + 0.5);
  }
  return { minX, maxX, minY, maxY };
}

/** Which cells have no cell of the same shape directly below them, at a quarter-turn rotation (relative to pivot). */
export function bottomCells(key: string, q: number): [number, number][] {
  const g = geometry(key);
  const r = rotQ(q);
  const pts = g.cells.map(([x, y]) => rotate(r, x, y));
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return pts.filter(([x, y]) => !pts.some(([x2, y2]) => eq(x2, x) && eq(y2, y - 1)));
}
