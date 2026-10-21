# audio/

Shape Tower's audio and haptics: the **Audio Director**, a full set of procedural placeholder sounds, the adaptive soundtrack (a band per biome), the shapes' gibberish voices, the landing-note ladder ("the tower is an instrument") and the haptics bridge. It follows the audio section of the design doc (`design/audio/audio-section.md` in the project files).

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
- **Restarting mid-run:** every `connectJuiceBus` call closes a run still going on the previous bus, quietly, so a restart from pause gets a fresh mix and band without a `run_over`.
- **Don't connect a menu's demo tower.** Its events would start a run in the mix.

### Music outside a run, menus and settings

```ts
audio.screen('menu');       // the title lullaby; also 'profile' (lighter) and 'none' (silence). Results music starts itself after run_over
audio.ui('tap');            // also: tap2, back, toggleOn, toggleOff, slider, tab, open, close, error, pause, resume, start, badge, unlock
audio.setVolume('music', 0.7);   // 'music' | 'sfx' | 'voices', 0 to 1
audio.setHapticsLevel('light');  // 'off' | 'light' | 'full' (Android starts on light)
audio.setMono(true);
audio.setCalm(true);             // softer stingers and heartbeat
audio.setLockOnChime(false);     // the perfect-fit chime (assist setting)
audio.setJuice(false);           // Gate 1's juice switch, before a run (or createAudioDirector({ juice }))
audio.setZen(true);              // a Zen run, before it starts: the checkpoint hold keeps its suspense to itself
```

**Juice off** keeps every sound that says what happened (impacts, settles, hearts, the checkpoint clack, warnings, creaks, hazards, UI) and drops the flourishes: the landing-note melody, shimmers, confetti, fireworks, coin cascades, stinger chords, biome entry moments, shape voices, ducking and all haptics. The band keeps playing every layer but stops following the run (no streak lead, tension layer, riser or tape stop).

Settings are saved in `localStorage` under `shapeTower.audio.v1`.

### The soundtrack (audio section 4)

Each biome has its own band (`src/music/styles.ts`): lead, support, pad, bass, a drum kit and two chord progressions in the biome's key. The composer (`src/music/composer.ts`) turns that into a seeded 32-bar theme (A A' B A'') in three variations, with melodies on the biome's pentatonic landing scale, so landing notes never clash. The engine (`src/music/engine.ts`) schedules bars 0.35 s ahead on the audio clock through its own 16-voice pool, and decides the layers on each bar line:

| Layer | Plays | Comes in |
|---|---|---|
| L1 | pad and bass | from run start; its filter closes as tension passes 0.5 |
| L2 | support and drums | after 5 settles; busier after each checkpoint in a biome |
| L3 | lead | a streak of 4, or the last 25% to a checkpoint; held 4 bars; out at once above tension 0.6 |
| L4 | low pulse and ticks | faded in by tension 0.3 to 0.7 |
| L5 | riser on the next biome's lead | the last 15% to a checkpoint; resolves on the claim |

A new biome's band takes over at the next bar line with a 2-bar intro, every 72 bars there is an 8-bar breakdown, game over tape-stops the band, and an 8-bar results loop in the fanfare's key follows the "nice try" phrase. Deep Cosmos rotates its lead with the key, and the fourth rotation brings the Meadow tune home. It needs nothing new from the game: it runs on `piece_settled`, `checkpoint_claimed`, `biome_entered`, `run_over` and the `tension` and `checkpointProgress` signals. `MUSIC_TUNING` holds its thresholds.

The band's notes bake ahead: the current biome's at entry, and the next biome's on the climb to the boundary checkpoint. A note that isn't baked yet is skipped (never rendered on the spot) and counted in `debugState().music.misses`.

### Shape voices (audio section 6.8)

Gibberish reactions from a small formant synthesizer (`src/synth/voice.ts`): "wheee" on a long hard drop, a falling "wheee" off the tower, "oof" on a hard landing (`piece_landed.impact` 0.6 or more), "uh-oh" when danger starts, a chorus of "yay" at a checkpoint and "aww" at game over. One every 4 s at most, on the voices bus (its own slider), pitched per shape from `piece_spawned.shape` and `piece_landed.shape`.

### For QA

`audio.debugState()` returns everything the audio debug overlay needs: active voices by category, peak voices, the current mix snapshot, biome, key, ladder streak, danger state, the live signals, the last 10 events, decoded memory, the output latency, and the band's state (mode, bar, layers, voices, missed notes). `TUNING` holds the thresholds (tension levels, impact speed tiers, panning width, voice limits) and `MUSIC_TUNING` the soundtrack's, for playtest tweaks.

## What the director reads from events

It reads payloads defensively: missing or odd fields fall back to defaults, and an unknown event is ignored.

| Event | Fields it uses |
|---|---|
| `signals` | `tension` (creak 0.3, groan 0.6, danger 0.85 with exit at 0.75), `biome`, `altitude`, `cameraX`, `cameraY`, `foundationX`, `sway`, `gravityScale` |
| `contact_hit` | `approachSpeed` (or `impulsePerMass`), `bodyA`, `bodyB`, `materialA`, `materialB`, `biomeA`, `biomeB`, `point`, `size` (the larger piece's cell count; 4 plays at normal pitch, smaller is higher, bigger is lower) |
| `contact_slide` | `body`, `speed` (start, update and stop a scrape loop; it stops 250 ms after the last report) |
| `piece_settled` | `grade` (`perfect`, `clean`, `messy`), optional `material` |
| `piece_spawned`, `piece_landed`, `piece_lost` | `shape` (each shape's voice pitch), `impact` and `x` on `piece_landed` |
| `hazard_warning` | `type`, `dir` (-1 or 1), `eta`; `first: true` plays the heads-up chime under the hint card |
| `hazard_end` | `type`; `cancelled: true` (a hold cut the warning short and no gust came) fades the warning out |
| `checkpoint_hold` | `progress` (0 to 1): the hold ticks, and with juice on (not in Zen) the mix drains as it fills; a `hitstop` during the hold dips the music |
| `achievement` | `tier` (`bronze`, `silver`, `gold`, `platinum`) and `inRun`: `true` for the toast in a run (a stamp and a sparkle under the play, no duck), `false` for the run-over strip (send one, at the highest tier earned; a repeat within 2 s is ignored) |
| `piece_rotated` | `dir` (1 clockwise, -1 counter-clockwise), `blocked` |
| power-ups (§13) | `bubble_spawned{x}`, `bubble_expired{x}`, `power_collected{x}`, `power_granted`, `power_used{kind, x}`, `power_refused`, `power_ended{kind}`, `pieces_swept{pieces}`, `second_wind_ready{how}`, `second_wind`, and `glue` on `piece_landed` and `bond_formed`. The sounds are in the audio section §6.11 |
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
| `src/music/` | Keys and scales, the landing-note ladder, and the soundtrack: biome bands, composer and engine |
| `src/synth/` | The DSP toolkit, instruments (with the band and drum kit), the voice synthesizer and every sound recipe |
| `src/biomes.ts` | Per-biome key, material, ambience and reverb |
| `test/unit/` | Node tests: ladder, voices, haptics, settings, every sound renders clean, the composer |
| `test/browser/` | Headless Chromium tests on an `OfflineAudioContext` |
| `sketchbook/` | The Sound Sketchbook page |

## Checks

```
npm install
npm test     # typecheck, unit tests, then the browser tests in headless Chromium
```

`npm run build:sketchbook` builds the Sound Sketchbook (`dist/sketchbook.html`), one page where every sound and the main moments can be played by hand through the real director.

The browser tests render real mixes offline and check them: a scripted run through every system, a 150-hit collapse, a resting tower, loudness by impact speed, mono, bad payloads, danger hysteresis, worker baking, memory per biome, impacts by placement biome, every power-up moment, back-to-back runs with no `run_start`, the soundtrack through a whole run (layers on bar lines, the tension takeover, a breakdown, the riser, a biome handover, the tape stop and the results loop), the screen music, the juice switch, a restart from pause, the shape voices, achievement toasts and the run-over strip, a gust warning that a hold cancels, and the checkpoint hold draining the music as its ring fills. When `../game` is present with its packages installed, they also play Gameplay's real sim with a bot the way the game does (a new sim per run, connected after its constructor) and check the audio of every run, the band included. The bot also collects and uses power-ups, and uses Second Wind on its last heart.

Current numbers (headless Chromium in the cloud container):

- Peak decoded audio for sound effects is 24.8 MB in any biome (budget 25 MB). With ambience beds and the note cache (the landing ladder plus two biomes' bands) a whole run peaks at about 44 MB (budget 60 MB: effects 25, instruments 20, ambience 15).
- The band schedules 1,600 to 1,700 notes over a 2.5-minute bot session with none missed, and never uses more than 16 voices. It sits at about -23 dB RMS with every layer in, under the effects.
- Baking the bank takes about 1.6 s. With the worker, the main thread never stalls for more than one frame.
- Handling one event costs about 0.03 ms.
- A 150-hit collapse peaks at 0.88 of full scale, never clips, and stays within the voice caps (8 impacts, 32 total).
