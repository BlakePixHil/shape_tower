// The clip bot: plays the game's own Sim through intents, like a person with a phone. It picks its
// landing the way QA's bot does (qa/src/bot.ts: every column and rotation through the sim's ghost,
// lowest safe landing first), but takes its time so a clip reads: a beat to look, a quarter turn at a
// time, a drag across in half-block steps, a pause over the spot, then the drop. A sloppy bot now and
// then takes a risky spot, which is where wobbles, saves and collapses come from.
//
// Its choices come from its own seed, never the sim's streams, so a run is just a seed, a tuning and
// an input log: it replays exactly in the browser (the clip renderer) as it does here.

import { extents } from '../../game/src/sim/shapes.ts';
import type { Sim } from '../../game/src/sim/sim.ts';

export type BotStyle = 'careful' | 'sloppy' | 'reckless';

export interface BotOptions {
  /** Seeds the bot's own choices. */
  seed: number;
  style: BotStyle;
  /** Use powers from the slots and Second Wind on the last heart (default on). */
  powers?: boolean;
}

interface GhostLike { y: number | null; tint: string; supportFraction: number; perfectFit: boolean }
interface SimQuery {
  computeGhost(c: { shape: string; x: number; y: number; rot: number }): GhostLike;
  free(shape: string, x: number, y: number, rot: number): boolean;
}

/** How often each style takes a risky spot instead of its best one. */
const RISK: Record<BotStyle, number> = { careful: 0.03, sloppy: 0.16, reckless: 0.35 };
const TINT_COST: Record<string, number> = { ok: 0, amber: 1.5, red: 6, none: 3 };

/** mulberry32, for the bot's own choices. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ClipBot {
  private r: () => number;
  private seen: object | null = null;
  private plan: { x: number; rot: number; soft: boolean } | null = null;
  private wait = 0;   // steps until the next move
  private turns = 0;
  private stuck = 0;  // steps waiting for the shape to reach its spot
  private dropped = false;
  private hadCtrl = false;

  private readonly o: BotOptions;

  constructor(o: BotOptions) {
    this.o = o;
    this.r = rng(o.seed ^ 0xc1195);
  }

  /** Call once before each sim.step(). */
  tick(sim: Sim): void {
    if (sim.state !== 'playing') return;
    if (this.o.powers !== false) this.usePowers(sim);
    const c = sim.ctrl;
    const landed = !c && this.hadCtrl;
    this.hadCtrl = !!c;
    if (landed) this.wait = 0;
    if (!c) return;
    if (c !== this.seen) {
      this.seen = c;
      this.plan = this.choose(sim);
      this.turns = 0;
      this.stuck = 0;
      this.dropped = false;
      this.wait = 8 + Math.floor(this.r() * 16); // a look at the shape and the tower first
    }
    if (c.hard || this.dropped) return;
    if (this.wait > 0) { this.wait--; return; }
    const plan = this.plan;
    if (!plan) { sim.intent({ type: 'hardDrop' }); this.dropped = true; return; }
    if (c.rot % 4 !== plan.rot && this.turns < 6) {
      this.turns++;
      sim.intent({ type: 'rotate', dir: 1 });
      this.wait = 6 + Math.floor(this.r() * 6);
      return;
    }
    if (c.xTarget !== plan.x) {
      // A drag: half a block every couple of steps (moveTo would jump straight there).
      const d = plan.x - c.xTarget;
      const step = Math.sign(d) * Math.min(Math.abs(d), this.r() < 0.5 ? 0.5 : 1);
      const before = c.xTarget;
      sim.intent({ type: 'moveTo', x: before + step });
      this.wait = 1 + Math.floor(this.r() * 3);
      if (sim.ctrl && sim.ctrl.xTarget === before) this.plan = { ...plan, x: before }; // blocked: drop where it is
      return;
    }
    if (c.x !== plan.x && this.stuck++ < 30) return;
    // Over the spot: a short pause, then the drop (or a soft drop now and then).
    if (plan.soft) sim.intent({ type: 'softDrop', on: true });
    else sim.intent({ type: 'hardDrop' });
    this.dropped = true;
  }

  /** The landing: lowest safe spot over every column and rotation, or now and then a risky one. */
  private choose(sim: Sim): { x: number; rot: number; soft: boolean } | null {
    const c = sim.ctrl!;
    const f = sim.foundation;
    const q = sim as unknown as SimQuery;
    const options: { x: number; rot: number; cost: number; tint: string }[] = [];
    for (let rot = 0; rot < 4; rot++) {
      const e = extents(c.shape, rot);
      for (let x = f.x - f.width / 2 - e.minX - 1; x <= f.x + f.width / 2 - e.maxX + 1; x += 0.5) {
        if (!q.free(c.shape, x, c.y, rot)) continue;
        const g = q.computeGhost({ shape: c.shape, x, y: c.y, rot });
        if (g.y === null) continue;
        const cost = g.y + e.maxY + (TINT_COST[g.tint] ?? 3) + (1 - g.supportFraction) + 0.05 * Math.abs(x - f.x) + (g.perfectFit ? -0.6 : 0) + 0.3 * this.r();
        options.push({ x, rot, cost, tint: g.tint });
      }
    }
    if (!options.length) return null;
    options.sort((a, b) => a.cost - b.cost);
    let pick = options[0];
    if (this.r() < RISK[this.o.style]) {
      const risky = options.filter(o => o.tint === 'amber' || o.tint === 'red');
      const pool = risky.length ? risky : options.slice(Math.floor(options.length / 2));
      pick = pool[Math.floor(this.r() * pool.length)];
    }
    return { x: pick.x, rot: pick.rot, soft: this.r() < 0.2 };
  }

  private usePowers(sim: Sim): void {
    const left = sim.tuning.infiniteBudget ? Infinity : sim.budget - sim.used;
    if (sim.secondWind === 'ready' && ((!sim.tuning.infiniteHearts && sim.hearts <= 1) || left <= 1)) {
      sim.intent({ type: 'secondWind' });
      return;
    }
    // A power when the tower gets shaky, or now and then with a new shape in hand.
    const slot = sim.slots.findIndex(s => s !== null);
    if (slot < 0 || !sim.ctrl || sim.ctrl !== this.seen || this.wait !== 3) return;
    if (sim.tension() > 0.45 || this.r() < 0.08) sim.intent({ type: 'power', slot });
  }
}
