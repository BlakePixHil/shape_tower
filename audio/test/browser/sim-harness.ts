// End-to-end: Gameplay's real headless sim, played by a simple bot, feeds its
// JuiceBus events to the AudioDirector, and the mix is rendered offline.
// Bundled only when the game's sim is next to this folder (../game/src/sim).

// @ts-ignore: resolved by the test bundler from ../game/src
import { createSim } from '@game/sim/testApi.ts';
import { AudioDirector } from '../../src/director';
import { FULL_CAPS, FULL_GLOBAL_CAP } from '../../src/voices';
import { mulberry32 } from '../../src/synth/dsp';

const SR = 48000;

(window as any).simScenario = async (seconds = 75, seed = 7) => {
  const T0 = performance.now();
  const ctx = new OfflineAudioContext(2, SR * (seconds + 4), SR);
  const d = new AudioDirector({ context: ctx, haptics: false, storage: null, seed: 1, lowEnd: false });
  await d.ready;
  await d.music.prewarm();
  const ms = { setup: performance.now() - T0, warm: 0, loop: 0, render: 0 };
  const T1 = performance.now();
  const played: Record<string, number> = {};
  const target = d as unknown as { play: (name: string, ...rest: unknown[]) => unknown };
  const play = target.play.bind(d);
  target.play = (name, ...rest) => {
    if (name.startsWith('impact.')) played[name.split('.')[1]] = (played[name.split('.')[1]] ?? 0) + 1;
    return play(name, ...rest);
  };
  const rng = mulberry32(seed);
  const counts: Record<string, number> = {};
  const plan = new Map<number, Record<string, unknown>[]>();
  const later = (step: number, i: Record<string, unknown>) => plan.set(step, [...(plan.get(step) ?? []), i]);
  let foundationX = 0, worst = 0, total = 0, handled = 0;
  // A shape steering out to a bubble beside the foundation, and the column it goes back to.
  let chase: { id: number; aim: number } | null = null;
  const peak: Record<string, number> = {};
  let maxVoices = 0;
  let memoryMB = 0;
  const musicRuns = new Set<string>();
  const mixLog: string[] = [];
  const runs: { from: number; hits: number; overAt: number | null }[] = [];
  // Like the game's view: a new sim for every run, connected after its constructor has emitted
  // run_start, and a few seconds of results between runs.
  const newRun = (from: number) => {
    // every other run starts with Second Wind ready, so the bot can use it
    const sim = createSim({ autoSpawn: true, seed: seed + runs.length, secondWind: runs.length % 2 ? 'ready' : 'earn' });
    sim.drainEvents();
    plan.clear();
    chase = null;
    runs.push({ from, hits: 0, overAt: null });
    return sim;
  };
  const steps = seconds * 60;
  let t = newRun(0);
  // Like the game, events reach the director as the audio clock gets to them: the render stops
  // every second while the sim plays that second. (Scheduling the whole run up front would keep
  // every node in the graph from the start, and the render would crawl.)
  let step = 0;
  const advance = async (until: number) => {
    for (; step < Math.min(until, steps); step++) {
      const run = runs[runs.length - 1];
      const local = step - run.from;
      if (run.overAt !== null) {
        if (step - run.overAt >= 4 * 60 && steps - step > 20 * 60) {
          t.dispose();
          t = newRun(step);
        }
        continue;
      }
      for (const i of plan.get(local) ?? []) t.intent(i);
      plan.delete(local);
      if (chase) {
        // Once the shape is past the bubble (or it's gone), back over the foundation and drop.
        const s = (t as any).sim;
        const b = s.bubble;
        if (!s.ctrl) chase = null;
        else if (!b || b.id !== chase.id || s.ctrl.y < b.y - 1) {
          t.intent({ type: 'moveTo', x: chase.aim });
          later(local + 15, { type: 'hardDrop' });
          chase = null;
        }
      }
      t.step();
      for (const e of t.drainEvents()) {
        counts[e.name] = (counts[e.name] ?? 0) + 1;
        if (e.name === 'signals') foundationX = Number(e.payload.foundationX) || 0;
        if (e.name === 'contact_hit') run.hits++;
        if (e.name === 'run_over') run.overAt = step;
        // the bot uses each power-up a moment after it gets it, and Second Wind on its last heart
        if (e.name === 'power_collected' || e.name === 'power_granted') later(local + 40, { type: 'power', slot: e.payload.slot });
        if (e.name === 'last_heart') later(local + 20, { type: 'secondWind' });
        if (e.name === 'piece_spawned') {
          // the bot: aim near the middle of the foundation, sometimes rotate, then drop
          const x = Math.round((foundationX + (rng() * 2 - 1) * 2.5) * 2) / 2;
          // Bubbles sit beside the foundation, so half the time it steers out through one first.
          const s = (t as any).sim;
          const b = s.bubble;
          if (b && s.slots.includes(null) && rng() < 0.5) {
            chase = { id: b.id, aim: x };
            later(local + 6, { type: 'moveTo', x: b.x });
          } else {
            later(local + 6, { type: 'moveTo', x });
            later(local + 20 + Math.floor(rng() * 20), { type: 'hardDrop' });
          }
          if (rng() < 0.5) later(local + 10, { type: 'rotate', dir: rng() < 0.5 ? 1 : -1 });
        }
        const c0 = performance.now();
        const before = d.mixer.state().base;
        d.handle(e.name, e.payload, 0.05 + (run.from + e.step) / 60);
        const after = d.mixer.state().base;
        if (before !== after) mixLog.push(`${run.from + e.step}:${e.name}:${before}->${after}`);
        const dt = performance.now() - c0;
        worst = Math.max(worst, dt);
        total += dt;
        handled++;
        for (const [k, v] of Object.entries(d.voices.counts())) peak[k] = Math.max(peak[k] ?? 0, v);
        maxVoices = Math.max(maxVoices, d.voices.count());
        if (d.music.mode === 'run') musicRuns.add(String(runs.length));
        // in the game, the next band and the results loop bake in the seconds after these;
        // offline no time passes between events, so give the baker its turn here
        if (e.name === 'checkpoint_claimed' || e.name === 'run_over') {
          const w0 = performance.now();
          await d.music.prewarm();
          ms.warm += performance.now() - w0;
          memoryMB = Math.max(memoryMB, Math.round(d.bank.bytes() / 1e5) / 10);
        }
      }
    }
  };
  let failure: unknown = null;
  const timed = async (until: number) => {
    const c0 = performance.now();
    await advance(until).catch((e) => { failure ??= e; });
    ms.loop += performance.now() - c0;
  };
  await timed(60);
  for (let k = 1; k * 60 < steps; k++) {
    ctx.suspend(k).then(() => timed((k + 1) * 60)).finally(() => ctx.resume());
  }
  const buf = await ctx.startRendering();
  t.dispose();
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
  return {
    counts, peak: pk, nonFinite, nearClip, rms: Math.sqrt(sum / (2 * a.length)),
    voices: { peak, total: maxVoices, limits: { ...FULL_CAPS, total: FULL_GLOBAL_CAP } },
    cpu: { meanMs: total / Math.max(1, handled), worstMs: worst, events: handled },
    state: d.debugState(),
    mixLog,
    runs,
    played,
    music: d.music.state(),
    musicRuns: musicRuns.size,
    memoryMB,
    ms,
  };
};
