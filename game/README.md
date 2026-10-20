# game/

The Shape Tower game. Right now it's the **Wobble Lab** physics prototype.

- `src/sim/` is the simulation: pure TypeScript, no Phaser and no DOM, so it runs headless in Node. It follows `design/gameplay.md`.
- `src/view/` is the Phaser 4 view. It only draws the sim and turns touches into intents.

## Running checks

```
npm install          # also patches six bugs in phaser-box2d 1.1.0 (scripts/patch-phaser-box2d.mjs)
npm run typecheck
npm run sim:smoke    # Gameplay's quick headless checks; QA's suites live in ../qa
npm run build        # one self-contained HTML file in dist/
npm run dev          # play it at http://localhost:5173 (also on your phone over Wi-Fi)

node tests/play-check.mjs [outDir] [seconds]   # plays dist/ in headless Chromium at phone size, saves screenshots and a run record
node --experimental-strip-types tests/replay-record.ts run-record.json   # replays a run record, compares digests
node scripts/artifact.mjs out.html             # turns dist/index.html into the body-only page the claude.ai Artifact tool publishes
```

`src/main.ts` boots the game: the play scene, HUD, Wobble Lab panel (⚙ Lab), start, pause and results cards, the player profile, Sound's Audio Director (`../audio`) and Art's kit (`../art`).

## Run records and the phone benchmark (for QA)

The published page saves into its own claude.ai database (nothing is sent anywhere else, and nothing at all outside claude.ai):

- `runs`: one document per run. Seed, the tuning patch, rookie opening, every input with its step (`inputs`), a digest every 60 steps (`digests`) and at the end (`finalDigest`), cause, max height, stats, shapes placed in the first minute, a 1 ms frame-time histogram with p50/p95/p99, peak JS heap where the browser shows it, AudioContext latencies, device info, and the one-tap answers (`answers.fair`, `answers.ghost`). Runs ended with the Lab's restart have `abandoned: true`.
- `bench`: the silent benchmark, once per build on each device. `src/sim/bench.ts` runs S1's tower in a worker: 60 awake bodies then 152, Mortar on, 2.5 s each, with every step time.

## Driving the sim from tests

Import `createSim` from `src/sim/testApi.ts` (Node 22: `node --experimental-strip-types`).

- Units are blocks (1 block = 1 m), y is up. The fixed step is 1/60 s.
- A piece's `(x, y)` is the centre of its bounding box. Rotation `rot` is in quarter turns, counter-clockwise.
- The plinth is 8 blocks wide, centred on x = 0, with its top at y = 0. It's body id 1; ids count up from there, and 0 means none.
- `createSim()` doesn't spawn anything unless you ask (`autoSpawn: false`), and skips the rookie opening.
- `drainEvents()` returns the JuiceBus events (names from gameplay.md §11.1) since the last drain.
- `sim.inputLog` holds every intent with the step it arrived before. `replay({ seed, tuning, rookieOpening, inputs, steps })` replays a run and returns `digest()` every 60 steps.
- `controlled()` is the steered shape. `snapshot()` captures the options and every call so far, and `restore(snapshot)` rebuilds that exact state in a fresh sim by replaying them (Box2D can't serialise a world).
- `rotate` intents use `dir: 1` for clockwise, which lowers `rot` by one.
