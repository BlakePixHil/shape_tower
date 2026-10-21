// Bot soak, qa-section.md F3.9: stacking bots play whole runs of the real game (auto spawn, real
// rules, Mortar on and off). The sim must never throw, and every run ends by the rules.
import { describe, expect, it } from 'vitest';
import { FULL, loadSim } from '../src/adapters/index';
import { Bot, runBot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { knownIssue } from '../src/known-issues';
import { writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const soakBug = knownIssue('F3.9 bots', sut);

describe.runIf(game)(`bots on ${sut.kind} (${sut.engine})`, () => {
  (soakBug ? it.fails : it)(`F3.9 bots play whole runs with Mortar on and off and the sim never throws${soakBug ? ` (known bug ${soakBug.id})` : ''}`, () => {
    const { api, shapes } = game!;
    // The fast set runs past the first Solid Rows and claim of two runs; the full set plays 16
    // runs to the end (or 5 minutes).
    const cases = FULL
      ? [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => [true, false].map((mortar) => ({ seed, mortar, seconds: 300 })))
      : [{ seed: 1, mortar: true, seconds: 40 }, { seed: 2, mortar: false, seconds: 40 }];
    const lines: string[] = [];
    const problems: string[] = [];
    const runs: Record<string, unknown>[] = [];
    for (const c of cases) {
      const sim = new api.Sim({ seed: c.seed, tuning: { mortar: c.mortar }, autoSpawn: true, rookieOpening: false }) as BotSim & Record<string, any>;
      const bot = new Bot({ seed: c.seed, naturalFall: 0.3 }, shapes.extents);
      const name = `seed ${c.seed}, Mortar ${c.mortar ? 'on' : 'off'}`;
      let error: string | null = null;
      try {
        runBot(sim, bot, 60 * c.seconds);
      } catch (err) {
        error = (err as Error).message;
      }
      const bad = (sim.pieceViews() as { x: number; y: number }[]).filter((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y)).length;
      const ended = sim.state === 'over' ? `ended by ${sim.cause}` : 'still playing at the time cap';
      const line = `${name}: ${(sim.stepIndex / 60).toFixed(1)} s, ${sim.stats.placed} placed, ${sim.stats.checkpoints} checkpoints, ${error ? `THREW "${error}" at step ${sim.stepIndex}` : ended}${bad ? `, ${bad} pieces at a non-finite position` : ''}`;
      lines.push(line);
      if (error || bad) problems.push(line);
      runs.push({ ...c, steps: sim.stepIndex, placed: sim.stats.placed, checkpoints: sim.stats.checkpoints, cause: sim.cause ?? null, error });
      try {
        sim.dispose();
      } catch {
        // A world that threw mid-step may not dispose cleanly; the next sim gets a fresh one.
      }
    }
    if (soakBug) lines.unshift(`Known bug ${soakBug.id} (${soakBug.owner}, since ${soakBug.since}): ${soakBug.summary}`);
    writeReport({ suite: 'bots', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', lines, { runs });
    expect(problems).toEqual([]);
  });
});
