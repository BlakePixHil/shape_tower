# art/

The Shape Tower art kit. Everything is drawn in code with Canvas 2D (no image files), then baked once into atlas pages that Phaser 4 draws. It follows the art section of the design doc (`design/art-direction.md` in the project files).

- `src/` is the module. It has no dependencies and never imports Phaser: the adapter in `src/phaser/` uses structural types, so you pass your own `Phaser.Scene` and there's only ever one copy of Phaser.
- `preview/` is a Phaser scene that shows the Meadow, a small tower, an active piece and every landing-guide state, using the adapter exactly as the game will.
- `art-config.json` holds every art number and color, generated from `src/` for tools that can't import TypeScript.

## What's in it

| Piece | Where | What it does |
|---|---|---|
| Tokens | `src/config.ts` | Ink, Paper, signal colors, guide tints, fonts, and `ART`: piece construction, faces, guide, and juice timings. |
| Shapes | `src/shapes.ts` | `ART_SHAPES` with the sim's keys and rotation-0 cells, plus palette and material. `pose(key, q)` gives the shape at a quarter turn. |
| Pieces | `src/piece.ts`, `src/face.ts` | The Blocklings: outline, lips, seams, gloss, materials, biome finishes, stone look, space rim, and faces with nine expressions. |
| Landing guide | `src/guide.ts` | Ghost edge, chevrons, beam, contact dot and ring, state glyphs. |
| Biomes | `src/biomes.ts` | All ten biomes, the sky blend, `SkyClock`, rim and star amounts. |
| Foundations | `src/slab.ts` | The Meadow's wooden pedestal, a graded slab for each biome, grade stamps. |
| Checkpoint line | `src/checkpoint.ts` | Rope, bunting in the shape colors, numbered plaque, hold-steady ring and label, the claimed line's flag, and the best-height marker. |
| Backdrops | `src/meadow.ts`, `src/treetops.ts`, `src/cloudlands.ts`, `src/stars.ts` | Parallax layers for the Meadow (sun, clouds, hills, windmill farmhouse, trees, fence, cow, grass), Treetops (mountains, canopies, balloons, kites, birds) and Cloudlands (cloud banks, castle, rainbow, blimp, plane), plus a three-depth star field. Biomes 4 to 10 show their sky and stars until their props land. |
| Effects | `src/vfx.ts` | Particle textures: dust and cloud puffs, stardust, sparkle, impact ring, shockwave, flash, speed line, whoosh, wobble lines, crack, stone chip, confetti and mini-shape confetti, XP orb, rays. |
| Phaser adapter | `src/phaser/` | `ArtTextures`, `BlocklingView`, `GuideView`, `CheckpointLine`, `PbMarker`, `Backdrop`. |

## Using it from game/

Point an alias at `art/src`:

```ts
// game/vite.config.ts
import { fileURLToPath } from 'node:url';
resolve: { alias: { '@art': fileURLToPath(new URL('../art/src', import.meta.url)) } },
```

```jsonc
// game/tsconfig.json, compilerOptions
"paths": { "@art/*": ["../art/src/*"] }
```

Then import with the `.ts` extension, like the rest of the code: `import { ArtTextures, BlocklingView } from '@art/index.ts'`.

### A minimal scene

```ts
const tex = new ArtTextures(this, { cellPx });              // cellPx = view width / 12
tex.prewarm(Object.keys(SHAPES), { finishes: ['wood'] });   // on the loading screen, so nothing bakes mid-run
const backdrop = new Backdrop(this, { width, height });
const guide = new GuideView(tex, 1000);
const sky = new SkyClock();

// One view per sim body.
const view = new BlocklingView(tex, body.key, { seed: body.id, finish: BIOMES[biome].finish });

// Every frame:
view.setPose(px, py, body.angle).setStone(claimed ? 1 : 0).setRim(rimAmount(sky.sp));
view.update(dt);
guide.show({ key, q, pieceX, pieceY, ghostX, ghostY, state, perfect, contacts });
guide.update(dt);
backdrop.update(dt, groundScreenY, sky.update(dt, biome, progress));
```

### Checkpoint line and best height

```ts
const line = new CheckpointLine(tex, checkpointNumber, depth);
// Every frame while it's the active line (world px; x0..x1 = the view plus a block each side):
line.set({ y, x0, x1, near, hold, plaqueX }).update(dt);
// On checkpoint_claimed: bunting pops off, rope turns gold, the flag plants. Keep updating it.
line.claim(towerLeft, towerRight);

const pb = new PbMarker(tex, depth);
pb.set(y, x0, x1).update(dt);   // pb.pop() on pb_crossed
```

`near` (0 to 1) brightens the glow and speeds up the bunting; `hold` (0 to 1) fills the hold-steady ring. The plaque defaults to 1.3 blocks inside the right edge of the view.

### Effects

`tex.vfx(name)` returns an atlas frame, so a particle needs the texture key and the frame: `img.setTexture(r.key, r.frame)`. `VFX[name]` is each effect's natural size in blocks, so `scale = wantedBlocks / VFX[name] * tex.scale`. White effects are meant to be tinted: dust with `BIOMES[biome].dust`, rings and sparkles with the signal colors. Confetti `mini_I` through `mini_Z` come in their shape colors. `prewarm()` bakes every effect unless you pass `vfx: false`. The preview's `vfx=1` shows them all with a looping claim burst.

### Backdrop

The backdrop bakes each biome's props when the climb is about halfway through the biome before it, and frees them two biomes later, so only two or three biomes are in memory. Props above the Meadow are placed relative to the screen at the moment their biome arrives, then sink at their scroll factor as the tower climbs. On `biome_entered`, call `backdrop.arrival(biomeIndex)` to play the arrival moment: a bird flock for Treetops, the cloud punch-through for Cloudlands. The punch-through passes in front of the tower at `frontDepth` (default 950); keep that under the guide.

### Conventions

- Shape keys, cells and rotations match `game/src/sim/shapes.ts`: cells are `[col, row]` with y up, rotation `q` is quarter turns counter-clockwise, and the pivot is the centre of the cells' bounding box.
- Positions passed to the adapter are world pixels with y down (`px = x * cellPx`, `py = groundY - y * cellPx`). Angles are the sim's: radians, counter-clockwise.
- Faces and lighting stay upright: a `BlocklingView` shows the baked rotation nearest the body's angle and turns the sprite only by what's left (at most about 50°). So a piece that lands on its side shows that rotation's art, with the light lip still on top.
- `cornerRadius` (0.05 blocks) must equal the sim's collider radius. They match today.
- Tension drives faces: `idle` below 0.3, `worried` from 0.3, sweat from 0.6, `panic` from 0.85. Only pieces in the top 10 rows should be `setLively(true)`.
- Textures bake at `cellPx × texScale` per block, where `texScale` defaults to the device pixel ratio capped at 2. Sprites display at `tex.scale`.
- Load the Fredoka and Nunito fonts before baking anything with text (slabs and grade stamps), or the fallback font gets baked in.

### Headless WebGL

Phaser 4's WebGL shader picks a texture unit with an exact float comparison. On SwiftShader (headless Chromium, so QA's and Gameplay's headless runs) that drops one triangle of rotated sprites whose texture isn't on unit 0. Real phone GPUs aren't expected to show it. The kit packs everything into a few atlas pages, which makes it rare, but headless tests should still use one of these:

```ts
new Phaser.Game({ render: { maxTextures: 1 }, ... })   // or type: Phaser.CANVAS
```

If it ever shows on a device, ship with `maxTextures: 1`; the atlas pages keep the draw-call cost small.

## Commands

```
npm install
npm run dev         # preview at http://localhost:5173
npm run typecheck
npm run config      # regenerate art-config.json after changing src/
npm run build       # one self-contained HTML file in dist/
npm run shots -- "state=tip&maxtex=1" "gallery=1&maxtex=1"   # screenshots of dist/ into shots/
```

`npm run shots` uses Playwright's Chromium. Set `CHROMIUM=/path/to/chrome` to use another one.

### Preview options

Add these to the preview URL:

- `state=stable|perfect|risky|tip|miss` holds one guide state (otherwise they cycle).
- `cp=near|hold|claim` holds one checkpoint-line phase (otherwise it cycles).
- `vfx=1` shows every effect texture over a day and a night sky, with a looping claim burst.
- `tour=1` climbs from the Meadow through Treetops into Cloudlands and plays each arrival. `arrive=1` replays the current biome's arrival every 4 s.
- Options also work after a `#` (for example `#tour`), for hosts that drop the query string.
- `gallery=1` shows every shape in every rotation, with worried, stone and space-rim looks.
- `climb=<blocks>` scrolls up, `zoom=<n>` zooms the camera, `sp=<0..9.7>` sets the sky position, `tension=<0..1>` fixes tension.
- `maxtex=1` or `renderer=canvas` for headless runs (see above).
