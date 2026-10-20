# audio/

Shape Tower's audio and haptics: the **Audio Director**, a full set of procedural placeholder sounds, the landing-note ladder ("the tower is an instrument") and the haptics bridge. It follows the audio section of the design doc (`design/audio/audio-section.md` in the project files).

There are no sound files yet. Every sound is synthesized in code once at startup and kept as an `AudioBuffer`, so the game sounds alive from the first build. Recorded sounds can replace any of them later by name.

## Hooking it up (game/src/view)

```ts
import { createAudioDirector, connectJuiceBus } from '@audio';
import BakeWorker from '@audio/bake/worker?worker&inline';
import { Haptics } from '@capacitor/haptics'; // once Capacitor is in; leave out until then

const audio = createAudioDirector({
  context: (this.sound as Phaser.Sound.WebAudioSoundManager).context, // share Phaser's AudioContext
  worker: () => new BakeWorker(), // bakes sounds off the main thread
  haptics: Haptics,
});
const unhook = connectJuiceBus(sim.bus, audio);
```

That's all the game has to do. The director listens to every JuiceBus event in gameplay.md §11.1 and the 10 Hz `signals` event, and works out the rest itself. It unlocks audio on the first touch, respects the iPhone silent switch (Web Audio in "ambient" mode, so the player's own music keeps playing), and goes quiet when the app is backgrounded.

- **Vite:** alias `@audio` to `../audio/src`. The `?worker&inline` import keeps the worker inside the single-file build. Set `worker: { format: 'iife' }` in `vite.config.ts`: an inline worker becomes a `blob:` URL, and a module worker (Vite's default `'es'`) from a blob fails to start when the page has an opaque origin, such as a `file://` page or a sandboxed preview. The import needs `"types": ["vite/client"]` (or a `/// <reference types="vite/client" />`) for TypeScript.
- **No worker?** Leave `worker` out and baking runs on the main thread, one sound per task. It still works, but frames can hitch while the bank bakes.
- **Startup:** creating the director is instant. Sounds bake in the background. Play can start once the core sounds are in (about 30 sounds), and `audio.ready` resolves when everything is baked.
- **The run_start the sim emits in its constructor** happens before the view connects. The director picks each run up from its first `piece_spawned` instead, so a new sim per run needs nothing extra. A spawn within half a second of `run_over` is treated as a stray from the run that ended.

### Menus and settings

```ts
audio.ui('tap');            // also: tap2, back, toggleOn, toggleOff, slider, tab, open, close, error, pause, resume, start, badge, unlock
audio.setVolume('music', 0.7);   // 'music' | 'sfx' | 'voices', 0 to 1
audio.setHapticsLevel('light');  // 'off' | 'light' | 'full' (Android starts on light)
audio.setMono(true);
audio.setCalm(true);             // softer stingers and heartbeat
audio.setLockOnChime(false);     // the perfect-fit chime (assist setting)
```

Settings are saved in `localStorage` under `shapeTower.audio.v1`.

### For QA

`audio.debugState()` returns everything the audio debug overlay needs: active voices by category, peak voices, the current mix snapshot, biome, key, ladder streak, danger state, the live signals, the last 10 events, decoded memory and the output latency. `TUNING` holds the thresholds (tension levels, impact speed tiers, panning width) for playtest tweaks.

## What the director reads from events

It reads payloads defensively: missing or odd fields fall back to defaults, and an unknown event is ignored.

| Event | Fields it uses |
|---|---|
| `signals` | `tension` (creak 0.3, groan 0.6, danger 0.85 with exit at 0.75), `biome`, `altitude`, `cameraX`, `cameraY`, `foundationX`, `sway`, `gravityScale` |
| `contact_hit` | `approachSpeed` (or `impulsePerMass`), `bodyA`, `bodyB`, `materialA`, `materialB`, `biomeA`, `biomeB`, `point`, `size` (the larger piece's cell count; 4 plays at normal pitch, smaller is higher, bigger is lower) |
| `contact_slide` | `body`, `speed` (start, update and stop a scrape loop; it stops 250 ms after the last report) |
| `piece_settled` | `grade` (`perfect`, `clean`, `messy`), optional `material` |
| `piece_rotated` | `dir` (1 clockwise, -1 counter-clockwise), `blocked` |
| others | as in gameplay.md §11.1: `heart_lost{count, left}`, `checkpoint_hold{progress}`, `checkpoint_claimed{n, leftover}`, `biome_entered{id}`, `hazard_*{type, dir, eta, strength}`, `slowmo{on, timeScale}`, `hitstop{ms}`, `level_up{level}`, and so on |

Materials are `wood`, `stone`, `ice`, `rubber`, `jelly`, `metal`, `glass`, `ground` and `base`. When a body has no material, the director uses the material of the biome it was placed in (`biomeA`, `biomeB`, from the material ids in Art's finishes table, art-direction §4.6), so a piece keeps its sound after the biome changes. With neither, it uses the current biome's.

## Replacing a placeholder with a recording

```ts
await audio.bank.loadFiles('impact.wood.2', ['sfx_impact_wood_t2_01.wav', 'sfx_impact_wood_t2_02.wav']);
```

The director only ever asks the bank for a sound by name, so nothing else changes.

## Layout

| Path | What it does |
|---|---|
| `src/director.ts` | The Audio Director: events to sounds, haptics, danger, ambience, biome changes |
| `src/bank.ts` | Bakes and holds sounds; loads per biome; notes and chords cache |
| `src/bake/` | Bake jobs, the bake worker and the main-thread fallback |
| `src/mixer.ts` | Buses, snapshots, ducking, the shared reverb and the master limiter |
| `src/voices.ts` | Voice caps, priorities and stealing |
| `src/haptics.ts` | Haptic patterns and the Capacitor and `navigator.vibrate` backends |
| `src/music/` | Keys, pentatonic scales and the landing-note ladder |
| `src/synth/` | The DSP toolkit, instruments and every sound recipe |
| `src/biomes.ts` | Per-biome key, material, ambience and reverb |
| `test/unit/` | Node tests: ladder, voices, haptics, settings, every sound renders clean |
| `test/browser/` | Headless Chromium tests on an `OfflineAudioContext` |
| `sketchbook/` | The Sound Sketchbook page |

## Checks

```
npm install
npm test     # typecheck, unit tests, then the browser tests in headless Chromium
```

`npm run build:sketchbook` builds the Sound Sketchbook (`dist/sketchbook.html`), one page where every sound and the main moments can be played by hand through the real director.

The browser tests render real mixes offline and check them: a scripted run through every system, a 150-hit collapse, a resting tower, loudness by impact speed, mono, bad payloads, danger hysteresis, worker baking, memory per biome, impacts by placement biome, and back-to-back runs with no `run_start`. When `../game` is present with its packages installed, they also play Gameplay's real sim with a bot the way the game does (a new sim per run, connected after its constructor) and check the audio of every run.

Current numbers (headless Chromium in the cloud container):

- Peak decoded audio for sound effects is 23 MB in any biome (budget 25 MB); about 33 MB with ambience beds and the note cache.
- Baking the bank takes about 1.6 s. With the worker, the main thread never stalls for more than one frame.
- Handling one event costs about 0.03 ms.
- A 150-hit collapse peaks at 0.88 of full scale, never clips, and stays within the voice caps (8 impacts, 32 total).
