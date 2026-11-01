// Blockling Pop's sim (Pop plan §3, §5, §15): intents in, state and events out. Turn-based and integer,
// with no clock, so a run is its seed plus its list of intents, and a digest after each one makes a
// replay checkable anywhere (the phone, QA's bots, the server).
//
// Milestone 1: the board, the tray of three and the next tray, the bag (one swap per tray), popping
// rows, columns and squares, scoring with the combo and its two sparks, All Clear, checkpoints and the
// biome they reach, No room and ending a run. Power-ups and Second Wind come with milestone 3.

import { Rng } from '../../sim/rng.ts';
import { CELLS, EMPTY, LINE_CELLS, type Mask, cellBit, count, fits, fullLines, has, isEmpty, linesMask } from './board.ts';
import { type Slot, dealTray, slotFits } from './deal.ts';
import { POP_SHAPES, type Turn } from './shapes.ts';
import { POP_RULES, POP_TUNING, type PopTuning, comboMult, linePoints } from './tuning.ts';

export type PopModeId = 'endless' | 'daily';

export interface PopOptions {
  seed: number;
  mode?: PopModeId;
  /** Deal rule 2 for the whole run (the player's first few Pop runs). */
  newPlayer?: boolean;
  /** Only these shapes (Daily Pop). */
  set?: readonly string[] | null;
  tuning?: Partial<PopTuning>;
}

/** Tray slots 0 to 2; the bag is slot 3. */
export const BAG = 3;

export type PopIntent =
  | { t: 'place'; slot: number; x: number; y: number }
  | { t: 'bag'; slot: number }
  | { t: 'end' };

export interface PopEvent { name: string; payload: Record<string, unknown> }

export interface EventSink { emit(name: string, payload: Record<string, unknown>): void }

export type PopCause = 'noroom' | 'end';

/** Biome index (0 Meadow ... 9 Deep Cosmos) with `cp` checkpoints claimed: the tower's schedule (Pop plan §6). */
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
  readonly rules = POP_RULES;

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

  private readonly streams: { deal: Rng; turns: Rng; bubbles: Rng; powers: Rng; fresh: Rng };
  private history: number[] = [];

  constructor(o: PopOptions, sink: EventSink | null = null) {
    this.seed = o.seed >>> 0;
    this.mode = o.mode ?? 'endless';
    this.newPlayer = !!o.newPlayer;
    this.set = o.set ?? null;
    this.tuning = { ...POP_TUNING, ...o.tuning };
    this.sparks = this.tuning.sparks;
    const root = new Rng(this.seed ^ 0x5a17b10c);
    // New streams go on the end, so the earlier ones keep their values for a given seed.
    this.streams = { deal: new Rng(root.nextU32()), turns: new Rng(root.nextU32()), bubbles: new Rng(root.nextU32()), powers: new Rng(root.nextU32()), fresh: new Rng(root.nextU32()) };
    this.sink = sink;
    // The first tray and the one after it, both against the empty board.
    const first = this.deal();
    this.next = this.deal();
    this.events = [];
    this.bringTray(first);
    this.emit('pop_start', { seed: this.seed, mode: this.mode });
  }

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

  /** XP the run has earned so far (Pop plan §12): 6 per line, 40 per checkpoint, 1 per placement, 100 per All Clear. */
  get xp(): number {
    const t = this.tuning;
    return t.xpLine * this.lines + t.xpCp * this.cp + t.xpPlace * this.placements + t.xpClear * this.clears;
  }

  get biome(): number { return popBiome(this.cp); }

  /** Lines into the current checkpoint, and the lines it needs. */
  get cpProgress(): { into: number; need: number } {
    return { into: this.lines - this.cp * this.tuning.linesPerCp, need: this.tuning.linesPerCp };
  }

  // ---------------------------------------------------------------- intents

  /** Applies one intent. Returns false (and changes nothing) when it isn't allowed now. */
  apply(it: PopIntent): boolean {
    if (this.over) return false;
    this.events = [];
    let ok = false;
    if (it.t === 'place') ok = this.place(it.slot, it.x, it.y);
    else if (it.t === 'bag') ok = this.toBag(it.slot);
    else if (it.t === 'end') { ok = true; this.finish('end'); }
    if (!ok) return false;
    this.moves.push(encodeIntent(it));
    if (!this.over) this.checkRoom();
    return true;
  }

  private place(i: number, x: number, y: number): boolean {
    const sl = this.slot(i);
    const t = this.turn(i);
    const m = this.maskAt(i, x, y);
    if (!sl || !t || !m || !fits(this.board, m)) return false;
    const T = this.tuning;
    const piece = ++this.placements;
    const cells = t.cells.map(([cx, cy]) => (y + cy) * 9 + x + cx);
    for (const c of cells) { this.cellShape[c] = sl.s; this.cellPiece[c] = piece; }
    this.board = [this.board[0] | m[0], this.board[1] | m[1], this.board[2] | m[2]];
    if (i === BAG) this.bag = null; else this.tray[i] = null;
    this.emit('pop_placed', { slot: i, shape: POP_SHAPES[sl.s].key, s: sl.s, q: sl.q, x, y, cells, piece });

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
      if (isEmpty(this.board)) {
        this.clears++;
        gained += T.allClear;
        this.emit('pop_all_clear', { points: T.allClear, clears: this.clears });
      }
      const cp = Math.floor(this.lines / T.linesPerCp);
      while (this.cp < cp) {
        const before = this.biome;
        this.cp++;
        this.emit('pop_checkpoint', { n: this.cp, biome: this.biome, lines: this.lines });
        if (this.biome !== before) this.emit('biome_entered', { id: this.biome });
      }
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
    this.score += gained;
    this.emit('pop_score', { score: this.score, gained, lines: lines.length });
    if (this.tray.every(s => s === null)) this.refill();
    return true;
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

  /** No room: nothing in the tray or the bag fits anywhere, so the run is over. */
  private checkRoom(): void {
    for (let i = 0; i <= BAG; i++) if (this.fitsAnywhere(i)) return;
    this.emit('pop_no_room', { filled: this.filled });
    this.finish('noroom');
  }

  private finish(cause: PopCause): void {
    this.over = true;
    this.cause = cause;
    this.emit('run_over', { cause, score: this.score, lines: this.lines, cp: this.cp, combo: this.bestCombo, clears: this.clears, placements: this.placements, xp: this.xp });
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

/** One intent as a small integer: place = slot × 81 + cell (0-323), bag = 324 + slot, end = 330. */
export function encodeIntent(it: PopIntent): number {
  if (it.t === 'place') return it.slot * 81 + it.y * 9 + it.x;
  if (it.t === 'bag') return 324 + it.slot;
  return 330;
}

export function decodeIntent(n: number): PopIntent | null {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n < 324) { const slot = Math.floor(n / 81), c = n % 81; return { t: 'place', slot, x: c % 9, y: Math.floor(c / 9) }; }
  if (n < 327) return { t: 'bag', slot: n - 324 };
  if (n === 330) return { t: 'end' };
  return null;
}

/** Re-exported for the view: which word and bit a cell is. */
export { cellBit };
