// QA's headless contract (agreed with the QA thread). Pure TypeScript, no Phaser.
// Units: blocks, y up, rot in quarter turns. Angles reported here are radians, for tests only.

import { Sim, type Ghost, type Intent, type PieceState, type SimOptions } from './sim.ts';
import type { Tuning } from './tuning.ts';

export interface CreateSimOptions {
  engine?: 'box2d' | 'rapier';
  seed?: number;
  tuning?: Partial<Tuning>;
  /** Defaults to false for tests: nothing spawns unless you ask. */
  autoSpawn?: boolean;
  rookieOpening?: boolean;
}

export interface TestPiece { id: number; shape: string; state: PieceState; x: number; y: number; angle: number; vx: number; vy: number; w: number; bonds: number }

export interface TestSim {
  readonly sim: Sim;
  readonly stepIndex: number;
  readonly hearts: number;
  readonly budget: { total: number; used: number; left: number };
  readonly checkpoint: { n: number; lineY: number; hold: { active: boolean; progress: number } };
  step(n?: number): void;
  placePiece(p: { shape: string; x: number; y: number; rot?: number; as?: 'dynamic' | 'stone' }): number;
  spawnControlled(p?: { shape?: string; x?: number; rot?: number }): void;
  intent(i: Intent): void;
  ghost(): Ghost | null;
  pieces(): TestPiece[];
  drainEvents(): { name: string; step: number; payload: Record<string, unknown> }[];
  height(): { committed: number; provisional: number };
  hash(): string;
  digest(): string;
  dispose(): void;
}

export function createSim(opts: CreateSimOptions = {}): TestSim {
  const simOpts: SimOptions = {
    engine: opts.engine ?? 'box2d',
    seed: opts.seed ?? 1,
    tuning: opts.tuning,
    autoSpawn: opts.autoSpawn ?? false,
    rookieOpening: opts.rookieOpening ?? false,
  };
  const sim = new Sim(simOpts);
  return {
    sim,
    get stepIndex() { return sim.stepIndex; },
    get hearts() { return sim.hearts; },
    get budget() { return { total: sim.budget, used: sim.used, left: sim.budget - sim.used }; },
    get checkpoint() { return { n: sim.checkpoint, lineY: sim.lineY, hold: sim.holdState() }; },
    step: (n = 1) => sim.step(n),
    placePiece: p => sim.placePiece(p),
    spawnControlled: p => sim.spawnControlled(p),
    intent: i => sim.intent(i),
    ghost: () => sim.ghost(),
    pieces: () => sim.pieceViews().map(v => ({ id: v.id, shape: v.shape, state: v.state, x: v.x, y: v.y, angle: Math.atan2(v.s, v.c), vx: v.vx, vy: v.vy, w: v.w, bonds: v.bonds })),
    drainEvents: () => sim.drainEvents(),
    height: () => sim.height(),
    hash: () => sim.hash(),
    digest: () => sim.digest(),
    dispose: () => sim.dispose(),
  };
}

export interface ReplayInput { seed: number; tuning?: Partial<Tuning>; rookieOpening?: boolean; inputs: { s: number; i: Intent }[]; steps: number }

/**
 * Replays a recorded run (auto spawn on, as in the game) and returns the digest every 60 steps,
 * for comparing with the digests in a run record.
 */
export function replay(rec: ReplayInput): { digests: string[]; sim: Sim } {
  const sim = new Sim({ seed: rec.seed, tuning: rec.tuning, autoSpawn: true, rookieOpening: rec.rookieOpening ?? false });
  const digests: string[] = [];
  let k = 0;
  while (sim.stepIndex < rec.steps) {
    while (k < rec.inputs.length && rec.inputs[k].s === sim.stepIndex) sim.intent(rec.inputs[k++].i);
    sim.step();
    if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  }
  return { digests, sim };
}

export { Sim };
