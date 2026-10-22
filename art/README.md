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
| Backdrops | `src/meadow.ts`, `src/treetops.ts`, `src/cloudlands.ts`, `src/storm.ts`, `src/space.ts`, `src/cosmos.ts`, `src/stars.ts` | Parallax layers for all ten biomes: the Meadow (sun, clouds, hills, windmill farmhouse, trees, fence, cow, grass), Treetops (mountains, canopies, balloons, kites, birds), Cloudlands (cloud banks, castle, rainbow, blimp, plane), Storm Belt (thunderheads, far lightning, a weather station, a windsock, rain at the edges), Stratosphere (Earth's curve, a low sun, aurora, a weather balloon), Orbit (Earth's limb, a space station, satellites), Moon (Earthrise, the Moon rising with a flag and a waving astronaut), Red Planet (mesas, a canyon, a rover, dust devils), Ringed Giant (the giant and its ring, ice chunks, ring dust in front at the edges) and Deep Cosmos (four nebula palettes, galaxies, tetromino constellations, a comet, space jellies, four surprise landmarks), plus a three-depth star field. |
| Effects | `src/vfx.ts` | Particle textures: dust and cloud puffs, stardust, sparkle, impact ring, shockwave, flash, speed line, whoosh, wobble lines, crack, stone chip, confetti and mini-shape confetti, XP orb, rays, and the power-up effects (broom sweep, honey drop, bond spark, ripple, gust, bubble shard). |
| Power-ups | `src/powers.ts` | Icons for Clean Slate, Quick-Set, Undo, Glue, Slow-Mo and Second Wind, the power bubble, and the CSS for the DOM power bar and Second Wind's states. |
| UI kit | `src/ui/` | The DOM "sticker toy" UI (art-direction.md §8): `uiCss()` (Paper panels, Ink outlines, buttons that press and bounce, chips, XP bar, toggles, sliders), 51 icons, level badges in seven tiers with titles, achievement badges in four tiers, the logo, biome postcards, the player's avatar with six hats, 19 ladder portraits (some animated), and builders for the main menu, pause card, run summary, level-up takeover, profile, avatar picker, settings, the achievement toast and the Achievements panel, plus the bag (it replaces the Hold card) and the shapes-left counter and warnings. |
| Gusts | `src/wind.ts`, `src/phaser/wind.ts`, `src/ui/hazard.ts` | Curled and long wind streaks, leaves and cloud wisps, `WindView` to play them, and the HUD's hazard chip (countdown ring, push chevrons) and first-appearance card for every hazard. Faces gain a `squint` expression for the tower's top during a gust. |
| Space hazards | `src/hazards.ts`, `src/phaser/hazards.ts`, `src/ui/hazard.ts` | The later biomes' hazards: target reticle, marching trajectory dashes and incoming streaks (amber, Ink edge), space junk (bolt, solar-panel shard, wrench) with a blinking light, meteors with trails, the dust devil's swirl marker, column and backdrop dim, `HazardFx` to play them, crosswind streaks (`WindView.steady`), the Ringed Giant's backdrop tilt (`Backdrop.setTilt`), and the HUD's windsock and plumb-bob gauges. |
| Celebrations | `src/celebrate.ts`, `src/phaser/celebrate.ts` | Fireworks in three kinds (peony with mini shapes, tilted ring, gold willow) for crossing the best height, and the milestone celebrations: a balloon release, a rainbow arc and a comet shower. `Celebration` plays them in the background layer. |
| Altitude rail | `src/ui/rail.ts` | The HUD's altitude rail (biome colors, checkpoint ticks, best-height flag, a Blockling head at the tower's top) and the off-screen chips: gold "▲ 4" for a checkpoint above the view, red "▼" for a piece falling out of it. |
| Biome title card | `src/ui/biomecard.ts` | `biomeCard(biome)`: on `biome_entered`, a banner in the biome's color drops in under the HUD ("Now entering CLOUDLANDS"), its postcard pops up and gets postmarked, and on a first visit a "New postcard!" chip pops under it. |
| Brand | `src/brand.ts` | `bakeAppIcon(px, layer)` (the store icon: Blocklings bursting up out of a little planet, store-icon loud; or Android's adaptive background and foreground), `bakeSplash(w, h)`, and `bakeShareCard(data)` for the run's share image around the money shot. |
| Money shot | `src/panorama.ts` | `bakePanorama(tower, w, h)`: the whole run in one still, the sky climbing through every biome reached with each biome's props, the tower whole (stone below the last claim), its slabs, a gold flag at every claimed checkpoint and the best-height line. The share card frames it. |
| Phaser adapter | `src/phaser/` | `ArtTextures`, `BlocklingView`, `GuideView`, `CheckpointLine`, `PbMarker`, `PowerBubble`, `WindView`, `HazardFx`, `Celebration`, `Backdrop`. |

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

### Power-ups

The bubble owns its sprites, like the checkpoint line:

```ts
const bubble = new PowerBubble(tex, kind, depth);   // on bubble_spawned: it pops in with a ring and sparkles
bubble.set(x, y).update(dt);                        // every frame: world px of the sim's bubble; the bob is added on top
bubble.ending(shapesLeft === 1);                    // flickers on its last shape
bubble.collect(slotWorldXY);                        // on power_collected: it bursts and the icon flies to the slot (omit the target to pop it in place)
bubble.fade();                                      // on bubble_expired: it drifts up and fades
if (bubble.done) bubble.destroy();                  // after 0.6 s (collect) or 0.45 s (fade)
```

`tex.powerIcon(kind)` is any icon as an atlas frame, `POWER.bubbleIcon` (0.8) blocks across. Kinds are the sim's (`clean`, `quickset`, `undo`, `glue`, `slowmo`) plus `wind` for Second Wind. `POWER_COLORS` has each power's color.

The power bar is DOM, so the kit gives it images and CSS:

- `powerIconUrl(kind, cssPx)` is a cached PNG URL at the device's resolution (`prewarmUi()` bakes the HUD's sizes ahead; see Screens). Put `<img class="st-icon" src=...>` in a slot (54 px slot: `powerIconUrl(kind, 40)`; 62 px Second Wind: `powerIconUrl('wind', 46)`; a 16 px one fits the Glue and Slow-Mo chips).
- `powerBarCss()` is CSS to add after the HUD's own. It washes each slot in its power's color (set `data-kind="glue"` on the button) and draws Second Wind's states as classes on `.st-wind`: `earn` (greyed and dashed, tag "CP 2"), no class (ready, the icon breathes), `armed` (gold, pulsing, tag "TAP AGAIN"), `glow` (ready while the run is in trouble: a pulsing sky halo and a nudge), and `spent` (it blows away up and to the right over 450 ms; hide it after). Under `prefers-reduced-motion` the button keeps its colors and drops the motion.

Effects, as particle textures (`tex.vfx(name)`):

| Power | Effect |
|---|---|
| Clean Slate | `sweep` tinted `POWER_COLORS.clean` with additive blend, moved left to right across the stretch in about 0.32 s; then `puff` (biome dust) and a mint `sparkle` per removed piece. |
| Quick-Set | The claim's stone wave, top down; `chip` tinted stone for dust. |
| Undo | `puff` and a violet `sparkle` where the piece was. |
| Glue | `honey` drops (already amber, no tint) falling from the falling shape; on each glued bond, a few `spark`s tinted `SIGNAL.gold`, rotated to their velocity. |
| Slow-Mo | A `ripple` tinted `POWER_COLORS.slowmo` when it starts, then `stardust` in the same color drifting up off the falling shape. |
| Second Wind | A `ripple` tinted `POWER_COLORS.wind`, then 12 to 16 `gust` streaks (white) crossing the screen left to right at about 20 blocks per second. |

The preview's `powers=1` shows all of it live, with a DOM power bar in every state; `pstrip=1` shows frozen frames of the bubble's spawn, collect and fade.

### Backdrop

The backdrop bakes each biome's props when the climb is about halfway through the biome before it, and frees them two biomes later, so only two or three biomes are in memory. Props above the Meadow are placed relative to the screen at the moment their biome arrives, then sink at their scroll factor as the tower climbs. On `biome_entered`, call `backdrop.arrival(biomeIndex)` to play the arrival moment:

| Biome | Arrival |
|---|---|
| Treetops | A bird flock scatters past the camera. |
| Cloudlands | A cloud layer punches down past the camera, whiting out the edges for a beat. |
| Storm Belt | The sky dims and a rumble of light rolls across the far clouds. |
| Stratosphere | A sun flare sweeps across; the aurora unfurls a second later. |
| Orbit | The blue glow of the horizon drops away, then a quiet beat. |
| Moon | The Moon rises into frame with its flag and astronaut (no call needed beyond `arrival`). |
| Red Planet | A big dust devil sweeps across the far layer. |
| Ringed Giant | A bright ring arc sweeps across behind the tower. |
| Deep Cosmos | The cosmic whale swims by. |

The punch-through and the Ringed Giant's near ring dust pass in front of the tower at `frontDepth` (default 950); keep that under the guide. Deep Cosmos is endless: call `backdrop.setCosmos(checkpoint)` on every checkpoint claim (any biome is fine). Every 6 checkpoints into Deep Cosmos the nebula cross-fades to the next of its four palettes (`COSMOS_PALETTES`, each with a `name` for a toast if you want one) and that palette's landmark drifts by: the whale, a Butterblock constellation that smiles, a comet swarm, a derelict wheel station. With `reduceMotion`, flashes, drift, sway and sweeping arrivals are off and landmarks hold still while they fade in and out.

### Gusts

`WindView` draws the gust in screen space, behind the tower (depth -10 by default). `dir` is the way the wind blows: `1` is left to right, so it builds at the left edge.

```ts
const wind = new WindView(tex, { width: W, height: H, drifters: windDrifters(biome) }); // leaves, wisps or none
bus.on('hazard_warning', e => e.type === 'gust' && wind.warn(e.dir, e.eta));   // curls build at the upwind edge
bus.on('hazard_start', e => e.type === 'gust' && wind.start(e.strength, e.dir)); // strength in g; streaks race across
bus.on('hazard_end', e => e.type === 'gust' && wind.end());                     // tails off over 0.6 s
// every frame: wind.update(dt). On a new biome: wind.drifters = windDrifters(biome). clear() on restart.
```

`blow(dir, strength)` is the same as `start(strength, dir)`. Set `wind.reduceMotion` for fewer streaks and no flutter; the telegraph still shows. During the gust, set the top rows' faces to `squint`.

For the HUD (needs `uiCss()`):

```ts
const chip = hud.appendChild(hazardChip({ type: 'gust', dir: e.dir, eta: e.eta, y: '34%' }));  // on hazard_warning
hazardChipGo(chip);    // on hazard_start: ring full, the chip pushes
hazardChipEnd(chip);   // on hazard_end: slides out and removes itself
if (e.first) hud.appendChild(hazardCard('gust'));  // "Gusts ahead! Keep it wide.", removes itself
```

The chip sits at the upwind edge with the hazard's icon, a ring that fills over `eta` and chevrons pointing the way it pushes; it ignores touches. Add the class `paused` to hold its countdown while the game is paused, and pass `elapsed` to rebuild one partway through. `HAZARDS` has the icon and card copy for gusts, crosswind, junk, meteors, dust devils and tidal sway.

### Space hazards

`HazardFx` draws the telegraphs and hazard objects in world px (y down, like `BlocklingView`); the game moves the objects from the sim. Objects sit at depth 30 (over the tower), telegraphs just above, the dust column just below. Prewarm with `tex.prewarm(keys, { hazards: true })`.

```ts
const hz = new HazardFx(tex);                 // { depth, dimDepth } to move it
// Space junk (Orbit): on the warning, a dashed path and a reticle that locks onto the hit point over eta.
hz.trajectory('j1', fromX, fromY, hitX, hitY).reticle('j1t', hitX, hitY, e.eta);
hz.junk('j1', 'wrench', x, y, angle);         // each frame while it flies ('bolt' | 'panel' | 'wrench')
hz.remove('j1').unmark('j1').unmark('j1t');   // on contact or when it leaves
// Meteors (Moon): a reticle and a faint incoming streak per impact, then the meteor itself.
hz.reticle('m1t', hitX, hitY, e.eta).incoming('m1s', hitX, hitY, angleBack);  // angle points back up its path
hz.meteor('m1', x, y);                        // each frame; the trail follows its motion
// Dust devils (Red Planet): the swirl marker on the side it comes from, then the column and the dim.
hz.swirl('d1', x, y, e.eta, dir);             // dir 1 = it travels right (spins clockwise)
hz.unmark('d1').column('d1c', footX, footY, dir).dim(0.8);   // column each frame; dim(0) when it ends
// every frame: hz.update(dt). hz.clear() on restart or run end. hz.active is true while anything shows.
```

`unmark` pops a telegraph out, `remove` fades an object out. Set `hz.reduceMotion` to stop the spinning, pulsing and swaying; the telegraphs still lock on and blink. The dim darkens the backdrop and the wind (depth -9.5), never the tower or the guide.

The contact puffs come from your particles, with the textures in **Effects**: on a junk hit, 4 to 6 `spark`s tinted `SIGNAL.gold` plus a `ring`; on a meteor hit, a `puff` in the biome's dust color plus 3 `chip`s; when a dust devil passes the tower, a few `puff`s drifting its way.

The other two are weather, with no objects:

```ts
// Crosswind (Storm Belt, Stratosphere): thin streaks drift the whole time, under any gusts.
wind.steady(e.strength, e.dir);               // on hazard_start; again with the other dir when it flips; steady(0) to stop
const sock = hud.appendChild(windsock({ dir: e.dir, strength: 0.6 }));  // 56 px Paper gauge, place it yourself
setWindsock(sock, dir, strength01);           // the sock swings across over 2 s on a flip
// Tidal sway (Ringed Giant): the backdrop leans with gravity, and the plumb-bob leads it.
backdrop.setTilt(gravityTiltRad);             // clockwise on screen, clamped to ±0.06; off under reduceMotion
const bob = hud.appendChild(plumbBob());
setPlumb(bob, upcomingTilt01);                // -1 (about to pull left) to 1 (right)
```

Each hazard's first appearance still gets `hazardCard(type)`, and its warning the edge chip from **Gusts**.

### Celebrations

`Celebration` plays the big moments in screen space, in the background layer: over the backdrop and the wind, under the tower (depth -9). Prewarm with `tex.prewarm(keys, { celebrations: true })`.

```ts
const party = new Celebration(tex, { width: W, height: H });
bus.on('pb_crossed', () => party.fireworks());        // 5 shells over 1.6 s: peony, ring and willow in turn, either side of the falling shape
bus.on('height_milestone', () => {                    // the celebration that suits the sky
  if (biome <= 2) party.balloons();                   // Meadow to Cloudlands: 14 balloons float up both sides of the tower
  else if (biome <= 4) party.rainbow();               // Storm Belt, Stratosphere: an arc sweeps across behind the tower
  else party.comets();                                // Orbit onward: a comet shower streaks across the sky
});
// every frame: party.update(dt). party.clear() on restart or run end; party.active while anything shows.
```

`firework(x, y, kind, color, delay)` launches one shell that climbs from below the screen and bursts at (x, y): `kind` is `'peony' | 'ring' | 'willow'` and `color` a shape color (0 to 6, `BUNTING_KEYS` order; the willow is always gold). `balloons(n)`, `rainbow(x, y)` (its feet at y, default 46% down) and `comets(n, dir)` take counts and placement. Set `party.reduceMotion` to halve the counts, stop the balloons' sway and fade the rainbow in instead of sweeping it.

### Altitude rail and off-screen chips

```ts
const rail = hud.appendChild(altitudeRail(220));      // right edge, top 200px; move it with --top or your own CSS
setRail(rail, { top, cps, claimed, pb });              // every frame is fine: it redraws only on change
const cpChip = hud.appendChild(checkpointChip(4));     // gold "▲ 4" at the top edge; --x moves it, --top sets its distance
cpChip.classList.toggle('show', lineIsAboveView);       // pops in and out
setOffscreenChip(cpChip, String(next));
const lost = hud.appendChild(offscreenChip({ dir: 'down', label: '' }));  // red "▼" at the bottom edge, --x at the piece
```

`top` and `pb` are in blocks above the foundation; `cps` lists checkpoint heights from checkpoint 1, at least through the next one (later ones are extrapolated). If you have the ticks with the checkpoint being climbed to last, that's `cps: ticks, claimed: ticks.length - 1`. The rail shows the whole run (0 to 1.08 × the highest of the next checkpoint, the best and the top); `span: <blocks>` shows a window that scrolls with the climb instead, with the best-height flag pinned to the top when it's above the window. Stretches take their biome's color (`RAIL_COLORS`), washed out above the tower's top; the next checkpoint's tick is gold, and a dot marks where a new biome starts.

### Biome title card

```ts
// on biome_entered (id is 1-based in the sim; biomeCard takes 0 = Meadow)
hud.appendChild(biomeCard(id - 1, { newPostcard: !profile.postcards[id - 1] }));
```

It drops in just under the HUD's height counter (84 px below the safe area; `top` moves it), holds 1.5 s, slides back up and removes itself, about 2.3 s in all. It ignores touches and announces "Now entering Cloudlands" to screen readers. Under Reduce Motion (or `still: true`) it fades in and out on the same timing. `stay: true` keeps it on screen until you remove it.

### Money shot and share card

```ts
// When the run ends, from the sim:
const tower: PanoramaData = {
  pieces: sim.pieceViews().filter(v => v.state !== 'lost' && v.state !== 'controlled')
    .map(v => ({ shape: v.shape, x: v.x, y: v.y, angle: Math.atan2(v.s, v.c), stone: v.state === 'stone' })),
  slabs: sim.foundationViews(),           // the plinth first, then one per claim
  top: stats.maxHeight, pb: previousBest, // world blocks
};
const card = bakeShareCard({ height, biome: panoramaBiome(tower), newBest, name, level, score, tower, date: '21 OCT 2026' });
```

`bakePanorama(tower, w, h)` takes any size and fits the tower to it (the share card bakes it at its frame's size). The sky follows the run's checkpoints the way the game's sky clock does, each biome's props sit in its stretch and fade into the next, claimed pieces are stone, and the top piece wears a proud face when the tower is big enough for faces to read. It takes about 30 to 60 ms on a laptop and a few times that on a phone, so bake it once. Pieces use the sim's frame: centre of the bounding box, y up, angle counter-clockwise; the ground is a block below the plinth's top.

### Screens

The screens are DOM overlays built from plain data; the game keeps the logic. Each builder returns an element to append to `document.body`, and every button carries a `data-action`.

```ts
import { injectUiCss, loadUiFonts, onAction, pauseCard, summaryCard, showXpLine, setXpBar, levelUp } from '@art/index.ts';

injectUiCss();
await loadUiFonts();               // badge numbers are drawn text (logo letters are outlines)

const pause = document.body.appendChild(pauseCard());          // quitHalves: false in Zen
onAction(pause, action => { /* 'resume' | 'restart' | 'settings' | 'quit' */ });
```

| Builder | Takes | Actions |
|---|---|---|
| `mainMenu(d)` | `name`, `level`, `into`, `need`, `avatar?`, `modes?` (default Daily Tower at level 3, Zen at 8), `still?` | `profile`, `settings`, `play`, each mode's `id` (locked modes have `.locked` and `data-locked` and don't fire) |
| `pauseCard(o?)` | `quitHalves?` (default true) | `resume`, `restart`, `settings`, `quit` |
| `summaryCard(d)` | `cause`, `height` (m), `newBest?`, `biome`, `score`, `checkpoints`, `perfects`, `rows`, `clutches`, `xp` (the bar before the run), `lines` (`Award.lines`), `gained` | `again`, `profile`, `home`, `share` |
| `levelUp(o)` | `level`, `from?`, `unlock?` (default `rewardAt(level)`; `null` for none) | `continue` |
| `profilePanel(d)` | `name`, `level`, `into`, `need`, `avatar?`, `stats`, `postcards` (per biome: the date first reached, `''` for none, `null` if not reached), `achievements?` (`{ got, total }`: the Achievements row under the stats) | `close`, `avatar` (the avatar was tapped: open the picker), `achievements` (the row was tapped: open the panel) |
| `achievementsPanel(d)` | `groups`: `{ name, items }[]`, each item `{ id, name, text, tier, icon, biome?, got?, progress?, secret? }` | `close` |
| `avatarPanel(d)` | `avatar?`, `level` (hats above it are locked) | `close`, `done`; `readAvatar(panel)` gives the choice back |
| `settingsPanel(values, layout?)` | current values by key; `SETTINGS_LAYOUT` has music, sfx, haptics, controls, splitTap, safeDrop, leftHand, sensitivity, reducedMotion, shake, patterns | `close`; `readSettings(panel)` gives the values back |

The run summary's tally: the XP lines start hidden. Call `showXpLine(card, i)` for each line in turn (the total is the last; it returns false past the end) and `setXpBar(card, { level, into, need })` as the bar fills; on a level-up, fill to `need`, then set the next level and append `levelUp({ level })`. `showAllXpLines(card)` skips the tally. Extra rows (QA's one-tap questions) go in `card.querySelector('.ui-sum-extra')`.

Parts for your own screens: `xpBar(state)`, `badgeUrl(level, px)`, `titleFor(level)`, `newTitleAt(level)`, `rewardAt(level)` and `UNLOCKS` (what each level gives, gameplay.md §10.3), `uiIconUrl(name, px)` for any of `UI_ICONS`, `avatarUrl({ shape, face, hat }, px)`, `postcardElement({ biome, width, date, locked })`, `logoElement()` and `bakeLogo(width)` for a still canvas. Control glyphs (pause, close, arrows) are Ink, for Paper buttons.

Add `.ui-still` to a screen (or turn on the OS's Reduce Motion) to stop its animations; pass `still: true` to `mainMenu` to skip the logo's drop-in.

The `*Url` helpers (`powerIconUrl`, `uiIconUrl`, `badgeUrl`, `postcardUrl`, the logo's) bake and PNG-encode an image the first time it's asked for. They bake on the CPU (`cpuBaked` in util.ts), so the encode doesn't wait on the GPU, but a postcard still takes a few ms. Call `prewarmUi()` once when the menu first shows: in idle slices it bakes what the in-run HUD shows (the power icons at the HUD's sizes, the biome card's postcards and star, the hazard icons) and encodes them with `toBlob`, off the main thread, so they come back as `blob:` URLs. `prewarmUi({ also: () => { uiIconUrl('trophy', 32); } })` warms your own the same way, and `warmUrls(ask)` does it for any list. Anything asked for before it's warm is baked on the spot, as before.

### Avatar and hats

The profile's avatar is the player's Blockling in a hat. `HATS` lists six with the level each unlocks at: Party hat (1, everyone has it), Sky cap (4), Propeller beanie (7), Daisy chain (9), Top hat (12) and Crown (16). `rewardAt` returns the hat for those levels, so the level-up's unlock card and the XP bar's next-reward icon show it. Tapping the avatar on the profile fires `avatar`:

```ts
const pick = document.body.appendChild(avatarPanel({ avatar: profile.avatar, level: profile.level }));
onAction(pick, a => { if (a === 'done') profile.avatar = readAvatar(pick); pick.remove(); });  // close keeps the old one
```

The picker offers `AVATAR_SHAPES` (the seven tetrominoes), `AVATAR_FACES` (six) and the hats; picking updates its preview, and hats above the player's level are locked with the level they need. Save the `AvatarSpec` (`{ shape, face, hat }`) with the profile. `hatUrl(hat, px)` gives a hat on its own and `drawHat(ctx, hat, x, y, w)` draws one on a canvas, the middle of its base at (x, y).

### Achievements

Each achievement (gameplay.md §18) has a round medal that gains ornaments with its tier: Bronze is a plain rim, Silver adds a ring of beads, Gold a scalloped rim and red ribbon tails, Platinum a mother-of-pearl rim on a gold sunburst with violet ribbons, a gem and a sparkle. The glyph in the middle is any of `UI_ICONS`; six were drawn for the list: `combo`, `avalanche`, `toolbox`, `undo`, `needle` and `purist`. A biome achievement passes `biome` and shows that biome's postcard once earned (its glyph while locked, as the profile hides unreached postcards). `locked` greys the whole medal; `secret` (a secret one not earned yet) is a grey "?" medal that draws no glyph, tier or biome.

```ts
const src = achievementBadgeUrl({ icon: 'combo', tier: 'gold' }, 52);                     // a cached data URL, like badgeUrl
achievementBadgeUrl({ icon: 'biome', tier: 'bronze', biome: 2, locked: !got }, 52);       // Head in the Clouds
achievementBadgeUrl({ icon: 'needle', tier: 'bronze', secret: !got }, 52);                // Needle Threader

// In a run, where the biome title card goes (wait for one that's showing to finish):
hud.appendChild(achievementToast({ name: 'Seventh Heaven', tier: 'gold', icon: 'combo', more: 2 }, { still: reduceMotion, plain: !juice }));

// Run over: the strip goes in the summary's extra rows.
card.querySelector('.ui-sum-extra')!.appendChild(achievementStrip(newOnes));             // [{ name, tier, icon, biome? }]

// Profile: profilePanel({ ..., achievements: { got, total } }) adds the row; its action opens the panel.
const panel = document.body.appendChild(achievementsPanel({ groups }));
onAction(panel, () => panel.remove());
```

The toast stamps its badge onto a card in the tier's color with "Achievement!" and the name, sparkles and shines, then slides away after 2.2 s and removes itself; it ignores touches. `more: N` adds "+N more" under the name. `still` fades it instead of sliding (Reduce Motion), `plain` drops the stamp bounce, shine and sparkle (juice off), `top` moves it and `stay` keeps it up. The panel lists the groups in order with each one's count: earned rows show the date (`got: 'YYYY-MM-DD'` becomes "21 Oct 2026") and the tier, locked ones are grey with a progress bar when `progress: [n, goal]` is given, and a secret one not earned shows "Secret" and "Keep playing to find this one." with its name and text left out of the page. `achievementsRow({ got, total })` is the profile's row on its own.

For the store consoles (§18.5), `bakeAchievementForStore(badge, 'play')` is 512 px on transparent (Google Play Games) and `'gamecenter'` is 1024 px, flattened on a soft disc and inset so Game Center's circle crop keeps the ribbons. `npm run export:badges` writes every badge both ways into `exports/achievements/` (not committed); pass a JSON list `[{ id, tier, icon, biome? }]` to use the game's list instead of the preview's copy. `bakeAchievementBadge(badge, px)` and `drawAchievementBadge(ctx, badge, x, y, size)` give a canvas or draw one.

### Portraits

For names on the Daily ladder (Blake, 2026-10-22). A portrait is the player's avatar (its Blockling, face and hat, `drawAvatarFigure`) in a style from `PORTRAIT_ART`: `{ id, name, animated, kind }`, where `kind` is `free`, `earned`, `platinum`, `shop` or `supporter`. The ids are permanent. The frame shows where a style came from: free ones have a Paper band, shop ones a colored band, earned ones a gold medal rim with laurels, twinkles and a glint that sweeps across now and then, and the two Platinum ones (Deep Space, Golden Crown) a holographic rim that turns inside gold scallops, under a gem or a crown.

| Kind | Styles |
|---|---|
| Free (by level) | `meadow` (the avatar's sky and grass, the default), `sunset`, `nightsky`, `cloudland` |
| Earned, animated | `moonwalk` (biome_7), `dust_devil` (biome_8), `ring_leader` (biome_9), `seventh_heaven` (combo_7), `ironclad` (flawless_6), `meteor_shower` (calm_7) |
| Platinum, animated | `deep_space` (biome_10), `golden_crown` (cp_30) |
| Shop | `bubblegum`, `checkers`, `retro` (still); `rainbow`, `lava_lamp`, `disco` (animated) |
| Supporter Pack | `supporter` (animated) |

```ts
row.insertAdjacentHTML('afterbegin', portraitHtml(entry.portrait, entry.avatar, 32, { still: reduceMotion }));   // a ladder row
picker.appendChild(portraitElement('moonwalk', profile.avatar, 96));                                            // the picker
img.src = portraitUrl(id, avatar, 48);                                                                          // a still PNG (data URL)
```

`portraitHtml` gives a self-contained `.ui-portrait` element `cssPx` square (it reads from 32 px up); unknown ids show `meadow`. Its layers are baked once per style and size and shared as `blob:` URLs, so twenty rows cost one set of images per style plus each player's figure. The animated styles move by CSS alone (transform and opacity: turning, sliding tiled layers, twinkles), and `still` or the OS's Reduce Motion holds them on the frame `portraitUrl` shows. `bakePortrait(id, avatar, px)` gives that frame as a canvas.

### Bag and shapes left

From Blake's playtest (2026-10-21). The bag replaces the Hold card: a shopping tote the held shape stands in, its back (handle and the dark opening) under your preview canvas and its front (panel, band and a swap sticker) over it. It fires the action `bag`.

```ts
const bag = hud.appendChild(bagButton({ size: 64 }));                          // bottom right, by the thumb
bag.querySelector('.ui-bag-slot')!.appendChild(holdCanvas);                   // your square preview; it's stretched to fit
setBag(bag, { held: !!heldKey, used: swappedThisDrop, locked: level < 2 ? 'Lv 2' : null });
bagSwap(bag);                                                                  // on each swap: the sack squashes, the shape drops in
```

`empty` hides the slot, `used` dims the bag until the next shape, and `locked` greys it with a lock chip and the text you pass (and disables it). The `bag` icon in `UI_ICONS` is the same tote with a T in it.

Shapes left: `shapeCounter()` is the HUD chip (the `shapes` icon and the count). `setShapeCounter(el, left, infinite?)` updates it, and it only touches the page when the count changes: at `SHAPES_LOW` (5) or fewer it turns amber with a pip per shape left, at `SHAPES_ALERT` (3) or fewer red and pulsing, and each shape spent while low pops a pip. `shapeAlert(left)` is a banner that removes itself: above 3 a soft amber pill ("5 shapes left"), at 3 or fewer a big shaking red line with a red flash round the screen ("3 SHAPES LEFT!", "LAST SHAPE!") and a tip that the next checkpoint brings more, and at 0 "OUT OF SHAPES!" stamped in, for a run that ends on shapes (append it before the summary). `alertEdge()` is a red glow round the screen; switch it with `setAlertEdge(edge, left <= SHAPES_ALERT && !infinite)`.

```ts
const counter = hud.appendChild(shapeCounter()), edge = hud.appendChild(alertEdge());
setShapeCounter(counter, left, infinite); setAlertEdge(edge, left <= SHAPES_ALERT && !infinite);   // each frame is fine
// On budget_low (the sim sends it at 5, 3 and 1): hud.appendChild(shapeAlert(ev.left, { still: reduceMotion }));
// A run that ends on shapes: hud.appendChild(shapeAlert(0)), then the summary.
```

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
npm run export:badges   # every achievement badge at 512 px and 1024 px into exports/achievements/
```

`npm run shots` and `npm run export:badges` use Playwright's Chromium. Set `CHROMIUM=/path/to/chrome` to use another one, and `H=<px>` to take taller shots of long sheets.

### Preview options

Add these to the preview URL:

- `state=stable|perfect|risky|tip|miss` holds one guide state (otherwise they cycle).
- `cp=near|hold|claim` holds one checkpoint-line phase (otherwise it cycles).
- `vfx=1` shows every effect texture over a day and a night sky, with a looping claim burst.
- `powers=1` shows the bubbles spawning, bobbing, flying to their slots or fading, each power's effect in turn, and a DOM power bar with every icon and Second Wind state. `pw=idle` holds the bubbles; `fx=sweep|glue|slowmo|gust` holds one effect. `pstrip=1` shows frozen frames of the bubble's life.
- `tour=1` climbs from the Meadow through Treetops into Cloudlands and plays each arrival; add `from=<sky position>` to start there and carry on to Deep Cosmos (for example `tour=1&from=2.6`). `arrive=1` replays the current biome's arrival every 4 s. `at=<s>` plays it once and freezes that many seconds in (for screenshots).
- `pal=<0..3>` picks the Deep Cosmos palette (with `sp=9.3`); `palcycle=1` moves to the next one every 7 s with its landmark. `landmarks=1` shows the four landmark textures.
- `ui=menu|pause|summary|levelup|profile|settings|avatar` opens that screen over the Meadow (its buttons work; tapping the profile's avatar opens the picker); `ui=icons|badges|logo|hats|ach` shows a sheet of the kit's parts (`hats`: each hat, worn, and small; `ach`: the tiers, the new glyphs, all 47 achievement badges earned, locked and secret, the summary strip, the profile row and four toasts). `ui=shapes` shows the bag (tap it to swap) and its states, and the shapes-left counter counting down with its banners (`left=<n>` holds a count and freezes its banner at `at=<ms>`). `ui=portraits` shows every portrait at 96 px, a ladder of twenty rows at 32 px and the still PNGs (`pt=<id>` shows one style large). `ui=achievements` opens the Achievements panel (`all=1`: everything earned) and `ui=achtoast` plays three toasts as a run would (`plain=1`: juice off). `lv=<level>` sets the player's level, `still=1` turns the animations off. Without `ui`, a Screens row sits above the biome picker.
- `wind=1` loops a gust over the Treetops (with `sp=2.3`, Cloudlands' wisps): calm, the telegraph with the edge chip and, once, the first-gust card, the gust with squinting faces, the tail. `wdir=-1` holds the direction; `wt=<s>` starts that far into the loop (2.3 is late in the telegraph, 4 mid-gust).
- `hz=crosswind|junk|meteor|dust|sway` loops that hazard in its biome every 6 s: calm, the 2 s telegraph with the edge chip (and, once, the first-appearance card), the hazard, the end. Crosswind shows the windsock and flips each loop; sway shows the plumb-bob and tilts the backdrop. `ht=<s>` starts that far in (1.6 is mid-telegraph, 3.2 mid-hazard).
- `cel=fireworks|balloons|rainbow|comets` fires that celebration every 5 s in a biome it suits (`sp=4.3` shows the fireworks at night); `ct=<s>` starts that far in (1.2 is fireworks bursting, 2.2 balloons in the air, 1.6 the rainbow up).
- `ui=brand` shows the app icon (Blocklings bursting out over a little planet) at several sizes, Android's adaptive layers and masks, the splash and a share card (`share=1` shows just the share card and splash, larger).
- `ui=titles` shows all ten biome title cards; `ui=btitle&b=<0-9>` plays one (`seen=1` drops the new-postcard chip, `bt=<ms>` freezes it that far in). Picking a biome in the picker, or climbing into one on the tour, also plays its card.
- `ui=pano` shows the money shot of a made-up tower and its share card; `ph=<blocks>` sets the tower's height (default 63.4) and `card=1` puts the card first.
- `rail=1` shows the altitude rail climbing at 3 blocks a second with both off-screen chips; `top=<blocks>` starts it there, `hold=1` stops the climb and `span=<blocks>` shows a scrolling window instead of the whole run.
- Options also work after a `#` (for example `#tour`), for hosts that drop the query string.
- `gallery=1` shows every shape in every rotation, with worried, stone and space-rim looks.
- `climb=<blocks>` scrolls up, `zoom=<n>` zooms the camera, `sp=<0..9.7>` sets the sky position, `tension=<0..1>` fixes tension.
- `maxtex=1` or `renderer=canvas` for headless runs (see above).
