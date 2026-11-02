// The music engine (audio section 4): a look-ahead sequencer on the audio
// clock. It plays the composer's bars through the bank's baked notes, brings
// layers in and out on bar lines from the run's state, and follows tension and
// the checkpoint riser live. It has its own voice pool, separate from the
// effects', so the band never steals an impact and an impact never steals the band.
//
//   L1 pad + bass   from run start (closes its filter as tension rises)
//   L2 support + drums   after 5 settles; denser after each checkpoint in a biome
//   L3 lead   streak of 4+ or the last 25% to a checkpoint, held 4 bars; out above tension 0.6
//   L4 tension   faded in by tension 0.3 to 0.7
//   L5 riser   the last 15% to a checkpoint, previewing the next biome's lead
//   breakdown   8 bars of L1 only every 72 bars (about 3 minutes)
//
// Blockling Pop (startPop) plays its own families at 96 BPM with layers that follow the board instead:
// the bed (keys and bass) from the start, the groove after the first pop, the lead at combo 3, the
// sparkle at combo 6, the tension layer at 70% full, a breather when the board empties, the All Clear
// fanfare, and "nice try" after the tape stop. The tower's lullaby stays the main menu's; the Pop hub
// and Pop's results loop play the lounge.

import type { NoteRequest, SoundBank } from '../bank';
import { BIOMES, biome, biomeKey, cosmosRotation } from '../biomes';
import { clamp, dbToGain, lerp } from '../synth/dsp';
import { BAR, SECTION_BARS, Theme, type NoteEvent, type Part } from './composer';
import { popBreather, popFanfare, popNiceTry, popNotes, popSparkle, popTension } from './popcomposer';
import { LOUNGE, popStyleFor } from './styles-pop';
import { LULLABY, styleFor, type MusicStyle } from './styles';
import type { Key } from './theory';

/** Music outside a run: the lullaby's menus and results, and Pop's hub ('pop') and results ('popResults'). */
export type MusicScreen = 'menu' | 'profile' | 'results' | 'pop' | 'popResults';
export type MusicMode = 'off' | 'run' | 'popRun' | MusicScreen;

/** Tunable thresholds, exposed so they can be adjusted from playtests. */
export const MUSIC_TUNING = {
  /** how far ahead bars are scheduled (s); must exceed the gap between ticks */
  lookahead: 0.35,
  voices: 16,
  grooveAfterSettles: 5,
  leadStreak: 4,
  leadProgress: 0.75,
  leadHoldBars: 4,
  tensionFrom: 0.3,
  tensionFull: 0.7,
  /** L3 steps aside for L4 at this tension */
  tensionTakeover: 0.6,
  riserAt: 0.85,
  breakdownEvery: 72,
  breakdownBars: 8,
  /** L1-only bars when a new biome's band comes in (the first run of a session gets two at run start too) */
  introBars: 2,
  /** Blockling Pop's layers (Pop plan, Music and sound) */
  pop: {
    leadCombo: 3,
    /** bars the lead stays after the combo drops below leadCombo */
    leadHoldBars: 2,
    sparkleCombo: 6,
    /** board fullness (0 to 1): the tension layer comes in at tensionAt and lifts below tensionExit */
    tensionAt: 0.7,
    tensionExit: 0.55,
    /** the board dropping under this starts a breather */
    breatherBelow: 0.2,
    breatherBars: 4,
    /** at most one breather (other than the All Clear's) in this many bars, so a board hovering near empty doesn't keep stopping the band */
    breatherGapBars: 16,
    fanfareBars: 2,
  },
};

const PARTS: Part[] = ['pad', 'bass', 'support', 'drums', 'lead', 'tension', 'riser', 'sparkle'];

/** Pad, bass and lead carry the song; drums, support and Pop's sparkle thin out first. */
const PRIORITY: Record<Part, number> = { pad: 1, bass: 1, lead: 1, tension: 2, riser: 2, support: 3, drums: 3, sparkle: 3 };

/** Release time constant after a note's written length (s). Drums and bells ring out. */
const RELEASE: Record<Part, number> = { pad: 0.45, bass: 0.06, lead: 0.09, support: 0.12, drums: 0, tension: 0.04, riser: 0.06, sparkle: 0.1 };

const SCREEN_PARTS: Record<MusicScreen, Part[]> = {
  menu: ['pad', 'bass', 'support', 'lead'],
  // Blake (2026-11-01): the menus' music carries on unchanged from screen to screen; only a run changes it
  profile: ['pad', 'bass', 'support', 'lead'],
  // a warm 8-bar loop under the XP tally, in the level-up fanfare's key
  results: ['pad', 'bass', 'support'],
  // the Pop hub and world map: the lounge with a light groove
  pop: ['pad', 'bass', 'support', 'drums', 'lead'],
  // Pop's results loop, in the lounge
  popResults: ['pad', 'bass', 'support'],
};

/** Screens that loop the theme's first section. */
const LOOP_SCREENS = new Set<MusicMode>(['results', 'popResults']);

/** Screens that play the lounge rather than the lullaby. */
const LOUNGE_SCREENS = new Set<MusicMode>(['pop', 'popResults']);

/** What Pop's band is doing, set by the game's board and decided on bar lines. */
interface PopState {
  puzzle: boolean;
  fill: number;
  combo: number;
  pops: number;
  tension: boolean;
  /** bars of breather left, and one waiting for the next bar line */
  breather: number;
  breatherNext: boolean;
  /** the run bar the last breather started on */
  breatherAt: number;
  /** bars of fanfare left */
  fanfare: number;
  leadUntil: number;
  layers: { groove: boolean; lead: boolean; sparkle: boolean; tension: boolean; breather: boolean };
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  part: Part;
  priority: number;
  start: number;
  end: number;
}

interface Band {
  id: string;
  theme: Theme;
  /** Pop's warm-up list, worked out once per band (it takes a few milliseconds) */
  list?: NoteRequest[];
}

export interface MusicInputs {
  tension: number;
  /** 0 to 1 towards the next checkpoint */
  progress: number;
  /** clean placements in a row */
  streak: number;
}

export class MusicEngine {
  readonly out: GainNode;
  /** false for Gate 1's juice-off runs: the band plays its theme with every layer but doesn't follow the run */
  reactive = true;
  private parts: Record<Part, GainNode>;
  private l1Filter: BiquadFilterNode;
  private voices: Voice[] = [];
  private _mode: MusicMode = 'off';
  private band?: Band;
  /** the run band that takes over at the next bar line */
  private target?: Band;
  private lullaby?: Band;
  private lounge?: Band;
  private pop: PopState = newPop(false, 0);
  /** time of the current band's bar 0, and the next bar to schedule */
  private t0 = 0;
  private bar = 0;
  private intro = 0;
  /** bars since the run started, for breakdowns and the lead's hold */
  private runBars = 0;
  private settles = 0;
  private biomeId = 1;
  private checkpoint = 0;
  private entryCheckpoint = 0;
  private leadUntil = -1;
  private leadOn = false;
  private grooveOn = false;
  private riserOn = false;
  private riserStep = 0;
  private inputs: MusicInputs = { tension: 0, progress: 0, streak: 0 };
  /** the last L4 level and L1 filter sent, so ticks only automate changes */
  private live = { tension: 0, filter: 20000 };
  private runs = 0;
  private warmed = new Set<string>();
  /** Pop's recent bands, so a band met again keeps its warm-up list */
  private popBands = new Map<string, Band>();
  /** a first downbeat waiting for its notes (see holdFor) */
  private hold: { until: number; items: NoteRequest[] } | null = null;
  /** The next Pop area's band, composed on the next update (prewarmPop). */
  private nextWarm: (() => void) | null = null;
  private popStart: Band | undefined;
  private warming: Promise<void>[] = [];
  readonly stats = { bars: 0, notes: 0, misses: 0, stolen: 0, dropped: 0, peakVoices: 0 };
  /** the last few notes that weren't baked in time (played as silence) */
  readonly missed: string[] = [];
  /** layer changes, for tests and the debug overlay */
  readonly log: { t: number; what: string }[] = [];

  constructor(private ctx: BaseAudioContext, dest: AudioNode, private bank: SoundBank) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.l1Filter = ctx.createBiquadFilter();
    this.l1Filter.type = 'lowpass';
    this.l1Filter.frequency.value = 20000;
    this.l1Filter.Q.value = 0.5;
    this.l1Filter.connect(this.out);
    this.parts = {} as Record<Part, GainNode>;
    for (const p of PARTS) {
      const g = ctx.createGain();
      g.connect(p === 'pad' || p === 'bass' ? this.l1Filter : this.out);
      this.parts[p] = g;
    }
    this.parts.tension.gain.value = 0;
  }

  get mode(): MusicMode {
    return this._mode;
  }

  /** Seconds per beat and per bar of the band playing (the tower's 100 BPM, or Pop's 96). */
  get beat(): number {
    return this.band?.theme.beat ?? BAR / 4;
  }

  get barLen(): number {
    return 4 * this.beat;
  }

  // ------------------------------------------------------------ run

  /** A run starts: its first biome's band comes in right away. */
  startRun(when: number, biomeId: number, checkpoint = 0): void {
    this.runs++;
    this._mode = 'run';
    this.biomeId = biome(biomeId).id;
    this.checkpoint = this.entryCheckpoint = checkpoint;
    this.settles = 0;
    this.runBars = 0;
    this.leadUntil = -1;
    this.leadOn = this.grooveOn = this.riserOn = false;
    this.riserStep = 0;
    this.target = undefined;
    this.inputs = { tension: 0, progress: 0, streak: 0 };
    this.resetParts(when);
    this.fadeAll(when, 0.12);
    this.begin(this.runBand(), when + 0.02, this.runs === 1 ? MUSIC_TUNING.introBars : 1);
    this.note('run start');
    this.prewarmRun();
    this.update(when);
  }

  /** Biome entry or a Deep Cosmos key change: the new band takes over at the next bar line. */
  setBiome(biomeId: number, checkpoint: number): void {
    this.biomeId = biome(biomeId).id;
    this.checkpoint = checkpoint;
    if (this._mode !== 'run') return;
    const b = this.runBand();
    if (b.id === (this.target ?? this.band)?.id) return;
    this.entryCheckpoint = checkpoint;
    this.target = b;
    this.prewarmRun();
  }

  /** A checkpoint is claimed: the riser resolves into its stinger, and the groove gets busier. */
  claimed(when: number, n: number): void {
    this.checkpoint = n;
    this.riserStep = 0;
    if (this.riserOn) {
      this.riserOn = false;
      cut(this.parts.riser, when, 0.05);
      this.note('L5 off (claimed)', when);
    }
    this.prewarmRun();
  }

  settled(): void {
    this.settles++;
  }

  /** Game over: a tape stop on everything sounding, and nothing more until a screen asks. */
  stopRun(when: number): void {
    this._mode = 'off';
    this.band = this.target = undefined;
    for (const v of this.voices) {
      if (v.start >= when) {
        this.release(v, when, 0.002);
        continue;
      }
      const r = v.src.playbackRate;
      r.cancelScheduledValues(when);
      r.setValueAtTime(1, when);
      r.linearRampToValueAtTime(0.2, when + 0.6);
      v.gain.gain.cancelScheduledValues(when);
      v.gain.gain.setTargetAtTime(0, when + 0.3, 0.12);
      this.stopAt(v, when + 1.3);
    }
    this.note('tape stop', when);
  }

  // ------------------------------------------------------------ screens

  /**
   * Title, profile and results music: the Meadow theme as a lullaby. Moving between screens keeps
   * the lullaby going on its own clock (a part one screen leaves out fades, one it adds joins on the
   * next bar line); it starts over only after a run or silence.
   */
  showScreen(screen: MusicScreen, at: number): void {
    if (this._mode === screen) return;
    const was = this._mode;
    this._mode = screen;
    this.target = undefined;
    const band = this.screenBand(screen);
    if (was !== 'off' && was !== 'run' && was !== 'popRun' && this.band === band) {
      this.rearrange(was, screen, at);
      this.note(screen, at);
      return;
    }
    this.resetParts(at);
    this.fadeAll(at, 0.3);
    this.begin(band, at, 0);
    if (LOUNGE_SCREENS.has(screen)) this.holdFor(band, at);
    this.note(screen, at);
  }

  /** From one screen's arrangement to another's without stopping the lullaby. */
  private rearrange(from: MusicScreen, to: MusicScreen, at: number): void {
    const keep = new Set<Part>(SCREEN_PARTS[to]);
    for (const v of this.voices) {
      if (keep.has(v.part) || v.end <= at) continue;
      this.fade(v, at, 0.25);
    }
    // the results loop plays the theme's first section over and over; the song carries on from
    // where the loop is, so the next bar is the one the loop would have played
    if (LOOP_SCREENS.has(from) && !LOOP_SCREENS.has(to)) {
      const n = this.bar % SECTION_BARS;
      this.t0 += (this.bar - n) * this.barLen;
      this.bar = n;
    }
  }

  /** The lullaby (menus, profile, the tower's results) or the lounge (Pop's hub and results), baked first. */
  private screenBand(screen: MusicScreen): Band {
    if (LOUNGE_SCREENS.has(screen)) {
      const b = (this.lounge ??= { id: 'lounge', theme: new Theme(LOUNGE, BIOMES[0].key, 1) });
      this.warm('lounge', () => b.theme.notes());
      return b;
    }
    const b = (this.lullaby ??= { id: 'lullaby', theme: new Theme(LULLABY, BIOMES[0].key, 1) });
    this.warm('lullaby', () => b.theme.notes());
    return b;
  }

  /** Bakes a screen's music ahead of time (Pop warms its results loop during the run). */
  warmScreen(screen: MusicScreen): void {
    this.screenBand(screen);
  }

  // ------------------------------------------------------------ Blockling Pop

  /** A Pop run starts (or resumes): the biome's family comes in with its bed right away. */
  startPop(when: number, biomeId: number, o: { cp?: number; fill?: number; puzzle?: boolean } = {}): void {
    this.runs++;
    this._mode = 'popRun';
    this.biomeId = biome(biomeId).id;
    this.checkpoint = this.entryCheckpoint = Math.max(0, o.cp ?? 0);
    this.runBars = 0;
    this.target = undefined;
    this.leadOn = this.grooveOn = this.riserOn = false;
    const fill = clamp(o.fill ?? 0, 0, 1);
    this.pop = newPop(!!o.puzzle, fill);
    // a resumed run with pieces on the board has popped before, so its groove plays from the start
    if (fill > 0) this.pop.pops = 1;
    this.pop.tension = !this.pop.puzzle && fill >= MUSIC_TUNING.pop.tensionAt;
    this.resetParts(when);
    open(this.parts.tension, when);
    this.fadeAll(when, 0.12);
    this.begin(this.popBand(), when + 0.02, 0);
    this.holdFor(this.band!, when + 0.02);
    // the band a run starts on is kept, so the next run (most start in the Meadow) finds it ready
    this.popStart = this.band;
    this.note('pop start', when);
    this.update(when);
    // after the first update, so the next area's band is composed on the next one
    this.prewarmPop();
  }

  /** The board changed: how full it is (0 to 1) and the combo. Layers follow on the next bar line. */
  popInput(p: { fill?: number; combo?: number }): void {
    const P = this.pop, T = MUSIC_TUNING.pop;
    if (p.combo !== undefined) P.combo = Math.max(0, p.combo);
    if (p.fill === undefined) return;
    const fill = clamp(p.fill, 0, 1);
    const rested = this.runBars - P.breatherAt >= T.breatherGapBars;
    if (!P.puzzle && rested && P.fill >= T.breatherBelow && fill < T.breatherBelow && P.pops > 0) P.breatherNext = true;
    if (fill >= T.tensionAt) P.tension = !P.puzzle;
    else if (fill < T.tensionExit) P.tension = false;
    P.fill = fill;
  }

  /** Lines popped: the first one brings the groove in. */
  popped(): void {
    this.pop.pops++;
  }

  /**
   * An All Clear: from the next beat, a 2-bar fanfare, then the breather. The bar grid moves so the
   * fanfare's downbeat lands on that beat; anything queued after it is dropped.
   */
  allClear(when: number): number {
    if (this._mode !== 'popRun' || !this.band || !this.reactive) return when;
    const beat = this.beat;
    const at = this.t0 + Math.ceil((when + 0.04 - this.t0) / beat) * beat;
    this.fadeAll(at, 0.12);
    this.t0 = at - this.bar * this.barLen;
    this.pop.fanfare = MUSIC_TUNING.pop.fanfareBars;
    this.pop.breatherNext = false;
    this.note('fanfare', at);
    this.update(when);
    return at;
  }

  /** A Pop biome entry, or a Deep Cosmos key change: the new family takes over at the next bar line. */
  popBiome(biomeId: number, checkpoint: number): void {
    this.biomeId = biome(biomeId).id;
    this.checkpoint = checkpoint;
    if (this._mode !== 'popRun') return;
    const b = this.popBand();
    if (b.id !== (this.target ?? this.band)?.id) this.target = b;
    // the next stop's band too, once a claim would take the run there
    this.prewarmPop();
  }

  /**
   * A Pop run is over: the tower's tape stop, then two bars of "nice try" in the current family.
   * Returns when the results loop should start.
   */
  stopPop(when: number): number {
    const band = this.band;
    if (this._mode !== 'popRun' || !band || !this.reactive) {
      this.stop(when);
      return when + 1.2;
    }
    this.stopRun(when);
    const start = when + 0.9;
    for (const i of [0, 1] as const) {
      const at = start + i * band.theme.barLen;
      for (const e of popNiceTry(band.theme, i)) this.play(e, at, band.theme.style, band.theme.beat);
    }
    this.note('nice try', start);
    return start + 2 * band.theme.barLen;
  }

  /** The pad's chord sounding at `when`, as the band voices it, for Pop's keys stab and the pop's answer. */
  popHarmony(when: number): { chord: NoteRequest; degree: number; key: Key; style: MusicStyle } | null {
    const band = this._mode === 'popRun' ? this.band : undefined;
    if (!band) return null;
    const th = band.theme;
    const bar = Math.max(0, Math.floor((when - this.t0) / th.barLen + 1e-6));
    return { chord: { inst: th.style.pad, midis: th.padChord(bar), spread: 0.008, low: true }, degree: th.degreeAt(bar), key: th.key, style: th.style };
  }

  /** The next time at or after `when` on the band's grid of `beats` (0.25 for sixteenths); `when` with no band. */
  nextGrid(when: number, beats = 0.25): number {
    if (!this.band || this._mode === 'off') return when;
    const step = this.beat * beats;
    return this.t0 + Math.ceil((when - this.t0) / step - 1e-6) * step;
  }

  /** Pop's band for the current biome, key and Deep Cosmos rotation. */
  private popBand(): Band {
    return this.popBandAt(this.biomeId, this.checkpoint);
  }

  /** Pop's band for a biome at a checkpoint; the last few are kept, with their warm-up lists. */
  private popBandAt(biomeId: number, checkpoint: number): Band {
    const rot = biomeId === 10 ? cosmosRotation(checkpoint) : 0;
    const key = biomeKey(biomeId, checkpoint);
    const id = `pop${biomeId}:${rot}:${key.root}${key.mode[0]}`;
    for (const b of [this.band, this.target, this.popStart]) if (b?.id === id) return b;
    let b = this.popBands.get(id);
    if (!b) {
      const style = popStyleFor(biomeId, rot);
      b = { id, theme: new Theme(style, key, style.tune ?? biomeId) };
      this.popBands.set(id, b);
      if (this.popBands.size > 4) this.popBands.delete(this.popBands.keys().next().value!);
    }
    return b;
  }

  /**
   * The playing band, Pop's extra bars for it, the results loop, and the band of the next area. Pop's
   * areas can change at any checkpoint (every one under rules 4), so the next area's band is always
   * the one after this; it is composed on the next update, not inside the event, since a new band's
   * notes take 10 to 20 ms to gather and a checkpoint is the busiest frame of a run.
   */
  private prewarmPop(): void {
    const band = this.target ?? this.band;
    if (!band) return;
    this.warm(band.id, popList(band), true);
    this.warmScreen('popResults');
    const n = this.checkpoint + 1;
    const id = biome(this.biomeId).id;
    const next = Math.min(id + 1, 10);
    this.nextWarm = () => {
      const nb = this.popBandAt(next, n);
      if (nb.id === (this.target ?? this.band)?.id) return;
      // gathered here, so taking it over costs nothing; and asked for again even if it played before, as
      // the note cache holds two bands and rules 4 passes a new one at every checkpoint
      popList(nb)();
      this.warm(nb.id, popList(nb), true);
    };
  }

  /** One bar of Pop: the layers are decided on the bar line from the board, then their notes gathered. */
  private popBar(band: Band, at: number): NoteEvent[] {
    const T = MUSIC_TUNING, PT = T.pop, P = this.pop, th = band.theme, n = this.bar, r = this.reactive;
    const L = P.layers;
    const set = (k: keyof PopState['layers'], on: boolean, what: string) => {
      if (L[k] !== on) this.note(`${what} ${on ? 'on' : 'off'}`, at);
      L[k] = on;
    };
    this.runBars++;
    if (P.fanfare > 0) {
      const i = (PT.fanfareBars - P.fanfare) as 0 | 1;
      P.fanfare--;
      if (P.fanfare === 0) P.breatherNext = true;
      for (const k of ['groove', 'lead', 'tension', 'breather'] as const) set(k, false, k);
      set('sparkle', true, 'sparkle');
      return popFanfare(th, i);
    }
    if (P.breatherNext && r && !P.puzzle) {
      P.breather = PT.breatherBars;
      P.breatherNext = false;
      P.breatherAt = this.runBars;
    }
    if (P.breather > 0) {
      P.breather--;
      for (const k of ['groove', 'lead', 'sparkle', 'tension'] as const) set(k, false, k);
      set('breather', true, 'breather');
      return popBreather(th, n);
    }
    set('breather', false, 'breather');
    const breakdown = r && !P.puzzle && (this.runBars - 1) % T.breakdownEvery >= T.breakdownEvery - T.breakdownBars;
    const tension = r && P.tension;
    if (r && P.combo >= PT.leadCombo) P.leadUntil = this.runBars + PT.leadHoldBars - 1;
    const groove = (!r || P.pops > 0) && !breakdown && !tension;
    const lead = !P.puzzle && !breakdown && !tension && (!r || this.runBars <= P.leadUntil);
    const sparkle = r && !P.puzzle && !breakdown && !tension && P.combo >= PT.sparkleCombo;
    set('tension', tension, 'tension');
    set('groove', groove, breakdown ? 'groove (breakdown)' : 'groove');
    set('lead', lead, 'lead');
    set('sparkle', sparkle, 'sparkle');
    const all = th.bar(n, sparkle ? 2 : 1);
    const out = tension
      ? all.filter((e) => e.part === 'pad' && e.inst === th.style.pad && e.beat === 0).concat(popTension(th, n))
      : all.filter((e) => e.part === 'pad' || e.part === 'bass' || ((e.part === 'support' || e.part === 'drums') && groove) || (e.part === 'lead' && lead));
    if (sparkle) out.push(...popSparkle(th, n));
    return out;
  }

  /** Silence (fades out over about a second). */
  stop(when: number): void {
    this._mode = 'off';
    this.band = this.target = undefined;
    this.fadeAll(when, 0.2);
  }

  // ------------------------------------------------------------ the clock

  /** Call often (every tick): follows tension live and schedules bars just ahead of `when`. */
  update(when: number, inputs?: MusicInputs): void {
    if (inputs) this.inputs = inputs;
    if (this.nextWarm) {
      const f = this.nextWarm;
      this.nextWarm = null;
      if (this._mode === 'popRun') f();
    }
    if (this._mode === 'run' && this.reactive) this.follow(when);
    if (this._mode === 'off' || !this.band) return;
    if (this.hold) {
      if (this.bar === 0 && when < this.hold.until && !this.bank.hasNotes(this.hold.items)) {
        this.t0 = Math.max(this.t0, when + MUSIC_TUNING.lookahead + 0.001);
        return;
      }
      this.hold = null;
    }
    // after a stall (suspended context, starved timer) skip ahead instead of rushing to catch up
    const bar = this.barLen;
    const behind = when - (this.t0 + this.bar * bar);
    if (behind > bar) {
      const skip = Math.ceil(behind / bar);
      this.bar += skip;
      if (this._mode === 'run' || this._mode === 'popRun') this.runBars += skip;
    }
    let guard = 0;
    while (this.band && this.t0 + this.bar * this.barLen < when + MUSIC_TUNING.lookahead && guard++ < 8) this.scheduleBar(this.t0 + this.bar * this.barLen);
  }

  /** Bakes a biome's band before its first bar (the first biome, at startup). */
  warmBiome(biomeId: number, checkpoint = 0): void {
    this.warmBand(this.bandFor(biome(biomeId).id, checkpoint));
  }

  /** Bakes the bars a run will need soon. Resolves when everything asked for so far is in. */
  async prewarm(): Promise<void> {
    if (this.nextWarm && this._mode === 'popRun') {
      const f = this.nextWarm;
      this.nextWarm = null;
      f();
    }
    while (this.warming.length) await Promise.all(this.warming.splice(0));
  }

  state() {
    return {
      mode: this._mode,
      band: this.band?.id ?? null,
      bar: this.bar,
      runBars: this.runBars,
      layers: (this._mode === 'popRun' ? { ...this.pop.layers } : { groove: this.grooveOn, lead: this.leadOn, riser: this.riserOn }) as Record<string, boolean>,
      pop: { fill: this.pop.fill, combo: this.pop.combo, pops: this.pop.pops, puzzle: this.pop.puzzle },
      bpm: Math.round(60 / this.beat),
      density: this.density,
      voices: this.voices.length,
      missed: [...this.missed],
      ...this.stats,
    };
  }

  // ------------------------------------------------------------ internals

  private get density(): 0 | 1 | 2 {
    return clamp(this.checkpoint - this.entryCheckpoint, 0, 2) as 0 | 1 | 2;
  }

  /** The live layers: L4's level, L3's exit when the tower gets scary, L1's filter. */
  private follow(when: number): void {
    const T = MUSIC_TUNING;
    const t = this.inputs.tension;
    const level = clamp((t - T.tensionFrom) / (T.tensionFull - T.tensionFrom), 0, 1);
    if (Math.abs(level - this.live.tension) > 0.01) {
      this.live.tension = level;
      this.parts.tension.gain.setTargetAtTime(level, when, 0.3);
    }
    const lp = t > 0.5 ? lerp(20000, 1800, Math.sqrt(clamp((t - 0.5) / 0.5, 0, 1))) : 20000;
    if (Math.abs(lp - this.live.filter) > 50) {
      this.live.filter = lp;
      this.l1Filter.frequency.setTargetAtTime(lp, when, 0.4);
    }
    if (this.leadOn && t >= T.tensionTakeover) {
      this.leadOn = false;
      this.leadUntil = -1;
      cut(this.parts.lead, when, 0.15);
      this.note('L3 off (tension)', when);
    }
  }

  private begin(band: Band, at: number, intro: number): void {
    this.band = band;
    this.t0 = at;
    this.bar = 0;
    this.intro = intro;
    this.hold = null;
  }

  /**
   * Pop's first downbeat waits (a second at most) for its bed to bake: the view opens Pop and starts
   * the run in the same frame, so a band that has never played may not be ready yet.
   */
  private holdFor(band: Band, at: number): void {
    const low = band.theme.style.low;
    const items = band.theme.bar(0, 1).filter((e) => e.part === 'pad' || e.part === 'bass').map((e) => ({ inst: e.inst, midis: e.midis, spread: e.spread, low }));
    this.hold = this.bank.hasNotes(items) ? null : { until: at + 1, items };
  }

  private scheduleBar(at: number): void {
    const T = MUSIC_TUNING;
    const live = this._mode === 'run' || this._mode === 'popRun';
    if (live && this.target && this.target !== this.band) {
      // bar-quantized crossfade: what still rings from the old band fades as the new one starts
      this.fadeAll(at, 0.4);
      this.begin(this.target, at, this._mode === 'run' ? T.introBars : 0);
      this.note(`band ${this.target.id}`, at);
      this.target = undefined;
    }
    const band = this.band!;
    const style = band.theme.style;
    let events: NoteEvent[];
    if (this._mode === 'run') events = this.runBar(band, at);
    else if (this._mode === 'popRun') events = this.popBar(band, at);
    else {
      const parts = new Set<Part>(SCREEN_PARTS[this._mode as MusicScreen]);
      const n = LOOP_SCREENS.has(this._mode) ? this.bar % SECTION_BARS : this.bar;
      events = band.theme.bar(n, 0).filter((e) => parts.has(e.part));
    }
    events.sort((a, b) => a.beat - b.beat);
    for (const e of events) this.play(e, at, style, band.theme.beat);
    this.bar++;
    this.stats.bars++;
  }

  /** One bar of the run: decides the layers on the bar line, then gathers their notes. */
  private runBar(band: Band, at: number): NoteEvent[] {
    const T = MUSIC_TUNING;
    const { tension, progress, streak } = this.inputs;
    const intro = this.bar < this.intro;
    const breakdown = this.runBars % T.breakdownEvery >= T.breakdownEvery - T.breakdownBars;
    const rest = intro || breakdown;
    const r = this.reactive;

    const groove = (!r || this.settles >= T.grooveAfterSettles) && !rest;
    if (groove !== this.grooveOn) this.note(groove ? 'L2 on' : breakdown ? 'L2 off (breakdown)' : 'L2 off', at);
    this.grooveOn = groove;

    if ((streak >= T.leadStreak || progress >= T.leadProgress) && tension < T.tensionTakeover) this.leadUntil = this.runBars + T.leadHoldBars - 1;
    const lead = !rest && (!r || (tension < T.tensionTakeover && this.runBars <= this.leadUntil));
    if (lead !== this.leadOn) {
      this.note(lead ? 'L3 on' : 'L3 off', at);
      if (lead) open(this.parts.lead, at);
    }
    this.leadOn = lead;

    const riser = r && progress >= T.riserAt;
    if (riser !== this.riserOn) {
      this.note(riser ? 'L5 on' : 'L5 off', at);
      if (riser) open(this.parts.riser, at);
    }
    this.riserOn = riser;

    const n = this.bar;
    const out = band.theme.bar(n, r ? this.density : 1).filter((e) =>
      e.part === 'pad' || e.part === 'bass' || ((e.part === 'support' || e.part === 'drums') && groove) || (e.part === 'lead' && lead));
    if (r && tension >= T.tensionFrom - 0.05) out.push(...band.theme.tension(n, tension));
    if (riser) out.push(...band.theme.riser(this.riserStep++, this.nextStyle()));
    this.runBars++;
    return out;
  }

  private play(e: NoteEvent, barAt: number, style: MusicStyle, beat: number): void {
    const T = MUSIC_TUNING;
    const start = barAt + e.beat * beat;
    this.stats.notes++;
    const buf = this.bank.peek({ inst: e.inst, midis: e.midis, spread: e.spread, low: style.low });
    if (!buf) {
      this.stats.misses++;
      this.missed.push(`${e.inst}:${e.midis.join(',')}`);
      if (this.missed.length > 8) this.missed.shift();
      return;
    }
    const priority = PRIORITY[e.part];
    this.voices = this.voices.filter((v) => v.end > start);
    if (this.voices.length >= T.voices) {
      let victim: Voice | undefined;
      for (const v of this.voices) {
        if (v.priority < priority) continue;
        if (!victim || v.priority > victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (!victim) {
        this.stats.dropped++;
        return;
      }
      this.release(victim, start, 0.015);
      this.voices = this.voices.filter((v) => v !== victim);
      this.stats.stolen++;
    }
    const level = e.vel * dbToGain(partDb(e.part, style));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    gain.gain.setValueAtTime(level, start);
    const off = start + e.dur * beat;
    const rel = RELEASE[e.part];
    let end = start + buf.duration;
    if (rel > 0 && off < end) {
      gain.gain.setTargetAtTime(0, off, rel);
      end = Math.min(end, off + rel * 6);
    }
    src.connect(gain).connect(this.parts[e.part]);
    src.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    src.start(start);
    src.stop(end + 0.005);
    this.voices.push({ src, gain, part: e.part, priority, start, end });
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.length);
  }

  private release(v: Voice, at: number, tc: number): void {
    const t = Math.max(at, v.start);
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, tc);
    } catch {
      /* already stopped */
    }
    this.stopAt(v, t + tc * 6);
  }

  private stopAt(v: Voice, t: number): void {
    if (t >= v.end) return;
    try {
      v.src.stop(t);
    } catch {
      /* already stopped */
    }
    v.end = t;
  }

  /** Fades what is sounding at `at`; a note queued to start later never starts. */
  private fadeAll(at: number, tc: number): void {
    for (const v of this.voices) if (v.end > at) this.fade(v, at, tc);
  }

  private fade(v: Voice, at: number, tc: number): void {
    if (v.start >= at) this.stopAt(v, v.start);
    else this.release(v, at, tc);
  }

  private resetParts(at: number): void {
    for (const p of ['lead', 'riser'] as const) open(this.parts[p], at);
    this.parts.tension.gain.cancelScheduledValues(at);
    this.parts.tension.gain.setTargetAtTime(0, at, 0.1);
    this.l1Filter.frequency.cancelScheduledValues(at);
    this.l1Filter.frequency.setTargetAtTime(20000, at, 0.1);
    this.live = { tension: 0, filter: 20000 };
  }

  /** The band for the current biome, key and Deep Cosmos rotation. */
  private runBand(): Band {
    return this.bandFor(this.biomeId, this.checkpoint);
  }

  private bandFor(biomeId: number, checkpoint: number): Band {
    const rot = biomeId === 10 ? cosmosRotation(checkpoint) : 0;
    const key = biomeKey(biomeId, checkpoint);
    const id = `${biomeId}:${rot}:${key.root}${key.mode[0]}`;
    for (const b of [this.band, this.target]) if (b?.id === id) return b;
    const style = styleFor(biomeId, rot);
    return { id, theme: new Theme(style, key, style.tune ?? biomeId) };
  }

  /** Where the next claim leads: the next biome at a boundary, the next rotation in Deep Cosmos, else here. */
  private nextStop(): { biome: number; checkpoint: number } {
    const n = this.checkpoint + 1;
    const b = biome(this.biomeId);
    if (b.id < 10 && n >= b.lastCheckpoint) return { biome: b.id + 1, checkpoint: n };
    return { biome: b.id, checkpoint: n };
  }

  /** The lead the riser previews. */
  private nextStyle(): MusicStyle {
    const s = this.nextStop();
    return styleFor(s.biome, s.biome === 10 ? cosmosRotation(s.checkpoint) : 0);
  }

  /** The current band, the riser this climb plays, and the next stop's band when the climb leads somewhere new. */
  private prewarmRun(): void {
    const band = this.target ?? this.band;
    if (!band) return;
    const next = this.nextStop();
    const nb = this.bandFor(next.biome, next.checkpoint);
    // The playing band and its riser are asked for every time, even once baked: that marks their notes as
    // recently used, so the next band baking can't evict the ones not played yet (a busier groove's percussion).
    this.warmBand(band, true);
    this.warm(`${band.id}>${nb.theme.style.lead}`, () => risers(band.theme, nb.theme.style), true);
    if (nb.id !== band.id) this.warmBand(nb);
  }

  private warmBand(b: Band, again = false): void {
    this.warm(b.id, () => [...b.theme.notes(), ...risers(b.theme, b.theme.style)], again);
  }

  private warm(id: string, items: () => NoteRequest[], again = false): void {
    if (this.warmed.has(id) && !again) return;
    this.warmed.delete(id);
    this.warmed.add(id);
    // forget old bands, so one evicted from the note cache gets baked again on its return
    if (this.warmed.size > 6) this.warmed.delete(this.warmed.values().next().value!);
    this.warming.push(this.bank.warmNotes(items()));
  }

  private note(what: string, t = this.t0): void {
    this.log.push({ t: Math.round(t * 100) / 100, what });
    if (this.log.length > 200) this.log.shift();
  }
}

/** A Pop band's notes: its bars and Pop's extra layers, gathered once. */
function popList(b: Band): () => NoteRequest[] {
  return () => (b.list ??= [...b.theme.notes(), ...popNotes(b.theme)]);
}

function risers(theme: Theme, next: MusicStyle): NoteRequest[] {
  const out: NoteRequest[] = [];
  for (let i = 0; i < 4; i++) for (const e of theme.riser(i, next)) out.push({ inst: e.inst, midis: e.midis });
  return out;
}

/** Tension sits under the bass, the riser under the lead, and Pop's sparkle beside the support. */
function partDb(part: Part, s: MusicStyle): number {
  if (part === 'tension') return s.mix.bass - 3;
  if (part === 'riser') return s.mix.lead - 4;
  if (part === 'sparkle') return s.mix.support + 2;
  return s.mix[part];
}

function newPop(puzzle: boolean, fill: number): PopState {
  return {
    puzzle, fill, combo: 0, pops: 0, tension: false, breather: 0, breatherNext: false, breatherAt: -1e9, fanfare: 0, leadUntil: -1,
    layers: { groove: false, lead: false, sparkle: false, tension: false, breather: false },
  };
}

function cut(g: GainNode, when: number, tc: number): void {
  g.gain.cancelScheduledValues(when);
  g.gain.setTargetAtTime(0, when, tc);
}

function open(g: GainNode, when: number): void {
  g.gain.cancelScheduledValues(when);
  g.gain.setTargetAtTime(1, when, 0.01);
}
