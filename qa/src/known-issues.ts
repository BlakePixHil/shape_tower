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

export const KNOWN_ISSUES: Record<string, KnownIssue> = {
  'F3.2': {
    id: 'QA-001',
    sims: ['game/box2d'],
    summary:
      'A Domino falling a full stretch (16 blocks, about 24 blocks/s) onto a loose piece sinks about 0.28 blocks into it and takes 14 to 16 steps to push back out. Box2D only runs continuous collision against static bodies unless a body is a bullet.',
    owner: 'Gameplay',
    since: '2026-10-20',
  },
};

export function knownIssue(check: string, sim: { kind: string; engine: string }): KnownIssue | undefined {
  const k = KNOWN_ISSUES[check];
  return k && k.sims.includes(`${sim.kind}/${sim.engine}`) ? k : undefined;
}
