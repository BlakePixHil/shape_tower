// Checks that fail today because of an open bug, so they don't block unrelated pushes.
// A test marked with one of these is expected to fail; when the bug is fixed the test starts
// passing, vitest reports that as a failure, and the entry here should be removed.
export interface KnownIssue {
  id: string;
  /** Which sims it affects, as "kind/engine". */
  sims: string[];
  summary: string;
  owner: string;
  since: string;
}

// Fixed and removed: QA-001 (F3.2, thin pieces sinking into loose pieces) and QA-002 (F3.3 bonds,
// upside-down shapes flung when bonded), both on game/wobble-lab 9da5533 (2026-10-20); QA-004 (F3.6
// maths, Math.atan2 in Mortar welds) on game/wobble-lab e21e9d8, and QA-005 (F3.9, the Mortar
// freeze from Box2D joints made outside the awake set) on 8565dda (both 2026-10-21).
export const KNOWN_ISSUES: Record<string, KnownIssue> = {
  'F18.4 glue without Mortar': {
    id: 'QA-006',
    sims: ['game/box2d'],
    summary:
      'With Mortar off, Glue is used up (power_used, 3 shapes) but no glued shape ever bonds: updateMortar returns before the bond loop when tuning.mortar is false. gameplay.md §13.2 says glued shapes bond to whatever they touch, and Mortar may become a late-game power-up rather than always on (§3.4).',
    owner: 'Gameplay',
    since: '2026-10-21',
  },
  'F18.8 halving': {
    id: 'QA-007',
    sims: ['game/box2d'],
    summary:
      'pickKind halves a kind already in a slot with max(1, w >> 1), so odd weights round down: Undo at 4 bricks left (weight 3) drops to 1, not 1.5, and is picked 9% of the time instead of 13%. Same for Glue when tense and Slow-Mo from checkpoint 4. Either the rule says "rounded down" or the weights are doubled so halves are exact.',
    owner: 'Gameplay',
    since: '2026-10-21',
  },
};

export function knownIssue(check: string, sim: { kind: string; engine: string }): KnownIssue | undefined {
  const k = KNOWN_ISSUES[check];
  return k && k.sims.includes(`${sim.kind}/${sim.engine}`) ? k : undefined;
}
