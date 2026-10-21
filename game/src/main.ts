// Wobble Lab boot: the play scene, HUD, tuning panel, menus, profile and audio.

import * as Phaser from 'phaser';
import { connectJuiceBus, createAudioDirector, type AudioDirector } from '@audio';
import BakeWorker from '@audio/bake/worker?worker&inline';
import type { Sim } from './sim/sim.ts';
import { Hud } from './view/hud.ts';
import { LabPanel, loadLab } from './view/panel.ts';
import { award, dailyWindReady, loadProfile, saveProfile, spendDailyWind } from './view/profile.ts';
import { showResults } from './view/results.ts';
import { RunRecorder, benchOnce } from './view/records.ts';
import { PlayScene, type SceneHooks } from './view/scene.ts';
import BenchWorker from './bench.worker.ts?worker&inline';

const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

async function loadFonts(): Promise<void> {
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  try {
    await Promise.race([
      Promise.all(['700 20px Fredoka', '600 20px Fredoka', '700 16px Nunito'].map(f => document.fonts.load(f))),
      wait(2500),
    ]);
  } catch { /* fall back to system fonts */ }
}

async function boot(): Promise<void> {
  await loadFonts();
  document.getElementById('boot')?.remove();

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const app = document.getElementById('app')!;
  const lab = loadLab();
  const profile = loadProfile();
  const hud = new Hud(document.body);
  let audio: AudioDirector | null = null;
  let unhook: (() => void) | null = null;
  let bestBefore = 0;
  let record: RunRecorder | null = null;
  let dailyWind = false; // this run's Second Wind is the day's free one, not spent until it places a shape
  const audioContext = () => (game.sound as Phaser.Sound.WebAudioSoundManager).context ?? null;

  const hooks: SceneHooks = {
    hud,
    lab,
    secondWind() {
      dailyWind = !lab.windAlways && dailyWindReady(profile);
      return lab.windAlways || dailyWind ? 'ready' : 'earn';
    },
    onEvent(e) {
      if (dailyWind && e.name === 'piece_landed') { dailyWind = false; spendDailyWind(profile); }
    },
    onRunStart(sim, info) {
      bestBefore = scene.bestHeight;
      record = new RunRecorder(info, BUILD, audioContext);
      unhook?.();
      if (audio) unhook = connectJuiceBus(sim.bus, audio);
    },
    onStep(sim) { record?.step(sim); },
    onFrame(ms) { if (scene.sim && scene.sim.state === 'playing' && !scene.paused) record?.frame(ms, scene.sim); },
    onRunOver(sim: Sim, p: Record<string, unknown>) { runOver(sim, p); },
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
  // For headless checks and QA scripts.
  (window as unknown as Record<string, unknown>).__wobble = { game, scene, hud, profile, get audio() { return audio; } };

  game.events.once(Phaser.Core.Events.READY, () => {
    const ctx = (game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (ctx) {
      audio = createAudioDirector({ context: ctx, worker: () => new BakeWorker() });
      if (scene.sim) unhook = connectJuiceBus(scene.sim.bus, audio);
    }
  });

  window.addEventListener('resize', () => {
    game.scale.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
  });

  const panel = new LabPanel(document.body, lab, {
    retune: patch => scene.retune(patch),
    view: v => scene.applyView(v),
    restart: () => {
      if (scene.sim?.state === 'playing') record?.finish(scene.sim, { abandoned: true });
      scene.newRun();
      scene.paused = false;
    },
    opened: open => { scene.paused = open || hud.cardOpen; if (!open && !hud.cardOpen) audio?.handle('resume', {}); },
    info: () => `Seed ${scene.sim?.seed ?? '–'} · build ${BUILD}`,
  });

  const unlockAudio = () => {
    const ctx = (game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (ctx && ctx.state !== 'running') void ctx.resume();
  };

  // The silent benchmark runs behind the start card, once per build on each phone.
  setTimeout(() => benchOnce(BUILD, () => new BenchWorker()), 400);

  // Start card.
  hud.card(
    `<h1>Shape Tower</h1><p><b>Wobble Lab</b> · Level ${profile.level}</p>
     <p>Stack shapes up to each gold line. Hold it steady to claim the checkpoint and earn more bricks.</p>
     <p>Steer through bubbles for power-ups. 🌬️ Second Wind clears a messy tower once per run.</p>`,
    [['Play', () => { unlockAudio(); audio?.ui('start'); hud.closeCard(); scene.start(); }, true]],
  );

  const pause = () => {
    if (hud.cardOpen || !scene.sim || scene.sim.state !== 'playing') return;
    scene.paused = true;
    audio?.handle('pause', {});
    hud.card('<h2>Paused</h2>', [
      ['Resume', () => { hud.closeCard(); scene.paused = panel.isOpen; audio?.handle('resume', {}); }, true],
      ['End run', () => { hud.closeCard(); scene.paused = false; scene.sim.quit(); }],
    ]);
  };
  hud.pauseBtn.onclick = pause;
  hud.onPower = slot => scene.usePower(slot);
  hud.onSecondWind = () => scene.useSecondWind();
  hud.labBtn.onclick = () => panel.toggle();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'p') pause(); });

  function runOver(sim: Sim, p: Record<string, unknown>): void {
    const height = Number(p.height ?? 0) - sim.foundations[0].top;
    const quit = sim.cause === 'quit';
    const a = award(profile, Number(p.xp ?? 0), { newBest: height > bestBefore + 0.05 && bestBefore > 0, quit });
    const rec = record;
    rec?.finish(sim, { xp: a.gained, xpBase: Number(p.xp ?? 0), level: profile.level, runNumber: profile.runs, newBest: a.lines.some(l => l[0] === 'New best'), view: { ...lab.view } });
    const questions = [{ id: 'fair', text: 'Was that fair?' }];
    if (profile.runs >= 3 && !profile.askedGhost) {
      profile.askedGhost = true;
      saveProfile(profile);
      questions.push({ id: 'ghost', text: 'Did the ghost show where shapes would land?' });
    }
    showResults(hud, {
      stats: {
        height, checkpoints: sim.stats.checkpoints, score: Math.round(sim.score), xp: a.gained,
        perfects: sim.stats.perfects, rows: sim.stats.rows, placed: sim.stats.placed, cause: sim.cause, biome: scene.biomeName(),
      },
      award: a,
      questions,
      onAnswer: (id, answer) => rec?.answer(id, answer),
      onXpTick: () => audio?.handle('xp_tick', {}),
      onLevelUp: level => audio?.handle('level_up', { level }),
      onAgain: () => { hud.closeCard(); scene.newRun(); scene.paused = false; },
      reducedMotion: lab.view.reducedMotion,
    });
  }
}

declare const __BUILD__: string | undefined;

void boot();
