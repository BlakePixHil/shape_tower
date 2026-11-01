// The Audio Director (audio section 9.1): owns the mixer, the sound bank, the
// voice pool, the landing-note ladder and the haptics bridge, and turns
// JuiceBus events and 10 Hz signals into sound. Gameplay code never calls
// anything here except through events, plus ui() and the settings setters.

import { BIOMES, biome, biomeKey, cosmosRotation, type BiomeAudio } from './biomes';
import { SoundBank, type NoteRequest } from './bank';
import { FallbackBaker, ThreadBaker, WorkerBaker, type Baker } from './bake/baker';
import { Haptics, defaultHapticsLevel, type CapacitorHapticsLike, type PatternName } from './haptics';
import { MusicEngine, type MusicScreen } from './music/engine';
import { pent, tonicAt, triadPcs, voice } from './music/composer';
import { popStyleFor } from './music/styles-pop';
import type { MusicStyle } from './music/styles';
import { LandingLadder, type Grade } from './music/ladder';
import { run, scaleNote, tonicChord, type Key } from './music/theory';
import { Mixer, type Overlay } from './mixer';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AudioSettings, type StorageLike } from './settings';
import { clamp, dbToGain, lerp, mulberry32, semis, type Rng } from './synth/dsp';
import { MATERIAL_INSTRUMENT, type InstrumentId } from './synth/instruments';
import { POP_SHAPE_KEYS, SHAPE_VOICE } from './synth/voice';
import {
  DEFAULT_SIGNALS, asMaterial, bool, num, str,
  type BusName, type Category, type HapticsLevel, type Material, type Payload, type Priority, type Signals,
} from './types';
import { Cooldowns, VoiceAllocator, type VoiceInfo } from './voices';

/** Tunable thresholds, exposed so they can be adjusted from playtests. */
export const TUNING = {
  /** approach speed (blocks/s) tier edges: below [0] is a T0 tap */
  tierSpeeds: [1, 3, 7, 13],
  minSpeed: 0.3,
  maxSpeed: 20,
  /** per-body impact spacing (s), and for T0 taps */
  bodyGap: 0.06,
  tapGap: 0.12,
  /** creak, groan and danger thresholds on Gameplay's tension signal */
  creakAt: 0.3,
  groanAt: 0.6,
  dangerAt: 0.85,
  dangerExit: 0.75,
  /** world half-width (blocks) used for panning, and visible height for off-screen fades */
  halfWidth: 6,
  viewHeight: 20,
  /** a piece spawned this long (s) after run_over starts a new run */
  restartGap: 0.5,
  /** shape voices: at most one this often (s); a checkpoint's "yay" may follow sooner */
  voiceGap: 4,
  voiceGapCheckpoint: 1.5,
  /** how hard a landing (0 to 1) gets an "oof", and how often a long hard drop gets a "wheee" */
  oofImpact: 0.6,
  wheeChance: 0.35,
};

export interface DirectorOptions {
  /** Share Phaser's context: (scene.sound as Phaser.Sound.WebAudioSoundManager).context */
  context?: BaseAudioContext;
  /** Pass `Haptics` from '@capacitor/haptics'; false disables haptics. */
  haptics?: CapacitorHapticsLike | null | false;
  /** Halves voice caps and skips live reverb tails. Auto-detected when omitted. */
  lowEnd?: boolean;
  /** Settings storage (localStorage by default; null to disable persistence). */
  storage?: StorageLike | null;
  seed?: number;
  /** Real-time mode installs touch unlock, visibility handling and a 50 ms ticker. Defaults to true for an AudioContext. */
  realtime?: boolean;
  /**
   * Bakes sounds off the main thread. In a Vite game:
   * `import BakeWorker from '@audio/bake/worker?worker&inline'` then `worker: () => new BakeWorker()`,
   * with `worker: { format: 'iife' }` in vite.config (a module worker from an inline blob fails on file://).
   * Without it, baking runs on the main thread in small slices.
   */
  worker?: Worker | (() => Worker) | null;
  /** Gate 1's juice switch (default on); see setJuice. */
  juice?: boolean;
}

interface Playing {
  id: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  bus: BusName;
  baseRate: number;
  slowmo: boolean;
  loop: boolean;
  info?: VoiceInfo;
}

export interface PlayOptions {
  bus?: BusName;
  when?: number;
  gainDb?: number;
  rate?: number;
  pan?: number;
  category?: Category;
  priority?: Priority;
  /** random pitch and level variation (default true) */
  vary?: boolean;
  loop?: boolean;
  offset?: number;
  /** fade-in time in seconds */
  attack?: number;
  /** follows slow motion and hit-stop (default: true except UI) */
  slowmo?: boolean;
}

type UiSound = 'tap' | 'tap2' | 'back' | 'toggleOn' | 'toggleOff' | 'slider' | 'tab' | 'open' | 'close' | 'error' | 'pause' | 'resume' | 'start' | 'badge' | 'unlock';

const UI_SOUNDS: Record<UiSound, string> = {
  tap: 'ui.tap', tap2: 'ui.tap2', back: 'ui.back', toggleOn: 'ui.on', toggleOff: 'ui.off', slider: 'ui.slider',
  tab: 'ui.tap2', open: 'ui.open', close: 'ui.close', error: 'ui.error', pause: 'ui.pause', resume: 'ui.resume',
  start: 'ui.tap', badge: 'stamp', unlock: 'shimmer',
};

export class AudioDirector {
  readonly ctx: BaseAudioContext;
  readonly mixer: Mixer;
  readonly bank: SoundBank;
  readonly voices: VoiceAllocator;
  readonly haptics: Haptics;
  readonly ladder = new LandingLadder();
  /** the adaptive soundtrack (audio section 4) */
  readonly music: MusicEngine;
  /** resolves when every placeholder sound has been baked */
  readonly ready: Promise<void>;

  settings: AudioSettings;
  signals: Signals = { ...DEFAULT_SIGNALS };

  private realtime: boolean;
  private rng: Rng;
  private cool = new Cooldowns();
  private playing = new Map<number, Playing>();
  private ownsContext: boolean;
  private disposers: (() => void)[] = [];
  private isReady = false;
  private storage?: StorageLike | null;
  /** juice on: flourishes, haptics, ducking and a soundtrack that reacts (setJuice) */
  private juice = true;
  /** a Zen run (setZen): no countdown pressure, so the checkpoint hold keeps its suspense to itself */
  private zen = false;
  /** 'pop' while Blockling Pop is open (setMode): handle() takes Pop's own events */
  private modeName: 'tower' | 'pop' = 'tower';
  private popRun: PopRun = newPopRun();

  // run state
  private running = false;
  /** when the last run ended; a spawn right after it must not restart the run mix */
  private overAt = -Infinity;
  private biomeId = 1;
  private key: Key = BIOMES[0].key;
  private checkpointN = 0;
  private maxBiome = 1;
  private entryPlayed = new Set<number>();
  private lastCheckpointAt = -10;
  private landingAt = -10;
  private rateFactor = 1;
  private danger = false;
  private nextBeat = 0;
  private nextCreak = 0;
  private nextSweet = 0;
  private ghostPerfect = false;
  private holdTicks = 0;
  private holding = false;
  private xpCount = 0;
  private lastXp = -10;
  private bed?: { src: AudioBufferSourceNode; gain: GainNode };
  private drumroll?: Playing;
  private scrapes = new Map<string, { p: Playing; last: number }>();
  private hazardLoops = new Map<string, Playing>();
  /** Slow-Mo power-up running (impacts sink a little, music and ambience soften) */
  private slowPower = false;
  private lastSweep: { p: Playing | null; at: number } = { p: null, at: -10 };
  private secondWindAt = -10;
  private lastGrantAt = -10;
  private bodyMaterial = new Map<string, Material>();
  private lastVoiceAt = -10;
  private activeShape = '';
  private lastShape = '';
  private recent: { t: number; name: string }[] = [];

  constructor(opts: DirectorOptions = {}) {
    const g = globalThis as any;
    this.ownsContext = !opts.context;
    this.ctx = opts.context ?? new (g.AudioContext ?? g.webkitAudioContext)({ latencyHint: 'interactive' });
    const offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    this.realtime = opts.realtime ?? !offline;
    this.rng = mulberry32(opts.seed ?? 12345);
    this.settings = loadSettings(opts.storage === undefined ? undefined : opts.storage, { haptics: defaultHapticsLevel() });
    this.storage = opts.storage;
    this.mixer = new Mixer(this.ctx);
    this.bank = new SoundBank(this.ctx, opts.seed ?? 1, makeBaker(opts.worker, this.realtime));
    this.music = new MusicEngine(this.ctx, this.mixer.input('music'), this.bank);
    this.setJuice(opts.juice ?? true);
    const sr = this.ctx.sampleRate;
    const reverb = this.bank.baker
      .bake([{ kind: 'ir', seconds: 1.6, seed: opts.seed ?? 7, sr }])
      .then(([[l, r]]) => this.mixer.setReverb(l, r, sr));
    this.voices = new VoiceAllocator(opts.lowEnd ?? detectLowEnd());
    this.haptics = new Haptics({ plugin: this.realtime ? opts.haptics : false, level: this.settings.haptics });
    this.applySettings(0);
    if (this.realtime) this.installRealtime();
    this.ready = Promise.all([reverb, this.bank.build({
      onCore: () => {
        // play can start as soon as the core sounds are in; the rest keeps baking
        this.isReady = true;
        void this.bank.warmNotes([...this.musicFor(this.key, this.material), ...this.metaMusic()]);
        this.music.warmBiome(1);
      },
    })]).then(() => undefined);
  }

  // ------------------------------------------------------------ public API

  now(): number {
    return this.ctx.currentTime;
  }

  /** Main entry point: one JuiceBus event. `when` (context time) is for offline tests. */
  handle(name: string, payload?: Payload, when: number = this.now()): void {
    if (name === 'signals') return this.setSignals(payload, when);
    this.recent.push({ t: when, name });
    if (this.recent.length > 10) this.recent.shift();
    if (!this.isReady) return;
    try {
      this.dispatch(name, payload, when);
    } catch (e) {
      // audio must never take the game down
      if (typeof console !== 'undefined') console.warn('[audio]', name, e);
    }
  }

  setSignals(p: Payload, when: number = this.now()): void {
    const s = this.signals;
    for (const k of Object.keys(DEFAULT_SIGNALS) as (keyof Signals)[]) {
      const v = num(p, k, NaN);
      if (Number.isFinite(v)) s[k] = v;
    }
    if (this.isReady && Math.round(s.biome) !== this.biomeId && this.running) this.switchBiome(Math.round(s.biome), when, false);
    this.tick(when);
  }

  /** Menu and UI sounds. */
  ui(kind: UiSound, when: number = this.now()): void {
    if (!this.isReady) return;
    if (kind === 'start') this.runStartChime(when);
    // the pause and resume events play these too; one sound per press
    else if ((kind === 'pause' || kind === 'resume') && !this.cool.ready('pausefx', when, 0.25)) return;
    else this.play(UI_SOUNDS[kind], { bus: 'ui', when, gainDb: kind === 'slider' ? -18 : -12, category: 'ui', priority: 2, slowmo: false });
    if (kind !== 'slider') this.haptic('uiTap');
  }

  /**
   * Music outside a run: 'menu' for the title and menus, 'profile' for the profile and unlocks
   * (a lighter arrangement), 'none' for silence. Results music starts by itself after a run.
   */
  screen(name: MusicScreen | 'none', when: number = this.now()): void {
    if (this.running || this.popRun.on) return;
    if (name === 'none') return this.music.stop(when);
    if (name !== 'results' && name !== 'popResults') this.mixer.setBase('menu', when, 0.5);
    this.music.showScreen(name, when);
  }

  /**
   * Blockling Pop (the Pop plan): 'pop' while a Pop run shows, 'tower' when it leaves. In Pop, handle()
   * takes Pop's own events (POP_EVENTS) and the tower's are ignored; Pop's sounds bake when it opens and
   * go when the tower comes back. Leaving in the middle of a run closes it quietly.
   */
  setMode(mode: 'tower' | 'pop', when: number = this.now()): void {
    if ((mode !== 'tower' && mode !== 'pop') || mode === this.modeName) return;
    if (this.popRun.on) this.endPop(when);
    if (mode === 'pop' && this.running) this.attach(when);
    this.modeName = mode;
    void this.bank.prepareMode(mode);
  }

  get mode(): 'tower' | 'pop' {
    return this.modeName;
  }

  setVolume(bus: 'music' | 'sfx' | 'voices', linear: number): void {
    this.settings[bus] = clamp(linear, 0, 1);
    this.applySettings(this.now());
    this.persist();
    if (bus === 'sfx' && this.isReady) this.ui('slider');
  }

  setHapticsLevel(level: HapticsLevel): void {
    this.settings.haptics = level;
    this.haptics.level = level;
    this.persist();
  }

  setMono(on: boolean): void {
    this.settings.mono = on;
    this.mixer.setMono(on);
    this.persist();
  }

  setCalm(on: boolean): void {
    this.settings.calm = on;
    this.persist();
  }

  setLockOnChime(on: boolean): void {
    this.settings.lockOnChime = on;
    this.persist();
  }

  /**
   * Gate 1's juice switch (vertical slice G5). Off keeps every sound that says what happened
   * (impacts, settles, hearts, the checkpoint clack, warnings, creaks, hazards, UI) and drops
   * the flourishes: the landing-note melody, shimmers, confetti, fireworks, coin cascades,
   * stinger chords, biome entry moments, shape voices, ducking and haptics. The music keeps
   * playing but stops reacting to the run. Set it before the run starts.
   */
  setJuice(on: boolean): void {
    this.juice = on;
    this.music.reactive = on;
  }

  /**
   * Zen runs (no bricks, no hearts) keep checkpoints and holds but have no countdown pressure,
   * so, like the game's view, the hold doesn't drain the mix or catch its breath on a knock.
   * Set it before the run starts, with setJuice.
   */
  setZen(on: boolean): void {
    this.zen = on;
  }

  get juiceOn(): boolean {
    return this.juice;
  }

  /**
   * A new JuiceBus was connected (connectJuiceBus calls this): a run still going on the old
   * bus is closed quietly, so the new sim's first spawn starts a fresh run mix and band.
   */
  attach(when: number = this.now()): void {
    if (!this.running) return;
    this.running = false;
    this.overAt = -Infinity;
    this.danger = this.holding = false;
    this.stopDrumroll(when);
    for (const [, sc] of this.scrapes) this.stopPlaying(sc.p, when, 0.05);
    this.scrapes.clear();
    for (const [, l] of this.hazardLoops) this.stopPlaying(l, when, 0.2);
    this.hazardLoops.clear();
    this.setSlowPower(false, when);
    this.music.stop(when);
  }

  /** Resume audio after a user gesture (also installed automatically in real-time mode). */
  async unlock(): Promise<void> {
    const ctx = this.ctx as AudioContext;
    try {
      const nav = (globalThis as any).navigator;
      // keep Web Audio "ambient" on iOS: obeys the silent switch, mixes with the player's music
      if (nav?.audioSession && nav.audioSession.type !== 'ambient') nav.audioSession.type = 'ambient';
    } catch {
      /* not supported */
    }
    if (typeof ctx.resume === 'function' && ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    // a silent one-sample buffer finishes the unlock on older WebKit
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start();
  }

  debugState() {
    return {
      ready: this.isReady,
      contextState: (this.ctx as AudioContext).state,
      voices: this.voices.count(),
      byCategory: this.voices.counts(),
      peakVoices: this.voices.peakCount,
      mix: this.mixer.state(),
      biome: biome(this.biomeId).name,
      key: this.key,
      streak: this.ladder.currentStreak,
      danger: this.danger,
      signals: { ...this.signals },
      lastEvents: [...this.recent],
      memoryMB: Math.round(this.bank.bytes() / 1e5) / 10,
      latency: { base: (this.ctx as AudioContext).baseLatency, output: (this.ctx as AudioContext).outputLatency },
      haptics: this.haptics.backend.name,
      baking: this.bank.baker.name,
      music: this.music.state(),
      mode: this.modeName,
      pop: { on: this.popRun.on, combo: this.popRun.combo, step: this.popRun.step, cp: this.popRun.cp, shimmer: !!this.popRun.shimmer },
    };
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.music.stop(this.now());
    this.stopAll(this.now());
    this.bank.baker.dispose?.();
    if (this.ownsContext && typeof (this.ctx as AudioContext).close === 'function') void (this.ctx as AudioContext).close();
  }

  // ------------------------------------------------------------ playback core

  play(name: string, o: PlayOptions = {}): Playing | null {
    const buf = this.bank.get(name);
    if (!buf) return null;
    return this.playBuffer(buf, { loop: this.bank.loops.has(name), ...o });
  }

  playNote(inst: InstrumentId, midi: number, o: PlayOptions = {}): Playing | null {
    return this.playBuffer(this.bank.note(inst, midi), { category: 'note', priority: 3, vary: false, ...o });
  }

  playChord(inst: InstrumentId, midis: number[], o: PlayOptions = {}, spread = 0): Playing | null {
    return this.playBuffer(this.bank.chord(inst, midis, spread), { category: 'stinger', priority: 2, vary: false, ...o });
  }

  private playBuffer(buf: AudioBuffer, o: PlayOptions): Playing | null {
    const when = Math.max(o.when ?? this.now(), this.now());
    const bus = o.bus ?? 'sfx';
    const vary = o.vary ?? true;
    const gainDb = (o.gainDb ?? 0) + (vary ? (this.rng() * 2 - 1) * 1.5 : 0);
    const slowmo = o.slowmo ?? bus !== 'ui';
    const baseRate = (o.rate ?? 1) * (vary ? 1 + (this.rng() * 2 - 1) * 0.04 : 1);
    const rate = baseRate * (slowmo ? this.rateFactor : 1);
    const category = o.category ?? 'misc';
    const priority = o.priority ?? 3;
    const loudness = dbToGain(gainDb);

    const adm = this.voices.admit({ category, priority, loudness, now: when });
    if (!adm.ok) return null;
    for (const v of adm.victims) {
      v.stop(when);
      this.voices.remove(v.id);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!o.loop;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    if (o.attack && o.attack > 0) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(loudness, when + o.attack);
    } else gain.gain.value = loudness;
    src.connect(gain);
    const pan = this.settings.mono ? 0 : clamp(o.pan ?? 0, -1, 1);
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p).connect(this.mixer.input(bus));
    } else gain.connect(this.mixer.input(bus));

    const id = this.voices.newId();
    const dur = o.loop ? Infinity : (buf.duration - (o.offset ?? 0)) / Math.max(0.05, rate);
    const playing: Playing = { id, src, gain, bus, baseRate, slowmo, loop: !!o.loop };
    const info: VoiceInfo = {
      id, category, priority, loudness, start: when, end: when + dur,
      stop: (t: number) => this.stopPlaying(playing, t, 0.015),
    };
    playing.info = info;
    this.voices.add(info);
    this.playing.set(id, playing);
    src.onended = () => {
      this.playing.delete(id);
      this.voices.remove(id);
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    src.start(when, o.offset ?? 0);
    return playing;
  }

  private stopPlaying(p: Playing, when: number, fade = 0.08): void {
    try {
      p.gain.gain.cancelScheduledValues(when);
      p.gain.gain.setTargetAtTime(0, when, fade / 3);
      p.src.stop(when + fade * 2);
    } catch {
      /* already stopped */
    }
    if (p.info) p.info.end = Math.min(p.info.end, when + fade * 2);
  }

  private stopAll(when: number): void {
    for (const p of this.playing.values()) this.stopPlaying(p, when, 0.05);
    if (this.bed) {
      this.bed.gain.gain.setTargetAtTime(0, when, 0.3);
      this.bed.src.stop(when + 1.5);
      this.bed = undefined;
    }
  }

  /** Ducks a bus under a celebration (juice only). */
  private duck(bus: BusName, db: number, when: number, dur: number): void {
    if (this.juice) this.mixer.duck(bus, db, when, dur);
  }

  /** Changes the speed of everything that follows slow motion (and of sounds started later). */
  private setRateFactor(f: number, when: number): void {
    this.rateFactor = f;
    for (const p of this.playing.values()) {
      if (!p.slowmo) continue;
      p.src.playbackRate.setTargetAtTime(p.baseRate * f, when, 0.04);
    }
  }

  private haptic(name: PatternName, strength = 1, delaySec = 0): void {
    if (!this.realtime || !this.juice) return;
    if (delaySec > 0) setTimeout(() => this.haptics.play(name, strength), delaySec * 1000);
    else this.haptics.play(name, strength);
  }

  // ------------------------------------------------------------ helpers

  private get biomeData(): BiomeAudio {
    return biome(this.biomeId);
  }

  private get material(): Material {
    return this.biomeData.material;
  }

  private instFor(m: Material = this.material): { inst: InstrumentId; octave: number } {
    return MATERIAL_INSTRUMENT[m];
  }

  /** Gentle stereo placement relative to the centre of the view (world x in blocks). */
  private panX(x: number): number {
    return Number.isFinite(x) ? clamp((x - this.signals.cameraX) / TUNING.halfWidth, -1, 1) * 0.3 : 0;
  }

  private point(p: Payload): { x: number; y: number } {
    const v = p?.point as any;
    if (Array.isArray(v)) return { x: Number(v[0]), y: Number(v[1]) };
    if (v && typeof v === 'object') return { x: Number(v.x), y: Number(v.y) };
    return { x: num(p, 'x', NaN), y: num(p, 'y', NaN) };
  }

  /** Quieter for events below the bottom of the screen (world y up, cameraY = view centre). */
  private offscreenDb(y: number): number {
    if (!Number.isFinite(y)) return 0;
    const bottom = this.signals.cameraY - TUNING.viewHeight / 2;
    return y < bottom ? -Math.min(18, (bottom - y) * 1.5) : 0;
  }

  private speedDb(v: number): number {
    const t = Math.log(Math.max(v, TUNING.minSpeed) / TUNING.minSpeed) / Math.log(TUNING.maxSpeed / TUNING.minSpeed);
    return -26 + 26 * clamp(t, 0, 1);
  }

  private tierFor(v: number): number {
    const e = TUNING.tierSpeeds;
    return v < e[0] ? 0 : v < e[1] ? 1 : v < e[2] ? 2 : v < e[3] ? 3 : 4;
  }

  private gravityRate(): number {
    const g = this.signals.gravityScale;
    return g > 1.2 ? semis(-2) : g < 0.7 ? semis(-0.5) : 1;
  }

  private applySettings(when: number): void {
    const s = this.settings;
    this.mixer.setVolume('music', s.music, when);
    this.mixer.setVolume('sfx', s.sfx, when);
    this.mixer.setVolume('ambience', s.sfx, when);
    this.mixer.setVolume('ui', s.sfx, when);
    this.mixer.setVolume('voices', s.voices, when);
    this.mixer.setMono(s.mono);
  }

  private persist(): void {
    saveSettings(this.settings, this.storage === undefined ? undefined : this.storage);
  }

  /** Every note and chord the director plays in `key` with `material`'s instrument (landing ladder, stingers, warnings). */
  private musicFor(key: Key, material: Material): NoteRequest[] {
    const { inst, octave } = MATERIAL_INSTRUMENT[material];
    const o = 12 * octave;
    const out: NoteRequest[] = [];
    for (let d = 0; d <= 9; d++) out.push({ inst, midis: [scaleNote(key, d) + o] });
    for (const size of [1, 2, 3] as const) out.push({ inst, midis: tonicChord(key, size, octave) });
    out.push(
      { inst, midis: tonicChord(key, 3, octave), spread: 0.03 },
      { inst, midis: tonicChord(key, 2, octave), spread: 0.02 },
      { inst: 'clonk', midis: [key.root - 12] },
      { inst: 'bellLow', midis: [key.root - 24] },
      { inst: 'bellLow', midis: [key.root - 12] },
      { inst: 'bellLow', midis: [scaleNote(key, 3) - 12] },
    );
    return out;
  }

  /** Menu and results music: the run-start chime and level-up fanfare, always in the Meadow key. */
  private metaMusic(): NoteRequest[] {
    const key = BIOMES[0].key;
    const { inst, octave } = MATERIAL_INSTRUMENT.wood;
    return [
      ...run(key, 0, 5).map((m) => ({ inst, midis: [m + 12 * octave] })),
      { inst: 'glassBell', midis: tonicChord(key, 2, 0), spread: 0.025 },
      { inst: 'glassBell', midis: tonicChord(key, 3, 0), spread: 0.025 },
    ];
  }

  /** Runs `fn` now if its notes are baked; otherwise bakes them first (in real time) so the game never stalls. */
  private withNotes(items: NoteRequest[], fn: () => void): void {
    if (!this.realtime || this.bank.hasNotes(items)) return fn();
    void this.bank.warmNotes(items).then(fn, fn);
  }

  // ------------------------------------------------------------ the ticker

  /** Continuous behaviour: danger heartbeat, creaks, scrapes, ambience sweeteners, and the music's clock. */
  tick(when: number = this.now()): void {
    if (!this.isReady) return;
    const t = this.signals.tension;
    if (this.running) {
      // danger, with hysteresis so it doesn't flicker at the threshold
      if (!this.danger && t >= TUNING.dangerAt) {
        this.danger = true;
        this.mixer.setOverlay('danger', true, when);
        this.nextBeat = when;
        this.say('uhoh', when + 0.2, { shape: this.lastShape });
      } else if (this.danger && t < TUNING.dangerExit) {
        this.danger = false;
        this.mixer.setOverlay('danger', false, when);
      }
      if (this.danger) {
        while (this.nextBeat < when + 0.15) {
          const at = Math.max(this.nextBeat, when);
          this.play('heartbeat', { when: at, gainDb: this.settings.calm ? -16 : -5, category: 'stinger', priority: 1, vary: false, slowmo: false });
          this.haptic('heartbeat', 1, at - this.now());
          this.nextBeat = at + lerp(0.9, 0.5, clamp((t - TUNING.dangerAt) / (1 - TUNING.dangerAt), 0, 1));
        }
      }
      if (t >= TUNING.creakAt && when >= this.nextCreak) {
        const groan = t >= TUNING.groanAt;
        const db = groan ? lerp(-14, -8, (t - TUNING.groanAt) / 0.4) : lerp(-20, -14, (t - TUNING.creakAt) / 0.3);
        this.play(groan ? 'groan' : 'creak', {
          when, gainDb: db - (this.settings.calm ? 4 : 0), rate: this.gravityRate(),
          pan: clamp(this.signals.sway / 2, -1, 1) * 0.3, category: 'creak', priority: groan ? 2 : 3,
        });
        this.nextCreak = when + (groan ? 1.2 + this.rng() * 1.3 : 1.5 + this.rng() * 2.5);
      }
      // ambience sweeteners every 3 to 15 s
      if (when >= this.nextSweet) {
        const list = this.biomeData.sweeteners;
        if (this.nextSweet > 0 && list.length) {
          const s = list[Math.floor(this.rng() * list.length)];
          this.play(`amb.${s}`, { bus: 'ambience', when, gainDb: s === 'thunder' ? -12 : -18, pan: (this.rng() * 2 - 1) * 0.6, category: 'ambience', priority: 5 });
        }
        this.nextSweet = when + 3 + this.rng() * 12;
      }
    }
    // scrapes stop when Gameplay stops reporting them
    for (const [body, s] of this.scrapes) {
      if (when - s.last > 0.25) {
        this.stopPlaying(s.p, when, 0.08);
        this.voices.remove(s.p.id);
        this.scrapes.delete(body);
      }
    }
    if (when - this.lastXp > 1.5) this.xpCount = 0;
    this.music.update(when, { tension: t, progress: this.signals.checkpointProgress, streak: this.ladder.currentStreak });
  }

  private installRealtime(): void {
    const g = globalThis as any;
    const id = setInterval(() => this.tick(), 50);
    this.disposers.push(() => clearInterval(id));
    const doc = g.document as Document | undefined;
    if (doc) {
      const unlock = () => {
        void this.unlock();
        if ((this.ctx as AudioContext).state === 'running') {
          for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) doc.removeEventListener(ev, unlock, true);
        }
      };
      for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) doc.addEventListener(ev, unlock, true);
      const vis = () => {
        const ctx = this.ctx as AudioContext;
        if (doc.visibilityState === 'hidden') {
          this.mixer.fadeMaster(0, this.now(), 0.05);
          setTimeout(() => {
            if (doc.visibilityState === 'hidden') void ctx.suspend?.().catch(() => undefined);
          }, 250);
        } else {
          void ctx.resume?.().then(() => this.mixer.fadeMaster(1, this.now(), 0.08)).catch(() => undefined);
        }
      };
      doc.addEventListener('visibilitychange', vis);
      this.disposers.push(() => {
        doc.removeEventListener('visibilitychange', vis);
        for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) doc.removeEventListener(ev, unlock, true);
      });
    }
  }

  // ------------------------------------------------------------ biome and ambience

  private switchBiome(id: number, when: number, withEntry: boolean): void {
    const b = biome(id);
    const changed = b.id !== this.biomeId;
    this.biomeId = b.id;
    this.key = biomeKey(b.id, this.checkpointN);
    this.maxBiome = Math.max(this.maxBiome, b.id);
    if (changed) this.ladder.newBiome();
    this.mixer.setAir(b.air, when);
    if (changed) {
      void this.bank.prepareBiome(b.id);
      void this.bank.warmNotes(this.musicFor(this.key, b.material));
      this.music.setBiome(b.id, this.checkpointN);
    }
    if (changed || !this.bed) this.startBed(when);
    if (withEntry && this.juice && !this.entryPlayed.has(b.id)) {
      this.entryPlayed.add(b.id);
      const at = Math.max(when, this.lastCheckpointAt + 1.6);
      this.play(`entry.${b.id}`, { when: at, gainDb: b.id === 4 ? -6 : -9, category: 'stinger', priority: 1, slowmo: false });
      this.play('swell', { when: at - 0.3, gainDb: -16, category: 'misc', priority: 4 });
      this.haptic('biome', 1, at - this.now());
    }
  }

  private startBed(when: number): void {
    const b = this.biomeData;
    const buf = this.bank.bed(b.id);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(dbToGain(b.bed.levelDb + 6), when, 0.7);
    src.connect(gain).connect(this.mixer.input('ambience'));
    src.start(when, this.rng() * buf.duration);
    if (this.bed) {
      this.bed.gain.gain.setTargetAtTime(0, when, 0.6);
      this.bed.src.stop(when + 4);
    }
    this.bed = { src, gain };
  }

  // ------------------------------------------------------------ events

  private dispatch(name: string, p: Payload, when: number): void {
    if (this.modeName === 'pop') this.dispatchPop(name, p, when);
    else this.dispatchTower(name, p, when);
  }

  private dispatchTower(name: string, p: Payload, when: number): void {
    switch (name) {
      // input (6.1)
      case 'piece_spawned':
        // the sim emits run_start before the view connects, so a spawn starts the run;
        // one in the same moment as run_over is a stray from the run that just ended
        if (!this.running && when - this.overAt > TUNING.restartGap) this.startRun(when, false);
        this.activeShape = str(p, 'shape', '');
        this.play('spawn', { when, gainDb: -17, category: 'misc', priority: 3 });
        this.haptic('spawn');
        break;
      case 'piece_moved': {
        if (!this.cool.ready('move', when, 0.05)) break;
        const x = num(p, 'x', this.signals.foundationX);
        // pitch rises left to right across the foundation slab
        const across = clamp((x - this.signals.foundationX) / TUNING.halfWidth, -1, 1);
        this.play('move', { when, gainDb: -22, rate: semis(across * 3), pan: this.panX(x), category: 'ui', priority: 2 });
        this.haptic('move');
        break;
      }
      case 'piece_rotated': {
        const blocked = bool(p, 'blocked');
        const dir = str(p, 'dir', 'cw');
        const ccw = dir === 'ccw' || dir === '-1' || dir === 'left';
        this.play(blocked ? 'rotate.blocked' : ccw ? 'rotate.ccw' : 'rotate.cw', { when, gainDb: blocked ? -12 : -15, category: 'ui', priority: 2 });
        this.haptic(blocked ? 'rotateBlocked' : 'rotate');
        break;
      }
      case 'soft_drop':
        if (bool(p, 'on', true)) this.play('drop', { when, gainDb: -18, rate: 0.9, category: 'misc', priority: 2 });
        break;
      case 'hard_drop':
        this.play('harddrop', { when, gainDb: -11, rate: 0.9 + clamp(num(p, 'distance', 6) / 20, 0, 0.4), category: 'misc', priority: 2 });
        if (num(p, 'distance', 0) >= 5 && this.rng() < TUNING.wheeChance) this.say('whee', when + 0.05, { shape: this.activeShape });
        break;
      case 'hold_swap':
        this.play('swap', { when, gainDb: -14, category: 'ui', priority: 2 });
        this.haptic('double', 0.6);
        break;

      // contacts (6.2)
      case 'contact_hit':
        this.onContact(p, when);
        break;
      case 'contact_slide':
        this.onSlide(p, when);
        break;

      // placement (5, 6.4)
      case 'piece_landed': {
        this.landingAt = when;
        const impact = clamp(num(p, 'impact', 0.4), 0, 1);
        const m = asMaterial(p?.material, this.material);
        this.haptic(m === 'rubber' ? 'rubber' : impact < 0.25 ? 'land1' : impact < 0.5 ? 'land2' : impact < 0.8 ? 'land3' : 'land4', 0.5 + impact / 2);
        if (bool(p, 'glue')) this.play('glue.squelch', { when, gainDb: -14, rate: 0.85, pan: this.panX(num(p, 'x', this.signals.foundationX)), category: 'misc', priority: 3 });
        this.lastShape = str(p, 'shape', this.activeShape);
        if (impact >= TUNING.oofImpact) this.say('oof', when + 0.04, { shape: this.lastShape, x: num(p, 'x', NaN) });
        break;
      }
      case 'piece_settled':
        this.onSettled(p, when);
        break;
      case 'perfect': {
        if (!this.juice) break;
        const combo = num(p, 'combo', 1);
        this.play('shimmer', { when, gainDb: -14, rate: semis(Math.min(combo, 8)), category: 'stinger', priority: 3 });
        this.haptic('perfect');
        break;
      }
      case 'clutch':
        if (!this.juice) break;
        this.play('phew', { when, gainDb: -10, category: 'stinger', priority: 2 });
        this.play('shimmer', { when: when + 0.1, gainDb: -18, category: 'misc', priority: 4 });
        this.haptic('clutch');
        break;
      case 'ghost_fit': {
        const perfect = bool(p, 'perfect');
        if (perfect && !this.ghostPerfect && this.juice && this.settings.lockOnChime && this.cool.ready('lockon', when, 0.25)) {
          this.play('lockon', { when, gainDb: -15, category: 'ui', priority: 3, slowmo: false });
          this.haptic('lockOn');
        }
        this.ghostPerfect = perfect;
        break;
      }

      // building mechanics (6.9)
      case 'bond_formed':
        if (bool(p, 'glue')) {
          if (this.cool.ready('glue', when, 0.12)) this.play('glue.squelch', { when, gainDb: -17, category: 'misc', priority: 4 });
        } else if (this.juice && this.cool.ready('bond', when, 0.2)) this.play('bond.tink', { when, gainDb: -28, category: 'misc', priority: 5 });
        break;
      case 'bond_broken': {
        const f = num(p, 'force', 10);
        this.play('bond.snap', { when, gainDb: -12 + 8 * clamp(Math.log10(1 + f) / 2.5, 0, 1), category: 'impact', priority: 2 });
        this.haptic('bondSnap');
        break;
      }
      case 'row_solid':
        this.onSolidRow(Math.max(1, Math.round(num(p, 'count', 1))), when);
        break;
      case 'collapse_started': {
        const pieces = num(p, 'pieces', 10);
        this.play('collapse.crack', { when, gainDb: -5, category: 'stinger', priority: 1 });
        this.play('collapse.rumble', { when: when + 0.05, gainDb: -10 + Math.min(6, pieces / 8), category: 'stinger', priority: 1 });
        this.haptic('collapse');
        break;
      }

      // losing (6.3)
      case 'piece_lost':
        this.play('fallwhistle', { when, gainDb: -13, category: 'misc', priority: 2 });
        this.say('fall', when + 0.1, { shape: str(p, 'shape', '') });
        this.haptic('pieceLost');
        break;
      case 'piece_gone':
        // in space a lost piece just boops away; lower down it lands far below with a distant plonk
        if (this.biomeId >= 6) this.play('boop', { when, gainDb: -15, category: 'misc', priority: 3 });
        else this.play('plonk', { when, gainDb: -10 - Math.min(16, this.signals.altitude * 0.12), category: 'misc', priority: 3 });
        break;
      case 'heart_lost':
        this.onHeartLost(Math.max(1, Math.round(num(p, 'count', 1))), num(p, 'left', 1), when);
        break;
      case 'heart_restored':
        this.mixer.setOverlay('lastHeart', false, when);
        if (when - this.secondWindAt < 0.1) break; // Second Wind's chord already says it
        this.play('heartup', { when, gainDb: -10, category: 'stinger', priority: 2 });
        this.haptic('heartRestored');
        break;
      case 'last_heart':
        this.mixer.setOverlay('lastHeart', true, when);
        this.playNote('bellLow', this.key.root - 24, { when: when + 0.35, gainDb: -8, category: 'stinger', priority: 1 });
        this.haptic('lastHeart', 1, 0.35);
        break;
      case 'budget_low': {
        if (!this.cool.ready('budget', when, 1.5)) break;
        const k = this.key;
        this.playNote('bellLow', scaleNote(k, 3) - 12, { when, gainDb: -14, category: 'stinger', priority: 2 });
        this.playNote('bellLow', k.root - 12, { when: when + 0.28, gainDb: -14, category: 'stinger', priority: 2 });
        this.haptic('light');
        break;
      }
      case 'run_over':
        this.onGameOver(when, str(p, 'cause', ''));
        break;

      // progress (6.4, 6.9)
      case 'height_milestone':
        this.play('blip', { when, gainDb: -22, category: 'misc', priority: 5 });
        break;
      case 'pb_crossed':
        if (this.juice) this.onPersonalBest(when);
        break;
      case 'checkpoint_near': {
        const blocks = num(p, 'blocks', 99);
        if (blocks <= 1 && !this.drumroll && !this.holding && this.juice) {
          this.drumroll = this.play('drumroll', { when, gainDb: -16, category: 'stinger', priority: 2, attack: 0.3, vary: false }) ?? undefined;
        } else if (blocks > 1) this.stopDrumroll(when);
        break;
      }
      case 'checkpoint_hold': {
        const progress = clamp(num(p, 'progress', 0), 0, 1);
        if (!this.holding) {
          this.holding = true;
          this.holdTicks = 0;
          this.stopDrumroll(when);
          this.mixer.setOverlay('hold', true, when);
        }
        // the mix drains as the ring fills, with the screen going grey (gameplay.md §7.3)
        const suspense = this.juice && !this.zen;
        if (suspense) this.mixer.setHoldDepth(progress, when);
        while (this.holdTicks < 8 && progress >= this.holdTicks / 8) {
          this.play('hold.tick', { when, gainDb: -15 + (suspense ? 3 * progress : 1), rate: semis(scaleNote({ root: 0, mode: this.key.mode }, this.holdTicks)), category: 'ui', priority: 2, vary: false });
          this.haptic('holdTick');
          this.holdTicks++;
        }
        break;
      }
      case 'checkpoint_cancelled':
        this.holding = false;
        this.stopDrumroll(when);
        this.mixer.setOverlay('hold', false, when);
        this.play('hold.womp', { when, gainDb: -10, category: 'stinger', priority: 2 });
        this.haptic('holdCancel');
        break;
      case 'checkpoint_claimed':
        this.onCheckpoint(num(p, 'n', this.checkpointN + 1), Math.max(0, Math.round(num(p, 'leftover', 0))), when);
        break;
      case 'biome_entered':
        this.switchBiome(Math.round(num(p, 'id', this.biomeId)), when, true);
        break;
      case 'difficulty_tier_up':
        this.play('gear', { when, gainDb: -17, category: 'misc', priority: 4 });
        this.haptic('light');
        break;

      // hazards (6.10)
      case 'hazard_warning':
        this.onHazardWarning(p, when);
        break;
      case 'hazard_start':
        this.onHazardStart(p, when);
        break;
      case 'hazard_end': {
        const type = hazardType(str(p, 'type'));
        const loop = this.hazardLoops.get(type);
        if (loop) {
          this.stopPlaying(loop, when, 0.6);
          this.hazardLoops.delete(type);
        }
        // a hold cut the warning short and no gust comes: the rising whoosh stops building
        const warn = this.hazardLoops.get(`${type}.warn`);
        if (warn && bool(p, 'cancelled')) this.stopPlaying(warn, when, 0.25);
        this.hazardLoops.delete(`${type}.warn`);
        break;
      }

      // power-ups and Second Wind (6.11)
      case 'bubble_spawned':
        if (this.cool.ready('bubble', when, 0.5)) this.play('bubble.spawn', { when, gainDb: -15, pan: this.panX(num(p, 'x', this.signals.foundationX)), category: 'misc', priority: 3 });
        break;
      case 'bubble_expired':
        this.play('boop', { when, gainDb: -24, rate: 1.6, pan: this.panX(num(p, 'x', this.signals.foundationX)), category: 'misc', priority: 4 });
        break;
      case 'power_collected':
        this.play('bubble.pop', { when, gainDb: -9, pan: this.panX(num(p, 'x', this.signals.foundationX)), category: 'misc', priority: 2 });
        if (this.juice) this.powerChime(when + 0.04, -11);
        this.haptic('double', 0.7);
        break;
      case 'power_granted': {
        // a grade-S claim grants one as the claim fanfare settles
        const at = Math.max(when, this.lastCheckpointAt + 1, this.lastGrantAt + 0.45);
        this.lastGrantAt = at;
        if (!this.juice) {
          this.play('bubble.pop', { when: at, gainDb: -14, category: 'misc', priority: 3 });
          break;
        }
        this.powerChime(at, -12);
        this.play('shimmer', { when: at + 0.15, gainDb: -16, category: 'misc', priority: 4 });
        this.haptic('double', 0.5, at - when);
        break;
      }
      case 'power_used':
        this.onPowerUsed(str(p, 'kind', ''), p, when);
        break;
      case 'power_refused':
        this.play('rotate.blocked', { bus: 'ui', when, gainDb: -12, rate: 0.8, category: 'ui', priority: 2, slowmo: false });
        this.haptic('rotateBlocked');
        break;
      case 'power_ended':
        if (str(p, 'kind', '') === 'slowmo') this.setSlowPower(false, when);
        else this.play('bubble.pop', { when, gainDb: -20, rate: 0.6, category: 'misc', priority: 4 });
        break;
      case 'pieces_swept': {
        const count = Array.isArray(p?.pieces) ? p.pieces.length : 1;
        this.lastSweep = { p: this.play('sweep', { when, gainDb: -13 + 5 * clamp(count / 10, 0, 1), category: 'misc', priority: 2 }), at: when };
        break;
      }
      case 'second_wind_ready':
        // never a nag: silent at run start, one soft cue when checkpoint 2 earns it
        if (str(p, 'how', 'start') === 'earned') {
          const at = Math.max(when, this.lastCheckpointAt + 2.2);
          if (this.juice) this.play('shimmer', { when: at, gainDb: -17, category: 'misc', priority: 3 });
          const { inst, octave } = this.instFor();
          this.playNote(inst, scaleNote(this.key, 7) + 12 * octave, { when: at + 0.05, gainDb: -17, category: 'note', priority: 3 });
        }
        break;
      case 'second_wind':
        this.onSecondWind(when);
        break;

      // feel
      case 'hitstop': {
        if (!this.juice) break;
        const ms = clamp(num(p, 'ms', 50), 0, 500) / 1000;
        // a knock during the hold: the music catches its breath through the freeze and the slow-down after it
        if (this.holding && !this.zen && this.cool.ready('holdbreath', when, 0.5)) {
          this.duck('music', -5, when, ms + 0.25);
          this.duck('ambience', -4, when, ms + 0.25);
        }
        for (const pl of this.playing.values()) {
          if (!pl.slowmo) continue;
          pl.src.playbackRate.setValueAtTime(pl.baseRate * this.rateFactor * 0.5, when);
          pl.src.playbackRate.setValueAtTime(pl.baseRate * this.rateFactor, when + ms);
        }
        break;
      }
      case 'slowmo': {
        const on = bool(p, 'on', true);
        const ts = clamp(num(p, 'timeScale', 0.4), 0.05, 1);
        this.setRateFactor(on ? lerp(0.5, 1, ts) : 1, when);
        this.mixer.setOverlay('slowmo', on, when);
        break;
      }

      // run and meta
      case 'run_start':
        this.startRun(when, true);
        break;
      case 'pause':
      case 'resume': {
        const on = name === 'pause';
        if (on === this.mixer.state().overlays.includes('pause')) break;
        this.mixer.setOverlay('pause', on, when, on ? 0.05 : 0.08);
        if (this.cool.ready('pausefx', when, 0.25)) this.play(on ? 'ui.pause' : 'ui.resume', { bus: 'ui', when, gainDb: -12, category: 'ui', priority: 2, slowmo: false });
        break;
      }
      case 'xp_tick': {
        if (!this.cool.ready('xp', when, 1 / 15)) break;
        this.lastXp = when;
        this.xpCount++;
        this.play('xp.tick', { bus: 'ui', when, gainDb: -16, rate: semis(Math.min(this.xpCount, 24) / 2), category: 'ui', priority: 3, vary: false, slowmo: false });
        if (this.xpCount % 2 === 0) this.haptic('xpTick');
        break;
      }
      case 'level_up':
        this.onLevelUp(Math.round(num(p, 'level', 2)), when);
        break;
      case 'achievement':
        this.onAchievement(p, when);
        break;
      case 'unlock':
        this.playChord(this.instFor().inst, tonicChord(this.key, 2, this.instFor().octave), { bus: 'ui', when, gainDb: -8, slowmo: false }, 0.06);
        this.play('shimmer', { bus: 'ui', when: when + 0.1, gainDb: -12, category: 'misc', priority: 3, slowmo: false });
        this.haptic('double');
        break;
    }
  }

  private startRun(when: number, chime: boolean): void {
    this.running = true;
    this.overAt = -Infinity;
    this.slowPower = false;
    this.ladder.reset();
    this.ladder.newBiome();
    this.entryPlayed.clear();
    this.danger = false;
    this.holding = false;
    this.checkpointN = 0;
    this.maxBiome = Math.max(1, Math.round(this.signals.biome || 1));
    this.rateFactor = 1;
    this.mixer.clearOverlays(when);
    this.mixer.setBase('playing', when);
    this.biomeId = 0;
    this.switchBiome(this.maxBiome, when, false);
    this.entryPlayed.add(this.biomeId);
    this.music.startRun(when, this.biomeId, this.checkpointN);
    this.nextSweet = when + 2;
    this.nextCreak = when;
    if (chime) {
      if (this.juice) this.play('entry.1', { bus: 'ambience', when, gainDb: -12, category: 'stinger', priority: 2 });
      this.runStartChime(when + 0.15);
    }
  }

  private runStartChime(when: number): void {
    const { inst, octave } = this.instFor('wood');
    const notes = run(BIOMES[0].key, 0, 3, 2).map((m) => m + 12 * octave);
    this.withNotes(notes.map((m) => ({ inst, midis: [m] })), () =>
      notes.forEach((m, i) => this.playNote(inst, m, { bus: 'ui', when: when + i * 0.09, gainDb: -12, category: 'ui', priority: 2, slowmo: false })),
    );
  }

  /** A rising three-note chime in the biome's key and instrument (notes the biome already has). */
  private powerChime(when: number, gainDb: number): void {
    const { inst, octave } = this.instFor();
    [4, 5, 7].forEach((d, i) => this.playNote(inst, scaleNote(this.key, d) + 12 * octave, { when: when + i * 0.07, gainDb: gainDb - i, category: 'note', priority: 2, slowmo: false }));
  }

  /**
   * A shape voice (6.8) on its own bus, pitched for the shape. At most one every 4 s;
   * `force` skips the limit (a chorus, the "aww" at game over). Juice only.
   */
  private say(reaction: string, when: number, o: { shape?: string; x?: number; gainDb?: number; minGap?: number; force?: boolean } = {}): boolean {
    if (!this.juice) return false;
    if (!o.force && when - this.lastVoiceAt < (o.minGap ?? TUNING.voiceGap)) return false;
    this.lastVoiceAt = Math.max(this.lastVoiceAt, when);
    const semi = SHAPE_VOICE[o.shape ?? ''] ?? Math.round(this.rng() * 6 - 3);
    const pan = o.x !== undefined && Number.isFinite(o.x) ? this.panX(o.x) : (this.rng() * 2 - 1) * 0.2;
    return !!this.play(`voice.${reaction}`, { bus: 'voices', when, gainDb: o.gainDb ?? -11, rate: semis(semi), pan, category: 'misc', priority: 3 });
  }

  private onPowerUsed(kind: string, p: Payload, when: number): void {
    switch (kind) {
      case 'clean': // the broom stroke came with pieces_swept; this adds the clean sparkle
        if (this.juice) this.play('shimmer', { when: when + 0.35, gainDb: -12, category: 'misc', priority: 3 });
        this.haptic('medium');
        break;
      case 'quickset':
        this.play('quickset', { when, gainDb: -8, category: 'misc', priority: 1 });
        this.duck('music', -4, when, 1.2);
        this.haptic('solidRow');
        break;
      case 'undo':
        this.play('undo', { when, gainDb: -9, pan: this.panX(num(p, 'x', this.signals.foundationX)), category: 'misc', priority: 2 });
        this.haptic('light');
        break;
      case 'glue':
        this.play('glue.on', { when, gainDb: -9, category: 'misc', priority: 2 });
        this.haptic('double', 0.5);
        break;
      case 'slowmo':
        this.setSlowPower(true, when);
        break;
      default:
        this.play('ui.on', { bus: 'ui', when, gainDb: -12, category: 'ui', priority: 3, slowmo: false });
    }
  }

  private setSlowPower(on: boolean, when: number): void {
    if (on === this.slowPower) return;
    this.slowPower = on;
    this.mixer.setOverlay('slowPower', on, when, on ? 0.6 : 0.4);
    this.play(on ? 'slow.in' : 'slow.out', { when, gainDb: on ? -10 : -13, category: 'misc', priority: 2 });
    if (on) this.haptic('light');
  }

  private onSecondWind(when: number): void {
    this.secondWindAt = when;
    // the gust carries the pieces away, so it replaces the broom stroke that started this moment
    if (this.lastSweep.p && when - this.lastSweep.at < 0.05) this.stopPlaying(this.lastSweep.p, when, 0.02);
    this.play('windgust', { when, gainDb: -6, category: 'misc', priority: 1 });
    if (!this.juice) return;
    const { inst, octave } = this.instFor();
    this.playChord(inst, tonicChord(this.key, 3, octave), { when: when + 0.65, gainDb: -8, priority: 1 }, 0.03);
    this.play('shimmer', { when: when + 0.75, gainDb: -12, category: 'misc', priority: 3 });
    this.duck('music', -8, when, 2.5);
    this.duck('ambience', -6, when, 2.5);
    this.haptic('celebrate');
  }

  private onContact(p: Payload, when: number): void {
    const v = num(p, 'approachSpeed', num(p, 'impulsePerMass', 0));
    if (!(v >= TUNING.minSpeed)) return;
    const a = str(p, 'bodyA', 'a'), b = str(p, 'bodyB', '');
    // no material means the finish of the biome the piece was placed in (biomeA/biomeB)
    const matA = asMaterial(p?.materialA, this.biomeMaterial(p?.biomeA, this.material));
    const matB = asMaterial(p?.materialB, this.biomeMaterial(p?.biomeB, matA));
    this.bodyMaterial.set(a, matA);
    if (b) this.bodyMaterial.set(b, matB);
    if (this.bodyMaterial.size > 400) this.bodyMaterial.delete(this.bodyMaterial.keys().next().value as string);
    const tier = this.tierFor(v);
    if (!this.cool.ready(`body:${a}`, when, tier === 0 ? TUNING.tapGap : TUNING.bodyGap)) return;
    const pt = this.point(p);
    const size = num(p, 'size', 4);
    const lowG = this.signals.gravityScale < 0.7;
    const gainDb = this.speedDb(v) + this.offscreenDb(pt.y) + (tier === 0 ? -6 : 0) + (this.signals.gravityScale > 1.2 ? 1 : lowG ? -1 : 0);
    const isLanding = when - this.landingAt < 0.08;
    const priority: Priority = isLanding ? 2 : tier >= 3 ? 3 : 4;
    const common: PlayOptions = {
      when, rate: semis(clamp((4 - size) * 1.5, -3, 3) - (this.slowPower ? 1.5 : 0)) * this.gravityRate(), pan: this.panX(pt.x),
      category: 'impact', priority, attack: lowG ? 0.02 : 0,
    };
    this.play(this.impactName(matA, Math.max(1, tier)), { ...common, gainDb });
    if (matB !== matA && tier >= 1) this.play(this.impactName(matB, Math.max(1, tier - 1)), { ...common, gainDb: gainDb - 10.5, priority: Math.max(priority, 4) as Priority });
  }

  private biomeMaterial(id: unknown, fallback: Material): Material {
    return typeof id === 'number' && Number.isFinite(id) ? biome(id).material : fallback;
  }

  /** The impact for a material, or the biome's own while a rarely heard material bakes in the background. */
  private impactName(m: Material, tier: number): string {
    const name = `impact.${m}.${tier}`;
    if (this.bank.has(name)) return name;
    this.bank.warm(name);
    return `impact.${this.material}.${tier}`;
  }

  private onSlide(p: Payload, when: number): void {
    const body = str(p, 'body', '');
    const speed = num(p, 'speed', 0);
    const existing = this.scrapes.get(body);
    if (speed < 0.4) return;
    const db = -26 + 14 * clamp(speed / 4, 0, 1);
    if (existing) {
      existing.last = when;
      existing.p.gain.gain.setTargetAtTime(dbToGain(db), when, 0.05);
      existing.p.src.playbackRate.setTargetAtTime(0.8 + 0.1 * clamp(speed, 0, 4), when, 0.05);
      return;
    }
    const m = this.bodyMaterial.get(body) ?? this.material;
    const name = m === 'rubber' || m === 'jelly' ? 'scrape.squeak' : m === 'ice' || m === 'glass' || m === 'metal' ? 'scrape.smooth' : 'scrape.rough';
    const pl = this.play(name, { when, gainDb: db, attack: 0.05, category: 'scrape', priority: 4, vary: false, offset: this.rng() });
    if (pl) this.scrapes.set(body, { p: pl, last: when });
  }

  private onSettled(p: Payload, when: number): void {
    const g = str(p, 'grade', 'clean');
    const grade: Grade = g === 'perfect' || g === 'messy' ? g : 'clean';
    const m = asMaterial(p?.material, this.material);
    const { inst, octave } = this.instFor(m);
    this.play('settle', { when, gainDb: -16, category: 'note', priority: 3 });
    this.music.settled();
    const r = this.ladder.settle(this.key, grade);
    if (!this.juice) return;
    if (r.kind === 'clonk') {
      this.playNote('clonk', this.key.root - 12, { when: when + 0.01, gainDb: -12 });
    } else {
      this.playNote(inst, r.notes[0] + 12 * octave, { when: when + 0.01, gainDb: -9 });
      if (r.notes[1] !== undefined) this.playNote(inst, r.notes[1] + 12 * octave, { when: when + 0.02, gainDb: -14 });
      if (r.sparkle) this.play('shimmer', { when: when + 0.05, gainDb: -16, category: 'misc', priority: 3 });
      if (r.bloom) {
        this.playChord(inst, tonicChord(this.key, 3, octave), { when: when + 0.12, gainDb: -10 }, 0.03);
        this.play('shimmer', { when: when + 0.15, gainDb: -11, category: 'misc', priority: 2 });
      }
    }
    this.haptic(grade === 'perfect' ? 'perfect' : 'settle');
  }

  private onSolidRow(count: number, when: number): void {
    const { inst, octave } = this.instFor();
    this.play('row.clack', { when, gainDb: -5, category: 'stinger', priority: 1 });
    if (!this.juice) return;
    this.playChord(inst, tonicChord(this.key, Math.min(3, count) as 1 | 2 | 3, octave), { when: when + 0.02, gainDb: -9, priority: 1 });
    for (let i = 0; i < 8; i++) {
      this.play('tick', { when: when + 0.06 + i * 0.02, gainDb: -18, rate: semis(scaleNote({ root: 0, mode: this.key.mode }, i)), category: 'misc', priority: 3, vary: false });
    }
    if (count >= 3) this.play('shimmer', { when: when + 0.2, gainDb: -10, category: 'misc', priority: 2 });
    for (let i = 0; i < Math.min(3, count); i++) this.haptic('solidRow', 1, i * 0.12);
  }

  private onHeartLost(count: number, left: number, when: number): void {
    const n = Math.min(5, count);
    for (let i = 0; i < n; i++) this.play('heartpop', { when: when + i * 0.09, gainDb: -8, rate: semis(i), category: 'stinger', priority: 1 });
    if (left > 0 && this.juice) {
      const { inst, octave } = this.instFor();
      const t = when + n * 0.09 + 0.05;
      this.playNote(inst, scaleNote(this.key, 2) + 12 * octave, { when: t, gainDb: -11, priority: 2 });
      this.playNote(inst, this.key.root + 12 * octave, { when: t + 0.17, gainDb: -11, priority: 2 });
    }
    this.haptic('heartLost');
  }

  private onCheckpoint(n: number, leftover: number, when: number): void {
    this.checkpointN = n;
    this.lastCheckpointAt = when;
    this.holding = false;
    this.stopDrumroll(when);
    this.mixer.setOverlay('hold', false, when);
    const { inst, octave } = this.instFor();
    this.play('flag', { when, gainDb: -8, category: 'stinger', priority: 1 });
    this.music.claimed(when, n);
    this.deepCosmosKey(n);
    if (!this.juice) return;
    const notes = run(this.key, 0, 4, 1).concat(scaleNote(this.key, 5));
    notes.forEach((m, i) => this.playNote(inst, m + 12 * octave, { when: when + 0.05 + i * 0.09, gainDb: -9, priority: 2, category: 'note' }));
    this.playChord(inst, tonicChord(this.key, 2, octave + 0), { when: when + 0.5, gainDb: -8, priority: 1 }, 0.02);
    for (let i = 0; i < 3; i++) this.play('confetti', { when: when + 0.08 + this.rng() * 0.35, gainDb: -15, pan: (this.rng() * 2 - 1) * 0.5, category: 'misc', priority: 4 });
    this.play('stonewave', { when: when + 0.55, gainDb: -11, category: 'misc', priority: 2 });
    this.play('foundation', { when: when + 1.3, gainDb: -9, category: 'stinger', priority: 2 });
    for (let i = 0; i < Math.min(20, leftover); i++) {
      this.play('kaching', { bus: 'ui', when: when + 1.6 + i / 12, gainDb: -17, rate: semis(Math.min(i, 12)), category: 'ui', priority: 3, vary: false, slowmo: false });
    }
    this.duck('music', -6, when, 2);
    this.duck('ambience', -6, when, 2);
    // a little chorus from the tower
    if (this.say('yay', when + 0.3, { minGap: TUNING.voiceGapCheckpoint })) this.say('yay', when + 0.44, { force: true, gainDb: -15 });
    this.haptic('checkpoint');
    this.haptic('foundation', 1, 1.3);
  }

  /** Deep Cosmos rotates key every 6 checkpoints. */
  private deepCosmosKey(n: number): void {
    if (this.biomeId !== 10) return;
    const k = biomeKey(10, n);
    if (k.root !== this.key.root) void this.bank.warmNotes(this.musicFor(k, this.material));
    this.key = k;
    this.music.setBiome(10, n);
  }

  private onPersonalBest(when: number): void {
    for (let i = 0; i < 3; i++) this.play('firework', { when: when + [0, 0.25, 0.55][i], gainDb: -10, pan: [-0.4, 0.4, 0][i], category: 'stinger', priority: 2 });
    const { inst, octave } = this.instFor();
    run(this.key, 0, 5).forEach((m, i) => this.playNote(inst, m + 12 * octave, { when: when + 0.6 + i * 0.07, gainDb: -10, priority: 2 }));
    this.playChord(inst, tonicChord(this.key, 2, octave), { when: when + 1.0, gainDb: -8, priority: 1 }, 0.02);
    this.duck('music', -6, when, 2);
    this.haptic('celebrate');
  }

  /**
   * An achievement (gameplay.md §18): a badge stamped down, then a sparkle that grows with the
   * tier. In a run it sits under the play (no duck, no music change); on the run-over strip it is
   * one sting for the whole strip, at the highest tier earned. Juice off keeps the stamp, since
   * it says something happened, and drops the sparkle and the haptic.
   */
  private onAchievement(p: Payload, when: number): void {
    const tier = Math.max(0, TIERS.indexOf(str(p, 'tier', 'bronze').toLowerCase()));
    const inRun = bool(p, 'inRun', this.running);
    if (!this.cool.ready(inRun ? 'ach' : 'achstrip', when, inRun ? 0.5 : 2)) return;
    this.play('ach.stamp', { bus: 'ui', when, gainDb: (inRun ? -13 : -10) + tier, category: 'ui', priority: 2, slowmo: false });
    if (!this.juice) return;
    if (inRun) {
      // in the biome's key and instrument, from notes the biome already has
      const { inst, octave } = this.instFor();
      const degrees = [[5, 7], [4, 5, 7], [4, 5, 7, 9], [4, 5, 7, 9]][tier];
      degrees.forEach((d, i) => this.playNote(inst, scaleNote(this.key, d) + 12 * octave, { bus: 'ui', when: when + 0.08 + i * 0.07, gainDb: -15 + tier * 0.5 - i * 0.5, priority: 2, slowmo: false }));
      const after = when + 0.08 + degrees.length * 0.07;
      if (tier >= 2) this.playChord(inst, tonicChord(this.key, tier === 3 ? 3 : 2, octave), { bus: 'ui', when: after, gainDb: -16 + tier, slowmo: false }, tier === 3 ? 0.03 : 0);
      // platinum rings a deep bell under the chord
      if (tier === 3) this.playNote('bellLow', this.key.root - 12, { bus: 'ui', when: after, gainDb: -14, category: 'stinger', priority: 2, slowmo: false });
      this.play('shimmer', { bus: 'ui', when: when + 0.06, gainDb: -20 + 2 * tier, category: 'misc', priority: 3, slowmo: false });
      this.haptic('uiTap');
      return;
    }
    this.withNotes(this.metaMusic(), () => {
      const { inst, octave } = this.instFor('wood');
      const key = BIOMES[0].key;
      const degrees = [[2, 4], [0, 2, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]][tier];
      degrees.forEach((d, i) => this.playNote(inst, scaleNote(key, d) + 12 * octave, { bus: 'ui', when: when + 0.1 + i * 0.08, gainDb: -12, priority: 2, slowmo: false }));
      const after = when + 0.1 + degrees.length * 0.08;
      if (tier >= 2) this.playChord('glassBell', tonicChord(key, tier === 3 ? 3 : 2, 0), { bus: 'ui', when: after, gainDb: -12, priority: 2, slowmo: false }, 0.025);
      for (let i = 0; i < (tier === 3 ? 2 : 1); i++) this.play('shimmer', { bus: 'ui', when: after + i * 0.2, gainDb: -16 + tier, category: 'misc', priority: 3, slowmo: false });
      if (tier === 3) for (let i = 0; i < 2; i++) this.play('confetti', { bus: 'ui', when: after + i * 0.12, gainDb: -16, pan: (this.rng() * 2 - 1) * 0.5, category: 'misc', priority: 3, slowmo: false });
      this.haptic(tier >= 2 ? 'double' : 'uiTap');
    });
  }

  private onLevelUp(level: number, when: number): void {
    this.withNotes(this.metaMusic(), () => this.levelUpFanfare(level, when));
  }

  private levelUpFanfare(level: number, when: number): void {
    const big = level % 5 === 0, huge = level % 10 === 0;
    const { inst, octave } = this.instFor('wood');
    const key = BIOMES[0].key;
    run(key, 0, 5).forEach((m, i) => this.playNote(inst, m + 12 * octave, { bus: 'ui', when: when + i * 0.09, gainDb: -9, priority: 2, slowmo: false }));
    this.playChord('glassBell', tonicChord(key, big ? 3 : 2, 0), { bus: 'ui', when: when + 0.5, gainDb: -9, priority: 1, slowmo: false }, 0.025);
    this.play('shimmer', { bus: 'ui', when: when + 0.55, gainDb: -10, category: 'misc', priority: 2, slowmo: false });
    for (let i = 0; i < (big ? 4 : 2); i++) this.play('confetti', { bus: 'ui', when: when + 0.5 + i * 0.12, gainDb: -14, pan: (this.rng() * 2 - 1) * 0.5, category: 'misc', priority: 3, slowmo: false });
    if (huge) for (let i = 0; i < 2; i++) this.play('firework', { bus: 'ui', when: when + 0.9 + i * 0.3, gainDb: -10, category: 'stinger', priority: 2, slowmo: false });
    this.duck('music', -9, when, 3);
    this.haptic('celebrate');
  }

  private onGameOver(when: number, cause = ''): void {
    this.running = false;
    this.overAt = when;
    this.slowPower = false;
    this.danger = false;
    this.holding = false;
    this.stopDrumroll(when);
    for (const [, s] of this.scrapes) this.stopPlaying(s.p, when, 0.05);
    this.scrapes.clear();
    for (const [, l] of this.hazardLoops) this.stopPlaying(l, when, 0.3);
    this.hazardLoops.clear();
    // tape-stop: everything already playing slows to a halt while the music and ambience fade
    for (const pl of this.playing.values()) {
      if (pl.bus === 'ui' || !this.juice) continue;
      const r = pl.src.playbackRate;
      r.cancelScheduledValues(when);
      r.setValueAtTime(pl.baseRate * this.rateFactor, when);
      r.linearRampToValueAtTime(Math.max(0.05, pl.baseRate * 0.2), when + 0.6);
      pl.gain.gain.setTargetAtTime(0, when + 0.3, 0.12);
    }
    if (this.juice) this.music.stopRun(when);
    else this.music.stop(when);
    this.rateFactor = 1;
    this.mixer.clearOverlays(when);
    this.mixer.setBase('gameover', when, 0.2);
    this.haptic('gameOver');
    if (cause !== 'quit') this.say('aww', when + 0.75, { shape: this.lastShape, force: true });
    // journey flourish: one note per biome reached, bottom to top, then the "nice try" phrase
    const journey: { inst: InstrumentId; midi: number }[] = [];
    for (let b = 1; b <= this.maxBiome; b++) {
      const bd = biome(b);
      const { inst, octave } = MATERIAL_INSTRUMENT[bd.material];
      journey.push({ inst, midi: bd.key.root + 12 * octave });
    }
    const { inst, octave } = this.instFor();
    const phrase = [4, 2, 1, 0].map((d) => scaleNote(this.key, d) + 12 * octave);
    const t = when + 1.1 + journey.length * 0.13;
    this.mixer.setBase('results', t + 1.4, 0.5);
    this.music.showScreen('results', t + 1.4);
    if (!this.juice) return;
    this.withNotes([...journey.map((j) => ({ inst: j.inst, midis: [j.midi] })), ...phrase.map((m) => ({ inst, midis: [m] }))], () => {
      journey.forEach((j, i) => this.playNote(j.inst, j.midi, { bus: 'ui', when: when + 1.1 + i * 0.13, gainDb: -12, priority: 2, slowmo: false }));
      phrase.forEach((m, i) => this.playNote(inst, m, { bus: 'ui', when: t + 0.3 + i * 0.22, gainDb: -10, priority: 2, slowmo: false }));
    });
  }

  private onHazardWarning(p: Payload, when: number): void {
    const type = hazardType(str(p, 'type'));
    const eta = clamp(num(p, 'eta', 2), 0.2, 6);
    const pan = dirPan(p?.dir) * 0.5;
    // a hazard's first appearance: a friendly "heads up" under its hint card
    if (bool(p, 'first')) {
      const { inst, octave } = this.instFor();
      [4, 7].forEach((d, i) => this.playNote(inst, scaleNote(this.key, d) + 12 * octave, { bus: 'ui', when: when + i * 0.14, gainDb: -12, category: 'ui', priority: 2, slowmo: false }));
    }
    switch (type) {
      case 'junk':
        for (let i = 0; i < 3; i++) this.play('radar', { when: when + (i * eta) / 3, gainDb: -15, pan, category: 'misc', priority: 3 });
        break;
      case 'meteor': {
        const n = 2 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) this.play('meteor.whistle', { when: when + Math.max(0, eta - 0.8) + this.rng() * 0.3, gainDb: -15, pan: (this.rng() * 2 - 1) * 0.4, category: 'misc', priority: 3 });
        break;
      }
      case 'dust':
        this.play('dust.swirl', { when, gainDb: -12, pan, category: 'misc', priority: 2 });
        break;
      case 'tidal':
        if (!this.hazardLoops.has('tidal')) {
          const l = this.play('tidal.loop', { when, gainDb: -14, attack: Math.min(eta, 2), category: 'ambience', priority: 2, vary: false });
          if (l) this.hazardLoops.set('tidal', l);
        }
        break;
      default: {
        // gusts and crosswind: a rising whoosh timed to end as the push arrives
        const w = this.play('gust.warn', { when, offset: Math.max(0, 2.0 - eta), gainDb: -10, pan, category: 'misc', priority: 2 });
        if (w) this.hazardLoops.set(`${type}.warn`, w);
      }
    }
    this.haptic('hazardWarn');
  }

  private onHazardStart(p: Payload, when: number): void {
    const type = hazardType(str(p, 'type'));
    this.hazardLoops.delete(`${type}.warn`); // the whoosh has done its job, so let it finish
    const strength = clamp(num(p, 'strength', 0.1) / 0.15, 0, 1);
    if (type === 'gust') this.play('gust.push', { when, gainDb: -14 + 6 * strength, pan: dirPan(p?.dir) * 0.4, category: 'misc', priority: 2 });
    else if (type === 'crosswind' && !this.hazardLoops.has(type)) {
      const l = this.play('wind.loop', { when, gainDb: -18 + 5 * strength, pan: dirPan(p?.dir) * 0.4, attack: 1, category: 'ambience', priority: 3, vary: false });
      if (l) this.hazardLoops.set(type, l);
    } else if (type === 'dust') this.play('dust.swirl', { when, gainDb: -11, category: 'misc', priority: 2 });
  }

  // ------------------------------------------------------------ Blockling Pop (Pop plan, Music and sound)

  private dispatchPop(name: string, p: Payload, when: number): void {
    const R = this.popRun;
    // the run start was missed (sent before the bank was ready): the first move starts it
    if (!R.on && (name === 'pop_pickup' || name === 'pop_place') && when - R.overAt > 1) this.onPopStart({ biome: this.biomeId || 1 }, when);
    switch (name) {
      case 'pop_run_start':
        this.onPopStart(p, when);
        break;
      case 'pop_pickup': {
        this.play('pop.boop', { when, gainDb: -13, rate: semis(SHAPE_VOICE[popShape(p?.shape)] ?? 0), category: 'ui', priority: 2, slowmo: false });
        this.haptic('light');
        break;
      }
      case 'pop_ghost':
        if (!this.cool.ready('popghost', when, 0.035)) break;
        this.play('pop.snap', { when, gainDb: -19, rate: semis(2 * clamp(num(p, 'lines', 0), 0, 3)), category: 'ui', priority: 3, slowmo: false });
        this.haptic('select');
        break;
      case 'pop_would_pop':
        this.wouldPop(Math.max(0, Math.round(num(p, 'count', 0))), when);
        break;
      case 'pop_drop_back':
        this.wouldPop(0, when);
        this.play('pop.boing', { when, gainDb: -15, category: 'misc', priority: 2 });
        this.haptic('light');
        break;
      case 'pop_place':
        this.onPopPlace(p, when);
        break;
      case 'pop_lines':
        this.onPopLines(p, when);
        break;
      case 'pop_combo': {
        const combo = Math.max(1, Math.round(num(p, 'combo', R.combo)));
        R.combo = combo;
        this.music.popInput({ combo });
        this.play('pop.tick', {
          when: when + 0.1, gainDb: -16, rate: semis(scaleNote({ root: 0, mode: this.key.mode }, Math.min(combo - 2, 9))),
          category: 'ui', priority: 2, vary: false, slowmo: false,
        });
        break;
      }
      case 'pop_combo_end':
        R.combo = 0;
        this.music.popInput({ combo: 0 });
        this.play('pop.fizz', { when, gainDb: -17, category: 'misc', priority: 3 });
        break;
      case 'pop_all_clear':
        this.onAllClear(when);
        break;
      case 'pop_checkpoint':
        this.onPopCheckpoint(Math.round(num(p, 'n', R.cp + 1)), when);
        break;
      case 'biome_entered':
        this.popBiome(Math.round(num(p, 'id', this.biomeId)), when, true);
        break;
      case 'pop_tray':
        R.cantFit.clear();
        if (!this.cool.ready('poptray', when, 0.2)) break;
        for (let i = 0; i < 3; i++) this.play('pop.flick', { when: when + i * 0.07, gainDb: -21 - i, rate: 1 + i * 0.04, category: 'ui', priority: 3, slowmo: false });
        break;
      case 'pop_bag':
        this.play('swap', { when, gainDb: -14, category: 'ui', priority: 2 });
        this.haptic('double', 0.6);
        break;
      case 'pop_cant_fit': {
        const slot = Math.round(num(p, 'slot', -1));
        if (R.cantFit.has(slot)) break;
        R.cantFit.add(slot);
        if (this.juice && this.cool.ready('popuh', when, 1)) this.play('pop.uh', { bus: 'voices', when, gainDb: -13, category: 'misc', priority: 3 });
        break;
      }
      case 'pop_fill':
        this.music.popInput({ fill: num(p, 'fill', 0) });
        break;
      case 'pop_no_room':
        this.onNoRoom(when, bool(p, 'waiting'));
        break;
      case 'pop_run_over':
      case 'run_over':
        this.onPopOver(str(p, 'cause', ''), when);
        break;
      // milestone 3: bubbles, powers and Second Wind
      case 'pop_bubble':
        // a bubble floats down onto its cell
        if (this.cool.ready('popbubble', when, 0.5)) this.play('bubble.spawn', { when, gainDb: -15, category: 'misc', priority: 3 });
        break;
      case 'pop_bubble_got':
        // a shape covers it: the film bursts, the icon flies to a slot with a chime
        this.play('bubble.pop', { when, gainDb: -9, category: 'misc', priority: 2 });
        if (this.juice) this.popChime(when + 0.04, -12);
        this.haptic('double', 0.7);
        break;
      case 'pop_bubble_gone':
        this.play('boop', { when, gainDb: -24, rate: 1.6, category: 'misc', priority: 4 });
        break;
      case 'pop_power_got': {
        // straight into a slot (a big pop, an All Clear, a checkpoint, the head start): after the moment that earned it
        const at = Math.max(when, this.lastCheckpointAt + 1, this.lastGrantAt + 0.45);
        this.lastGrantAt = at;
        if (!this.juice) {
          this.play('bubble.pop', { when: at, gainDb: -14, category: 'misc', priority: 3 });
          break;
        }
        this.popChime(at, -13);
        this.play('shimmer', { when: at + 0.15, gainDb: -17, category: 'misc', priority: 4 });
        this.haptic('double', 0.5, at - when);
        break;
      }
      case 'pop_power':
        this.onPopPower(str(p, 'kind', ''), p, when);
        break;
      case 'pop_meteor_hit':
        this.onMeteorHit(Array.isArray(p?.cells) ? p.cells.length : 6, when);
        break;
      case 'pop_power_refused':
        this.play('rotate.blocked', { bus: 'ui', when, gainDb: -12, rate: 0.8, category: 'ui', priority: 2, slowmo: false });
        this.haptic('rotateBlocked');
        break;
      case 'pop_aim':
        this.play('ui.open', { bus: 'ui', when, gainDb: -17, category: 'ui', priority: 3, slowmo: false });
        this.haptic('light');
        break;
      case 'pop_aim_move':
        // like the ghost: a faint snap as the target steps a cell
        if (!this.cool.ready('popaim', when, 0.035)) break;
        this.play('pop.snap', { when, gainDb: -21, rate: 0.9, category: 'ui', priority: 3, slowmo: false });
        this.haptic('select');
        break;
      case 'pop_aim_cancel':
        this.play('ui.back', { bus: 'ui', when, gainDb: -16, category: 'ui', priority: 3, slowmo: false });
        break;
      case 'pop_spin':
        // each tap turns a tray shape: an 80 ms snap and a little whoosh arc
        if (!this.cool.ready('popspin', when, 0.06)) break;
        this.play('pop.snap', { when, gainDb: -14, rate: 1.1, category: 'ui', priority: 2, slowmo: false });
        if (this.juice) this.play('pop.whoosh', { when: when + 0.01, gainDb: -17, rate: 1.3, category: 'misc', priority: 3 });
        this.haptic('select');
        break;
      case 'pop_wind_ready': {
        // never a nag: silent at run start, one soft cue when checkpoint 2 earns it
        if (str(p, 'why', 'start') === 'start') break;
        const at = Math.max(when, this.lastCheckpointAt + 2.2);
        if (this.juice) this.play('shimmer', { when: at, gainDb: -17, category: 'misc', priority: 3 });
        this.popNote(this.popStyle.pop!.board, this.popPitch(7), { when: at + 0.05, gainDb: -17 });
        break;
      }
      case 'pop_wind_armed':
        // the first of the two taps: a breath in
        this.play('ui.on', { bus: 'ui', when, gainDb: -14, rate: 1.1, category: 'ui', priority: 2, slowmo: false });
        if (this.juice) this.play('pop.whoosh', { when, gainDb: -20, rate: 0.7, category: 'misc', priority: 3 });
        this.haptic('light');
        break;
      case 'pop_second_wind':
        this.onPopSecondWind(Array.isArray(p?.cells) ? p.cells.length : 27, when);
        break;
      // shared with the tower
      case 'pause':
      case 'resume':
      case 'xp_tick':
      case 'level_up':
      case 'achievement':
      case 'unlock':
        this.dispatchTower(name, p, when);
        break;
    }
  }

  /** Pop's band for the biome and Deep Cosmos rotation the run is in (its board instrument and scales). */
  private get popStyle(): MusicStyle {
    return popStyleFor(this.biomeId, this.biomeId === 10 ? cosmosRotation(this.popRun.cp) : 0);
  }

  /** A pentatonic step on the board's register, in the current key. */
  private popPitch(step: number): number {
    return pent(this.key, tonicAt(this.key, this.popStyle.pop!.boardLow), step);
  }

  /** A note on the board's instrument, baked at half rate like the rest of Pop. */
  private popNote(inst: InstrumentId, midi: number, o: PlayOptions = {}): Playing | null {
    return this.playBuffer(this.bank.note(inst, midi, true), { category: 'note', priority: 2, vary: false, ...o });
  }

  private popChord(inst: InstrumentId, midis: number[], o: PlayOptions = {}, spread = 0): Playing | null {
    return this.playBuffer(this.bank.chord(inst, midis, spread, true), { category: 'stinger', priority: 2, vary: false, ...o });
  }

  /** Bakes the board's notes and answer chords in the current key: the landing ladder and every glissando. */
  private warmPop(): void {
    const style = this.popStyle, v = style.pop!;
    const items: NoteRequest[] = [];
    for (let st = 0; st <= 15; st++) items.push({ inst: v.board, midis: [this.popPitch(st)], low: true });
    for (const d of new Set([0, ...style.progressions.flat()])) items.push({ inst: v.board, midis: voice(triadPcs(this.key, d), v.boardLow), low: true });
    items.push({ inst: v.board, midis: voice(triadPcs(this.key, 0), v.boardLow), spread: 0.03, low: true });
    void this.bank.warmNotes(items);
  }

  private onPopStart(p: Payload, when: number): void {
    const R = (this.popRun = newPopRun());
    R.on = true;
    R.puzzle = bool(p, 'puzzle');
    R.cp = Math.max(0, Math.round(num(p, 'cp', 0)));
    void this.bank.prepareMode('pop');
    this.mixer.clearOverlays(when);
    this.mixer.setBase('playing', when);
    this.biomeId = 0;
    this.popBiome(Math.round(num(p, 'biome', 1)), when, false);
    this.music.startPop(when, this.biomeId, { cp: R.cp, fill: num(p, 'fill', 0), puzzle: R.puzzle });
  }

  /** A biome entered (1 to 10): its entry moment, and the band moves to its family at the next bar line. */
  private popBiome(id: number, when: number, entry: boolean): void {
    const b = biome(id);
    const changed = b.id !== this.biomeId;
    this.biomeId = b.id;
    this.key = biomeKey(b.id, this.popRun.cp);
    this.mixer.setAir(b.air, when);
    if (!changed) return;
    void this.bank.prepareBiome(b.id);
    this.music.popBiome(b.id, this.popRun.cp);
    this.warmPop();
    if (entry && this.juice) {
      const at = Math.max(when, this.lastCheckpointAt + 1.2);
      this.play(`entry.${b.id}`, { when: at, gainDb: b.id === 4 ? -8 : -11, category: 'stinger', priority: 1, slowmo: false });
      this.haptic('medium', 1, at - this.now());
    }
  }

  /** The lines a held shape would pop glow: a soft shimmer loops until it moves off or lands. */
  private wouldPop(count: number, when: number): void {
    const R = this.popRun;
    if (count > 0) {
      const db = -23 + 2 * Math.min(count, 3);
      if (!R.shimmer) R.shimmer = this.play('pop.shimmer', { when, gainDb: db, attack: 0.08, loop: true, category: 'ambience', priority: 2, vary: false, slowmo: false });
      else R.shimmer.gain.gain.setTargetAtTime(dbToGain(db), when, 0.05);
    } else if (R.shimmer) {
      this.stopPlaying(R.shimmer, when, 0.12);
      this.voices.remove(R.shimmer.id);
      R.shimmer = null;
    }
  }

  /** A shape stamped onto the board: its skin's impact, then (juice) a keys stab and a landing note. */
  private onPopPlace(p: Payload, when: number): void {
    const R = this.popRun;
    this.wouldPop(0, when);
    R.placed++;
    const cells = Math.round(num(p, 'cells', 4));
    this.play(this.impactName(asMaterial(p?.material, this.material), cells >= 5 ? 3 : 2), { when, gainDb: -9, category: 'impact', priority: 2 });
    this.haptic('medium');
    if (!this.juice) return;
    // the notes climb the scale while a combo is alive; otherwise placements walk up five steps and start over
    R.step = R.combo > 0 ? Math.min(R.step + 1, 9) : (R.placed - 1) % 5;
    this.popNote(this.popStyle.pop!.board, this.popPitch(R.step), { when: when + 0.01, gainDb: -12 });
    const h = this.music.popHarmony(when);
    if (h) {
      const stab = this.playChord(h.chord.inst, h.chord.midis, { when, gainDb: -17, priority: 3 }, h.chord.spread);
      if (stab) this.stopPlaying(stab, when + 0.18, 0.09);
    }
  }

  /**
   * Lines pop. What popped is always heard: the clack and a plip for each step of the wave. With juice,
   * the board plays: the first note at once, then one note up the scale per cell, 39 ms apart from the
   * end of the freeze, each line a third above the last; the answer lands on the next sixteenth.
   */
  private onPopLines(p: Payload, when: number): void {
    const R = this.popRun;
    const count = Math.max(1, Math.round(num(p, 'count', 1)));
    R.combo = Math.max(1, Math.round(num(p, 'combo', R.combo + 1)));
    this.music.popped();
    this.music.popInput({ combo: R.combo });
    const raw = Array.isArray(p?.lines) ? (p.lines as unknown[]).map(Number).filter((n) => n > 0) : [];
    const lens = raw.length ? raw : Array<number>(count).fill(9);
    const stop = clamp(num(p, 'hitstop', count >= 3 ? 80 : count === 2 ? 60 : 40), 0, 300) / 1000;
    const steps = Math.min(9, Math.max(...lens));
    this.play('row.clack', { when, gainDb: -6, category: 'stinger', priority: 1 });
    for (let k = 0; k < steps; k++) {
      this.play('pop.plip', { when: when + (k ? stop + k * POP_STEP : 0), gainDb: -19 + Math.min(4, count), rate: semis(k * 0.5), category: 'misc', priority: 2 });
    }
    this.haptic(count >= 2 ? 'heavyDouble' : 'heavy');
    if (!this.juice) return;
    const style = this.popStyle, v = style.pop!;
    const from = R.step % 5;
    const lines = lens.slice(0, POP_HARMONY.length);
    // in time order, so each new note takes over from the oldest one still ringing
    for (let k = 0; k < steps; k++) {
      lines.forEach((len, j) => {
        if (k >= len) return;
        this.popNote(v.board, this.popPitch(from + POP_HARMONY[j] + k), { when: k ? when + stop + k * POP_STEP : when, gainDb: -12 });
      });
    }
    const at = this.music.nextGrid(when + 0.04, 0.25);
    const h = this.music.popHarmony(at);
    const degree = h?.degree ?? 0;
    if (h) this.playChord(h.chord.inst, h.chord.midis, { when: at, gainDb: -14, priority: 2 }, h.chord.spread);
    this.popChord(v.board, voice(triadPcs(this.key, degree), v.boardLow), { when: at, gainDb: count >= 2 ? -9 : -11, priority: 1 });
    if (count >= 2) {
      this.popNote(v.board, this.popPitch(10), { when: at + 0.02, gainDb: -13 });
      // a little crowd of shapes cheering
      if (this.say('yay', when + 0.25, { minGap: TUNING.voiceGapCheckpoint })) {
        for (let i = 0; i < Math.min(3, count - 1); i++) this.say('yay', when + 0.37 + i * 0.11, { force: true, gainDb: -15 - i });
      }
    }
    if (count >= 3) this.play('shimmer', { when: at + 0.05, gainDb: -12, category: 'misc', priority: 3 });
  }

  /** The jackpot: an instant hit and a crowd roar, the band's fanfare from the next beat, success three times. */
  private onAllClear(when: number): void {
    this.play('flag', { when, gainDb: this.juice ? -12 : -8, category: 'stinger', priority: 1 });
    if (!this.juice) return;
    const at = this.music.allClear(when);
    const v = this.popStyle.pop!;
    this.popChord(v.board, voice(triadPcs(this.key, 0), v.boardLow), { when: when + 0.02, gainDb: -8, priority: 1 }, 0.03);
    this.popNote(v.board, this.popPitch(10), { when: when + 0.1, gainDb: -11 });
    for (let i = 0; i < 2; i++) this.play('firework', { when: when + 0.15 + i * 0.3, gainDb: -12, pan: [-0.4, 0.4][i], category: 'stinger', priority: 2 });
    for (let i = 0; i < 3; i++) this.play('confetti', { when: when + 0.1 + this.rng() * 0.4, gainDb: -15, pan: (this.rng() * 2 - 1) * 0.5, category: 'misc', priority: 4 });
    this.play('shimmer', { when: at, gainDb: -12, category: 'misc', priority: 3 });
    this.say('yay', when + 0.3, { force: true });
    for (let i = 0; i < 3; i++) this.say('yay', when + 0.42 + i * 0.1, { force: true, gainDb: -14 - i });
    this.say('whee', when + 0.8, { force: true, gainDb: -15 });
    for (let i = 0; i < 3; i++) this.haptic('success', 1, i * 0.35);
  }

  private onPopCheckpoint(n: number, when: number): void {
    const R = this.popRun;
    R.cp = n;
    this.lastCheckpointAt = when;
    this.play('flag', { when, gainDb: -8, category: 'stinger', priority: 1 });
    if (this.juice) this.play('pop.whoosh', { when: when + 0.05, gainDb: -14, category: 'misc', priority: 3 });
    this.haptic('medium');
    // Deep Cosmos turns key every 6 checkpoints
    if (this.biomeId === 10) {
      const k = biomeKey(10, n);
      const turned = k.root !== this.key.root || k.mode !== this.key.mode;
      this.key = k;
      if (turned) this.warmPop();
    }
    this.music.popBiome(this.biomeId, n);
  }

  /** No room: "uh-oh" from the shapes and the error buzz. The run ends a moment later (pop_run_over). */
  /** "No room!": the error and the Blocklings' uh-oh. Waiting for a power or End run, one uh-oh, not a chorus. */
  private onNoRoom(when: number, waiting = false): void {
    const R = this.popRun;
    if (when - R.noRoomAt < 1) return;
    R.noRoomAt = when;
    this.wouldPop(0, when);
    this.play('ui.error', { bus: 'ui', when, gainDb: -12, category: 'ui', priority: 1, slowmo: false });
    if (this.say('uhoh', when + 0.1, { force: true }) && !waiting) this.say('uhoh', when + 0.28, { force: true, gainDb: -15 });
    this.haptic('error');
  }

  /** The run is over: the board tumbles, the band tape-stops into "nice try", then Pop's results loop. */
  private onPopOver(cause: string, when: number): void {
    const R = this.popRun;
    if (!R.on) return;
    if (cause === 'noroom' && when - R.noRoomAt > 3) this.onNoRoom(when);
    R.on = false;
    R.overAt = when;
    this.wouldPop(0, when);
    for (let i = 0; i < 7; i++) {
      this.play(this.impactName(this.material, i < 2 ? 3 : 2), {
        when: when + 0.05 + i * 0.11 + this.rng() * 0.05, gainDb: -12 - 1.5 * i, pan: (this.rng() * 2 - 1) * 0.5, category: 'impact', priority: 3,
      });
    }
    const t = this.music.stopPop(when);
    this.mixer.clearOverlays(when);
    this.mixer.setBase('results', when + 0.4, 0.5);
    if (cause !== 'end') this.say('aww', when + 0.75, { force: true });
    this.music.showScreen('popResults', t);
  }

  /** Leaving Pop in the middle of a run (setMode('tower')): it closes quietly. */
  private endPop(when: number): void {
    const R = this.popRun;
    R.on = false;
    R.overAt = when;
    this.wouldPop(0, when);
    this.music.stop(when);
  }

  /** A power used (Pop plan, Power-ups). Meteor's impact comes with pop_meteor_hit, once the streak lands. */
  private onPopPower(kind: string, p: Payload, when: number): void {
    switch (kind) {
      case 'undo':
        this.play('pop.rewind', { when, gainDb: -9, category: 'misc', priority: 2 });
        this.haptic('light');
        break;
      case 'spin':
        // Spin turns on; each tap after it is a pop_spin
        this.play('ui.on', { bus: 'ui', when, gainDb: -13, category: 'ui', priority: 2, slowmo: false });
        if (this.juice) this.play('pop.whoosh', { when: when + 0.02, gainDb: -15, category: 'misc', priority: 3 });
        this.haptic('light');
        break;
      case 'sweep': {
        const cells = Array.isArray(p?.cells) ? p.cells.length : 9;
        this.play('sweep', { when, gainDb: -13 + 5 * clamp(cells / 18, 0, 1), category: 'misc', priority: 2 });
        // the line's Blocklings tumble off the board, going "whee"
        if (this.say('whee', when + 0.12, { force: true })) this.say('whee', when + 0.3, { force: true, gainDb: -16 });
        this.haptic('medium');
        break;
      }
      case 'meteor':
        // the target is set and the meteor streaks in (260 ms)
        this.play('meteor.whistle', { when, gainDb: -12, rate: 1.6, category: 'misc', priority: 2 });
        break;
      case 'fresh':
        this.play('pop.shuffle', { when, gainDb: -10, category: 'misc', priority: 2 });
        if (this.juice) for (let i = 0; i < 3; i++) this.play('pop.flick', { when: when + 0.22 + i * 0.08, gainDb: -18 - i, rate: 1 + i * 0.05, category: 'ui', priority: 3, slowmo: false });
        this.haptic('light');
        break;
      default:
        this.play('ui.on', { bus: 'ui', when, gainDb: -12, category: 'ui', priority: 3, slowmo: false });
    }
  }

  /** The meteor lands: a flash, the cells shatter into stone chips, a crater puff. */
  private onMeteorHit(cells: number, when: number): void {
    this.play('meteor.pop', { when, gainDb: -6, category: 'stinger', priority: 1 });
    this.play(this.impactName('stone', 4), { when, gainDb: -8, category: 'impact', priority: 1 });
    if (this.juice) {
      const chips = clamp(Math.round(cells / 3), 2, 4);
      for (let i = 0; i < chips; i++) this.play(this.impactName('stone', 1), { when: when + 0.08 + i * 0.06 + this.rng() * 0.03, gainDb: -17 - i, pan: (this.rng() * 2 - 1) * 0.4, category: 'impact', priority: 3 });
      this.play('windgust', { when: when + 0.05, gainDb: -22, rate: 1.4, category: 'misc', priority: 4 });
    }
    this.haptic('heavy');
  }

  /**
   * Second Wind: the tower's gust, the chosen rows and columns blowing away left to right over about
   * half a second, and the music swelling into the board's chord.
   */
  private onPopSecondWind(cells: number, when: number): void {
    this.play('windgust', { when, gainDb: -6, category: 'misc', priority: 1 });
    const n = clamp(Math.round(cells / 4), 4, 9);
    for (let i = 0; i < n; i++) this.play('pop.plip', { when: when + 0.1 + (i * 0.5) / n, gainDb: -20, rate: semis(i), category: 'misc', priority: 3 });
    this.haptic('double', 0.8);
    if (!this.juice) return;
    const v = this.popStyle.pop!;
    this.popChord(v.board, voice(triadPcs(this.key, 0), v.boardLow), { when: when + 0.65, gainDb: -9, priority: 1 }, 0.03);
    this.play('swell', { when: when + 0.3, gainDb: -14, category: 'misc', priority: 3 });
    this.play('shimmer', { when: when + 0.75, gainDb: -12, category: 'misc', priority: 3 });
    this.haptic('celebrate', 1, 0.65);
  }

  /** A power arriving in a slot: three rising notes on the board's instrument. */
  private popChime(when: number, gainDb: number): void {
    [5, 6, 7].forEach((st, i) => this.popNote(this.popStyle.pop!.board, this.popPitch(st), { when: when + i * 0.07, gainDb: gainDb - i }));
  }

  private stopDrumroll(when: number): void {
    if (this.drumroll) {
      this.stopPlaying(this.drumroll, when, 0.1);
      this.voices.remove(this.drumroll.id);
      this.drumroll = undefined;
    }
  }
}

const TIERS = ['bronze', 'silver', 'gold', 'platinum'];

/** A Blockling Pop run's sound state. */
interface PopRun {
  on: boolean;
  puzzle: boolean;
  cp: number;
  combo: number;
  /** the landing ladder, in pentatonic steps on the board's instrument */
  step: number;
  placed: number;
  shimmer: Playing | null;
  cantFit: Set<number>;
  noRoomAt: number;
  overAt: number;
}

function newPopRun(): PopRun {
  return { on: false, puzzle: false, cp: 0, combo: 0, step: 0, placed: 0, shimmer: null, cantFit: new Set(), noRoomAt: -10, overAt: -10 };
}

/** One popping cell to the next: a 64th note at 96 BPM, like the view's wave. */
const POP_STEP = 0.039;

/** Where each popping line's glissando starts above the first: root, third, fifth (pentatonic steps). */
const POP_HARMONY = [0, 2, 3];

/** A Pop shape named by key ('Plank') or by number (POP_KEYS order). */
function popShape(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return POP_SHAPE_KEYS[Math.round(v)] ?? '';
  return typeof v === 'string' ? v : '';
}

function hazardType(t: string): string {
  const s = t.toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('junk') || s.includes('debris')) return 'junk';
  if (s.includes('meteor')) return 'meteor';
  if (s.includes('dust')) return 'dust';
  if (s.includes('tidal') || s.includes('sway')) return 'tidal';
  if (s.includes('cross')) return 'crosswind';
  return 'gust';
}

function dirPan(d: unknown): number {
  if (typeof d === 'number') return Math.sign(d);
  if (typeof d === 'string') return d.startsWith('l') ? -1 : d.startsWith('r') ? 1 : 0;
  if (d && typeof d === 'object' && 'x' in (d as any)) return Math.sign(Number((d as any).x) || 0);
  return 0;
}

function makeBaker(worker: DirectorOptions['worker'], realtime: boolean): Baker {
  const thread = new ThreadBaker(realtime ? 1 : 0);
  if (!worker) return thread;
  try {
    return new FallbackBaker(new WorkerBaker(typeof worker === 'function' ? worker() : worker), thread);
  } catch {
    return thread;
  }
}

function detectLowEnd(): boolean {
  const nav = (globalThis as any).navigator;
  const cores = nav?.hardwareConcurrency ?? 8;
  const mem = nav?.deviceMemory ?? 8;
  return cores <= 4 && mem <= 3;
}

export { DEFAULT_SETTINGS };
export type { Overlay };
