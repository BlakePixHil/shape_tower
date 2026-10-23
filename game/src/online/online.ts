// The Daily ladder from the game's side (gameplay.md §12.3): who the player is online, which ladder this
// copy of the game talks to, and the scored try's progress on its way there. The app talks to our API
// (online/); the game page on claude.ai can't reach it, so it keeps its own ladder in the page's
// database (page.ts). Without either there's no ladder, only personal bests.

import { submitProblem, type LadderView, type Submission } from '../meta/ladder.ts';
import { DEFAULT_PORTRAIT } from '../meta/portraits.ts';
import type { LadderError, LadderReply, LadderRequest, Look, Me } from './protocol.ts';

export const API_URL = 'https://shape-tower.shape-tower.workers.dev/api/v1';
/** QA's checks point the game at a local server (online/scripts/dev-server.ts) with this key. */
const API_OVERRIDE = 'shape-tower-ladder-api';
const KEY = 'shape-tower-online-v1';
const TIMEOUT_MS = 8000;

/** One ladder: the API's (everyone with the app) or the page's own (whoever opens the game page). */
export interface LadderBackend {
  readonly kind: 'api' | 'page';
  call(req: LadderRequest): Promise<LadderReply>;
}

/** What this device keeps: its secret key, its portrait pick, names it reported, and a try still to send. */
export interface OnlineState {
  key: string;
  portrait: string;
  /** Ids this player reported: hidden for them at once (§12.3). */
  reported: string[];
  /** The scored try's latest progress, until the ladder has it. */
  pending: Submission | null;
  /** The last answer about who they are, so the card shows their name before the ladder answers. */
  me: Me | null;
}

const randomKey = (): string => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

export function loadOnline(): OnlineState {
  let raw: Partial<OnlineState> = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* a fresh one */ }
  return {
    key: typeof raw.key === 'string' && /^[0-9a-f]{64}$/.test(raw.key) ? raw.key : randomKey(),
    portrait: typeof raw.portrait === 'string' ? raw.portrait : DEFAULT_PORTRAIT,
    reported: Array.isArray(raw.reported) ? raw.reported.filter(x => typeof x === 'string').slice(-200) : [],
    pending: raw.pending && typeof raw.pending === 'object' ? raw.pending : null,
    me: raw.me && typeof raw.me === 'object' && typeof raw.me.id === 'string' ? raw.me : null,
  };
}

export function saveOnline(s: OnlineState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: it lives for this visit */ }
}

/** Our API over HTTPS: one POST per call. A dropped connection answers `offline`, an overloaded server `busy`. */
export class ApiBackend implements LadderBackend {
  readonly kind = 'api';
  constructor(private url: string) {}
  async call(req: LadderRequest): Promise<LadderReply> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: ctl.signal });
      const body = await r.json().catch(() => null) as LadderReply | null;
      return body ?? { error: r.status >= 500 ? 'busy' : 'offline' };
    } catch {
      return { error: 'offline' };
    } finally {
      clearTimeout(t);
    }
  }
}

/** Errors worth trying again later; anything else means the ladder said no for good. */
const RETRY: LadderError[] = ['offline', 'busy'];

export const errorOf = (r: LadderReply): LadderError | null => ('error' in r ? r.error : null);

/**
 * The player's side of the ladder: their name and look, today's view, and the scored try's progress
 * (sent at its first shape, each checkpoint and its end, and kept until the ladder has it).
 */
export class Ladder {
  readonly state = loadOnline();
  private sending: Promise<void> | null = null;

  constructor(readonly backend: LadderBackend | null) { saveOnline(this.state); }

  get available(): boolean { return !!this.backend; }
  get me(): Me | null { return this.state.me; }
  get named(): boolean { return !!this.state.me?.name; }
  look(avatar: Look['avatar']): Look { return { portrait: this.state.portrait, avatar }; }

  private async call(req: Omit<LadderRequest, 'key'>): Promise<LadderReply> {
    if (!this.backend) return { error: 'offline' };
    const r = await this.backend.call({ ...req, key: this.state.key });
    if ('me' in r) { this.state.me = r.me; this.state.portrait = r.me.portrait; saveOnline(this.state); }
    return r;
  }

  /** Who the ladder thinks they are (refreshes the cached answer). */
  refresh(): Promise<LadderReply> { return this.call({ op: 'me' }); }

  /** Picks or changes their name; their look goes with it. */
  setName(name: string, look: Look): Promise<LadderReply> { return this.call({ op: 'name', name, look }); }

  /** A new portrait or avatar. Without a name it's only kept on the device until they join. */
  async setLook(look: Look): Promise<LadderReply> {
    this.state.portrait = look.portrait;
    saveOnline(this.state);
    return this.named ? this.call({ op: 'look', look }) : { ok: true };
  }

  async view(day: string): Promise<LadderView | LadderError> {
    if (!this.backend) return 'offline';
    const r = await this.backend.call({ op: 'ladder', day, id: this.state.me?.id });
    return 'view' in r ? r.view : 'error' in r ? r.error : 'bad';
  }

  /** Reports a name: hidden for this player at once, and for everyone after a few different reports. */
  async report(id: string): Promise<void> {
    if (!this.state.reported.includes(id)) this.state.reported.push(id);
    saveOnline(this.state);
    await this.call({ op: 'report', target: id });
  }

  /** "Delete my ladder name and scores": the ladder forgets them, and so does the device (a new key). */
  async forget(): Promise<LadderReply> {
    const r = await this.call({ op: 'forget' });
    if ('ok' in r) {
      Object.assign(this.state, { key: randomKey(), me: null, pending: null, reported: [] });
      saveOnline(this.state);
    }
    return r;
  }

  /** The scored try so far. Only a named player's goes on the ladder; nothing is sent otherwise. */
  submit(s: Submission): Promise<void> {
    if (!this.backend || !this.named) return Promise.resolve();
    const p = this.state.pending;
    // Progress only grows: keep the furthest, and a finish once there is one.
    this.state.pending = p && p.day === s.day
      ? { ...s, height: Math.max(p.height, s.height), score: Math.max(p.score, s.score), checkpoints: Math.max(p.checkpoints, s.checkpoints), finished: p.finished || s.finished }
      : s;
    saveOnline(this.state);
    return this.flush();
  }

  /** Sends the try still waiting, if any (on start and whenever the Daily card opens). */
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    const p = this.state.pending;
    if (!p || !this.backend || !this.named) return Promise.resolve();
    // A try from a day the ladder has closed won't be taken: drop it rather than retry forever.
    if (submitProblem(p, undefined, Date.now()) === 'closed') { this.state.pending = null; saveOnline(this.state); return Promise.resolve(); }
    this.sending = (async () => {
      const r = await this.call({ op: 'submit', sub: p });
      const e = errorOf(r);
      // Sent, or refused for good: done with it, unless something newer queued meanwhile (sent next).
      if ((!e || !RETRY.includes(e)) && this.state.pending === p) { this.state.pending = null; saveOnline(this.state); }
      if (e === 'noname') { this.state.me = this.state.me ? { ...this.state.me, name: null } : null; saveOnline(this.state); }
    })().finally(() => {
      this.sending = null;
      if (this.state.pending && this.state.pending !== p) void this.flush();
    });
    return this.sending;
  }
}

type ClaudeWindow = { claude?: { use?(name: string): Promise<unknown> } };

/**
 * Which ladder this copy plays on: the page's own inside claude.ai (it can't reach other sites), our API
 * everywhere else. QA's local server wins when set.
 */
export async function chooseBackend(): Promise<LadderBackend | null> {
  let override: string | null = null;
  try { override = localStorage.getItem(API_OVERRIDE); } catch { /* no storage */ }
  if (override) return new ApiBackend(override);
  if ((window as unknown as ClaudeWindow).claude?.use) {
    const { pageBackend } = await import('./page.ts');
    return pageBackend();
  }
  return new ApiBackend(API_URL);
}
