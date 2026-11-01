// Art's view of the shape set (art-direction.md §3.2, Gameplay §4.1).
// Keys and rotation-0 cells match the sim's shapes.ts: integer [col,row], x right, y up, row 0 at the bottom.
// Rotation q is q quarter turns counter-clockwise in that y-up world, about the centre of the cells'
// bounding box (the body origin).

export type Material = 'wood' | 'candy' | 'glass' | 'basalt' | 'brick' | 'gem';

export interface ArtShape {
  key: string;
  name: string;
  tier: number;
  light: string;
  base: string;
  shade: string;
  material?: Material;
  /** Polyomino cells in rotation 0 (y up). Absent for the custom shapes. */
  cells?: [number, number][];
  custom?: 'wedge' | 'boulder';
}

const S = (key: string, name: string, tier: number, [light, base, shade]: string[], cells: [number, number][] | null, extra: Partial<ArtShape> = {}): ArtShape =>
  ({ key, name, tier, light, base, shade, ...(cells ? { cells } : {}), ...extra });

export const ART_SHAPES: Record<string, ArtShape> = {
  I: S('I', 'Sky Bar', 0, ['#9BE6FF', '#33C3F0', '#1E8BC3'], [[0, 0], [1, 0], [2, 0], [3, 0]]),
  O: S('O', 'Butterblock', 0, ['#FFE58F', '#FFCC33', '#E0A100'], [[0, 0], [1, 0], [0, 1], [1, 1]]),
  T: S('T', 'Grape Tee', 0, ['#D0A8FF', '#A35CFF', '#6F35D1'], [[0, 0], [1, 0], [2, 0], [1, 1]]),
  L: S('L', 'Tangerine Ell', 0, ['#FFCB85', '#FF9A2E', '#D96F0A'], [[0, 0], [1, 0], [2, 0], [2, 1]]),
  J: S('J', 'Berry Jay', 0, ['#9DB3FF', '#4A72FF', '#2C4BD1'], [[0, 0], [1, 0], [2, 0], [0, 1]]),
  S: S('S', 'Lime Zig', 1, ['#A9F09A', '#5ED15A', '#34A13A'], [[0, 0], [1, 0], [1, 1], [2, 1]]),
  Z: S('Z', 'Cherry Zag', 1, ['#FF9DAA', '#FF4F64', '#CC2E48'], [[1, 0], [2, 0], [0, 1], [1, 1]]),
  Domino: S('Domino', 'Gumdrop', 2, ['#F7A3EC', '#E84FD0', '#B52EA0'], [[0, 0], [1, 0]]),
  Plank: S('Plank', 'Plank', 2, ['#F2C891', '#D9A066', '#A8723E'], [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], { material: 'wood' }),
  // Tiers 3-6 are not in the sim yet; these cells are Art's reading of gameplay.md §4.1. The sim's table wins.
  P: S('P', 'Teal P', 3, ['#8DEEDF', '#22C7B2', '#12907F'], [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]], { material: 'candy' }),
  U: S('U', 'Lime U', 3, ['#D8F48A', '#A9DD2F', '#79A814'], [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]], { material: 'candy' }),
  V: S('V', 'Navy V', 3, ['#8E95F2', '#3D46B8', '#262C85'], [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], { material: 'candy' }),
  Wedge: S('Wedge', 'Glass Wedge', 4, ['#E6F8FF', '#A8E6FF', '#6CBCE0'], null, { custom: 'wedge', material: 'glass' }),
  Boulder: S('Boulder', 'Boulder', 5, ['#A9AFC0', '#6E7487', '#4A4F60'], null, { custom: 'boulder', material: 'basalt' }),
  Arch: S('Arch', 'Brick Arch', 6, ['#F09A7C', '#D2694A', '#A3452C'], [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], { material: 'brick' }),
  Plus: S('Plus', 'Star Plus', 6, ['#FFFFFF', '#E9E6FA', '#B9B2DE'], [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], { material: 'gem' }),
  // Blockling Pop's three small Blocklings (Pop plan §4): grid fillers, in hues lighter than the tower's.
  // Tier 0 so nothing treats them as late shapes; the tower never deals them.
  Pip: S('Pip', 'Rosebud Pip', 0, ['#FFC9DE', '#FF8DB8', '#E0558A'], [[0, 0]]),
  Trio: S('Trio', 'Mint Trio', 0, ['#C2FBE8', '#5EE8B8', '#25B585'], [[0, 0], [1, 0], [2, 0]]),
  Elbow: S('Elbow', 'Lilac Elbow', 0, ['#EEDCFF', '#C9A2FF', '#9A6FE0'], [[0, 0], [1, 0], [0, 1]]),
};

/** Boulder diameter in blocks (Gameplay §4.1). */
export const BOULDER_DIAMETER = 1.5;

/**
 * A shape at one quarter-turn rotation, in canvas space (x right, y DOWN), with the bounding box at (0,0).
 * Units are blocks.
 */
export interface Pose {
  key: string;
  q: number;
  w: number;
  h: number;
  /** Integer cells, y down. Empty for custom shapes. */
  cells: [number, number][];
  /** Wedge: triangle vertices, y down. */
  tri?: [number, number][];
  /** Boulder: circle diameter. */
  circle?: number;
}

const poseCache = new Map<string, Pose>();
const qn = (q: number): number => ((Math.round(q) % 4) + 4) % 4;

/** Rotate a y-up point q quarter turns counter-clockwise about (px, py). Exact, no trig. */
function rotUp(x: number, y: number, px: number, py: number, q: number): [number, number] {
  let dx = x - px, dy = y - py;
  for (let i = 0; i < q; i++) [dx, dy] = [-dy, dx];
  return [px + dx, py + dy];
}

export function pose(key: string, q = 0): Pose {
  q = qn(q);
  const id = key + '/' + q;
  const hit = poseCache.get(id);
  if (hit) return hit;
  const sh = ART_SHAPES[key];
  if (!sh) throw new Error(`Unknown shape '${key}'`);
  let p: Pose;
  if (sh.custom === 'boulder') {
    p = { key, q, w: BOULDER_DIAMETER, h: BOULDER_DIAMETER, cells: [], circle: BOULDER_DIAMETER };
  } else if (sh.custom === 'wedge') {
    // Right angle at the bottom-left in rotation 0; legs 2 blocks.
    const up = ([[0, 0], [2, 0], [0, 2]] as [number, number][]).map(([x, y]) => rotUp(x, y, 1, 1, q));
    p = { key, q, w: 2, h: 2, cells: [], tri: up.map(([x, y]) => [x, 2 - y] as [number, number]) };
  } else {
    const cells0 = sh.cells!;
    let w0 = 0, h0 = 0;
    for (const [x, y] of cells0) { w0 = Math.max(w0, x + 1); h0 = Math.max(h0, y + 1); }
    // Rotate cell centres about the bounding-box centre, then snap back to integer cells.
    const ctr = cells0.map(([x, y]) => rotUp(x + 0.5, y + 0.5, w0 / 2, h0 / 2, q));
    const minX = Math.min(...ctr.map(c => c[0])), minY = Math.min(...ctr.map(c => c[1]));
    const up = ctr.map(([x, y]) => [Math.round(x - minX - 0.5), Math.round(y - minY - 0.5)] as [number, number]);
    const w = Math.max(...up.map(c => c[0])) + 1, h = Math.max(...up.map(c => c[1])) + 1;
    p = { key, q, w, h, cells: up.map(([x, y]) => [x, h - 1 - y] as [number, number]) };
  }
  poseCache.set(id, p);
  return p;
}
