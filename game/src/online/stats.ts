// The anonymous play stats from the phone app (launch marketing plan, "What to measure"; what a batch
// holds is meta/stats.ts, the server's side online/src/stats.ts). Events wait on the device and go in
// small batches: when the game opens, when it goes to the background, and after a run (at most once a
// minute), so a session costs the free server plan a few writes. Off in Settings means nothing is sent
// and the server forgets this device. The game page and browsers never send any (online.ts statsUrl).

import { MAX_BATCH, MAX_QUEUE, statsId, type Platform, type RunKind, type StatEvent } from '../meta/stats.ts';

const KEY = 'shape-tower-stats-v1';
/** Back after this long in the background: a new session. */
const AWAY_MS = 30 * 60_000;
/** After a run, send at most this often (the rest goes with the next batch). */
const RUN_FLUSH_MS = 60_000;
const TIMEOUT_MS = 8000;

interface Saved {
  /** Events still to send, oldest first. */
  q: StatEvent[];
  /** This install has started counting (its first_open is queued or sent). */
  opened: boolean;
}

export interface StatsOptions {
  /** Where batches go; null when this copy of the game sends none. */
  url: string | null;
  /** The ladder's device key, once it's known (the stats id is made from it). */
  key(): string | null;
  platform: Platform;
  /** The build's commit. */
  build: string;
  /** The player's Settings switch. */
  on(): boolean;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (raw && Array.isArray(raw.q)) return { q: raw.q.slice(-MAX_QUEUE), opened: !!raw.opened };
  } catch { /* a fresh start */ }
  return { q: [], opened: false };
}

export class Stats {
  private readonly s = load();
  private sending: Promise<void> | null = null;
  private lastRunFlush = 0;
  private hiddenAt = 0;

  constructor(private readonly o: StatsOptions) {}

  /** Counting here at all: a copy of the game that sends stats, with the switch on. */
  get active(): boolean { return !!this.o.url && this.o.on(); }
  /** For QA's checks. */
  get queued(): readonly StatEvent[] { return this.s.q; }

  private save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage full: they live for this visit */ }
  }

  private push(e: StatEvent): void {
    if (!this.active) return;
    this.s.q.push(e);
    if (this.s.q.length > MAX_QUEUE) this.s.q.splice(0, this.s.q.length - MAX_QUEUE);
    this.save();
  }

  /**
   * The game has opened. A new install's first open is counted once; a player who had runs before the
   * stats existed isn't a new one, so they never join the retention numbers.
   */
  start(level: number, newPlayer: boolean): void {
    if (!this.active) return;
    const t = Date.now();
    if (!this.s.opened) {
      this.s.opened = true;
      if (newPlayer) this.push({ e: 'first_open', t });
    }
    this.push({ e: 'session', t, lv: level });
    void this.flush();
  }

  /** The app went to the background: send what's waiting while it still can. */
  hidden(): void {
    this.hiddenAt = Date.now();
    void this.flush(true);
  }

  /** Back in front: a new session after half an hour away. */
  visible(level: number): void {
    if (this.hiddenAt && Date.now() - this.hiddenAt >= AWAY_MS) this.push({ e: 'session', t: Date.now(), lv: level });
    this.hiddenAt = 0;
  }

  runEnd(m: RunKind, level: number, checkpoints: number, height: number): void {
    this.push({ e: 'run_end', t: Date.now(), m, lv: level, cp: checkpoints, h: Math.round(Math.max(0, height) * 10) / 10 });
    if (Date.now() - this.lastRunFlush >= RUN_FLUSH_MS) { this.lastRunFlush = Date.now(); void this.flush(); }
  }

  share(m: RunKind, ok: boolean): void { this.push({ e: 'share', t: Date.now(), m, ok: ok ? 1 : 0 }); }

  review(): void { this.push({ e: 'review', t: Date.now() }); }

  /** The Settings switch changed. Off: what's waiting is dropped and the server forgets this device. */
  setOn(on: boolean): void {
    if (on || !this.o.url) return;
    this.s.q = [];
    this.save();
    void this.post({ events: [], forget: true });
  }

  private async post(body: { events: StatEvent[]; forget?: boolean }, keepalive = false): Promise<'sent' | 'refused' | 'failed'> {
    const key = this.o.key();
    if (!this.o.url || !key) return 'failed';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(this.o.url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, keepalive, signal: ctl.signal,
        body: JSON.stringify({ id: await statsId(key), p: this.o.platform, b: this.o.build, ...body }),
      });
      return r.ok ? 'sent' : r.status >= 500 ? 'failed' : 'refused';
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends what's waiting, a batch at a time. Kept for next time if the server can't be reached. */
  flush(keepalive = false): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.active || !this.s.q.length) return Promise.resolve();
    this.sending = (async () => {
      while (this.s.q.length && this.active) {
        const batch = this.s.q.slice(0, MAX_BATCH);
        const r = await this.post({ events: batch }, keepalive);
        if (r === 'failed') break;
        // Sent, or refused for good: either way those events are done.
        this.s.q.splice(0, batch.length);
        this.save();
      }
    })().finally(() => { this.sending = null; });
    return this.sending;
  }
}
