// Shape Tower game rules (gameplay.md), headless. No Phaser, no DOM, no trig.
// Units: blocks, y up, seconds. Rotation of the steered shape is in quarter turns (CCW positive).

import { Box2DEngine } from './engine/box2d.ts';
import type { PhysicsEngine, WorldSettings } from './engine/types.ts';
import { JuiceBus } from './bus.ts';
import { makeStreams, type RngStreams } from './rng.ts';
import { SHAPES, bottomCells, colliderBoxes, extents, geometry, rotQ, rotate, type ColliderBox, type Rot } from './shapes.ts';
import {
  DEFAULT_TUNING, GRADE_FACTOR, REMIX_POOL, biomeFor, bondDelayFor, budgetFor, fallSpeedFor, gapFor, gradeFor,
  hazardsFor, maxSlabWidthFor, minSlabWidthFor, mortarStrengthFor, setStreakFor, startWaitFor, type FoundationGrade, type HazardKind, type LateHazard,
  type StretchHazards, type Tuning,
} from './tuning.ts';

export const DT = 1 / 60;
/**
 * Physics engines by name. Box2D is built in; the Rapier adapter (engine/rapier.ts) registers
 * itself where it's wanted, so its WebAssembly stays out of builds that don't use it.
 */
const ENGINES: Partial<Record<'box2d' | 'rapier', (s: WorldSettings) => PhysicsEngine>> = { box2d: s => new Box2DEngine(s) };
export function registerEngine(name: 'box2d' | 'rapier', make: (s: WorldSettings) => PhysicsEngine): void { ENGINES[name] = make; }

/** Seconds between a gust's warning and its push (gameplay.md §8.3: at least 2 s). */
export const GUST_WARNING = 2;
/** How far under the checkpoint line a resting stack still counts as reaching it (contact slop). */
export const LINE_SLOP = 0.05;
/** Every hazard is warned this many seconds ahead (gameplay.md §8.3). */
export const HAZARD_WARNING = 2;
/** Dust devils cross the tower at this speed, blocks/s, and push within this distance of their middle. */
const DEVIL_SPEED = 2.5;
const DEVIL_REACH = 2.25;
const DEVIL_CORE = 0.6;   // blocks either side of its middle where it cracks the mortar

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
  /** A brittle shape (§4.3), and how cracked it is: 0 to 2, then 3 while it creaks before breaking. */
  brittle: boolean;
  strain: number;
}

export interface FoundationView { id: number; x: number; y: number; width: number; top: number; thickness: number; grade?: FoundationGrade }

/**
 * A piece of space junk or a meteor (gameplay.md §8.2): warned with a reticle on the spot it will
 * hit, it flies in on a straight line, bumps that piece once and leaves. It never touches the
 * steered shape and is never part of the tower. Positions in blocks, y up.
 */
export interface Shot {
  id: number;
  kind: 'junk' | 'meteor';
  /** Which junk sprite (0 to 2). */
  skin: number;
  phase: 'warn' | 'fly' | 'out';
  x: number;
  y: number;
  hitX: number;
  hitY: number;
  vx: number;
  vy: number;
  /** The side it comes from: 1 = from the right. */
  dir: -1 | 1;
  appearStep: number;
  hitStep: number;
  outStep: number;
  target: number | null;
  lx: number;
  ly: number;
  impulse: number;
}

/** A dust devil (Red Planet): a swirling column that crosses the top rows, pushing them its way. */
export interface Devil { id: number; dir: -1 | 1; strength: number; phase: 'warn' | 'blow'; startStep: number; endStep: number; x0: number; x: number; y: number }

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
  brittle: boolean;           // §4.3: breaks under brittleLoad cells until it turns to stone
  load: number;               // cells of loose pieces resting on it (brittle shapes only)
  strain: number;             // crack stage, 0 to 3
  fuse: number;               // s it has creaked under the full load
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

interface Controlled {
  shape: string; x: number; y: number; rot: number; xTarget: number; soft: boolean; hard: boolean; speed: number;
  brittle: boolean;
  steerAt: number;            // sim time the player last moved or turned it
  touchedAt: number | null;   // sim time it first touched down without landing (touchdown grace)
  waitUntil: number;          // sim time it starts to fall: early stretches give a new shape a moment at the top
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
  /** Start at this checkpoint, with its gravity, hazards, shapes and levers (QA's balance sweeps). */
  startCheckpoint?: number;
}

const ROOKIE_OPENING = ['O', 'I', 'L', 'O', 'J', 'T', 'I', 'O', 'L', 'J'];
const BAG_SIZE = 10;
const RESCUE = new Set(['O', 'I', 'Plank']);
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
  /** Clean or Perfect placements in a row; full rows turn to stone once it reaches setNeed (§9.1). */
  streak = 0;
  private live = { perfects: 0, cleans: 0, messies: 0, rows: 0, clutches: 0, checkpoints: 0, biomes: 0, lost: 0, placed: 0, maxHeight: 0, grades: [] as FoundationGrade[], powers: 0, secondWind: false, gusts: 0, hazards: 0, hits: 0, brittle: 0, mended: 0, crumbled: 0 };
  private banked: typeof this.live | null = null;
  private overAt: number | null = null;
  /**
   * The run's stats. They stop at run over, as the run banked them: pieces still settle afterwards
   * (the panorama, the summary), and nothing read later should disagree with the run's XP and height.
   */
  get stats(): typeof this.live { return this.banked ?? this.live; }

  // Steering
  ctrl: Controlled | null = null;
  queue: string[] = [];
  /** Which queued shapes are brittle, decided as each first shows in the preview (§4.3). */
  private queueBrittle: (boolean | undefined)[] = [];
  held: string | null = null;
  heldBrittle = false;
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
  /** This stretch's hazards (gameplay.md §8.2), planned as the stretch begins. */
  stretch: StretchHazards;
  /**
   * Crosswind and tidal sway: warned 2 s into the stretch, then on until it is claimed. Strengths are
   * this stretch's, already halved for a first-ever appearance.
   */
  weather = { phase: 'idle' as 'idle' | 'warn' | 'on', startStep: 0, crossDir: 1 as -1 | 1, crosswind: 0, sway: null as { amplitude: number; period: number } | null };
  /** The sway's sideways pull this step, in g (+ pulls right). The view tilts the backdrop with it. */
  tilt = 0;
  /** Space junk and meteors on their way; the view draws them. */
  shots: Shot[] = [];
  /** The dust devil, while one is warned or blowing. */
  devil: Devil | null = null;
  private crossSet = false;
  private stretchCp = 0;         // the checkpoint `stretch` was planned for
  private junkNext = -1;
  private meteorNext = -1;
  private devilNext = -1;
  private devilCracked = new Set<number>(); // pieces this devil has already cracked
  private hazardSeq = 0;
  /** Late hazards met this run, for `first` (Sound's heads-up) and the half-strength first ever. */
  private met = new Set<string>();
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
  private sinceBrittle = 0;      // shapes dealt since the last brittle one

  constructor(opts: SimOptions = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...(opts.tuning ?? {}) };
    // Zen (gameplay.md §12): nothing to count and nothing to lose, so nothing to win back either.
    if (this.tuning.zen) { this.tuning.infiniteBudget = true; this.tuning.infiniteHearts = true; this.tuning.widestSlabs = true; }
    this.seed = (opts.seed ?? 1) >>> 0;
    this.rng = makeStreams(this.seed);
    this.autoSpawn = opts.autoSpawn ?? true;
    this.opening = opts.rookieOpening === false ? [] : [...ROOKIE_OPENING];
    this.hearts = this.tuning.hearts;
    this.secondWind = this.tuning.zen ? 'off' : opts.secondWind === 'ready' ? 'ready' : opts.secondWind === 'off' ? 'off' : 'earn';
    this.bubbleIn = this.bubbleGap();
    const make = ENGINES[opts.engine ?? 'box2d'];
    if (!make) throw new Error(`physics engine "${opts.engine}" is not loaded: await useRapier() from testApi.ts first (or registerEngine after initRapier)`);
    this.engine = make({ gravity: this.tuning.gravity, pushoutVelocity: this.tuning.pushoutVelocity, hitThreshold: 0.3 });

    // The plinth: a raised pedestal (12 wide), top surface at y = 0.
    const plinth = this.addFoundation(0, this.tuning.plinthWidth, 0, 1.0);
    this.checkpoint = Math.max(1, Math.floor(opts.startCheckpoint ?? 1));
    const biome = biomeFor(this.checkpoint);
    if (biome.gravity !== 1) { this.gravityScale = biome.gravity; this.engine.setGravity(0, -this.tuning.gravity * biome.gravity); }
    this.lineY = plinth.top + gapFor(this.tuning, this.checkpoint);
    this.budget = budgetFor(this.tuning, this.checkpoint, plinth.width);
    this.stretch = this.planStretch();
    this.stretchCp = this.checkpoint;
    this.refillQueue();
    this.dealPreview();
    this.bus.emit('run_start', { seed: this.seed });
    this.bus.emit('biome_entered', { id: biome.id });
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
  spawnControlled(opts: { shape?: string; x?: number; rot?: number; brittle?: boolean; wait?: boolean } = {}): void {
    if (this.ctrl) return;
    const n = opts.shape ? { shape: opts.shape, brittle: !!opts.brittle } : this.takeNext();
    this.spawn(n.shape, opts.x, opts.rot ?? 0, n.brittle, opts.wait ?? false);
  }

  /** Put a piece straight into the world, for canonical towers. */
  placePiece(opts: { shape: string; x: number; y: number; rot?: number; as?: 'dynamic' | 'stone'; brittle?: boolean }): number {
    const p = this.createPiece(opts.shape, opts.x, opts.y, rotQ(opts.rot ?? 0), 0, 0, opts.as === 'stone', opts.rot ?? 0);
    p.state = opts.as === 'stone' ? 'stone' : 'settling';
    p.graded = true;
    p.brittle = !!opts.brittle && opts.as !== 'stone';
    return p.id;
  }

  /** Whether the two shapes in the preview are brittle (§4.3). */
  nextBrittle(): boolean[] { return [this.queueBrittle[0] ?? false, this.queueBrittle[1] ?? false]; }

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
      out.push({ id: p.id, shape: p.shape, state: p.state, x: t.x, y: t.y, c: t.c, s: t.s, vx: v.vx, vy: v.vy, w: v.w, bonds: p.bonds.size, top: p.top, brittle: p.brittle, strain: p.strain });
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

  /** The shape in hand is still waiting at the top before it falls (an early stretch's start wait). */
  get waiting(): boolean {
    return !!this.ctrl && this.time < this.ctrl.waitUntil;
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

  /**
   * XP for the run so far (gameplay.md §10.1, before daily and streak boosts). Zen pays exactly half
   * and quitting doesn't halve it again, because quitting is how a Zen run ends (§12, QA Q33).
   */
  xp(quit = false): number {
    const H = Math.max(0, Math.floor(this.stats.maxHeight - this.foundations[0].top));
    let cp = 0;
    for (const g of this.stats.grades) cp += 30 * GRADE_FACTOR[g];
    let raw = 3 * H + cp + this.stats.perfects + 8 * this.stats.rows + 15 * this.stats.biomes + 2 * this.stats.clutches;
    if (this.stats.placed >= 10) raw += 10;
    if (quit || this.tuning.zen) raw *= 0.5;
    const floor = (this.overAt ?? this.time) >= 30 ? 5 : 1;
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
    this.updateBrittle();
    this.updateTension();
    const h = this.height().committed;
    if (h > this.live.maxHeight) this.live.maxHeight = h;
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
    // A new stretch (or a sandbox that set `checkpoint` itself) gets its hazards planned.
    if (this.stretchCp !== this.checkpoint) { this.endWeather(); this.stretch = this.planStretch(); this.stretchCp = this.checkpoint; }
    const wind = (this.tuning.wind + this.updateGust() + this.updateWeather()) * this.hazardScale;
    this.updateShots();
    this.updateDevil();
    const g = this.tuning.gravity * this.gravityScale;
    if (wind !== 0) {
      for (const p of this.pieces.values()) {
        if (p.state === 'stone' || p.state === 'lost') continue;
        this.engine.applyForce(p.id, wind * g * this.engine.mass(p.id), 0);
      }
    }
    // The dust devil pushes the top rows within its reach, its way and a little up, strongest in its middle.
    const d = this.devil;
    if (d && d.phase === 'blow') {
      const e = (this.stepIndex - d.startStep) * DT, dur = (d.endStep - d.startStep) * DT;
      const ease = Math.max(0, Math.min(1, e / 0.3, (dur - e) / 0.3)) * this.hazardScale;
      for (const p of this.pieces.values()) {
        if (p.state === 'stone' || p.state === 'lost' || p.top < d.y) continue;
        const dx = Math.abs(p.cx - d.x);
        if (dx >= DEVIL_REACH) continue;
        // Its middle cracks the mortar of what it passes through, once per piece (it bonds again at rest).
        if (dx < DEVIL_CORE && p.bonds.size && !this.devilCracked.has(p.id)) {
          this.devilCracked.add(p.id);
          this.crack(p, 'dust');
        }
        const f = d.strength * (1 - dx / DEVIL_REACH) * ease * g * this.engine.mass(p.id);
        this.engine.applyForce(p.id, d.dir * f, 0.35 * f);
      }
    }
  }

  /**
   * Runs the gust schedule and returns this step's push in g (+ pushes right). A gust is warned
   * 2 s ahead, never starts during a hold or the claim pause (a warning cut short by a hold is
   * called off and comes again after it), and only pushes pieces: the steered shape has no body.
   */
  private updateGust(): number {
    const t = this.tuning, g = this.gust;
    const spec = t.gusts && this.state === 'playing' ? this.stretch.gust : null;
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
      g.strength = spec.strength * t.gustScale * this.zenEase * (intro ? 0.5 : 1);
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
        this.live.gusts++;
        this.bus.emit('hazard_start', { type: 'gust', strength: g.strength, dir: g.dir, duration: g.dur });
      }
      return 0;
    }
    const e = (this.stepIndex - g.startStep) * DT;
    if (e >= g.dur) {
      g.phase = 'idle';
      // §8.2's interval runs start to start: the next warning comes 2 s before it, never before now.
      this.gustNext = Math.max(this.time, this.time - e + spec.interval * (85 + this.rng.hazards.int(31)) / 100 - GUST_WARNING);
      this.bus.emit('hazard_end', { type: 'gust' });
      return 0;
    }
    // Eases in over 0.4 s and out over the last 0.6 s.
    return g.dir * g.strength * Math.max(0, Math.min(1, e / 0.4, (g.dur - e) / 0.6));
  }

  // ------------------------------------------------------------------ late hazards (gameplay.md §8.2)

  /** Plans the stretch about to begin: Deep Cosmos's remix, the crosswind's side, half strengths. */
  private planStretch(): StretchHazards {
    const n = this.checkpoint, t = this.tuning;
    let remix: HazardKind[] = [];
    if (n >= 23) {
      const a = this.rng.late.int(REMIX_POOL.length), b = (a + 1 + this.rng.late.int(REMIX_POOL.length - 1)) % REMIX_POOL.length;
      remix = [REMIX_POOL[a], REMIX_POOL[b]];
    }
    const st = hazardsFor(n, remix), w = this.weather;
    const k = (h: LateHazard) => t.hazardStrength * this.zenEase * (this.introFor(h) ? 0.5 : 1);
    w.crosswind = 0;
    w.sway = null;
    if (st.crosswind > 0) {
      // Its side is drawn once, then it flips every checkpoint.
      if (!this.crossSet) { w.crossDir = this.rng.late.int(2) ? 1 : -1; this.crossSet = true; } else w.crossDir = w.crossDir > 0 ? -1 : 1;
      w.crosswind = st.crosswind * k('crosswind');
    }
    if (st.sway) w.sway = { amplitude: st.sway.amplitude * k('sway'), period: st.sway.period };
    return st;
  }

  /** A late hazard's first appearance ever: half strength, with a card. */
  private introFor(h: LateHazard): boolean { return !this.met.has(h) && !this.tuning.seenHazards.includes(h); }

  private meet(h: LateHazard): { first: boolean; intro: boolean } {
    const first = !this.met.has(h), intro = this.introFor(h);
    this.met.add(h);
    this.live.hazards++;
    return { first, intro };
  }

  private get calm(): boolean { return this.hold.active || this.time < this.claimPauseUntil; }

  /**
   * Crosswind and tidal sway, as one sideways pull in g (+ pulls right). Both are warned 2 s into
   * the stretch and ease in over 2 s; holds ease them out with the other hazards.
   */
  private updateWeather(): number {
    const w = this.weather;
    const on = this.tuning.lateHazards && this.state === 'playing' && (w.crosswind > 0 || w.sway !== null);
    if (!on) { this.endWeather(); return 0; }
    if (w.phase === 'idle') {
      if (this.calm) return 0;
      w.phase = 'warn';
      w.startStep = this.stepIndex + Math.round(HAZARD_WARNING / DT);
      if (w.crosswind > 0) {
        const intro = this.introFor('crosswind');
        this.bus.emit('hazard_warning', { type: 'crosswind', dir: w.crossDir, eta: HAZARD_WARNING, strength: w.crosswind, first: !this.met.has('crosswind'), intro });
      }
      if (w.sway) {
        const intro = this.introFor('sway');
        this.bus.emit('hazard_warning', { type: 'sway', eta: HAZARD_WARNING, amplitude: w.sway.amplitude, period: w.sway.period, drift: this.stretch.sway?.period !== 8, first: !this.met.has('sway'), intro });
      }
      return 0;
    }
    if (w.phase === 'warn') {
      if (this.stepIndex < w.startStep) return 0;
      w.phase = 'on';
      if (w.crosswind > 0) { this.meet('crosswind'); this.bus.emit('hazard_start', { type: 'crosswind', dir: w.crossDir, strength: w.crosswind }); }
      if (w.sway) { this.meet('sway'); this.bus.emit('hazard_start', { type: 'sway', amplitude: w.sway.amplitude, period: w.sway.period }); }
    }
    const e = (this.stepIndex - w.startStep) * DT, ramp = Math.min(1, e / 2);
    this.tilt = w.sway ? w.sway.amplitude * ramp * swing(e / w.sway.period) : 0;
    return w.crossDir * w.crosswind * ramp + this.tilt;
  }

  private endWeather(): void {
    const w = this.weather;
    this.tilt = 0;
    if (w.phase === 'idle') return;
    const cancelled = w.phase === 'warn';
    w.phase = 'idle';
    if (w.crosswind > 0) this.bus.emit('hazard_end', { type: 'crosswind', cancelled });
    if (w.sway) this.bus.emit('hazard_end', { type: 'sway', cancelled });
  }

  /** Where the tidal sway will pull `ahead` seconds from now, -1 (left) to 1 (right). The plumb bob leads with it. */
  swayAhead(ahead = 1): number {
    const w = this.weather;
    if (!w.sway || w.phase !== 'on') return 0;
    return swing(((this.stepIndex - w.startStep) * DT + ahead) / w.sway.period);
  }

  /** Space junk (Orbit) and meteor showers (Moon): scheduling, flight, the hit, and leaving. */
  private updateShots(): void {
    const st = this.stretch, t = this.tuning;
    const on = t.lateHazards && this.state === 'playing';
    const calm = this.calm;
    if (on && st.junk > 0) {
      if (this.junkNext < 0) this.junkNext = this.time + 4 + this.rng.late.int(21) / 10;
      if (!calm && this.time >= this.junkNext) {
        this.junkNext = this.fireJunk() ? this.time + st.junk * (85 + this.rng.late.int(31)) / 100 : this.time + 2;
      }
    } else this.junkNext = -1;
    if (on && st.meteor > 0) {
      if (this.meteorNext < 0) this.meteorNext = this.time + 4 + this.rng.late.int(21) / 10;
      if (!calm && this.time >= this.meteorNext) {
        this.meteorNext = this.fireShower() ? this.time + st.meteor * (85 + this.rng.late.int(31)) / 100 : this.time + 2;
      }
    } else this.meteorNext = -1;

    for (const s of [...this.shots]) {
      // A hold calls off what hasn't hit yet: anything already flying sails past.
      if (s.phase !== 'out' && (calm || !on)) {
        this.bus.emit('hazard_end', { type: s.kind, id: s.id, cancelled: true });
        if (s.phase === 'warn') { this.shots.splice(this.shots.indexOf(s), 1); continue; }
        s.phase = 'out'; s.target = null; s.outStep = this.stepIndex + Math.round(1.5 / DT);
      }
      if (s.phase === 'warn' && this.stepIndex >= s.appearStep) {
        s.phase = 'fly';
        this.bus.emit('hazard_start', { type: s.kind, id: s.id });
      }
      if (s.phase === 'fly') {
        // It homes on the spot it was aimed at, so a piece that shifted a little still gets hit there.
        const tp = this.shotPoint(s);
        if (tp) { s.hitX = tp[0]; s.hitY = tp[1]; }
        const left = (s.hitStep - this.stepIndex) * DT;
        s.x = s.hitX - s.vx * left; s.y = s.hitY - s.vy * left;
        if (this.stepIndex >= s.hitStep) this.shotHits(s, tp !== null);
        continue;
      }
      if (s.phase === 'out') {
        s.x += s.vx * DT; s.y += s.vy * DT;
        if (s.kind === 'junk') s.vy -= 2 * DT;
        if (this.stepIndex >= s.outStep) {
          this.shots.splice(this.shots.indexOf(s), 1);
          if (s.target !== -1) this.bus.emit('hazard_end', { type: s.kind, id: s.id });
        }
      }
    }
  }

  /** Loose pieces in the top 3 blocks: what junk and meteors aim at. */
  private targets(): Piece[] {
    const top = this.height().provisional;
    const out: Piece[] = [];
    for (const p of this.pieces.values()) {
      if (p.claimed || p.state === 'lost' || p.state === 'stone' || p.top < top - 3) continue;
      out.push(p);
    }
    return out;
  }

  /** Aims at a piece: its outermost cell's face on side `dir` (junk), or its top cell's top (meteors). */
  private aim(p: Piece, kind: 'junk' | 'meteor', dir: -1 | 1): { wx: number; wy: number; lx: number; ly: number } {
    const tr = this.engine.transform(p.id);
    let best: [number, number] | null = null, score = -Infinity;
    for (const [cx, cy] of geometry(p.shape).cells) {
      const [rx, ry] = rotate(tr, cx, cy);
      const v = kind === 'junk' ? dir * rx + 0.01 * ry : ry;
      if (v > score + 1e-6) { score = v; best = [tr.x + rx, tr.y + ry]; }
    }
    const [bx, by] = best!;
    const wx = kind === 'junk' ? bx + 0.5 * dir : bx + (this.rng.late.int(3) - 1) * 0.2;
    const wy = kind === 'junk' ? by : by + 0.5;
    // In the piece's own frame, so the spot moves with it.
    const [lx, ly] = rotate({ c: tr.c, s: -tr.s }, wx - tr.x, wy - tr.y);
    return { wx, wy, lx, ly };
  }

  private shotPoint(s: Shot): [number, number] | null {
    if (s.target === null || s.target < 0) return null;
    const p = this.pieces.get(s.target);
    if (!p || p.state === 'lost' || p.state === 'stone' || !this.engine.hasBody(p.id)) return null;
    const tr = this.engine.transform(p.id);
    const [rx, ry] = rotate(tr, s.lx, s.ly);
    return [tr.x + rx, tr.y + ry];
  }

  /**
   * Junk goes for an outer piece up top (the outermost, now and then the next one in) and shoves it
   * outward. The 2 s warning is time to brace it with the next shape.
   */
  private fireJunk(): boolean {
    const c = this.targets();
    if (!c.length) return false;
    const fx = this.foundation.x;
    c.sort((a, b) => Math.abs(b.cx - fx) - Math.abs(a.cx - fx) || b.id - a.id);
    const p = c[Math.min(c.length - 1, this.rng.late.int(3) === 0 ? 1 : 0)];
    const dir: -1 | 1 = p.cx >= fx ? -1 : 1;
    const a = this.aim(p, 'junk', dir);
    const { intro, first } = this.meet('junk');
    const k = this.tuning.hazardStrength * this.zenEase * this.cosmos() * (intro ? 0.5 : 1);
    const warn = Math.round(HAZARD_WARNING / DT), flight = 1.4;
    const s: Shot = {
      id: ++this.hazardSeq, kind: 'junk', skin: this.rng.late.int(3), phase: 'warn', x: a.wx + dir * 7, y: a.wy + 1.1, hitX: a.wx, hitY: a.wy,
      vx: -dir * 7 / flight, vy: -1.1 / flight, dir, appearStep: this.stepIndex + warn - Math.round(flight / DT), hitStep: this.stepIndex + warn, outStep: 0,
      target: p.id, lx: a.lx, ly: a.ly, impulse: this.tuning.junkImpulse * k,
    };
    this.shots.push(s);
    this.bus.emit('hazard_warning', { type: 'junk', id: s.id, dir, eta: HAZARD_WARNING, at: { x: s.hitX, y: s.hitY }, from: { x: s.x, y: s.y }, first, intro });
    return true;
  }

  private fireShower(): boolean {
    const c = this.targets();
    if (!c.length) return false;
    const dir: -1 | 1 = this.rng.late.int(2) ? 1 : -1;
    const n = 2 + this.rng.late.int(3);
    const { intro, first } = this.meet('meteor');
    const k = this.tuning.hazardStrength * this.zenEase * this.cosmos() * (intro ? 0.5 : 1);
    const flight = 0.8, list: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      const p = c[this.rng.late.int(c.length)];
      const a = this.aim(p, 'meteor', dir);
      const hitStep = this.stepIndex + Math.round((HAZARD_WARNING + 0.35 * i) / DT);
      const s: Shot = {
        id: ++this.hazardSeq, kind: 'meteor', skin: 0, phase: 'warn', x: a.wx + dir * 3.2, y: a.wy + 7.2, hitX: a.wx, hitY: a.wy,
        vx: -dir * 3.2 / flight, vy: -7.2 / flight, dir, appearStep: hitStep - Math.round(flight / DT), hitStep, outStep: 0,
        target: p.id, lx: a.lx, ly: a.ly, impulse: this.tuning.meteorImpulse * k,
      };
      this.shots.push(s);
      list.push({ id: s.id, eta: HAZARD_WARNING + 0.35 * i, at: { x: s.hitX, y: s.hitY }, from: { x: s.x, y: s.y } });
    }
    this.bus.emit('hazard_warning', { type: 'meteor', dir, eta: HAZARD_WARNING, count: n, shots: list, first, intro });
    return true;
  }

  /** The hit: one push at the spot, then junk tumbles away and a meteor bursts. A miss sails on. */
  private shotHits(s: Shot, onTarget: boolean): void {
    if (!onTarget || s.target === null) {
      s.phase = 'out'; s.target = -1; s.outStep = this.stepIndex + Math.round(1.2 / DT);
      this.bus.emit('hazard_end', { type: s.kind, id: s.id, missed: true });
      return;
    }
    // Both crack the mortar round the piece they hit (it bonds again once it rests). Junk comes in
    // level and shoves; a meteor comes down at 45° and knocks.
    const [ux, uy] = s.kind === 'junk' ? [-s.dir, -0.15] : [-s.dir * 0.7, -0.7];
    const hit = this.pieces.get(s.target);
    if (hit) this.crack(hit, s.kind);
    this.engine.applyImpulse(s.target, ux * s.impulse, uy * s.impulse, s.hitX, s.hitY);
    this.live.hits++;
    this.tensionSpike = Math.max(this.tensionSpike, 0.5);
    this.bus.emit('hazard_hit', { type: s.kind, id: s.id, x: s.hitX, y: s.hitY, pieceId: s.target, impulse: s.impulse, dir: -s.dir });
    s.phase = 'out';
    if (s.kind === 'junk') { s.vx = -0.35 * s.vx; s.vy = 2.5; s.outStep = this.stepIndex + Math.round(0.9 / DT); }
    else { s.vx = 0; s.vy = 0; s.outStep = this.stepIndex; }
  }

  /** A hazard breaks every bond of piece p. It bonds again once it has rested a second. */
  private crack(p: Piece, by: 'junk' | 'meteor' | 'dust'): void {
    for (const [, jid] of [...p.bonds]) {
      const w = this.welds.get(jid);
      this.removeWeld(jid);
      if (w) this.bus.emit('bond_broken', { pos: { x: w.x, y: w.y }, force: 0, by });
    }
    p.bondCheckAt = this.time + 1;
  }

  /** Dust devils (Red Planet): warned at the side they come from, then they cross the tower's top. */
  private updateDevil(): void {
    const spec = this.tuning.lateHazards && this.state === 'playing' ? this.stretch.dust : null;
    let d = this.devil;
    if (!spec) {
      if (d) { this.bus.emit('hazard_end', { type: 'dust', id: d.id, cancelled: d.phase === 'warn' }); this.devil = null; }
      this.devilNext = -1;
      return;
    }
    const calm = this.calm;
    if (this.devilNext < 0) this.devilNext = this.time + 4 + this.rng.late.int(21) / 10;
    const top = this.height().provisional;
    if (!d) {
      if (calm || this.time < this.devilNext) return;
      const f = this.foundation, dir: -1 | 1 = this.rng.late.int(2) ? 1 : -1, half = f.width / 2 + 3;
      const { first, intro } = this.meet('dust');
      this.devilCracked.clear();
      const start = this.stepIndex + Math.round(HAZARD_WARNING / DT);
      d = this.devil = {
        id: ++this.hazardSeq, dir, strength: spec.strength * this.tuning.hazardStrength * this.zenEase * (intro ? 0.5 : 1), phase: 'warn',
        startStep: start, endStep: start + Math.round(2 * half / DEVIL_SPEED / DT), x0: f.x - dir * half, x: f.x - dir * half, y: top - 4,
      };
      this.bus.emit('hazard_warning', { type: 'dust', id: d.id, dir, eta: HAZARD_WARNING, strength: d.strength, x: d.x, y: top - 1, first, intro });
      return;
    }
    d.y = top - 4;
    if (d.phase === 'warn') {
      if (calm) {
        this.bus.emit('hazard_end', { type: 'dust', id: d.id, cancelled: true });
        this.devil = null;
        this.devilNext = this.time;
      } else if (this.stepIndex >= d.startStep) {
        d.phase = 'blow';
        this.bus.emit('hazard_start', { type: 'dust', id: d.id, dir: d.dir, strength: d.strength, duration: (d.endStep - d.startStep) * DT });
      }
      return;
    }
    d.x = d.x0 + d.dir * DEVIL_SPEED * (this.stepIndex - d.startStep) * DT;
    if (this.stepIndex >= d.endStep) {
      this.bus.emit('hazard_end', { type: 'dust', id: d.id });
      this.devil = null;
      // The interval runs start to start, like gusts.
      const dur = (d.endStep - d.startStep) * DT;
      this.devilNext = Math.max(this.time, this.time - dur + spec.interval * (85 + this.rng.late.int(31)) / 100 - HAZARD_WARNING);
    }
  }

  /** Deep Cosmos's extra punch for junk and meteors (strengths and intervals are in hazardsFor). */
  private cosmos(): number { return this.checkpoint >= 23 ? Math.max(1, Math.min(2, 1 + 0.05 * (this.checkpoint - 22))) : 1; }
  /** Zen is the gentle way up (Blake, 2026-10-22): every hazard pushes and hits at half strength, as
   * gustScale and hazardStrength 0.5 would make it outside Zen. */
  private get zenEase(): number { return this.tuning.zen ? 0.5 : 1; }

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
    const fall = fallSpeedFor(t, this.checkpoint) * (t.lateHazards ? this.stretch.fallMult : 1) * (this.slowLeft > 0 ? t.slowFactor : 1);
    // While a checkpoint is being held, and while the new slab drops in, the shape in hand hovers
    // so the player can react to the claim. Soft and hard drops still bring it down.
    // A dropped shape stops waiting for good, so letting go of a soft drop doesn't park it again.
    if (c.hard || c.soft) c.waitUntil = -Infinity;
    const hover = !c.hard && !c.soft && (this.hovering || this.time < c.waitUntil);
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
    p.brittle = c.brittle;
    this.ctrl = null;
    this.used++;
    this.live.placed++;
    this.lastPlaced = p.id;
    this.nextSpawnAt = this.time + t.spawnDelay;
    this.bus.emit('piece_landed', {
      id: p.id, shape: c.shape, impact: Math.min(1, speed / 12), x: c.x,
      pose: { x: c.x, y, rot: c.rot }, touchedIds: touched, knocked, glue: p.glue, brittle: p.brittle,
    });
    this.budgetCheck();
    this.afterPlacement();
  }

  /** The low-shape warnings (gameplay.md §7.2), after a shape lands or misses the tower. */
  private budgetCheck(): void {
    const left = this.budget - this.used;
    if (!this.tuning.infiniteBudget && (left === 5 || left === 3 || left === 1)) this.bus.emit('budget_low', { left });
  }

  private missed(c: Controlled): void {
    const p = this.createPiece(c.shape, c.x, c.y, rotQ(c.rot), 0, -c.speed, false, c.rot);
    p.brittle = c.brittle;
    this.ctrl = null;
    this.used++;
    this.live.placed++;
    this.lastPlaced = null;
    this.nextSpawnAt = this.time + this.tuning.spawnDelay;
    this.markLost(p);
    this.budgetCheck();
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
    const swapIn = this.held !== null ? { shape: this.held, brittle: this.heldBrittle } : this.takeNext();
    this.held = c.shape;
    this.heldBrittle = c.brittle;
    this.ctrl = null;
    this.spawn(swapIn.shape, undefined, 0, swapIn.brittle);
    this.holdUsed = true;
    this.bus.emit('hold_swap', { shape: this.held, brittle: this.heldBrittle });
  }

  private spawn(shape: string, x: number | undefined, rot: number, brittle = false, wait = true): void {
    const f = this.foundation;
    const e = extents(shape, rot);
    const w = e.maxX - e.minX;
    const left = f.x - f.width / 2;
    const sx = x ?? snap(left + Math.round((f.width - w) / 2) - e.minX, this.tuning.snapStep);
    const top = Math.max(this.height().provisional, f.top);
    const sy = top + this.tuning.spawnHeight - e.minY;
    const waitUntil = wait ? this.time + startWaitFor(this.tuning, this.checkpoint) : -Infinity;
    this.ctrl = { shape, x: sx, y: sy, rot, xTarget: sx, soft: false, hard: false, speed: 0, brittle, steerAt: -Infinity, touchedAt: null, waitUntil };
    this.ctrl.xTarget = this.clampX(this.ctrl, sx);
    this.ctrl.x = this.ctrl.xTarget;
    this.holdUsed = false;
    this.bus.emit('piece_spawned', { shape, next: this.queue.slice(0, 2), brittle, nextBrittle: this.nextBrittle(), wait: Math.max(0, waitUntil - this.time) });
    if (this.tuning.powerUps && !this.bubble && this.bubbleIn <= 0 && this.slots.includes(null)) this.makeBubble(top);
  }

  private takeNext(): { shape: string; brittle: boolean } {
    if (this.queue.length < 3) this.refillQueue();
    const shape = this.queue.shift()!;
    const brittle = this.queueBrittle.shift() ?? false;
    if (this.queue.length < 3) this.refillQueue();
    this.dealPreview();
    return { shape, brittle };
  }

  /**
   * Brittle shapes (§4.3) are dealt as a shape first shows in the preview, so the preview never
   * changes its mind. From brittleFrom, with Hold open: about one shape in brittleEvery, never two
   * within half that, never the bag's rescue shapes, and never while another is in play.
   */
  private dealPreview(): void {
    for (let i = 0; i < 2 && i < this.queue.length; i++) {
      if (this.queueBrittle[i] === undefined) this.queueBrittle[i] = this.dealBrittle(this.queue[i]);
    }
  }

  private dealBrittle(shape: string): boolean {
    const t = this.tuning;
    if (t.brittleEvery <= 0 || this.checkpoint < t.brittleFrom || !t.holdUnlocked) return false;
    const gap = Math.floor(t.brittleEvery / 2);
    if (++this.sinceBrittle <= gap || RESCUE.has(shape) || this.brittleInPlay()) return false;
    if (this.rng.brittle.int(Math.max(1, t.brittleEvery - gap)) !== 0) return false;
    this.sinceBrittle = 0;
    this.live.brittle++;
    return true;
  }

  /** A brittle shape in hand, in Hold, in the preview, or loose in the tower. */
  private brittleInPlay(): boolean {
    if (this.ctrl?.brittle || (this.held !== null && this.heldBrittle) || this.queueBrittle.some(b => b)) return true;
    for (const p of this.pieces.values()) if (p.brittle && p.state !== 'lost' && p.state !== 'stone') return true;
    return false;
  }

  private refillQueue(): void {
    while (this.opening.length && this.queue.length < 12) this.queue.push(this.opening.shift()!);
    if (this.queue.length >= 3) return;
    this.queue.push(...this.makeBag());
  }

  private makeBag(): string[] {
    const n = this.checkpoint;
    // The Daily Tower's shape set (§12.3): only these shapes, evenly, all the way up.
    const set = this.tuning.shapeSet.filter(k => k in SHAPES);
    const weights: [string, number][] = set.length ? set.map(k => [k, 2] as [string, number]) : [['O', 2], ['I', 2], ['L', 2], ['J', 2], ['T', 2]];
    if (!set.length) {
      if (n >= 2) { const w = n >= 5 ? 1.5 : 1; weights.push(['S', w], ['Z', w]); }
      if (n >= 5) weights.push(['Domino', 1], ['Plank', 1]);
      // Bigger and odder shapes from the Storm Belt and the Red Planet, low at first (gameplay.md §4.1).
      if (n >= 7) { const w = n >= 9 ? 1 : 0.5; weights.push(['P', w], ['U', w], ['V', w]); }
      if (n >= 17) { const w = n >= 19 ? 1 : 0.5; weights.push(['Arch', w], ['Plus', w]); }
    }
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
    // Every bag has a flat shape to fix a ragged top with; a shape set brings its own (its first rescue shape).
    const rescue = set.length ? set.find(k => RESCUE.has(k)) : 'O';
    if (rescue && !bag.some(k => RESCUE.has(k))) bag[this.rng.bag.int(BAG_SIZE)] = rescue;
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
      bonds: new Map(), bullet: false, bondCheckAt: 0, lostTime: 0, glue: false, points: 0,
      brittle: false, load: 0, strain: 0, fuse: 0, top: y, bottom: y, cx: x, cy: y,
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
    for (const [, jid] of [...p.bonds]) this.removeWeld(jid);
    p.state = 'lost';
    p.lostTime = this.time;
    this.engine.setLost(p.id);
    // A brittle shape costs nothing to lose (§4.3): no heart, its brick back, the streak kept.
    const free = p.brittle && !p.claimed;
    this.bus.emit('piece_lost', { id: p.id, shape: p.shape, brittle: free });
    if (free) {
      this.used = Math.max(0, this.used - 1);
      this.outOfBricksAt = null;
      this.bus.emit('brittle_tossed', { id: p.id, shape: p.shape });
      return;
    }
    this.live.lost++;
    this.combo = 0;
    this.tensionSpike = 1;
    if (!p.claimed) { this.pendingLost.push(p); this.setStreak(0); }
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
    if (!lostNow || t.zen) return; // Zen has no hearts: a lost piece is only lost
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
    if (p.brittle) this.mend(p);
  }

  // ------------------------------------------------------------------ brittle shapes (§4.3)

  /** Turned to stone, a brittle shape is safe for good, and pays a bonus. */
  private mend(p: Piece): void {
    p.brittle = false;
    p.strain = 0;
    p.load = 0;
    const points = 300 * this.biomeMult();
    this.addScore(points);
    this.live.mended++;
    this.bus.emit('brittle_mended', { id: p.id, shape: p.shape, points, x: p.cx, y: p.cy });
  }

  /**
   * What rests on each brittle shape, and its cracks: stage 1 from a third of brittleLoad, 2 from
   * two thirds, 3 at the full load. At 3 it creaks for brittleFuse seconds and breaks. A checkpoint
   * hold and the claim pause stop the clock, and the claim turns it to stone.
   */
  private updateBrittle(): void {
    const t = this.tuning;
    for (const p of [...this.pieces.values()]) {
      if (!p.brittle || p.claimed || p.state === 'lost' || p.state === 'stone') continue;
      if (this.stepIndex % 6 === 0) p.load = this.loadOn(p).cells;
      const cap = Math.max(1, t.brittleLoad);
      const stage = Math.min(3, Math.floor(3 * p.load / cap));
      if (stage !== p.strain) {
        p.strain = stage;
        p.fuse = 0;
        this.bus.emit('brittle_strain', { id: p.id, stage, load: p.load, cap, fuse: stage === 3 ? t.brittleFuse : 0, x: p.cx, y: p.cy });
      }
      if (stage < 3 || this.calm) continue;
      p.fuse += DT;
      if (p.fuse >= t.brittleFuse) this.crumble(p);
    }
  }

  /** Cells of the loose pieces resting on p, straight on it or through others. Stone carries itself. */
  private loadOn(p: Piece): { cells: number; ids: number[] } {
    const seen = new Set<number>([p.id]);
    const stack = [p], ids: number[] = [];
    let cells = 0;
    while (stack.length) {
      const q = stack.pop()!;
      for (const c of this.engine.contacts(q.id)) {
        if (seen.has(c.other)) continue;
        const o = this.pieces.get(c.other);
        // Resting on q: it starts at least half a block higher (not a neighbour leaning on its side).
        if (!o || o.state === 'lost' || o.state === 'stone' || o.bottom < q.bottom + 0.5) continue;
        seen.add(o.id);
        ids.push(o.id);
        cells += SHAPES[o.shape].cells.length;
        stack.push(o);
      }
    }
    return { cells, ids };
  }

  /** The brittle shape gives way: it crumbles to dust and what it held drops. */
  private crumble(p: Piece): void {
    const above = this.loadOn(p).ids;
    const tr = this.engine.transform(p.id);
    const cells = geometry(p.shape).cells.map(([cx, cy]) => { const [rx, ry] = rotate(tr, cx, cy); return { x: tr.x + rx, y: tr.y + ry }; });
    this.bus.emit('brittle_broke', { id: p.id, shape: p.shape, x: p.cx, y: p.cy, load: p.load, cells, above });
    this.removePiece(p);
    // Wake what it held, so it drops into the gap at once.
    for (const id of above) this.engine.applyImpulse(id, 0, -0.01 * this.engine.mass(id), this.pieces.get(id)!.cx, this.pieces.get(id)!.cy);
    this.live.crumbled++;
    this.tensionSpike = 1;
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
    if (grade === 'perfect') { this.combo++; this.live.perfects++; } else this.combo = 0;
    if (grade === 'clean') this.live.cleans++;
    if (grade === 'messy') this.live.messies++;
    if (clutch) { pts = 200; this.live.clutches++; this.tensionSpike = Math.max(this.tensionSpike, 0.8); }
    else pts = grade === 'perfect' ? 150 * Math.min(1 + 0.5 * (this.combo - 1), 4) : grade === 'clean' ? 50 : 10;
    p.points = pts * mult;
    this.addScore(p.points);
    this.bus.emit('piece_settled', { id: p.id, shape: p.shape, grade, support, clutch });
    if (grade === 'perfect') this.bus.emit('perfect', { combo: this.combo });
    if (clutch) this.bus.emit('clutch', {});
    this.setStreak(grade === 'messy' ? 0 : this.streak + 1);
    this.checkRows(p);
  }

  /** Good placements in a row it takes, here, before full rows turn to stone (0: at once). */
  get setNeed(): number { return setStreakFor(this.tuning, this.checkpoint); }

  private setStreak(n: number): void {
    if (n === this.streak) return;
    this.streak = n;
    this.bus.emit('set_streak', { count: n, need: this.setNeed });
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

  /**
   * Solid Rows (§9.1). In the Meadow, or with `force` (Quick-Set), a full row the piece touches turns
   * to stone with everything under it. From CP 3 a full row waits until the set streak is reached:
   * then every full row from the last stone one up to this piece sets at once, and the streak starts
   * again. Until then the rows are only ready (`row_ready`).
   */
  private checkRows(p: Piece, force = false): void {
    const f = this.foundation;
    const k0 = Math.max(this.solidTo, Math.floor(p.bottom - f.top + 1e-3));
    const k1 = Math.floor(p.top - f.top - 1e-3);
    const need = force ? 0 : this.setNeed;
    let newRows = 0;
    const rows: number[] = [];
    if (need === 0) {
      for (let k = k0; k <= k1; k++) {
        if (this.rowSolid(k)) { newRows++; rows.push(f.top + k + 0.5); this.solidify(f.top + k + 1); this.solidTo = k + 1; }
      }
    } else {
      // Once the streak is reached, every full row counts, up to the tower top.
      const charged = this.streak >= need;
      const hi = charged ? Math.max(k1, Math.floor(this.height().committed - f.top - 1e-3)) : k1;
      const full: number[] = [];
      for (let k = charged ? this.solidTo : k0; k <= hi; k++) if (this.rowSolid(k)) full.push(k);
      if (!full.length) return;
      if (!charged) {
        this.bus.emit('row_ready', { rows: full.map(k => f.top + k + 0.5), streak: this.streak, need, x: f.x, width: f.width });
        return;
      }
      const top = full[full.length - 1];
      this.solidify(f.top + top + 1);
      this.solidTo = top + 1;
      newRows = full.length;
      for (const k of full) rows.push(f.top + k + 0.5);
      this.setStreak(0);
    }
    if (!newRows) return;
    this.live.rows += newRows;
    const pts = [0, 500, 1200, 2000, 3000][Math.min(newRows, 4)];
    this.addScore(pts * this.biomeMult());
    this.bus.emit('row_solid', { count: newRows, rows, x: f.x, width: f.width, streak: need > 0 });
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
    // Zen always gets the widest slab: the grade still shows, but a needle costs nothing there.
    const width = t.widestSlabs ? maxSlabWidthFor(n + 1) : Math.max(minSlabWidthFor(t, n), Math.min(maxSlabWidthFor(n + 1), Math.round(coverage) + 1));
    // Keep slab edges on the half-block grid: even widths centre on whole blocks, odd on half blocks.
    const cx = width % 2 === 0 ? Math.round(centre) : Math.round(centre - 0.5) + 0.5;
    const slab = this.addFoundation(cx, width, towerTop + 0.01 + t.slabThickness, t.slabThickness);
    slab.grade = grade;
    this.live.grades.push(grade);
    this.live.checkpoints++;

    const leftover = t.infiniteBudget ? 0 : Math.max(0, this.budget - this.used);
    const gradeBonus = { S: 1500, A: 1000, B: 500, C: 0 }[grade];
    this.addScore((1000 * n + 100 * leftover + gradeBonus) * this.biomeMult());

    const biome = biomeFor(n);
    const before = this.hearts;
    const from = t.heartsEveryFrom;
    // Up to the Moon every claim gives a heart back and a biome's last one refills them. From the
    // Red Planet on (heartsEveryFrom 17), a heart comes back every third claim (19, 22, 25, ...).
    if (from > 0 && n >= from) { if ((n - from + 1) % 3 === 0) this.hearts = Math.min(t.hearts, this.hearts + 1); }
    else this.hearts = n === biome.lastCp ? t.hearts : Math.min(t.hearts, this.hearts + 1);
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
    this.endWeather(); // the next stretch is planned at the start of the next step
    const nb = biomeFor(this.checkpoint);
    if (nb.id !== biome.id) {
      this.live.biomes++;
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
    if (t.infiniteBudget || this.used < this.budget) { const n = this.takeNext(); this.spawn(n.shape, undefined, 0, n.brittle); return; }
    // Out of bricks: a grace period while things settle (gameplay.md §7.2).
    if (this.outOfBricksAt === null) { this.outOfBricksAt = this.time; this.bus.emit('bricks_out', { grace: t.budgetGrace }); }
    if (this.time - this.outOfBricksAt >= t.budgetGrace) this.endRun('bricks');
  }

  /** Ends the run from the pause menu (XP × 0.5). Logged like an intent, so replays end there too. */
  quit(): void { this.intent({ type: 'quit' }); }

  private endRun(cause: string): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.cause = cause;
    this.ctrl = null;
    this.banked = { ...this.live, grades: [...this.live.grades] };
    this.overAt = this.time;
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
    this.live.powers++;
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
    for (const p of set) this.checkRows(p, true);
    return { ids: set.map(p => p.id) };
  }

  /** Undo: the last shape placed comes back to the player's hand, with its brick and points. */
  private undo(): { id: number; shape: string; x: number; y: number } | null {
    const p = this.lastPlaced === null ? undefined : this.pieces.get(this.lastPlaced);
    if (!p || p.claimed || p.state === 'stone' || p.state === 'lost') return null;
    const out = { id: p.id, shape: p.shape, x: p.cx, y: p.cy };
    this.removePiece(p);
    this.used = Math.max(0, this.used - 1);
    this.live.placed = Math.max(0, this.live.placed - 1);
    this.score -= p.points;
    this.outOfBricksAt = null;
    // The shape already falling goes back to the front of the queue.
    if (this.ctrl) { this.queue.unshift(this.ctrl.shape); this.queueBrittle.unshift(this.ctrl.brittle); this.ctrl = null; }
    this.spawn(p.shape, undefined, 0, p.brittle);
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
    this.live.secondWind = true;
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
      tilt: this.tilt,
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

  private addScore(pts: number): void { if (!this.banked) this.score += pts; } // banked at run over, like stats
}

function snap(x: number, step: number): number { return Math.round(x / step) * step; }
function snapUp(x: number, step: number): number { return Math.ceil(x / step - 1e-9) * step; }
function snapDown(x: number, step: number): number { return Math.floor(x / step + 1e-9) * step; }

/** A sine-like swing with period 1, peaking at ±1, made of two parabolas (no trig in the sim). */
export function swing(u: number): number {
  const p = u - Math.floor(u), h = p < 0.5 ? p : p - 0.5, v = 16 * h * (0.5 - h);
  return p < 0.5 ? v : -v;
}

function nearestQuarter(c: number, s: number): number {
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 0 : 2;
  return s >= 0 ? 1 : 3;
}

export { SHAPES };
