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
// upside-down shapes flung when bonded), both on game/wobble-lab 9da5533 (2026-10-20).
export const KNOWN_ISSUES: Record<string, KnownIssue> = {
  'F3.6 math': {
    id: 'QA-004',
    sims: ['game/box2d'],
    summary:
      'Mortar bonds call Math.atan2 inside every step: phaser-box2d b2RelativeAngle (weld prepare and solve) and the bond reference angle in game/src/sim/engine/box2d.ts. ECMAScript lets Math.atan2 differ by platform. Blake\'s phone runs 3 and 4 replay the same in Node and desktop Chromium but not as they ran on the Android phone.',
    owner: 'Gameplay',
    since: '2026-10-21',
  },
};

export function knownIssue(check: string, sim: { kind: string; engine: string }): KnownIssue | undefined {
  const k = KNOWN_ISSUES[check];
  return k && k.sims.includes(`${sim.kind}/${sim.engine}`) ? k : undefined;
}
