// The anonymous play stats on the server (launch marketing plan, "What to measure"; the rules are
// game/src/meta/stats.ts). Nothing raw is kept: each batch from a phone becomes one row per device (when
// it was first and last seen, which days since then it came back, how far it got) and counts per day.
// That answers players back on day 1 and day 7, where new players stop, and how many Daily results get
// shared, and costs a handful of row writes per batch on Cloudflare's free plan. Devices not seen for
// 13 months are deleted. SQLite: the "stats" Durable Object's own database in production, node:sqlite in
// the checks.

import type { RunKind, StatBatch } from '../../game/src/meta/stats.ts';
import type { Sql } from './sql.ts';

const DAY_MS = 86_400_000;
/** Day offsets after the first a device's row remembers (bit n: it came back n days after its first). */
export const TRACKED_DAYS = 45;
/** A device unseen this long is deleted (13 months). */
export const KEEP_DAYS = 400;
/** Retention days the summary reports. */
export const RETENTION_DAYS = [1, 3, 7, 14, 30] as const;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (day: string, n: number): string => dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

interface DeviceRow {
  id: string;
  first: string;
  last: string;
  /** Bit n set: active n days after `first`. */
  days: number;
  /** First seen with its first_open (a new install), so it counts in retention. Existing players don't. */
  fresh: number;
  platform: string;
  build: string;
  level: number;
  cp: number;
  runs: number;
  dailies: number;
  shares: number;
}

/** Counter names: per day, the number of times. */
export type Metric =
  | 'active' | 'installs' | 'sessions' | 'reviews' | 'forgets'
  | `runs:${RunKind}` | `shares:${RunKind}` | `shared:${RunKind}`
  | 'link:home' | 'link:daily' | 'link:store:android' | 'link:store:ios' | 'link:store:other';

export interface DayCounts { day: string; counts: Partial<Record<Metric, number>> }

export interface Cohort {
  /** The day these devices first opened the game. */
  day: string;
  n: number;
  /** How many came back on day 1, 3, 7, 14 and 30; null until that day has been and gone. */
  back: Record<`d${(typeof RETENTION_DAYS)[number]}`, number | null>;
}

export interface StatsSummary {
  generated: string;
  days: DayCounts[];
  cohorts: Cohort[];
  /** Pooled over the cohorts old enough: players back on day N, of those who could be. */
  retention: Record<`d${(typeof RETENTION_DAYS)[number]}`, { n: number; back: number; rate: number | null }>;
  /** New installs in the window, first seen at least a day ago: how far they got. */
  funnel: { n: number; level3: number; level5: number; level8: number; cp1: number; cp3: number; cp6: number; daily: number; shared: number };
  /** Scored Daily tries shared from their summary, of scored Daily tries finished. */
  dailyShareRate: number | null;
  devices: { total: number; android: number; ios: number; web: number };
}

export class StatsDb {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
    sql(`CREATE TABLE IF NOT EXISTS stat_devices (id TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL, days INTEGER NOT NULL,
      fresh INTEGER NOT NULL, platform TEXT NOT NULL, build TEXT NOT NULL, level INTEGER NOT NULL, cp INTEGER NOT NULL,
      runs INTEGER NOT NULL, dailies INTEGER NOT NULL, shares INTEGER NOT NULL) WITHOUT ROWID`);
    sql('CREATE TABLE IF NOT EXISTS stat_counts (day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, metric)) WITHOUT ROWID');
    sql('CREATE TABLE IF NOT EXISTS stat_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID');
  }

  /** Adds `n` to a day's counter. */
  bump(metric: Metric, now: number, n = 1): void {
    if (n > 0) this.sql('INSERT INTO stat_counts (day, metric, n) VALUES (?, ?, ?) ON CONFLICT (day, metric) DO UPDATE SET n = n + excluded.n', dayOf(now), metric, n);
  }

  private bumpAll(counts: Map<string, number>): void {
    for (const [k, n] of counts) {
      const [day, metric] = [k.slice(0, 10), k.slice(11)];
      if (n > 0) this.sql('INSERT INTO stat_counts (day, metric, n) VALUES (?, ?, ?) ON CONFLICT (day, metric) DO UPDATE SET n = n + excluded.n', day, metric, n);
    }
  }

  /** Takes a cleaned batch (cleanBatch): the device's row, then the day counters. */
  ingest(b: StatBatch, now: number): void {
    this.prune(now);
    if (b.forget) {
      if (this.sql('DELETE FROM stat_devices WHERE id = ? RETURNING id', b.id).length) this.bump('forgets', now);
      return;
    }
    const events = [...b.events].sort((x, y) => x.t - y.t);
    const row = this.sql('SELECT * FROM stat_devices WHERE id = ?', b.id)[0] as unknown as DeviceRow | undefined;
    const today = dayOf(now);
    const firstDay = events.length ? dayOf(events[0].t) : today;
    const d: DeviceRow = row
      ? { ...row, days: Number(row.days), fresh: Number(row.fresh), level: Number(row.level), cp: Number(row.cp), runs: Number(row.runs), dailies: Number(row.dailies), shares: Number(row.shares) }
      : { id: b.id, first: firstDay, last: '', days: 0, fresh: events.some(e => e.e === 'first_open') ? 1 : 0, platform: b.p, build: b.b, level: 0, cp: 0, runs: 0, dailies: 0, shares: 0 };
    d.platform = b.p;
    if (b.b) d.build = b.b;
    const counts = new Map<string, number>();
    const count = (day: string, metric: Metric) => counts.set(`${day} ${metric}`, (counts.get(`${day} ${metric}`) ?? 0) + 1);
    // Each day the device shows up on (an empty batch still says it's here today): active once that day,
    // and its bit in the row while it's within TRACKED_DAYS of the first. Events come oldest first.
    for (const day of new Set(events.length ? events.map(e => dayOf(e.t)) : [today])) {
      if (day <= d.last) continue;
      d.last = day;
      count(day, 'active');
      const off = daysBetween(d.first, day);
      if (off >= 0 && off < TRACKED_DAYS) d.days += 2 ** off;
    }
    for (const e of events) {
      const day = dayOf(e.t);
      switch (e.e) {
        case 'first_open': count(day, 'installs'); break;
        case 'session': count(day, 'sessions'); d.level = Math.max(d.level, e.lv); break;
        case 'review': count(day, 'reviews'); break;
        case 'run_end':
          count(day, `runs:${e.m}`);
          d.runs++;
          d.level = Math.max(d.level, e.lv);
          d.cp = Math.max(d.cp, e.cp);
          if (e.m === 'daily') d.dailies++;
          break;
        case 'share':
          count(day, `shares:${e.m}`);
          if (e.ok) { count(day, `shared:${e.m}`); d.shares++; }
          break;
      }
    }
    // A batch that changes nothing on the row (another session the same day) writes only its counters.
    const same = row && (Object.keys(d) as (keyof DeviceRow)[]).every(k => String(d[k]) === String(row[k]));
    if (!same) this.sql(`INSERT INTO stat_devices (id, first, last, days, fresh, platform, build, level, cp, runs, dailies, shares) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET last = excluded.last, days = excluded.days, platform = excluded.platform, build = excluded.build, level = excluded.level,
      cp = excluded.cp, runs = excluded.runs, dailies = excluded.dailies, shares = excluded.shares`,
    d.id, d.first, d.last, d.days, d.fresh, d.platform, d.build, d.level, d.cp, d.runs, d.dailies, d.shares);
    this.bumpAll(counts);
  }

  /** Once a day: devices unseen for KEEP_DAYS go. */
  private prune(now: number): void {
    const today = dayOf(now);
    const last = this.sql("SELECT v FROM stat_meta WHERE k = 'pruned'")[0]?.v;
    if (last === today) return;
    this.sql('DELETE FROM stat_devices WHERE last < ?', addDays(today, -KEEP_DAYS));
    this.sql("INSERT INTO stat_meta (k, v) VALUES ('pruned', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", today);
  }

  /** The last `days` days of counters, retention by first day, the new players' funnel and the share rate. */
  summary(now: number, days = 28): StatsSummary {
    const today = dayOf(now), from = addDays(today, -(Math.max(1, Math.min(400, days)) - 1));
    const byDay = new Map<string, DayCounts>();
    for (let i = 0; daysBetween(addDays(from, i), today) >= 0; i++) byDay.set(addDays(from, i), { day: addDays(from, i), counts: {} });
    for (const r of this.sql('SELECT day, metric, n FROM stat_counts WHERE day >= ? ORDER BY day', from)) {
      const dc = byDay.get(String(r.day));
      if (dc) dc.counts[String(r.metric) as Metric] = Number(r.n);
    }
    const cohorts: Cohort[] = [];
    const pooled = Object.fromEntries(RETENTION_DAYS.map(n => [`d${n}`, { n: 0, back: 0, rate: null as number | null }])) as StatsSummary['retention'];
    const cols = RETENTION_DAYS.map(n => `SUM((days >> ${n}) & 1) AS d${n}`).join(', ');
    for (const r of this.sql(`SELECT first, COUNT(*) AS n, ${cols} FROM stat_devices WHERE fresh = 1 AND first >= ? GROUP BY first ORDER BY first`, from)) {
      const day = String(r.first), age = daysBetween(day, today), n = Number(r.n);
      const back = {} as Cohort['back'];
      for (const k of RETENTION_DAYS) {
        // Day k is measurable once it has ended.
        const ok = age > k;
        back[`d${k}`] = ok ? Number(r[`d${k}`]) : null;
        if (ok) { pooled[`d${k}`].n += n; pooled[`d${k}`].back += Number(r[`d${k}`]); }
      }
      cohorts.push({ day, n, back });
    }
    for (const v of Object.values(pooled)) v.rate = v.n ? Math.round((v.back / v.n) * 1000) / 1000 : null;
    const f = this.sql(`SELECT COUNT(*) AS n, SUM(level >= 3) AS level3, SUM(level >= 5) AS level5, SUM(level >= 8) AS level8, SUM(cp >= 1) AS cp1,
      SUM(cp >= 3) AS cp3, SUM(cp >= 6) AS cp6, SUM(dailies >= 1) AS daily, SUM(shares >= 1) AS shared FROM stat_devices WHERE fresh = 1 AND first >= ? AND first < ?`, from, today)[0] ?? {};
    const funnel = Object.fromEntries(['n', 'level3', 'level5', 'level8', 'cp1', 'cp3', 'cp6', 'daily', 'shared'].map(k => [k, Number(f[k] ?? 0)])) as StatsSummary['funnel'];
    let dailyRuns = 0, dailyShares = 0;
    for (const dc of byDay.values()) { dailyRuns += dc.counts['runs:daily'] ?? 0; dailyShares += dc.counts['shared:daily'] ?? 0; }
    const dev = { total: 0, android: 0, ios: 0, web: 0 };
    for (const r of this.sql('SELECT platform, COUNT(*) AS n FROM stat_devices GROUP BY platform')) {
      const p = String(r.platform) as 'android' | 'ios' | 'web', n = Number(r.n);
      dev.total += n;
      if (p in dev) dev[p] += n;
    }
    return {
      generated: new Date(now).toISOString(), days: [...byDay.values()], cohorts, retention: pooled, funnel,
      dailyShareRate: dailyRuns ? Math.round((dailyShares / dailyRuns) * 1000) / 1000 : null, devices: dev,
    };
  }
}
