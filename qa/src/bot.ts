// A stacking bot that plays the game's own Sim (auto spawn on) through intents only, the way a
// player does. For each shape it asks the sim's ghost about every column and rotation and takes
// the lowest safe landing. Everything it does goes through sim.intent, so a bot run is an ordinary
// input log that replays on any build, like a phone record.
//
// With `powers` on it also steers through power bubbles, taps power slots now and then (sometimes
// with nothing for the power to do, so refusals get exercised too) and uses Second Wind when it
// is down to its last heart or bricks.

/** The parts of the game's Sim the bot reads. Private methods are read through `query`. */
export interface BotSim {
  stepIndex: number;
  state: string;
  ctrl: { shape: string; x: number; y: number; rot: number; xTarget: number; hard: boolean } | null;
  foundation: { x: number; width: number; top: number };
  slots?: (string | null)[];
  bubble?: { x: number; y: number; r: number } | null;
  secondWind?: string;
  hearts: number;
  budget: number;
  used: number;
  tuning: { infiniteHearts: boolean; infiniteBudget: boolean };
  intent(i: Record<string, unknown>): void;
  step(n?: number): void;
  digest(): string;
  inputLog: { s: number; i: Record<string, unknown> }[];
}

interface GhostLike { y: number | null; tint: string; supportFraction: number }
type Extents = (shape: string, rot: number) => { minX: number; maxX: number; minY: number; maxY: number };

export interface BotPolicy {
  /** Seeds the bot's own choices; the sim's streams are never touched. */
  seed: number;
  /** Steer through bubbles and use powers and Second Wind. Default off: placement only. */
  powers?: boolean;
  /** Share of shapes left to fall on their own (some with soft drop) instead of a hard drop. */
  naturalFall?: number;
  /** Logs a quit intent at this step. */
  quitAt?: number;
}

export interface BotRun {
  steps: number;
  digests: string[];
  finalDigest: string;
  inputs: { s: number; i: Record<string, unknown> }[];
}

/** mulberry32, for the bot's own decisions. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TINT_COST: Record<string, number> = { ok: 0, amber: 1.5, red: 6, none: 3 };

export class Bot {
  private r: () => number;
  private seen: object | null = null;
  private plan: { x: number; rot: number } | null = null;
  private phase: 'bubble' | 'aim' | 'fall' | 'done' = 'done';
  private steered: unknown = null;
  private turns = 0;
  private hadCtrl = false;

  constructor(
    private readonly policy: BotPolicy,
    private readonly extents: Extents,
  ) {
    this.r = rng(policy.seed ^ 0x5eed);
  }

  /** Decides this step's intents. Call once before each sim.step(). */
  tick(sim: BotSim): void {
    if (sim.state !== 'playing') return;
    if (this.policy.quitAt !== undefined && sim.stepIndex === this.policy.quitAt) {
      sim.intent({ type: 'quit' });
      return;
    }
    const c = sim.ctrl;
    if (this.policy.powers) this.usePowers(sim, c !== null && c !== this.seen, c === null && this.hadCtrl);
    this.hadCtrl = sim.ctrl !== null;
    if (!sim.ctrl) return;
    const ctrl = sim.ctrl;
    if (ctrl !== this.seen) {
      this.seen = ctrl;
      this.steered = null;
      this.plan = this.choose(sim);
      this.turns = 0;
      const b = sim.bubble;
      this.phase = this.policy.powers && b && sim.slots?.includes(null) && ctrl.y > b.y + 1 ? 'bubble' : 'aim';
    }
    if (ctrl.hard || this.phase === 'done' || this.phase === 'fall') return;
    const plan = this.plan;
    if (!plan) {
      sim.intent({ type: 'hardDrop' });
      this.phase = 'done';
      return;
    }
    if (this.phase === 'bubble') {
      const b = sim.bubble;
      if (!b || ctrl.y < b.y - 1.6) this.phase = 'aim';
      else {
        // Once per bubble: moveTo snaps to the half-block grid, and bubbles can sit off it.
        if (this.steered !== b) {
          this.steered = b;
          sim.intent({ type: 'moveTo', x: b.x });
        }
        return;
      }
    }
    if (ctrl.rot % 4 !== plan.rot && this.turns < 6) {
      this.turns++;
      sim.intent({ type: 'rotate', dir: 1 });
      return;
    }
    if (ctrl.xTarget !== plan.x) {
      sim.intent({ type: 'moveTo', x: plan.x });
      return;
    }
    if (ctrl.x !== plan.x) return;
    const fall = this.policy.naturalFall ?? 0;
    if (this.r() < fall) {
      if (this.r() < 0.5) sim.intent({ type: 'softDrop', on: true });
      this.phase = 'fall';
    } else {
      sim.intent({ type: 'hardDrop' });
      this.phase = 'done';
    }
  }

  /** Lowest safe landing over every column and rotation, with a little noise. */
  private choose(sim: BotSim): { x: number; rot: number } | null {
    const c = sim.ctrl!;
    const f = sim.foundation;
    const q = sim as unknown as {
      computeGhost(c: { shape: string; x: number; y: number; rot: number }): GhostLike;
      free(shape: string, x: number, y: number, rot: number): boolean;
    };
    let best: { x: number; rot: number; cost: number } | null = null;
    for (let rot = 0; rot < 4; rot++) {
      const e = this.extents(c.shape, rot);
      for (let x = f.x - f.width / 2 - e.minX - 1; x <= f.x + f.width / 2 - e.maxX + 1; x += 0.5) {
        if (!q.free(c.shape, x, c.y, rot)) continue;
        const g = q.computeGhost({ shape: c.shape, x, y: c.y, rot });
        if (g.y === null) continue;
        const cost = g.y + e.maxY + (TINT_COST[g.tint] ?? 3) + (1 - g.supportFraction) + 0.05 * Math.abs(x - f.x) + 0.3 * this.r();
        if (!best || cost < best.cost) best = { x, rot, cost };
      }
    }
    return best && { x: best.x, rot: best.rot };
  }

  private usePowers(sim: BotSim, newShape: boolean, justLanded: boolean): void {
    const left = sim.tuning.infiniteBudget ? Infinity : sim.budget - sim.used;
    const lastHeart = !sim.tuning.infiniteHearts && sim.hearts <= 1;
    if (sim.secondWind === 'ready' && (lastHeart || left <= 2)) {
      sim.intent({ type: 'secondWind' });
      return;
    }
    // Now and then, with or without a shape in hand, tap a slot, full or not.
    if ((newShape && this.r() < 0.3) || (justLanded && this.r() < 0.15)) {
      sim.intent({ type: 'power', slot: this.r() < 0.5 ? 0 : 1 });
    }
    // A stray Second Wind tap before it is ready, to check refusals.
    if (newShape && sim.secondWind !== 'ready' && this.r() < 0.02) sim.intent({ type: 'secondWind' });
  }
}

/** Plays the bot until the run ends or `maxSteps`, recording a digest every 60 steps like a phone. */
export function runBot(sim: BotSim, bot: Bot, maxSteps: number): BotRun {
  const digests: string[] = [];
  while (sim.stepIndex < maxSteps && sim.state === 'playing') {
    bot.tick(sim);
    sim.step();
    if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  }
  return { steps: sim.stepIndex, digests, finalDigest: sim.digest(), inputs: sim.inputLog.map((x) => ({ s: x.s, i: { ...x.i } })) };
}
