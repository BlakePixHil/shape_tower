// Bot runs in Node and the moments worth a clip in them. A run is a seed, a tuning and the bot's input
// log, so the browser replays it step for step (src/driver.js checks the digests as it goes).

import { Sim, type LoggedInput, type SecondWindMode } from '../../game/src/sim/sim.ts';
import { biomeFor, type Tuning } from '../../game/src/sim/tuning.ts';
import { dailyNumber, dailySeed, dailyShapes } from '../../game/src/meta/daily.ts';
import { ClipBot, type BotStyle } from './bot.ts';

export const STEP_HZ = 60;

/** Every late hazard: the clip player has met them all, so none comes at half strength with a card. */
const MET_HAZARDS = ['crosswind', 'junk', 'meteor', 'dust', 'sway'];

export type Mode = 'endless' | 'daily' | 'zen';

export interface RunSpec {
  mode: Mode;
  seed: number;
  /** The Daily's UTC day (YYYY-MM-DD) for a Daily run. */
  day?: string;
  bot: { seed: number; style: BotStyle };
  secondWind: SecondWindMode;
  tuning: Partial<Tuning>;
  /** Stop here even if the run goes on (steps). */
  maxSteps: number;
  /** Quit (pause, then quit) once this biome is reached and this many more shapes have landed: how a Zen climb ends. */
  quitAt?: { biome: number; placed: number };
}

export interface Moment {
  kind: 'collapse' | 'clutch' | 'checkpoint' | 'soclose' | 'combo' | 'climb' | 'daily';
  /** Steps of the run the clip shows. */
  from: number;
  to: number;
  /** Higher is better, comparable within a kind. */
  score: number;
  /** Facts for the caption. */
  facts: Record<string, number | string>;
}

export interface RunResult {
  spec: RunSpec;
  steps: number;
  inputs: LoggedInput[];
  /** sim.digest() every 60 steps, for the browser's check. */
  digests: string[];
  cause: string;
  height: number;
  checkpoints: number;
  biome: number;
  events: { s: number; name: string; p: Record<string, unknown> }[];
}

/**
 * The tuning a run starts with for a level-12 player on default settings (game.ts runTuning): Hold
 * and the head-start power unlocked, every hazard already met.
 */
export function tuningFor(mode: Mode, day?: string): Partial<Tuning> {
  const t: Partial<Tuning> = { sensitivity: 1, holdUnlocked: true, startPower: true, hazardIntro: false, seenHazards: [...MET_HAZARDS] };
  if (mode === 'daily') { t.shapeSet = dailyShapes(day!); t.startPower = false; }
  if (mode === 'zen') t.zen = true;
  return t;
}

/** A run's spec: a Daily plays its day's seed and shapes as a scored try (no Second Wind). */
export function specFor(mode: Mode, seed: number, style: BotStyle, botSeed = seed, opts: { day?: string; maxSteps?: number; quitAt?: RunSpec['quitAt'] } = {}): RunSpec {
  const day = opts.day;
  return {
    mode, seed: mode === 'daily' ? dailySeed(day!) : seed >>> 0, day, bot: { seed: botSeed, style },
    secondWind: mode === 'endless' ? 'earn' : 'off', tuning: tuningFor(mode, day), maxSteps: opts.maxSteps ?? 20 * 60 * STEP_HZ, quitAt: opts.quitAt,
  };
}

/** The events moments are made of (contacts and signals left out). */
const KEEP = new Set([
  'piece_spawned', 'piece_landed', 'piece_settled', 'piece_lost', 'heart_lost', 'last_heart', 'perfect', 'clutch', 'row_solid',
  'checkpoint_near', 'checkpoint_hold', 'checkpoint_cancelled', 'checkpoint_claimed', 'biome_entered', 'run_over', 'bricks_out',
  'hazard_start', 'hazard_hit', 'brittle_broke', 'power_used', 'second_wind', 'set_streak',
]);

export function playRun(spec: RunSpec): RunResult {
  const sim = new Sim({ seed: spec.seed, tuning: { ...spec.tuning }, autoSpawn: true, rookieOpening: false, secondWind: spec.secondWind });
  const bot = new ClipBot({ seed: spec.bot.seed, style: spec.bot.style });
  const events: RunResult['events'] = [];
  const digests: string[] = [];
  let tension = 0;
  const keep = (e: { name: string; step: number; payload: Record<string, unknown> }) => {
    if (e.name === 'signals') { tension = Number(e.payload.tension) || 0; return; }
    if (!KEEP.has(e.name)) return;
    if (e.name === 'checkpoint_hold' && Number(e.payload.progress) > 0) return;
    events.push({ s: e.step, name: e.name, p: { ...e.payload, tension } });
  };
  for (const e of sim.drainEvents()) keep(e);
  let quitFrom = -1;
  while (sim.state === 'playing' && sim.stepIndex < spec.maxSteps) {
    if (spec.quitAt && biomeFor(sim.checkpoint).id >= spec.quitAt.biome) {
      if (quitFrom < 0) quitFrom = sim.stats.placed;
      if (sim.stats.placed - quitFrom >= spec.quitAt.placed && !sim.ctrl?.hard) { sim.intent({ type: 'quit' }); sim.step(); break; }
    }
    bot.tick(sim);
    sim.step();
    for (const e of sim.drainEvents()) keep(e);
    if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  }
  const result: RunResult = {
    spec, steps: sim.stepIndex, inputs: sim.inputLog.map(x => ({ s: x.s, i: { ...x.i } })), digests,
    cause: sim.cause || 'cut', height: sim.stats.maxHeight - sim.foundations[0].top, checkpoints: sim.stats.checkpoints,
    biome: biomeFor(sim.checkpoint).id, events,
  };
  sim.dispose();
  return result;
}

const secs = (s: number) => s * STEP_HZ;

/** The moments in a run worth a clip, best first within each kind. */
export function findMoments(run: RunResult): Moment[] {
  const out: Moment[] = [];
  const ev = run.events;
  const end = run.steps;
  const clamp = (from: number, to: number) => ({ from: Math.max(secs(1), from), to: Math.min(end + (run.cause === 'cut' ? 0 : secs(1.5)), to) });
  const cpAt = (s: number) => 1 + ev.filter(e => e.name === 'checkpoint_claimed' && e.s <= s).length;

  // Collapses: lost pieces close together, the bigger and higher the better.
  const lost = ev.filter(e => e.name === 'piece_lost' && !e.p.brittle);
  for (let i = 0; i < lost.length;) {
    let j = i;
    while (j + 1 < lost.length && lost[j + 1].s - lost[j].s < secs(2.5)) j++;
    const n = j - i + 1;
    if (n >= 2) {
      const at = lost[i].s, last = lost[j].s;
      const over = ev.some(e => e.name === 'run_over' && e.s >= at && e.s - last < secs(3));
      // How far the line was: the last "near" call since the last claim (99 when none).
      let near = 99;
      for (const e of ev) {
        if (e.s > at) break;
        if (e.name === 'checkpoint_claimed') near = 99;
        if (e.name === 'checkpoint_near') near = Number(e.p.blocks);
      }
      out.push({ kind: 'collapse', ...clamp(at - secs(8.5), last + secs(over ? 3 : 2.5)), score: n * n * (1 + cpAt(at) / 6) + (over ? 3 : 0) + (near <= 3 ? 3 : 0), facts: { pieces: n, checkpoint: cpAt(at), over: over ? 1 : 0, near } });
    }
    i = j + 1;
  }

  // Clutch saves: a drop on an amber or red guide that held, with the tower already shaky.
  for (const e of ev) {
    if (e.name !== 'clutch') continue;
    const t = Number(e.p.tension) || 0;
    const lostSoon = lost.some(l => l.s > e.s && l.s - e.s < secs(4));
    if (lostSoon) continue;
    out.push({ kind: 'clutch', ...clamp(e.s - secs(7), e.s + secs(3)), score: 1 + t * 4 + cpAt(e.s) / 20, facts: { checkpoint: cpAt(e.s), tension: Math.round(t * 100) / 100 } });
  }

  // Checkpoint claims: the hold's countdown, the claim and the celebration; a new world scores more.
  const claims = ev.filter(e => e.name === 'checkpoint_claimed');
  for (const c of claims) {
    const hold = [...ev].reverse().find(e => e.name === 'checkpoint_hold' && e.s <= c.s);
    const from = (hold?.s ?? c.s - secs(4)) - secs(5);
    const biome = ev.find(e => e.name === 'biome_entered' && e.s >= c.s && e.s - c.s < secs(3));
    const cancelled = ev.some(e => e.name === 'checkpoint_cancelled' && e.s >= from && e.s <= c.s);
    out.push({
      kind: cancelled ? 'soclose' : 'checkpoint', ...clamp(from, c.s + secs(biome ? 4.5 : 3)),
      score: 1 + (biome ? 2 : 0) + (cancelled ? 2 : 0) + Number(c.p.n) / 10 + (c.p.grade === 'gold' ? 0.5 : 0),
      facts: { checkpoint: Number(c.p.n), grade: String(c.p.grade), biome: biome ? String(biome.p.name ?? biome.p.id) : '' },
    });
  }

  // Perfect streaks: three or more perfect placements in a row.
  const perf = ev.filter(e => e.name === 'perfect');
  for (let i = 0; i < perf.length; i++) {
    const c = Number(perf[i].p.combo);
    if (c >= 3 && (i + 1 >= perf.length || Number(perf[i + 1].p.combo) <= c)) {
      // The last five of the streak, at most: a clip is 10 to 13 s.
      const first = perf[i - Math.min(c, 5) + 1] ?? perf[i];
      out.push({ kind: 'combo', ...clamp(first.s - secs(3), perf[i].s + secs(2.5)), score: Math.min(c, 12) + cpAt(perf[i].s) / 5, facts: { combo: c, checkpoint: cpAt(perf[i].s) } });
    }
  }

  // The climb: a run that ends high, for the run-over panorama down through every world.
  if (run.cause !== 'cut' && run.checkpoints >= 6) {
    out.push({ kind: 'climb', from: Math.max(secs(1), end - secs(3)), to: end, score: run.checkpoints, facts: { checkpoints: run.checkpoints, height: Math.round(run.height * 10) / 10, biome: run.biome } });
  }

  // A Daily: its final stretch and the height to beat.
  if (run.spec.mode === 'daily' && run.cause !== 'cut') {
    out.push({ kind: 'daily', from: Math.max(secs(1), end - secs(9)), to: end, score: run.height, facts: { number: dailyNumber(run.spec.day!), height: Math.round(run.height * 10) / 10, day: run.spec.day! } });
  }
  return out.sort((a, b) => b.score - a.score);
}
