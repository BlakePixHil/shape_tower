// Engine-agnostic measurements. Everything here reads the sim only through the contract.
import type { CreateSim, PieceState, Sim, SimEvent } from './contract';
import { overlapDepth, worldRects } from './shapes';
import type { Expectation, TowerDef } from './towers';

/** Seeded 32-bit generator (mulberry32), so every harness run is repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STEPS_PER_SECOND = 60;
const DEG = 180 / Math.PI;

/** Collider inset per side, used for overlap checks (gameplay.md §3.2). */
export const INSET = 0.02;
/** Overlap deeper than this counts as interpenetration (F3.3). */
export const OVERLAP_ALLOWANCE = 0.05;
/** Upward speed a resting stack should never produce (F3.3), blocks/s. */
export const MAX_UPWARD_SPEED = 4;

export interface Tracker {
  maxUpSpeed: number;
  maxSpeed: number;
  maxOverlap: number;
  longestOverlapRun: number;
  overlapRun: Map<string, number>;
}

export function newTracker(): Tracker {
  return { maxUpSpeed: 0, maxSpeed: 0, maxOverlap: 0, longestOverlapRun: 0, overlapRun: new Map() };
}

/** Records speeds and pairwise overlaps for one step. */
export function track(t: Tracker, pieces: PieceState[], checkOverlap = true): void {
  for (const p of pieces) {
    if (p.state === 'controlled') continue;
    t.maxUpSpeed = Math.max(t.maxUpSpeed, p.vy);
    t.maxSpeed = Math.max(t.maxSpeed, Math.hypot(p.vx, p.vy));
  }
  if (!checkOverlap) return;
  const live = pieces.filter((p) => p.state !== 'lost');
  const rects = live.map((p) => worldRects(p.shape, p.x, p.y, p.angle, INSET));
  const seen = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (Math.abs(live[i].x - live[j].x) > 6 || Math.abs(live[i].y - live[j].y) > 6) continue;
      let depth = 0;
      for (const a of rects[i]) for (const b of rects[j]) depth = Math.max(depth, overlapDepth(a, b));
      t.maxOverlap = Math.max(t.maxOverlap, depth);
      const key = `${live[i].id}:${live[j].id}`;
      if (depth > OVERLAP_ALLOWANCE) {
        const run = (t.overlapRun.get(key) ?? 0) + 1;
        t.overlapRun.set(key, run);
        t.longestOverlapRun = Math.max(t.longestOverlapRun, run);
        seen.add(key);
      }
    }
  }
  for (const key of t.overlapRun.keys()) if (!seen.has(key)) t.overlapRun.delete(key);
}

export interface TowerResult {
  id: string;
  seed: number;
  expected: Expectation;
  outcome: 'stands' | 'falls' | 'moved';
  pass: boolean | null;
  /** Largest move of any piece during the measure window, after settling. */
  maxDispAfterSettle: number;
  /** Largest move of any piece from where it was placed. */
  maxDispTotal: number;
  maxRotDeg: number;
  lost: number;
  maxUpSpeed: number;
  maxOverlap: number;
  longestOverlapRun: number;
}

export interface TowerRunOptions {
  seed: number;
  /** Random sideways nudge per piece, in blocks, so "100 seeds" means something. */
  jitter?: number;
  settleSteps?: number;
  measureSteps?: number;
  mortar?: 'off' | 'on';
  engine?: string;
  tuning?: Record<string, unknown>;
  /**
   * Place one piece at a time, waiting until it has settled and then `bondSteps` more before the
   * next, as in play. Mortar towers need this: bonds only form between pieces that have rested.
   */
  incremental?: { bondSteps: number };
}

export async function buildTower(
  createSim: CreateSim,
  def: TowerDef,
  o: { seed: number; jitter?: number; engine?: string; tuning?: Record<string, unknown>; incremental?: { bondSteps: number } },
): Promise<{ sim: Sim; placed: Map<number, { x: number; y: number }> }> {
  const sim = await createSim({ engine: (o.engine ?? 'reference') as never, seed: o.seed, tuning: o.tuning });
  const r = rng(o.seed);
  const placed = new Map<number, { x: number; y: number }>();
  for (const p of def.pieces) {
    const x = p.x + (o.jitter ? (r() * 2 - 1) * o.jitter : 0);
    const id = sim.placePiece({ ...p, x });
    placed.set(id, { x, y: p.y });
    if (o.incremental) {
      for (let i = 0; i < 600; i++) {
        sim.step();
        const me = sim.pieces().find((q) => q.id === id);
        if (!me || me.state === 'settled' || me.state === 'stone' || me.state === 'bonded') break;
      }
      sim.step(o.incremental.bondSteps);
    }
  }
  return { sim, placed };
}

export async function runTower(createSim: CreateSim, def: TowerDef, o: TowerRunOptions): Promise<TowerResult> {
  const settleSteps = o.settleSteps ?? 60;
  const measureSteps = o.measureSteps ?? 30 * STEPS_PER_SECOND;
  const { sim, placed } = await buildTower(createSim, def, o);
  const t = newTracker();
  let maxDispTotal = 0;
  const dispTotal = (ps: PieceState[]) => {
    for (const p of ps) {
      const s = placed.get(p.id);
      if (s) maxDispTotal = Math.max(maxDispTotal, Math.hypot(p.x - s.x, p.y - s.y));
    }
  };
  for (let i = 0; i < settleSteps; i++) {
    sim.step();
    const ps = sim.pieces();
    track(t, ps);
    dispTotal(ps);
  }
  const base = new Map(sim.pieces().map((p) => [p.id, p]));
  let maxDisp = 0;
  let maxRot = 0;
  for (let i = 0; i < measureSteps; i++) {
    sim.step();
    const ps = sim.pieces();
    track(t, ps, i % 2 === 0);
    dispTotal(ps);
    for (const p of ps) {
      const b = base.get(p.id);
      if (!b) continue;
      maxDisp = Math.max(maxDisp, Math.hypot(p.x - b.x, p.y - b.y));
      maxRot = Math.max(maxRot, Math.abs(p.angle - b.angle) * DEG);
    }
  }
  const lostEvents = sim.drainEvents().filter((e) => e.type === 'piece_lost').length;
  const alive = new Set(sim.pieces().filter((p) => p.state !== 'lost').map((p) => p.id));
  const missing = [...placed.keys()].filter((id) => !alive.has(id)).length;
  const lostCount = Math.max(lostEvents, missing);
  sim.dispose();
  const outcome: TowerResult['outcome'] =
    lostCount > 0 || maxDispTotal > 0.5 || maxRot > 15 ? 'falls' : maxDisp < 0.05 && maxRot < 2 ? 'stands' : 'moved';
  const expected = o.mortar === 'on' ? def.expect.mortarOn : def.expect.mortarOff;
  return {
    id: def.id,
    seed: o.seed,
    expected,
    outcome,
    pass: expected === 'calibration' ? null : outcome === expected,
    maxDispAfterSettle: maxDisp,
    maxDispTotal,
    maxRotDeg: maxRot,
    lost: lostCount,
    maxUpSpeed: t.maxUpSpeed,
    maxOverlap: t.maxOverlap,
    longestOverlapRun: t.longestOverlapRun,
  };
}

/**
 * Steps until every piece has been quiet for `hold` steps in a row (at least `minSteps` in total), or the limit.
 * Returns the steps taken, or -1 if it never got quiet.
 */
export function stepUntilQuiet(sim: Sim, limit: number, o: { speed?: number; spin?: number; hold?: number; minSteps?: number } = {}): number {
  const speed = o.speed ?? 1e-3;
  const spin = o.spin ?? 1e-3;
  const hold = o.hold ?? 30;
  const minSteps = o.minSteps ?? 30;
  let quietFor = 0;
  for (let i = 1; i <= limit; i++) {
    sim.step();
    const ps = sim.pieces();
    const quiet = ps.every((p) => p.state === 'stone' || (Math.hypot(p.vx, p.vy) < speed && Math.abs(p.w) < spin));
    quietFor = quiet ? quietFor + 1 : 0;
    if (i >= minSteps && quietFor >= hold) return i;
  }
  return -1;
}

/** Steps until a predicate on drained events matches. Returns the matching event, or null on timeout. */
export function stepUntilEvent(sim: Sim, match: (e: SimEvent) => boolean, limit: number, sink?: SimEvent[]): SimEvent | null {
  for (let i = 0; i < limit; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      sink?.push(e);
      if (match(e)) return e;
    }
  }
  return null;
}
