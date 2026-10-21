// Canonical towers: Gameplay's starter list (gameplay.md §16.1) plus QA additions.
// Positions are on the cell grid; each run settles first, so collider insets don't matter.
import type { PlacePieceOptions } from './contract';

export type Outcome = 'stands' | 'falls';
/**
 * 'calibration' means the outcome may vary and is only used to tune the tint.
 * 'holds' means it may lean (a push bends the bonds) but must not fall: 'stands' or 'moved'.
 */
export type Expectation = Outcome | 'holds' | 'calibration';

export interface TowerDef {
  id: string;
  title: string;
  pieces: PlacePieceOptions[];
  expect: { mortarOff: Expectation; mortarOn: Expectation };
  /** Needs game rules (Solid Rows, checkpoints, hazards), so it only runs against Wobble Lab. */
  needsRules?: string;
  /** A useful base for the landing-guide sweep. */
  guideBase?: boolean;
  /** A steady sideways push in g (the game's lab wind), for the windy variants. Game sim only. */
  windG?: number;
}

const d = (shape: string, x: number, y: number, rot = 0): PlacePieceOptions => ({ shape, x, y, rot, as: 'dynamic' });

export const CANONICAL: TowerDef[] = [
  {
    id: 'T1',
    title: '8 × 8 wall of O pieces',
    pieces: [-3, -1, 1, 3].flatMap((x) => [1, 3, 5, 7].map((y) => d('O', x, y))),
    expect: { mortarOff: 'stands', mortarOn: 'stands' },
    guideBase: true,
  },
  { id: 'T2', title: 'Single vertical I on the foundation', pieces: [d('I', 0, 2, 1)], expect: { mortarOff: 'stands', mortarOn: 'stands' } },
  {
    id: 'T3',
    title: 'Two vertical I pieces stacked',
    pieces: [d('I', 0, 2, 1), d('I', 0, 6, 1)],
    expect: { mortarOff: 'calibration', mortarOn: 'stands' },
  },
  {
    // Gameplay expected "falls" without Mortar, but a perfectly aligned column is statically stable:
    // it stands in calm air in both engines (QA run, 2026-10-20). Only the windy variant must fall.
    id: 'T4',
    title: 'Four vertical I pieces stacked (calm air)',
    pieces: [2, 6, 10, 14].map((y) => d('I', 0, y, 1)),
    expect: { mortarOff: 'calibration', mortarOn: 'stands' },
  },
  {
    id: 'T4w',
    title: 'Four vertical I pieces stacked in a 0.12 g push',
    pieces: [2, 6, 10, 14].map((y) => d('I', 0, y, 1)),
    // gameplay.md §3.4: Mortar gives way in a 0.12 g gust. The lab's steady push stands in for a
    // gust; Gameplay judged it fair, since it is harsher than a 2 to 3 s gust (2026-10-20).
    expect: { mortarOff: 'falls', mortarOn: 'falls' },
    windG: 0.12,
  },
  {
    id: 'T4g',
    title: 'Four vertical I pieces stacked in a 0.08 g push',
    pieces: [2, 6, 10, 14].map((y) => d('I', 0, y, 1)),
    // §3.4: the bonded needle stands in a 0.08 g gust, leaning as the bonds bend. Without Mortar
    // the doc sets no outcome.
    expect: { mortarOff: 'calibration', mortarOn: 'holds' },
    windG: 0.08,
  },
  { id: 'T5', title: 'Horizontal I centred on a single O', pieces: [d('O', 0, 1), d('I', 0, 2.5)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  { id: 'T6', title: 'Horizontal I on the very end of an O (COM 1.5 past support)', pieces: [d('O', 0, 1), d('I', 2.5, 2.5)], expect: { mortarOff: 'falls', mortarOn: 'falls' } },
  { id: 'T7', title: 'O overhanging the foundation edge by 0.5', pieces: [d('O', 3.5, 1)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  { id: 'T8', title: 'O overhanging by 1.0 (centre on the edge)', pieces: [d('O', 4, 1)], expect: { mortarOff: 'calibration', mortarOn: 'calibration' } },
  { id: 'T9', title: 'O overhanging by 1.5', pieces: [d('O', 4.5, 1)], expect: { mortarOff: 'falls', mortarOn: 'falls' } },
  {
    id: 'T10',
    title: 'Staircase of 4 O pieces, each 0.5 further out',
    pieces: [d('O', 3, 1), d('O', 3.5, 3), d('O', 4, 5), d('O', 4.5, 7)],
    expect: { mortarOff: 'falls', mortarOn: 'stands' },
  },
  { id: 'T11', title: 'T piece upside-down on a flat floor', pieces: [d('T', 0, 1, 2)], expect: { mortarOff: 'stands', mortarOn: 'stands' } },
  { id: 'T12', title: 'S and Z side by side on a flat floor', pieces: [d('S', -1.5, 1), d('Z', 1.5, 1)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  { id: 'T13', title: 'L hooked over the corner of an O', pieces: [d('O', 0, 1), d('L', -0.5, 2, 2)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  { id: 'T14', title: 'Bridge: a Plank across two O towers 3 apart', pieces: [d('O', -2.5, 1), d('O', 2.5, 1), d('Plank', 0, 2.5)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  { id: 'T15', title: 'Full row across the foundation (2 horizontal I)', pieces: [d('I', -2, 0.5), d('I', 2, 0.5)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, needsRules: 'Solid Row fires and the row turns to stone' },
  { id: 'T16', title: 'Row with one 1-block gap', pieces: [d('I', -2, 0.5), d('I', 3, 0.5)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, needsRules: 'no Solid Row (coverage 87.5%)' },
  { id: 'T17', title: 'Top piece slides off within the 2 s hold', pieces: [], expect: { mortarOff: 'stands', mortarOn: 'stands' }, needsRules: 'checkpoint not claimed; ring cancels' },
  { id: 'T18', title: 'Tower holds at the line for 2 s', pieces: [], expect: { mortarOff: 'stands', mortarOn: 'stands' }, needsRules: 'claimed; cemented; slab width matches coverage' },
  { id: 'T19', title: 'Needle (2 vertical I) claims a checkpoint', pieces: [], expect: { mortarOff: 'stands', mortarOn: 'stands' }, needsRules: 'next slab 3 wide, grade C' },
  { id: 'T20', title: 'Gap narrower than the shape', pieces: [d('O', -1.5, 1), d('O', 1.5, 1)], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true },
  // QA additions
  {
    id: 'Q-COL10',
    title: 'Column of 10 O pieces (F3.4)',
    pieces: Array.from({ length: 10 }, (_, i) => d('O', 0, 1 + 2 * i)),
    expect: { mortarOff: 'stands', mortarOn: 'stands' },
  },
  {
    id: 'Q-STEPS',
    title: 'Uneven top: three columns of rising height',
    pieces: [d('O', -3, 1), d('O', -1, 1), d('O', -1, 3), d('O', 1, 1), d('O', 1, 3), d('O', 1, 5)],
    expect: { mortarOff: 'stands', mortarOn: 'stands' },
    guideBase: true,
  },
  {
    id: 'Q-SPIRE',
    title: 'Narrow spire of 3 O pieces off-centre',
    pieces: [d('O', 2, 1), d('O', 2, 3), d('O', 2, 5)],
    expect: { mortarOff: 'stands', mortarOn: 'stands' },
    guideBase: true,
  },
];

export const FLAT: TowerDef = { id: 'FLAT', title: 'Empty foundation', pieces: [], expect: { mortarOff: 'stands', mortarOn: 'stands' }, guideBase: true };

export const GUIDE_BASES: TowerDef[] = [FLAT, ...CANONICAL.filter((t) => t.guideBase)];
