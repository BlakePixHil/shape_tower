# game/

The Shape Tower game. Right now it's the **Wobble Lab** physics prototype.

- `src/sim/` is the simulation: pure TypeScript, no Phaser and no DOM, so it runs headless in Node. It follows `design/gameplay.md`.
- `src/view/` is the Phaser 4 view. It only draws the sim and turns touches into intents.

## Running checks

```
npm install          # also patches two bugs in phaser-box2d 1.1.0 (scripts/patch-phaser-box2d.mjs)
npm run typecheck
npm run sim:smoke    # Gameplay's quick headless checks; QA's suites live in ../qa
npm run build        # one self-contained HTML file in dist/
```

## Driving the sim from tests

Import `createSim` from `src/sim/testApi.ts` (Node 22: `node --experimental-strip-types`).

- Units are blocks (1 block = 1 m), y is up. The fixed step is 1/60 s.
- A piece's `(x, y)` is the centre of its bounding box. Rotation `rot` is in quarter turns, counter-clockwise.
- The plinth is 8 blocks wide, centred on x = 0, with its top at y = 0. It's body id 1; ids count up from there, and 0 means none.
- `createSim()` doesn't spawn anything unless you ask (`autoSpawn: false`), and skips the rookie opening.
- `drainEvents()` returns the JuiceBus events (names from gameplay.md §11.1) since the last drain.
- `sim.inputLog` holds every intent with the step it arrived before. `replay({ seed, tuning, rookieOpening, inputs, steps })` replays a run and returns `digest()` every 60 steps.
