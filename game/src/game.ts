// Shape Tower, the game: main menu, runs, pause, the run-over panorama and summary, profile and
// settings, on the same shell as the Wobble Lab. Tuning is gameplay.md §14's defaults; the only
// per-player changes are the level unlocks (§10.3), gentle first runs (§8.4) and Settings.

import type { AudioDirector } from '@audio';
import { BY_ID, RunTracker, grantHistory, grantStreaks, payAchievements, type Achievement } from './meta/achievements.ts';
import type { Sim } from './sim/sim.ts';
import { biomeFor, type Tuning } from './sim/tuning.ts';
import type { LabState } from './view/panel.ts';
import type { RunOpts } from './view/scene.ts';
import { addRunStats, award, dailyWindReady, loadProfile, nextJuice, saveProfile, spendDailyWind, updateStreak } from './view/profile.ts';
import { Screens, type UiSound } from './view/screens.ts';
import { applyAudio, loadSettings, saveSettings, tuningFor, viewFor } from './view/settings.ts';
import { ENDLESS, type RunMode } from './view/modes.ts';
import { BUILD, startShell } from './view/shell.ts';
import { TrophyToasts } from './view/trophies.ts';
import { setupNative } from './native.ts';

/** Calls Sound adds in its next module version, made safe until then. */
type Director = AudioDirector & { setJuice?(on: boolean): void; screen?(name: 'menu' | 'profile' | 'none'): void };

const TIER_RANK = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Zen's own best height: a Zen tower never moves Endless's records (QA F17.4). */
const ZEN_BEST = 'shape-tower-best-zen';
/** When the Zen card shows (ms into the run): once the biome title card has gone. */
const ZEN_CARD_AFTER = 2600;

async function boot(): Promise<void> {
  const settings = loadSettings();
  const profile = loadProfile();
  // Gate 1 (QA's protocol, qa/gate1-protocol.md): each run's juice is set when it starts.
  let juice = true;
  let juiceRun = -1;
  const firstOpen = profile.sliceRuns === 0;
  const state: LabState = { tuning: {}, view: viewFor(settings, juice) };
  let dailyWind = false;
  let mode: RunMode = ENDLESS; // the run being played (or just played)
  let screens: Screens | null = null; // made once the shell is up; the audio can arrive first
  let skipTap: ((e: PointerEvent) => void) | null = null;

  // Achievements (gameplay.md §18): what the player's history already proves, then one tracker per run.
  if (grantHistory(profile).length) saveProfile(profile);
  let tracker: RunTracker | null = null;
  let trackNext = false; // the next run_start begins a tracked run (the menu's demo tower isn't one)
  let unlockSound: (a: Achievement, inRun: boolean) => void = () => {};
  const toasts = new TrophyToasts({ reducedMotion: () => settings.reduceMotion, juice: () => juice, sound: a => unlockSound(a, true) });

  /** The tuning a new run starts with. */
  const runTuning = (m: RunMode): Partial<Tuning> => {
    const t: Partial<Tuning> = { ...tuningFor(settings), holdUnlocked: profile.level >= 2, startPower: profile.level >= 6, hazardIntro: !profile.seenGusts, seenHazards: [...profile.seenHazards] };
    if (profile.level <= 1) { t.mortarStrength = 1.2; t.rookieBricks = 4; } // gentle first runs
    switch (m.id) {
      case 'endless': break;
      case 'daily': break;
      case 'zen': t.zen = true; break; // no budget, no hearts to lose, no Second Wind, half XP (gameplay.md §12)
    }
    return t;
  };

  /** What the scene fixes for a run: its seed, Second Wind, which best it climbs past, the record's mode. */
  const runOpts = (m: RunMode): RunOpts => {
    const o: RunOpts = { seed: m.seed, record: { mode: m.id } };
    switch (m.id) {
      case 'endless': break;
      case 'daily': break;
      case 'zen': o.secondWind = 'off'; o.bestKey = ZEN_BEST; break;
    }
    return o;
  };

  const shell = await startShell({
    app: 'game',
    lab: state,
    secondWind() {
      dailyWind = dailyWindReady(profile);
      return dailyWind ? 'ready' : 'earn';
    },
    newPostcard: b => mode.id !== 'zen' && profile.postcards[b] === null, // postcards come from real climbs, like best biome
    brittleIntro: () => !profile.seenBrittle,
    onEvent(e, sim) {
      if (e.name === 'biome_entered') toasts.holdFor(2400); // its title card sits where the toast goes
      if (e.name === 'run_start' && trackNext) {
        trackNext = false;
        // One earned as the run ends (So Close!, a last best) shows only in the summary strip.
        tracker = new RunTracker(sim, profile, { bestBefore: shell.bestBefore, onUnlock: a => { if (sim.state === 'playing') toasts.push(a); }, save: () => saveProfile(profile) });
      }
      if (tracker?.sim === sim) tracker.handle(e);
      if (dailyWind && e.name === 'piece_landed') { dailyWind = false; spendDailyWind(profile); }
      if (e.name === 'hazard_start') {
        const type = String(e.payload.type ?? 'gust');
        if (type === 'gust' && !profile.seenGusts) { profile.seenGusts = true; saveProfile(profile); }
        else if (type !== 'gust' && !profile.seenHazards.includes(type)) { profile.seenHazards.push(type); saveProfile(profile); }
      }
      if (e.name === 'piece_spawned' && !profile.seenBrittle && (e.payload.brittle || (e.payload.nextBrittle as boolean[] | undefined)?.some(Boolean))) {
        profile.seenBrittle = true;
        saveProfile(profile);
      }
    },
    onRunOver: (sim, p) => runOver(sim, p),
    onAudio: a => { applyAudio(settings, a); if (screens?.current === 'menu') (a as Director).screen?.('menu'); },
  });
  const { scene, hud } = shell;
  const audio = () => shell.audio as Director | null;
  // Sound's achievement sting: a stamp and a sparkle that grows with the tier.
  unlockSound = (a, inRun) => audio()?.handle('achievement', { id: a.id, tier: a.tier, inRun });
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.profile = profile;
  // For QA's browser checks: the toasts and this run's achievement tracker.
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.trophies = { toasts, get tracker() { return tracker; } };

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
    toasts.clear();
    showHud(false);
    scene.paused = false;
    scene.demo();
    audio()?.screen?.('menu');
    sc.menu({
      profile, build: BUILD,
      still: menuShown || settings.reduceMotion, // the logo drops in once per visit
      onPlay: () => play(),
      onMode: id => { if (id === 'zen') play({ id: 'zen' }); else play({ id: 'daily' }); },
      onProfile: () => { audio()?.screen?.('profile'); sc.profile(profile, home, () => saveProfile(profile)); },
      onSettings: () => { audio()?.screen?.('profile'); openSettings(home); },
      note: firstOpen && profile.sliceRuns === 0 ? 'Testing: some runs play without effects. Tap how each one felt.' : undefined,
    });
    menuShown = true;
  }

  function play(m: RunMode = ENDLESS): void {
    stopSkip();
    shell.unlockAudio();
    sc.close();
    mode = m;
    ({ juice, juiceRun } = nextJuice(profile));
    state.tuning = runTuning(m);
    state.view = viewFor(settings, juice);
    scene.applyView(state.view);
    audio()?.setJuice?.(juice);
    audio()?.screen?.('none');
    hud.lockHold(profile.level < 2);
    showHud(true);
    toasts.clear();
    tracker = null;
    trackNext = true;
    dailyWind = false; // set again only when the run asks for the day's free Second Wind
    scene.newRun(false, runOpts(m));
    scene.paused = false;
    scene.start();
    // Zen's card follows the run's biome title card, which sits in the same place.
    if (m.id === 'zen') {
      const sim = scene.sim;
      setTimeout(() => { if (scene.sim === sim && sim.state === 'playing') hud.zenCard(settings.reduceMotion); }, ZEN_CARD_AFTER);
    }
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
      zen: mode.id === 'zen',
      onResume: resume,
      onRestart: () => {
        shell.record?.finish(scene.sim, { abandoned: true, juiceRun, player: profile.player });
        play(mode);
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
  // Android's back button: a card's own way back, else pause a run; on the menu the app minimizes.
  setupNative({
    onBack() {
      if (sc.current === 'menu') return false;
      if (sc.current) {
        document.querySelector<HTMLElement>(['close', 'resume', 'continue', 'home'].map(a => `.sc-root [data-action="${a}"]`).join(', '))?.click();
        return true;
      }
      pause();
      return true;
    },
  });

  function stopSkip(): void {
    if (skipTap) document.removeEventListener('pointerdown', skipTap);
    skipTap = null;
  }

  function runOver(sim: Sim, p: Record<string, unknown>): void {
    const height = Number(p.height ?? 0) - sim.foundations[0].top;
    // Quitting is how a Zen run ends, so it doesn't count as a quit: no halving, and the Daily Boost
    // still applies (QA Q33, F11.7). Zen climbs past its own best, for show only: no XP and no records.
    const zen = mode.id === 'zen';
    const quit = sim.cause === 'quit' && !zen;
    const bestBefore = shell.bestBefore;
    const newBest = height > bestBefore + 0.05 && bestBefore > 0;
    const biome = biomeFor(sim.checkpoint).id;
    addRunStats(profile, { height, biome, bricks: sim.stats.placed, perfects: sim.stats.perfects, rows: sim.stats.rows, checkpoints: sim.stats.checkpoints, clutches: sim.stats.clutches }, undefined, !zen);
    // Achievements: streaks count once today is in the streak, then everything earned and not yet paid
    // goes into this tally as flat XP lines (gameplay.md §18.1).
    tracker = null;
    toasts.clear();
    updateStreak(profile);
    grantStreaks(profile);
    const paid = payAchievements(profile);
    const earned = paid.ids.map(id => BY_ID.get(id)!);
    const a = award(profile, Number(p.xp ?? 0), { newBest: newBest && !zen, quit, mode: mode.id, extra: paid });
    const rec = shell.record;
    rec?.finish(sim, { xp: a.gained, xpBase: Number(p.xp ?? 0), level: profile.level, runNumber: profile.runs, newBest: a.lines.some(l => l[0] === 'New best'), view: { ...state.view }, juiceRun, player: profile.player, achievements: paid.ids });
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
      hud.clearAlerts(); // the "OUT OF SHAPES!" stamp, if a tap skipped the glide
      sc.summary({
        stats: {
          cause: zen ? 'zen' : sim.cause ?? '', height, newBest: zen ? newBest : a.lines.some(l => l[0] === 'New best'), bestLabel: zen ? 'New Zen best!' : undefined, biome: biome - 1,
          checkpoints: sim.stats.checkpoints, perfects: sim.stats.perfects, rows: sim.stats.rows, clutches: sim.stats.clutches, score: sim.score,
        },
        award: a,
        achievements: earned,
        questions,
        onAnswer: (id, answer) => rec?.answer(id, answer),
        onAgain: () => { rec?.exit('again'); play(mode); },
        onProfile: () => { rec?.exit('menu'); audio()?.screen?.('profile'); sc.profile(profile, home, () => saveProfile(profile)); },
        onHome: () => { rec?.exit('menu'); home(); },
        reducedMotion: settings.reduceMotion,
      });
      // One sting for the strip: the highest tier earned.
      if (earned.length) unlockSound(earned.reduce((b, x) => (TIER_RANK[x.tier] > TIER_RANK[b.tier] ? x : b)), false);
    });
  }

  home();
}

void boot();
