// Shape Tower game rules (gameplay.md), headless. No Phaser, no DOM, no trig.
// Units: blocks, y up, seconds. Rotation of the steered shape is in quarter turns (CCW positive).

import { Box2DEngine } from './engine/box2d.ts';
import type { PhysicsEngine } from './engine/types.ts';
import { JuiceBus } from './bus.ts';
import { makeStreams, type RngStreams } from './rng.ts';
import { SHAPES, bottomCells, colliderBoxes, extents, geometry, rotQ, rotate, type ColliderBox, type Rot } from './shapes.ts';
import {
  DEFAULT_TUNING, GRADE_FACTOR, biomeFor, bondDelayFor, budgetFor, fallSpeedFor, gapFor, gradeFor, gustFor,
  maxSlabWidthFor, mortarStrengthFor, type FoundationGrade, type Tuning,
} from './tuning.ts';

export const DT = 1 / 60;
/** Seconds between a gust's warning and its push (gameplay.md §8.3: at least 2 s). */
export const GUST_WARNING = 2;
/** How far under the checkpoint line a resting stack still counts as reaching it (contact slop). */
export const LINE_SLOP = 0.05;

export type PieceState = 'controlled' | 'landing' | 'settling' | 'settled' | 'stone' | 'lost';
export type Tint = 'ok' | 'amber' | 'red' | 'none';
export type Grade = 'perfect' | 'clean' | 'messy';
export type RunState = 'playing' | 'over';

export interface Intent {
  type: 'moveTo' | 'move' | 'rotate' | 'softDrop' | 'hardDrop' | 'hold' | 'power' | 'secondWind' | 'quit';
  x?: number;
  dir?: number;
  on?: boolean;
  lockX?: number;
  slot?: number;
}

/** Power-ups (gameplay.md §13): Clean Slate, Quick-Set, Undo, Glue, Slow-Mo. */
export type PowerKind = 'clean' | 'quickset' | 'undo' | 'glue' | 'slowmo';
export const POWER_KINDS: PowerKind[] = ['clean', 'quickset', 'undo', 'glue', 'slowmo'];

/**
 * How a run starts for Second Wind: 'ready' (the day's first Endless run, or the v2 upgrade),
 * 'earn' (ready once checkpoint 2 is claimed) or 'off' (scored Daily attempts).
 */
export type SecondWindMode = 'ready' | 'earn' | 'off';
export type SecondWindState = 'off' | 'earn' | 'ready' | 'used';

/** A power bubble floating above the tower. The steered shape collects it by passing through. */
export interface Bubble { id: number; kind: PowerKind; x: number; y: number; r: number; shapesLeft: number }

/** A lab slider change mid-run, logged with the intents so a replay applies it at the same step. */
export interface Retune { type: 'retune'; patch: Partial<Tuning> }
export type LoggedInput = { s: number; i: Intent | Retune };

export interface Ghost {
  x: number;
  y: number | null;
  rot: number;
  contacts: { x: number; y: number }[];
  supportIds: number[];
  tint: Tint;
  perfectFit: boolean;
  supportFraction: number;
  distance: number;
}

export interface PieceView {
  id: number;
  shape: string;
  state: PieceState;
  x: number;
  y: number;
  c: number;
  s: number;
  vx: number;
  vy: number;
  w: number;
  bonds: number;
  top: number;
}

export interface FoundationView { id: number; x: number; y: number; width: number; top: number; thickness: number; grade?: FoundationGrade }

interface Piece {
  id: number;
  shape: string;
  state: PieceState;
  segment: number;
  claimed: boolean;
  landTime: number;
  landX: number;
  restTime: number;
  graded: boolean;
  tintAtDrop: Tint;
  bonds: Map<number, number>; // other id -> joint id
  bullet: boolean;
  bondCheckAt: number;
  lostTime: number;
  glue: boolean;              // placed under Glue: bonds the moment it touches
  points: number;             // its placement score, taken back by Undo
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

interface Controlled {
  shape: string; x: number; y: number; rot: number; xTarget: number; soft: boolean; hard: boolean; speed: number;
  steerAt: number;            // sim time the player last moved or turned it
  touchedAt: number | null;   // sim time it first touched down without landing (touchdown grace)
}

interface Foundation { id: number; x: number; width: number; top: number; thickness: number; grade?: FoundationGrade }

interface Weld { a: number; b: number; x: number; y: number; k: number } // k: × break thresholds

export interface SimOptions {
  engine?: 'box2d' | 'rapier';
  seed?: number;
  tuning?: Partial<Tuning>;
  /** Spawn shapes from the bag automatically (the real game). QA sandboxes turn this off. */
  autoSpawn?: boolean;
  /** Use the fixed first-run opening sequence (gameplay.md §4.2). */
  rookieOpening?: boolean;
  /** Second Wind at the start of the run (default 'earn'). Recorded with the run so replays match. */
  secondWind?: SecondWindMode;
}

const ROOKIE_OPENING = ['O', 'I', 'L', 'O', 'J', 'T', 'I', 'O', 'L', 'J'];
const BAG_SIZE = 10;
const RESCUE = new Set(['O', 'I', 'Plank']);
const FIRST_FOUNDATION_WIDTH = 8;
const BULLET_SPEED = 10; // blocks/s

export class Sim {
  readonly tuning: Tuning;
  readonly bus = new JuiceBus();
  readonly engine: PhysicsEngine;
  readonly seed: number;
  readonly rng: RngStreams;

  stepIndex = 0;
  time = 0;
  state: RunState = 'playing';
  cause = '';

  // Progress
  checkpoint = 1;              // the checkpoint number being pursued
  foundations: Foundation[] = [];
  lineY = 0;
  private camera = { x: 0, y: 0, timeScale: 1 };
  readonly inputLog: LoggedInput[] = [];
  budget = 0;
  used = 0;
  hearts: number;
  score = 0;
  combo = 0;
  stats = { perfects: 0, cleans: 0, messies: 0, rows: 0, clutches: 0, checkpoints: 0, biomes: 0, lost: 0, placed: 0, maxHeight: 0, grades: [] as FoundationGrade[], powers: 0, secondWind: false, gusts: 0 };

  // Steering
  ctrl: Controlled | null = null;
  queue: string[] = [];
  held: string | null = null;
  holdUsed = false;

  // Power-ups and Second Wind (gameplay.md §13)
  slots: (PowerKind | null)[] = [null, null];
  bubble: Bubble | null = null;
  secondWind: SecondWindState;
  glueLeft = 0;                // shapes still to be placed under Glue
  slowLeft = 0;                // shapes still to fall under Slow-Mo

  private pieces = new Map<number, Piece>();
  private welds = new Map<number, Weld>();
  private nextId = 1;
  private autoSpawn: boolean;
  private opening: string[];
  private nextSpawnAt = 0;
  private claimPauseUntil = 0;
  private outOfBricksAt: number | null = null;
  private solidTo = 0;           // rows above the current foundation that are already stone
  private cascade: { start: number; last: number } | null = null;
  private pendingLost: Piece[] = [];
  private hold = { active: false, progress: 0 };
  private hazardScale = 1;
  /** The gust in progress (gameplay.md §8.3): warned 2 s ahead, then it blows for 2 to 3 s. */
  gust: { phase: 'idle' | 'warn' | 'blow'; dir: -1 | 1; strength: number; startStep: number; dur: number } = { phase: 'idle', dir: 1, strength: 0, startStep: 0, dur: 0 };
  private gustNext = -1;         // sim time the next gust may be warned (-1: not scheduled)
  private gustsSeen = 0;
  private lastGhost: Ghost | null = null;
  private lastGhostKey = '';
  private tensionValue = 0;
  private tensionSpike = 0;
  private swayValue = 0;
  private gravityScale = 1;
  private lastNear = -1;
  private bubbleIn = 0;          // shapes until the next bubble
  private bubbleSeq = 0;         // bubble ids (separate from body ids, so those match older builds)
  private lastPlaced: number | null = null;

  constructor(opts: SimOptions = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...(opts.tuning ?? {}) };
    this.seed = (opts.seed ?? 1) >>> 0;
    this.rng = makeStreams(this.seed);
    this.autoSpawn = opts.autoSpawn ?? true;
    this.opening = opts.rookieOpening === false ? [] : [...ROOKIE_OPENING];
    this.hearts = this.tuning.hearts;
    this.secondWind = opts.secondWind === 'ready' ? 'ready' : opts.secondWind === 'off' ? 'off' : 'earn';
    this.bubbleIn = this.bubbleGap();
    if (opts.engine === 'rapier') throw new Error('Rapier adapter is not built yet; use engine: "box2d"');
    this.engine = new Box2DEngine({ gravity: this.tuning.gravity, pushoutVelocity: this.tuning.pushoutVelocity, hitThreshold: 0.3 });

    // The plinth: an 8-wide raised pedestal, top surface at y = 0.
    const plinth = this.addFoundation(0, FIRST_FOUNDATION_WIDTH, 0, 1.0);
    this.lineY = plinth.top + gapFor(this.tuning, 1);
    this.budget = budgetFor(this.tuning, 1, plinth.width);
    this.refillQueue();
    this.bus.emit('run_start', { seed: this.seed });
    this.bus.emit('biome_entered', { id: 1 });
    if (this.secondWind === 'ready') this.bus.emit('second_wind_ready', { how: 'start' });
    if (this.tuning.startPower) this.grantPower('level_perk');
  }

  // ------------------------------------------------------------------ public API

  get foundation(): Foundation { return this.foundations[this.foundations.length - 1]; }

  step(n = 1): void {
    for (let i = 0; i < n; i++) this.stepOnce();
  }

  intent(i: Intent): void {
    // Every intent is logged with the step it arrived before, so a run replays exactly.
    this.inputLog.push({ s: this.stepIndex, i: { ...i } });
    if (this.state !== 'playing') return;
    if (i.type === 'quit') { this.endRun('quit'); return; }
    // Powers work with or without a shape in hand (between shapes, or out of bricks).
    if (i.type === 'power') { this.usePower(i.slot ?? 0); this.lastGhost = null; return; }
    if (i.type === 'secondWind') { this.useSecondWind(); this.lastGhost = null; return; }
    const c = this.ctrl;
    if (!c) return;
    switch (i.type) {
      case 'moveTo': c.xTarget = this.clampX(c, snap(i.x ?? c.x, this.tuning.snapStep)); break;
      case 'move': c.xTarget = this.clampX(c, c.xTarget + (i.dir ?? 0) * this.tuning.snapStep); break;
      case 'rotate': this.tryRotate(i.dir ?? 1); break;
      case 'softDrop': c.soft = !!i.on; this.bus.emit('soft_drop', { on: c.soft }); break;
      case 'hardDrop': {
        if (i.lockX !== undefined) {
          const lx = this.clampX(c, snap(i.lockX, this.tuning.snapStep));
          if (this.free(c.shape, lx, c.y, c.rot)) c.x = lx;
        }
        c.xTarget = c.x;
        c.hard = true;
        const g = this.ghost();
        this.bus.emit('hard_drop', { distance: g?.distance ?? 0 });
        break;
      }
      case 'hold': this.doHold(); break;
    }
    this.lastGhost = null;
  }

  /** Applies lab slider changes. Most take effect on the next shape; gravity applies at once. */
  retune(patch: Partial<Tuning>): void {
    this.inputLog.push({ s: this.stepIndex, i: { type: 'retune', patch: { ...patch } } });
    Object.assign(this.tuning, patch);
    this.engine.setGravity(0, -this.tuning.gravity * this.gravityScale);
  }

  /** Spawn the next shape now, ignoring timers (QA sandboxes, debug). */
  spawnControlled(opts: { shape?: string; x?: number; rot?: number } = {}): void {
    if (this.ctrl) return;
    const shape = opts.shape ?? this.takeNext();
    this.spawn(shape, opts.x, opts.rot ?? 0);
  }

  /** Put a piece straight into the world, for canonical towers. */
  placePiece(opts: { shape: string; x: number; y: number; rot?: number; as?: 'dynamic' | 'stone' }): number {
    const p = this.createPiece(opts.shape, opts.x, opts.y, rotQ(opts.rot ?? 0), 0, 0, opts.as === 'stone', opts.rot ?? 0);
    p.state = opts.as === 'stone' ? 'stone' : 'settling';
    p.graded = true;
    return p.id;
  }

  ghost(): Ghost | null {
    if (!this.ctrl) return null;
    if (!this.lastGhost) this.lastGhost = this.computeGhost(this.ctrl);
    return this.lastGhost;
  }

  pieceViews(): PieceView[] {
    const out: PieceView[] = [];
    for (const p of this.pieces.values()) {
      if (!this.engine.hasBody(p.id)) continue;
      const t = this.engine.transform(p.id);
      const v = this.engine.velocity(p.id);
      out.push({ id: p.id, shape: p.shape, state: p.state, x: t.x, y: t.y, c: t.c, s: t.s, vx: v.vx, vy: v.vy, w: v.w, bonds: p.bonds.size, top: p.top });
    }
    return out;
  }

  foundationViews(): FoundationView[] {
    return this.foundations.map(f => ({ id: f.id, x: f.x, y: f.top - f.thickness / 2, width: f.width, top: f.top, thickness: f.thickness, grade: f.grade }));
  }

  weldViews(): { x: number; y: number }[] {
    return [...this.welds.values()].map(w => ({ x: w.x, y: w.y }));
  }

  height(): { committed: number; provisional: number } {
    let committed = this.foundation.top, provisional = this.foundation.top;
    for (const p of this.pieces.values()) {
      if (p.state === 'lost' || p.state === 'controlled') continue;
      provisional = Math.max(provisional, p.top);
      if (p.state === 'settled' || p.state === 'stone') committed = Math.max(committed, p.top);
    }
    return { committed, provisional };
  }

  holdState(): { active: boolean; progress: number } { return { ...this.hold }; }

  /** The shape in hand waits: a checkpoint hold is running, or the claimed slab is still dropping in. */
  get hovering(): boolean {
    return this.tuning.holdHover && (this.hold.active || this.time < this.claimPauseUntil);
  }

  tension(): number { return this.tensionValue; }

  drainEvents() { return this.bus.drain(); }

  /** Short form of hash() (FNV-1a, 8 hex digits) for run records and replay checks. */
  digest(): string {
    const str = this.hash();
    let h = 0x811c9dc5;
    for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  hash(): string {
    const parts: string[] = [];
    for (const v of this.pieceViews()) parts.push(`${v.id}:${v.x.toFixed(4)},${v.y.toFixed(4)},${v.c.toFixed(4)},${v.s.toFixed(4)},${v.state}`);
    return `${this.stepIndex}|${parts.join(';')}`;
  }

  /** XP for the run so far (gameplay.md §10.1, before daily and streak boosts). */
  xp(quit = false): number {
    const H = Math.max(0, Math.floor(this.stats.maxHeight - this.foundations[0].top));
    let cp = 0;
    for (const g of this.stats.grades) cp += 30 * GRADE_FACTOR[g];
    let raw = 3 * H + cp + this.stats.perfects + 8 * this.stats.rows + 15 * this.stats.biomes + 2 * this.stats.clutches;
    if (this.stats.placed >= 10) raw += 10;
    if (quit) raw *= 0.5;
    const floor = this.time >= 30 ? 5 : 1;
    return Math.max(floor, Math.round(raw));
  }

  dispose(): void { this.engine.dispose(); }

  // ------------------------------------------------------------------ the step

  private stepOnce(): void {
    this.stepIndex++;
    this.bus.step = this.stepIndex;
    this.time += DT;
    this.lastGhost = null;

    this.applyEnvironment();
    if (this.state === 'playing') this.updateControlled();
    this.engine.step(DT, this.tuning.subSteps);
    this.processHits();
    this.updatePieces();
    this.updateMortar();
    this.updateTension();
    const h = this.height().committed;
    if (h > this.stats.maxHeight) this.stats.maxHeight = h;
    if (this.state === 'playing') {
      this.updateCheckpoint();
      this.applyHeartLosses();
      if (this.state === 'playing') this.updateSpawning();
    } else {
      this.pendingLost = [];
    }
    if (this.stepIndex % 6 === 0) this.emitSignals();
    if (this.ctrl) {
      const g = this.ghost();
      const key = g ? `${g.tint}|${g.perfectFit}` : '';
      if (key !== this.lastGhostKey) { this.lastGhostKey = key; if (g) this.bus.emit('ghost_fit', { perfect: g.perfectFit, tint: g.tint }); }
    }
  }

  // ------------------------------------------------------------------ environment

  private applyEnvironment(): void {
    // Hazards ease to zero during a hold (gameplay.md §7.3) and come back over 1 s.
    const target = this.hold.active ? 0 : 1;
    const rate = this.hold.active ? DT / 0.5 : DT / 1.0;
    this.hazardScale += Math.max(-rate, Math.min(rate, target - this.hazardScale));
    const wind = (this.tuning.wind + this.updateGust()) * this.hazardScale;
    if (wind === 0) return;
    const g = this.tuning.gravity * this.gravityScale;
    for (const p of this.pieces.values()) {
      if (p.state === 'stone' || p.state === 'lost') continue;
      this.engine.applyForce(p.id, wind * g * this.engine.mass(p.id), 0);
    }
  }

  /**
   * Runs the gust schedule and returns this step's push in g (+ pushes right). A gust is warned
   * 2 s ahead, never starts during a hold or the claim pause (a warning cut short by a hold is
   * called off and comes again after it), and only pushes pieces: the steered shape has no body.
   */
  private updateGust(): number {
    const t = this.tuning, g = this.gust;
    const spec = t.gusts && this.state === 'playing' ? gustFor(this.checkpoint) : null;
    if (!spec) {
      if (g.phase !== 'idle') { g.phase = 'idle'; this.bus.emit('hazard_end', { type: 'gust' }); }
      this.gustNext = -1;
      return 0;
    }
    const calm = this.hold.active || this.time < this.claimPauseUntil;
    // The first gust of a stretch comes 4 to 6 s in, after the biome title.
    if (this.gustNext < 0) this.gustNext = this.time + 4 + this.rng.hazards.int(21) / 10;
    if (g.phase === 'idle') {
      if (this.time < this.gustNext || calm) return 0;
      // first: the run's first gust (Sound's heads-up chime). intro: also the player's first ever,
      // so it blows at half strength with a card.
      const first = this.gustsSeen === 0, intro = first && t.hazardIntro;
      g.dir = this.rng.hazards.int(2) ? 1 : -1;
      g.strength = spec.strength * t.gustScale * (intro ? 0.5 : 1);
      g.dur = 2 + this.rng.hazards.int(11) / 10;
      g.startStep = this.stepIndex + Math.round(GUST_WARNING / DT);
      g.phase = 'warn';
      this.bus.emit('hazard_warning', { type: 'gust', dir: g.dir, eta: GUST_WARNING, strength: g.strength, first, intro });
      return 0;
    }
    if (g.phase === 'warn') {
      if (calm) {
        g.phase = 'idle';
        this.gustNext = this.time;
        this.bus.emit('hazard_end', { type: 'gust', cancelled: true });
      } else if (this.stepIndex >= g.startStep) {
        g.phase = 'blow';
        this.gustsSeen++;
        this.stats.gusts++;
        this.bus.emit('hazard_start', { type: 'gust', strength: g.strength, dir: g.dir, duration: g.dur });
      }
      return 0;
    }
    const e = (this.stepIndex - g.startStep) * DT;
    if (e >= g.dur) {
      g.phase = 'idle';
      this.gustNext = this.time + spec.interval * (85 + this.rng.hazards.int(31)) / 100;
      this.bus.emit('hazard_end', { type: 'gust' });
      return 0;
    }
    // Eases in over 0.4 s and out over the last 0.6 s.
    return g.dir * g.strength * Math.max(0, Math.min(1, e / 0.4, (g.dur - e) / 0.6));
  }

  // ------------------------------------------------------------------ steering

  private boxes(shape: string, q: number): ColliderBox[] {
    return colliderBoxes(shape, q, this.tuning.inset, this.tuning.cornerRadius);
  }

  private free(shape: string, x: number, y: number, rot: number): boolean {
    return this.engine.overlapBoxes(this.boxes(shape, rot), x, y, rotQ(rot)).length === 0;
  }

  private clampX(c: Controlled, x: number): number {
    const e = extents(c.shape, c.rot);
    const f = this.foundation;
    const lo = f.x - 7 - e.minX, hi = f.x + 7 - e.maxX;
    return Math.max(snapUp(lo, this.tuning.snapStep), Math.min(snapDown(hi, this.tuning.snapStep), x));
  }

  private updateControlled(): void {
    const c = this.ctrl;
    if (!c) return;
    const t = this.tuning;
    // Horizontal: walk to the target in snap steps, stopping at the first blocked step. A step
    // may lift the shape up to stepUp to clear a lip a hair higher than what it rests on (QA-003).
    let guard = 0;
    while (Math.abs(c.xTarget - c.x) > 1e-9 && guard++ < 64) {
      const dir = Math.sign(c.xTarget - c.x);
      const nx = Math.abs(c.xTarget - c.x) < t.snapStep ? c.xTarget : c.x + dir * t.snapStep;
      let ny = c.y;
      if (!this.free(c.shape, nx, ny, c.rot)) {
        ny = !c.hard && t.stepUp > 0 && this.free(c.shape, nx, c.y + t.stepUp, c.rot)
          ? this.bisect({ shape: c.shape, x: nx, rot: c.rot }, c.y, c.y + t.stepUp) : NaN;
      }
      if (Number.isNaN(ny)) { c.xTarget = c.x; break; }
      c.x = nx; c.y = ny; c.steerAt = this.time;
      this.bus.emit('piece_moved', { x: c.x, dx: dir });
      this.touchBubble(c);
    }
    // Something toppled into the shape: it becomes physical right away.
    if (!this.free(c.shape, c.x, c.y, c.rot)) { this.land(c, c.y, c.speed, true); return; }
    const fall = fallSpeedFor(t, this.checkpoint) * (this.slowLeft > 0 ? t.slowFactor : 1);
    // While a checkpoint is being held, and while the new slab drops in, the shape in hand hovers
    // so the player can react to the claim. Soft and hard drops still bring it down.
    const hover = !c.hard && !c.soft && this.hovering;
    c.speed = c.hard ? t.hardDropSpeed : hover ? 0 : fall * (c.soft ? t.softDropMult : 1);
    const ny = c.y - c.speed * DT;
    if (this.free(c.shape, c.x, ny, c.rot)) {
      c.y = ny;
      c.touchedAt = null;
      this.touchBubble(c);
      // It missed the tower entirely: it becomes a real piece and is Lost (costs a heart).
      if (c.y + extents(c.shape, c.rot).maxY < this.foundation.top - 1) this.missed(c);
      return;
    }
    const touchY = this.bisect(c, ny, c.y);
    // Touchdown grace (QA-003): a shape the player is still dragging or turning rests on what it
    // touched and stays steerable for a moment, so it can slide past a ledge instead of snagging.
    // Hard drops land at once.
    if (!c.hard && this.time - c.steerAt < t.touchGrace) {
      c.touchedAt ??= this.time;
      if (this.time - c.touchedAt < t.touchGraceMax) { c.y = touchY; return; }
    }
    this.land(c, touchY, c.speed, false);
  }

  /** Highest free y in [lo, hi], where lo overlaps and hi is free. */
  private bisect(c: { shape: string; x: number; rot: number }, lo: number, hi: number): number {
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (this.free(c.shape, c.x, mid, c.rot)) hi = mid; else lo = mid;
    }
    return hi;
  }

  private land(c: Controlled, y: number, speed: number, knocked: boolean): void {
    const t = this.tuning;
    const ghost = this.lastGhost ?? this.computeGhost(c);
    const touched = this.engine.overlapBoxes(this.boxes(c.shape, c.rot), c.x, y - 0.01, rotQ(c.rot));
    const vy = -(c.hard ? Math.min(2, t.impactCap) : Math.min(speed, t.impactCap));
    const p = this.createPiece(c.shape, c.x, y + 0.001, rotQ(c.rot), 0, vy, false, c.rot);
    p.state = 'landing';
    p.landTime = this.time;
    p.landX = c.x;
    p.tintAtDrop = knocked ? 'none' : ghost.tint;
    p.glue = this.glueLeft > 0;
    this.ctrl = null;
    this.used++;
    this.stats.placed++;
    this.lastPlaced = p.id;
    this.nextSpawnAt = this.time + t.spawnDelay;
    this.bus.emit('piece_landed', {
      id: p.id, shape: c.shape, impact: Math.min(1, speed / 12), x: c.x,
      pose: { x: c.x, y, rot: c.rot }, touchedIds: touched, knocked, glue: p.glue,
    });
    const left = this.budget - this.used;
    if (!t.infiniteBudget && (left === 5 || left === 3 || left === 1)) this.bus.emit('budget_low', { left });
    this.afterPlacement();
  }

  private missed(c: Controlled): void {
    const p = this.createPiece(c.shape, c.x, c.y, rotQ(c.rot), 0, -c.speed, false, c.rot);
    this.ctrl = null;
    this.used++;
    this.stats.placed++;
    this.lastPlaced = null;
    this.nextSpawnAt = this.time + this.tuning.spawnDelay;
    this.markLost(p);
    this.afterPlacement();
  }

  private tryRotate(dir: number): void {
    const c = this.ctrl!;
    const nr = (((c.rot - dir) % 4) + 4) % 4; // dir 1 = clockwise
    const kicks: [number, number][] = [[0, 0], [0.5, 0], [-0.5, 0], [1, 0], [-1, 0], [0, 0.5]];
    for (const [kx, ky] of kicks) {
      if (this.free(c.shape, c.x + kx, c.y + ky, nr)) {
        c.rot = nr; c.x += kx; c.y += ky;
        c.steerAt = this.time;
        c.xTarget = this.clampX(c, c.x);
        if (c.xTarget !== c.x && this.free(c.shape, c.xTarget, c.y, c.rot)) c.x = c.xTarget;
        this.bus.emit('piece_rotated', { dir, blocked: false });
        return;
      }
    }
    this.bus.emit('piece_rotated', { dir, blocked: true });
  }

  private doHold(): void {
    const c = this.ctrl!;
    if (this.holdUsed || !this.tuning.holdUnlocked) return;
    const swapIn = this.held ?? this.takeNext();
    this.held = c.shape;
    this.ctrl = null;
    this.spawn(swapIn, undefined, 0);
    this.holdUsed = true;
    this.bus.emit('hold_swap', { shape: this.held });
  }

  private spawn(shape: string, x: number | undefined, rot: number): void {
    const f = this.foundation;
    const e = extents(shape, rot);
    const w = e.maxX - e.minX;
    const left = f.x - f.width / 2;
    const sx = x ?? snap(left + Math.round((f.width - w) / 2) - e.minX, this.tuning.snapStep);
    const top = Math.max(this.height().provisional, f.top);
    const sy = top + this.tuning.spawnHeight - e.minY;
    this.ctrl = { shape, x: sx, y: sy, rot, xTarget: sx, soft: false, hard: false, speed: 0, steerAt: -Infinity, touchedAt: null };
    this.ctrl.xTarget = this.clampX(this.ctrl, sx);
    this.ctrl.x = this.ctrl.xTarget;
    this.holdUsed = false;
    this.bus.emit('piece_spawned', { shape, next: this.queue.slice(0, 2) });
    if (this.tuning.powerUps && !this.bubble && this.bubbleIn <= 0 && this.slots.includes(null)) this.makeBubble(top);
  }

  private takeNext(): string {
    if (this.queue.length < 3) this.refillQueue();
    const s = this.queue.shift()!;
    if (this.queue.length < 3) this.refillQueue();
    return s;
  }

  private refillQueue(): void {
    while (this.opening.length && this.queue.length < 12) this.queue.push(this.opening.shift()!);
    if (this.queue.length >= 3) return;
    this.queue.push(...this.makeBag());
  }

  private makeBag(): string[] {
    const n = this.checkpoint;
    const weights: [string, number][] = [['O', 2], ['I', 2], ['L', 2], ['J', 2], ['T', 2]];
    if (n >= 2) { const w = n >= 5 ? 1.5 : 1; weights.push(['S', w], ['Z', w]); }
    if (n >= 5) weights.push(['Domino', 1], ['Plank', 1]);
    const total = weights.reduce((a, [, w]) => a + w * 2, 0); // integer weights in halves
    const bag: string[] = [];
    const recent = this.queue.slice(-2);
    for (let i = 0; i < BAG_SIZE; i++) {
      const last2 = [...recent, ...bag].slice(-2);
      let pick = '';
      for (let tries = 0; tries < 8; tries++) {
        let r = this.rng.bag.int(total);
        for (const [k, w] of weights) { r -= w * 2; if (r < 0) { pick = k; break; } }
        if (!(last2.length === 2 && last2[0] === pick && last2[1] === pick)) break;
      }
      bag.push(pick);
    }
    if (!bag.some(k => RESCUE.has(k))) bag[this.rng.bag.int(BAG_SIZE)] = 'O';
    return bag;
  }

  // ------------------------------------------------------------------ pieces

  private createPiece(shape: string, x: number, y: number, rot: Rot, vx: number, vy: number, stone: boolean, q: number): Piece {
    const t = this.tuning;
    const id = this.nextId++;
    this.engine.addBody({
      id, boxes: this.boxes(shape, q), x, y, rot, vx, vy, dynamic: !stone,
      friction: t.friction, density: t.density, linearDamping: t.linearDamping, angularDamping: t.angularDamping,
    });
    const p: Piece = {
      id, shape, state: stone ? 'stone' : 'landing', segment: this.checkpoint, claimed: false,
      landTime: this.time, landX: x, restTime: 0, graded: false, tintAtDrop: 'none',
      bonds: new Map(), bullet: false, bondCheckAt: 0, lostTime: 0, glue: false, points: 0, top: y, bottom: y, cx: x, cy: y,
    };
    this.pieces.set(id, p);
    this.updateBounds(p);
    return p;
  }

  private addFoundation(x: number, width: number, top: number, thickness: number): Foundation {
    const id = this.nextId++;
    this.engine.addBody({
      id, boxes: [{ cx: 0, cy: 0, hw: width / 2 - 0.02, hh: thickness / 2 - 0.02, radius: 0.02 }],
      x, y: top - thickness / 2, rot: rotQ(0), vx: 0, vy: 0, dynamic: false,
      friction: this.tuning.foundationFriction, density: 1, linearDamping: 0, angularDamping: 0,
    });
    const f: Foundation = { id, x, width, top, thickness };
    this.foundations.push(f);
    return f;
  }

  private isFoundation(id: number): boolean { return this.foundations.some(f => f.id === id); }

  private updateBounds(p: Piece): void {
    const t = this.engine.transform(p.id);
    const g = geometry(p.shape);
    let top = -Infinity, bottom = Infinity;
    for (const [cx, cy] of g.cells) {
      for (const [ox, oy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const [rx, ry] = rotate(t, cx + ox, cy + oy);
        const yy = t.y + ry;
        if (yy > top) top = yy;
        if (yy < bottom) bottom = yy;
        void rx;
      }
    }
    p.top = top; p.bottom = bottom; p.cx = t.x; p.cy = t.y;
  }

  private updatePieces(): void {
    const t = this.tuning;
    const f = this.foundation;
    for (const p of [...this.pieces.values()]) {
      if (p.state === 'stone') continue;
      if (p.state === 'lost') {
        this.updateBounds(p);
        if (this.time - p.lostTime > 4 || p.cy < f.top - 60) {
          this.engine.removeBody(p.id);
          this.pieces.delete(p.id);
          this.bus.emit('piece_gone', { id: p.id, shape: p.shape, how: 'offscreen' });
        }
        continue;
      }
      this.updateBounds(p);
      const v = this.engine.velocity(p.id);
      const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
      const spin = Math.abs(v.w);
      const awake = this.engine.isAwake(p.id);
      // Box2D only sweeps against static bodies, so a thin piece falling fast onto a loose one can
      // sink into it (QA-001). Fast pieces become bullets until they slow down.
      const bullet = speed > BULLET_SPEED;
      if (bullet !== p.bullet) { p.bullet = bullet; this.engine.setBullet(p.id, bullet); }

      if (this.isLostPosition(p)) { this.markLost(p); continue; }

      if (p.state === 'landing') {
        if (t.squareUp && !(p.glue && p.bonds.size)) this.squareUp(p, v.w);
        if (this.time - p.landTime >= t.squareUpWindow) p.state = 'settling';
      }

      const resting = !awake || (speed < t.settleSpeed && spin < t.settleSpin);
      p.restTime = resting ? p.restTime + DT : 0;

      if ((p.state === 'settling' || p.state === 'landing') && p.restTime >= t.settleTime) {
        p.state = 'settled';
        if (p.claimed) { this.toStone(p); continue; }
        if (!p.graded) { p.graded = true; this.gradePlacement(p); }
      } else if (p.state === 'settled' && awake && (speed > 2 * t.settleSpeed || spin > 2 * t.settleSpin)) {
        p.state = 'settling';
      }
    }
  }

  private squareUp(p: Piece, w: number): void {
    const tr = this.engine.transform(p.id);
    const q = nearestQuarter(tr.c, tr.s);
    const r = rotQ(q);
    const err = tr.s * r.c - tr.c * r.s; // sin of the deviation from the nearest right angle
    if (Math.abs(err) > this.tuning.squareUpSin || Math.abs(err) < 1e-4) return;
    if (this.engine.contacts(p.id).length === 0) return;
    const target = -err * this.tuning.squareUpGain;
    const v = this.engine.velocity(p.id);
    this.engine.setVelocity(p.id, { vx: v.vx, vy: v.vy, w: w + (target - w) * 0.3 });
  }

  private isLostPosition(p: Piece): boolean {
    const top = this.foundation.top;
    if (p.cy >= top - 1) return false;
    if (p.cy < top - 3) return true;
    // Q21: a piece resting on old stone just below the slab is safe.
    for (let d = 0.25; d <= 1.5; d += 0.25) {
      for (const id of this.engine.overlapPoint(p.cx, p.cy - d, 0.05)) {
        if (id === p.id) continue;
        const o = this.pieces.get(id);
        if (this.isFoundation(id) || o?.state === 'stone') return false;
      }
    }
    return true;
  }

  private markLost(p: Piece): void {
    for (const [, jid] of p.bonds) this.removeWeld(jid);
    p.state = 'lost';
    p.lostTime = this.time;
    this.engine.setLost(p.id);
    this.stats.lost++;
    this.combo = 0;
    this.tensionSpike = 1;
    this.bus.emit('piece_lost', { id: p.id, shape: p.shape });
    if (!p.claimed) this.pendingLost.push(p);
  }

  private applyHeartLosses(): void {
    if (!this.pendingLost.length) return;
    const t = this.tuning;
    let lostNow = 0;
    for (const _ of this.pendingLost) {
      const c = this.cascade;
      if (c && this.time - c.last <= t.cascadeWindow && this.time - c.start <= t.cascadeCap) { c.last = this.time; continue; }
      this.cascade = { start: this.time, last: this.time };
      lostNow++;
    }
    this.pendingLost = [];
    if (!lostNow) return;
    if (!t.infiniteHearts) this.hearts = Math.max(0, this.hearts - lostNow);
    this.bus.emit('heart_lost', { count: lostNow, left: this.hearts });
    if (this.hearts === 1) this.bus.emit('last_heart', {});
    if (this.hearts === 0) this.endRun('hearts');
  }

  private toStone(p: Piece): void {
    if (p.state === 'lost') return;
    // Drop its bonds first: Box2D can't cleanly destroy a joint after a body changes type.
    // Dynamic neighbours re-bond to the stone on their next bond check.
    for (const [, jid] of [...p.bonds]) this.removeWeld(jid);
    this.engine.setStatic(p.id);
    p.state = 'stone';
  }

  // ------------------------------------------------------------------ grading, rows

  private gradePlacement(p: Piece): void {
    const tr = this.engine.transform(p.id);
    const q = nearestQuarter(tr.c, tr.s);
    const r = rotQ(q);
    const err = Math.abs(tr.s * r.c - tr.c * r.s);
    const slide = Math.abs(tr.x - p.landX);
    const support = this.supportFraction(p.id, p.shape, tr.x, tr.y, { c: tr.c, s: tr.s }, q);
    let grade: Grade = 'messy';
    if (err < 0.035 && slide < 0.1 && support >= 0.75) grade = 'perfect';
    else if (err < 0.105 && support >= 0.5) grade = 'clean';
    const mult = this.biomeMult();
    const clutch = p.tintAtDrop === 'amber' || p.tintAtDrop === 'red';
    let pts: number;
    if (grade === 'perfect') { this.combo++; this.stats.perfects++; } else this.combo = 0;
    if (grade === 'clean') this.stats.cleans++;
    if (grade === 'messy') this.stats.messies++;
    if (clutch) { pts = 200; this.stats.clutches++; this.tensionSpike = Math.max(this.tensionSpike, 0.8); }
    else pts = grade === 'perfect' ? 150 * Math.min(1 + 0.5 * (this.combo - 1), 4) : grade === 'clean' ? 50 : 10;
    p.points = pts * mult;
    this.addScore(p.points);
    this.bus.emit('piece_settled', { id: p.id, shape: p.shape, grade, support, clutch });
    if (grade === 'perfect') this.bus.emit('perfect', { combo: this.combo });
    if (clutch) this.bus.emit('clutch', {});
    this.checkRows(p);
  }

  /** Share of probe points under the piece's bottom cells that touch something else. */
  private supportFraction(selfId: number, shape: string, x: number, y: number, rot: Rot, q: number, out?: { x: number; y: number }[]): number {
    // Bottom cells come in the exact quarter-turn frame; `d` is the small leftover tilt of the real body.
    const cells = bottomCells(shape, q);
    const b = rotQ(q);
    const d: Rot = { c: rot.c * b.c + rot.s * b.s, s: rot.s * b.c - rot.c * b.s };
    const dy = -0.5 - 0.03; // just under the bottom face (bottom faces have no inset)
    let hits = 0, total = 0;
    for (const [bx, by] of cells) {
      for (const ox of [-0.4, -0.2, 0, 0.2, 0.4]) {
        const [wx, wy] = rotate(d, bx + ox, by + dy);
        total++;
        const ids = this.engine.overlapPoint(x + wx, y + wy, 0.015).filter(id => id !== selfId);
        if (ids.length) { hits++; out?.push({ x: x + wx, y: y + wy }); }
      }
    }
    return total ? hits / total : 0;
  }

  /** Bisects from a contact sample out to where the support under it ends (dir -1 left, +1 right). */
  private supportEdge(p: { x: number; y: number }, dir: number): number {
    let hit = p.x, miss = p.x + dir * 0.1;
    if (this.engine.overlapPoint(miss, p.y, 0.015).length) return miss;
    for (let i = 0; i < 5; i++) {
      const mid = (hit + miss) / 2;
      if (this.engine.overlapPoint(mid, p.y, 0.015).length) hit = mid; else miss = mid;
    }
    return hit;
  }

  private checkRows(p: Piece): void {
    const f = this.foundation;
    const k0 = Math.max(this.solidTo, Math.floor(p.bottom - f.top + 1e-3));
    const k1 = Math.floor(p.top - f.top - 1e-3);
    let newRows = 0;
    const rows: number[] = [];
    for (let k = k0; k <= k1; k++) {
      if (this.rowSolid(k)) { newRows++; rows.push(f.top + k + 0.5); this.solidify(f.top + k + 1); this.solidTo = k + 1; }
    }
    if (!newRows) return;
    this.stats.rows += newRows;
    const pts = [0, 500, 1200, 2000, 3000][Math.min(newRows, 4)];
    this.addScore(pts * this.biomeMult());
    this.bus.emit('row_solid', { count: newRows, rows, x: f.x, width: f.width });
  }

  private rowSolid(k: number): boolean {
    const f = this.foundation;
    const left = f.x - f.width / 2;
    const n = Math.round(f.width / 0.25);
    for (const h of [0.2, 0.5, 0.8]) {
      const y = f.top + k + h;
      let covered = 0;
      for (let i = 0; i < n; i++) {
        const ids = this.engine.overlapPoint(left + 0.125 + i * 0.25, y, 0.01);
        let hit = false;
        for (const id of ids) {
          const o = this.pieces.get(id);
          if (!o) continue;
          if (o.state !== 'settled' && o.state !== 'stone') return false;
          hit = true;
        }
        if (hit) covered++;
      }
      if (covered / n < this.tuning.rowCoverage) return false;
    }
    return true;
  }

  private solidify(rowTop: number): void {
    for (const p of this.pieces.values()) {
      if (p.state === 'settled' && p.bottom < rowTop - 0.01) this.toStone(p);
    }
  }

  // ------------------------------------------------------------------ mortar

  private updateMortar(): void {
    const t = this.tuning;
    if (!t.mortar) {
      if (this.welds.size) for (const jid of [...this.welds.keys()]) this.removeWeld(jid);
      return;
    }
    const delay = bondDelayFor(t, this.checkpoint);
    for (const p of this.pieces.values()) {
      if (p.bonds.size >= t.maxBonds || this.time < p.bondCheckAt) continue;
      // Glue (power-up): a glued shape bonds to anything it touches straight away.
      const glued = p.glue && p.state !== 'stone' && p.state !== 'lost';
      if (!glued && (p.state !== 'settled' || p.restTime < delay)) continue;
      p.bondCheckAt = this.time + (glued ? 0.1 : 0.5);
      for (const c of this.engine.contacts(p.id)) {
        if (p.bonds.size >= t.maxBonds) break;
        if (c.points.length < (glued ? 1 : 2) || p.bonds.has(c.other)) continue;
        const o = this.pieces.get(c.other);
        const isF = this.isFoundation(c.other);
        if (!isF && (!o || o.state === 'lost')) continue;
        if (!glued && o && (o.state === 'landing' || o.state === 'settling' || (o.state === 'settled' && o.restTime < delay))) continue;
        const n = c.points.length;
        const ax = n > 1 ? (c.points[0][0] + c.points[1][0]) / 2 : c.points[0][0];
        const ay = n > 1 ? (c.points[0][1] + c.points[1][1]) / 2 : c.points[0][1];
        const jid = this.engine.addWeld(p.id, c.other, ax, ay, t.bondHertz, t.bondDamping);
        if (!jid) continue;
        const k = p.glue || o?.glue ? t.glueStrength : 1;
        this.welds.set(jid, { a: p.id, b: c.other, x: ax, y: ay, k });
        p.bonds.set(c.other, jid);
        o?.bonds.set(p.id, jid);
        this.bus.emit('bond_formed', { pos: { x: ax, y: ay }, glue: k !== 1 });
      }
    }
    // Break overloaded bonds.
    const strength = mortarStrengthFor(t, this.checkpoint);
    const g = t.gravity * this.gravityScale;
    for (const [jid, w] of [...this.welds]) {
      const load = this.engine.weldLoad(jid);
      if (!load) continue;
      const ma = this.pieces.get(w.a)?.state === 'stone' ? Infinity : this.engine.mass(w.a) || Infinity;
      const mb = this.pieces.get(w.b)?.state === 'stone' || this.isFoundation(w.b) ? Infinity : this.engine.mass(w.b) || Infinity;
      const weight = Math.min(ma, mb) * g;
      if (!isFinite(weight)) { this.removeWeld(jid); continue; }
      if (load.force > t.breakForce * strength * w.k * weight || load.torque > t.breakTorque * strength * w.k * weight) {
        this.removeWeld(jid);
        this.bus.emit('bond_broken', { pos: { x: w.x, y: w.y }, force: load.force / weight });
      }
    }
  }

  private removeWeld(jid: number): void {
    const w = this.welds.get(jid);
    if (!w) return;
    this.engine.removeWeld(jid);
    this.welds.delete(jid);
    this.pieces.get(w.a)?.bonds.delete(w.b);
    this.pieces.get(w.b)?.bonds.delete(w.a);
  }

  // ------------------------------------------------------------------ checkpoints

  private updateCheckpoint(): void {
    const { committed } = this.height();
    const remaining = this.lineY - committed;
    if (remaining > LINE_SLOP && remaining < 3) {
      const r = Math.ceil(remaining);
      if (r !== this.lastNear) { this.lastNear = r; this.bus.emit('checkpoint_near', { blocks: r }); }
    }
    // Contact slop leaves resting stacks a hair under their true height, so the line counts as
    // reached within LINE_SLOP.
    const reached = committed >= this.lineY - LINE_SLOP;
    if (!this.hold.active) {
      if (reached) {
        this.hold = { active: true, progress: 0 };
        this.bus.emit('checkpoint_hold', { progress: 0 });
      }
      return;
    }
    if (!reached) {
      this.hold = { active: false, progress: 0 };
      this.bus.emit('checkpoint_cancelled', {});
      return;
    }
    const band = committed - 1.5;
    let moving = false;
    for (const p of this.pieces.values()) {
      if (p.state === 'lost' || p.state === 'stone' || p.top < band) continue;
      if (p.state !== 'settled') { moving = true; break; }
    }
    if (!moving) this.hold.progress += DT / this.tuning.holdTime;
    if (this.stepIndex % 6 === 0) this.bus.emit('checkpoint_hold', { progress: Math.min(1, this.hold.progress) });
    if (this.hold.progress >= 1) this.claim(committed);
  }

  private claim(towerTop: number): void {
    const t = this.tuning;
    const n = this.checkpoint;
    for (const p of this.pieces.values()) {
      if (p.state === 'lost' || p.state === 'stone') continue;
      p.claimed = true;
      if (p.state === 'settled') this.toStone(p);
    }
    // Foundation grade from top coverage (gameplay.md §7.3).
    let covered = 0, sumX = 0;
    for (let x = -20 + 0.125; x < 20; x += 0.25) {
      let hit = false;
      for (const dy of [0.15, 0.5, 0.85]) {
        if (this.engine.overlapPoint(x, towerTop - dy, 0.01).some(id => this.pieces.has(id) || this.isFoundation(id))) { hit = true; break; }
      }
      if (hit) { covered++; sumX += x; }
    }
    const coverage = covered * 0.25;
    const centre = covered ? sumX / covered : this.foundation.x;
    const grade = gradeFor(coverage, maxSlabWidthFor(n));
    const width = Math.max(t.minSlabWidth, Math.min(maxSlabWidthFor(n + 1), Math.round(coverage) + 1));
    // Keep slab edges on the half-block grid: even widths centre on whole blocks, odd on half blocks.
    const cx = width % 2 === 0 ? Math.round(centre) : Math.round(centre - 0.5) + 0.5;
    const slab = this.addFoundation(cx, width, towerTop + 0.01 + t.slabThickness, t.slabThickness);
    slab.grade = grade;
    this.stats.grades.push(grade);
    this.stats.checkpoints++;

    const leftover = t.infiniteBudget ? 0 : Math.max(0, this.budget - this.used);
    const gradeBonus = { S: 1500, A: 1000, B: 500, C: 0 }[grade];
    this.addScore((1000 * n + 100 * leftover + gradeBonus) * this.biomeMult());

    const biome = biomeFor(n);
    const before = this.hearts;
    this.hearts = n === biome.lastCp ? t.hearts : Math.min(t.hearts, this.hearts + 1);
    if (this.hearts > before) this.bus.emit('heart_restored', { left: this.hearts });
    this.bus.emit('checkpoint_claimed', { n, grade, leftover, width, coverage });
    // Second Wind is earned at checkpoint 2. A player who already has it (or has used it) gets a
    // power-up instead, as does an S grade.
    if (n === 2) {
      if (this.secondWind === 'earn') { this.secondWind = 'ready'; this.bus.emit('second_wind_ready', { how: 'earned' }); }
      else this.grantPower('second_wind');
    }
    if (grade === 'S') this.grantPower('grade');

    this.checkpoint = n + 1;
    const nb = biomeFor(this.checkpoint);
    if (nb.id !== biome.id) {
      this.stats.biomes++;
      this.gravityScale = nb.gravity;
      this.engine.setGravity(0, -t.gravity * nb.gravity);
      this.bus.emit('biome_entered', { id: nb.id, name: nb.name });
    }
    this.lineY = slab.top + gapFor(t, this.checkpoint);
    this.budget = budgetFor(t, this.checkpoint, width);
    this.used = 0;
    this.outOfBricksAt = null;
    this.solidTo = 0;
    this.hold = { active: false, progress: 0 };
    this.claimPauseUntil = this.time + 1.5;
    // A shape in hand close to the new slab moves up so it has room to be steered (and the slab
    // never lands on it).
    const c = this.ctrl;
    if (c && t.holdHover) {
      const e = extents(c.shape, c.rot);
      const minY = slab.top + t.claimClearance - e.minY;
      if (c.y < minY && this.free(c.shape, c.x, minY, c.rot)) { c.y = minY; c.touchedAt = null; this.bus.emit('piece_lifted', { y: minY }); }
      c.xTarget = this.clampX(c, c.xTarget);
    }
    this.lastNear = -1;
    this.cascade = null;
  }

  // ------------------------------------------------------------------ spawning, budget, run over

  private updateSpawning(): void {
    if (!this.autoSpawn || this.ctrl || this.hold.active) return;
    if (this.time < this.claimPauseUntil || this.time < this.nextSpawnAt) return;
    const t = this.tuning;
    if (t.infiniteBudget || this.used < this.budget) { this.spawn(this.takeNext(), undefined, 0); return; }
    // Out of bricks: a grace period while things settle (gameplay.md §7.2).
    if (this.outOfBricksAt === null) this.outOfBricksAt = this.time;
    if (this.time - this.outOfBricksAt >= t.budgetGrace) this.endRun('bricks');
  }

  /** Ends the run from the pause menu (XP × 0.5). Logged like an intent, so replays end there too. */
  quit(): void { this.intent({ type: 'quit' }); }

  private endRun(cause: string): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.cause = cause;
    this.ctrl = null;
    this.bus.emit('run_over', { cause, height: this.stats.maxHeight, checkpoints: this.stats.checkpoints, score: Math.round(this.score), xp: this.xp(cause === 'quit') });
  }

  // ------------------------------------------------------------------ power-ups (gameplay.md §13)

  /** Shapes until the next bubble: bubbleGap − 1 to bubbleGap + 2. */
  private bubbleGap(): number {
    return Math.max(2, Math.round(this.tuning.bubbleGap) - 1 + this.rng.powers.int(4));
  }

  /** Bookkeeping after each shape is placed or missed: Glue and Slow-Mo counts, and the bubble. */
  private afterPlacement(): void {
    if (this.glueLeft > 0 && --this.glueLeft === 0) this.bus.emit('power_ended', { kind: 'glue' });
    if (this.slowLeft > 0 && --this.slowLeft === 0) this.bus.emit('power_ended', { kind: 'slowmo' });
    const b = this.bubble;
    if (b) {
      // It fades after bubbleLife shapes, or once the tower grows up into it.
      if (--b.shapesLeft <= 0 || b.y - b.r < this.height().provisional) this.popBubble(false);
    } else if (this.slots.includes(null)) this.bubbleIn--;
  }

  private makeBubble(top: number): void {
    const f = this.foundation;
    // Beside the foundation, 1 to 1.5 blocks out from its edge (kept on screen), 2.2 to 4.2
    // blocks above the tower. Shapes dropped onto the foundation miss it, so collecting one
    // takes a deliberate steer out and back (QA found bubbles over the foundation were picked
    // up by accident).
    const side = this.rng.powers.int(2) ? 1 : -1;
    const x = f.x + side * Math.min(f.width / 2 + 1 + 0.5 * this.rng.powers.int(2), 5.25);
    const y = top + 2.2 + 0.5 * this.rng.powers.int(5);
    this.bubble = { id: ++this.bubbleSeq, kind: this.pickKind(), x, y, r: this.tuning.bubbleRadius, shapesLeft: Math.max(1, Math.round(this.tuning.bubbleLife)) };
    this.bubbleIn = this.bubbleGap();
    this.bus.emit('bubble_spawned', { id: this.bubble.id, kind: this.bubble.kind, x, y });
  }

  /** Removes the bubble: collected (the shape went through it) or faded. */
  private popBubble(collected: boolean, slot = -1): void {
    const b = this.bubble;
    if (!b) return;
    this.bubble = null;
    if (collected) this.bus.emit('power_collected', { id: b.id, kind: b.kind, slot, x: b.x, y: b.y });
    else this.bus.emit('bubble_expired', { id: b.id, kind: b.kind, x: b.x, y: b.y });
  }

  /** The steered shape collects the bubble when any of its cells reaches the bubble's circle. */
  private touchBubble(c: Controlled): void {
    const b = this.bubble;
    if (!b) return;
    const slot = this.slots.indexOf(null);
    if (slot < 0) return;
    const r = rotQ(c.rot);
    for (const [cx, cy] of geometry(c.shape).cells) {
      const [rx, ry] = rotate(r, cx, cy);
      const dx = Math.max(0, Math.abs(b.x - c.x - rx) - 0.5);
      const dy = Math.max(0, Math.abs(b.y - c.y - ry) - 0.5);
      if (dx * dx + dy * dy <= b.r * b.r) {
        this.slots[slot] = b.kind;
        this.popBubble(true, slot);
        return;
      }
    }
  }

  /** Picks a power, weighted towards what the tower needs right now. */
  private pickKind(): PowerKind {
    const t = this.tuning;
    const w: Record<PowerKind, number> = { clean: 2, quickset: 2, undo: 2, glue: 2, slowmo: 2 };
    const left = t.infiniteBudget ? Infinity : this.budget - this.used;
    if (!t.infiniteHearts && this.hearts <= 1) w.clean += 2;
    if (left <= 4) { w.clean += 2; w.undo += 1; }
    if (this.tensionValue >= 0.5) { w.quickset += 2; w.glue += 1; }
    if (this.checkpoint >= 4) w.slowmo += 1; // shapes fall faster from here
    for (const k of this.slots) if (k) w[k] = Math.max(1, w[k] >> 1); // fewer doubles, halves round down
    if (!t.mortar) w.glue = 0; // Glue works through Mortar's bonds (QA-006)
    let r = this.rng.powers.int(POWER_KINDS.reduce((a, k) => a + w[k], 0));
    for (const k of POWER_KINDS) { r -= w[k]; if (r < 0) return k; }
    return 'clean';
  }

  /** A power straight into a free slot (an S grade, or checkpoint 2 when Second Wind is taken). */
  private grantPower(why: string): void {
    const slot = this.slots.indexOf(null);
    if (slot < 0 || !this.tuning.powerUps) return;
    const kind = this.pickKind();
    this.slots[slot] = kind;
    this.bus.emit('power_granted', { kind, slot, why });
  }

  private usePower(slot: number): void {
    const kind = this.slots[slot];
    if (!kind) return;
    let detail: Record<string, unknown> | null = null;
    switch (kind) {
      case 'clean': { const r = this.sweep(); if (r.pieces.length) detail = r; break; }
      case 'quickset': detail = this.quickSet(); break;
      case 'undo': detail = this.undo(); break;
      case 'glue': if (!this.glueLeft && this.tuning.mortar) { this.glueLeft = Math.max(1, Math.round(this.tuning.glueShapes)); detail = { shapes: this.glueLeft }; } break;
      case 'slowmo': if (!this.slowLeft) { this.slowLeft = Math.max(1, Math.round(this.tuning.slowShapes)); detail = { shapes: this.slowLeft }; } break;
    }
    // Nothing for it to do (no loose pieces, nothing to take back, already running): it stays.
    if (!detail) { this.bus.emit('power_refused', { kind, slot }); return; }
    this.slots[slot] = null;
    this.stats.powers++;
    this.bus.emit('power_used', { kind, slot, ...detail });
  }

  private removePiece(p: Piece): void {
    for (const [, jid] of [...p.bonds]) this.removeWeld(jid);
    this.engine.removeBody(p.id);
    this.pieces.delete(p.id);
    if (this.lastPlaced === p.id) this.lastPlaced = null;
  }

  /**
   * Clean Slate (and Second Wind): every loose piece of this stretch leaves the tower and its
   * bricks come back. Stone (Solid Rows) and pieces from claimed stretches stay.
   */
  private sweep(): { pieces: { id: number; shape: string; x: number; y: number }[]; refund: number } {
    const pieces: { id: number; shape: string; x: number; y: number }[] = [];
    for (const p of [...this.pieces.values()]) {
      if (p.claimed || p.state === 'stone' || p.state === 'lost') continue;
      pieces.push({ id: p.id, shape: p.shape, x: p.cx, y: p.cy });
      this.removePiece(p);
    }
    const refund = Math.min(pieces.length, this.used);
    this.used -= refund;
    this.outOfBricksAt = null;
    if (pieces.length) this.bus.emit('pieces_swept', { pieces });
    return { pieces, refund };
  }

  /** Quick-Set: everything resting on something turns to stone now. Shapes in free fall stay. */
  private quickSet(): { ids: number[] } | null {
    const set: Piece[] = [];
    for (const p of this.pieces.values()) {
      if (p.state === 'stone' || p.state === 'lost') continue;
      if (p.state !== 'settled' && this.engine.contacts(p.id).length === 0) continue;
      p.graded = true;
      this.toStone(p);
      set.push(p);
    }
    if (!set.length) return null;
    set.sort((a, b) => a.bottom - b.bottom || a.id - b.id);
    for (const p of set) this.checkRows(p);
    return { ids: set.map(p => p.id) };
  }

  /** Undo: the last shape placed comes back to the player's hand, with its brick and points. */
  private undo(): { id: number; shape: string; x: number; y: number } | null {
    const p = this.lastPlaced === null ? undefined : this.pieces.get(this.lastPlaced);
    if (!p || p.claimed || p.state === 'stone' || p.state === 'lost') return null;
    const out = { id: p.id, shape: p.shape, x: p.cx, y: p.cy };
    this.removePiece(p);
    this.used = Math.max(0, this.used - 1);
    this.stats.placed = Math.max(0, this.stats.placed - 1);
    this.score -= p.points;
    this.outOfBricksAt = null;
    // The shape already falling goes back to the front of the queue.
    if (this.ctrl) { this.queue.unshift(this.ctrl.shape); this.ctrl = null; }
    this.spawn(p.shape, undefined, 0);
    return out;
  }

  /**
   * Second Wind, once per run when the player chooses: Clean Slate, hearts back to full and this
   * stretch's bricks back to full.
   */
  private useSecondWind(): void {
    if (this.secondWind !== 'ready') { this.bus.emit('power_refused', { kind: 'secondWind' }); return; }
    const { pieces, refund } = this.sweep();
    const before = this.hearts;
    this.secondWind = 'used';
    this.stats.secondWind = true;
    this.hearts = Math.max(this.hearts, this.tuning.hearts);
    this.used = 0;
    this.outOfBricksAt = null;
    this.cascade = null;
    this.bus.emit('second_wind', { pieces: pieces.length, refund, hearts: this.hearts, restored: this.hearts - before, bricks: this.budget });
    if (this.hearts > before) this.bus.emit('heart_restored', { left: this.hearts });
  }

  // ------------------------------------------------------------------ hits, tension, signals

  private processHits(): void {
    const hits = this.engine.hits();
    let n = 0;
    for (const h of hits) {
      if (n++ >= 8) break;
      // Stone for slabs and stone pieces. Other pieces leave the material out and say which biome
      // they were placed in, so Sound can use that biome's finish (Art's BIOMES[].finish).
      const mat = (id: number) => (this.isFoundation(id) || this.pieces.get(id)?.state === 'stone' ? 'stone' : undefined);
      const biome = (id: number) => biomeFor(this.pieces.get(id)?.segment ?? this.checkpoint).id;
      const cells = (id: number) => { const p = this.pieces.get(id); return p ? SHAPES[p.shape].cells.length : 0; };
      this.bus.emit('contact_hit', {
        bodyA: h.a, bodyB: h.b, materialA: mat(h.a), materialB: mat(h.b), biomeA: biome(h.a), biomeB: biome(h.b),
        approachSpeed: h.speed, impulsePerMass: h.speed, point: { x: h.x, y: h.y }, size: Math.max(1, cells(h.a), cells(h.b)),
      });
    }
  }

  private updateTension(): void {
    if (this.stepIndex % 6 !== 0) return;
    const f = this.foundation;
    const { provisional } = this.height();
    let swaySum = 0, swayN = 0, mass = 0, mx = 0;
    for (const p of this.pieces.values()) {
      if (p.state === 'lost' || p.state === 'stone') continue;
      const v = this.engine.velocity(p.id);
      if (p.top >= provisional - 3) { swaySum += Math.abs(v.vx) + Math.abs(v.w) * 0.5; swayN++; }
      const m = this.engine.mass(p.id);
      mass += m; mx += m * p.cx;
    }
    const sway = swayN ? swaySum / swayN : 0;
    this.swayValue = sway;
    const sway01 = Math.min(1, sway / 0.6);
    const over = mass ? Math.min(1, Math.abs(mx / mass - f.x) / (f.width / 2)) : 0;
    this.tensionSpike = Math.max(0, this.tensionSpike - 0.1 / 3);
    const target = Math.min(1, Math.max(sway01, 0.6 * over * over + 0.4 * sway01, 0.9 * this.tensionSpike));
    this.tensionValue += (target - this.tensionValue) * 0.3;
  }

  /** The view reports its camera and time scale here so Sound gets them with the other signals. */
  setCamera(x: number, y: number, timeScale = 1): void {
    this.camera = { x, y, timeScale };
  }

  private emitSignals(): void {
    const f = this.foundation;
    const { committed } = this.height();
    this.bus.emit('signals', {
      altitude: committed,
      biome: biomeFor(this.checkpoint).id,
      checkpointProgress: Math.max(0, Math.min(1, (committed - f.top) / Math.max(0.001, this.lineY - f.top))),
      tension: this.tensionValue,
      sway: this.swayValue,
      difficultyTier: this.checkpoint,
      gravityScale: this.gravityScale,
      foundationX: f.x,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      timeScale: this.camera.timeScale,
    });
  }

  // ------------------------------------------------------------------ ghost

  private computeGhost(c: { shape: string; x: number; y: number; rot: number }): Ghost {
    const f = this.foundation;
    const floor = f.top - 4;
    let hi = c.y, lo = c.y;
    let found = false;
    // Scan down in half-block steps (thinner than any collider), then bisect.
    while (lo > floor) {
      lo = hi - 0.5;
      if (!this.free(c.shape, c.x, lo, c.rot)) { found = true; break; }
      hi = lo;
    }
    if (!found) {
      return { x: c.x, y: null, rot: c.rot, contacts: [], supportIds: [], tint: 'none', perfectFit: false, supportFraction: 0, distance: 0 };
    }
    const gy = this.bisect(c, lo, hi);
    const supportIds = this.engine.overlapBoxes(this.boxes(c.shape, c.rot), c.x, gy - 0.01, rotQ(c.rot));
    const contacts: { x: number; y: number }[] = [];
    const support = this.supportFraction(-1, c.shape, c.x, gy, rotQ(c.rot), c.rot, contacts);
    const g = geometry(c.shape);
    const [comX] = rotate(rotQ(c.rot), g.com[0], g.com[1]);
    const cx = c.x + comX;
    let tint: Tint = 'ok';
    if (contacts.length === 0) tint = supportIds.length ? 'amber' : 'none';
    else {
      let left = contacts[0], right = contacts[0];
      for (const p of contacts) { if (p.x < left.x) left = p; if (p.x > right.x) right = p; }
      // Samples are 0.2 apart, so find each end of the support properly (up to 0.1 past the last hit).
      const minX = this.supportEdge(left, -1), maxX = this.supportEdge(right, 1);
      const span = Math.max(maxX - minX, 0.2);
      if (cx < minX - 0.02 || cx > maxX + 0.02) {
        // A part hanging below the pivot that already touches something on the support side can't
        // swing through it, so the shape is braced rather than tipping.
        const dir = cx < minX ? 1 : -1;
        const braced = this.engine.overlapBoxes(this.boxes(c.shape, c.rot), c.x + dir * (this.tuning.inset + 0.02), gy + 0.03, rotQ(c.rot)).length > 0;
        tint = braced ? 'amber' : 'red';
      } else if (cx - minX < 0.15 * span || maxX - cx < 0.15 * span) tint = 'amber';
    }
    return { x: c.x, y: gy, rot: c.rot, contacts, supportIds, tint, perfectFit: support >= 0.75, supportFraction: support, distance: c.y - gy };
  }

  // ------------------------------------------------------------------ helpers

  private biomeMult(): number { return 1 + 0.25 * (biomeFor(this.checkpoint).id - 1); }

  private addScore(pts: number): void { this.score += pts; }
}

function snap(x: number, step: number): number { return Math.round(x / step) * step; }
function snapUp(x: number, step: number): number { return Math.ceil(x / step - 1e-9) * step; }
function snapDown(x: number, step: number): number { return Math.floor(x / step + 1e-9) * step; }

function nearestQuarter(c: number, s: number): number {
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 0 : 2;
  return s >= 0 ? 1 : 3;
}

export { SHAPES };
