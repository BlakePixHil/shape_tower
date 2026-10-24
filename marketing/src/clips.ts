// What each kind of moment becomes: its on-screen captions (burned in, since most people watch muted),
// how long it films past the moment, and the words for the post. The formats are the launch plan's
// (marketing plan, "Short-form video"). Public words never name another company's game.

import type { Caption, ClipJob } from './render.ts';
import type { Moment, RunResult } from './runs.ts';

export interface Post {
  /** The clip's file name (no folder). */
  file: string;
  kind: Moment['kind'];
  /** The day it's meant to go out (YYYY-MM-DD). */
  day: string;
  title: string;
  /** For TikTok, Shorts and Reels: one line, then the tags. */
  text: string;
  tags: string[];
}

export const TAGS = ['#shapetower', '#indiegame', '#mobilegame', '#gamedev', '#puzzlegame', '#stacking'];
/** Words that must never appear in anything public (trademarks). */
export const BANNED = /tetris|jenga/i;

/** The end card's line, by date: before pre-registration, during it, and after the launch. */
export function ctaFor(day: string): { cta: string; sub?: string } {
  if (day < '2026-11-26') return { cta: 'Coming soon to Google Play' };
  if (day < '2027-02-04') return { cta: 'Pre-register on Google Play', sub: 'Link in bio' };
  return { cta: 'Free on Google Play', sub: 'Link in bio' };
}

const pick = <T>(list: T[], n: number): T => list[((n % list.length) + list.length) % list.length];

/** The clip for a moment: the job (less the run, output and end card) and its post. */
export function clipFor(run: RunResult, m: Moment, n: number): { job: Pick<ClipJob, 'from' | 'to' | 'tailMs' | 'maxMs' | 'captions' | 'tag'>; title: string; text: string; tags: string[] } {
  const f = m.facts;
  const firstLost = run.events.find(e => e.name === 'piece_lost' && e.s >= m.from && !e.p.brittle)?.s;
  const at = (name: string) => run.events.find(e => e.name === name && e.s >= m.from && e.s <= m.to)?.s;
  const hook = (lines: Caption['lines']): Caption => ({ at: 0, lines });
  const beat = (step: number | undefined, lines: Caption['lines'], size = 42): Caption[] => (step === undefined ? [] : [{ atStep: step, lines, size }]);
  switch (m.kind) {
    case 'collapse': {
      const near = Number(f.near) <= 3;
      const lines = near ? [{ text: `Checkpoint ${f.checkpoint}.` }, { text: 'So close.', hi: true }] : pick([
        [{ text: 'It was going' }, { text: 'so well…', hi: true }],
        [{ text: 'One sloppy drop…', hi: true }],
        [{ text: "Don't look down.", hi: true }],
      ], n);
      return {
        job: { from: m.from, to: m.to, tailMs: 600, maxMs: 15000, captions: [hook(lines), ...beat(firstLost, [{ text: 'TIMBER!', hi: true }], 46)] },
        title: 'The collapse',
        text: near ? `Checkpoint ${f.checkpoint}. So close.` : pick(['It was going so well.', 'One sloppy drop and…', 'Physics always wins.'], n),
        tags: [...TAGS, '#physicsgame', '#fail'],
      };
    }
    case 'clutch':
      return {
        job: { from: m.from, to: m.to, tailMs: 300, maxMs: 13000, captions: [hook([{ text: 'Wait for it…', hi: true }]), ...beat(at('clutch'), [{ text: 'SAVED IT!', hi: true }], 46)] },
        title: 'The clutch save',
        text: pick(['That should not have stayed up.', 'Wait for it…', 'Red guide, no problem.'], n),
        tags: [...TAGS, '#satisfying', '#clutch'],
      };
    case 'checkpoint':
    case 'soclose':
      return {
        job: {
          from: m.from, to: m.to, tailMs: 300, maxMs: 16000,
          captions: [
            hook(m.kind === 'soclose' ? [{ text: 'So close…', hi: true }] : pick([[{ text: 'Hold steady…', hi: true }], [{ text: 'Will it hold?', hi: true }]], n)),
            ...beat(at('checkpoint_claimed'), [{ text: `Checkpoint ${f.checkpoint}!`, hi: true }], 44),
          ],
        },
        title: m.kind === 'soclose' ? 'So close' : 'Checkpoint',
        text: f.biome ? `Next stop: ${f.biome}.` : pick(['Hold steady… hold steady…', 'Three seconds has never felt so long.'], n),
        tags: [...TAGS, '#satisfying'],
      };
    case 'combo':
      return {
        job: { from: m.from, to: m.to, tailMs: 300, maxMs: 13000, captions: [] },
        title: 'Satisfying',
        text: pick(['Perfect, perfect, perfect.', 'Sound on.', `${f.combo} perfect drops in a row.`], n),
        tags: [...TAGS, '#satisfying', '#asmr'],
      };
    case 'climb':
      return {
        job: { from: m.from, to: m.to, tailMs: 9000, maxMs: 17000, captions: [hook([{ text: 'How high can' }, { text: 'shapes go?', hi: true }]), ...beat(m.to, [{ text: `${Math.round(Number(f.height))} m`, hi: true }, { text: 'of shapes' }], 46)] },
        title: 'Meadow to space',
        text: `${Math.round(Number(f.height))} m of shapes, from the meadow to deep space.`,
        tags: [...TAGS, '#space', '#satisfying'],
      };
    case 'daily':
      return {
        job: { from: m.from, to: m.to, tailMs: 1500, maxMs: 13000, tag: `DAILY #${f.number} · SCORED`, captions: [hook([{ text: `Daily #${f.number}` }, { text: `Beat ${f.height} m`, hi: true }])] },
        title: `Daily #${f.number}`,
        text: `Today's Daily Tower: everyone gets the same shapes. Can you beat ${f.height} m?`,
        tags: [...TAGS, '#dailychallenge'],
      };
  }
}

/** Throws if any public words break the naming rule. */
export function checkWords(...texts: string[]): void {
  for (const t of texts) if (BANNED.test(t)) throw new Error(`public text names a trademark: ${t}`);
}
