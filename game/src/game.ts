// Shape Tower, the game: main menu, runs, pause, the run-over panorama and summary, profile and
// settings, on the same shell as the Wobble Lab. Tuning is gameplay.md §14's defaults; the only
// per-player changes are the level unlocks (§10.3), gentle first runs (§8.4) and Settings.
// Modes (§12): Endless from Play, the Daily Tower's card from its button (level 3), and Zen (level 8).
// Blockling Pop (the Pop plan, level 2) is a mode of its own on the same profile: game/src/pop/.

import type { AudioDirector } from '@audio';
import { BY_ID, RunTracker, grantDaily, grantHistory, grantStreaks, payAchievements, type Achievement } from './meta/achievements.ts';
import { StoreSync } from './meta/stores.ts';
import {
  addPractice, beginScored, bestDays, countdown, dailyDay, dailyNumber, dailySeed, dailyShapes, dailyStreak, msToNextDaily, scoredUsed, updateScored, type DailyResult,
} from './meta/daily.ts';
import type { Sim } from './sim/sim.ts';
import { biomeFor, type Tuning } from './sim/tuning.ts';
import type { LabState } from './view/panel.ts';
import type { RunOpts } from './view/scene.ts';
import { addRunStats, award, dailyWindReady, loadProfile, nextJuice, saveProfile, spendDailyWind, updateStreak } from './view/profile.ts';
import { Screens, type ProfileIdentity, type SettingsShop, type UiSound } from './view/screens.ts';
import { applyAudio, loadSettings, saveSettings, tuningFor, viewFor } from './view/settings.ts';
import { ENDLESS, type RunMode } from './view/modes.ts';
import { BUILD, startShell } from './view/shell.ts';
import { TrophyToasts } from './view/trophies.ts';
import { DailyLadder } from './view/ladder.ts';
import { gameServices, isNativeApp, nativePlatform, requestReview, setupNative } from './native.ts';
import { ADS, addRunTime, adCheck, adShown, freshAds, loadAds, type AdState } from './meta/ads.ts';
import { Store } from './store/store.ts';
import { adNetwork } from './store/admob.ts';
import { Workshop } from './view/workshop.ts';
import { PRODUCTS, supporterOffer } from './meta/shop.ts';
import { ownerOf, runLook, wornLook } from './view/look.ts';
import { badgeFrame, hatFor, passRewardAt, passRewardsBetween, setBadgeFrame } from '@art/index.ts';
import { splashDone, splashFailed } from './view/splash.ts';
import { sharePostmark, type ShareRun } from './meta/share.ts';
import { loadReview, markAsked, shouldAskReview } from './meta/review.ts';
import type { RunKind } from './meta/stats.ts';
import { statsUrl } from './online/online.ts';
import { Stats } from './online/stats.ts';
import { canShare, shareNote, shareRun, towerOf } from './view/share.ts';
import { PopSim } from './pop/sim/pop.ts';
import { replay } from './pop/sim/record.ts';
import { POP_TUNING } from './pop/sim/tuning.ts';
import { PopView } from './pop/view/popview.ts';
import { PopRunRecord, loadPopSave, writePopSave } from './pop/save.ts';

/** Calls Sound adds in its next module version, made safe until then. */
type Director = AudioDirector & { setJuice?(on: boolean): void; setZen?(on: boolean): void; screen?(name: 'menu' | 'profile' | 'none'): void };

const TIER_RANK = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Zen's own best height: a Zen tower never moves Endless's records (QA F17.4). */
const ZEN_BEST = 'shape-tower-best-zen';
/** When the Zen card shows (ms into the run): once the biome title card has gone. */
const ZEN_CARD_AFTER = 2600;
/** The ad meter (meta/ads.ts), kept between visits. */
const ADS_KEY = 'shape-tower-ads-v1';
/** When the game last asked the store for a rating (meta/review.ts). */
const REVIEW_KEY = 'shape-tower-review-v1';

async function boot(): Promise<void> {
  const settings = loadSettings();
  const profile = loadProfile();
  // Each run's juice is set when it starts: always on since Gate 1's juice-off runs ended (view/profile.ts nextJuice).
  let juice = true;
  let juiceRun = -1;
  const state: LabState = { tuning: {}, view: viewFor(settings, juice) };
  let dailyWind = false;
  let mode: RunMode = ENDLESS; // the run being played (or just played)
  let runSim: Sim | null = null; // that run's sim (the menu's demo tower makes others)
  let screens: Screens | null = null; // made once the shell is up; the audio can arrive first
  let skipTap: ((e: PointerEvent) => void) | null = null;

  // The Workshop's store and the ads between runs (monetisation plan v2). Ads only exist in the store
  // apps: on the web the network is a no-op.
  const store = new Store();
  let ads = adNetwork();
  const adState: AdState = (() => { try { return loadAds(JSON.parse(localStorage.getItem(ADS_KEY) ?? 'null')); } catch { return freshAds(); } })();
  const saveAds = () => { try { localStorage.setItem(ADS_KEY, JSON.stringify(adState)); } catch { /* fine without it */ } };
  let adAsked = true; // this run end's one ad check is spent (true until a run ends)

  // Achievements (gameplay.md §18): what the player's history already proves, then one tracker per run.
  if (grantHistory(profile).length) saveProfile(profile);
  let tracker: RunTracker | null = null;
  let trackNext = false; // the next run_start begins a tracked run (the menu's demo tower isn't one)
  let unlockSound: (a: Achievement, inRun: boolean) => void = () => {};
  const toasts = new TrophyToasts({ reducedMotion: () => settings.reduceMotion, juice: () => juice, sound: a => unlockSound(a, true) });
  // The phone's game service (Play Games or Game Center, §18.5): nothing on the game page.
  const stores = new StoreSync(gameServices());
  void stores.start(profile);

  /** The tuning a new run starts with. */
  const runTuning = (m: RunMode): Partial<Tuning> => {
    const t: Partial<Tuning> = { ...tuningFor(settings), holdUnlocked: profile.level >= 2, startPower: profile.level >= 6, hazardIntro: !profile.seenGusts, seenHazards: [...profile.seenHazards] };
    if (profile.level <= 1) { t.mortarStrength = 1.2; t.rookieBricks = 4; } // gentle first runs
    switch (m.id) {
      case 'endless': break;
      // Only the day's shapes fall (§12.3). Scored tries start with empty power-up slots for everyone
      // (§10.3); Second Wind is off (runOpts).
      case 'daily': t.shapeSet = dailyShapes(m.day!); if (m.scored) t.startPower = false; break;
      case 'zen': t.zen = true; break; // no budget, no hearts to lose, no Second Wind, half XP (gameplay.md §12)
    }
    return t;
  };

  /** What the scene fixes for a run: its seed, Second Wind, which best it climbs past, the record's mode. */
  const runOpts = (m: RunMode): RunOpts => {
    const o: RunOpts = { seed: m.seed, record: { mode: m.id } };
    switch (m.id) {
      case 'endless': break;
      case 'daily': {
        // Second Wind: off in a scored try; Daily practice earns it at checkpoint 2 (the day's free one is Endless's).
        o.secondWind = m.scored ? 'off' : 'earn';
        o.record = { ...o.record, daily: { day: m.day!, number: dailyNumber(m.day!), scored: !!m.scored } };
        break;
      }
      case 'zen': o.secondWind = 'off'; o.bestKey = ZEN_BEST; break;
    }
    return o;
  };

  const shell = await startShell({
    app: 'game',
    lab: state,
    // Endless asks here (Daily and Zen fix their own in runOpts). Second Wind, always ready (the $1.99
    // upgrade) has it waiting every run, so the day's free one isn't spent; still once per run.
    secondWind() {
      if (store.ent.windAlways) { dailyWind = false; return 'ready'; }
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
        tracker = new RunTracker(sim, profile, { bestBefore: shell.bestBefore, onUnlock: a => { if (sim.state === 'playing') toasts.push(a); void stores.report(a.id); }, save: () => saveProfile(profile) });
      }
      if (tracker?.sim === sim) tracker.handle(e);
      if (sim === runSim && mode.id === 'daily' && mode.scored) dailyEvent(e.name, sim);
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
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.trophies = { toasts, stores, get tracker() { return tracker; } };
  // QA's browser checks can swap in a pretend ad network to walk the ad step on the web.
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.shop = {
    store, adState, ADS, get ads() { return ads; }, useAds(n: typeof ads) { ads = n; },
    adCheck: () => adCheck(adState, { level: profile.level, noAds: store.ent.noAds }),
  };

  hud.labBtn.style.display = 'none';
  const showHud = (on: boolean) => { hud.root.style.display = on ? '' : 'none'; };
  const sc = screens = new Screens(document.body, {
    ui: (kind: UiSound) => { shell.unlockAudio(); audio()?.ui(kind); },
    xpTick: () => audio()?.handle('xp_tick', {}),
    levelUp: level => audio()?.handle('level_up', { level }),
  });
  sc.stores = { label: () => stores.label(), open: () => void stores.open(profile) };
  // The ad meter counts active run time only: a run playing, not paused, nothing over it, the app in front.
  let meterAt = performance.now();
  setInterval(() => {
    const now = performance.now(), dt = Math.min(2000, now - meterAt);
    meterAt = now;
    if (runSim && scene.sim === runSim && runSim.state === 'playing' && scene.started && !scene.paused && !sc.current && !document.hidden) addRunTime(adState, dt, profile.level);
    // Blockling Pop shares the ad meter (Pop plan §13): its active run time counts the same.
    else if (pop?.active && pop.sim && !pop.sim.over && !pop.paused && !sc.current && !document.hidden) addRunTime(adState, dt, profile.level);
  }, 1000);

  // The Daily ladder (§12.3): the menu and profile show the player's name once they have one; it's their
  // ladder name too, picked from the Profile or the Daily card (§10.3).
  const ladder = new DailyLadder(profile, () => settings.reduceMotion, name => { sc.playerName = name ?? 'Builder'; });

  // The anonymous play stats (launch marketing plan; PRIVACY.md): the phone apps only, under a switch in
  // Settings. A player with runs from before the stats isn't counted as a new install.
  const stats = new Stats({
    url: statsUrl(isNativeApp()), key: () => ladder.ladder?.state.key ?? null, platform: nativePlatform(), build: BUILD.split(' ')[0],
    on: () => settings.stats !== false,
  });
  sc.statsSetting = !!statsUrl(isNativeApp());
  const newPlayer = profile.runs === 0;
  void ladder.ready.then(() => stats.start(profile.level, newPlayer));
  // The store's rating card, after a happy moment (meta/review.ts). QA's checks can stand in for the store.
  const review = (() => { try { return loadReview(JSON.parse(localStorage.getItem(REVIEW_KEY) ?? 'null')); } catch { return loadReview(null); } })();
  const reviewer = { available: isNativeApp(), ask: requestReview };
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.marketing = { stats, review, reviewer };
  const saveLook = () => { saveProfile(profile); ladder.restyle(); applyLook(); };
  const identity: ProfileIdentity = {
    get: () => ({ ...ladder.identity(), still: settings.reduceMotion }),
    onName: back => { void ladder.ready.then(() => sc.ladderName(ladder.nameHooks(back))); },
  };
  const workshop = new Workshop(sc, store, {
    avatar: () => profile.avatar, still: () => settings.reduceMotion, adsLive: () => ads.live, level: () => profile.level,
    bought: () => audio()?.ui('unlock'),
  });
  /** The Workshop, from the menu, Settings or a locked shop portrait; `back` is where its close goes. */
  function openWorkshop(back: () => void = home, focus?: string): void {
    audio()?.screen?.('profile');
    workshop.open(back, focus);
  }
  /** A product as the Workshop shows it: the Supporter Pack is whichever offer fits what they own. */
  const offerFor = (id: string | undefined): string | undefined => (id === 'supporter_pack' ? supporterOffer(store.list())?.id : id);
  // Bought portraits show in the picker, and a locked one opens the Workshop on it, then comes back to the card.
  ladder.bought = () => store.ent.portraits;
  ladder.receipt = portrait => store.receiptFor(portrait);
  ladder.shop = (portrait, back) => openWorkshop(() => sc.ladderName(ladder.nameHooks(back)),
    portrait === 'supporter' ? offerFor('supporter_pack') : PRODUCTS.find(p => p.portrait === portrait && !p.soon)?.id);

  // The look (monetisation plan v2, cosmetics): what runs wear, the Supporter badge frame, and the
  // Workshop from the locked items. Ownership follows the store, so a refund takes its items back.
  const applyLook = () => {
    scene.setLook(runLook(profile, store.ent));
    setBadgeFrame(store.ent.supporter ? 'supporter' : null);
  };
  applyLook();
  // For QA's browser checks: what the run wears and the badge frame.
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.look = { worn: () => wornLook(profile, store.ent), scene: () => scene.look, frame: badgeFrame };
  store.onChange(() => {
    // A hat they no longer own comes off once the store has answered (not from an offline cache).
    if (store.status === 'ready') {
      const hat = wornLook(profile, store.ent).hat;
      const key = hat ? hatFor(hat) : null;
      if ((profile.avatar.hat ?? null) !== key) { profile.avatar = { ...profile.avatar, hat: key }; saveLook(); }
    }
    applyLook();
  });
  sc.looks = {
    ent: () => store.ent,
    owner: p => ownerOf(p, store.ent),
    still: () => settings.reduceMotion,
    // From the run summary (back is null) the Workshop goes home after, and this run end skips its ad.
    onWorkshop: (product, back) => { if (!back) adAsked = true; openWorkshop(back ?? home, offerFor(product)); },
    levelPass: (from, to) => {
      if (store.ent.pass) return passRewardAt(to) ? { pass: 'owned' } : null;
      // The pass's one mention, ever: the level-10 card, for players without it (plan v2, "One introduction").
      if (from < 10 && to >= 10 && !profile.passIntro && passRewardAt(to)) {
        profile.passIntro = true;
        saveProfile(profile);
        return { pass: 'intro', passWaiting: passRewardsBetween(2, to).length };
      }
      return null;
    },
  };

  // ------------------------------------------------------------------ flow

  let menuShown = false;
  function home(): void {
    stopSkip();
    toasts.clear();
    showHud(false);
    scene.paused = false;
    scene.demo();
    audio()?.screen?.('menu');
    // Google's consent form, where the law asks for it, shows over the menu once ads could start.
    if (ads.live && profile.level >= ADS.minLevel && !store.ent.noAds) void ads.consent();
    const today = dailyDay();
    const done = scoredUsed(profile.daily, today);
    const popSaved = loadPopSave();
    sc.menu({
      profile, build: BUILD,
      still: menuShown || settings.reduceMotion, // the logo drops in once per visit
      subs: {
        daily: done ? `Done today · new in ${countdown(msToNextDaily())}` : `#${dailyNumber(today)} is ready`,
        pop: popSaved ? 'Continue your run' : profile.pop.best > 0 ? `Best ${profile.pop.best.toLocaleString('en-US')}` : 'Fit shapes, pop lines',
      },
      dailyDot: !done,
      onPlay: () => play(),
      onMode: id => { if (id === 'zen') play({ id: 'zen' }); else if (id === 'pop') openPop(); else openDaily(); },
      onProfile: () => { audio()?.screen?.('profile'); sc.profile(profile, home, saveLook, identity); },
      onSettings: () => { audio()?.screen?.('profile'); openSettings(home, true); },
      onWorkshop: () => openWorkshop(home),
    });
    menuShown = true;
  }

  // ------------------------------------------------------------------ Daily Tower (§12, QA F17)

  function openDaily(): void {
    audio()?.screen?.('profile');
    sc.daily({
      data: () => {
        const day = dailyDay();
        const d = profile.daily, s = scoredUsed(d, day) ? d.scored[day] : null, pr = d.practice[day];
        return {
          number: dailyNumber(day), day, countdown: countdown(msToNextDaily()), shapes: dailyShapes(day),
          scored: s, practice: { runs: pr?.runs ?? 0, best: pr?.best ?? null }, streak: dailyStreak(d, day),
          bestDays: bestDays(d, 3).map(b => ({ number: b.number, height: b.result.height, score: b.result.score, today: b.day === day })),
          ladder: ladder.loadingPanel(),
        };
      },
      ladder: ladder.hooks(() => sc.ladderName(ladder.nameHooks(openDaily))),
      countdown: () => { const ms = msToNextDaily(); return { ms, text: countdown(ms) }; },
      // The seed is the one showing when the button is tapped; a try that starts just before 00:00 UTC
      // plays out under it (F17.2).
      onScored: () => {
        const day = dailyDay();
        if (scoredUsed(profile.daily, day)) { openDaily(); return; }
        play({ id: 'daily', seed: dailySeed(day), scored: true, day });
      },
      onPractice: practiceDaily,
      onClose: home,
    });
  }

  /** Practice on today's tower (after 00:00 UTC that's the new one). */
  function practiceDaily(): void {
    const day = dailyDay();
    play({ id: 'daily', seed: dailySeed(day), scored: false, day });
  }

  /**
   * A scored try is spent when its first shape spawns (QA Q32), and its result is kept as it climbs.
   * A named player's ladder row follows it: at the start, each checkpoint, a pause and the end (§12.3).
   */
  function dailyEvent(name: string, sim: Sim): void {
    const day = mode.day!;
    if (name === 'piece_spawned' && !scoredUsed(profile.daily, day)) { beginScored(profile.daily, day); saveProfile(profile); ladder.submit(day); }
    if (name === 'checkpoint_claimed') saveScored(sim);
  }

  function saveScored(sim: Sim, finished = false): void {
    if (mode.id !== 'daily' || !mode.scored || sim !== runSim) return;
    updateScored(profile.daily, mode.day!, dailyResult(sim), finished);
    saveProfile(profile);
    ladder.submit(mode.day!);
  }

  const dailyResult = (sim: Sim): Omit<DailyResult, 'at' | 'finished'> => ({
    height: sim.stats.maxHeight - sim.foundations[0].top, score: sim.score, checkpoints: sim.stats.checkpoints, biome: biomeFor(sim.checkpoint).id,
  });

  // ------------------------------------------------------------------ runs

  function play(m: RunMode = ENDLESS): void {
    stopSkip();
    shell.unlockAudio();
    sc.close();
    mode = m;
    dailyWind = false; // set again by the shell's secondWind() if this run asks for it
    // A scored Daily try isn't numbered (it never was part of Gate 1's juice test); every run has its effects.
    if (m.id === 'daily' && m.scored) { juice = true; juiceRun = -1; } else ({ juice, juiceRun } = nextJuice(profile));
    state.tuning = runTuning(m);
    state.view = viewFor(settings, juice);
    scene.applyView(state.view);
    applyLook();
    audio()?.setJuice?.(juice);
    audio()?.setZen?.(m.id === 'zen'); // Zen's holds skip the music's drain, as they skip the grey (gameplay.md §7.3)
    audio()?.screen?.('none');
    hud.lockHold(profile.level < 2);
    showHud(true);
    toasts.clear();
    tracker = null;
    trackNext = true;
    dailyWind = false; // set again only when the run asks for the day's free Second Wind
    scene.newRun(false, runOpts(m));
    runSim = scene.sim;
    hud.setModeTag(m.id === 'daily' ? `DAILY #${dailyNumber(m.day!)} · ${m.scored ? 'SCORED' : 'PRACTICE'}` : null, m.id === 'daily' && !!m.scored);
    scene.paused = false;
    scene.start();
    // Zen's card follows the run's biome title card, which sits in the same place.
    if (m.id === 'zen') {
      const sim = scene.sim;
      setTimeout(() => { if (scene.sim === sim && sim.state === 'playing') hud.zenCard(settings.reduceMotion); }, ZEN_CARD_AFTER);
    }
  }

  /** Settings; from the main menu (`menu`) it has the purchases rows, never from pause. */
  let statsWere = settings.stats;
  function openSettings(back: () => void, menu = false): void {
    sc.settings(settings, s => {
      if (s.stats !== statsWere) { statsWere = s.stats; stats.setOn(s.stats); }
      saveSettings(s);
      state.view = viewFor(s, juice);
      scene.applyView(state.view);
      scene.retune(tuningFor(s));
      applyAudio(s, audio());
    }, back, ladder.ladder?.named ? () => ladder.forget() : undefined, menu ? shopRows(back) : undefined);
  }

  function shopRows(back: () => void): SettingsShop {
    return {
      ads: !ads.live ? 'none' : store.ent.noAds ? 'off' : 'on',
      onWorkshop: () => openWorkshop(() => openSettings(back, true)),
      async onRestore() {
        const r = await store.restore();
        if (!r.ok) return 'Can\'t reach the store right now. What you own still works.';
        return r.added ? `Restored ${r.added} purchase${r.added === 1 ? '' : 's'}.` : 'Everything you own is already here.';
      },
      onClearTest: store.kind === 'test' ? async () => { store.clearTest(); return 'Test purchases cleared.'; } : undefined,
    };
  }

  /**
   * The one ad check at a run's end, when the player taps on from its summary (after the XP tally and
   * any level-up). Resolves once any ad has closed. An ad that didn't load shows nothing and stays due.
   */
  async function adBreak(): Promise<void> {
    if (adAsked) return;
    adAsked = true;
    if (!ads.live || adCheck(adState, { level: profile.level, noAds: store.ent.noAds }) !== 'due') return;
    // Game audio steps aside while the ad plays.
    const ctx = (shell.game.sound as unknown as { context?: AudioContext }).context;
    const wasRunning = ctx?.state === 'running';
    if (wasRunning) await ctx!.suspend().catch(() => {});
    const shown = await ads.show();
    if (wasRunning) void ctx!.resume().catch(() => {});
    if (shown) { adShown(adState); saveAds(); }
  }

  function pause(): void {
    if (pop?.active) { popPause(); return; }
    if (sc.current || !scene.started || !scene.sim || scene.sim.state !== 'playing') return;
    scene.paused = true;
    audio()?.handle('pause', {});
    saveScored(scene.sim); // the app may not come back
    saveAds();
    const resume = () => { sc.close(); scene.paused = false; audio()?.handle('resume', {}); };
    sc.pause({
      zen: mode.id === 'zen',
      restart: !(mode.id === 'daily' && mode.scored),
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); stats.hidden(); } else stats.visible(profile.level);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'p') pause(); });
  // Android's back button: a card's own way back, else pause a run; on the menu the app minimizes.
  setupNative({
    onBack() {
      if (sc.current === 'menu') return false;
      if (sc.current) {
        // The test store's sheet sits over the Workshop: its Cancel first.
        (document.querySelector<HTMLElement>('.sc-root [data-action="cancel"]')
          ?? document.querySelector<HTMLElement>(['close', 'resume', 'continue', 'home'].map(a => `.sc-root [data-action="${a}"]`).join(', ')))?.click();
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

  // ------------------------------------------------------------------ Blockling Pop (the Pop plan)

  let pop: PopView | null = null;
  let popStarted = Date.now();
  let popRecord: PopRunRecord | null = null;
  const popView = (): PopView => pop ??= new PopView(document.body, {
    audio: () => audio(),
    reducedMotion: () => settings.reduceMotion,
    juice: () => true, // Gate 1's juice test is the tower's; Pop's runs keep their effects
    best: () => profile.pop.best,
    onPause: () => popPause(),
    onChange: sim => writePopSave(sim, pop?.playMs ?? 0, popStarted),
    onOver: sim => popOver(sim),
  });

  /** Into Pop: the saved run if there is one (replayed from its moves), else a new run. */
  function openPop(fresh = false): void {
    stopSkip();
    shell.unlockAudio();
    sc.close();
    toasts.clear();
    showHud(false);
    tracker = null;
    trackNext = false;
    runSim = null;
    const saved = fresh ? null : loadPopSave();
    let sim = saved ? replay(saved.rec) : null;
    if (!sim || sim.over) {
      sim = new PopSim({ seed: (Math.random() * 2 ** 32) >>> 0, newPlayer: profile.pop.runs < POP_TUNING.mercyRuns });
      popStarted = Date.now();
      writePopSave(sim, 0, popStarted);
    } else popStarted = saved!.startedAt;
    popRecord = new PopRunRecord();
    audio()?.setJuice?.(true);
    audio()?.setZen?.(false);
    audio()?.screen?.('none');
    // The tower's scene sleeps under Pop: no frames drawn behind an opaque screen.
    shell.game.loop.sleep();
    popView().start(sim, saved && !fresh ? saved.playMs : 0);
  }

  /** Out of Pop to another screen: the tower's scene wakes for the menu. */
  function leavePop(): void {
    pop?.hide();
    shell.game.loop.wake();
  }

  function popPause(): void {
    const sim = pop?.sim;
    if (!pop?.active || !sim || sim.over || sc.current) return;
    pop.setPaused(true);
    audio()?.handle('pause', {});
    writePopSave(sim, pop.playMs, popStarted); // the app may not come back
    saveAds();
    const resume = () => { sc.close(); pop!.setPaused(false); audio()?.handle('resume', {}); };
    sc.pause({
      pop: true,
      onResume: resume,
      // Restart drops this run, as the tower's does (no XP), and deals a new one.
      onRestart: () => { audio()?.handle('resume', {}); writePopSave(null); openPop(true); },
      onSettings: () => openSettings(() => { sc.close(); popPause(); }),
      // End run banks the XP in full: Pop's XP only counts what the run did (Pop plan §10).
      onQuit: () => { sc.close(); pop!.setPaused(false); audio()?.handle('resume', {}); sim.apply({ t: 'end' }); },
    });
  }

  /** A Pop run is over: records, XP into the one profile, then the results card. */
  function popOver(sim: PopSim): void {
    writePopSave(null);
    const P = profile.pop;
    const newBest = P.best > 0 && sim.score > P.best;
    P.runs++;
    P.best = Math.max(P.best, sim.score);
    P.lines = Math.max(P.lines, sim.lines);
    P.combo = Math.max(P.combo, sim.bestCombo);
    P.biome = Math.max(P.biome, sim.biome + 1);
    P.clears += sim.clears;
    P.totalLines += sim.lines;
    updateStreak(profile);
    grantStreaks(profile);
    const paid = payAchievements(profile);
    void stores.sync(profile);
    const earned = paid.ids.map(id => BY_ID.get(id)!);
    const playMs = pop?.playMs ?? 0;
    // The floor: 5 XP for a run of 30 s or more (Pop plan §12).
    const base = Math.max(sim.xp, playMs >= 30_000 ? 5 : 0);
    const a = award(profile, base, { newBest, quit: false, mode: 'pop', extra: paid });
    const rec = popRecord;
    rec?.finish(sim, { build: BUILD, playMs, startedAt: popStarted, frames: pop?.frames.summary() ?? {}, player: profile.player, level: profile.level, xp: a.gained, newBest });
    adAsked = false;
    saveAds();
    if (ads.live && adCheck(adState, { level: profile.level, noAds: store.ent.noAds }) === 'due') ads.prepare();
    let leaving = false;
    const leave = (fn: () => void) => () => { if (leaving) return; leaving = true; void adBreak().then(fn); };
    sc.summary({
      stats: { cause: sim.cause ?? 'end', height: 0, newBest, biome: sim.biome, checkpoints: sim.cp, perfects: 0, rows: sim.lines, clutches: 0, score: sim.score },
      pop: { lines: sim.lines, combo: sim.bestCombo, clears: sim.clears },
      award: a,
      achievements: earned,
      // Playtest P1 (Pop plan §16): the board's size, the drag and the snap, and fairness.
      questions: [
        { id: 'pop_feel', text: 'How did that run feel?', kind: 'faces' },
        { id: 'pop_drag', text: 'Did dragging and dropping feel right?' },
        { id: 'pop_unfair', text: 'Was it unfair?' },
      ],
      onAnswer: (id, answer) => rec?.answer(id, answer),
      onAgain: leave(() => { rec?.exit('again'); openPop(true); }),
      onProfile: leave(() => { rec?.exit('menu'); leavePop(); audio()?.screen?.('profile'); sc.profile(profile, home, saveLook, identity); }),
      onHome: leave(() => { rec?.exit('menu'); leavePop(); home(); }),
      reducedMotion: settings.reduceMotion,
    });
    if (earned.length) unlockSound(earned.reduce((b, x) => (TIER_RANK[x.tier] > TIER_RANK[b.tier] ? x : b)), false);
  }
  (window as unknown as { __wobble: Record<string, unknown> }).__wobble.pop = { get view() { return pop; }, open: openPop };

  function runOver(sim: Sim, p: Record<string, unknown>): void {
    const height = Number(p.height ?? 0) - sim.foundations[0].top;
    // Quitting is how a Zen run ends, so it doesn't count as a quit: no halving, and the Daily Boost
    // still applies (QA Q33, F11.7). Zen climbs past its own best, for show only: no XP and no records.
    const zen = mode.id === 'zen';
    const quit = sim.cause === 'quit' && !zen;
    const bestBefore = shell.bestBefore;
    const newBest = height > bestBefore + 0.05 && bestBefore > 0;
    const biome = biomeFor(sim.checkpoint).id;
    // The Daily's results: the scored try's final result, or practice (gameplay.md §12).
    if (mode.id === 'daily' && sim === runSim) {
      if (mode.scored) { saveScored(sim, true); grantDaily(profile); }
      else addPractice(profile.daily, mode.day!, { ...dailyResult(sim), at: new Date().toISOString() });
    }
    addRunStats(profile, { height, biome, bricks: sim.stats.placed, perfects: sim.stats.perfects, rows: sim.stats.rows, checkpoints: sim.stats.checkpoints, clutches: sim.stats.clutches }, undefined, !zen);
    // Achievements: streaks count once today is in the streak, then everything earned and not yet paid
    // goes into this tally as flat XP lines (gameplay.md §18.1).
    tracker = null;
    toasts.clear();
    updateStreak(profile);
    grantStreaks(profile);
    const paid = payAchievements(profile);
    void stores.sync(profile);
    const earned = paid.ids.map(id => BY_ID.get(id)!);
    const a = award(profile, Number(p.xp ?? 0), { newBest: newBest && !zen, quit, mode: mode.id, extra: paid });
    const bestShown = a.lines.some(l => l[0] === 'New best');
    const kind: RunKind = mode.id === 'daily' ? (mode.scored ? 'daily' : 'practice') : mode.id;
    stats.runEnd(kind, profile.level, sim.stats.checkpoints, height);
    // The share button's card and text line (view/share.ts), from the tower as it stands now.
    const shareRunData: ShareRun = {
      mode: mode.id, height, checkpoints: sim.stats.checkpoints, newBest: bestShown,
      daily: mode.id === 'daily' ? dailyNumber(mode.day!) : undefined, practice: mode.id === 'daily' && !mode.scored,
    };
    const card = {
      height, biome: biome - 1, newBest: !zen && bestShown, name: ladder.ladder?.me?.name ?? undefined, level: profile.level,
      score: Math.round(sim.score), tower: towerOf(sim, bestBefore), date: sharePostmark(shareRunData),
    };
    // The store's rating card waits for the tally (and any level-up) to finish, and only after a happy moment.
    const moment = { mode: mode.id, scored: !!mode.scored, newBest: !zen && bestShown, checkpoints: sim.stats.checkpoints, quit, runs: profile.runs, level: profile.level };
    const rec = shell.record;
    rec?.finish(sim, { xp: a.gained, xpBase: Number(p.xp ?? 0), level: profile.level, runNumber: profile.runs, newBest: a.lines.some(l => l[0] === 'New best'), view: { ...state.view }, juiceRun, player: profile.player, achievements: paid.ids });
    // This run end gets one ad check, when the player taps on from the summary; a due ad loads meanwhile.
    adAsked = false;
    saveAds();
    if (ads.live && adCheck(adState, { level: profile.level, noAds: store.ent.noAds }) === 'due') ads.prepare();
    // QA's three one-tap questions (Blake, 2026-10-23). The ids are new where the question is: the
    // old 'fair' asked the other way round, so earlier records keep their own meaning.
    const questions: { id: string; text: string; kind?: 'yesno' | 'faces' }[] = [
      { id: 'feel', text: 'How did that run feel?', kind: 'faces' },
      { id: 'hard', text: 'Was it too difficult?' },
      { id: 'unfair', text: 'Was it unfair?' },
    ];
    // The money shot: the camera glides down the whole tower, then the summary card. A tap skips.
    showHud(false);
    skipTap = () => scene.skipPanorama();
    document.addEventListener('pointerdown', skipTap);
    scene.panorama(() => {
      stopSkip();
      hud.clearAlerts(); // the "OUT OF SHAPES!" stamp, if a tap skipped the glide
      // Leaving the summary goes through the run end's ad check first; one tap leaves.
      let leaving = false;
      const leave = (fn: () => void) => () => { if (leaving) return; leaving = true; void adBreak().then(fn); };
      sc.summary({
        stats: {
          cause: zen ? 'zen' : sim.cause ?? '', height, newBest: zen ? newBest : a.lines.some(l => l[0] === 'New best'), bestLabel: zen ? 'New Zen best!' : undefined, biome: biome - 1,
          checkpoints: sim.stats.checkpoints, perfects: sim.stats.perfects, rows: sim.stats.rows, clutches: sim.stats.clutches, score: sim.score,
        },
        award: a,
        achievements: earned,
        questions,
        onAnswer: (id, answer) => rec?.answer(id, answer),
        onAgain: leave(() => { rec?.exit('again'); if (mode.id === 'daily') practiceDaily(); else play(mode); }),
        daily: mode.id === 'daily' ? { number: dailyNumber(mode.day!), scored: !!mode.scored, again: mode.scored ? 'Practice' : 'Practice again' } : undefined,
        onProfile: leave(() => { rec?.exit('menu'); audio()?.screen?.('profile'); sc.profile(profile, home, saveLook, identity); }),
        onHome: leave(() => { rec?.exit('menu'); home(); }),
        reducedMotion: settings.reduceMotion,
        onShare: canShare() ? async () => {
          const out = await shareRun(shareRunData, card);
          stats.share(kind, out === 'shared' || out === 'copied');
          return shareNote(out);
        } : undefined,
        onSettled: () => {
          if (!reviewer.available || !shouldAskReview(review, moment)) return;
          setTimeout(() => {
            if (sc.current !== 'summary' || leaving) return;
            markAsked(review);
            try { localStorage.setItem(REVIEW_KEY, JSON.stringify(review)); } catch { /* asks again another day */ }
            adAsked = true; // never an ad straight after the rating card: it stays due for the next run end
            stats.review();
            void reviewer.ask();
          }, 700);
        },
      });
      // One sting for the strip: the highest tier earned.
      if (earned.length) unlockSound(earned.reduce((b, x) => (TIER_RANK[x.tier] > TIER_RANK[b.tier] ? x : b)), false);
    });
  }

  home();
}

boot().then(splashDone, splashFailed);
