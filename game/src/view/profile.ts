// The player profile: level and XP across runs (gameplay.md §10). Saved per device.

import { levelStep } from '../sim/tuning.ts';

export interface Profile {
  level: number;
  xp: number;          // into the current level
  total: number;
  runs: number;
  streak: number;      // consecutive local days played
  lastDay: string;     // local date of the last finished run
  boostDay: string;    // local date the Daily Boost was used
  askedGhost: boolean; // the one-time "did the ghost show where shapes would land?" prompt
  windDay: string;     // local date the day's free Second Wind was spent
  stats: ProfileStats; // lifetime stats for the Profile screen (gameplay.md §10.3)
  sliceRuns: number;   // game-build runs started on this install (QA's Gate 1 protocol)
  player: string;      // a random id made once per install, so QA can group runs by player
  seenGusts: boolean;  // the first gust of a player's first Treetops is half strength, with a card (§8.3)
  postcards: (string | null)[]; // per biome (1 to 10), the local date it was first reached
}

export interface ProfileStats {
  bestHeight: number;
  bestBiome: number;   // 1 to 10
  bricks: number;
  perfects: number;
  rows: number;
  checkpoints: number;
  clutches: number;
}

/** What each level opens (gameplay.md §10.3). */
export const UNLOCKS: { level: number; id: string; name: string; text: string }[] = [
  { level: 2, id: 'hold', name: 'Hold', text: 'Flick up to keep a shape for later.' },
  { level: 3, id: 'daily', name: 'Daily Tower', text: 'The same tower for everyone, once a day.' },
  { level: 6, id: 'perk', name: 'Head start', text: 'Every run starts with a power-up in a slot.' },
  { level: 8, id: 'zen', name: 'Zen', text: 'No bricks to count and no hearts to lose.' },
];

export interface Award {
  lines: [string, string][];
  gained: number;
  before: { level: number; xp: number };
  after: { level: number; xp: number };
  levelsGained: number;
}

const KEY = 'shape-tower-profile-v1';

const freshStats = (): ProfileStats => ({ bestHeight: 0, bestBiome: 1, bricks: 0, perfects: 0, rows: 0, checkpoints: 0, clutches: 0 });
const newPlayer = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const fresh = (): Profile => ({ level: 1, xp: 0, total: 0, runs: 0, streak: 0, lastDay: '', boostDay: '', askedGhost: false, windDay: '', stats: freshStats(), sliceRuns: 0, player: newPlayer(), seenGusts: false, postcards: Array(10).fill(null) });

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) };
      p.stats = { ...freshStats(), ...p.stats };
      p.postcards = Array.from({ length: 10 }, (_, i) => p.postcards?.[i] ?? null);
      if (!p.player) { p.player = newPlayer(); saveProfile(p); }
      return p;
    }
  } catch { /* storage unavailable */ }
  return fresh();
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* fine without it */ }
}

function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day's first Endless run starts with Second Wind ready (monetisation plan, "Second chance"). */
export function dailyWindReady(p: Profile, now = new Date()): boolean { return p.windDay !== day(now); }

/** Spends the day's free Second Wind: called once that run has placed a shape. */
export function spendDailyWind(p: Profile, now = new Date()): void {
  p.windDay = day(now);
  saveProfile(p);
}

/**
 * Adds a run's XP. `base` is the sim's XP (quit halving and floor already applied).
 * New best +50 (halved on a quit), Daily Boost ×2 on the first run of the day that wasn't quit,
 * streak +5% per consecutive day after the first, up to +25%. The first run always reaches level 2.
 */
export function award(p: Profile, base: number, opts: { newBest: boolean; quit: boolean; now?: Date }): Award {
  const now = opts.now ?? new Date();
  const today = day(now);
  const yesterday = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const before = { level: p.level, xp: p.xp };
  const lines: [string, string][] = [['Run', `+${base}`]];
  let xp = base;
  if (opts.newBest) {
    const b = opts.quit ? 25 : 50;
    xp += b;
    lines.push(['New best', `+${b}`]);
  }
  if (p.lastDay !== today) p.streak = p.lastDay === yesterday ? p.streak + 1 : 1;
  p.lastDay = today;
  if (!opts.quit && p.boostDay !== today) {
    p.boostDay = today;
    lines.push(['Daily Boost', '×2']);
    xp *= 2;
  }
  const streakPct = Math.min(25, 5 * Math.max(0, p.streak - 1));
  if (streakPct > 0) {
    lines.push([`${p.streak}-day streak`, `+${streakPct}%`]);
    xp *= 1 + streakPct / 100;
  }
  xp = Math.round(xp);
  if (p.runs === 0 && p.total + xp < levelStep(1)) {
    lines.push(['First run bonus', `+${levelStep(1) - p.total - xp}`]);
    xp = levelStep(1) - p.total;
  }
  p.runs++;
  p.total += xp;
  p.xp += xp;
  let levelsGained = 0;
  while (p.xp >= levelStep(p.level)) { p.xp -= levelStep(p.level); p.level++; levelsGained++; }
  saveProfile(p);
  return { lines, gained: xp, before, after: { level: p.level, xp: p.xp }, levelsGained };
}

/** Adds a finished run to the lifetime stats (saved with the next award). */
export function addRunStats(p: Profile, r: { height: number; biome: number; bricks: number; perfects: number; rows: number; checkpoints: number; clutches: number }, now = new Date()): void {
  const s = p.stats;
  for (let i = 0; i < Math.min(10, r.biome); i++) p.postcards[i] ??= day(now);
  s.bestHeight = Math.max(s.bestHeight, r.height);
  s.bestBiome = Math.max(s.bestBiome, r.biome);
  s.bricks += r.bricks;
  s.perfects += r.perfects;
  s.rows += r.rows;
  s.checkpoints += r.checkpoints;
  s.clutches += r.clutches;
}

/**
 * Gate 1 (QA's protocol): the install's first game run is a juice-on warm-up, then blocks of four
 * go off, on, on, off. The count is saved at run start, so an abandoned run still uses its turn.
 */
export function nextJuice(p: Profile): { juice: boolean; juiceRun: number } {
  const n = p.sliceRuns;
  p.sliceRuns = n + 1;
  saveProfile(p);
  return { juice: n === 0 ? true : [false, true, true, false][(n - 1) % 4], juiceRun: n };
}
