// Wobble Lab boot: the shared shell plus the tuning panel, the start and pause cards, and the
// run-over card with QA's one-tap questions.

import type { Sim } from './sim/sim.ts';
import { LabPanel, loadLab } from './view/panel.ts';
import { award, dailyWindReady, loadProfile, saveProfile, spendDailyWind } from './view/profile.ts';
import { showResults } from './view/results.ts';
import { BUILD, startShell } from './view/shell.ts';

async function boot(): Promise<void> {
  const lab = loadLab();
  const profile = loadProfile();
  let dailyWind = false; // this run's Second Wind is the day's free one, not spent until it places a shape

  const shell = await startShell({
    app: 'lab',
    lab,
    secondWind() {
      dailyWind = !lab.windAlways && dailyWindReady(profile);
      return lab.windAlways || dailyWind ? 'ready' : 'earn';
    },
    onEvent(e) {
      if (dailyWind && e.name === 'piece_landed') { dailyWind = false; spendDailyWind(profile); }
    },
    onRunOver: (sim, p) => runOver(sim, p),
  });
  const { scene, hud } = shell;
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.profile = profile;

  const panel = new LabPanel(document.body, lab, {
    retune: patch => scene.retune(patch),
    view: v => scene.applyView(v),
    restart: () => {
      if (scene.sim?.state === 'playing') shell.record?.finish(scene.sim, { abandoned: true });
      scene.newRun();
      scene.paused = false;
    },
    opened: open => { scene.paused = open || hud.cardOpen; if (!open && !hud.cardOpen) shell.audio?.handle('resume', {}); },
    info: () => `Seed ${scene.sim?.seed ?? '–'} · build ${BUILD}`,
  });

  // Start card.
  hud.card(
    `<h1>Shape Tower</h1><p><b>Wobble Lab</b> · Level ${profile.level}</p>
     <p>Stack shapes up to each gold line. Hold it steady to claim the checkpoint and earn more shapes.</p>
     <p>Steer through bubbles for power-ups. 🌬️ Second Wind clears a messy tower once per run.</p>`,
    [['Play', () => { shell.unlockAudio(); shell.audio?.ui('start'); hud.closeCard(); scene.start(); }, true]],
  );

  const pause = () => {
    if (hud.cardOpen || !scene.sim || scene.sim.state !== 'playing') return;
    scene.paused = true;
    shell.audio?.handle('pause', {});
    hud.card('<h2>Paused</h2>', [
      ['Resume', () => { hud.closeCard(); scene.paused = panel.isOpen; shell.audio?.handle('resume', {}); }, true],
      ['End run', () => { hud.closeCard(); scene.paused = false; scene.sim.quit(); }],
    ]);
  };
  hud.pauseBtn.onclick = pause;
  hud.onPower = slot => scene.usePower(slot);
  hud.onSecondWind = () => scene.useSecondWind();
  hud.onHold = () => scene.hold();
  hud.labBtn.onclick = () => panel.toggle();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'p') pause(); });

  function runOver(sim: Sim, p: Record<string, unknown>): void {
    const height = Number(p.height ?? 0) - sim.foundations[0].top;
    const quit = sim.cause === 'quit';
    const bestBefore = shell.bestBefore;
    const a = award(profile, Number(p.xp ?? 0), { newBest: height > bestBefore + 0.05 && bestBefore > 0, quit });
    const rec = shell.record;
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
      onXpTick: () => shell.audio?.handle('xp_tick', {}),
      onLevelUp: level => shell.audio?.handle('level_up', { level }),
      onAgain: () => { hud.closeCard(); scene.newRun(); scene.paused = false; },
      reducedMotion: lab.view.reducedMotion,
    });
  }
}

void boot();
