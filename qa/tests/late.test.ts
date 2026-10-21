// Late hazards and the late heart rule, gameplay.md §7.1, §8.2 and §8.3 (late challenge, #27). Game
// only, on builds whose tuning has lateHazards. Each stretch's hazards against the table, every hit
// warned 2 s ahead, half strength the first time, never two brand-new hazards at once, nothing in a
// hold or the claim pause, hits never on stone or the steered shape, hearts back every third claim
// from Orbit, and runs with late hazards replaying exactly without moving gusts or the shape bag.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, REPO_ROOT, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { fmt, writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const late = (() => {
  if (!game) return false;
  const probe = new game.api.Sim({ seed: 1, autoSpawn: false });
  const has = typeof probe.tuning?.lateHazards === 'boolean';
  probe.dispose();
  return has;
})();

type Ev = { name: string; step: number; payload: Record<string, any> };
type T = Record<string, any>;
type Kind = 'gust' | 'crosswind' | 'junk' | 'meteor' | 'dust' | 'sway';
const LATE: Kind[] = ['crosswind', 'junk', 'meteor', 'dust', 'sway'];
const WARN_STEPS = 120;

// gameplay.md §8.2, written out from the doc rather than read from the game's tuning.
const CROSSWIND: Record<number, number> = { 7: 0.04, 8: 0.06, 9: 0.08, 10: 0.1 };
const JUNK: Record<number, number> = { 11: 18, 12: 15, 13: 12 };
const METEOR: Record<number, number> = { 14: 22, 15: 18, 16: 15 };
const DUST: Record<number, [number, number]> = { 17: [0.15, 16], 18: [0.2, 14], 19: [0.25, 12] };
const SWAY: Record<number, number> = { 20: 0.08, 21: 0.11, 22: 0.14 };
const cosmosK = (n: number) => Math.min(2, 1 + 0.05 * (n - 22));
/** The late hazards a stretch should have; Deep Cosmos picks two from the pool, checked separately. */
function expected(n: number): Kind[] {
  if (CROSSWIND[n]) return ['crosswind'];
  if (JUNK[n]) return ['junk'];
  if (METEOR[n]) return ['meteor'];
  if (DUST[n]) return ['dust'];
  if (SWAY[n]) return ['sway'];
  return [];
}
const lastCp = (n: number) => [2, 4, 6, 8, 10, 13, 16, 19, 22].find((c) => n <= c) ?? Infinity;

const hazardEvents = (ev: Ev[]) => ev.filter((e) => e.name.startsWith('hazard_'));
const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});
function make(n: number, tuning: Record<string, unknown> = {}, seed = 300 + n): T {
  return own(game!.api.createSim({ engine: sut.engine, seed, startCheckpoint: n, tuning: { firstGap: 1000, infiniteHearts: true, infiniteBudget: true, powerUps: false, hazardIntro: false, seenHazards: LATE, ...tuning } }) as T);
}
/**
 * An 8-wide wall of O pieces, 4 rows high, so junk, meteors and dust devils have something to hit.
 * Returns the hazard events while it was built: a stretch's crosswind or sway is warned at its start.
 */
function wall(t: T): Ev[] {
  const s = t.sim as Record<string, any>;
  for (let row = 0; row < 4; row++) {
    for (let c = 0; c < 4; c++) t.placePiece({ shape: 'O', x: -3 + 2 * c, y: s.foundation.top + 1 + 2 * row, as: 'dynamic' });
    t.step(60);
  }
  t.step(120);
  return hazardEvents(t.drainEvents() as Ev[]);
}
/** Seconds between successive warnings of one kind (meteor bursts and dust devils count once each). */
function intervals(ev: Ev[], kind: Kind): number[] {
  const at = ev.filter((e) => e.name === 'hazard_warning' && e.payload.type === kind).map((e) => e.step);
  return at.slice(1).map((s, i) => (s - at[i]) / 60);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * Every push has a warning of its kind (and id, where it has one) at least 2 s before it: the hit for
 * junk and meteors (their "start" is the shot coming into view after the reticle), the start for the
 * rest.
 */
function warnedProblems(ev: Ev[], where: string): string[] {
  const out: string[] = [];
  for (const e of ev) {
    const k = e.payload.type as Kind;
    if (k === 'gust') continue; // gusts.test.ts covers them
    const shot = k === 'junk' || k === 'meteor';
    if (e.name !== (shot ? 'hazard_hit' : 'hazard_start')) continue;
    const w = ev.filter((x) => x.name === 'hazard_warning' && x.payload.type === k && x.step <= e.step && (k === 'meteor' || x.payload.id === undefined || x.payload.id === e.payload.id)).pop();
    if (!w) out.push(`${where}: a ${k} ${e.name === 'hazard_hit' ? 'hit' : 'started'} at ${fmt(e.step / 60, 2)} s with no warning`);
    else if (e.step - w.step < WARN_STEPS) out.push(`${where}: a ${k} ${e.name === 'hazard_hit' ? 'hit' : 'started'} ${e.step - w.step} steps after its warning (2 s is 120)`);
  }
  return out;
}

describe.runIf(late)(`late hazards on ${sut.kind} (${sut.engine})`, () => {
  it('F7.1 F7.8 each late stretch has its hazard at the table strength and rate, every hit warned 2 s ahead', () => {
    const seconds = FULL ? 300 : 120;
    const problems: string[] = [];
    const lines: string[] = [];
    for (const n of FULL ? [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] : [7, 10, 11, 13, 14, 16, 17, 19, 20, 22]) {
      const t = make(n);
      const ev: Ev[] = wall(t);
      for (let i = 0; i < seconds; i++) {
        t.step(60);
        ev.push(...hazardEvents(t.drainEvents() as Ev[]));
      }
      const where = `checkpoint ${n}`;
      problems.push(...warnedProblems(ev, where));
      const kinds = new Set(ev.filter((e) => e.payload.type !== 'gust').map((e) => e.payload.type as Kind));
      const want = expected(n);
      for (const k of want) if (!kinds.has(k)) problems.push(`${where}: no ${k} in ${seconds} s`);
      for (const k of kinds) if (!want.includes(k)) problems.push(`${where}: a ${k}, which belongs to another biome`);
      const starts = (k: Kind) => ev.filter((e) => e.name === 'hazard_start' && e.payload.type === k);
      let detail = '';
      if (CROSSWIND[n]) {
        const s = starts('crosswind')[0];
        if (s && Math.abs(s.payload.strength - CROSSWIND[n]) > 1e-9) problems.push(`${where}: crosswind ${s.payload.strength} g, table ${CROSSWIND[n]} g`);
        detail = `crosswind ${s ? s.payload.strength : '-'} g (table ${CROSSWIND[n]})`;
      }
      if (SWAY[n]) {
        const s = starts('sway')[0];
        if (s && Math.abs(s.payload.amplitude - SWAY[n]) > 1e-9) problems.push(`${where}: sway ±${s.payload.amplitude} g, table ±${SWAY[n]} g`);
        if (s && s.payload.period !== 8) problems.push(`${where}: sway period ${s.payload.period} s, table 8 s`);
        detail = `sway ±${s ? s.payload.amplitude : '-'} g over ${s ? s.payload.period : '-'} s (table ±${SWAY[n]})`;
      }
      for (const [k, every] of [['junk', JUNK[n]], ['meteor', METEOR[n]], ['dust', DUST[n]?.[1]]] as [Kind, number | undefined][]) {
        if (!every) continue;
        const gaps = intervals(ev, k);
        const m = mean(gaps);
        // "Every 18 s" read as the average from one warning to the next, as for gusts (±15% jitter).
        if (gaps.length < 3) problems.push(`${where}: only ${gaps.length + 1} ${k} warnings in ${seconds} s`);
        else if (Math.abs(m - every) > 0.15 * every) problems.push(`${where}: ${k} every ${fmt(m, 1)} s on average, the table says every ${every} s`);
        const hits = ev.filter((e) => e.name === 'hazard_hit' && e.payload.type === k).length;
        detail = `${k} every ${fmt(m, 1)} s (table ${every}; ${fmt(Math.min(...gaps), 1)} to ${fmt(Math.max(...gaps), 1)})${k === 'dust' ? '' : `, ${hits} hits`}`;
        if (k === 'dust') {
          const s = starts('dust')[0];
          if (s && Math.abs(s.payload.strength - DUST[n][0]) > 1e-9) problems.push(`${where}: dust devil ${s.payload.strength} g, table ${DUST[n][0]} g`);
          detail += `, ${s ? s.payload.strength : '-'} g (table ${DUST[n][0]})`;
        }
      }
      lines.push(`${where}: ${detail}`);
    }
    writeReport({ suite: 'late-schedule', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.slice(0, 16).map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F7.1 Deep Cosmos: each stretch runs two different hazards at top intensity × k', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const top: Record<string, number> = { gust: 0.15, crosswind: 0.1, dust: 0.25, sway: 0.14 };
    for (const n of FULL ? [23, 24, 25, 26, 28, 32, 42] : [23, 26, 42]) {
      for (const seed of FULL ? [1, 2, 3, 4] : [1, 2]) {
        const t = make(n, {}, 400 + 10 * n + seed);
        const ev: Ev[] = wall(t);
        for (let i = 0; i < (FULL ? 120 : 60); i++) {
          t.step(60);
          ev.push(...hazardEvents(t.drainEvents() as Ev[]));
        }
        const remix: Kind[] = (t.sim as Record<string, any>).stretch?.remix ?? [];
        const k = cosmosK(n);
        const where = `checkpoint ${n} seed ${seed}`;
        if (remix.length !== 2 || remix[0] === remix[1]) problems.push(`${where}: remix ${JSON.stringify(remix)}, expected two different hazards`);
        problems.push(...warnedProblems(ev, where));
        const seen = new Set(ev.filter((e) => e.name === 'hazard_start' || e.name === 'hazard_hit').map((e) => e.payload.type as Kind));
        for (const h of remix) if (h !== 'sway' && !seen.has(h)) problems.push(`${where}: ${h} picked but never came in 60 s`);
        for (const h of seen) if (!remix.includes(h) && h !== 'sway') problems.push(`${where}: a ${h}, not in the remix ${remix.join('+')}`);
        for (const e of ev.filter((x) => x.name === 'hazard_start')) {
          const h = e.payload.type as Kind;
          const want = top[h] ? top[h] * k : null;
          const got = h === 'sway' ? e.payload.amplitude : e.payload.strength;
          if (h === 'sway' && !remix.includes('sway')) {
            if (Math.abs(got - 0.1) > 1e-9 || e.payload.period !== 24) problems.push(`${where}: the background drift is ±${got} g over ${e.payload.period} s, the doc says ±0.1 g over 24 s`);
          } else if (want !== null && got !== undefined && Math.abs(got - want) > 1e-9) problems.push(`${where}: ${h} at ${fmt(got, 4)}, top × k is ${fmt(want, 4)}`);
        }
        lines.push(`${where}: ${remix.join(' + ')} (k ${fmt(k, 2)}), ${ev.filter((e) => e.name === 'hazard_start' || e.name === 'hazard_hit').length} starts and hits in ${FULL ? 120 : 60} s`);
      }
    }
    writeReport({ suite: 'late-cosmos', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.slice(0, 16).map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F7.8 a late hazard met for the first time ever runs at half strength with a card; never two brand-new ones at once', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    // Junk: the first hit of a new player is half the impulse of the later ones; a player who has met
    // junk gets full strength from the first.
    for (const seen of [[], ['junk']]) {
      const t = make(11, { seenHazards: seen }, 511);
      const ev: Ev[] = wall(t);
      for (let i = 0; i < 100; i++) {
        t.step(60);
        ev.push(...hazardEvents(t.drainEvents() as Ev[]));
      }
      const warns = ev.filter((e) => e.name === 'hazard_warning' && e.payload.type === 'junk');
      const hits = ev.filter((e) => e.name === 'hazard_hit' && e.payload.type === 'junk');
      const who = seen.length ? 'a player who has met junk' : 'a new player';
      if (hits.length < 3) { problems.push(`${who}: only ${hits.length} junk hits`); continue; }
      const full = Math.max(...hits.map((h) => h.payload.impulse));
      const firstIntro = !!warns[0]?.payload.intro;
      if (firstIntro !== !seen.length) problems.push(`${who}: the first junk warning has intro ${firstIntro}`);
      if (warns.slice(1).some((w) => w.payload.intro)) problems.push(`${who}: a later junk warning is marked intro`);
      const want = seen.length ? full : full / 2;
      if (Math.abs(hits[0].payload.impulse - want) > 1e-9) problems.push(`${who}: first junk hit ${hits[0].payload.impulse}, expected ${want}`);
      lines.push(`${who}: first junk hit ${fmt(hits[0].payload.impulse, 2)}, later hits ${fmt(full, 2)}, first warning intro ${firstIntro}`);
    }
    // Never two brand-new hazards at once, on the path a player actually takes: arriving at each biome
    // having met everything before it, only that biome's hazard is new (none in Deep Cosmos).
    const introduced: [number, string | null][] = [[7, 'crosswind'], [11, 'junk'], [14, 'meteor'], [17, 'dust'], [20, 'sway'], [23, null]];
    for (const [n, fresh] of introduced) {
      const seen = LATE.filter((h) => introduced.some(([m, k]) => k === h && m < n));
      const t = make(n, { seenHazards: seen, hazardIntro: false }, 600 + n);
      const ev: Ev[] = wall(t);
      for (let i = 0; i < 60; i++) {
        t.step(60);
        ev.push(...hazardEvents(t.drainEvents() as Ev[]));
      }
      const intros = [...new Set(ev.filter((e) => e.name === 'hazard_warning' && e.payload.intro).map((e) => e.payload.type as string))];
      if (intros.length > 1 || (intros[0] ?? null) !== fresh) problems.push(`arriving at CP ${n} having met ${seen.join(', ') || 'only gusts'}: new hazards ${intros.join(', ') || 'none'}, expected ${fresh ?? 'none'}`);
      lines.push(`arriving at CP ${n} having met ${seen.join(', ') || 'only gusts'}: brand-new ${intros.join(', ') || 'none'}`);
    }
    // Only a test can drop a new player straight into Deep Cosmos; reported, not judged.
    let overlaps = 0;
    for (const seed of [1, 2, 3, 4]) {
      const t = make(23, { seenHazards: [], hazardIntro: true }, 600 + seed);
      const ev: Ev[] = wall(t);
      for (let i = 0; i < 60; i++) {
        t.step(60);
        ev.push(...hazardEvents(t.drainEvents() as Ev[]));
      }
      const kinds = new Set(ev.filter((e) => e.name === 'hazard_warning' && e.payload.intro).map((e) => e.payload.type));
      if (kinds.size > 1) overlaps++;
    }
    lines.push(`(not judged) a brand-new player dropped straight into Deep Cosmos, which only a test can do, met two or more new hazards at once in ${overlaps} of 4 seeds`);
    writeReport({ suite: 'late-intro', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.slice(0, 12).map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F7.8 Q25 F7.1 over bot runs from Storm Belt on: nothing starts in a hold or the claim pause, hits never land on stone or the steered shape, hearts come back every third claim from Orbit', () => {
    const { api, shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    const totals = { warnings: 0, starts: 0, hits: 0, cracks: 0, claims: 0, holds: 0 };
    const restored: string[] = [];
    for (const [from, seed] of (FULL ? [[7, 1], [9, 2], [11, 3], [13, 4], [16, 5], [19, 6], [22, 7], [23, 8]] : [[9, 1], [12, 2], [18, 3]]) as [number, number][]) {
      const sim = own(new api.Sim({ seed, startCheckpoint: from, tuning: { mortar: true, infiniteHearts: true, infiniteBudget: true, seenHazards: LATE, hazardIntro: false }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const bad = (m: string) => problems.length < 24 && problems.push(`from CP ${from} seed ${seed} at ${(sim.stepIndex / 60).toFixed(1)} s: ${m}`);
      let claimAt = -Infinity;
      while (sim.stepIndex < 60 * (FULL ? 420 : 200) && sim.state === 'playing') {
        // Hearts held at 1 (they never fall with infiniteHearts), so each claim shows what it gives back.
        sim.hearts = 1;
        const holdBefore = sim.holdState().active;
        const stoneWelds = stoneToStone(sim);
        const views = new Map((sim.pieceViews() as { id: number; state: string }[]).map((v) => [v.id, v]));
        bot.tick(sim);
        sim.step();
        const holdAfter = sim.holdState().active;
        if (!holdBefore && holdAfter) totals.holds++;
        const ev = sim.drainEvents() as Ev[];
        for (const e of ev) {
          if (e.name === 'checkpoint_claimed') {
            claimAt = sim.stepIndex;
            totals.claims++;
            const n = e.payload.n as number;
            const want = n >= 11 ? ((n - 11 + 1) % 3 === 0 ? 2 : 1) : n === lastCp(n) ? 3 : 2;
            if (sim.hearts !== want) bad(`claiming CP ${n} left ${sim.hearts} hearts from 1, expected ${want}`);
            restored.push(`${n}:${sim.hearts - 1}`);
          }
          if (!e.name.startsWith('hazard_') && !(e.name === 'bond_broken' && e.payload.by)) continue;
          if (e.payload?.type === 'gust') continue;
          if (e.name === 'hazard_warning') {
            totals.warnings++;
            if (holdBefore && holdAfter) bad(`a ${e.payload.type} was warned during a hold`);
          }
          if (e.name === 'hazard_start') {
            totals.starts++;
            if (holdBefore && holdAfter) bad(`a ${e.payload.type} started during a hold`);
            if (sim.stepIndex - claimAt < 90 && !['crosswind', 'sway'].includes(e.payload.type)) bad(`a ${e.payload.type} started ${sim.stepIndex - claimAt} steps after a claim (the claim pause is 90)`);
          }
          if (e.name === 'hazard_hit') {
            totals.hits++;
            if (holdBefore && holdAfter) bad(`a ${e.payload.type} hit during a hold`);
            const v = views.get(e.payload.pieceId);
            if (v?.state === 'controlled') bad(`a ${e.payload.type} hit the steered shape`);
            else if (v?.state === 'stone') bad(`a ${e.payload.type} hit stone (piece ${e.payload.pieceId})`);
            else if (v?.state === 'lost') bad(`a ${e.payload.type} hit a lost piece`);
          }
          if (e.name === 'bond_broken') totals.cracks++;
        }
        // A crack breaks every bond of the piece hit, including one to stone below it; a bond between
        // two stone pieces must never go.
        if (ev.some((e) => e.name === 'bond_broken' && e.payload.by)) {
          const after = stoneToStone(sim);
          for (const k of stoneWelds) if (!after.has(k)) bad(`${e2s(ev)} broke the bond between stone pieces ${k}`);
        }
      }
      lines.push(`from CP ${from} seed ${seed}: ${(sim.stepIndex / 60).toFixed(0)} s, reached CP ${sim.checkpoint}, ended by ${sim.cause || 'the time cap'}`);
    }
    lines.push(`totals: ${totals.warnings} late-hazard warnings, ${totals.starts} starts, ${totals.hits} hits, ${totals.cracks} bonds cracked, ${totals.holds} holds, ${totals.claims} claims`);
    lines.push(`hearts given back per claim (CP:hearts): ${restored.join(' ')}`);
    if (!totals.hits) problems.push('setup: the bots met no hits');
    if (!restored.some((r) => +r.split(':')[0] >= 11)) problems.push('setup: no claim at or past CP 11');
    writeReport({ suite: 'late-runs', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], totals);
    expect(problems).toEqual([]);
  });

  it('F3.6 P20 runs with late hazards replay exactly, in this process and a fresh one; late hazards never move gusts or the shape bag', () => {
    const { api, shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    const records = ((FULL ? [7, 11, 14, 17, 20, 23, 27] : [11, 17, 23]) as number[]).map((from, i) => {
      const seed = 700 + i;
      const tuning = { mortar: i % 2 === 0, seenHazards: i % 3 === 0 ? [] : LATE };
      const sim = own(new api.Sim({ seed, tuning, startCheckpoint: from, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const digests: string[] = [];
      let hits = 0;
      while (sim.stepIndex < 60 * (FULL ? 240 : 120) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        hits += (sim.drainEvents() as Ev[]).filter((e) => e.name === 'hazard_hit' || e.name === 'hazard_start').length;
        if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
      }
      const end = { cause: sim.cause, score: Math.round(sim.score), powers: sim.stats.powers, wind: sim.secondWind, slots: sim.slots?.join() };
      return { seed, tuning, startCheckpoint: from, rookieOpening: false, inputs: sim.inputLog.map((x: any) => ({ s: x.s, i: { ...x.i } })), steps: sim.stepIndex, digests, finalDigest: sim.digest(), end, hits };
    });
    for (const r of records) {
      const { digests, sim } = api.replay(r);
      const first = r.digests.findIndex((d: string, i: number) => d !== digests[i]);
      const same = first === -1 && sim.digest() === r.finalDigest;
      lines.push(`from CP ${r.startCheckpoint} (seed ${r.seed}): ${(r.steps / 60).toFixed(0)} s, ${r.hits} hazard starts and hits; replay ${same ? 'MATCH' : `MISMATCH from second ${first + 1}`}`);
      if (!same) problems.push(`from CP ${r.startCheckpoint}: in-process replay differs`);
      if (!r.hits) problems.push(`setup: from CP ${r.startCheckpoint} met no hazards`);
      sim.dispose();
    }
    const dir = resolve(REPO_ROOT, 'qa/scratch');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `late-replays-${sut.engine}.json`);
    writeFileSync(file, JSON.stringify(records));
    const child = spawnSync('npx', ['tsx', 'scripts/replay-child.ts', file], { cwd: resolve(REPO_ROOT, 'qa'), encoding: 'utf8', env: process.env });
    let fresh: { seed: number; same: boolean }[] = [];
    try { fresh = JSON.parse(child.stdout.trim().split('\n').pop() ?? '[]'); } catch { problems.push(`fresh process failed: ${child.stderr.slice(0, 300)}`); }
    for (const f of fresh) if (!f.same) problems.push(`seed ${f.seed}: replay in a fresh process differs`);
    lines.push(`fresh process: ${fresh.filter((f) => f.same).length} of ${records.length} match`);

    // The late stream: with late hazards on and off, the same seed from CP 7 warns the same gusts and
    // deals the same shapes while both runs are in the first stretch.
    const run = (on: boolean) => {
      const sim = own(new api.Sim({ seed: 9, startCheckpoint: 7, tuning: { lateHazards: on, mortar: true, infiniteHearts: true }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed: 9, naturalFall: 0.3 }, shapes.extents);
      const gusts: number[] = [];
      const bag: string[] = [];
      let last: unknown = null;
      let late = 0;
      while (sim.stepIndex < 60 * 200 && sim.state === 'playing' && sim.checkpoint === 7) {
        bot.tick(sim);
        sim.step();
        if (sim.ctrl && sim.ctrl !== last) { last = sim.ctrl; bag.push(sim.ctrl.shape); }
        for (const e of sim.drainEvents() as Ev[]) {
          if (e.name === 'hazard_warning' && e.payload.type === 'gust') gusts.push(sim.stepIndex);
          if (e.name === 'hazard_start' && e.payload.type === 'crosswind') late++;
        }
      }
      return { gusts, bag: bag.join(''), late, steps: sim.stepIndex };
    };
    const on = run(true), off = run(false);
    const g = Math.min(on.gusts.length, off.gusts.length), b = Math.min(on.bag.length, off.bag.length);
    if (on.gusts.slice(0, g).join() !== off.gusts.slice(0, g).join()) problems.push('late hazards moved the gust warnings');
    if (on.bag.slice(0, b) !== off.bag.slice(0, b)) problems.push('late hazards changed the shape bag');
    if (!on.late || off.late) problems.push(`setup: crosswind ${on.late} times with late hazards on, ${off.late} with them off`);
    if (g < 2 || b < 20) problems.push(`setup: only ${g} gusts and ${b} shapes to compare`);
    lines.push(`late hazards on vs off from CP 7: the first ${g} gust warnings and ${b} shapes are the same`);
    writeReport({ suite: 'late-replays', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});

/** Bonds whose two pieces are both stone, as "a-b" (the sim's private weld list, read for the test). */
function stoneToStone(sim: Record<string, any>): Set<string> {
  const stone = new Set((sim.pieceViews() as { id: number; state: string }[]).filter((v) => v.state === 'stone').map((v) => v.id));
  const out = new Set<string>();
  for (const w of (sim.welds as Map<number, { a: number; b: number }>).values()) if (stone.has(w.a) && stone.has(w.b)) out.add(`${w.a}-${w.b}`);
  return out;
}

function e2s(ev: Ev[]): string {
  const by = ev.find((e) => e.name === 'bond_broken' && e.payload.by)?.payload.by;
  return `a ${by ?? 'hazard'} crack`;
}
