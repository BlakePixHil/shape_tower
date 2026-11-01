// End-to-end for Blockling Pop: Gameplay's real Pop sim (game/src/pop/sim), played by a bot that is
// greedy most of the time and careless the rest, sends its events through the same mapping the Pop
// view uses (game/src/pop/view/popview.ts) to the AudioDirector, and the mix is rendered offline.
// Bundled only when the Pop sim is next to this folder; it needs no packages.

// @ts-ignore: resolved by the test bundler from ../game/src/pop
import { PopSim, BAG } from '@pop/sim/pop.ts';
// @ts-ignore: resolved by the test bundler from ../game/src/pop
import { greedyMove, legalMoves } from '@pop/sim/bot.ts';
import { AudioDirector } from '../../src/director';
import { FULL_CAPS, FULL_GLOBAL_CAP } from '../../src/voices';
import { mulberry32 } from '../../src/synth/dsp';

const SR = 48000;
const CELLS = 81;

interface Move { slot: number; x: number; y: number }

(window as any).popSimScenario = async (seconds = 150, seed = 5) => {
  const T0 = performance.now();
  const ctx = new OfflineAudioContext(2, SR * (seconds + 4), SR);
  const d = new AudioDirector({ context: ctx, haptics: false, storage: null, seed: 1, lowEnd: false });
  await d.ready;
  d.setMode('pop', 0);
  await d.bank.prepareMode('pop');
  const ms = { setup: performance.now() - T0, warm: 0, loop: 0, render: 0 };
  const T1 = performance.now();
  const rng = mulberry32(seed);
  const counts: Record<string, number> = {};
  const peak: Record<string, number> = {};
  let maxVoices = 0, memoryMB = 0, worst = 0, total = 0, handled = 0;
  const cost: Record<string, { n: number; ms: number; worst: number }> = {};
  const runs: { from: number; moves: number; lines: number; cp: number; clears: number; cause: string | null }[] = [];

  // what the director hears, in time order
  const queue: { t: number; name: string; payload: Record<string, unknown> }[] = [];
  const send = (t: number, name: string, payload: Record<string, unknown> = {}) => queue.push({ t, name, payload });

  let sim: PopSim | null = null;
  let seenTray = 0;
  let fitsWas = [true, true, true, true];
  let next = 0.2; // when the bot's next move starts
  let overAt = -1;
  /** powers the bot used, by kind */
  const powers: Record<string, number> = {};

  const startRun = (t: number) => {
    // a level 6 player: a head-start power, and Second Wind ready in every other run (milestone 3 sims)
    sim = new PopSim({ seed: seed * 1000 + runs.length, newPlayer: false, headStart: true, windReady: runs.length % 2 === 1 } as ConstructorParameters<typeof PopSim>[0]);
    seenTray = sim.trays;
    fitsWas = [true, true, true, true];
    runs.push({ from: t, moves: 0, lines: 0, cp: 0, clears: 0, cause: null });
    // like the game's openPop: silence, Pop mode, then the run
    send(t, 'screen:none');
    send(t, 'pop_run_start', { biome: sim.biome + 1, cp: sim.cp, fill: sim.filled / CELLS });
    let at = t;
    sim.sink = {
      emit: (name: string, p: Record<string, unknown>) => {
        const run = runs[runs.length - 1];
        switch (name) {
          case 'pop_placed':
            send(at, 'pop_place', { shape: p.shape, cells: (p.cells as number[]).length, combo: sim!.combo });
            break;
          case 'pop_lines': {
            const n = p.count as number;
            run.lines += n;
            send(at, 'pop_lines', { count: n, combo: p.combo, cells: (p.cells as number[]).length, lines: (p.order as number[][]).map((l) => l.length), hitstop: n >= 3 ? 80 : n === 2 ? 60 : 40 });
            break;
          }
          case 'pop_combo': case 'pop_combo_end':
            send(at, name, { combo: p.combo });
            break;
          case 'pop_all_clear':
            run.clears++;
            send(at, 'pop_all_clear');
            break;
          case 'pop_checkpoint':
            run.cp = p.n as number;
            send(at, 'pop_checkpoint', { n: p.n });
            break;
          case 'biome_entered':
            send(at, 'biome_entered', { id: (p.id as number) + 1 });
            break;
          case 'pop_tray':
            if ((p.n as number) > seenTray) { seenTray = p.n as number; send(at, 'pop_tray', { n: p.n }); }
            break;
          case 'pop_bag':
            send(at, 'pop_bag');
            break;
          case 'pop_no_room':
            send(at, 'pop_no_room', { waiting: p.waiting });
            break;
          // milestone 3 (rules 2): bubbles, powers and Second Wind, as the view sends them
          case 'pop_bubble':
            send(at, 'pop_bubble', { kind: p.kind, why: p.why });
            break;
          case 'pop_bubble_got':
            send(at, 'pop_bubble_got', { kind: p.kind });
            break;
          case 'pop_bubble_gone':
            send(at, 'pop_bubble_gone');
            break;
          case 'pop_power_got':
            if (p.why !== 'head') send(at, 'pop_power_got', { kind: p.kind, why: p.why });
            break;
          case 'pop_power': {
            const cells = Array.isArray(p.cells) ? p.cells.length : undefined;
            send(at, 'pop_power', cells === undefined ? { kind: p.kind } : { kind: p.kind, cells });
            // the meteor lands at the end of its 260 ms streak
            if (p.kind === 'meteor') send(at + 0.26, 'pop_meteor_hit', { cells });
            powers[p.kind as string] = (powers[p.kind as string] ?? 0) + 1;
            break;
          }
          case 'pop_spin':
            send(at, 'pop_spin', { slot: p.slot });
            break;
          case 'pop_wind_ready':
            send(at, 'pop_wind_ready', { why: p.why });
            break;
          case 'pop_second_wind':
            send(at, 'pop_second_wind', { cells: (p.cells as number[]).length });
            powers.wind = (powers.wind ?? 0) + 1;
            break;
          // rules 3: touching split pieces merge; with effects on the view stamps them 360 ms later
          case 'pop_merge': {
            const merges = (p.merges ?? []) as { cells: number[] }[];
            if (merges.length) send(at, 'pop_merge', { count: merges.length, cells: merges.reduce((a, m) => a + m.cells.length, 0), delay: 360 });
            break;
          }
          case 'run_over':
            run.cause = p.cause as string;
            // with effects on, the run over plays as the tumble starts
            send(at + (p.cause === 'noroom' ? 0.6 : 0), 'pop_run_over', { cause: p.cause });
            overAt = at + 0.6;
            break;
        }
      },
    };
    // the sink reads `at` for the move being applied
    return (t2: number) => (at = t2);
  };
  let setAt = startRun(0.1);

  /** Uses Second Wind or a held power (milestone 3 sims), aiming Sweep and Meteor at the first target that takes. */
  const usePower = (s: PopSim, t: number): boolean => {
    const S = s as unknown as { powers?: (string | null)[]; wind?: string; canPower?(i: number): boolean; canSpin?(i: number): boolean };
    if (!S.powers) return false;
    setAt(t + 0.5);
    if (S.wind === 'ready' && !legalMoves(s).length) {
      send(t, 'pop_wind_armed');
      if (s.apply({ t: 'wind' })) return true;
    }
    for (let i = 0; i < 2; i++) {
      const kind = S.powers[i];
      if (!kind || !S.canPower?.(i)) continue;
      if (kind === 'sweep' || kind === 'meteor') {
        send(t, 'pop_aim', { kind });
        for (let k = 0; k < 3; k++) send(t + 0.1 + k * 0.1, 'pop_aim_move');
        const n = kind === 'sweep' ? 27 : CELLS;
        for (let a = 0; a < n; a++) if (s.apply({ t: 'power', slot: i, arg: a })) return true;
        send(t + 0.45, 'pop_aim_cancel');
        continue;
      }
      if (s.apply({ t: 'power', slot: i })) {
        // Spin on: turn a tray shape twice
        if (kind === 'spin') for (let k = 0; k < 2; k++) { setAt(t + 0.7 + k * 0.25); if (S.canSpin?.(0)) s.apply({ t: 'spin', slot: 0 }); }
        return true;
      }
    }
    return false;
  };

  /** Plays the bot up to audio time `until`, queueing what the view would send. */
  const plan = (until: number) => {
    while (next < until) {
      const t = next;
      if (!sim || sim.over) {
        if (overAt >= 0 && t >= overAt + 5.5) {
          setAt = startRun(t);
          overAt = -1;
          next = t + 0.8;
        } else next = t + 0.5;
        continue;
      }
      const s: PopSim = sim;
      const run = runs[runs.length - 1];
      // now and then a shape goes to the bag instead
      if (rng() < 0.07 && s.canBag(0)) {
        setAt(t);
        s.apply({ t: 'bag', slot: 0 });
        next = t + 0.6;
        continue;
      }
      const all: Move[] = legalMoves(s);
      // stuck (the run waits for a power or End run), or now and then anyway: a power
      if (!all.length || (rng() < 0.12 && usePower(s, t))) {
        if (!all.length && !usePower(s, t)) {
          setAt(t);
          s.apply({ t: 'end' });
        }
        next = t + 1.2;
        continue;
      }
      // careful for the first minute and a half (a long climb), careless after it (a run over and a new run)
      const mv: Move | null = rng() < (t < 85 ? 0.85 : 0.3) ? greedyMove(s) : all[Math.floor(rng() * all.length)];
      if (!mv) { next = t + 0.5; continue; }
      const sl = s.slot(mv.slot);
      send(t, 'pop_pickup', { shape: sl?.s ?? 0 });
      // the drag: the ghost snaps a few cells, the would-pop shimmer on the last one
      const lines = s.wouldPop(mv.slot, mv.x, mv.y).length;
      const steps = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < steps; k++) send(t + 0.12 + k * 0.09, 'pop_ghost', { lines: k === steps - 1 ? lines : 0 });
      if (lines) send(t + 0.12 + (steps - 1) * 0.09, 'pop_would_pop', { count: lines });
      const drop = t + 0.2 + steps * 0.09 + rng() * 0.2;
      // a careless drop off the board, now and then
      if (rng() < 0.05) {
        send(drop, 'pop_drop_back');
        next = drop + 0.4;
        continue;
      }
      setAt(drop);
      s.apply({ t: 'place', slot: mv.slot, x: mv.x, y: mv.y });
      run.moves++;
      if (lines) send(drop, 'pop_would_pop', { count: 0 });
      send(drop, 'pop_fill', { fill: s.filled / CELLS });
      for (let i = 0; i <= BAG; i++) {
        const fits = !s.slot(i) || s.fitsAnywhere(i);
        if (!fits && fitsWas[i] && !s.over) send(drop, 'pop_cant_fit', { slot: i });
        fitsWas[i] = fits;
      }
      next = drop + 0.5 + rng() * 0.9;
    }
  };

  let failure: unknown = null;
  let done = 0;
  const advance = async (until: number) => {
    plan(until + 2);
    queue.sort((a, b) => a.t - b.t);
    // events and the director's ticks in time order, ten ticks a second like a slow phone
    for (; done < Math.round(until * 10); done++) {
      const tick = done / 10;
      await handleUntil(tick);
      d.tick(tick);
    }
  };
  const handleUntil = async (until: number) => {
    while (queue.length && queue[0].t <= until) {
      const e = queue.shift()!;
      const c0 = performance.now();
      if (e.name === 'screen:none') d.screen('none', e.t);
      else d.handle(e.name, e.payload, e.t);
      const dt = performance.now() - c0;
      worst = Math.max(worst, dt);
      total += dt;
      cost[e.name] = cost[e.name] ?? { n: 0, ms: 0, worst: 0 };
      cost[e.name].n++;
      cost[e.name].ms += dt;
      cost[e.name].worst = Math.max(cost[e.name].worst, dt);
      handled++;
      counts[e.name] = (counts[e.name] ?? 0) + 1;
      for (const [k, v] of Object.entries(d.voices.counts())) peak[k] = Math.max(peak[k] ?? 0, v);
      maxVoices = Math.max(maxVoices, d.voices.count());
      // in the game, the next band and the results loop bake in the seconds after these;
      // offline no time passes between events, so give the baker its turn here
      if (e.name === 'pop_run_start' || e.name === 'pop_checkpoint' || e.name === 'pop_run_over') {
        const w0 = performance.now();
        await d.music.prewarm();
        ms.warm += performance.now() - w0;
        memoryMB = Math.max(memoryMB, Math.round(d.bank.bytes() / 1e5) / 10);
      }
    }
  };
  const timed = async (until: number) => {
    const c0 = performance.now();
    await advance(until).catch((e) => { failure ??= e; });
    ms.loop += performance.now() - c0;
  };
  await timed(1);
  for (let k = 1; k < seconds; k++) {
    ctx.suspend(k).then(() => timed(k + 1)).finally(() => ctx.resume());
  }
  const buf = await ctx.startRendering();
  if (failure) throw failure;
  ms.loop -= ms.warm;
  ms.render = performance.now() - T1 - ms.loop - ms.warm;
  const a = buf.getChannelData(0), b = buf.getChannelData(1);
  let pk = 0, nonFinite = 0, nearClip = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    for (const x of [a[i], b[i]]) {
      if (!Number.isFinite(x)) { nonFinite++; continue; }
      const v = Math.abs(x);
      pk = Math.max(pk, v);
      if (v >= 0.99) nearClip++;
      sum += x * x;
    }
  }
  const log = d.music.log.map((e) => e.what);
  return {
    counts, peak: pk, nonFinite, nearClip, rms: Math.sqrt(sum / (2 * a.length)),
    voices: { peak, total: maxVoices, limits: { ...FULL_CAPS, total: FULL_GLOBAL_CAP } },
    cpu: { meanMs: total / Math.max(1, handled), worstMs: worst, events: handled, cost },
    // runs the render reached (the bot plans a little ahead)
    runs: runs.filter((r) => r.from < seconds),
    music: d.music.state(),
    layers: [...new Set(log.filter((w) => w.endsWith(' on')).map((w) => w.slice(0, -3)))],
    bands: log.filter((w) => w.startsWith('band ')).map((w) => w.slice(5)),
    starts: log.filter((w) => w === 'pop start').length,
    powers,
    niceTries: log.filter((w) => w === 'nice try').length,
    memoryMB,
    mode: d.mode,
    ms,
  };
};
