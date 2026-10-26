// The ladder server's logic (gameplay.md §12.3), apart from HTTP and storage so tests run it directly.
// Documents: players/<id> (name, look, reports, days played, proved purchases), names/<name key> (who
// holds a name), ladder/<day>/<id> (a player's entry for a day), receipts/<purchase hash> (which players a
// purchase shows a bought portrait for). The rules themselves are the game's own (game/src/meta).

import { DEFAULT_PORTRAIT, portraitBought } from '../../game/src/meta/portraits.ts';
import { portraitProducts } from '../../game/src/meta/shop.ts';
import { KEY_RE, REPORTS_TO_HIDE, cleanLook, mergeEntry, playerId, rankLadder, submitProblem, type LadderAvatar, type LadderEntry } from '../../game/src/meta/ladder.ts';
import { nameKey, nameProblem, nameShowable, tidyName } from '../../game/src/meta/names/names.ts';
import { dailyDay } from '../../game/src/meta/daily.ts';
import { RENAME_MS, type LadderError, type LadderReply, type LadderRequest, type Me } from '../../game/src/online/protocol.ts';
import type { Store } from './store.ts';
import type { ReceiptCheck } from './receipts.ts';

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
  /** Products a store receipt proved they own: a bought portrait shows only then (monetisation stage 3). */
  bought?: string[];
  /** The receipts/ documents those purchases hold them in, so "delete me" lets go of them. */
  receipts?: string[];
}

/** How many players (devices) one purchase can show its portrait for: a phone, a tablet, a reinstall or two. */
export const RECEIPT_PLAYERS = 5;
const fail = (error: LadderError): LadderReply => ({ error });
const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const entryPath = (day: string, id: string) => `ladder/${day}/${id}`;
const hashOf = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

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

type Look = { portrait: string; avatar: LadderAvatar };
const proved = (p: PlayerDoc, portrait: string): boolean => !portraitBought(portrait) || portraitProducts(portrait).some(x => p.bought?.includes(x));

/**
 * The look a player asked for, with a bought portrait only once a store receipt proves it: one they
 * proved before, or this request's (checked with the store, and held for at most RECEIPT_PLAYERS players).
 * Otherwise others see the portrait they had, or the free one. Returns the look and the player with any
 * new proof added.
 */
async function prove(store: Store, p: PlayerDoc, want: Look, receipt: LadderRequest['receipt'], check: ReceiptCheck | undefined, now: number): Promise<{ look: Look; player: PlayerDoc }> {
  if (proved(p, want.portrait)) return { look: want, player: p };
  const fallback = { ...want, portrait: proved(p, p.portrait) ? p.portrait : DEFAULT_PORTRAIT };
  if (!receipt || !check || !portraitProducts(want.portrait).includes(receipt.product)) return { look: fallback, player: p };
  const c = await check(receipt, now);
  if (!c.ok) return { look: fallback, player: p };
  const ref = `receipts/${await hashOf(c.purchase)}`;
  let held = false;
  await edit<{ product: string; ids: string[] }>(store, ref, cur => {
    const ids = cur?.ids ?? [];
    held = ids.includes(p.id) || ids.length < RECEIPT_PLAYERS;
    return held && !ids.includes(p.id) ? { product: receipt.product, ids: [...ids, p.id] } : 'skip';
  });
  if (!held) return { look: fallback, player: p };
  const add = (xs: string[] | undefined, x: string) => [...(xs ?? []).filter(y => y !== x), x];
  return { look: want, player: { ...p, bought: add(p.bought, receipt.product), receipts: add(p.receipts, ref) } };
}

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

/** One call. `check` asks the stores about receipts (without it, bought portraits never show to others). */
export async function handle(req: LadderRequest, store: Store, now = Date.now(), check?: ReceiptCheck): Promise<LadderReply> {
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
      const was = before ?? freshPlayer(id, now);
      const { look, player: proof } = await prove(store, was, cleanLook(req.look, was), req.receipt, check, now);
      const after = await edit<PlayerDoc>(store, path, cur => {
        const p = cur ?? freshPlayer(id, now);
        return { ...p, bought: proof.bought, receipts: proof.receipts, name, nameKey: key, ...look, renamedAt: sameKey ? p.renamedAt : now, reports: sameKey ? p.reports : [], hidden: sameKey ? p.hidden : false };
      }) as PlayerDoc;
      if (before?.nameKey && !sameKey) {
        const old = await store.get<{ id: string }>(`names/${before.nameKey}`);
        if (old?.data.id === id) await store.del(`names/${before.nameKey}`);
      }
      await restyle(store, after, now);
      return { me: meOf(id, after) };
    }

    case 'look': {
      const was = (await player()) ?? freshPlayer(id, now);
      const { look, player: proof } = await prove(store, was, cleanLook(req.look, was), req.receipt, check, now);
      const after = await edit<PlayerDoc>(store, path, cur => {
        const p = cur ?? freshPlayer(id, now);
        return { ...p, bought: proof.bought, receipts: proof.receipts, ...look };
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
        for (const ref of p.receipts ?? []) {
          await edit<{ product: string; ids: string[] }>(store, ref, cur => {
            if (!cur?.ids.includes(id)) return 'skip';
            const ids = cur.ids.filter(x => x !== id);
            return ids.length ? { ...cur, ids } : null;
          });
        }
        await store.del(path);
      }
      return { ok: true };
    }

    default:
      return fail('badop');
  }
}
