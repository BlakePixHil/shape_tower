// The store screenshots: what each of the eight shows, its caption, and where its frame comes from
// (scripts/listing-shots.ts films and frames them). In the order the store shows them.

import { BANNED } from '../src/clips.ts';
import type { CaptionLine } from '../src/render.ts';
import { playRun, specFor, type RunResult } from '../src/runs.ts';
import { ACHIEVEMENTS } from '../../game/src/meta/achievements.ts';

/** The runs the in-game shots come from (the first weekly batch's: a careful Endless run that reaches the Stratosphere, and a Zen climb to Deep Cosmos). */
export const RUNS = {
  endless: () => playRun(specFor('endless', 2075900, 'careful', 2075907)),
  zen: () => playRun(specFor('zen', 2075999, 'careful', 20759, { quitAt: { biome: 10, placed: 3 }, maxSteps: 40 * 60 * 60 })),
};

export type Source =
  /** Frames of a run: `at` ms after step `from` (a function of the run when it depends on its events). */
  | { run: keyof typeof RUNS; from: number | ((r: RunResult) => number); at: number[]; pick: number }
  /** One of the app's screens: the buttons tapped from the main menu (a data-action, or a selector in brackets). */
  | { taps: string[] };

export interface Shot { name: string; lines: CaptionLine[]; source: Source }

const every = (from: number, to: number, by: number) => Array.from({ length: Math.floor((to - from) / by) + 1 }, (_, i) => from + i * by);
const lostAt = (r: RunResult) => r.events.find(e => e.name === 'piece_lost' && e.s >= 20540 && !e.p.brittle)!.s;
const usedAt = (kind: string) => (r: RunResult) => r.events.find(e => e.name === 'power_used' && e.p.kind === kind && e.s > 9000)!.s;

export const SHOTS: Shot[] = [
  { name: '1-stack', lines: [{ text: 'Stack wobbly shapes' }, { text: 'with real physics', hi: true }], source: { run: 'endless', from: 6000, at: every(0, 9000, 1000), pick: 3 } },
  { name: '2-timber', lines: [{ text: 'One sloppy drop…' }, { text: 'TIMBER!', hi: true }], source: { run: 'endless', from: lostAt, at: every(0, 2400, 300), pick: 5 } },
  { name: '3-climb', lines: [{ text: 'Climb from the meadow' }, { text: 'to deep space', hi: true }], source: { run: 'zen', from: 73488, at: every(3000, 9000, 1000), pick: 2 } },
  { name: '4-daily', lines: [{ text: 'A new Daily Tower' }, { text: 'every day', hi: true }], source: { taps: ['daily', '[data-action="tab"][data-tab="best"]'] } },
  { name: '5-powers', lines: [{ text: 'Power-ups' }, { text: 'save your tower', hi: true }], source: { run: 'endless', from: usedAt('slowmo'), at: every(0, 3000, 300), pick: 1 } },
  { name: '6-zen', lines: [{ text: 'Relax in' }, { text: 'Zen mode', hi: true }], source: { run: 'zen', from: 12000, at: every(0, 9000, 1000), pick: 2 } },
  { name: '7-look', lines: [{ text: 'Dress up your' }, { text: 'Blocklings', hi: true }], source: { taps: ['profile', 'look'] } },
  { name: '8-achievements', lines: [{ text: `${ACHIEVEMENTS.length} achievements` }, { text: 'to earn', hi: true }], source: { taps: ['profile', 'achievements'] } },
];

for (const s of SHOTS) for (const l of s.lines) if (BANNED.test(l.text)) throw new Error(`caption names a trademark: ${l.text}`);
