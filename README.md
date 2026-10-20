# Shape Tower

A mobile, physics-based Tetris: drop shapes, build an endless tower, reach checkpoints, and climb from a grassy meadow through the clouds into space.

The design doc is the source of truth for how the game works. Gameplay numbers live in the gameplay spec (`design/gameplay.md` in the project files, mirrored in the doc).

## Layout

Each top-level folder belongs to one workstream, so changes don't collide.

| Folder | What's in it | Owner |
|---|---|---|
| `game/` | The game: a headless TypeScript simulation (`game/src/sim/`) and the Phaser 4 view (`game/src/view/`). Starts life as the Wobble Lab physics prototype. | Gameplay |
| `art/` | Procedural art module and the Phaser texture adapter | Art |
| `audio/` | Audio Director, placeholder sounds, haptics bridge | Sound |
| `qa/` | Test harness, canonical towers, bots | QA |

`game/` imports `art/` and `audio/` through Vite aliases (`@art`, `@audio`), so each module stays self-contained.

## Tech

TypeScript, Vite, Phaser 4, and Box2D v3 (Phaser Box2D) for physics, with Rapier 2D in a bake-off. It ships to phones with Capacitor later.

There's no CI pipeline. Every test runs on the developer side before pushing.
