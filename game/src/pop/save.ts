// Blockling Pop's saves and run records (Pop plan §3, §16). The run in progress is saved after every
// move as its record (seed plus moves) and replays on Continue, so closing the app never loses a run.
// Finished runs go to the game page's database for QA (collection `popruns`), with the one-tap
// answers and frame times, so Blake only ever plays; outside claude.ai nothing is sent.

import type { PopSim } from './sim/pop.ts';
import { type PopRecord, recordOf } from './sim/record.ts';
import { type DocRef, db, device } from '../view/records.ts';

const KEY = 'shape-tower-pop-run-v1';

export interface PopSave {
  rec: PopRecord;
  /** Active play time so far (ms). */
  playMs: number;
  /** When the run started (ms since 1970). */
  startedAt: number;
}

export function loadPopSave(): PopSave | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PopSave | null;
    return s && s.rec && typeof s.rec.moves === 'string' ? s : null;
  } catch { return null; }
}

export function writePopSave(sim: PopSim | null, playMs = 0, startedAt = Date.now()): void {
  try {
    if (!sim || sim.over) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ rec: recordOf(sim), playMs: Math.round(playMs), startedAt } satisfies PopSave));
  } catch { /* fine without it */ }
}

/** Frame times in 1 ms buckets (0 to 100, the last is 100+), like the tower's run records. */
export class PopFrames {
  private hist = new Array<number>(101).fill(0);
  private n = 0;
  private max = 0;
  add(ms: number): void {
    this.n++;
    this.hist[Math.min(100, Math.floor(ms))]++;
    if (ms > this.max) this.max = ms;
  }
  summary(): Record<string, unknown> {
    const pct = (q: number) => { let k = 0; const want = this.n * q; for (let i = 0; i < 101; i++) { k += this.hist[i]; if (k >= want) return i; } return 100; };
    const hist: Record<string, number> = {};
    this.hist.forEach((v, i) => { if (v) hist[i] = v; });
    return { count: this.n, max: Math.round(this.max * 10) / 10, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), hist };
  }
}

/** One finished Pop run for QA: its record (replayable), what it scored, how long it took, frames and answers. */
export class PopRunRecord {
  readonly id = `pop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private ref: Promise<DocRef | null> | null = null;
  private answers: Record<string, string | number> = {};
  private writing: Promise<unknown> = Promise.resolve();

  finish(sim: PopSim, o: { build: string; playMs: number; startedAt: number; frames: Record<string, unknown>; player: string; level: number; xp: number; newBest: boolean }): void {
    if (this.ref) return;
    const rec = {
      kind: 'pop', build: o.build, startedAt: new Date(o.startedAt).toISOString(), playSeconds: Math.round(o.playMs / 100) / 10,
      record: recordOf(sim), finalDigest: sim.digest(), cause: sim.cause, score: sim.score, lines: sim.lines, checkpoints: sim.cp,
      clears: sim.clears, bestCombo: sim.bestCombo, placements: sim.placements, trays: sim.trays, filledAtEnd: sim.filled,
      secondsPerPlacement: sim.placements ? Math.round((o.playMs / 1000 / sim.placements) * 100) / 100 : null,
      frames: o.frames, device: device(), player: o.player, level: o.level, xp: o.xp, newBest: o.newBest, answers: this.answers,
    };
    this.ref = db().then(d => (d ? d.collection('popruns').doc(this.id) : null));
    this.writing = this.ref.then(r => r?.set(rec)).catch(e => console.warn('pop record not saved', e));
  }

  answer(id: string, value: string | number): void {
    this.answers[id] = value;
    const answers = { ...this.answers };
    this.writing = this.writing.then(() => this.ref?.then(r => r?.update({ answers }))).catch(e => console.warn('answer not saved', e));
  }

  exit(how: 'again' | 'menu'): void {
    this.writing = this.writing.then(() => this.ref?.then(r => r?.update({ exit: how }))).catch(e => console.warn('exit not saved', e));
  }
}
