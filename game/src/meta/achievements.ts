// Achievements (gameplay.md §18): the list, the one-off XP they pay, and a tracker that reads one
// run's sim events. It never touches the sim, so seeds, replays and digests stay as they were.
// Ids are permanent: the store consoles key on them later (§18.5).

import type { BusEvent } from '../sim/bus.ts';
import type { Sim } from '../sim/sim.ts';
import { biomeFor } from '../sim/tuning.ts';
import type { Profile } from '../view/profile.ts';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type Group = 'climb' | 'craft' | 'survive' | 'powers' | 'lifetime' | 'secret';

export interface Achievement {
  id: string;
  name: string;
  /** How to earn it, one line. */
  text: string;
  tier: Tier;
  group: Group;
  /** A UI kit icon (art/src/ui/icons.ts UI_ICONS). */
  icon: string;
  /** Biome badges sit on that biome's postcard (1 = Meadow). */
  biome?: number;
  /** Shown as "?" until earned. */
  secret?: boolean;
  /** Counted ones: the total that earns it (the panel shows progress). */
  goal?: number;
}

export const TIER_XP: Record<Tier, number> = { bronze: 20, silver: 50, gold: 100, platinum: 250 };
/** Play Games and Game Center points (§18.5): 935 of the 1,000 both allow. */
export const TIER_POINTS: Record<Tier, number> = { bronze: 5, silver: 15, gold: 35, platinum: 100 };

export const GROUPS: { id: Group; name: string }[] = [
  { id: 'climb', name: 'Climb' }, { id: 'craft', name: 'Craft' }, { id: 'survive', name: 'Survive' },
  { id: 'powers', name: 'Power-ups' }, { id: 'lifetime', name: 'Lifetime' }, { id: 'secret', name: 'Secret' },
];

const A = (group: Group, id: string, name: string, text: string, tier: Tier, icon: string, more: Partial<Achievement> = {}): Achievement =>
  ({ id, name, text, tier, group, icon, ...more });

export const ACHIEVEMENTS: Achievement[] = [
  A('climb', 'cp_first', 'Off the Ground', 'Claim your first checkpoint', 'bronze', 'flag'),
  A('climb', 'biome_2', 'Branching Out', 'Reach the Treetops', 'bronze', 'biome', { biome: 2 }),
  A('climb', 'biome_3', 'Head in the Clouds', 'Reach Cloudlands', 'bronze', 'biome', { biome: 3 }),
  A('climb', 'biome_4', 'Into the Storm', 'Reach the Storm Belt', 'silver', 'biome', { biome: 4 }),
  A('climb', 'biome_5', 'Thin Air', 'Reach the Stratosphere', 'silver', 'biome', { biome: 5 }),
  A('climb', 'biome_6', 'Liftoff', 'Reach Orbit', 'silver', 'biome', { biome: 6 }),
  A('climb', 'biome_7', 'One Small Step', 'Reach the Moon', 'gold', 'biome', { biome: 7 }),
  A('climb', 'biome_8', 'Red Rover', 'Reach the Red Planet', 'gold', 'biome', { biome: 8 }),
  A('climb', 'biome_9', 'Ring Leader', 'Reach the Ringed Giant', 'gold', 'biome', { biome: 9 }),
  A('climb', 'biome_10', 'Into the Deep', 'Reach Deep Cosmos', 'platinum', 'biome', { biome: 10 }),
  A('climb', 'cp_30', 'Off the Map', 'Claim checkpoint 30 in one run', 'platinum', 'crown'),
  A('climb', 'pb', 'New Heights', 'Beat your best height', 'bronze', 'tower'),

  A('craft', 'perfect', 'Pixel Perfect', 'Place a Perfect', 'bronze', 'perfect'),
  A('craft', 'combo_5', 'In the Zone', 'Place 5 Perfects in a row', 'silver', 'combo'),
  A('craft', 'combo_7', 'Seventh Heaven', 'Place 7 Perfects in a row (the ×4 combo)', 'gold', 'combo'),
  A('craft', 'row', 'Solid Ground', 'Make a Solid Row', 'bronze', 'row'),
  A('craft', 'row_2', 'Double!', 'Make 2 Solid Rows with one shape', 'silver', 'row'),
  A('craft', 'row_3', 'Triple!', 'Make 3 Solid Rows with one shape', 'gold', 'row'),
  A('craft', 'grade_s', 'Flat Out', 'Claim a checkpoint with an S foundation', 'silver', 'star'),
  A('craft', 'grade_s3', 'Spirit Level', 'Claim 3 checkpoints in a row with S foundations', 'gold', 'star'),
  A('craft', 'thrifty', 'Penny Pincher', 'Claim a checkpoint with an A or S foundation and 8 or more bricks to spare', 'silver', 'brick'),
  A('craft', 'last_brick', 'Just Enough', 'Claim a checkpoint with your very last brick', 'silver', 'brick'),
  A('craft', 'clutch', 'Clutch!', 'Save a shape the guide said would tip', 'bronze', 'clutch'),
  A('craft', 'clutch_3', 'Nerves of Steel', 'Make 3 Clutch saves in one run', 'silver', 'clutch'),

  A('survive', 'last_heart', 'By a Thread', 'Claim a checkpoint on your last heart', 'bronze', 'heart'),
  A('survive', 'calm_2', 'Weathervane', 'Get through the Treetops without losing a heart', 'bronze', 'wind'),
  A('survive', 'flawless_3', 'Steady Hands', 'Reach Cloudlands without losing a heart', 'silver', 'heart'),
  A('survive', 'calm_4', 'Eye of the Storm', 'Get through the Storm Belt without losing a heart', 'silver', 'wind'),
  A('survive', 'flawless_6', 'Iron Tower', 'Reach Orbit without losing a heart', 'gold', 'heart'),
  A('survive', 'calm_6', 'Dodgeball', 'Get through Orbit without losing a heart', 'gold', 'junk'),
  A('survive', 'calm_7', 'Meteor Proof', 'Get through the Moon without losing a heart', 'gold', 'meteor'),

  A('powers', 'bubble', 'Bubble Pop', 'Steer through a power bubble', 'bronze', 'gift'),
  A('powers', 'toolbox', 'Toolbox', 'Use all five power-ups', 'silver', 'toolbox', { goal: 5 }),
  A('powers', 'comeback', 'Comeback Kid', 'Use Second Wind, then claim 3 more checkpoints in the same run', 'silver', 'restart'),
  A('powers', 'purist', 'No Help Needed', 'Reach the Storm Belt without using a power-up or Second Wind', 'gold', 'purist'),
  A('powers', 'bubbles_50', 'Bubble Wrap', 'Collect 50 power bubbles', 'silver', 'gift', { goal: 50 }),

  A('lifetime', 'bricks_1k', 'Brick by Brick', 'Place 1,000 bricks', 'bronze', 'brick', { goal: 1000 }),
  A('lifetime', 'bricks_10k', 'Great Wall', 'Place 10,000 bricks', 'gold', 'brick', { goal: 10000 }),
  A('lifetime', 'perfects_250', 'Perfectionist', 'Place 250 Perfects', 'silver', 'perfect', { goal: 250 }),
  A('lifetime', 'rows_100', 'Rock Solid', 'Make 100 Solid Rows', 'silver', 'row', { goal: 100 }),
  A('lifetime', 'cps_100', 'Centurion', 'Claim 100 checkpoints', 'silver', 'flag', { goal: 100 }),
  A('lifetime', 'streak_3', 'Hooked', 'Play 3 days in a row', 'bronze', 'streak', { goal: 3 }),
  A('lifetime', 'streak_7', 'Creature of Habit', 'Play 7 days in a row', 'silver', 'streak', { goal: 7 }),

  A('secret', 'avalanche', 'Avalanche!', 'Lose 5 pieces in one tumble', 'bronze', 'avalanche', { secret: true }),
  A('secret', 'so_close', 'So Close!', 'Run out of bricks within a block of the line', 'bronze', 'flag', { secret: true }),
  A('secret', 'do_over', 'Do-Over', 'Undo a shape, then place it again as a Perfect', 'bronze', 'undo', { secret: true }),
  A('secret', 'needle', 'Needle Threader', 'Claim a checkpoint with a tower so thin it gets the smallest foundation', 'bronze', 'needle', { secret: true }),
];

export const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

/** The ones Zen still moves (§18.1): lifetime counts, not run feats. */
const LIFETIME_IDS = new Set(['toolbox', 'bubbles_50', 'bricks_1k', 'bricks_10k', 'perfects_250', 'rows_100', 'cps_100', 'streak_3', 'streak_7']);

/** The five powers, for Toolbox. */
export const POWER_KINDS = ['clean', 'quickset', 'undo', 'glue', 'slowmo'];

/** Biomes whose "get through without losing a heart" is an achievement (§18.2). */
const CALM_BIOMES = [2, 4, 6, 7];

export interface AchievementState { at: string; paid: boolean }
export interface AchievementCounts { bubbles: number; powers: string[] }

export const freshCounts = (): AchievementCounts => ({ bubbles: 0, powers: [] });

function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Marks one earned (not yet paid). False if it already was. The caller saves the profile. */
export function unlock(p: Profile, id: string, now = new Date()): boolean {
  if (!BY_ID.has(id) || p.achievements[id]) return false;
  p.achievements[id] = { at: day(now), paid: false };
  return true;
}

export const earnedCount = (p: Profile): number => ACHIEVEMENTS.filter(a => p.achievements[a.id]).length;

/** Lifetime totals as they stand (the stats plus `live`, the run so far, when given). */
export function lifetime(p: Profile, live?: { bricks: number; perfects: number; rows: number; checkpoints: number }) {
  const s = p.stats;
  return {
    bricks: s.bricks + (live?.bricks ?? 0), perfects: s.perfects + (live?.perfects ?? 0), rows: s.rows + (live?.rows ?? 0),
    checkpoints: s.checkpoints + (live?.checkpoints ?? 0), bubbles: p.achCounts.bubbles, powers: p.achCounts.powers.length, streak: p.streak,
  };
}

/** Progress toward a counted one, as [have, goal] (have capped at goal), or null. */
export function progress(p: Profile, a: Achievement): [number, number] | null {
  if (!a.goal) return null;
  const l = lifetime(p);
  const have: Record<string, number> = {
    toolbox: l.powers, bubbles_50: l.bubbles, bricks_1k: l.bricks, bricks_10k: l.bricks, perfects_250: l.perfects,
    rows_100: l.rows, cps_100: l.checkpoints, streak_3: l.streak, streak_7: l.streak,
  };
  return [Math.min(a.goal, have[a.id] ?? 0), a.goal];
}

/** The counted ones a set of totals has reached. */
function countedIds(l: ReturnType<typeof lifetime>): string[] {
  const out: string[] = [];
  if (l.bricks >= 1000) out.push('bricks_1k');
  if (l.bricks >= 10000) out.push('bricks_10k');
  if (l.perfects >= 250) out.push('perfects_250');
  if (l.rows >= 100) out.push('rows_100');
  if (l.checkpoints >= 100) out.push('cps_100');
  if (l.bubbles >= 50) out.push('bubbles_50');
  if (l.powers >= POWER_KINDS.length) out.push('toolbox');
  if (l.streak >= 3) out.push('streak_3');
  if (l.streak >= 7) out.push('streak_7');
  return out;
}

/**
 * What a profile's history already proves (§18.3: players who played before achievements). Returns the
 * ids newly earned; they are paid in the next run's tally. The caller saves the profile.
 */
export function grantHistory(p: Profile, now = new Date()): string[] {
  const s = p.stats;
  const ids: string[] = [];
  if (s.checkpoints >= 1) ids.push('cp_first');
  for (let b = 2; b <= Math.min(10, s.bestBiome); b++) ids.push(`biome_${b}`);
  if (s.perfects >= 1) ids.push('perfect');
  if (s.rows >= 1) ids.push('row');
  if (s.clutches >= 1) ids.push('clutch');
  ids.push(...countedIds(lifetime(p)));
  return ids.filter(id => unlock(p, id, now));
}

/** Streaks are counted when a run's XP is (view/profile.ts updateStreak), so they are checked after it. */
export function grantStreaks(p: Profile, now = new Date()): string[] {
  return ['streak_3', 'streak_7'].filter(id => p.streak >= BY_ID.get(id)!.goal! && unlock(p, id, now));
}

/**
 * The XP for earned achievements not paid yet, as tally lines, and marks them paid. Up to three get a
 * line each; past three the rest share one line. Flat: no boosts, no quit halving (§18.1).
 */
export function payAchievements(p: Profile): { lines: [string, string][]; xp: number; ids: string[] } {
  const due = ACHIEVEMENTS.filter(a => p.achievements[a.id] && !p.achievements[a.id].paid);
  const lines: [string, string][] = [];
  let xp = 0;
  due.forEach((a, i) => {
    const n = TIER_XP[a.tier];
    xp += n;
    p.achievements[a.id].paid = true;
    if (i < 3) lines.push([`🏆 ${a.name}`, `+${n}`]);
  });
  if (due.length > 3) {
    const rest = due.slice(3).reduce((t, a) => t + TIER_XP[a.tier], 0);
    lines.push([`🏆 ${due.length - 3} more`, `+${rest}`]);
  }
  return { lines, xp, ids: due.map(a => a.id) };
}

export interface TrackerOptions {
  /** The best height before this run, in blocks above the plinth (0: none yet). */
  bestBefore: number;
  /** Called once per achievement, the moment it is earned (already saved by then). */
  onUnlock(a: Achievement): void;
  save(): void;
  now?(): Date;
}

/**
 * One run's tracker. Feed it every sim event in order (the shell's onEvent). It reads the sim's public
 * state (stats, foundations, tuning) and never changes it.
 */
export class RunTracker {
  /** Earned during this run, in order. */
  readonly earned: Achievement[] = [];
  private readonly base: { bricks: number; perfects: number; rows: number; checkpoints: number };
  private readonly zen: boolean;
  private hearts: number;
  private prev = '';                 // the previous event's name
  private restoredFrom = -1;         // hearts just before the latest heart_restored
  private stretch = 1;               // the checkpoint being climbed to
  private claims = 0;
  private lostTotal = 0;
  private lostIn = new Set<number>(); // stretches where a heart was lost
  private sStreak = 0;
  private clutches = 0;
  private windAt: number | null = null; // claims when Second Wind was used
  private helped = false;            // used a power-up or Second Wind
  private nearest = Infinity;        // closest this stretch came to its line, in blocks (0: a hold started)
  private undoShape: string | null = null;
  private undoId: number | null = null;
  private tumble = { start: -Infinity, last: -Infinity, n: 0 };
  private over = false;

  readonly sim: Sim;
  private p: Profile;
  private o: TrackerOptions;

  // No parameter properties: the sim's headless checks run under Node's type stripping.
  constructor(sim: Sim, p: Profile, o: TrackerOptions) {
    this.sim = sim;
    this.p = p;
    this.o = o;
    const s = p.stats;
    this.base = { bricks: s.bricks, perfects: s.perfects, rows: s.rows, checkpoints: s.checkpoints };
    this.zen = sim.tuning.infiniteBudget || sim.tuning.infiniteHearts;
    this.hearts = sim.hearts;
  }

  private give(id: string): void {
    if (this.zen && !LIFETIME_IDS.has(id)) return;
    if (!unlock(this.p, id, this.o.now?.())) return;
    this.o.save();
    const a = BY_ID.get(id)!;
    this.earned.push(a);
    this.o.onUnlock(a);
  }

  /** Lifetime totals tipping over mid-run: the stats from before the run plus the run so far. */
  private counted(): void {
    const st = this.sim.stats, b = this.base;
    const l = { ...lifetime(this.p), bricks: b.bricks + st.placed, perfects: b.perfects + st.perfects, rows: b.rows + st.rows, checkpoints: b.checkpoints + st.checkpoints };
    for (const id of countedIds(l)) if (!id.startsWith('streak_')) this.give(id); // streaks count with the run's XP
  }

  private height(): number { return this.sim.stats.maxHeight - this.sim.foundations[0].top; }

  handle(e: BusEvent): void {
    if (this.over) return; // pieces still tumbling after the run don't count
    const p = e.payload as Record<string, unknown>;
    const steps = (s: number) => Math.round(s * 60); // the sim's fixed 60 Hz step
    switch (e.name) {
      case 'biome_entered': {
        const id = Number(p.id);
        if (id >= 2) this.give(`biome_${id}`);
        if (id === 3 && this.lostTotal === 0) this.give('flawless_3');
        if (id === 6 && this.lostTotal === 0) this.give('flawless_6');
        if (id === 4 && !this.helped) this.give('purist');
        break;
      }
      case 'checkpoint_claimed': {
        const n = Number(p.n), grade = String(p.grade), leftover = Number(p.leftover);
        const heartsBefore = this.prev === 'heart_restored' ? this.restoredFrom : this.hearts;
        this.claims++;
        this.give('cp_first');
        if (n >= 30) this.give('cp_30');
        if (grade === 'S') { this.give('grade_s'); if (++this.sStreak >= 3) this.give('grade_s3'); } else this.sStreak = 0;
        if (!this.sim.tuning.infiniteBudget) {
          if ((grade === 'S' || grade === 'A') && leftover >= 8) this.give('thrifty');
          if (leftover === 0) this.give('last_brick');
        }
        if (Number(p.width) <= this.sim.tuning.minSlabWidth && grade === 'C') this.give('needle');
        if (heartsBefore === 1) this.give('last_heart');
        const b = biomeFor(n);
        if (n === b.lastCp && CALM_BIOMES.includes(b.id)) {
          let calm = true;
          for (let k = b.firstCp; k <= b.lastCp; k++) if (this.lostIn.has(k)) calm = false;
          if (calm) this.give(`calm_${b.id}`);
        }
        if (this.windAt !== null && this.claims - this.windAt >= 3) this.give('comeback');
        this.stretch = n + 1;
        this.nearest = Infinity;
        this.counted();
        break;
      }
      case 'heart_lost':
        this.lostTotal++;
        this.lostIn.add(this.stretch);
        this.hearts = Number(p.left);
        break;
      case 'heart_restored':
        this.restoredFrom = this.hearts;
        this.hearts = Number(p.left);
        break;
      case 'second_wind':
        this.windAt = this.claims;
        this.helped = true;
        break;
      case 'perfect': {
        const combo = Number(p.combo);
        this.give('perfect');
        if (combo >= 5) this.give('combo_5');
        if (combo >= 7) this.give('combo_7');
        this.counted();
        break;
      }
      case 'row_solid': {
        const count = Number(p.count);
        if (count >= 1) this.give('row');
        if (count >= 2) this.give('row_2');
        if (count >= 3) this.give('row_3');
        this.counted();
        break;
      }
      case 'clutch':
        this.give('clutch');
        if (++this.clutches >= 3) this.give('clutch_3');
        break;
      case 'piece_landed':
        if (this.undoShape !== null && p.shape === this.undoShape) { this.undoId = Number(p.id); this.undoShape = null; }
        this.counted();
        break;
      case 'piece_settled':
        if (this.undoId !== null && Number(p.id) === this.undoId) {
          if (p.grade === 'perfect') this.give('do_over');
          this.undoId = null;
        }
        if (this.o.bestBefore > 0 && this.height() > this.o.bestBefore + 0.05) this.give('pb');
        break;
      case 'piece_lost': {
        const t = this.tumble, tu = this.sim.tuning;
        if (e.step - t.last <= steps(tu.cascadeWindow) && e.step - t.start <= steps(tu.cascadeCap)) t.n++;
        else { t.start = e.step; t.n = 1; }
        t.last = e.step;
        if (t.n >= 5) this.give('avalanche');
        break;
      }
      case 'power_collected':
        this.p.achCounts.bubbles++;
        this.give('bubble');
        this.counted();
        break;
      case 'power_used': {
        const kind = String(p.kind);
        this.helped = true;
        if (POWER_KINDS.includes(kind) && !this.p.achCounts.powers.includes(kind)) { this.p.achCounts.powers.push(kind); this.o.save(); }
        if (kind === 'undo') { this.undoShape = String(p.shape); this.undoId = null; }
        this.counted();
        break;
      }
      case 'checkpoint_near':
        this.nearest = Math.min(this.nearest, Number(p.blocks));
        break;
      case 'checkpoint_hold':
        this.nearest = 0;
        break;
      case 'run_over':
        this.over = true;
        if (p.cause === 'bricks' && this.nearest <= 1) this.give('so_close');
        if (this.o.bestBefore > 0 && this.height() > this.o.bestBefore + 0.05) this.give('pb');
        break;
    }
    this.prev = e.name;
  }
}
