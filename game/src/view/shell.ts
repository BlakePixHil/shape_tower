// What the game and the Wobble Lab share: fonts, the Phaser canvas and play scene, the HUD, Sound's
// Audio Director, run records and the silent benchmark. Each entry adds its own menus on top.

import * as Phaser from 'phaser';
import { connectJuiceBus, createAudioDirector, type AudioDirector } from '@audio';
import BakeWorker from '@audio/bake/worker?worker&inline';
import type { BusEvent } from '../sim/bus.ts';
import type { SecondWindMode, Sim } from '../sim/sim.ts';
import BenchWorker from '../bench.worker.ts?worker&inline';
import { Hud } from './hud.ts';
import type { LabState } from './panel.ts';
import { RunRecorder, benchOnce } from './records.ts';
import { PlayScene, type SceneHooks } from './scene.ts';

export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

export interface ShellOptions {
  /** Which app is running, saved in run records ('lab' or 'game'). */
  app: 'lab' | 'game';
  /** Tuning and view settings the scene reads at the start of each run. */
  lab: LabState;
  secondWind(): SecondWindMode;
  onEvent?(e: BusEvent, sim: Sim): void;
  onRunOver(sim: Sim, payload: Record<string, unknown>): void;
  /** Sound's Audio Director is ready (it needs the browser's audio context first). */
  onAudio?(audio: AudioDirector): void;
}

export interface Shell {
  readonly game: Phaser.Game;
  readonly scene: PlayScene;
  readonly hud: Hud;
  readonly audio: AudioDirector | null;
  /** This run's recorder (finished once the run is over). */
  readonly record: RunRecorder | null;
  /** The personal best before this run started. */
  readonly bestBefore: number;
  unlockAudio(): void;
}

async function loadFonts(): Promise<void> {
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  try {
    await Promise.race([
      Promise.all(['700 20px Fredoka', '600 20px Fredoka', '700 16px Nunito'].map(f => document.fonts.load(f))),
      wait(2500),
    ]);
  } catch { /* fall back to system fonts */ }
}

export async function startShell(o: ShellOptions): Promise<Shell> {
  await loadFonts();
  document.getElementById('boot')?.remove();

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const app = document.getElementById('app')!;
  const hud = new Hud(document.body);
  let audio: AudioDirector | null = null;
  let unhook: (() => void) | null = null;
  let bestBefore = 0;
  let record: RunRecorder | null = null;
  const audioContext = () => (game.sound as Phaser.Sound.WebAudioSoundManager).context ?? null;

  const hooks: SceneHooks = {
    hud,
    lab: o.lab,
    secondWind: () => o.secondWind(),
    onEvent: (e, sim) => o.onEvent?.(e, sim),
    onRunStart(sim, info) {
      bestBefore = scene.bestHeight;
      record = new RunRecorder({ ...info, app: o.app }, BUILD, audioContext);
      unhook?.();
      if (audio) unhook = connectJuiceBus(sim.bus, audio);
    },
    onDemo() {
      // The menu's demo tower isn't a run: no record, and Sound asked for it to stay out of the mix.
      record = null;
      unhook?.();
      unhook = null;
    },
    onStep(sim) { record?.step(sim); },
    onFrame(ms) { if (scene.sim && scene.sim.state === 'playing' && !scene.paused && scene.started) record?.frame(ms, scene.sim); },
    onRunOver: (sim, p) => o.onRunOver(sim, p),
    onJuice(name, payload) { audio?.handle(name, payload); },
  };

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: app,
    width: Math.round(window.innerWidth * dpr),
    height: Math.round(window.innerHeight * dpr),
    backgroundColor: '#6EC3FF',
    banner: false,
    // One texture unit: Phaser 4 drops a triangle of rotated sprites on some GPUs otherwise (art/README.md).
    render: { antialias: true, maxTextures: 1, powerPreference: 'high-performance' },
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    audio: { disableWebAudio: false },
    input: { touch: false, mouse: false, keyboard: false }, // Gestures reads pointer events itself
  });
  const scene = new PlayScene();
  game.scene.add('play', scene, true, { hooks });

  game.events.once(Phaser.Core.Events.READY, () => {
    const ctx = audioContext();
    if (ctx) {
      audio = createAudioDirector({ context: ctx, worker: () => new BakeWorker() });
      if (scene.sim && record) unhook = connectJuiceBus(scene.sim.bus, audio);
      o.onAudio?.(audio);
    }
  });

  window.addEventListener('resize', () => {
    game.scale.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
  });

  // The silent benchmark runs behind the first screen, once per build on each phone.
  setTimeout(() => benchOnce(BUILD, () => new BenchWorker()), 400);

  const shell: Shell = {
    game, scene, hud,
    get audio() { return audio; },
    get record() { return record; },
    get bestBefore() { return bestBefore; },
    unlockAudio() {
      const ctx = audioContext();
      if (ctx && ctx.state !== 'running') void ctx.resume();
    },
  };
  // For headless checks and QA scripts.
  (window as unknown as Record<string, unknown>).__wobble = { game, scene, hud, shell, get audio() { return audio; } };
  await scene.ready;
  return shell;
}

declare const __BUILD__: string | undefined;
