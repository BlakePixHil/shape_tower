# qa/

Shape Tower's automated QA suites. The plan they implement is the QA section of the design doc (`design/qa-section.md` in the project files); test IDs such as G1, F3.2 and T10 come from there.

There is no CI pipeline. The QA thread runs these suites itself on each build that lands, and the thread pushing a change runs the fast set first. Nobody needs Blake to run anything.

## Running

```
cd qa
npm run setup          # installs game/ (with its phaser-box2d patch) and qa/
npm test               # the fast set, run before every push (a few minutes)
npm run test:full      # everything: the full guide sweep, 100 seeds per tower, 1,000 tunnelling drops
npm run test:reference # the harness against its own stand-in sim, to check the harness itself
npm run typecheck
```

Each run writes a JSON and a Markdown report per suite to `qa/reports/` (not committed).

| Variable | Meaning |
|---|---|
| `QA_SIM` | `game` (default when `game/src/sim/testApi.ts` exists) or `reference` |
| `QA_ENGINE` | `box2d` (default) or `rapier`, passed to the game sim |
| `QA_GAME_SIM` | Another path to the game's test API, for example a second checkout |
| `QA_FULL` | `1` for the full run |

## What's here

| Path | What it does |
|---|---|
| `src/contract.ts` | The interface every sim is driven through, agreed with Gameplay |
| `src/adapters/game.ts` | Wraps `game/src/sim/testApi.ts` in that interface |
| `src/adapters/reference/` | A small Rapier sim that implements the interface, used to test the harness |
| `src/towers.ts` | Canonical towers (Gameplay's T1 to T20 plus QA's additions) and their expected outcomes |
| `src/guide.ts` | The landing-guide sweep: every base, shape, rotation, position and drop style |
| `src/measure.ts` | Tower runs, overlap and speed tracking, quiet detection |
| `src/replay.ts` | Scripted runs and hash comparison for determinism |
| `src/known-issues.ts` | Open bugs that make a check fail today, so they don't block unrelated pushes |
| `tests/guide.test.ts` | G1 to G6, G8 and G11 |
| `tests/physics.test.ts` | F3.1 to F3.7: towers, creep, tunnelling, explosions, sleeping, determinism |
| `tests/harness.test.ts` | Proves the harness catches a lying guide, a falling tower and a nondeterministic sim |

## Conventions

Units are blocks, y is up, and the fixed step is 1/60 s. A piece's `(x, y)` is the centre of its bounding box, and `rot` is in quarter turns. The plinth is 8 blocks wide, centred on x = 0, with its top at y = 0.

Physics and guide tests run in a sandbox: checkpoints are out of reach (a claim adds a slab mid-drop), and hearts and bricks never run out. Mortar towers are built one piece at a time, because bonds only form between pieces that have rested.

A known bug is listed in `src/known-issues.ts` with an ID such as QA-001. Its test is marked as expected to fail, so it reports the bug without blocking other pushes. When the bug is fixed the test starts passing, vitest flags that, and the entry comes out.
