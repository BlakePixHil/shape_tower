// Wraps the game's test API (game/src/sim/testApi.ts) in QA's Sim contract.
//
// The game's API is close to the contract, with four differences this adapter absorbs:
// - The controlled shape isn't a physics body and has no id until it lands, so spawnControlled
//   returns a token id (negative), pieces() reports the shape under that token, and the
//   piece_landed or piece_lost it causes carries the token as `id` and the new body's id as `pieceId`.
// - Events come as { name, step, payload }; here they are { type, step, ...payload }.
// - ghost() returns y: null for "will miss"; here that is ghost() === null.
// - There is no snapshot or restore yet, so restore rebuilds the sim and replays every call made
//   before the snapshot. That is exact only if the sim is deterministic, which F3.6 checks.
import type { CreateSim, CreateSimOptions, Ghost, Intent, PieceState, PlacePieceOptions, Sim, SimEvent } from '../contract';

interface GameGhost {
  x: number;
  y: number | null;
  rot: number;
  contacts: { x: number; y: number }[];
  supportIds: number[];
  tint: Ghost['tint'];
}

interface GameCtrl {
  shape: string;
  x: number;
  y: number;
  rot: number;
  speed: number;
}

interface GameTestSim {
  readonly sim: { ctrl?: GameCtrl | null; pieceViews?(): { id: number }[] };
  readonly stepIndex: number;
  readonly hearts: number;
  readonly budget: unknown;
  readonly checkpoint: unknown;
  step(n?: number): void;
  placePiece(p: { shape: string; x: number; y: number; rot?: number; as?: 'dynamic' | 'stone' }): number;
  spawnControlled(p?: { shape?: string; x?: number; rot?: number }): void;
  intent(i: Intent): void;
  ghost(): GameGhost | null;
  pieces(): PieceState[];
  drainEvents(): { name: string; step: number; payload: Record<string, unknown> }[];
  height(): { committed: number; provisional: number };
  hash(): string;
  dispose(): void;
}

export type GameCreateSim = (o: { engine?: 'box2d' | 'rapier'; seed?: number; tuning?: Record<string, unknown>; autoSpawn?: boolean; rookieOpening?: boolean }) => GameTestSim;

type Op =
  | { k: 'place'; p: PlacePieceOptions }
  | { k: 'step'; n: number }
  | { k: 'spawn'; p: { shape: string; x: number; rot: number } }
  | { k: 'intent'; i: Intent };

class GameSim implements Sim {
  private t!: GameTestSim;
  private ops: Op[] = [];
  private queue: SimEvent[] = [];
  private token = 0;
  private ctrlToken: number | null = null;
  private replaying = false;

  constructor(
    private readonly create: GameCreateSim,
    private readonly options: CreateSimOptions,
  ) {
    this.fresh();
  }

  private fresh() {
    const engine = this.options.engine === 'reference' ? undefined : this.options.engine;
    this.t = this.create({ engine, seed: this.options.seed, tuning: this.options.tuning, autoSpawn: false, rookieOpening: false });
    this.queue = [];
    this.ctrlToken = null;
  }

  private log(op: Op) {
    if (this.replaying) return;
    const last = this.ops[this.ops.length - 1];
    if (op.k === 'step' && last?.k === 'step') last.n += op.n;
    else this.ops.push(op);
  }

  private ctrl(): GameCtrl | null {
    return this.t.sim.ctrl ?? null;
  }

  get stepIndex(): number {
    return this.t.stepIndex;
  }

  get hearts(): number {
    return this.t.hearts;
  }

  get budget(): number {
    return (this.t.budget as { left: number }).left;
  }

  get checkpoint(): unknown {
    return this.t.checkpoint;
  }

  step(n = 1): void {
    this.log({ k: 'step', n });
    for (let i = 0; i < n; i++) {
      const had = this.ctrl();
      // Ids only: pieceViews skips the angle that pieces() works out with Math.atan2, so the
      // harness adds no platform-dependent maths to a step (F3.6 counts those).
      const before = had ? new Set((this.t.sim.pieceViews?.() ?? this.t.pieces()).map((p) => p.id)) : null;
      this.t.step();
      const events = this.t.drainEvents().map((e) => ({ type: e.name, step: e.step, ...e.payload }) as SimEvent);
      if (had && this.ctrlToken !== null && this.ctrl() !== had) {
        // The controlled shape landed or was lost this step: tag its event with the token.
        const ev =
          events.find((e) => e.type === 'piece_landed') ??
          events.find((e) => e.type === 'piece_lost' && !before!.has(e.id as number));
        if (ev) {
          ev.pieceId = ev.id;
          ev.id = this.ctrlToken;
          if (ev.type === 'piece_landed' && ev.knocked) ev.via = 'knock';
        }
        this.ctrlToken = null;
      }
      this.queue.push(...events);
    }
  }

  placePiece(p: PlacePieceOptions): number {
    this.log({ k: 'place', p });
    return this.t.placePiece(p);
  }

  spawnControlled(p: { shape: string; x: number; rot: number }): number {
    this.log({ k: 'spawn', p });
    this.t.spawnControlled(p);
    // Spawning emits piece_spawned straight away; keep it in order with step events.
    this.queue.push(...this.t.drainEvents().map((e) => ({ type: e.name, step: e.step, ...e.payload }) as SimEvent));
    if (!this.ctrl()) throw new Error(`spawnControlled(${JSON.stringify(p)}) made no controlled shape`);
    this.ctrlToken = --this.token;
    return this.ctrlToken;
  }

  intent(i: Intent): void {
    this.log({ k: 'intent', i });
    this.t.intent(i);
  }

  ghost(): Ghost | null {
    const g = this.t.ghost();
    if (!g || g.y === null) return null;
    return { x: g.x, y: g.y, rot: g.rot, contacts: g.contacts, supportIds: g.supportIds, tint: g.tint };
  }

  pieces(): PieceState[] {
    const out = this.t.pieces().map((p) => ({ id: p.id, shape: p.shape, state: p.state, x: p.x, y: p.y, angle: p.angle, vx: p.vx, vy: p.vy, w: p.w }));
    const c = this.ctrl();
    if (c && this.ctrlToken !== null) {
      out.push({ id: this.ctrlToken, shape: c.shape, state: 'controlled', x: c.x, y: c.y, angle: (c.rot * Math.PI) / 2, vx: 0, vy: -c.speed, w: 0 });
    }
    return out;
  }

  drainEvents(): SimEvent[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  height() {
    return this.t.height();
  }

  hash(): string {
    return this.t.hash();
  }

  snapshot(): unknown {
    return { ops: this.ops.map((o) => ({ ...o })), token: this.token, ctrlToken: this.ctrlToken };
  }

  restore(snapshot: unknown): void {
    const s = snapshot as { ops: Op[]; token: number; ctrlToken: number | null };
    this.t.dispose();
    this.fresh();
    this.replaying = true;
    for (const op of s.ops) {
      if (op.k === 'place') this.t.placePiece(op.p);
      else if (op.k === 'step') this.t.step(op.n);
      else if (op.k === 'spawn') this.t.spawnControlled(op.p);
      else this.t.intent(op.i);
    }
    this.replaying = false;
    this.t.drainEvents();
    this.ops = s.ops.map((o) => ({ ...o }));
    this.token = s.token;
    this.ctrlToken = s.ctrlToken;
  }

  dispose(): void {
    this.t.dispose();
  }
}

export function wrapGameSim(create: GameCreateSim): CreateSim {
  return (options) => new GameSim(create, options);
}
