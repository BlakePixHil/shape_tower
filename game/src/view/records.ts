// Run records for QA (qa-section.md §10.1): every run's replay, frame times, memory and audio
// latency, the silent benchmark once per build, and the one-tap answers. They go into the
// published page's own database (collections `runs` and `bench`), so Blake never reports anything.
// Outside claude.ai there is no database and nothing is sent.

import type { SecondWindMode, Sim } from '../sim/sim.ts';
import type { Tuning } from '../sim/tuning.ts';

interface DocRef { set(d: Record<string, unknown>): Promise<void>; update(d: Record<string, unknown>): Promise<void> }
interface Db { collection(path: string): { doc(id?: string): DocRef } }
type ClaudeWindow = { claude?: { use?(name: string): Promise<unknown> } };

const MAX_DOC = 240_000; // the store's limit is 256 KiB per document

let dbPromise: Promise<Db | null> | null = null;
function db(): Promise<Db | null> {
  if (!dbPromise) {
    const c = (window as unknown as ClaudeWindow).claude;
    dbPromise = c?.use ? c.use('db').then(d => (d as Db | null) ?? null, () => null) : Promise.resolve(null);
  }
  return dbPromise;
}

export function device(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: navigator.userAgent, dpr: window.devicePixelRatio, screen: [screen.width, screen.height],
    viewport: [window.innerWidth, window.innerHeight], cores: navigator.hardwareConcurrency ?? null, deviceMemory: nav.deviceMemory ?? null,
  };
}

export interface RunStart {
  seed: number; tuning: Partial<Tuning>; rookieOpening: boolean; secondWind: SecondWindMode;
  /** 'lab' or 'game', set by the shell. */
  app?: string;
  /** Gate 1: whether this run had juice (QA's protocol picks it). */
  juice?: boolean;
}

/** Collects one run. Frame times go into 1 ms buckets (0 to 100, the last is 100+). */
export class RunRecorder {
  readonly id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private hist = new Array<number>(101).fill(0);
  private frames = 0;
  private frameMax = 0;
  private memPeak: number | null = null;
  private memAt = 0;
  private placedAt60: number | null = null;
  private startedAt = new Date().toISOString();
  private t0 = performance.now();
  private digests: string[] = [];
  private ref: Promise<DocRef | null> | null = null;
  private answers: Record<string, string | number> = {};
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private start: RunStart, private build: string, private audio: () => AudioContext | null) {}

  frame(ms: number, sim: Sim): void {
    if (this.ref) return;
    this.frames++;
    this.hist[Math.min(100, Math.floor(ms))]++;
    if (ms > this.frameMax) this.frameMax = ms;
    const now = performance.now();
    if (now - this.memAt > 2000) {
      this.memAt = now;
      const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (m) this.memPeak = Math.max(this.memPeak ?? 0, m.usedJSHeapSize);
    }
    if (this.placedAt60 === null && sim.time >= 60) this.placedAt60 = sim.stats.placed;
  }

  /** Called after each sim step: a digest every 60 steps for replay checks. */
  step(sim: Sim): void {
    if (this.ref) return; // finished
    if (sim.stepIndex % 60 === 0) this.digests.push(sim.digest());
  }

  /** Writes the run once it is over. */
  finish(sim: Sim, extra: Record<string, unknown>): void {
    if (this.ref) return;
    const ctx = this.audio();
    const rec: Record<string, unknown> = {
      kind: 'run', build: this.build, engine: 'box2d', startedAt: this.startedAt,
      wallSeconds: Math.round((performance.now() - this.t0) / 100) / 10,
      seed: this.start.seed, tuning: this.start.tuning, tuningHash: hash(JSON.stringify(sim.tuning)), rookieOpening: this.start.rookieOpening,
      secondWind: this.start.secondWind, app: this.start.app ?? 'lab', juice: this.start.juice === false ? 'off' : 'on',
      steps: sim.stepIndex, simSeconds: Math.round(sim.time * 10) / 10, finalDigest: sim.digest(), digests: [...this.digests],
      inputs: sim.inputLog.map(i => ({ ...i })),
      cause: sim.cause, maxHeight: round(sim.stats.maxHeight - sim.foundations[0].top), checkpoints: sim.stats.checkpoints,
      score: Math.round(sim.score), stats: { ...sim.stats, grades: [...sim.stats.grades] },
      placedInFirstMinute: this.placedAt60 ?? sim.stats.placed,
      frames: { frameClock: 'raw', count: this.frames, max: round(this.frameMax), p50: this.pct(0.5), p95: this.pct(0.95), p99: this.pct(0.99), hist: compact(this.hist) },
      memoryPeakBytes: this.memPeak,
      audio: ctx ? { baseLatency: ctx.baseLatency ?? null, outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null, sampleRate: ctx.sampleRate, state: ctx.state } : null,
      device: device(), answers: this.answers, ...extra,
    };
    if (JSON.stringify(rec).length > MAX_DOC) { rec.inputs = []; rec.inputsDropped = sim.inputLog.length; }
    this.ref = db().then(d => (d ? d.collection('runs').doc(this.id) : null));
    this.writing = this.ref.then(r => r?.set(rec)).catch(e => console.warn('run record not saved', e));
  }

  /** How the player left the run-over card (QA's play-again rate). */
  exit(how: 'again' | 'menu'): void {
    this.writing = this.writing.then(() => this.ref?.then(r => r?.update({ exit: how }))).catch(e => console.warn('exit not saved', e));
  }

  answer(id: string, value: string | number): void {
    this.answers[id] = value;
    const answers = { ...this.answers };
    this.writing = this.writing.then(() => this.ref?.then(r => r?.update({ answers }))).catch(e => console.warn('answer not saved', e));
  }

  private pct(q: number): number {
    let n = 0;
    const want = this.frames * q;
    for (let i = 0; i < this.hist.length; i++) { n += this.hist[i]; if (n >= want) return i; }
    return 100;
  }
}

/** Runs the silent benchmark in a worker once per build on this device and stores the result. */
export function benchOnce(build: string, makeWorker: () => Worker): void {
  const key = 'shape-tower-bench';
  try { if (localStorage.getItem(key) === build) return; } catch { /* run it */ }
  void db().then(d => {
    if (!d) return; // nowhere to send it; try again where there is
    const w = makeWorker();
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: unknown; error?: string }>) => {
      w.terminate();
      const rec = { kind: 'bench', build, at: new Date().toISOString(), device: device(), ok: e.data.ok, result: e.data.result ?? null, error: e.data.error ?? null };
      d.collection('bench').doc().set(rec).then(() => { try { localStorage.setItem(key, build); } catch { /* fine */ } }, err => console.warn('bench not saved', err));
    };
    w.onerror = (e: ErrorEvent) => {
      w.terminate();
      void d.collection('bench').doc().set({ kind: 'bench', build, at: new Date().toISOString(), device: device(), ok: false, result: null, error: e.message || 'worker failed to start' }).catch(() => {});
    };
  });
}

function compact(hist: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  hist.forEach((n, i) => { if (n) out[i] = n; });
  return out;
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const round = (x: number) => Math.round(x * 100) / 100;
