// The ladder server's logic (gameplay.md §12.3), apart from HTTP and storage so tests run it directly.
// Documents: players/<id> (name, look, reports, days played), names/<name key> (who holds a name),
// ladder/<day>/<id> (a player's entry for a day). The rules themselves are the game's own (game/src/meta).

import { DEFAULT_PORTRAIT } from '../../game/src/meta/portraits.ts';
import { KEY_RE, REPORTS_TO_HIDE, cleanLook, mergeEntry, playerId, rankLadder, submitProblem, type LadderAvatar, type LadderEntry } from '../../game/src/meta/ladder.ts';
import { nameKey, nameProblem, nameShowable, tidyName } from '../../game/src/meta/names/names.ts';
import { dailyDay } from '../../game/src/meta/daily.ts';
import { RENAME_MS, type LadderError, type LadderReply, type LadderRequest, type Me } from '../../game/src/online/protocol.ts';
import type { Store } from './store.ts';

interface PlayerDoc {
  id: string;
  name: string | null;
  nameKey: string | null;
  portrait: string;
  avatar: LadderAvatar;
  created: number;
  renamedAt: number;
  /** Who reported this name (cleared by a new name). */
  reports: string[];
  hidden: boolean;
  /** Days with an entry, so "delete me" can find them. */
  days: string[];
}
const fail = (error: LadderError): LadderReply => ({ error });
const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const entryPath = (day: string, id: string) => `ladder/${day}/${id}`;

/** Read, change and write back a document, retrying when someone else wrote it in between. */
async function edit<T>(store: Store, path: string, change: (cur: T | null) => T | null | 'skip'): Promise<T | null | 'skip'> {
  for (let i = 0; i < 12; i++) {
    const cur = await store.get<T>(path);
    const next = change(cur ? cur.data : null);
    if (next === 'skip') return next;
    if (next === null) { if (cur) await store.del(path); return null; }
    if (await store.put(path, next, cur ? { ifMatch: cur.etag } : { create: true })) return next;
    await new Promise(r => setTimeout(r, 10 + Math.random() * 60 * Math.min(i + 1, 6)));
  }
  throw new Error('busy');
}

const meOf = (id: string, p: PlayerDoc | null): Me => ({
  id, name: p?.name ?? null, portrait: p?.portrait ?? DEFAULT_PORTRAIT, avatar: p?.avatar ?? {}, hidden: !!p?.hidden, renamedAt: p?.renamedAt ?? 0,
});

const freshPlayer = (id: string, now: number): PlayerDoc => ({
  id, name: null, nameKey: null, portrait: DEFAULT_PORTRAIT, avatar: { shape: 'O', face: 'idle', hat: 'party' }, created: now, renamedAt: 0, reports: [], hidden: false, days: [],
});

/** Copies a player's name and look onto their entries for the days still on show (today and yesterday). */
async function restyle(store: Store, p: PlayerDoc, now: number): Promise<void> {
  const today = dailyDay(new Date(now));
  for (const day of p.days.slice(-2)) {
    if (day !== today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) > 86_400_000) continue;
    await edit<LadderEntry>(store, entryPath(day, p.id), e => {
      if (!e) return 'skip';
      const next: LadderEntry = { ...e, name: p.name ?? '', portrait: p.portrait, avatar: p.avatar };
      if (p.hidden) next.hidden = true; else delete next.hidden;
      return JSON.stringify(next) === JSON.stringify(e) ? 'skip' : next; // nothing shown changed: no write
    });
  }
}

export async function handle(req: LadderRequest, store: Store, now = Date.now()): Promise<LadderReply> {
  if (!req || typeof req !== 'object') return fail('badop');
  if (req.op === 'ladder') {
    if (!isDay(req.day)) return fail('bad');
    const stored = await store.list<LadderEntry>(`ladder/${req.day}/`);
    // A hidden or refused name never leaves the server: the game shows its stand-in.
    const entries = stored.map(({ data: e }) => (!e.hidden && nameShowable(e.name) ? e : { ...e, name: '' }));
    return { view: rankLadder(req.day, entries, typeof req.id === 'string' ? req.id : null) };
  }
  if (typeof req.key !== 'string' || !KEY_RE.test(req.key)) return fail('nokey');
  const id = await playerId(req.key);
  const path = `players/${id}`;
  const player = async () => (await store.get<PlayerDoc>(path))?.data ?? null;

  switch (req.op) {
    case 'me':
      return { me: meOf(id, await player()) };

    case 'name': {
      const name = tidyName(String(req.name ?? ''));
      const problem = nameProblem(name);
      if (problem) return fail(problem);
      const key = nameKey(name);
      const before = await player();
      const sameKey = before?.nameKey === key;
      if (before?.name && !sameKey && !before.hidden && now - before.renamedAt < RENAME_MS) return fail('renamed');
      if (!sameKey) {
        if (!(await store.put(`names/${key}`, { id }, { create: true }))) {
          const holder = await store.get<{ id: string }>(`names/${key}`);
          if (holder?.data.id !== id) return fail('taken');
        }
      }
      const look = cleanLook(req.look, { portrait: before?.portrait ?? DEFAULT_PORTRAIT, avatar: before?.avatar ?? freshPlayer(id, now).avatar });
      const after = await edit<PlayerDoc>(store, path, cur => {
        const p = cur ?? freshPlayer(id, now);
        return { ...p, name, nameKey: key, ...look, renamedAt: sameKey ? p.renamedAt : now, reports: sameKey ? p.reports : [], hidden: sameKey ? p.hidden : false };
      }) as PlayerDoc;
      if (before?.nameKey && !sameKey) {
        const old = await store.get<{ id: string }>(`names/${before.nameKey}`);
        if (old?.data.id === id) await store.del(`names/${before.nameKey}`);
      }
      await restyle(store, after, now);
      return { me: meOf(id, after) };
    }

    case 'look': {
      const after = await edit<PlayerDoc>(store, path, cur => {
        const p = cur ?? freshPlayer(id, now);
        return { ...p, ...cleanLook(req.look, p) };
      }) as PlayerDoc;
      await restyle(store, after, now);
      return { me: meOf(id, after) };
    }

    case 'submit': {
      const p = await player();
      if (!p?.name) return fail('noname');
      const s = req.sub!;
      const day = s?.day;
      let problem: LadderError | null = null;
      await edit<LadderEntry>(store, entryPath(isDay(day) ? day : 'x', id), cur => {
        problem = submitProblem(s, cur ?? undefined, now);
        if (problem) return 'skip';
        const e = mergeEntry(cur ?? undefined, s, { id, name: p.name!, portrait: p.portrait, avatar: p.avatar });
        if (p.hidden) e.hidden = true;
        return e;
      });
      if (problem) return fail(problem);
      if (!p.days.includes(day)) await edit<PlayerDoc>(store, path, cur => (cur ? { ...cur, days: [...cur.days.filter(d => d !== day), day].slice(-400) } : 'skip'));
      return { ok: true };
    }

    case 'report': {
      const target = String(req.target ?? '');
      if (target === id) return fail('self');
      if (!/^[0-9a-f]{24}$/.test(target)) return fail('bad');
      // Only named players can report, so one device can't hide a name by itself.
      if (!(await player())?.name) return fail('noname');
      const after = await edit<PlayerDoc>(store, `players/${target}`, cur => {
        if (!cur || cur.reports.includes(id)) return 'skip';
        const reports = [...cur.reports, id];
        return { ...cur, reports, hidden: cur.hidden || reports.length >= REPORTS_TO_HIDE };
      });
      if (after && after !== 'skip' && after.hidden) await restyle(store, after, now);
      return { ok: true };
    }

    case 'forget': {
      const p = await player();
      if (p) {
        for (const day of p.days) await store.del(entryPath(day, id));
        if (p.nameKey) {
          const held = await store.get<{ id: string }>(`names/${p.nameKey}`);
          if (held?.data.id === id) await store.del(`names/${p.nameKey}`);
        }
        await store.del(path);
      }
      return { ok: true };
    }

    default:
      return fail('badop');
  }
}
