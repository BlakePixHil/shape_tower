// Tuning values from gameplay.md §14. Everything the lab's sliders touch lives here.
// Units: blocks (1 block = 1 m), seconds, g = gravity multiples of `gravity`.

export interface Tuning {
  // World
  gravity: number;            // m/s² at 1.0 g
  subSteps: number;
  pushoutVelocity: number;    // m/s, how fast overlaps are resolved
  // Bodies
  friction: number;
  foundationFriction: number;
  angularDamping: number;
  linearDamping: number;
  inset: number;              // per side, blocks
  cornerRadius: number;       // blocks, shared with Art
  density: number;
  // Settling
  settleSpeed: number;        // m/s
  settleSpin: number;         // rad/s
  settleTime: number;         // s
  // Landing assists
  impactCap: number;          // m/s downward at first contact
  squareUp: boolean;
  squareUpWindow: number;     // s
  squareUpSin: number;        // sin of the max angle (8° ≈ 0.139)
  squareUpGain: number;       // 1/s
  // Mortar
  mortar: boolean;
  mortarStrength: number;     // multiplier on break thresholds (start of run)
  mortarFloor: number;
  mortarDecay: number;        // per checkpoint
  bondDelay: number;          // s at rest before bonding (start of run)
  bondDelayGrowth: number;    // per checkpoint
  bondDelayCap: number;
  breakForce: number;         // × lighter body's weight × strength
  breakTorque: number;        // × weight × 1 block × strength
  bondHertz: number;          // weld softness
  bondDamping: number;
  maxBonds: number;
  // Controls
  sensitivity: number;
  snapStep: number;
  snapHysteresis: number;
  softDropMult: number;
  hardDropSpeed: number;      // blocks/s
  touchGrace: number;         // s: a shape steered this recently stays steerable when it touches down
  touchGraceMax: number;      // s: the longest it can stay touching before it lands
  stepUp: number;             // blocks: a sideways step may lift the shape this much to clear a lip
  // Pace
  spawnHeight: number;        // blocks above the tower top
  spawnDelay: number;         // s after landing
  fallBase: number;
  fallPerCheckpoint: number;
  fallCap: number;
  // Checkpoints and budget
  firstGap: number;
  gapGrowth: number;
  gapCap: number;
  holdTime: number;
  holdHover: boolean;         // the shape in hand waits during a hold and the claim's slab drop
  claimClearance: number;     // blocks: room kept between the new slab and the shape in hand
  minSlabWidth: number;
  slabThickness: number;
  slackStart: number;
  slackDecay: number;
  slackFloor: number;
  budgetGrace: number;        // s
  rookieBricks: number;
  holdUnlocked: boolean;      // the Hold slot opens at level 2 (gameplay.md §10.3)
  startPower: boolean;        // level 6 perk: the run starts with a random power-up in a slot
  // Hearts
  hearts: number;
  cascadeWindow: number;
  cascadeCap: number;
  // Rows and grades
  rowCoverage: number;
  setStreak: number;          // Clean or Perfect placements in a row before full rows turn to stone, from CP 7 (one fewer from CP 3; 0: at once)
  // Brittle shapes (gameplay.md §4.3)
  brittleEvery: number;       // about one shape in this many is brittle (0: none)
  brittleFrom: number;        // the first checkpoint stretch that deals them
  brittleLoad: number;        // cells resting on a brittle shape that break it
  brittleFuse: number;        // s it creaks under that load before it breaks
  // Power-ups (gameplay.md §13)
  powerUps: boolean;
  bubbleGap: number;          // shapes between power bubbles, on average
  bubbleLife: number;         // shapes a bubble waits before it fades
  bubbleRadius: number;       // blocks
  glueShapes: number;
  glueStrength: number;       // × break thresholds for glued bonds
  slowShapes: number;
  slowFactor: number;         // × fall speed
  // Hazards (gameplay.md §8.2, §8.3)
  gusts: boolean;             // sideways pushes on the tower, Treetops to the Stratosphere
  gustScale: number;          // × every gust's strength (lab)
  hazardIntro: boolean;       // the run's first gust is a first-ever one: half strength, with a card
  lateHazards: boolean;       // crosswind, space junk, meteors, dust devils, tidal sway (Storm Belt on)
  hazardStrength: number;     // × every late hazard's strength (lab)
  seenHazards: string[];      // late hazards this player has met; the first of any other is half strength, with a card
  junkImpulse: number;        // kg·m/s a piece of space junk hits with
  meteorImpulse: number;      // kg·m/s per meteor
  heartsEveryFrom: number;    // from this checkpoint on, a heart comes back only every third claim (0: every claim, all the way up)
  // Debug
  wind: number;               // constant sideways push in g, lab only
  infiniteBudget: boolean;
  infiniteHearts: boolean;
}

export const DEFAULT_TUNING: Tuning = {
  gravity: 20,
  subSteps: 6,
  pushoutVelocity: 1,
  friction: 0.9,
  foundationFriction: 1.0,
  angularDamping: 0.8,
  linearDamping: 0.1,
  inset: 0.02,
  cornerRadius: 0.05,
  density: 1,
  settleSpeed: 0.05,
  settleSpin: 0.0524, // 3°/s
  settleTime: 0.4,
  impactCap: 2.5,
  squareUp: true,
  squareUpWindow: 0.6,
  squareUpSin: 0.139,
  squareUpGain: 6,
  mortar: true,
  mortarStrength: 1.0,
  mortarFloor: 0.4,
  mortarDecay: 0.03,
  bondDelay: 0.5,
  bondDelayGrowth: 0.06,
  bondDelayCap: 2.0,
  breakForce: 6,
  breakTorque: 3.5,
  bondHertz: 8,
  bondDamping: 1,
  maxBonds: 4,
  sensitivity: 1.0,
  snapStep: 0.5,
  snapHysteresis: 0.15,
  softDropMult: 3,
  hardDropSpeed: 40,
  touchGrace: 0.12,
  touchGraceMax: 0.35,
  stepUp: 0.15,
  spawnHeight: 7,
  spawnDelay: 0.3,
  fallBase: 1.5,
  fallPerCheckpoint: 0.12,
  fallCap: 4.5,
  firstGap: 8,
  gapGrowth: 1,
  gapCap: 16,
  holdTime: 2.0,
  holdHover: true,
  claimClearance: 2.5,
  minSlabWidth: 3,
  slabThickness: 0.5,
  slackStart: 1.6,
  slackDecay: 0.04,
  slackFloor: 1.15,
  budgetGrace: 3,
  rookieBricks: 0,
  holdUnlocked: true,
  startPower: false,
  hearts: 3,
  cascadeWindow: 1.5,
  cascadeCap: 6,
  rowCoverage: 0.9,
  setStreak: 4,
  brittleEvery: 12,
  brittleFrom: 5,
  brittleLoad: 12,
  brittleFuse: 1.2,
  powerUps: true,
  bubbleGap: 6,
  bubbleLife: 3,
  bubbleRadius: 0.6,
  glueShapes: 3,
  glueStrength: 2,
  slowShapes: 3,
  slowFactor: 0.5,
  gusts: true,
  gustScale: 1,
  hazardIntro: true,
  lateHazards: true,
  hazardStrength: 1,
  seenHazards: [],
  junkImpulse: 8,
  meteorImpulse: 7,
  heartsEveryFrom: 11,
  wind: 0,
  infiniteBudget: false,
  infiniteHearts: false,
};

// ---- Difficulty per checkpoint number n (the stretch leading to checkpoint n), §8.1 ----

/**
 * Gusts at checkpoint n (gameplay.md §8.2): strength in g and the average gap between gusts in
 * seconds. Introduced in Treetops (3-4), ramping in Cloudlands (5-6), steady through the Storm
 * Belt and up to 0.15 g in the Stratosphere. None from Orbit on (no wind in space).
 */
export function gustFor(n: number): { strength: number; interval: number } | null {
  const table: Record<number, [number, number]> = {
    3: [0.05, 18], 4: [0.08, 15], 5: [0.09, 14], 6: [0.12, 12], 7: [0.12, 12], 8: [0.12, 12], 9: [0.135, 12], 10: [0.15, 12],
  };
  const row = table[n];
  return row ? { strength: row[0], interval: row[1] } : null;
}

/** The hazards that come after gusts (gameplay.md §8.2), Storm Belt to Deep Cosmos. */
export type LateHazard = 'crosswind' | 'junk' | 'meteor' | 'dust' | 'sway';
export type HazardKind = 'gust' | LateHazard;

/** Everything that pushes the tower in stretch n. Zero or null: that hazard is off. */
export interface StretchHazards {
  gust: { strength: number; interval: number } | null;
  /** Steady push in g, flipping side every checkpoint. */
  crosswind: number;
  /** Average seconds between pieces of space junk. */
  junk: number;
  /** Average seconds between meteor showers (2 to 4 meteors each). */
  meteor: number;
  dust: { strength: number; interval: number } | null;
  /** Gravity tilting side to side: peak sideways pull in g, and seconds per full swing. */
  sway: { amplitude: number; period: number } | null;
  /** × fall speed of the steered shape. */
  fallMult: number;
  /** Deep Cosmos: the two earlier hazards this stretch remixes. */
  remix: HazardKind[];
}

const CROSSWIND: Record<number, number> = { 7: 0.04, 8: 0.06, 9: 0.08, 10: 0.1 };
const JUNK: Record<number, number> = { 11: 18, 12: 15, 13: 12 };
const METEOR: Record<number, number> = { 14: 22, 15: 18, 16: 15 };
const DUST: Record<number, [number, number]> = { 17: [0.15, 16], 18: [0.2, 14], 19: [0.25, 12] };
const SWAY: Record<number, number> = { 20: 0.08, 21: 0.11, 22: 0.14 };

/** Deep Cosmos gets 5% harder every checkpoint, up to twice its starting intensity. */
export function cosmosScale(n: number): number { return Math.max(1, Math.min(2, 1 + 0.05 * (n - 22))); }

/** The pool Deep Cosmos remixes from, two at a time. */
export const REMIX_POOL: HazardKind[] = ['gust', 'crosswind', 'junk', 'meteor', 'dust', 'sway'];

/**
 * The hazards of stretch n (gameplay.md §8.2). `remix` is Deep Cosmos's pick of two from REMIX_POOL
 * (the sim draws it); there every hazard runs at its top intensity × cosmosScale(n), intervals
 * shortened by the same factor, and gravity drifts ±6° on a slow swing unless tidal sway is in.
 */
export function hazardsFor(n: number, remix: HazardKind[] = []): StretchHazards {
  const out: StretchHazards = {
    gust: gustFor(n), crosswind: CROSSWIND[n] ?? 0, junk: JUNK[n] ?? 0, meteor: METEOR[n] ?? 0,
    dust: DUST[n] ? { strength: DUST[n][0], interval: DUST[n][1] } : null,
    sway: SWAY[n] ? { amplitude: SWAY[n], period: 8 } : null,
    fallMult: n >= 20 && n <= 22 ? 1.15 : 1, remix: [],
  };
  if (n < 23) return out;
  const k = cosmosScale(n), has = (h: HazardKind) => remix.includes(h);
  out.remix = [...remix];
  out.gust = has('gust') ? { strength: 0.15 * k, interval: Math.max(6, 12 / k) } : null;
  out.crosswind = has('crosswind') ? 0.1 * k : 0;
  out.junk = has('junk') ? Math.max(7, 12 / k) : 0;
  out.meteor = has('meteor') ? Math.max(9, 15 / k) : 0;
  out.dust = has('dust') ? { strength: 0.25 * k, interval: Math.max(7, 12 / k) } : null;
  out.sway = has('sway') ? { amplitude: 0.14 * k, period: 8 } : { amplitude: 0.1, period: 24 };
  return out;
}

export function gapFor(t: Tuning, n: number): number {
  return Math.min(t.firstGap + t.gapGrowth * (n - 1), t.gapCap);
}

export function maxSlabWidthFor(n: number): number {
  if (n <= 4) return 8;
  if (n <= 10) return 7;
  if (n <= 19) return 6;
  return 5;
}

export function fallSpeedFor(t: Tuning, n: number): number {
  return Math.min(t.fallBase + t.fallPerCheckpoint * (n - 1), t.fallCap);
}

export function slackFor(t: Tuning, n: number): number {
  return Math.max(t.slackStart - t.slackDecay * (n - 1), t.slackFloor);
}

/**
 * Clean or Perfect placements in a row it takes before full rows turn to stone (gameplay.md §9.1):
 * none in the Meadow, so a first run still learns Solid Rows; one fewer than `setStreak` from CP 3.
 */
export function setStreakFor(t: Tuning, n: number): number {
  if (t.setStreak <= 0 || n <= 2) return 0;
  return n <= 6 ? Math.max(1, t.setStreak - 1) : t.setStreak;
}

export function budgetFor(t: Tuning, n: number, foundationWidth: number): number {
  const gap = gapFor(t, n);
  return Math.ceil(0.85 * foundationWidth * gap / 4 * slackFor(t, n)) + 2 + t.rookieBricks;
}

export function mortarStrengthFor(t: Tuning, n: number): number {
  return Math.max(t.mortarStrength - t.mortarDecay * (n - 1), t.mortarFloor);
}

export function bondDelayFor(t: Tuning, n: number): number {
  return Math.min(t.bondDelay + t.bondDelayGrowth * (n - 1), t.bondDelayCap);
}

// ---- Biomes (shared 10-biome list, gameplay.md §8.2). Index is 1..10. ----

export interface Biome { id: number; name: string; firstCp: number; lastCp: number; gravity: number }

export const BIOMES: Biome[] = [
  { id: 1, name: 'Meadow', firstCp: 1, lastCp: 2, gravity: 1.0 },
  { id: 2, name: 'Treetops', firstCp: 3, lastCp: 4, gravity: 1.0 },
  { id: 3, name: 'Cloudlands', firstCp: 5, lastCp: 6, gravity: 1.0 },
  { id: 4, name: 'Storm Belt', firstCp: 7, lastCp: 8, gravity: 1.0 },
  { id: 5, name: 'Stratosphere', firstCp: 9, lastCp: 10, gravity: 0.9 },
  { id: 6, name: 'Orbit', firstCp: 11, lastCp: 13, gravity: 0.5 },
  { id: 7, name: 'Moon', firstCp: 14, lastCp: 16, gravity: 0.35 },
  { id: 8, name: 'Red Planet', firstCp: 17, lastCp: 19, gravity: 0.6 },
  { id: 9, name: 'Ringed Giant', firstCp: 20, lastCp: 22, gravity: 1.4 },
  { id: 10, name: 'Deep Cosmos', firstCp: 23, lastCp: Infinity, gravity: 0.8 },
];

export function biomeFor(n: number): Biome {
  for (const b of BIOMES) if (n >= b.firstCp && n <= b.lastCp) return b;
  return BIOMES[BIOMES.length - 1];
}

// ---- Scoring and XP (gameplay.md §9, §10) ----

export const GRADE_FACTOR = { S: 1.5, A: 1.2, B: 1.0, C: 0.5 } as const;
export type FoundationGrade = keyof typeof GRADE_FACTOR;

export function gradeFor(coverage: number, maxWidth: number): FoundationGrade {
  const r = coverage / maxWidth;
  if (r >= 0.9) return 'S';
  if (r >= 0.7) return 'A';
  if (r >= 0.5) return 'B';
  return 'C';
}

export function levelStep(level: number): number {
  return Math.round((50 * Math.pow(level, 1.65) + 50) / 10) * 10;
}
