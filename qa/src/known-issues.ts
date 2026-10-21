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
// maths, Math.atan2 in Mortar welds) on game/wobble-lab e21e9d8, and QA-005 (F3.11, the Mortar
// freeze from Box2D joints made outside the awake set) on 8565dda, and QA-006 (F18.4, Glue used up
// with Mortar off) on game/power-fixes bf28a93 (all 2026-10-21). QA-007 (F18.8, odd weights halved
// rounding down) closed 2026-10-21 when Gameplay made rounding down the rule. QA-008 (F7.1, gusts
// scheduled from the end of the last gust, so periods ran about 4.5 s long) on game/slice 9e96419.
export const KNOWN_ISSUES: Record<string, KnownIssue> = {};

export function knownIssue(check: string, sim: { kind: string; engine: string }): KnownIssue | undefined {
  const k = KNOWN_ISSUES[check];
  return k && k.sims.includes(`${sim.kind}/${sim.engine}`) ? k : undefined;
}
