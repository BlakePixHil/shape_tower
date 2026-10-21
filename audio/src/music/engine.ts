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

import type { NoteRequest, SoundBank } from '../bank';
import { BIOMES, biome, biomeKey, cosmosRotation } from '../biomes';
import { clamp, dbToGain, lerp } from '../synth/dsp';
import { BAR, BEAT, SECTION_BARS, Theme, type NoteEvent, type Part } from './composer';
import { LULLABY, styleFor, type MusicStyle } from './styles';

export type MusicScreen = 'menu' | 'profile' | 'results';
export type MusicMode = 'off' | 'run' | MusicScreen;

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
};

const PARTS: Part[] = ['pad', 'bass', 'support', 'drums', 'lead', 'tension', 'riser'];

/** Pad, bass and lead carry the song; drums and support thin out first. */
const PRIORITY: Record<Part, number> = { pad: 1, bass: 1, lead: 1, tension: 2, riser: 2, support: 3, drums: 3 };

/** Release time constant after a note's written length (s). Drums and bells ring out. */
const RELEASE: Record<Part, number> = { pad: 0.45, bass: 0.06, lead: 0.09, support: 0.12, drums: 0, tension: 0.04, riser: 0.06 };

const SCREEN_PARTS: Record<MusicScreen, Part[]> = {
  menu: ['pad', 'bass', 'support', 'lead'],
  // the same theme, lighter
  profile: ['pad', 'support', 'lead'],
  // a warm 8-bar loop under the XP tally, in the level-up fanfare's key
  results: ['pad', 'bass', 'support'],
};

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
  private parts: Record<Part, GainNode>;
  private l1Filter: BiquadFilterNode;
  private voices: Voice[] = [];
  private _mode: MusicMode = 'off';
  private band?: Band;
  /** the run band that takes over at the next bar line */
  private target?: Band;
  private lullaby?: Band;
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

  /** Title, profile and results music: the Meadow theme as a lullaby. */
  showScreen(screen: MusicScreen, at: number): void {
    if (this._mode === screen) return;
    this._mode = screen;
    this.target = undefined;
    const band = (this.lullaby ??= { id: 'lullaby', theme: new Theme(LULLABY, BIOMES[0].key, 1) });
    this.warm('lullaby', () => band.theme.notes());
    this.resetParts(at);
    this.fadeAll(at, 0.3);
    this.begin(band, at, 0);
    this.note(screen, at);
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
    if (this._mode === 'run') this.follow(when);
    if (this._mode === 'off' || !this.band) return;
    // after a stall (suspended context, starved timer) skip ahead instead of rushing to catch up
    const behind = when - (this.t0 + this.bar * BAR);
    if (behind > BAR) {
      const skip = Math.ceil(behind / BAR);
      this.bar += skip;
      if (this._mode === 'run') this.runBars += skip;
    }
    let guard = 0;
    while (this.band && this.t0 + this.bar * BAR < when + MUSIC_TUNING.lookahead && guard++ < 8) this.scheduleBar(this.t0 + this.bar * BAR);
  }

  /** Bakes a biome's band before its first bar (the first biome, at startup). */
  warmBiome(biomeId: number, checkpoint = 0): void {
    this.warmBand(this.bandFor(biome(biomeId).id, checkpoint));
  }

  /** Bakes the bars a run will need soon. Resolves when everything asked for so far is in. */
  async prewarm(): Promise<void> {
    while (this.warming.length) await Promise.all(this.warming.splice(0));
  }

  state() {
    return {
      mode: this._mode,
      band: this.band?.id ?? null,
      bar: this.bar,
      runBars: this.runBars,
      layers: { groove: this.grooveOn, lead: this.leadOn, riser: this.riserOn },
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
  }

  private scheduleBar(at: number): void {
    const T = MUSIC_TUNING;
    if (this._mode === 'run' && this.target && this.target !== this.band) {
      // bar-quantized crossfade: what still rings from the old band fades as the new one starts
      this.fadeAll(at, 0.4);
      this.begin(this.target, at, T.introBars);
      this.note(`band ${this.target.id}`, at);
      this.target = undefined;
    }
    const band = this.band!;
    const style = band.theme.style;
    let events: NoteEvent[];
    if (this._mode === 'run') events = this.runBar(band, at);
    else {
      const parts = new Set<Part>(SCREEN_PARTS[this._mode as MusicScreen]);
      const n = this._mode === 'results' ? this.bar % SECTION_BARS : this.bar;
      events = band.theme.bar(n, 0).filter((e) => parts.has(e.part));
    }
    events.sort((a, b) => a.beat - b.beat);
    for (const e of events) this.play(e, at, style);
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

    const groove = this.settles >= T.grooveAfterSettles && !rest;
    if (groove !== this.grooveOn) this.note(groove ? 'L2 on' : breakdown ? 'L2 off (breakdown)' : 'L2 off', at);
    this.grooveOn = groove;

    if ((streak >= T.leadStreak || progress >= T.leadProgress) && tension < T.tensionTakeover) this.leadUntil = this.runBars + T.leadHoldBars - 1;
    const lead = !rest && tension < T.tensionTakeover && this.runBars <= this.leadUntil;
    if (lead !== this.leadOn) {
      this.note(lead ? 'L3 on' : 'L3 off', at);
      if (lead) open(this.parts.lead, at);
    }
    this.leadOn = lead;

    const riser = progress >= T.riserAt;
    if (riser !== this.riserOn) {
      this.note(riser ? 'L5 on' : 'L5 off', at);
      if (riser) open(this.parts.riser, at);
    }
    this.riserOn = riser;

    const n = this.bar;
    const out = band.theme.bar(n, this.density).filter((e) =>
      e.part === 'pad' || e.part === 'bass' || ((e.part === 'support' || e.part === 'drums') && groove) || (e.part === 'lead' && lead));
    if (tension >= T.tensionFrom - 0.05) out.push(...band.theme.tension(n, tension));
    if (riser) out.push(...band.theme.riser(this.riserStep++, this.nextStyle()));
    this.runBars++;
    return out;
  }

  private play(e: NoteEvent, barAt: number, style: MusicStyle): void {
    const T = MUSIC_TUNING;
    const start = barAt + e.beat * BEAT;
    this.stats.notes++;
    const buf = this.bank.peek({ inst: e.inst, midis: e.midis, spread: e.spread });
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
    const off = start + e.dur * BEAT;
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

  private fadeAll(at: number, tc: number): void {
    for (const v of this.voices) if (v.end > at) this.release(v, at, tc);
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
    this.warmBand(band);
    this.warm(`${band.id}>${nb.theme.style.lead}`, () => risers(band.theme, nb.theme.style));
    if (nb.id !== band.id) this.warmBand(nb);
  }

  private warmBand(b: Band): void {
    this.warm(b.id, () => [...b.theme.notes(), ...risers(b.theme, b.theme.style)]);
  }

  private warm(id: string, items: () => NoteRequest[]): void {
    if (this.warmed.has(id)) return;
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

function risers(theme: Theme, next: MusicStyle): NoteRequest[] {
  const out: NoteRequest[] = [];
  for (let i = 0; i < 4; i++) for (const e of theme.riser(i, next)) out.push({ inst: e.inst, midis: e.midis });
  return out;
}

/** Tension sits under the bass and the riser under the lead. */
function partDb(part: Part, s: MusicStyle): number {
  if (part === 'tension') return s.mix.bass - 3;
  if (part === 'riser') return s.mix.lead - 4;
  return s.mix[part];
}

function cut(g: GainNode, when: number, tc: number): void {
  g.gain.cancelScheduledValues(when);
  g.gain.setTargetAtTime(0, when, tc);
}

function open(g: GainNode, when: number): void {
  g.gain.cancelScheduledValues(when);
  g.gain.setTargetAtTime(1, when, 0.01);
}
