// QA's headless contract (agreed with the QA thread). Pure TypeScript, no Phaser.
// Units: blocks, y up, rot in quarter turns. Angles reported here are radians, for tests only.

import { RapierEngine, initRapier } from './engine/rapier.ts';
import { Sim, registerEngine, type Ghost, type Intent, type LoggedInput, type PieceState, type SecondWindMode, type SimOptions } from './sim.ts';
import type { Tuning } from './tuning.ts';

// Held in a variable so bundlers (Sound's IIFE sim check, Vite) leave the 3.4 MB of WASM out.
const RAPIER_PACKAGE = '@dimforge/rapier2d-deterministic-compat';

/**
 * Loads Rapier and registers it, so createSim({ engine: 'rapier' }) works: the bake-off's contender
 * (gameplay.md §15, QA_ENGINE=rapier). Safe to call more than once.
 */
export async function useRapier(): Promise<void> {
  await initRapier(() => import(/* @vite-ignore */ RAPIER_PACKAGE));
  registerEngine('rapier', s => new RapierEngine(s));
}

/** SIM_ENGINE=rapier runs a whole suite on Rapier (npm run sim:smoke, for the bake-off); call useRapier() first. */
const DEFAULT_ENGINE: 'box2d' | 'rapier' = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM_ENGINE === 'rapier' ? 'rapier' : 'box2d';

export interface CreateSimOptions {
  engine?: 'box2d' | 'rapier';
  seed?: number;
  tuning?: Partial<Tuning>;
  /** Defaults to false for tests: nothing spawns unless you ask. */
  autoSpawn?: boolean;
  rookieOpening?: boolean;
  secondWind?: SecondWindMode;
  /** Start at this checkpoint (its gravity, hazards and shapes), for late-biome tests. */
  startCheckpoint?: number;
}

export interface TestPiece { id: number; shape: string; state: PieceState; x: number; y: number; angle: number; vx: number; vy: number; w: number; bonds: number }

export interface TestSim {
  readonly sim: Sim;
  readonly stepIndex: number;
  readonly hearts: number;
  readonly budget: { total: number; used: number; left: number };
  readonly checkpoint: { n: number; lineY: number; hold: { active: boolean; progress: number } };
  step(n?: number): void;
  placePiece(p: { shape: string; x: number; y: number; rot?: number; as?: 'dynamic' | 'stone'; brittle?: boolean }): number;
  spawnControlled(p?: { shape?: string; x?: number; rot?: number; brittle?: boolean; wait?: boolean }): void;
  intent(i: Intent): void;
  ghost(): Ghost | null;
  pieces(): TestPiece[];
  drainEvents(): { name: string; step: number; payload: Record<string, unknown> }[];
  height(): { committed: number; provisional: number };
  hash(): string;
  digest(): string;
  /** The steered shape, or null. */
  controlled(): { shape: string; x: number; y: number; rot: number; xTarget: number; soft: boolean; hard: boolean } | null;
  retune(patch: Partial<Tuning>): void;
  /** Everything needed to rebuild this exact state: the options plus every call made so far. */
  snapshot(): TestSnapshot;
  dispose(): void;
}

type Op =
  | { op: 'step'; n: number }
  | { op: 'place'; p: Parameters<TestSim['placePiece']>[0] }
  | { op: 'spawn'; p?: Parameters<TestSim['spawnControlled']>[0] }
  | { op: 'intent'; i: Intent }
  | { op: 'retune'; patch: Partial<Tuning> };

export interface TestSnapshot { opts: CreateSimOptions; ops: Op[]; stepIndex: number }

/**
 * Rebuilds a snapshot in a fresh sim by replaying its calls (Box2D can't serialise a world, and
 * fresh worlds replay exactly). Costs as many steps as the snapshot had.
 */
export function restore(snap: TestSnapshot): TestSim {
  const t = createSim(snap.opts);
  for (const o of snap.ops) {
    if (o.op === 'step') t.step(o.n);
    else if (o.op === 'place') t.placePiece(o.p);
    else if (o.op === 'spawn') t.spawnControlled(o.p);
    else if (o.op === 'intent') t.intent(o.i);
    else t.retune(o.patch);
  }
  return t;
}

export function createSim(opts: CreateSimOptions = {}): TestSim {
  const simOpts: SimOptions = {
    engine: opts.engine ?? DEFAULT_ENGINE,
    seed: opts.seed ?? 1,
    tuning: opts.tuning,
    autoSpawn: opts.autoSpawn ?? false,
    rookieOpening: opts.rookieOpening ?? false,
    secondWind: opts.secondWind,
    startCheckpoint: opts.startCheckpoint,
  };
  const sim = new Sim(simOpts);
  const ops: Op[] = [];
  const log = (o: Op) => {
    const last = ops[ops.length - 1];
    if (o.op === 'step' && last?.op === 'step') last.n += o.n; else ops.push(o);
  };
  return {
    sim,
    get stepIndex() { return sim.stepIndex; },
    get hearts() { return sim.hearts; },
    get budget() { return { total: sim.budget, used: sim.used, left: sim.budget - sim.used }; },
    get checkpoint() { return { n: sim.checkpoint, lineY: sim.lineY, hold: sim.holdState() }; },
    step: (n = 1) => { log({ op: 'step', n }); sim.step(n); },
    placePiece: p => { log({ op: 'place', p: { ...p } }); return sim.placePiece(p); },
    spawnControlled: p => { log({ op: 'spawn', p: p && { ...p } }); sim.spawnControlled(p); },
    intent: i => { log({ op: 'intent', i: { ...i } }); sim.intent(i); },
    retune: patch => { log({ op: 'retune', patch: { ...patch } }); sim.retune(patch); },
    controlled: () => (sim.ctrl ? { shape: sim.ctrl.shape, x: sim.ctrl.x, y: sim.ctrl.y, rot: sim.ctrl.rot, xTarget: sim.ctrl.xTarget, soft: sim.ctrl.soft, hard: sim.ctrl.hard } : null),
    snapshot: () => ({ opts: { ...opts, tuning: opts.tuning && { ...opts.tuning } }, ops: ops.map(o => ({ ...o })), stepIndex: sim.stepIndex }),
    ghost: () => sim.ghost(),
    pieces: () => sim.pieceViews().map(v => ({ id: v.id, shape: v.shape, state: v.state, x: v.x, y: v.y, angle: Math.atan2(v.s, v.c), vx: v.vx, vy: v.vy, w: v.w, bonds: v.bonds })),
    drainEvents: () => sim.drainEvents(),
    height: () => sim.height(),
    hash: () => sim.hash(),
    digest: () => sim.digest(),
    dispose: () => sim.dispose(),
  };
}

export interface ReplayInput { engine?: 'box2d' | 'rapier'; seed: number; tuning?: Partial<Tuning>; rookieOpening?: boolean; secondWind?: SecondWindMode; startCheckpoint?: number; inputs: LoggedInput[]; steps: number }

/**
 * Replays a recorded run (auto spawn on, as in the game) and returns the digest every 60 steps,
 * for comparing with the digests in a run record.
 */
export function replay(rec: ReplayInput): { digests: string[]; sim: Sim } {
  const sim = new Sim({ engine: rec.engine ?? DEFAULT_ENGINE, seed: rec.seed, tuning: rec.tuning, autoSpawn: true, rookieOpening: rec.rookieOpening ?? false, secondWind: rec.secondWind, startCheckpoint: rec.startCheckpoint });
  const digests: string[] = [];
  let k = 0;
  while (sim.stepIndex < rec.steps) {
    while (k < rec.inputs.length && rec.inputs[k].s === sim.stepIndex) {
      const i = rec.inputs[k++].i;
      if (i.type === 'retune') sim.retune(i.patch); else sim.intent(i);
    }
    sim.step();
    if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  }
  return { digests, sim };
}

export { Sim };
