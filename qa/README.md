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

The merge gate is `qa/scripts/gate.sh [checkout]`: every module's own checks (game install, typecheck, sim smoke, gesture check and build; art typecheck; audio tests) plus this fast set, on one checkout such as a PR head, a trial merge or main. A thread merges its PR once QA has run the gate on it and posted the go.

| Variable | Meaning |
|---|---|
| `QA_SIM` | `game` (default when `game/src/sim/testApi.ts` exists) or `reference` |
| `QA_ENGINE` | `box2d` (default) or `rapier`, passed to the game sim (the harness loads Rapier first through the test API's `useRapier()`) |
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
| `src/bot.ts` | A stacking bot that plays the real game through intents only, optionally steering through bubbles and using powers and Second Wind |
| `src/game-api.ts` | Direct access to the game's own modules, for suites that test game rules rather than the physics contract |
| `tests/guide.test.ts` | G1 to G6, G8 and G11 |
| `tests/physics.test.ts` | F3.1 to F3.8: towers, creep, tunnelling, explosions, sleeping, determinism, stone |
| `tests/bots.test.ts` | F3.11: bots play whole runs, Mortar on and off, and the sim never throws |
| `tests/powers.test.ts` | F18: each power-up and its refusal, bubbles, picks, grants, Second Wind, physics under powers, rule checks over bot runs, replays with powers |
| `tests/gusts.test.ts` | F7: the gust schedule per checkpoint, the intro, what a gust pushes, a wall that stands through gusts, no gust in a hold or a claim, replays with gusts, the shape bag unchanged by gusts |
| `tests/late.test.ts` | Late challenge (#27): each stretch's hazards against the table, Deep Cosmos remixes, warnings 2 s ahead, half-strength first hits, nothing in a hold or claim pause, no hits on stone or the steered shape, hearts every third claim from the Red Planet (CP 17, since the 2026-10-22 retune), replays from CP 11, 17 and 23 |
| `tests/streaks.test.ts` | Set streak and brittle shapes (#43, gameplay.md §16 items 11 to 14): rows wait for the streak from CP 3 (3, then 4 from CP 7), Messy and lost pieces reset it, Quick-Set ignores it; brittle shapes only from CP 5 with Hold open, never O, I or Plank, never two within 6 shapes or two in play, the preview keeps its word; 8 cells hold, 12 break 1.2 s after the creak, never once stone; a lost brittle shape is free; every shape, in every rotation, can be steered off either side of every foundation width from 6 to 12 (§4.3 toss reach); replays and the shape bag unchanged |
| `tests/playtest2.test.ts` | Blake's 11:29 playtest (#51, gameplay.md §16 items 15 to 17): a new shape waits 1.5, 1.0, 0.5 s at the top in stretches 1 to 3 and not from CP 4, steers and turns while it waits, and a soft or hard drop ends the wait for good; the plinth is 12 and a claim's slab is never narrower than 10, 10, 9, 9, 8, 8, 7, 7, then 6, never wider than its stretch's widest (12 to 8), always the widest in Zen, with the grade unchanged; budget_low at 5, 3 and 1 left after a landing or a miss, bricks_out once, the run over on bricks after the 3 s grace |
| `tests/zen.test.ts` | Zen (F17.4, Q33, gameplay.md §12.1, #57): a Zen run and an Endless run with unlimited hearts and budget and Second Wind off stay step for step the same on the same seed and player, the Endless twin set to Zen's gentler levers (half-pace ramp, half-strength gusts and hazards, widest slabs), from CP 1 and from late starts (hazards on, every other shape thrown off the edge); Zen sends no heart_lost, last_heart, budget_low, bricks_out or Second Wind events and never ends on its own; Second Wind is off even when the run asks for it; Zen pays half the Endless twin's XP and quitting doesn't halve it again |
| `tests/harness.test.ts` | Proves the harness catches a lying guide, a falling tower and a nondeterministic sim |
| `scripts/late-balance.ts` | Report only: QA's bot plays from CP 11 under three rule sets (before the late challenge, late hazards only, as built) and reports checkpoints claimed, hearts lost per claim and what ended each run |
| `scripts/perf-proxy.mjs` | The performance budgets on a throttled headless Chromium calibrated to Blake's phone, a mid-tier and a low-tier phone: the S1 bench per engine (a tracked stress case with no pass/fail time, qa-section.md Q39), then QA's bot plays the built game while every frame's main-thread work, physics steps, heap and long tasks are recorded; physics is judged in play (p95 per step, at most 40 bodies awake). `--profile` lists what ran in each stretch of 100 ms or more; the slowest frames carry their time on the same clock, their time into the run and the sim events that fired in them, so a hitch can be matched to its stretch and its trigger. Frames during checkpoint holds are reported against the rest (#62), and `--tuning holdGrey=0` sets sim levers on every run, so one seed compares two settings |
| `scripts/run-story.ts` | Replays a run record from a phone, checks its digests against Node, and prints each landing with the ghost the player saw, losses, hearts, bond breaks, power-ups and Second Wind |
| `scripts/cross-build.ts` | Records bot runs on one build and replays them on another, to check that a change leaves earlier runs step for step the same (`--tuning` replays them with tuning changed, such as gusts on) |
| `scripts/replay-child.ts` | Replays run records in a fresh process (F18.13) |
| `scripts/gate.sh` | The merge gate on one checkout: every module's checks, the built game page played headless (game-check, power-check, budget-check, avatar-check, zen-check, achievements-browser, daily-check, splash-check, hold-check, ladder-check), the achievement, Daily and name checks in Node, the ladder API's checks, the ladder server under wrangler dev from the repo root, the art build and its UI screens, and QA's fast set |
| `scripts/ui-second-wind.mjs` | Drives a built game in headless Chromium and checks Second Wind in the HUD: two-tap arming, the glow, no pop-up at pause or game over, the greyed state, the day's free one |
| `scripts/ui-screens.mjs` | Opens each UI kit screen of the built art preview at three phone and tablet sizes, saves screenshots, and checks for sideways scroll, controls off screen or under 44 px, cut-off text and page errors |

## Conventions

Units are blocks, y is up, and the fixed step is 1/60 s. A piece's `(x, y)` is the centre of its bounding box, and `rot` is in quarter turns. The game's plinth is 12 blocks wide since 2026-10-22 (8 before), centred on x = 0, with its top at y = 0.

Physics and guide tests run in a sandbox: checkpoints are out of reach (a claim adds a slab mid-drop), hearts and bricks never run out, and the plinth is pinned at 8 wide, the width the canonical towers and guide bases were drawn for (and the reference sim's). Rule suites play on the game's own plinth unless a setup is drawn for 8 wide and says so. Mortar towers are built one piece at a time, because bonds only form between pieces that have rested.

Tower expectations are `stands`, `falls`, `holds` (may lean under a push but must not fall) or `calibration` (outcome only feeds the tint numbers).

Phone run records come from the prototype's database (`runs` and `bench` collections). Replay one with the build it names: `QA_GAME_SIM=<checkout of record.build>/game/src/sim/testApi.ts npx tsx scripts/run-story.ts <record.json>`.

A known bug is listed in `src/known-issues.ts` with an ID such as QA-001. Its test is marked as expected to fail, so it reports the bug without blocking other pushes. When the bug is fixed the test starts passing, vitest flags that, and the entry comes out.
