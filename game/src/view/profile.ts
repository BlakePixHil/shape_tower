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
}

export interface Award {
  lines: [string, string][];
  gained: number;
  before: { level: number; xp: number };
  after: { level: number; xp: number };
  levelsGained: number;
}

const KEY = 'shape-tower-profile-v1';

const fresh = (): Profile => ({ level: 1, xp: 0, total: 0, runs: 0, streak: 0, lastDay: '', boostDay: '', askedGhost: false, windDay: '' });

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) };
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
