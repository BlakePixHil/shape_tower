// The SoundBank bakes every procedural recipe into AudioBuffers, then hands out
// variations round-robin without repeating. Any name can later be replaced by
// recorded files (replace or loadFiles) without touching the director.
//
// Baking runs in the background through a Baker (a worker when the game
// provides one). Anything asked for before it is baked renders on the spot.
//
// Memory (audio section 4.8): sounds only some biomes use (entry moments,
// ambience sweeteners, per-material impacts) are kept only for the current
// biome and its neighbours, dark sounds and ambience beds bake at half rate,
// and notes and chords live in a small least-recently-used cache.

import { BIOMES, biome } from './biomes';
import { ThreadBaker, type Baker } from './bake/baker';
import { jobKey, runJob, type BakeJob } from './bake/jobs';
import { mulberry32, type Rng } from './synth/dsp';
import { instrumentRate, type InstrumentId } from './synth/instruments';
import { SOUNDS } from './synth/recipes';

/** Materials heard everywhere: the ground, and stone (foundation slabs and Solid Rows in the sim). */
const ALWAYS_MATERIALS = new Set(['ground', 'stone']);

/** Biome ids that use a sound, or null for sounds every biome needs. */
export function biomeScope(name: string): number[] | null {
  const [kind, a] = name.split('.');
  if (kind === 'entry') return [Number(a)];
  if (kind === 'amb') return BIOMES.filter((b) => (b.sweeteners as string[]).includes(a)).map((b) => b.id);
  if (kind === 'impact' && !ALWAYS_MATERIALS.has(a)) return BIOMES.filter((b) => b.material === a).map((b) => b.id);
  return null;
}

/** Sounds only one mode plays (Blockling Pop's `pop.*`): never baked with the tower's, loaded by prepareMode. */
export function modeScope(name: string): 'pop' | null {
  return name.startsWith('pop.') ? 'pop' : null;
}

/** Tower sounds Pop never plays: let go while Pop is open, so Pop's own fit in the same budget, and baked again after. */
const TOWER_ONLY = new Set([
  'creak', 'groan', 'teeter', 'heartbeat', 'scrape.rough', 'scrape.smooth', 'scrape.squeak', 'collapse.crack', 'collapse.rumble',
  'drumroll', 'hold.tick', 'hold.womp', 'gust.warn', 'gust.push', 'wind.loop', 'tidal.loop', 'dust.swirl', 'radar',
  'fallwhistle', 'plonk', 'stonewave', 'foundation',
]);

export function towerOnly(name: string): boolean {
  return TOWER_ONLY.has(name) || name.startsWith('amb.');
}

/** The biomes whose sounds stay loaded while playing in `id`: the one below (older tower pieces), this one and the next. */
export function biomeWindow(id: number): number[] {
  const b = biome(id).id;
  return [b - 1, b, b + 1].filter((x) => x >= 1 && x <= BIOMES.length);
}

/** Notes and chords re-render quickly in the background, so only recent ones stay in memory: the landing
 * ladder plus the band for two biomes (audio section 4.8). */
export const NOTE_BUDGET = 20e6;
/**
 * Blockling Pop: two bands with the board's notes and glissandos, all at half rate (Pop plan, Music and
 * sound). Pop holds 7 MB fewer effects than the tower, so a run still fits the 60 MB audio budget.
 */
export const POP_NOTE_BUDGET = 32e6;

/** Baked first, so a run can start before the whole bank is done. */
const FIRST = [
  'move', 'rotate.cw', 'rotate.ccw', 'rotate.blocked', 'spawn', 'drop', 'harddrop', 'settle', 'lockon',
  'impact.wood.1', 'impact.wood.2', 'impact.wood.3', 'impact.wood.4',
  'impact.ground.1', 'impact.ground.2', 'impact.ground.3', 'impact.ground.4',
  'impact.stone.1', 'impact.stone.2', 'impact.stone.3', 'impact.stone.4',
  'heartbeat', 'creak', 'groan', 'ui.tap', 'ui.tap2', 'entry.1',
];

/** A note (one midi) or a chord to bake ahead of time. */
export interface NoteRequest {
  inst: InstrumentId;
  midis: number[];
  spread?: number;
  /** bake at half rate even if the instrument normally bakes at full rate (Blockling Pop) */
  low?: boolean;
}

export interface BuildOptions {
  startBiome?: number;
  /** called once the FIRST sounds are in, so play can begin */
  onCore?: () => void;
  onProgress?: (done: number, total: number) => void;
}

export class SoundBank {
  private buffers = new Map<string, AudioBuffer[]>();
  private lastPick = new Map<string, number>();
  /** rendered notes and chords, least recently used first */
  private notes = new Map<string, AudioBuffer>();
  private noteBytes = 0;
  private beds = new Map<number, AudioBuffer>();
  readonly loops = new Set<string>();
  private rng: Rng;
  private built = false;
  private inFlight = new Set<string>();
  private prepared = 0;
  private preparing: Promise<void> = Promise.resolve();
  private mode: 'tower' | 'pop' = 'tower';
  /** how much the note cache may hold before the least recently used notes go */
  noteBudget = NOTE_BUDGET;

  constructor(private ctx: BaseAudioContext, private seed = 1, readonly baker: Baker = new ThreadBaker()) {
    this.rng = mulberry32(seed ^ 0x9e3779b9);
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /** Bakes every sound the first biome needs, core sounds first, plus its ambience beds. */
  async build(opts: BuildOptions = {}): Promise<void> {
    const start = biome(opts.startBiome ?? 1).id;
    this.prepared = start; // set first, so a biome entered while this runs takes over
    const keep = new Set(biomeWindow(start));
    const wanted = (n: string) => {
      if (modeScope(n) && modeScope(n) !== this.mode) return false;
      if (this.mode === 'pop' && towerOnly(n)) return false;
      const sc = biomeScope(n);
      return !sc || sc.some((b) => keep.has(b));
    };
    const first = FIRST.filter((n) => SOUNDS[n] && wanted(n));
    const rest = Object.keys(SOUNDS).filter((n) => wanted(n) && !first.includes(n));
    const total = first.length + rest.length;
    let done = 0;
    const progress = () => opts.onProgress?.(done, total);
    for (const batch of chunks(first.map((n) => this.soundJob(n)), 4)) {
      await this.bakeInto(batch);
      done += batch.length;
      progress();
    }
    opts.onCore?.();
    const later: BakeJob[] = [...rest.map((n) => this.soundJob(n)), ...this.bedJobs(start)];
    for (const batch of chunks(later, 4)) {
      await this.bakeInto(batch);
      done += batch.filter((j) => j.kind === 'sound').length;
      progress();
    }
    this.built = true;
  }

  /**
   * Loads the biome-specific sounds and beds for `id` and its neighbours and
   * frees the rest. Call on biome entry; it bakes in the background, and the
   * promise resolves when that biome's sounds are in.
   */
  prepareBiome(id: number): Promise<void> {
    const target = biome(id).id;
    if (target !== this.prepared) {
      this.prepared = target;
      this.preparing = this.prepare(target);
    }
    return this.preparing;
  }

  private async prepare(target: number): Promise<void> {
    const keep = new Set(biomeWindow(target));
    const jobs: BakeJob[] = [];
    for (const name of Object.keys(SOUNDS)) {
      const sc = biomeScope(name);
      if (!sc) continue;
      if (sc.some((b) => keep.has(b)) && !(this.mode === 'pop' && towerOnly(name))) {
        if (!this.buffers.has(name)) jobs.push(this.soundJob(name));
      } else this.evict(name);
    }
    const bedIds = new Set([target, target + 1]);
    for (const k of [...this.beds.keys()]) if (!bedIds.has(k)) this.beds.delete(k);
    jobs.push(...this.bedJobs(target));
    for (const batch of chunks(jobs, 3)) {
      if (this.prepared !== target) return; // a newer biome took over
      await this.bakeInto(batch);
    }
  }

  /**
   * Loads one mode's own sounds and frees the other's: Blockling Pop's `pop.*` sounds bake when
   * Pop opens and go when the tower comes back, and Pop's note cache is a little bigger.
   */
  prepareMode(mode: 'tower' | 'pop'): Promise<void> {
    if (mode === this.mode) return this.modeReady;
    this.mode = mode;
    this.noteBudget = mode === 'pop' ? POP_NOTE_BUDGET : NOTE_BUDGET;
    const all = Object.keys(SOUNDS);
    const pop = all.filter((n) => modeScope(n));
    const keep = new Set(biomeWindow(this.prepared || 1));
    const tower = all.filter((n) => towerOnly(n) && (!biomeScope(n) || biomeScope(n)!.some((b) => keep.has(b))));
    const out = mode === 'pop' ? tower : pop;
    const back = mode === 'pop' ? pop : tower;
    out.forEach((n) => this.evict(n));
    this.trimNotes();
    this.modeReady = this.bakeInto(back.filter((n) => !this.buffers.has(n)).map((n) => this.soundJob(n)));
    return this.modeReady;
  }

  private modeReady: Promise<void> = Promise.resolve();

  /** Bakes a missing sound in the background. */
  warm(name: string): void {
    if (this.buffers.has(name) || !SOUNDS[name]) return;
    void this.bakeInto([this.soundJob(name)]);
  }

  /** Bakes notes and chords in the background so their first play costs nothing. */
  async warmNotes(items: NoteRequest[]): Promise<void> {
    const jobs: BakeJob[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const j = this.noteJob(it);
      const k = jobKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.notes.has(k)) this.touchNote(k);
      else jobs.push(j);
    }
    for (const batch of chunks(jobs, 4)) await this.bakeInto(batch);
  }

  /**
   * A baked note or chord, or null while it bakes in the background. The music
   * plays only what is ready, so it never renders on the spot.
   */
  peek(it: NoteRequest): AudioBuffer | null {
    const j = this.noteJob(it);
    const k = jobKey(j);
    const hit = this.notes.get(k);
    if (hit) {
      this.touchNote(k);
      return hit;
    }
    void this.bakeInto([j]);
    return null;
  }

  /** True when every note and chord in `items` is already baked. */
  hasNotes(items: NoteRequest[]): boolean {
    return items.every((it) => this.notes.has(jobKey(this.noteJob(it))));
  }

  evict(name: string): void {
    this.buffers.delete(name);
    this.lastPick.delete(name);
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  /** A variation of `name`, never the same one twice in a row. Renders on the spot if not baked yet. */
  get(name: string): AudioBuffer | undefined {
    let list = this.buffers.get(name);
    if (!list && SOUNDS[name]) {
      const j = this.soundJob(name);
      this.install(j, runJob(j));
      list = this.buffers.get(name);
    }
    if (!list || list.length === 0) return undefined;
    if (list.length === 1) return list[0];
    const last = this.lastPick.get(name) ?? -1;
    let i = Math.floor(this.rng() * (list.length - 1));
    if (i >= last) i++;
    this.lastPick.set(name, i);
    return list[i];
  }

  /** Replace a sound with recorded or otherwise produced buffers. */
  replace(name: string, buffers: AudioBuffer[], loop = false): void {
    this.buffers.set(name, buffers);
    if (loop) this.loops.add(name);
  }

  /** Fetch and decode files for a sound name (for when real assets arrive). */
  async loadFiles(name: string, urls: string[], loop = false): Promise<void> {
    const bufs = await Promise.all(urls.map(async (u) => this.ctx.decodeAudioData(await (await fetch(u)).arrayBuffer())));
    this.replace(name, bufs, loop);
  }

  note(inst: InstrumentId, midi: number, low = false): AudioBuffer {
    return this.noteOrChord(this.noteJob({ inst, midis: [midi], low }));
  }

  /** Several notes mixed into one buffer, so a chord costs one voice. `spread` staggers them (s). */
  chord(inst: InstrumentId, midis: number[], spread = 0, low = false): AudioBuffer {
    return this.noteOrChord(this.noteJob({ inst, midis, spread, low }));
  }

  bed(biomeId: number): AudioBuffer {
    const id = biome(biomeId).id;
    let b = this.beds.get(id);
    if (!b) {
      const j = this.bedJob(id);
      this.install(j, runJob(j));
      b = this.beds.get(id)!;
    }
    return b;
  }

  /** Approximate memory held by decoded audio, in bytes. */
  bytes(): number {
    let s = 0;
    const add = (b: AudioBuffer) => (s += b.length * b.numberOfChannels * 4);
    this.buffers.forEach((l) => l.forEach(add));
    this.notes.forEach(add);
    this.beds.forEach(add);
    return s;
  }

  names(): string[] {
    return [...this.buffers.keys()];
  }

  toBuffer(x: Float32Array, sampleRate = this.ctx.sampleRate): AudioBuffer {
    const b = this.ctx.createBuffer(1, Math.max(1, x.length), sampleRate);
    if (x.length) b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    return b;
  }

  // ------------------------------------------------------------ internals

  private noteJob(it: NoteRequest): BakeJob {
    // only a note that would otherwise bake at full rate is a separate low-rate buffer
    const low = !!it.low && instrumentRate(it.inst) === 1;
    const sr = Math.round(this.ctx.sampleRate * instrumentRate(it.inst, low));
    const flag = low ? { low: true } : {};
    return it.midis.length === 1
      ? { kind: 'note', inst: it.inst, midi: it.midis[0], sr, ...flag }
      : { kind: 'chord', inst: it.inst, midis: it.midis, spread: it.spread ?? 0, sr, ...flag };
  }

  /** Lets the least recently used notes go until the cache fits its budget. */
  private trimNotes(keep?: string): void {
    for (const [old, ob] of this.notes) {
      if (this.noteBytes <= this.noteBudget) break;
      if (old === keep) continue;
      this.notes.delete(old);
      this.noteBytes -= ob.length * 4;
    }
  }

  private soundJob(name: string): BakeJob {
    return { kind: 'sound', name, sr: Math.round(this.ctx.sampleRate * (SOUNDS[name]?.rate ?? 1)), seed: this.seed };
  }

  /** Beds are filtered noise below 3.5 kHz, so they bake at half rate. */
  private bedJob(id: number): BakeJob {
    return { kind: 'bed', biome: id, sr: Math.round(this.ctx.sampleRate / 2) };
  }

  /** The current biome's bed and the next one's, so entering a biome never waits. */
  private bedJobs(id: number): BakeJob[] {
    return [id, id + 1].filter((b) => b <= BIOMES.length && !this.beds.has(b)).map((b) => this.bedJob(b));
  }

  private noteOrChord(j: BakeJob): AudioBuffer {
    const k = jobKey(j);
    const hit = this.notes.get(k);
    if (hit) {
      this.touchNote(k);
      return hit;
    }
    this.install(j, runJob(j));
    return this.notes.get(k)!;
  }

  private touchNote(k: string): void {
    const b = this.notes.get(k);
    if (!b) return;
    this.notes.delete(k);
    this.notes.set(k, b);
  }

  private async bakeInto(jobs: BakeJob[]): Promise<void> {
    const todo = jobs.filter((j) => !this.inFlight.has(jobKey(j)) && !this.present(j));
    if (!todo.length) return;
    todo.forEach((j) => this.inFlight.add(jobKey(j)));
    try {
      const out = await this.baker.bake(todo);
      todo.forEach((j, i) => {
        // something may have rendered it on the spot meanwhile
        if (!this.present(j)) this.install(j, out[i]);
      });
    } finally {
      todo.forEach((j) => this.inFlight.delete(jobKey(j)));
    }
  }

  private present(j: BakeJob): boolean {
    if (j.kind === 'sound') return this.buffers.has(j.name);
    if (j.kind === 'bed') return this.beds.has(j.biome);
    return this.notes.has(jobKey(j));
  }

  private install(j: BakeJob, out: Float32Array[]): void {
    switch (j.kind) {
      case 'sound':
        if (!out.length) return;
        this.buffers.set(j.name, out.map((x) => this.toBuffer(x, j.sr)));
        if (SOUNDS[j.name]?.loop) this.loops.add(j.name);
        return;
      case 'bed':
        this.beds.set(j.biome, this.toBuffer(out[0], j.sr));
        return;
      default: {
        const b = this.toBuffer(out[0], j.sr);
        const k = jobKey(j);
        this.notes.set(k, b);
        this.noteBytes += b.length * 4;
        this.trimNotes(k);
      }
    }
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
