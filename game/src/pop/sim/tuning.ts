// Blockling Pop's levers (Pop plan §15, §16): one place for every number QA tunes, as the tower's
// tuning.ts is. A change here changes how runs deal and score, so bump POP_RULES with it: saved runs
// and run records carry the rules they were played under and only replay under the same ones.

/**
 * The rules version a run record is played under. Bump it whenever a change below alters a replay.
 * 1: milestone 1's core. 2: power bubbles, the five powers, Second Wind and the retuned deal (milestone 3).
 */
export const POP_RULES = 2;
/** Rules versions that still replay (a run saved under an older version resumes under its own rules). */
export const POP_RULES_KNOWN: readonly number[] = [1, 2];

export interface WeightRow {
  keys: string[];
  /** Checkpoints claimed before the shapes open (0 = from the start). */
  open: number;
  /** Weight when they open. */
  from: number;
  /** Weight once `by` checkpoints are claimed (linear in between). */
  to: number;
  by: number;
}

export interface PopTuning {
  /** Lines popped per checkpoint. */
  linesPerCp: number;
  /** Placements that pop nothing a combo survives (the third ends it). */
  sparks: number;
  /** Points for popping L lines in one placement, L = 1..4; 5 or more pay five + extra per line over 5. */
  linePoints: number[];
  fivePlus: number;
  extraLine: number;
  allClear: number;
  /** The combo multiplier: 1 + step × (combo − 1), up to max. */
  comboStep: number;
  comboMax: number;
  /** Deal rule 2 (whole trays that fit): a player's first mercyRuns Pop runs, and the first mercyCps checkpoints of every Endless run. */
  mercyRuns: number;
  mercyCps: number;
  /** Redraws before a deal falls back to rule 1 (something fits). */
  redraws: number;
  /** Nodes the whole-tray search may visit before it calls a tray fair. */
  searchBudget: number;
  /** Rule 3, the line-maker nudge: the share of trays with a shape that completes a line, from nudgeFrom CPs down to nudgeTo. */
  nudgeStart: number;
  nudgeEnd: number;
  nudgeFrom: number;
  nudgeTo: number;
  /** Rule 3's line-maker keeps to rule 6's size budget too (rules 2; rules 1 deals didn't check). */
  nudgeBudget: boolean;
  /** Rule 4, rescue: at this board fill or more, one small shape half the time. */
  rescueFill: number;
  rescueChance: number;
  /** Rule 5, variety: pairs open at pairCp; no shape more than repeatMax times in any repeatWindow dealt in a row. */
  pairCp: number;
  repeatMax: number;
  repeatWindow: number;
  /** Rule 6, size budget: cells per tray, more allowed from lateCp; 5-cell shapes per tray, two from fiveLateCp. */
  trayMin: number;
  trayMax: number;
  trayMaxLate: number;
  lateCp: number;
  fiveLateCp: number;
  /** Shape weights by checkpoint (Pop plan §4). */
  weights: WeightRow[];
  /** XP per run: per line, checkpoint, placement and All Clear (Pop plan §12). */
  xpLine: number;
  xpCp: number;
  xpPlace: number;
  xpClear: number;
  /** Power bubbles (Pop plan §7): placements between bubbles (gap ± spread, while a slot is free), and how many placements one lasts. */
  bubbleGap: number;
  bubbleSpread: number;
  bubbleLife: number;
  /** A checkpoint drops a bubble every this many checkpoints (1: every one). */
  bubbleCps: number;
  /** Lines popped by one placement that put a power straight into a free slot (a Triple), as an All Clear does. */
  grantLines: number;
  /** Board fill from which Meteor and Sweep are likelier picks. */
  powerFull: number;
  /** The checkpoint that earns Second Wind (or a power, when it's already ready, used or off). */
  windCp: number;
}

/** Milestone 1's numbers (rules 1), kept so runs saved under them replay exactly. */
export const POP_TUNING_V1: PopTuning = {
  linesPerCp: 8,
  sparks: 2,
  linePoints: [0, 100, 250, 450, 700],
  fivePlus: 1000,
  extraLine: 300,
  allClear: 3000,
  comboStep: 0.25,
  comboMax: 4,
  mercyRuns: 3,
  mercyCps: 2,
  redraws: 20,
  searchBudget: 4000,
  nudgeStart: 0.25,
  nudgeEnd: 0.1,
  nudgeFrom: 5,
  nudgeTo: 12,
  nudgeBudget: false,
  rescueFill: 0.6,
  rescueChance: 0.5,
  pairCp: 6,
  repeatMax: 3,
  repeatWindow: 9,
  trayMin: 6,
  trayMax: 12,
  trayMaxLate: 14,
  lateCp: 10,
  fiveLateCp: 8,
  weights: [
    { keys: ['Pip'], open: 0, from: 1.5, to: 0.75, by: 10 },
    { keys: ['Domino'], open: 0, from: 2, to: 1.25, by: 10 },
    { keys: ['Trio', 'Elbow'], open: 0, from: 2, to: 1.5, by: 10 },
    { keys: ['O', 'I', 'L', 'J', 'T'], open: 0, from: 2, to: 2, by: 10 },
    { keys: ['S', 'Z'], open: 2, from: 1, to: 1.5, by: 6 },
    { keys: ['Plank'], open: 4, from: 1, to: 1.5, by: 8 },
    { keys: ['P', 'U', 'V'], open: 6, from: 0.75, to: 1.25, by: 9 },
    { keys: ['Arch', 'Plus'], open: 10, from: 0.5, to: 1, by: 13 },
  ],
  xpLine: 6,
  xpCp: 40,
  xpPlace: 1,
  xpClear: 100,
  bubbleGap: 10,
  bubbleSpread: 2,
  bubbleLife: 6,
  bubbleCps: 1,
  grantLines: 3,
  powerFull: 0.6,
  windCp: 2,
};

/**
 * The numbers runs play under now (rules 2). Milestone 3's balance pass (QA's bots, pop-tune.ts): the
 * greedy bot's runs were twice the plan's 120-180 placements, and Second Wind and powers made them
 * longer again, so bigger shapes open sooner, small ones thin out, trays carry more cells, and
 * bubbles come about every 24 placements and every second checkpoint. Greedy bot: median about 143
 * placements; with powers and Second Wind, about 350 (Second Wind alone about 240).
 */
export const POP_TUNING: PopTuning = {
  ...POP_TUNING_V1,
  nudgeBudget: true,
  trayMin: 7,
  trayMax: 13,
  trayMaxLate: 15,
  lateCp: 4,
  fiveLateCp: 3,
  weights: [
    { keys: ['Pip'], open: 0, from: 0.5, to: 0.2, by: 6 },
    { keys: ['Domino'], open: 0, from: 1, to: 0.5, by: 6 },
    { keys: ['Trio', 'Elbow'], open: 0, from: 1.4, to: 0.9, by: 6 },
    { keys: ['O', 'I', 'L', 'J', 'T'], open: 0, from: 2, to: 2, by: 6 },
    { keys: ['S', 'Z'], open: 1, from: 1.4, to: 1.9, by: 4 },
    { keys: ['Plank'], open: 1, from: 1.2, to: 1.8, by: 5 },
    { keys: ['P', 'U', 'V'], open: 2, from: 1.1, to: 1.7, by: 6 },
    { keys: ['Arch', 'Plus'], open: 3, from: 1, to: 1.6, by: 7 },
  ],
  bubbleGap: 24,
  bubbleSpread: 4,
  bubbleLife: 5,
  bubbleCps: 2,
  grantLines: 4,
};

/** The tuning a rules version plays under. */
export const tuningFor = (rules: number): PopTuning => (rules === 1 ? POP_TUNING_V1 : POP_TUNING);

/** A shape's deal weight with `cp` checkpoints claimed (0 while it is still closed). */
export function shapeWeight(t: PopTuning, key: string, cp: number): number {
  const row = t.weights.find(r => r.keys.includes(key));
  if (!row || cp < row.open) return 0;
  const k = row.by > row.open ? Math.min(1, (cp - row.open) / (row.by - row.open)) : 1;
  return row.from + (row.to - row.from) * k;
}

/** Points for popping `lines` lines in one placement, before the combo. */
export function linePoints(t: PopTuning, lines: number): number {
  if (lines <= 0) return 0;
  if (lines < 5) return t.linePoints[lines];
  return t.fivePlus + t.extraLine * (lines - 5);
}

/** The combo multiplier at combo n (×1 at 1, ×1.5 at 3, ×2 at 5, ×4 from 13). */
export function comboMult(t: PopTuning, n: number): number {
  return Math.min(t.comboMax, 1 + t.comboStep * Math.max(0, n - 1));
}
