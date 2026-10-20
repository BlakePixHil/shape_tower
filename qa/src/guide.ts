// Landing-guide sweep (qa-section.md §5): drop every shape, rotation and position onto each base
// tower and compare what the guide promised with what actually happened.
import type { CreateSim, Ghost, PieceLandedEvent, Sim, SimEvent } from './contract';
import { INSET, rng, stepUntilQuiet } from './measure';
import { normRot, rotatedSize, worldRects } from './shapes';
import type { TowerDef } from './towers';

/** 1 px at the reference resolution: 1170 px across about 12 blocks (gameplay.md §11). */
export const PX = 12 / 1170;

/** G1 tolerance: 1 px, or 1% of the shape's smallest side, whichever is larger. */
export function g1Tolerance(shape: string): number {
  const { w, h } = rotatedSize(shape, 0);
  return Math.max(PX, 0.01 * Math.min(w, h));
}

/** Half-width of the playfield the shape can steer across (about 12 blocks on screen). */
export const PLAY_HALF_WIDTH = 6;

export type DropMode = 'fall' | 'hard';

export interface GuideCase {
  base: string;
  shape: string;
  rot: number;
  x: number;
  mode: DropMode;
}

export interface GuideResult extends GuideCase {
  /** What the guide said at spawn. null means "will miss". */
  ghostAtSpawn: Pick<Ghost, 'x' | 'y' | 'rot' | 'tint' | 'supportIds'> | null;
  outcome: 'landed' | 'missed' | 'timeout';
  /** First-contact pose from piece_landed. */
  landed?: { x: number; y: number; rot: number; touchedIds: number[]; via?: string };
  /** G1: largest distance between a ghost reading and the touchdown pose (spawn and last reading). */
  posError: number | null;
  /** G2: the guide's rotation equals the touchdown rotation. */
  rotOk: boolean;
  /** How far the shape turned in the step after touchdown (physics response, reported only). */
  angleError: number | null;
  /** G3: the ghost's support set equals what the shape first touched. */
  supportOk: boolean | null;
  /** G4: ghost x always equal to the shape's x. */
  alignOk: boolean;
  /** G6: largest jump between ghost readings while nothing moved the shape sideways. */
  flicker: number;
  /** G8: "will miss" was right both ways. */
  missOk: boolean;
  /** G11: worst distance from a contact dot to the shape's bottom at touchdown. */
  dotError: number | null;
  /** G10 calibration: what happened to the dropped shape in the 2 s after touchdown. */
  tipped: boolean | null;
  /** Problems found, empty when every check passed. */
  failures: string[];
}

export interface SweepOptions {
  createSim: CreateSim;
  engine?: string;
  seed?: number;
  bases: TowerDef[];
  shapes: string[];
  modes?: DropMode[];
  /** Horizontal step in blocks (half-block snap). */
  xStep?: number;
  /** Fraction of cases to run, chosen with a seeded draw (the fast set uses 0.05). */
  sample?: number;
  /** Steps to watch after touchdown for the tint outcome (0 skips it). */
  afterSteps?: number;
  tuning?: Record<string, unknown>;
  onCase?: (r: GuideResult) => void;
}

export function enumerateCases(o: Pick<SweepOptions, 'bases' | 'shapes' | 'modes' | 'xStep' | 'sample' | 'seed'>): GuideCase[] {
  const step = o.xStep ?? 0.5;
  const modes = o.modes ?? ['fall', 'hard'];
  const all: GuideCase[] = [];
  for (const base of o.bases) {
    for (const shape of o.shapes) {
      for (let rot = 0; rot < 4; rot++) {
        const { w } = rotatedSize(shape, rot);
        const lim = PLAY_HALF_WIDTH - w / 2;
        for (let x = -lim; x <= lim + 1e-9; x += step) {
          const sx = Math.round(x * 2) / 2;
          for (const mode of modes) all.push({ base: base.id, shape, rot, x: sx, mode });
        }
      }
    }
  }
  if (o.sample === undefined || o.sample >= 1) return all;
  const r = rng((o.seed ?? 1) ^ 0x9e3779b9);
  return all.filter(() => r() < o.sample!);
}

/** The shapes from `shapes` that the sim can spawn (the game adds shape tiers over time). */
export async function supportedShapes(createSim: CreateSim, shapes: string[], o: { engine?: string; tuning?: Record<string, unknown> } = {}): Promise<string[]> {
  const ok: string[] = [];
  for (const shape of shapes) {
    const sim = await createSim({ engine: (o.engine ?? 'reference') as never, seed: 1, tuning: o.tuning });
    try {
      sim.spawnControlled({ shape, x: 0, rot: 0 });
      ok.push(shape);
    } catch {
      // Not in this build yet.
    }
    sim.dispose();
  }
  return ok;
}

/** Builds a base tower and lets it come to rest. */
export async function buildBase(createSim: CreateSim, def: TowerDef, o: { seed: number; engine?: string; tuning?: Record<string, unknown> }): Promise<{ sim: Sim; quietAfter: number }> {
  const sim = await createSim({ engine: (o.engine ?? 'reference') as never, seed: o.seed, tuning: o.tuning });
  for (const p of def.pieces) sim.placePiece(p);
  const quietAfter = stepUntilQuiet(sim, 1200);
  sim.drainEvents();
  return { sim, quietAfter };
}

/** Distance from a contact dot to the nearest bottom edge of the shape's (inset) rects at a pose. */
export function dotDistance(shape: string, pose: { x: number; y: number; rot: number }, dot: { x: number; y: number }): number {
  let best = Infinity;
  for (const quad of worldRects(shape, pose.x, pose.y, (normRot(pose.rot) * Math.PI) / 2, INSET)) {
    const ys = quad.map((q) => q.y);
    const xs = quad.map((q) => q.x);
    const bottom = Math.min(...ys);
    const dx = Math.max(Math.min(...xs) - dot.x, 0, dot.x - Math.max(...xs));
    best = Math.min(best, Math.hypot(dx, dot.y - bottom));
  }
  return best;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((v) => s.has(v));
}

/** Runs one drop on a sim that holds a resting base. The caller restores the snapshot first. */
export function runCase(sim: Sim, c: GuideCase, afterSteps: number): GuideResult {
  const failures: string[] = [];
  const tol = g1Tolerance(c.shape);
  const id = sim.spawnControlled({ shape: c.shape, x: c.x, rot: c.rot });
  const me = () => sim.pieces().find((p) => p.id === id);
  const g0 = sim.ghost();
  if (!me()) failures.push('spawnControlled returned no piece');
  let alignOk = true;
  const checkAlign = (g: Ghost | null) => {
    const p = me();
    if (g && p && p.state === 'controlled' && (g.x !== p.x || normRot(g.rot) !== normRot(c.rot))) alignOk = false;
  };
  checkAlign(g0);

  const events: SimEvent[] = [];
  let landedEv: PieceLandedEvent | undefined;
  let lost = false;
  let lastGhost = g0;
  let flicker = 0;
  const limit = 60 * 40;

  if (c.mode === 'hard') {
    sim.intent({ type: 'hardDrop' });
    for (let i = 0; i < limit && !landedEv && !lost; i++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        events.push(e);
        if (e.type === 'piece_landed' && e.id === id) landedEv = e as PieceLandedEvent;
        if (e.type === 'piece_lost' && e.id === id) lost = true;
      }
    }
  } else {
    for (let i = 0; i < limit && !landedEv && !lost; i++) {
      // Read the guide every step near touchdown, and every 4th step higher up.
      const p = me();
      const near = !g0 || !p || p.y - g0.y < 2;
      if (near || i % 4 === 0) {
        const g = sim.ghost();
        checkAlign(g);
        if (g && g0) flicker = Math.max(flicker, Math.abs(g.y - g0.y));
        if (g) lastGhost = g;
      }
      sim.step();
      for (const e of sim.drainEvents()) {
        events.push(e);
        if (e.type === 'piece_landed' && e.id === id) landedEv = e as PieceLandedEvent;
        if (e.type === 'piece_lost' && e.id === id) lost = true;
      }
    }
  }

  const outcome: GuideResult['outcome'] = landedEv ? 'landed' : lost ? 'missed' : 'timeout';
  let posError: number | null = null;
  let rotOk = true;
  let angleError: number | null = null;
  let supportOk: boolean | null = null;
  let dotError: number | null = null;
  let tipped: boolean | null = null;

  // G8: "will miss" both ways.
  const missOk = (g0 === null) === (outcome !== 'landed');
  if (!missOk) failures.push(g0 === null ? 'G8: guide said miss, shape landed' : `G8: guide showed a landing, shape ${outcome}`);
  if (outcome === 'timeout') failures.push('shape neither landed nor was lost within 40 s');

  if (landedEv && g0) {
    const pose = landedEv.pose;
    const readings = [g0, lastGhost].filter((g): g is Ghost => g !== null);
    posError = Math.max(...readings.map((g) => Math.hypot(g.x - pose.x, g.y - pose.y)));
    if (posError > tol) failures.push(`G1: touchdown off by ${posError.toFixed(4)} (tolerance ${tol.toFixed(4)})`);
    rotOk = normRot(pose.rot) === normRot(g0.rot);
    if (!rotOk) failures.push(`G2: guide rot ${g0.rot}, landed rot ${pose.rot}`);
    const after = sim.pieces().find((p) => p.id === (landedEv!.pieceId ?? id));
    if (after) {
      const want = (normRot(pose.rot) * Math.PI) / 2;
      const d = Math.atan2(Math.sin(after.angle - want), Math.cos(after.angle - want));
      angleError = Math.abs(d);
    }
    supportOk = sameSet(g0.supportIds, landedEv.touchedIds);
    if (!supportOk) failures.push(`G3: guide support [${g0.supportIds}] but first touched [${landedEv.touchedIds}]`);
    if (landedEv.via === 'knock') failures.push('knocked during descent onto a resting tower');
    // G11: every dot should sit on the underside of one of the shape's rects at touchdown.
    if (g0.contacts.length) dotError = Math.max(...g0.contacts.map((k) => dotDistance(c.shape, pose, k)));
  }
  if (!alignOk) failures.push('G4: guide x or rot differed from the shape');
  if (g0 && flicker > tol) failures.push(`G6: guide moved ${flicker.toFixed(4)} with nothing moving the shape`);

  if (landedEv && afterSteps > 0) {
    const bodyId = landedEv.pieceId ?? id;
    const body = () => sim.pieces().find((p) => p.id === bodyId);
    const a0 = body()?.angle ?? 0;
    let gone = false;
    for (let i = 0; i < afterSteps; i++) {
      sim.step();
      if (sim.drainEvents().some((e) => e.type === 'piece_lost' && e.id === bodyId)) gone = true;
    }
    const p = body();
    tipped = gone || !p || Math.abs(p.angle - a0) > (15 * Math.PI) / 180;
  }

  return {
    ...c,
    ghostAtSpawn: g0 ? { x: g0.x, y: g0.y, rot: g0.rot, tint: g0.tint, supportIds: g0.supportIds } : null,
    outcome,
    landed: landedEv ? { ...landedEv.pose, touchedIds: landedEv.touchedIds, via: landedEv.via as string | undefined } : undefined,
    posError,
    rotOk,
    angleError,
    supportOk,
    alignOk,
    flicker,
    missOk,
    dotError,
    tipped,
    failures,
  };
}

export interface SweepSummary {
  cases: number;
  landed: number;
  missed: number;
  timeouts: number;
  /** G1: share of landed drops within tolerance, and the worst error. */
  g1Within: number;
  g1Worst: number;
  g1Over3x: number;
  g2Failures: number;
  g3Failures: number;
  g4Failures: number;
  g6Failures: number;
  g8Failures: number;
  g11Worst: number | null;
  /** G10 calibration from single drops: how often each tint's shape then tipped. */
  tint: Record<string, { shown: number; tipped: number }>;
  failures: GuideResult[];
  ms: number;
}

export async function sweep(o: SweepOptions): Promise<{ results: GuideResult[]; summary: SweepSummary }> {
  const t0 = performance.now();
  const seed = o.seed ?? 1;
  const cases = enumerateCases(o);
  const results: GuideResult[] = [];
  for (const base of o.bases) {
    const mine = cases.filter((c) => c.base === base.id);
    if (!mine.length) continue;
    const { sim } = await buildBase(o.createSim, base, { seed, engine: o.engine, tuning: o.tuning });
    const snap = sim.snapshot();
    for (const c of mine) {
      sim.restore(snap);
      const r = runCase(sim, c, o.afterSteps ?? 0);
      results.push(r);
      o.onCase?.(r);
    }
    sim.dispose();
  }
  return { results, summary: summarise(results, performance.now() - t0) };
}

export function summarise(results: GuideResult[], ms: number): SweepSummary {
  const landed = results.filter((r) => r.outcome === 'landed');
  const errs = landed.map((r) => r.posError).filter((e): e is number => e !== null);
  const within = landed.filter((r) => r.posError !== null && r.posError <= g1Tolerance(r.shape)).length;
  const tint: SweepSummary['tint'] = {};
  for (const r of landed) {
    if (!r.ghostAtSpawn || r.tipped === null) continue;
    const k = r.ghostAtSpawn.tint;
    tint[k] ??= { shown: 0, tipped: 0 };
    tint[k].shown++;
    if (r.tipped) tint[k].tipped++;
  }
  const dots = landed.map((r) => r.dotError).filter((e): e is number => e !== null);
  return {
    cases: results.length,
    landed: landed.length,
    missed: results.filter((r) => r.outcome === 'missed').length,
    timeouts: results.filter((r) => r.outcome === 'timeout').length,
    g1Within: landed.length ? within / landed.length : 1,
    g1Worst: errs.length ? Math.max(...errs) : 0,
    g1Over3x: landed.filter((r) => r.posError !== null && r.posError > 3 * g1Tolerance(r.shape)).length,
    g2Failures: results.filter((r) => !r.rotOk).length,
    g3Failures: results.filter((r) => r.supportOk === false).length,
    g4Failures: results.filter((r) => !r.alignOk).length,
    g6Failures: results.filter((r) => r.ghostAtSpawn && r.flicker > g1Tolerance(r.shape)).length,
    g8Failures: results.filter((r) => !r.missOk).length,
    g11Worst: dots.length ? Math.max(...dots) : null,
    tint,
    failures: results.filter((r) => r.failures.length > 0),
    ms,
  };
}

/** G5: after a move or rotation, the guide reflects it before the next step. */
export function sameStepUpdate(sim: Sim, shape: string): string[] {
  const problems: string[] = [];
  const id = sim.spawnControlled({ shape, x: 0, rot: 0 });
  const me = () => sim.pieces().find((p) => p.id === id)!;
  for (const target of [1, -1.5, 2.5, 0]) {
    sim.intent({ type: 'moveTo', x: target });
    const g = sim.ghost();
    const p = me();
    if (g && g.x !== p.x) problems.push(`moveTo ${target}: ghost x ${g.x} but shape x ${p.x} before the next step`);
  }
  for (const dir of [1, 1, -1] as const) {
    sim.intent({ type: 'rotate', dir });
    const g = sim.ghost();
    const p = me();
    const rot = normRot(Math.round(p.angle / (Math.PI / 2)));
    if (g && (normRot(g.rot) !== rot || g.x !== p.x)) problems.push(`rotate ${dir}: ghost rot ${g.rot} x ${g.x}, shape rot ${rot} x ${p.x} before the next step`);
  }
  return problems;
}
