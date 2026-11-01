// Blockling Pop's sim (Pop plan §3, §5, §15): intents in, state and events out. Turn-based and integer,
// with no clock, so a run is its seed plus its list of intents, and a digest after each one makes a
// replay checkable anywhere (the phone, QA's bots, the server).
//
// Milestone 1: the board, the tray of three and the next tray, the bag (one swap per tray), popping
// rows, columns and squares, scoring with the combo and its two sparks, All Clear, checkpoints and the
// biome they reach, No room and ending a run.
// Milestone 3 (rules 2, Pop plan §7): power bubbles, powers from big pops and checkpoints, the five
// powers (Undo, Spin, Sweep, Meteor, Fresh Deal), Second Wind, the level 6 head start, and No room
// waiting while a held power or Second Wind could help. A rules 1 record replays with none of it.
// Rules 3 (Blake's playtest, 2026-11-01): checkpoints grow by a line every area, and pieces split by a
// pop, Sweep, Meteor or Second Wind merge with the split pieces beside them into whole shapes, biggest
// first (only the cells' shape and piece labels change, so the digest and the board don't).
// Rules 4 (Blake's playtest, 2026-11-01 evening): every checkpoint is a new area (5 lines leave the Meadow,
// 6 leave Treetops ...), and whole pieces merge too: a placed shape and the pieces it touches become one
// bigger shape when together they make one.

import { Rng } from '../../sim/rng.ts';
import { CELLS, EMPTY, LINE_CELLS, type Mask, cellBit, count, fits, fullLines, has, isEmpty, linesMask } from './board.ts';
import { type Slot, dealTray, slotFits } from './deal.ts';
import { POP_SHAPES, type Turn } from './shapes.ts';
import { POP_RULES, type PopTuning, comboMult, linePoints, tuningFor } from './tuning.ts';

export type PopModeId = 'endless' | 'daily';

export interface PopOptions {
  seed: number;
  mode?: PopModeId;
  /** Deal rule 2 for the whole run (the player's first few Pop runs). */
  newPlayer?: boolean;
  /** Only these shapes (Daily Pop). */
  set?: readonly string[] | null;
  tuning?: Partial<PopTuning>;
  /** The rules version to play under (a saved run's own); the current one when absent. */
  rules?: number;
  /** Level 6's head start: a power in a slot from the start (Endless Pop). */
  headStart?: boolean;
  /**
   * The first-run guide (Pop plan §14): the bottom row starts one I short (a Trio and a Domino from the left,
   * an O on the Trio) and the first tray's first shape is a flat I, so the first drag pops a line. Endless,
   * rules 2 or later.
   */
  guide?: boolean;
  /** Second Wind starts ready (the day's first Endless Pop run, or the $1.99 upgrade). */
  windReady?: boolean;
}

/** Tray slots 0 to 2; the bag is slot 3. */
export const BAG = 3;

/** Every turn of every shape by its cells (y * 16 + x, bounding box at 0,0): what split pieces can merge into. U and Arch share cells; U, numbered first, keeps them. */
const SHAPE_BY_CELLS = new Map<string, number>();
for (const sh of POP_SHAPES) for (const t of sh.turns) {
  const key = t.cells.map(([x, y]) => y * 16 + x).sort((a, b) => a - b).join(',');
  if (!SHAPE_BY_CELLS.has(key)) SHAPE_BY_CELLS.set(key, sh.id);
}

/** A cell's up to four neighbours on the board. */
function neighbours(c: number): number[] {
  const x = c % 9, out: number[] = [];
  if (x > 0) out.push(c - 1);
  if (x < 8) out.push(c + 1);
  if (c >= 9) out.push(c - 9);
  if (c < CELLS - 9) out.push(c + 9);
  return out;
}

/** The shape a set of board cells makes, or −1. */
export function shapeOfCells(cells: readonly number[]): number {
  const xs = cells.map(c => c % 9), ys = cells.map(c => (c / 9) | 0);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const key = cells.map((_, i) => (ys[i] - y0) * 16 + xs[i] - x0).sort((a, b) => a - b).join(',');
  return SHAPE_BY_CELLS.get(key) ?? -1;
}

/** Split pieces that merged into one whole shape (the pop_merge event). */
export interface PopMerge {
  cells: number[]; s: number; shape: string; piece: number;
  /** The pieces it was made from, and each cell's shape and piece before (the view shows those until the pop has played). */
  from: number[]; wasShape: number[]; wasPiece: number[];
}

/** The five powers (Pop plan §7), numbered in this order in digests. Never reorder; add at the end. */
export const POP_POWERS = ['undo', 'spin', 'sweep', 'meteor', 'fresh'] as const;
export type PopPower = (typeof POP_POWERS)[number];
/** Powers that need a target: Sweep a row (0-8) or column (9-17), Meteor a cell (0-80). */
export const AIMED: readonly PopPower[] = ['sweep', 'meteor'];

/** Second Wind: off (scored Daily Pop, rules 1), still to earn at checkpoint 2, ready, or used. */
export type WindState = 'off' | 'earn' | 'ready' | 'used';
const WIND_STATES: readonly WindState[] = ['off', 'earn', 'ready', 'used'];

/** A power bubble on an empty cell: cover it with a shape to collect its power. */
export interface Bubble { cell: number; kind: PopPower; left: number }

/** Why a power went into a slot. */
export type GrantWhy = 'bubble' | 'big' | 'clear' | 'cp' | 'head';

export type PopIntent =
  | { t: 'place'; slot: number; x: number; y: number }
  | { t: 'bag'; slot: number }
  | { t: 'power'; slot: number; arg?: number }
  | { t: 'spin'; slot: number }
  | { t: 'wind' }
  | { t: 'end' };

export interface PopEvent { name: string; payload: Record<string, unknown> }

export interface EventSink { emit(name: string, payload: Record<string, unknown>): void }

export type PopCause = 'noroom' | 'end';

/** The areas, Meadow (0) to Deep Cosmos (9). */
export const POP_AREAS = 10;

/** Biome index (0 Meadow ... 9 Deep Cosmos) with `cp` checkpoints claimed: the tower's schedule (Pop plan §6, rules 1 to 3). */
export function popBiome(cp: number): number {
  const FIRST = [1, 3, 5, 7, 9, 11, 14, 17, 20, 23]; // art/src/biomes.ts firstCp, the checkpoint being climbed toward
  let i = 0;
  while (i < FIRST.length - 1 && cp + 1 >= FIRST[i + 1]) i++;
  return i;
}

export class PopSim {
  readonly seed: number;
  readonly mode: PopModeId;
  readonly newPlayer: boolean;
  readonly set: readonly string[] | null;
  readonly tuning: PopTuning;
  readonly rules: number;
  readonly headStart: boolean;
  readonly windReady: boolean;
  /** The first-run guide's start (PopOptions.guide). */
  readonly guide: boolean;

  board: Mask = EMPTY();
  /** Each cell's shape number, or −1 when empty. */
  readonly cellShape = new Int8Array(CELLS).fill(-1);
  /** Each cell's placement number (1, 2, ...), or 0 when empty: cells of one placement share it. */
  readonly cellPiece = new Int32Array(CELLS);
  tray: (Slot | null)[] = [null, null, null];
  next: Slot[] = [];
  bag: Slot | null = null;
  /** The bag's one swap for this tray is spent. */
  bagUsed = false;

  score = 0;
  lines = 0;
  combo = 0;
  sparks: number;
  bestCombo = 0;
  placements = 0;
  clears = 0;
  /** Checkpoints claimed. */
  cp = 0;
  /** Trays brought into play (the first is 1). */
  trays = 0;
  over = false;
  cause: PopCause | null = null;
  /** Every intent applied, encoded (record.ts). */
  readonly moves: number[] = [];
  /** The last intent's events. */
  events: PopEvent[] = [];
  /** Where events also go (the JuiceBus); null while replaying. */
  sink: EventSink | null = null;

  // Rules 2: powers, bubbles and Second Wind.
  /** The two power slots. */
  powers: (PopPower | null)[] = [null, null];
  /** Bubbles on the board, never more than the free slots. */
  bubbles: Bubble[] = [];
  /** Placements (while a slot is free) until the next bubble. */
  bubbleIn = 0;
  wind: WindState = 'off';
  /** Spin is on for the rest of this tray: tapping a tray or bag shape turns it. */
  spinning = false;
  /** No room, but a held power or Second Wind could help: the run waits for it or End run. */
  stuck = false;
  /** Powers used and bubbles collected this run (achievements and QA). */
  powersUsed = 0;
  bubblesGot = 0;
  /** Rules 3: the next merged piece's number (below the guide's −1 to −3, never a placement's). */
  private nextMerge = -100;

  private readonly streams: { deal: Rng; turns: Rng; bubbles: Rng; powers: Rng; fresh: Rng };
  private history: number[] = [];
  /** The state before the last placement, for Undo; null once anything else happens. */
  private snap: Snap | null = null;

  constructor(o: PopOptions, sink: EventSink | null = null) {
    this.seed = o.seed >>> 0;
    this.mode = o.mode ?? 'endless';
    this.newPlayer = !!o.newPlayer;
    this.set = o.set ?? null;
    this.rules = o.rules ?? POP_RULES;
    this.tuning = { ...tuningFor(this.rules), ...o.tuning };
    this.sparks = this.tuning.sparks;
    this.headStart = this.v2 && !!o.headStart && this.mode !== 'daily';
    this.windReady = this.v2 && !!o.windReady && this.mode !== 'daily';
    this.guide = this.v2 && !!o.guide && this.mode === 'endless';
    const root = new Rng(this.seed ^ 0x5a17b10c);
    // New streams go on the end, so the earlier ones keep their values for a given seed.
    this.streams = { deal: new Rng(root.nextU32()), turns: new Rng(root.nextU32()), bubbles: new Rng(root.nextU32()), powers: new Rng(root.nextU32()), fresh: new Rng(root.nextU32()) };
    this.sink = sink;
    // The first tray and the one after it, both against the empty board.
    const first = this.deal();
    this.next = this.deal();
    if (this.guide) this.setUpGuide(first);
    this.events = [];
    this.bringTray(first);
    if (this.v2) {
      this.wind = this.mode === 'daily' ? 'off' : this.windReady ? 'ready' : 'earn';
      this.bubbleIn = this.nextGap();
      if (this.headStart) this.grant('head');
    }
    this.emit('pop_start', { seed: this.seed, mode: this.mode });
  }

  /** The guide's start (after the deal, so the streams keep their values): see PopOptions.guide. */
  private setUpGuide(first: Slot[]): void {
    const at = (key: string) => POP_SHAPES.findIndex(sh => sh.key === key);
    const lay = (s: number, cells: number[], piece: number) => {
      for (const c of cells) { this.cellShape[c] = s; this.cellPiece[c] = piece; const [w, bit] = cellBit(c); this.board[w] |= bit; }
    };
    // Pieces numbered below zero: they were never placed (placements number from 1). The O stays after
    // the first pop, so that pop isn't a free All Clear.
    lay(at('Trio'), [72, 73, 74], -1);
    lay(at('Domino'), [75, 76], -2);
    lay(at('O'), [54, 55, 63, 64], -3);
    const i = at('I');
    first[0] = { s: i, q: POP_SHAPES[i].turns.find(t => t.h === 1)!.q };
  }

  /** Rules 2 or later: powers, bubbles and Second Wind are in play. */
  get v2(): boolean { return this.rules >= 2; }

  // ---------------------------------------------------------------- reading the state

  /** Filled cells. */
  get filled(): number { return count(this.board); }

  /** The shape in a slot (0-2 tray, 3 bag), or null. */
  slot(i: number): Slot | null { return i === BAG ? this.bag : this.tray[i] ?? null; }

  /** A slot's shape turn, or null when the slot is empty. */
  turn(i: number): Turn | null {
    const sl = this.slot(i);
    if (!sl) return null;
    const sh = POP_SHAPES[sl.s];
    return sh.turns[sh.byQ[sl.q & 3]];
  }

  /** The mask a slot's shape would cover with its top-left at (x, y), or null off the board. */
  maskAt(i: number, x: number, y: number): Mask | null {
    const t = this.turn(i);
    if (!t || x < 0 || y < 0 || x + t.w > 9 || y + t.h > 9) return null;
    return t.at[y * 9 + x];
  }

  /** Whether the slot's shape can go at (x, y). */
  canPlace(i: number, x: number, y: number): boolean {
    if (this.over) return false;
    const m = this.maskAt(i, x, y);
    return !!m && fits(this.board, m);
  }

  /** Whether the slot's shape fits anywhere. */
  fitsAnywhere(i: number): boolean {
    const sl = this.slot(i);
    return !!sl && slotFits(this.board, sl);
  }

  /** The lines a placement would pop (for the preview glow), or [] when it pops none or can't go there. */
  wouldPop(i: number, x: number, y: number): number[] {
    const m = this.maskAt(i, x, y);
    if (!m || !fits(this.board, m)) return [];
    return fullLines([this.board[0] | m[0], this.board[1] | m[1], this.board[2] | m[2]]);
  }

  /** Whether the bag can take the slot's shape now (park it, or swap with the bagged one). */
  canBag(i: number): boolean {
    return !this.over && i >= 0 && i < 3 && !!this.tray[i] && !this.bagUsed;
  }

  /** Whether there's a placement Undo could take back (canPower also needs the Undo to have been held before it). */
  get undoable(): boolean { return !!this.snap; }

  /** Whether the power in slot `i` can be used now (an aimed power: whether it has anything to aim at). */
  canPower(i: number): boolean {
    const k = this.powers[i];
    if (this.over || !k) return false;
    switch (k) {
      // Undo takes back the last placement, but not the one that earned it (no undoing into the same bubble forever).
      case 'undo': return !!this.snap && this.snap.powers[i] === 'undo';
      case 'spin': return !this.spinning && [0, 1, 2, BAG].some(j => this.canTurn(j));
      case 'sweep': case 'meteor': return !isEmpty(this.board);
      case 'fresh': return this.tray.some(Boolean);
    }
  }

  /** Whether Sweep can take line `id` (a row 0-8 or column 9-17 with a block in it). */
  canSweep(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < 18 && LINE_CELLS[id].some(c => this.cellShape[c] >= 0);
  }

  /** The cells Meteor smashes around `cell`: its 3×3 block, clipped to the board. */
  meteorCells(cell: number): number[] {
    const x0 = cell % 9, y0 = (cell / 9) | 0, out: number[] = [];
    for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) if (x >= 0 && y >= 0 && x < 9 && y < 9) out.push(y * 9 + x);
    return out;
  }

  /** Whether Meteor can hit `cell` (its block has a block in it). */
  canMeteor(cell: number): boolean {
    return Number.isInteger(cell) && cell >= 0 && cell < CELLS && this.meteorCells(cell).some(c => this.cellShape[c] >= 0);
  }

  /** Whether slot `i`'s shape has more than one look, so Spin can turn it. */
  canTurn(i: number): boolean {
    const sl = this.slot(i);
    return !!sl && POP_SHAPES[sl.s].turns.length > 1;
  }

  /** Whether a spin intent on slot `i` is allowed now. */
  canSpin(i: number): boolean { return !this.over && this.spinning && this.canTurn(i); }

  /** The rows and columns Second Wind would blow away now: the 3 fullest of each, ties to the middle. */
  windLines(): { rows: number[]; cols: number[] } {
    const fullest = (n: (i: number) => number) => [...Array(9).keys()]
      .map(i => ({ i, n: n(i) }))
      .sort((a, b) => b.n - a.n || Math.abs(a.i - 4) - Math.abs(b.i - 4) || a.i - b.i)
      .slice(0, 3).map(r => r.i).sort((a, b) => a - b);
    const filledIn = (cells: number[]) => cells.filter(c => this.cellShape[c] >= 0).length;
    return { rows: fullest(y => filledIn(LINE_CELLS[y])), cols: fullest(x => filledIn(LINE_CELLS[9 + x])) };
  }

  /** Whether the run, stuck at No room, has something that could help: a power, a spin or Second Wind. */
  canRescue(): boolean {
    if (!this.v2 || this.over) return false;
    if (this.wind === 'ready') return true;
    if (this.spinning && this.turnedFits()) return true;
    return this.powers.some((k, i) => {
      if (!k) return false;
      if (k === 'spin') return !this.spinning && this.turnedFits();
      return this.canPower(i);
    });
  }

  /** XP the run has earned so far (Pop plan §12): 6 per line, 40 per checkpoint, 1 per placement, 100 per All Clear. */
  get xp(): number {
    const t = this.tuning;
    return t.xpLine * this.lines + t.xpCp * this.cp + t.xpPlace * this.placements + t.xpClear * this.clears;
  }

  get biome(): number { return this.areaOf(this.cp); }

  /** The area with `cp` checkpoints claimed: one per checkpoint (rules 4), else the tower's schedule. */
  areaOf(cp: number): number {
    return this.tuning.cpPerArea ? Math.min(cp, POP_AREAS - 1) : popBiome(cp);
  }

  /** Lines into the current checkpoint, and the lines it needs. */
  get cpProgress(): { into: number; need: number } {
    return { into: this.lines - this.linesTo(this.cp), need: this.needFor(this.cp) };
  }

  /** Lines the next checkpoint takes with `cp` claimed: linesPerCp, plus cpGrow for every area climbed (rules 3). */
  needFor(cp: number): number {
    return this.tuning.linesPerCp + this.tuning.cpGrow * this.areaOf(cp);
  }

  /** Lines popped by the time checkpoint `n` is claimed. */
  linesTo(n: number): number {
    let at = 0;
    for (let k = 0; k < n; k++) at += this.needFor(k);
    return at;
  }

  // ---------------------------------------------------------------- intents

  /** Applies one intent. Returns false (and changes nothing) when it isn't allowed now. */
  apply(it: PopIntent): boolean {
    if (this.over) return false;
    this.events = [];
    const snap = it.t === 'place' && this.v2 ? this.snapshot(it.slot) : null;
    let ok = false;
    switch (it.t) {
      case 'place': ok = this.place(it.slot, it.x, it.y); break;
      case 'bag': ok = this.toBag(it.slot); break;
      case 'power': ok = this.v2 && this.usePower(it.slot, it.arg); break;
      case 'spin': ok = this.v2 && this.spin(it.slot); break;
      case 'wind': ok = this.v2 && this.useWind(); break;
      case 'end': ok = true; this.finish('end'); break;
    }
    if (!ok) return false;
    this.moves.push(encodeIntent(it));
    // Undo takes back the last placement only, and only until anything else happens.
    this.snap = snap;
    if (!this.over) this.checkRoom();
    return true;
  }

  private place(i: number, x: number, y: number): boolean {
    const sl = this.slot(i);
    const t = this.turn(i);
    const m = this.maskAt(i, x, y);
    if (!sl || !t || !m || !fits(this.board, m)) return false;
    const T = this.tuning;
    // The bag saving the run: nothing in the tray fit (Saved by the Bag, Pop plan §12; events only, not the digest).
    const bagSave = i === BAG && [0, 1, 2].every(k => !this.fitsAnywhere(k));
    const piece = ++this.placements;
    const cells = t.cells.map(([cx, cy]) => (y + cy) * 9 + x + cx);
    for (const c of cells) { this.cellShape[c] = sl.s; this.cellPiece[c] = piece; }
    this.board = [this.board[0] | m[0], this.board[1] | m[1], this.board[2] | m[2]];
    if (i === BAG) this.bag = null; else this.tray[i] = null;
    this.emit('pop_placed', { slot: i, shape: POP_SHAPES[sl.s].key, s: sl.s, q: sl.q, x, y, cells, piece, bagSave });
    // Bubbles under the shape are collected (Pop plan §7).
    for (const b of [...this.bubbles]) {
      if (!cells.includes(b.cell)) continue;
      this.bubbles.splice(this.bubbles.indexOf(b), 1);
      this.bubblesGot++;
      const slot = this.powers.indexOf(null);
      if (slot >= 0) this.powers[slot] = b.kind;
      this.emit('pop_bubble_got', { cell: b.cell, kind: b.kind, slot });
    }
    let drops = 0, big = false;

    let gained = cells.length;
    const lines = fullLines(this.board);
    if (lines.length) {
      const popMask = linesMask(lines);
      const popped: number[] = [];
      for (let c = 0; c < CELLS; c++) if (has(popMask, c)) popped.push(c);
      const shapes = popped.map(c => this.cellShape[c]), pieces = popped.map(c => this.cellPiece[c]);
      for (const c of popped) { this.cellShape[c] = -1; this.cellPiece[c] = 0; }
      this.board = [this.board[0] & ~popMask[0], this.board[1] & ~popMask[1], this.board[2] & ~popMask[2]];
      this.combo++;
      this.sparks = T.sparks;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const mult = comboMult(T, this.combo);
      const points = Math.floor(linePoints(T, lines.length) * mult);
      gained += points;
      this.lines += lines.length;
      this.emit('pop_lines', {
        lines, count: lines.length, cells: popped, shapes, pieces, combo: this.combo, mult, points, from: cells,
        // Each line's cells in order along it, starting from the end nearest the placed shape (the wave runs out from it).
        order: lines.map(id => orderFrom(LINE_CELLS[id], cells)),
      });
      if (this.combo >= 2) this.emit('pop_combo', { combo: this.combo, mult });
      this.tidy('pop');
      if (isEmpty(this.board)) {
        this.clears++;
        gained += T.allClear;
        this.emit('pop_all_clear', { points: T.allClear, clears: this.clears });
        big = true;
      }
      if (lines.length >= T.grantLines) big = true;
      drops = this.claimCheckpoints();
    } else if (this.combo > 0) {
      if (this.sparks > 0) {
        this.sparks--;
        this.emit('pop_spark', { sparks: this.sparks, combo: this.combo });
      } else {
        this.emit('pop_combo_end', { combo: this.combo });
        this.combo = 0;
        this.sparks = T.sparks;
      }
    }
    // Rules 4: the placed shape merges with the pieces it touches (after a pop, tidy('pop') did it).
    if (!lines.length) this.tidy('place');
    this.score += gained;
    this.emit('pop_score', { score: this.score, gained, lines: lines.length });
    if (this.v2) {
      // A Triple or bigger, or an All Clear, puts a power straight into a free slot.
      if (big) this.grant(isEmpty(this.board) ? 'clear' : 'big');
      for (const b of [...this.bubbles]) {
        if (--b.left > 0) continue;
        this.bubbles.splice(this.bubbles.indexOf(b), 1);
        this.emit('pop_bubble_gone', { cell: b.cell, kind: b.kind });
      }
    }
    if (this.tray.every(s => s === null)) this.refill();
    if (this.v2) {
      // The bubble clock runs while a slot is free; checkpoints drop one each. Both look at the tray as it now is.
      if (this.bubbleRoom() && --this.bubbleIn <= 0 && this.dropBubble('clock')) this.bubbleIn = this.nextGap();
      for (let k = 0; k < drops; k++) this.dropBubble('cp');
    }
    return true;
  }

  /** Claims every checkpoint the lines have reached: biomes, Second Wind at windCp. Returns the bubbles they drop. */
  private claimCheckpoints(): number {
    const T = this.tuning;
    let drops = 0, at = this.linesTo(this.cp);
    while (this.lines >= at + this.needFor(this.cp)) {
      at += this.needFor(this.cp);
      const before = this.biome;
      this.cp++;
      this.emit('pop_checkpoint', { n: this.cp, biome: this.biome, lines: this.lines });
      if (this.biome !== before) this.emit('biome_entered', { id: this.biome });
      if (!this.v2) continue;
      if (this.cp % T.bubbleCps === 0) drops++;
      if (this.cp === T.windCp) {
        if (this.wind === 'earn') { this.wind = 'ready'; this.emit('pop_wind_ready', { why: 'cp' }); }
        else this.grant('cp');
      }
    }
    return drops;
  }

  // ---------------------------------------------------------------- powers (rules 2)

  private usePower(i: number, arg: number | undefined): boolean {
    if ((i !== 0 && i !== 1) || !this.canPower(i)) return false;
    const kind = this.powers[i]!;
    if (AIMED.includes(kind) !== (arg !== undefined)) return false;
    switch (kind) {
      case 'undo': {
        const snap = this.snap!;
        const before = this.board.slice() as Mask, shapesBefore = Array.from(this.cellShape);
        this.restore(snap);
        this.powers[i] = null; // the Undo is spent (it was in this slot before the placement it takes back)
        this.powersUsed++;
        const removed: number[] = [], restored: number[] = [];
        for (let c = 0; c < CELLS; c++) {
          if (has(before, c) && !has(this.board, c)) removed.push(c);
          else if (!has(before, c) && has(this.board, c)) restored.push(c);
        }
        this.emit('pop_power', { kind, slot: i, back: snap.from, removed, removedShapes: removed.map(c => shapesBefore[c]), restored, tray: this.tray.map(s => (s ? { ...s } : null)) });
        return true;
      }
      case 'spin':
        this.powers[i] = null;
        this.spinning = true;
        this.powersUsed++;
        this.emit('pop_power', { kind, slot: i });
        return true;
      case 'sweep': {
        if (!this.canSweep(arg!)) return false;
        const T = this.tuning;
        const cells = LINE_CELLS[arg!].filter(c => this.cellShape[c] >= 0);
        const shapes = cells.map(c => this.cellShape[c]), pieces = cells.map(c => this.cellPiece[c]);
        this.clearCells(cells);
        this.powers[i] = null;
        this.powersUsed++;
        // One line at the current combo, without stepping it (Pop plan §5).
        const mult = comboMult(T, Math.max(1, this.combo));
        let gained = Math.floor(linePoints(T, 1) * mult);
        this.lines++;
        this.emit('pop_power', { kind, slot: i, line: arg, cells, shapes, pieces, points: gained, mult });
        this.tidy('pop');
        let clear = false;
        if (isEmpty(this.board)) {
          clear = true;
          this.clears++;
          gained += T.allClear;
          this.emit('pop_all_clear', { points: T.allClear, clears: this.clears });
        }
        const drops = this.claimCheckpoints();
        this.score += gained;
        this.emit('pop_score', { score: this.score, gained, lines: 1 });
        if (clear) this.grant('clear');
        for (let k = 0; k < drops; k++) this.dropBubble('cp');
        return true;
      }
      case 'meteor': {
        if (!this.canMeteor(arg!)) return false;
        const block = this.meteorCells(arg!);
        const cells = block.filter(c => this.cellShape[c] >= 0);
        const shapes = cells.map(c => this.cellShape[c]), pieces = cells.map(c => this.cellPiece[c]);
        this.clearCells(cells);
        this.powers[i] = null;
        this.powersUsed++;
        this.emit('pop_power', { kind, slot: i, cell: arg, block, cells, shapes, pieces });
        this.tidy('pop');
        return true;
      }
      case 'fresh': {
        this.powers[i] = null;
        this.powersUsed++;
        const old = this.tray.map(s => (s ? { ...s } : null));
        const slots = this.freshDeal();
        this.emit('pop_power', { kind, slot: i, slots, old, tray: this.tray.map(s => (s ? { ...s } : null)) });
        return true;
      }
    }
  }

  /** Turns slot `i`'s shape a quarter turn clockwise (while Spin is on). */
  private spin(i: number): boolean {
    if (!this.canSpin(i)) return false;
    const sl = this.slot(i)!;
    const sh = POP_SHAPES[sl.s];
    sl.q = sh.turns[sh.byQ[(sl.q + 3) & 3]].q;
    this.emit('pop_spin', { slot: i, s: sl.s, q: sl.q });
    return true;
  }

  /** Second Wind (Pop plan §7): the 3 fullest rows and columns blow away, then a Fresh Deal. No points; the combo carries on. */
  private useWind(): boolean {
    if (this.wind !== 'ready') return false;
    const { rows, cols } = this.windLines();
    const ids = [...rows, ...cols.map(x => 9 + x)];
    const cells = [...new Set(ids.flatMap(id => LINE_CELLS[id]))].filter(c => this.cellShape[c] >= 0).sort((a, b) => a - b);
    const shapes = cells.map(c => this.cellShape[c]), pieces = cells.map(c => this.cellPiece[c]);
    this.clearCells(cells);
    this.wind = 'used';
    const old = this.tray.map(s => (s ? { ...s } : null));
    const slots = this.freshDeal();
    this.emit('pop_second_wind', { rows, cols, cells, shapes, pieces, slots, old, tray: this.tray.map(s => (s ? { ...s } : null)) });
    this.tidy('pop');
    return true;
  }

  /**
   * Rules 3: split pieces merge (Blake's playtest, 2026-11-01). A split piece is a connected run of one
   * piece's cells smaller than its shape. Split pieces that touch, and together make a whole shape, become
   * that shape as one new piece; the biggest shape goes first, then the one nearest the top left, and again
   * until no two left can merge. Only cellShape and cellPiece change: the board, the score and the digest
   * don't, so a merge never changes what fits.
   * Rules 4 (Blake, 2026-11-01 evening): whole pieces take part too, so a placed shape merges with the
   * pieces it touches when together they make a bigger whole shape (`why` 'place'), and after a pop the
   * split pieces can merge with whole ones beside them ('pop').
   */
  private tidy(why: 'pop' | 'place'): void {
    if (!this.tuning.merge || (why === 'place' && !this.tuning.mergeWhole)) return;
    const whole = this.tuning.mergeWhole;
    const frag = new Int16Array(CELLS).fill(-1), seen = new Uint8Array(CELLS);
    const frags: number[][] = [];
    for (let i = 0; i < CELLS; i++) {
      if (seen[i] || this.cellShape[i] < 0) continue;
      const s = this.cellShape[i], piece = this.cellPiece[i];
      const cells = [i], stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of neighbours(c)) {
          if (seen[n] || this.cellShape[n] !== s || this.cellPiece[n] !== piece) continue;
          seen[n] = 1; cells.push(n); stack.push(n);
        }
      }
      // A whole piece only merges under rules 4, and a five-cell one never can (five cells at most).
      if (cells.length >= POP_SHAPES[s].size && (!whole || cells.length >= 5)) continue;
      for (const c of cells) frag[c] = frags.length;
      frags.push(cells.sort((a, b) => a - b));
    }
    if (frags.length < 2) return;
    const adj = frags.map((cells, f) => {
      const near = new Set<number>();
      for (const c of cells) for (const n of neighbours(c)) if (frag[n] >= 0 && frag[n] !== f) near.add(frag[n]);
      return [...near].sort((a, b) => a - b);
    });
    const alive = new Set(frags.keys());
    const merges: PopMerge[] = [];
    for (;;) {
      // Every connected set of two or more live split pieces, five cells at most, that makes a shape.
      let best: { ids: number[]; cells: number[]; s: number } | null = null;
      const tried = new Set<string>();
      const grow = (ids: number[], size: number): void => {
        const key = [...ids].sort((a, b) => a - b).join('.');
        if (tried.has(key)) return;
        tried.add(key);
        if (ids.length >= 2) {
          const cells = ids.flatMap(f => frags[f]).sort((a, b) => a - b);
          const s = shapeOfCells(cells);
          if (s >= 0 && (!best || cells.length > best.cells.length || (cells.length === best.cells.length && cells[0] < best.cells[0]))) best = { ids: [...ids], cells, s };
        }
        for (const f of ids) for (const g of adj[f]) {
          if (!alive.has(g) || ids.includes(g) || size + frags[g].length > 5) continue;
          grow([...ids, g], size + frags[g].length);
        }
      };
      for (const f of alive) grow([f], frags[f].length);
      if (!best) break;
      const { ids, cells, s } = best as { ids: number[]; cells: number[]; s: number };
      const piece = this.nextMerge--;
      const wasShape = cells.map(c => this.cellShape[c]), wasPiece = cells.map(c => this.cellPiece[c]);
      for (const c of cells) { this.cellShape[c] = s; this.cellPiece[c] = piece; }
      for (const f of ids) alive.delete(f);
      merges.push({ cells, s, shape: POP_SHAPES[s].key, piece, from: [...new Set(wasPiece)], wasShape, wasPiece });
    }
    if (merges.length) this.emit('pop_merge', { merges, why });
  }

  /** New shapes for the ones left in the tray, whole-tray-fits where it can (its own stream). The bag and the next tray stay. */
  private freshDeal(): number[] {
    const left = [0, 1, 2].filter(i => this.tray[i]);
    const tray = dealTray({
      board: this.board, cp: this.cp, mercy: true, history: this.history, deal: this.streams.fresh, turns: this.streams.fresh, tuning: this.tuning, set: this.set,
    });
    left.forEach((i, k) => { this.tray[i] = { ...tray[k] }; });
    return left;
  }

  private clearCells(cells: number[]): void {
    const m: Mask = [0, 0, 0];
    for (const c of cells) { const [w, b] = cellBit(c); m[w] |= b; this.cellShape[c] = -1; this.cellPiece[c] = 0; }
    this.board = [this.board[0] & ~m[0], this.board[1] & ~m[1], this.board[2] & ~m[2]];
  }

  /** A power into the first free slot, picked by need. Nothing when both slots are full. */
  private grant(why: GrantWhy): void {
    const slot = this.powers.indexOf(null);
    if (slot < 0) return;
    const kind = this.pickPower();
    this.powers[slot] = kind;
    this.emit('pop_power_got', { kind, slot, why });
    // Bubbles never outnumber the free slots, so every bubble can be collected.
    while (this.bubbles.length > this.powers.filter(p => !p).length) {
      const b = this.bubbles.pop()!;
      this.emit('pop_bubble_gone', { cell: b.cell, kind: b.kind });
    }
  }

  /**
   * Which power, weighted by need (Pop plan §7): every kind starts at 2; Meteor and Sweep +2 on a board
   * 60% full; Fresh Deal +2 when a tray shape fits nowhere; Spin +1 when one would only fit turned; a
   * kind already in a slot counts half. Doubled to whole numbers.
   */
  private pickPower(): PopPower {
    const w = POP_POWERS.map(() => 4);
    const at = (k: PopPower) => POP_POWERS.indexOf(k);
    if (this.filled / CELLS >= this.tuning.powerFull) { w[at('meteor')] += 4; w[at('sweep')] += 4; }
    const tray = [0, 1, 2].map(i => this.tray[i]).filter((s): s is Slot => !!s);
    if (tray.some(sl => !slotFits(this.board, sl))) w[at('fresh')] += 4;
    if (tray.some(sl => !slotFits(this.board, sl) && this.otherTurnFits(sl))) w[at('spin')] += 2;
    POP_POWERS.forEach((k, j) => { if (this.powers.includes(k)) w[j] >>= 1; });
    let r = this.streams.powers.int(w.reduce((a, b) => a + b, 0));
    for (let j = 0; j < w.length; j++) { r -= w[j]; if (r < 0) return POP_POWERS[j]; }
    return POP_POWERS[0];
  }

  private otherTurnFits(sl: Slot): boolean {
    const sh = POP_SHAPES[sl.s];
    return sh.turns.some(t => t.q !== sl.q && slotFits(this.board, { s: sl.s, q: t.q }));
  }

  /** Some tray or bag shape would fit if turned. */
  private turnedFits(): boolean {
    return [0, 1, 2, BAG].some(i => { const sl = this.slot(i); return !!sl && this.otherTurnFits(sl); });
  }

  private bubbleRoom(): boolean { return this.powers.filter(p => !p).length > this.bubbles.length; }

  private nextGap(): number {
    const T = this.tuning;
    return T.bubbleGap - T.bubbleSpread + this.streams.bubbles.int(T.bubbleSpread * 2 + 1);
  }

  /** A bubble on an empty cell some tray or bag shape could cover, when a slot is free for it. */
  private dropBubble(why: 'clock' | 'cp'): boolean {
    if (!this.bubbleRoom()) return false;
    const cover = new Set<number>();
    for (let i = 0; i <= BAG; i++) {
      const t = this.turn(i);
      if (!t) continue;
      for (const p of t.places) if (fits(this.board, p.m)) for (const [cx, cy] of t.cells) cover.add((p.y + cy) * 9 + p.x + cx);
    }
    for (const b of this.bubbles) cover.delete(b.cell);
    if (!cover.size) return false;
    const list = [...cover].sort((a, b) => a - b);
    const cell = list[this.streams.bubbles.int(list.length)];
    const kind = this.pickPower();
    this.bubbles.push({ cell, kind, left: this.tuning.bubbleLife });
    this.emit('pop_bubble', { cell, kind, life: this.tuning.bubbleLife, why });
    return true;
  }

  // ---------------------------------------------------------------- Undo's snapshot

  private snapshot(from: number): Snap {
    return {
      from, board: this.board.slice() as Mask, cellShape: this.cellShape.slice(), cellPiece: this.cellPiece.slice(),
      tray: this.tray.map(s => (s ? { ...s } : null)), next: this.next.map(s => ({ ...s })), bag: this.bag ? { ...this.bag } : null, bagUsed: this.bagUsed,
      score: this.score, lines: this.lines, combo: this.combo, sparks: this.sparks, bestCombo: this.bestCombo, placements: this.placements, clears: this.clears, cp: this.cp, trays: this.trays,
      powers: [...this.powers], bubbles: this.bubbles.map(b => ({ ...b })), bubbleIn: this.bubbleIn, wind: this.wind, spinning: this.spinning,
      powersUsed: this.powersUsed, bubblesGot: this.bubblesGot, history: [...this.history],
      rng: [this.streams.deal.state, this.streams.turns.state, this.streams.bubbles.state, this.streams.powers.state, this.streams.fresh.state],
    };
  }

  private restore(s: Snap): void {
    this.board = s.board.slice() as Mask;
    this.cellShape.set(s.cellShape);
    this.cellPiece.set(s.cellPiece);
    this.tray = s.tray.map(x => (x ? { ...x } : null));
    this.next = s.next.map(x => ({ ...x }));
    this.bag = s.bag ? { ...s.bag } : null;
    this.bagUsed = s.bagUsed;
    this.score = s.score; this.lines = s.lines; this.combo = s.combo; this.sparks = s.sparks; this.bestCombo = s.bestCombo;
    this.placements = s.placements; this.clears = s.clears; this.cp = s.cp; this.trays = s.trays;
    this.powers = [...s.powers];
    this.bubbles = s.bubbles.map(b => ({ ...b }));
    this.bubbleIn = s.bubbleIn;
    this.wind = s.wind;
    this.spinning = s.spinning;
    this.powersUsed = s.powersUsed;
    this.bubblesGot = s.bubblesGot;
    this.history = [...s.history];
    [this.streams.deal.state, this.streams.turns.state, this.streams.bubbles.state, this.streams.powers.state, this.streams.fresh.state] = s.rng;
  }

  private toBag(i: number): boolean {
    if (!this.canBag(i)) return false;
    const sl = this.tray[i]!;
    this.tray[i] = this.bag;
    this.bag = sl;
    this.bagUsed = true;
    this.emit('pop_bag', { slot: i, bag: { ...sl }, back: this.tray[i] ? { ...this.tray[i]! } : null });
    if (this.tray.every(s => s === null)) this.refill();
    return true;
  }

  private refill(): void {
    const t = this.next;
    this.next = this.deal();
    this.bringTray(t);
  }

  private bringTray(t: Slot[]): void {
    this.tray = t.map(s => ({ ...s }));
    this.bagUsed = false;
    this.spinning = false;
    this.trays++;
    this.emit('pop_tray', { tray: this.tray.map(s => ({ ...s! })), next: this.next.map(s => ({ ...s })), n: this.trays });
  }

  private deal(): Slot[] {
    const T = this.tuning;
    const tray = dealTray({
      board: this.board, cp: this.cp, mercy: this.mode !== 'daily' && (this.newPlayer || this.cp < T.mercyCps), history: this.history,
      deal: this.streams.deal, turns: this.streams.turns, tuning: T, set: this.set,
    });
    this.history.push(...tray.map(s => s.s));
    if (this.history.length > 16) this.history.splice(0, this.history.length - 16);
    return tray;
  }

  /**
   * No room: nothing in the tray or the bag fits anywhere. The run is over, unless a held power, a spin or
   * Second Wind could help: then it waits for one of them, or End run (Pop plan §3).
   */
  private checkRoom(): void {
    for (let i = 0; i <= BAG; i++) if (this.fitsAnywhere(i)) { this.stuck = false; return; }
    const waiting = this.canRescue(), was = this.stuck;
    this.stuck = waiting;
    if (!was || !waiting) this.emit('pop_no_room', { filled: this.filled, waiting });
    if (!waiting) this.finish('noroom');
  }

  private finish(cause: PopCause): void {
    this.over = true;
    this.cause = cause;
    this.emit('run_over', { cause, score: this.score, lines: this.lines, cp: this.cp, combo: this.bestCombo, clears: this.clears, placements: this.placements, xp: this.xp, powersUsed: this.powersUsed, bubbles: this.bubblesGot, wind: this.wind });
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    this.events.push({ name, payload });
    this.sink?.emit(name, payload);
  }

  // ---------------------------------------------------------------- checking

  /** A 32-bit hash of everything that decides what happens next: the board, score, combo, slots and rng states. */
  digest(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      v |= 0;
      for (let k = 0; k < 4; k++) { h ^= (v >>> (k * 8)) & 0xff; h = Math.imul(h, 0x01000193); }
    };
    this.board.forEach(mix);
    [this.score, this.lines, this.combo, this.sparks, this.placements, this.clears, this.cp, this.trays, this.bagUsed ? 1 : 0, this.over ? 1 : 0].forEach(mix);
    for (const sl of [...this.tray, this.bag, ...this.next]) { mix(sl ? sl.s : -1); mix(sl ? sl.q : -1); }
    mix(this.streams.deal.state); mix(this.streams.turns.state);
    if (this.v2) {
      for (const k of this.powers) mix(k ? POP_POWERS.indexOf(k) : -1);
      mix(this.bubbles.length);
      for (const b of this.bubbles) { mix(b.cell); mix(POP_POWERS.indexOf(b.kind)); mix(b.left); }
      [this.bubbleIn, WIND_STATES.indexOf(this.wind), this.spinning ? 1 : 0, this.stuck ? 1 : 0, this.snap ? 1 : 0].forEach(mix);
      mix(this.streams.bubbles.state); mix(this.streams.powers.state); mix(this.streams.fresh.state);
    }
    return h >>> 0;
  }
}

/** A line's cells ordered from the end nearest any of `from` outward, or from the middle when the shape sits inside it. */
function orderFrom(line: number[], from: number[]): number[] {
  const inLine = line.map((c, k) => (from.includes(c) ? k : -1)).filter(k => k >= 0);
  const mid = inLine.length ? inLine.reduce((a, b) => a + b, 0) / inLine.length : (line.length - 1) / 2;
  return [...line].map((c, k) => ({ c, d: Math.abs(k - mid) })).sort((a, b) => a.d - b.d).map(o => o.c);
}

// ---------------------------------------------------------------- moves

/**
 * One intent as a small integer (two base-36 characters in a record): place = slot × 81 + cell (0-323),
 * bag = 324 + slot, end = 330, a power without a target = 331 + slot, spin = 334 + slot (0-3), Second
 * Wind = 338, a power with a target = 340 + slot × 100 + target (Sweep's line 0-17, Meteor's cell 0-80).
 */
export function encodeIntent(it: PopIntent): number {
  switch (it.t) {
    case 'place': return it.slot * 81 + it.y * 9 + it.x;
    case 'bag': return 324 + it.slot;
    case 'end': return 330;
    case 'power': return it.arg === undefined ? 331 + it.slot : 340 + it.slot * 100 + it.arg;
    case 'spin': return 334 + it.slot;
    case 'wind': return 338;
  }
}

export function decodeIntent(n: number): PopIntent | null {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n < 324) { const slot = Math.floor(n / 81), c = n % 81; return { t: 'place', slot, x: c % 9, y: Math.floor(c / 9) }; }
  if (n < 327) return { t: 'bag', slot: n - 324 };
  if (n === 330) return { t: 'end' };
  if (n === 331 || n === 332) return { t: 'power', slot: n - 331 };
  if (n >= 334 && n <= 337) return { t: 'spin', slot: n - 334 };
  if (n === 338) return { t: 'wind' };
  if (n >= 340 && n <= 420) return { t: 'power', slot: 0, arg: n - 340 };
  if (n >= 440 && n <= 520) return { t: 'power', slot: 1, arg: n - 440 };
  return null;
}

/** Undo's snapshot: everything a placement can change. */
interface Snap {
  /** The slot the placed shape came from (it goes back there). */
  from: number;
  board: Mask; cellShape: Int8Array; cellPiece: Int32Array;
  tray: (Slot | null)[]; next: Slot[]; bag: Slot | null; bagUsed: boolean;
  score: number; lines: number; combo: number; sparks: number; bestCombo: number; placements: number; clears: number; cp: number; trays: number;
  powers: (PopPower | null)[]; bubbles: Bubble[]; bubbleIn: number; wind: WindState; spinning: boolean;
  powersUsed: number; bubblesGot: number; history: number[]; rng: number[];
}

/** Re-exported for the view: which word and bit a cell is. */
export { cellBit };
