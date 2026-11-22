// The voiceover Short (scripts/short.ts films it): what the voice says, how the words show as captions,
// and which piece of real play runs under each line. About 45 s, 1080 x 1920, for YouTube Shorts
// (and TikTok and Reels). Public words never name another company's game (src/clips.ts checkWords).

import { playRun, specFor, type RunResult } from '../src/runs.ts';

/** Kokoro's voice (github.com/hexgrad/kokoro, Apache 2.0) and pace. */
export const VOICE = { voice: 'af_heart', speed: 1, lang: 'en-us' };

export interface Line {
  id: string;
  /**
   * What the voice says, marked up as captions: `|` starts a new caption, `/` a new line in it, and a
   * line that starts with `^` is the yellow one. No captions when `card` is set (the end card says it).
   */
  text: string;
  /** Silence before the line, s (default 0.3). */
  gap?: number;
  card?: boolean;
}

export const LINES: Line[] = [
  { id: 'hook', gap: 0.25, text: 'How high / can you stack | before it / all comes | ^crashing down?' },
  { id: 'intro', gap: 0.75, text: 'This is / ^Shape Tower, | the stacking game | where every shape | ^wobbles, slides / ^and settles | with / ^real physics.' },
  { id: 'guide', text: 'A landing guide | shows where each / ^shape will fall.' },
  { id: 'checkpoint', text: 'Reach a / ^checkpoint, | hold steady, | and lock in / ^your climb.' },
  { id: 'worlds', gap: 0.7, text: 'Build from a / ^grassy meadow, | up through / ^the clouds, | all the way to / ^deep space.' },
  { id: 'powers', gap: 0.45, text: 'Grab / ^power-ups | to save a / shaky tower.' },
  { id: 'daily', text: 'Take on the / ^Daily Tower: | one scored try | to top the / ^online ladder.' },
  { id: 'zen', gap: 0.4, text: 'Or unwind in / ^Zen mode.' },
  { id: 'profile', gap: 0.55, text: '^Level up, | unlock / ^new looks, | and chase dozens of / ^achievements.' },
  { id: 'pop', text: 'And a brand-new / ^puzzle mode | is on the way.' },
  { id: 'cta', gap: 0.55, card: true, text: 'Shape Tower is out now on the App Store and Google Play. Download it free, and start stacking!' },
];

/** A line's text with the caption marks taken out: what the voice reads. */
export const say = (text: string) => text.replace(/[|/^]/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.:!?])/g, '$1').trim();
/** The words a recogniser hears in a text (scripts/voice.py words_of): how a line's words are counted. */
export const wordsOf = (text: string) => text.toLowerCase().replace(/-/g, ' ').replace(/[^a-z' ]+/g, ' ').split(' ').filter(Boolean);

/** The end card, over the last line. Each part pops in on a word of that line (its index). */
export const CARD = {
  line: 'cta',
  badge: { text: 'OUT NOW', word: 3 },
  stores: [{ text: 'App Store', word: 7 }, { text: 'Google Play', word: 10 }],
  free: { text: 'Free to play', word: 14 },
  /** Where it is out today (the soft launch); pass --regions "" to scripts/short.ts once it is out everywhere. */
  regions: 'Australia · New Zealand · Canada',
  /** How long the card holds after the voice stops, s. */
  hold: 1.1,
};

// ------------------------------------------------------------------ the runs (the promo's, and one more Zen stretch)
export const RUNS = {
  collapse: () => playRun(specFor('endless', 2075900, 'careful', 2075907)),
  checkpoint: () => playRun(specFor('endless', 2075906, 'careful', 2075913)),
  clutch: () => playRun(specFor('endless', 2075911, 'reckless', 2075918)),
  daily: () => playRun(specFor('daily', 0, 'careful', 20759, { day: '2026-11-04' })),
  zen: () => playRun(specFor('zen', 2075999, 'careful', 20759, { quitAt: { biome: 10, placed: 3 }, maxSteps: 40 * 60 * 60 })),
};
export type RunName = keyof typeof RUNS;

/** A word of a line: where a shot starts, or where a moment of play lands. */
export type Word = [line: string, word: number];

export type Footage =
  /** A stretch of a bot run. `step` is the moment; it lands on the word `on` (default: the shot's first frame), `lead` s later than that. */
  | { kind: 'run'; run: RunName; step: (r: RunResult) => number; on?: Word; lead?: number; tag?: string }
  /** The run-over panorama of a run (the camera sweeping the whole tower), played backwards: from the ground up. */
  | { kind: 'climb'; run: RunName }
  /** One of the app's screens: the buttons tapped from the main menu, shown as a phone on the brand's sky. */
  | { kind: 'screen'; taps: string[]; scroll?: number }
  /** The puzzle mode, played by a greedy bot with real drags. */
  | { kind: 'pop'; warmup: number };

export interface Shot {
  id: string;
  /** Starts this long (s, default 0.12) before a word of a line. The first shot starts at 0. */
  at: Word;
  early?: number;
  footage: Footage;
  /** A small label on the picture ("COMING SOON"). */
  label?: string;
}

const first = (r: RunResult, name: string, after: number, kind?: string) => {
  const e = r.events.find(x => x.name === name && x.s >= after && !x.p.brittle && (!kind || x.p.kind === kind));
  if (!e) throw new Error(`no ${name} after step ${after}`);
  return e.s;
};

export const SHOTS: Shot[] = [
  // The hook: a tall tower stands for a second, a shape under it gives way on "stack", and it is all falling by "crashing down".
  { id: 'hook', at: ['hook', 0], footage: { kind: 'run', run: 'collapse', step: r => first(r, 'brittle_broke', 20800), on: ['hook', 4] } },
  // Clean stacking in the Meadow, then a shaky save.
  { id: 'intro', at: ['intro', 0], early: 0.3, footage: { kind: 'run', run: 'collapse', step: () => 1850 } },
  { id: 'wobble', at: ['intro', 7], footage: { kind: 'run', run: 'clutch', step: r => first(r, 'clutch', 1300), on: ['intro', 13] } },
  { id: 'guide', at: ['guide', 0], early: 0.2, footage: { kind: 'run', run: 'checkpoint', step: () => 4290 } },
  // The hold, and the claim on "lock in" (a checkpoint inside a world: a new world's title card would sit under the caption).
  { id: 'checkpoint', at: ['checkpoint', 0], early: 0.2, footage: { kind: 'run', run: 'checkpoint', step: r => first(r, 'checkpoint_claimed', 5600), on: ['checkpoint', 6] } },
  // Meadow to deep space: the whole tower, from the ground up.
  { id: 'worlds', at: ['worlds', 0], early: 0.35, footage: { kind: 'climb', run: 'zen' } },
  { id: 'powers', at: ['powers', 0], early: 0.2, footage: { kind: 'run', run: 'collapse', step: r => first(r, 'power_used', 9000, 'slowmo'), on: ['powers', 1] } },
  { id: 'daily-card', at: ['daily', 0], early: 0.2, footage: { kind: 'screen', taps: ['daily', '[data-action="tab"][data-tab="best"]'] } },
  { id: 'daily', at: ['daily', 5], footage: { kind: 'run', run: 'daily', step: () => 4760, tag: 'DAILY TOWER · SCORED' } },
  { id: 'zen', at: ['zen', 0], early: 0.2, footage: { kind: 'run', run: 'zen', step: r => first(r, 'biome_entered', 41000) + 420 } },
  { id: 'profile', at: ['profile', 0], early: 0.25, footage: { kind: 'screen', taps: ['profile'] } },
  { id: 'look', at: ['profile', 2], footage: { kind: 'screen', taps: ['profile', 'look'] } },
  { id: 'achievements', at: ['profile', 5], footage: { kind: 'screen', taps: ['profile', 'achievements'], scroll: 150 } },
  { id: 'pop', at: ['pop', 0], early: 0.2, footage: { kind: 'pop', warmup: 14 }, label: 'COMING SOON' },
];

// ------------------------------------------------------------------ the words for the upload
export const UPLOAD = {
  title: 'How high can you stack? Shape Tower is OUT NOW on iPhone & Android #shorts',
  description: [
    'Stack wobbly shapes with real physics and see how high your tower can go before it all comes crashing down.',
    '',
    '🧱 A landing guide shows where every shape will fall',
    '🚩 Checkpoints lock in your climb',
    '🚀 Build from a grassy meadow up to deep space',
    '⚡ Power-ups to save a shaky tower',
    '📅 A new Daily Tower every day, with an online ladder',
    '🧘 Zen mode for relaxed stacking',
    '🏆 Levels, new looks and dozens of achievements',
    '',
    'Free to play. Out now in Australia, New Zealand and Canada, with more countries on the way.',
    '',
    '🍎 App Store: https://apps.apple.com/au/app/shape-tower-stack-balance/id6826781264',
    '🤖 Google Play: https://play.google.com/store/apps/details?id=com.blakepixhil.shapetower',
  ],
  tags: ['#shorts', '#shapetower', '#mobilegame', '#indiegame', '#physicsgame', '#puzzlegame', '#stackinggame', '#newgame', '#iosgames', '#androidgames', '#satisfying'],
};

/** What is wrong with the script, if anything: a shot or a card part tied to a word its line doesn't have. */
export function checkShort(): string[] {
  const out: string[] = [];
  const count = new Map(LINES.map(l => [l.id, wordsOf(say(l.text)).length]));
  const has = ([line, word]: Word, what: string) => { if (!(word >= 0 && word < (count.get(line) ?? 0))) out.push(`${what}: no word ${word} in line "${line}"`); };
  for (const s of SHOTS) {
    has(s.at, `shot ${s.id}`);
    if (s.footage.kind === 'run' && s.footage.on) has(s.footage.on, `shot ${s.id}'s moment`);
  }
  for (const w of [CARD.badge.word, CARD.free.word, ...CARD.stores.map(x => x.word)]) has([CARD.line, w], 'end card');
  if (new Set(SHOTS.map(s => s.id)).size !== SHOTS.length) out.push('two shots share an id');
  if (LINES.filter(l => l.card).length !== 1 || LINES[LINES.length - 1].id !== CARD.line) out.push('the end card goes with the last line');
  return out;
}
