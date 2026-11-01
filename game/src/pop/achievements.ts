// Blockling Pop's achievements (Pop plan §12): one run's tracker, fed the Pop sim's events after each
// intent. It reads the sim's public state and never changes it, so seeds, replays and digests stay as
// they were. The list itself is the 'pop' group in meta/achievements.ts, beside the tower's.

import { BY_ID, unlock, type Achievement } from '../meta/achievements.ts';
import type { Profile } from '../view/profile.ts';
import type { PopEvent, PopSim } from './sim/pop.ts';

/** Biome indexes in the Pop sim count from 0 (Meadow): the Moon is 6 (104 lines), Deep Cosmos 9 (176). */
const MOON = 6, COSMOS = 9;

export interface PopTrackerOptions {
  /** Called once per achievement, the moment it is earned (already saved by then). */
  onUnlock(a: Achievement): void;
  save(): void;
  now?(): Date;
}

export class PopTracker {
  /** Earned during this run, in order. */
  readonly earned: Achievement[] = [];
  readonly sim: PopSim;
  private readonly p: Profile;
  private readonly o: PopTrackerOptions;
  /** Lifetime totals from before this run (the run's own are the sim's). */
  private readonly base: { lines: number; clears: number };
  private helped = false;   // a power-up or Second Wind was used (Bare Hands)
  private bagSave = false;  // this placement is the bag saving the run
  private over = false;

  // No parameter properties: the Node checks run under type stripping.
  constructor(sim: PopSim, p: Profile, o: PopTrackerOptions) {
    this.sim = sim;
    this.p = p;
    this.o = o;
    this.base = { lines: p.pop.totalLines, clears: p.pop.clears };
    // A run continued from its save: what it already did still counts as help.
    this.helped = sim.powersUsed > 0 || sim.wind === 'used';
  }

  private give(id: string): void {
    if (!unlock(this.p, id, this.o.now?.())) return;
    this.o.save();
    const a = BY_ID.get(id)!;
    this.earned.push(a);
    this.o.onUnlock(a);
  }

  /** One intent's events, in order (sim.events after each apply). */
  handle(events: readonly PopEvent[]): void {
    const sim = this.sim, endless = sim.mode === 'endless';
    for (const e of events) {
      if (this.over) break; // blocks still tumbling after the run don't count
      const p = e.payload;
      switch (e.name) {
        case 'pop_placed':
          this.bagSave = !!p.bagSave;
          break;
        case 'pop_lines': {
          const count = Number(p.count), combo = Number(p.combo);
          this.give('pop_first');
          if (count >= 2) this.give('pop_double');
          if (count >= 3) this.give('pop_triple');
          if (count >= 4) this.give('pop_quad');
          if (combo >= 8) this.give('pop_combo_8');
          if (combo >= 15) this.give('pop_combo_15');
          if (this.bagSave) this.give('pop_bag');
          break;
        }
        case 'pop_all_clear':
          this.give('pop_clear');
          break;
        case 'pop_power':
        case 'pop_second_wind':
          this.helped = true;
          break;
        case 'pop_score':
          if (endless && sim.score >= 10000) this.give('pop_10k');
          if (endless && sim.score >= 20000 && !this.helped) this.give('pop_bare');
          break;
        case 'biome_entered':
          if (endless && Number(p.id) >= MOON) this.give('pop_moon');
          if (endless && Number(p.id) >= COSMOS) this.give('pop_cosmos');
          break;
        case 'run_over':
          this.over = true;
          break;
      }
    }
    // Lifetime counts tipping over mid-run: the totals from before the run plus the run so far.
    if (this.base.lines + sim.lines >= BY_ID.get('pop_lines_1k')!.goal!) this.give('pop_lines_1k');
    if (this.base.clears + sim.clears >= BY_ID.get('pop_clears_10')!.goal!) this.give('pop_clears_10');
  }
}
