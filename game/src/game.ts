// Shape Tower, the game: main menu, runs, pause, the run-over panorama and summary, profile and
// settings, on the same shell as the Wobble Lab. Tuning is gameplay.md §14's defaults; the only
// per-player changes are the level unlocks (§10.3), gentle first runs (§8.4) and Settings.

import type { AudioDirector } from '@audio';
import type { Sim } from './sim/sim.ts';
import { biomeFor, type Tuning } from './sim/tuning.ts';
import type { LabState } from './view/panel.ts';
import { addRunStats, award, dailyWindReady, loadProfile, nextJuice, saveProfile, spendDailyWind } from './view/profile.ts';
import { Screens, type UiSound } from './view/screens.ts';
import { applyAudio, loadSettings, saveSettings, tuningFor, viewFor } from './view/settings.ts';
import { BUILD, startShell } from './view/shell.ts';

/** Calls Sound adds in its next module version, made safe until then. */
type Director = AudioDirector & { setJuice?(on: boolean): void; screen?(name: 'menu' | 'profile' | 'none'): void };

async function boot(): Promise<void> {
  const settings = loadSettings();
  const profile = loadProfile();
  // Gate 1 (QA's protocol, qa/gate1-protocol.md): each run's juice is set when it starts.
  let juice = true;
  let juiceRun = -1;
  const firstOpen = profile.sliceRuns === 0;
  const state: LabState = { tuning: {}, view: viewFor(settings, juice) };
  let dailyWind = false;
  let screens: Screens | null = null; // made once the shell is up; the audio can arrive first
  let skipTap: ((e: PointerEvent) => void) | null = null;

  /** The tuning a new run starts with. */
  const runTuning = (): Partial<Tuning> => {
    const t: Partial<Tuning> = { ...tuningFor(settings), holdUnlocked: profile.level >= 2, startPower: profile.level >= 6, hazardIntro: !profile.seenGusts };
    if (profile.level <= 1) { t.mortarStrength = 1.2; t.rookieBricks = 4; } // gentle first runs
    return t;
  };

  const shell = await startShell({
    app: 'game',
    lab: state,
    secondWind() {
      dailyWind = dailyWindReady(profile);
      return dailyWind ? 'ready' : 'earn';
    },
    newPostcard: b => profile.postcards[b] === null,
    onEvent(e) {
      if (dailyWind && e.name === 'piece_landed') { dailyWind = false; spendDailyWind(profile); }
      if (e.name === 'hazard_start' && !profile.seenGusts) { profile.seenGusts = true; saveProfile(profile); }
    },
    onRunOver: (sim, p) => runOver(sim, p),
    onAudio: a => { applyAudio(settings, a); if (screens?.current === 'menu') (a as Director).screen?.('menu'); },
  });
  const { scene, hud } = shell;
  const audio = () => shell.audio as Director | null;
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.profile = profile;

  hud.labBtn.style.display = 'none';
  const showHud = (on: boolean) => { hud.root.style.display = on ? '' : 'none'; };
  const sc = screens = new Screens(document.body, {
    ui: (kind: UiSound) => { shell.unlockAudio(); audio()?.ui(kind); },
    xpTick: () => audio()?.handle('xp_tick', {}),
    levelUp: level => audio()?.handle('level_up', { level }),
  });

  // ------------------------------------------------------------------ flow

  let menuShown = false;
  function home(): void {
    stopSkip();
    showHud(false);
    scene.paused = false;
    scene.demo();
    audio()?.screen?.('menu');
    sc.menu({
      profile, build: BUILD,
      still: menuShown || settings.reduceMotion, // the logo drops in once per visit
      onPlay: play,
      onProfile: () => { audio()?.screen?.('profile'); sc.profile(profile, home); },
      onSettings: () => { audio()?.screen?.('profile'); openSettings(home); },
      note: firstOpen && profile.sliceRuns === 0 ? 'Testing: some runs play without effects. Tap how each one felt.' : undefined,
    });
    menuShown = true;
  }

  function play(): void {
    stopSkip();
    shell.unlockAudio();
    sc.close();
    ({ juice, juiceRun } = nextJuice(profile));
    state.tuning = runTuning();
    state.view = viewFor(settings, juice);
    scene.applyView(state.view);
    audio()?.setJuice?.(juice);
    audio()?.screen?.('none');
    hud.lockHold(profile.level < 2);
    showHud(true);
    scene.newRun();
    scene.paused = false;
    scene.start();
  }

  function openSettings(back: () => void): void {
    sc.settings(settings, s => {
      saveSettings(s);
      state.view = viewFor(s, juice);
      scene.applyView(state.view);
      scene.retune(tuningFor(s));
      applyAudio(s, audio());
    }, back);
  }

  function pause(): void {
    if (sc.current || !scene.started || !scene.sim || scene.sim.state !== 'playing') return;
    scene.paused = true;
    audio()?.handle('pause', {});
    const resume = () => { sc.close(); scene.paused = false; audio()?.handle('resume', {}); };
    sc.pause({
      onResume: resume,
      onRestart: () => {
        shell.record?.finish(scene.sim, { abandoned: true, juiceRun, player: profile.player });
        play();
      },
      onSettings: () => openSettings(pause2),
      onQuit: () => { sc.close(); scene.paused = false; scene.sim.quit(); },
    });
  }
  // Back from Settings opened in the pause menu: the pause menu again.
  function pause2(): void { sc.close(); pause(); }

  hud.pauseBtn.onclick = pause;
  hud.onPower = slot => scene.usePower(slot);
  hud.onSecondWind = () => scene.useSecondWind();
  hud.onHold = () => scene.hold();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'p') pause(); });

  function stopSkip(): void {
    if (skipTap) document.removeEventListener('pointerdown', skipTap);
    skipTap = null;
  }

  function runOver(sim: Sim, p: Record<string, unknown>): void {
    const height = Number(p.height ?? 0) - sim.foundations[0].top;
    const quit = sim.cause === 'quit';
    const bestBefore = shell.bestBefore;
    const newBest = height > bestBefore + 0.05 && bestBefore > 0;
    const biome = biomeFor(sim.checkpoint).id;
    addRunStats(profile, { height, biome, bricks: sim.stats.placed, perfects: sim.stats.perfects, rows: sim.stats.rows, checkpoints: sim.stats.checkpoints, clutches: sim.stats.clutches });
    const a = award(profile, Number(p.xp ?? 0), { newBest, quit });
    const rec = shell.record;
    rec?.finish(sim, { xp: a.gained, xpBase: Number(p.xp ?? 0), level: profile.level, runNumber: profile.runs, newBest: a.lines.some(l => l[0] === 'New best'), view: { ...state.view }, juiceRun, player: profile.player });
    const questions: { id: string; text: string; kind?: 'yesno' | 'faces' }[] = [
      { id: 'feel', text: 'How did that run feel?', kind: 'faces' },
      { id: 'see', text: 'Could you see what happened?' },
      { id: 'fair', text: 'Was that fair?' },
    ];
    if (profile.runs >= 3 && !profile.askedGhost) {
      profile.askedGhost = true;
      saveProfile(profile);
      questions.push({ id: 'ghost', text: 'Did the ghost show where shapes would land?' });
    }
    // The money shot: the camera glides down the whole tower, then the summary card. A tap skips.
    showHud(false);
    skipTap = () => scene.skipPanorama();
    document.addEventListener('pointerdown', skipTap);
    scene.panorama(() => {
      stopSkip();
      sc.summary({
        stats: {
          cause: sim.cause ?? '', height, newBest: a.lines.some(l => l[0] === 'New best'), biome: biome - 1,
          checkpoints: sim.stats.checkpoints, perfects: sim.stats.perfects, rows: sim.stats.rows, clutches: sim.stats.clutches, score: sim.score,
        },
        award: a,
        questions,
        onAnswer: (id, answer) => rec?.answer(id, answer),
        onAgain: () => { rec?.exit('again'); play(); },
        onProfile: () => { rec?.exit('menu'); audio()?.screen?.('profile'); sc.profile(profile, home); },
        onHome: () => { rec?.exit('menu'); home(); },
        reducedMotion: settings.reduceMotion,
      });
    });
  }

  home();
}

void boot();
