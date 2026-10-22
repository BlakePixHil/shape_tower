// The game page's own ladder (gameplay.md §12.3): on claude.ai the page can't reach our API, so the
// people the page is shared with share a ladder kept in the page's database. Same rules and answers as
// the API (online/src/handler.ts), on the page's terms: each player writes only their own row,
// `ladder/<their claude.ai id>`, holding their name, look and latest day's try, and their reports go in
// `reports/<their id>`. The publish declares those rules (game/scripts/artifact.mjs prints them).

import { KEY_RE, REPORTS_TO_HIDE, cleanLook, mergeEntry, rankLadder, submitProblem, type LadderAvatar, type LadderEntry } from '../meta/ladder.ts';
import { nameKey, nameProblem, nameShowable, tidyName } from '../meta/names/names.ts';
import { DEFAULT_PORTRAIT } from '../meta/portraits.ts';
import type { LadderBackend } from './online.ts';
import { RENAME_MS, type LadderReply, type LadderRequest, type Me } from './protocol.ts';

interface Snap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { get(): Promise<Snap>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }
interface Query { where(f: string, op: string, v: unknown): Query; limit(n: number): Query; get(): Promise<{ docs: Snap[] }> }
interface Db { doc(path: string): DocRef; collection(path: string): Query }
interface User { id(): Promise<string | null> }
type ClaudeWindow = { claude: { use(name: string): Promise<unknown> } };

/** A day's try as the page keeps it: the ladder entry and its day. */
type DayEntry = LadderEntry & { day: string };

/** A player's row: who they are and their latest day's try. */
interface Row {
  id: string;
  name: string | null;
  nameKey: string | null;
  portrait: string;
  avatar: LadderAvatar;
  renamedAt: number;
  entry: DayEntry | null;
}

/** Who reported whom: target id to the name key they reported (a new name starts clean). */
interface Reports { targets: Record<string, string> }

const ROWS = 'ladder';
const REPORTS = 'reports';

async function hashId(uid: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`shape-tower-page:${uid}`));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The page's ladder, or null when this viewer has no database (signed out, or the page wasn't given one). */
export async function pageBackend(): Promise<LadderBackend | null> {
  const c = (window as unknown as ClaudeWindow).claude;
  const [db, user] = await Promise.all([c.use('db').catch(() => null), c.use('user').catch(() => null)]) as [Db | null, User | null];
  const uid = await user?.id().catch(() => null);
  if (!db || !uid) return null;
  return new PageBackend(db, uid, await hashId(uid));
}

class PageBackend implements LadderBackend {
  readonly kind = 'page';
  constructor(private db: Db, private uid: string, private id: string) {}

  private async row(): Promise<Row | null> {
    const s = await this.db.doc(`${ROWS}/${this.uid}`).get();
    return s.exists ? (s.data() as unknown as Row) : null;
  }
  private save(r: Row): Promise<void> { return this.db.doc(`${ROWS}/${this.uid}`).set(r as unknown as Record<string, unknown>); }

  /** How many different players reported each id under its current name. */
  private async reportCounts(rows: Row[]): Promise<Map<string, number>> {
    const keyOf = new Map(rows.map(r => [r.id, r.nameKey]));
    const n = new Map<string, number>();
    for (const s of (await this.db.collection(REPORTS).limit(1000).get()).docs) {
      const t = (s.data() as Reports | undefined)?.targets ?? {};
      for (const [id, key] of Object.entries(t)) if (key && keyOf.get(id) === key) n.set(id, (n.get(id) ?? 0) + 1);
    }
    return n;
  }

  private async allRows(): Promise<Row[]> {
    return (await this.db.collection(ROWS).limit(1000).get()).docs.map(s => s.data() as unknown as Row).filter(r => r && typeof r.id === 'string');
  }

  private me(r: Row | null, hidden = false): Me {
    return { id: this.id, name: r?.name ?? null, portrait: r?.portrait ?? DEFAULT_PORTRAIT, avatar: r?.avatar ?? {}, hidden, renamedAt: r?.renamedAt ?? 0 };
  }

  private fresh(): Row {
    return { id: this.id, name: null, nameKey: null, portrait: DEFAULT_PORTRAIT, avatar: { shape: 'O', face: 'idle', hat: 'party' }, renamedAt: 0, entry: null };
  }

  async call(req: LadderRequest): Promise<LadderReply> {
    try {
      return await this.run(req, Date.now());
    } catch (e) {
      // A viewer who may only look (a Viewer on the page) can't write: no ladder for them, only bests.
      const code = (e as { code?: string })?.code;
      return { error: code === 'invalid_argument' || code === 'not_granted' ? 'noname' : 'offline' };
    }
  }

  private async run(req: LadderRequest, now: number): Promise<LadderReply> {
    if (req.op !== 'ladder' && (typeof req.key !== 'string' || !KEY_RE.test(req.key))) return { error: 'nokey' };
    switch (req.op) {
      case 'me': {
        const r = await this.row();
        const hidden = r?.name ? ((await this.reportCounts([r])).get(this.id) ?? 0) >= REPORTS_TO_HIDE : false;
        return { me: this.me(r, hidden) };
      }
      case 'name': {
        const name = tidyName(String(req.name ?? ''));
        const problem = nameProblem(name);
        if (problem) return { error: problem };
        const key = nameKey(name);
        const before = (await this.row()) ?? this.fresh();
        const sameKey = before.nameKey === key;
        const hidden = before.name ? ((await this.reportCounts([before])).get(this.id) ?? 0) >= REPORTS_TO_HIDE : false;
        if (before.name && !sameKey && !hidden && now - before.renamedAt < RENAME_MS) return { error: 'renamed' };
        if (!sameKey && (await this.db.collection(ROWS).where('nameKey', '==', key).limit(5).get()).docs.some(s => (s.data() as unknown as Row)?.id !== this.id)) return { error: 'taken' };
        const look = cleanLook(req.look, before);
        const after: Row = { ...before, name, nameKey: key, ...look, renamedAt: sameKey ? before.renamedAt : now };
        if (after.entry) after.entry = { ...after.entry, name, ...look };
        await this.save(after);
        return { me: this.me(after, sameKey && hidden) };
      }
      case 'look': {
        const before = (await this.row()) ?? this.fresh();
        const after: Row = { ...before, ...cleanLook(req.look, before) };
        if (after.entry) after.entry = { ...after.entry, portrait: after.portrait, avatar: after.avatar };
        await this.save(after);
        return { me: this.me(after) };
      }
      case 'submit': {
        const r = await this.row();
        if (!r?.name) return { error: 'noname' };
        const s = req.sub!;
        const prev = r.entry && r.entry.day === s?.day ? r.entry : undefined;
        const problem = submitProblem(s, prev, now);
        if (problem) return { error: problem };
        await this.save({ ...r, entry: { ...mergeEntry(prev, s, { id: this.id, name: r.name, portrait: r.portrait, avatar: r.avatar }), day: s.day } });
        return { ok: true };
      }
      case 'ladder': {
        if (typeof req.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(req.day)) return { error: 'bad' };
        const rows = await this.allRows();
        const today = rows.filter(r => r.entry?.day === req.day && r.name);
        const counts = await this.reportCounts(today);
        const entries = today.map(r => {
          const { day: _, ...e } = r.entry!;
          const hidden = (counts.get(r.id) ?? 0) >= REPORTS_TO_HIDE;
          return { ...e, id: r.id, name: !hidden && nameShowable(r.name!) ? r.name! : '', portrait: r.portrait, avatar: r.avatar, ...(hidden ? { hidden: true } : {}) };
        });
        return { view: rankLadder(req.day, entries, typeof req.id === 'string' ? req.id : null) };
      }
      case 'report': {
        const target = String(req.target ?? '');
        if (target === this.id) return { error: 'self' };
        if (!(await this.row())?.name) return { error: 'noname' };
        const theirs = (await this.allRows()).find(r => r.id === target);
        if (!theirs?.nameKey) return { error: 'bad' };
        const ref = this.db.doc(`${REPORTS}/${this.uid}`);
        const cur = ((await ref.get()).data() as Reports | undefined)?.targets ?? {};
        await ref.set({ targets: { ...cur, [target]: theirs.nameKey } });
        return { ok: true };
      }
      case 'forget':
        await this.db.doc(`${ROWS}/${this.uid}`).delete();
        await this.db.doc(`${REPORTS}/${this.uid}`).delete();
        return { ok: true };
      default:
        return { error: 'badop' };
    }
  }
}

