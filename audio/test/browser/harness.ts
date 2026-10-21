// Runs inside headless Chromium. Each scenario drives a real AudioDirector on an
// OfflineAudioContext, renders the result and returns numbers for the runner to check.

import { AudioDirector } from '../../src/director';
import { FULL_CAPS, FULL_GLOBAL_CAP } from '../../src/voices';
import { JUICE_EVENTS, type Material } from '../../src/types';
import { mulberry32 } from '../../src/synth/dsp';

const SR = 48000;

interface Stats {
  peak: number;
  nonFinite: number;
  nearClip: number;
  rms: number;
  /** peak level (dBFS) per 0.5 s window */
  windows: number[];
  lrDiff: number;
}

function analyse(buf: AudioBuffer, from = 0, to = buf.duration): Stats {
  const a = buf.getChannelData(0), b = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
  const i0 = Math.floor(from * buf.sampleRate), i1 = Math.min(a.length, Math.floor(to * buf.sampleRate));
  let peak = 0, nonFinite = 0, nearClip = 0, sum = 0, lrDiff = 0;
  const win = Math.floor(buf.sampleRate / 2);
  const windows: number[] = [];
  let wPeak = 0;
  for (let i = i0; i < i1; i++) {
    for (const x of [a[i], b[i]]) {
      if (!Number.isFinite(x)) { nonFinite++; continue; }
      const v = Math.abs(x);
      if (v > peak) peak = v;
      if (v > wPeak) wPeak = v;
      if (v >= 0.99) nearClip++;
      sum += x * x;
    }
    lrDiff = Math.max(lrDiff, Math.abs(a[i] - b[i]));
    if ((i - i0) % win === win - 1) {
      windows.push(Math.round(20 * Math.log10(wPeak + 1e-9)));
      wPeak = 0;
    }
  }
  return { peak, nonFinite, nearClip, rms: Math.sqrt(sum / Math.max(1, 2 * (i1 - i0))), windows, lrDiff };
}

async function makeDirector(seconds: number, seed = 1, worker?: () => Worker) {
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const t0 = performance.now();
  const d = new AudioDirector({ context: ctx, haptics: false, storage: null, seed, lowEnd: false, worker });
  await d.ready;
  return { ctx, d, buildMs: performance.now() - t0 };
}

/** Longest gap between 4 ms timer ticks while `work` runs: how long the main thread was blocked. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now(), worst = 0;
  const id = setInterval(() => {
    const t = performance.now();
    worst = Math.max(worst, t - last);
    last = t;
  }, 4);
  await work();
  clearInterval(id);
  return Math.round(Math.max(worst, performance.now() - last));
}

/** Tracks the most voices seen per category while events are handled. */
function capWatcher(d: AudioDirector) {
  const peak: Record<string, number> = {};
  let total = 0;
  return {
    sample() {
      const c = d.voices.counts();
      for (const [k, v] of Object.entries(c)) peak[k] = Math.max(peak[k] ?? 0, v);
      total = Math.max(total, d.voices.count());
    },
    result: () => ({ peak, total }),
  };
}

function warnings() {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); orig(...a); };
  return { seen, restore: () => (console.warn = orig) };
}

const scenarios = {
  /** Baking in a worker gives the same audio as the main thread and never blocks it. */
  async worker(workerCode: string) {
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    let viaWorker: Awaited<ReturnType<typeof makeDirector>> | undefined;
    const workerStall = await longestStall(async () => (viaWorker = await makeDirector(1, 3, () => new Worker(url))));
    let viaThread: Awaited<ReturnType<typeof makeDirector>> | undefined;
    const threadStall = await longestStall(async () => (viaThread = await makeDirector(1, 3)));
    const a = (viaWorker!.d.bank as any).buffers as Map<string, AudioBuffer[]>;
    const b = (viaThread!.d.bank as any).buffers as Map<string, AudioBuffer[]>;
    let maxDiff = 0, compared = 0;
    for (const [name, list] of a) {
      const other = b.get(name);
      if (!other || other.length !== list.length) { maxDiff = Infinity; continue; }
      list.forEach((buf, i) => {
        const x = buf.getChannelData(0), y = other[i].getChannelData(0);
        if (x.length !== y.length) maxDiff = Infinity;
        else for (let k = 0; k < x.length; k++) maxDiff = Math.max(maxDiff, Math.abs(x[k] - y[k]));
        compared++;
      });
    }
    // a worker that dies must not stop the bank from building
    const broken = URL.createObjectURL(new Blob(['self.onmessage = () => { throw new Error("boom"); };'], { type: 'text/javascript' }));
    const fallback = await Promise.race([
      makeDirector(1, 3, () => new Worker(broken)).then((r) => r.d.debugState().baking),
      new Promise<string>((r) => setTimeout(() => r('timed out'), 20000)),
    ]);
    return {
      baking: viaWorker!.d.debugState().baking, workerMs: Math.round(viaWorker!.buildMs), threadMs: Math.round(viaThread!.buildMs),
      workerStall, threadStall, compared, maxDiff, sameNames: a.size === b.size, fallback,
    };
  },

  /** The bank bakes in the browser, every buffer is clean, and memory stays in budget in every biome. */
  async bank() {
    const { d, buildMs } = await makeDirector(1);
    let bad = 0, silent = 0, buffers = 0;
    for (const name of d.bank.names()) {
      for (let k = 0; k < 6; k++) {
        const b = d.bank.get(name)!;
        buffers++;
        const x = b.getChannelData(0);
        let pk = 0;
        for (let i = 0; i < x.length; i++) {
          const v = Math.abs(x[i]);
          if (!Number.isFinite(v) || v > 1) { bad++; break; }
          if (v > pk) pk = v;
        }
        if (pk < 0.05) silent++;
      }
    }
    const memory: number[] = [];
    for (let b = 1; b <= 10; b++) {
      await d.bank.prepareBiome(b);
      d.bank.bed(b);
      memory.push(Math.round(d.bank.bytes() / 1e5) / 10);
    }
    return { buildMs: Math.round(buildMs), names: d.bank.names().length, buffers, bad, silent, memoryMB: memory };
  },

  /** A scripted run touching every system, then a 150-contact collapse and game over. */
  async run() {
    const { ctx, d } = await makeDirector(34);
    const rng = mulberry32(99);
    const caps = capWatcher(d);
    const w = warnings();
    const ev: [number, string, Record<string, unknown>?][] = [];
    const at = (t: number, name: string, p?: Record<string, unknown>) => ev.push([t, name, p]);
    let tension = 0, biomeId = 1, altitude = 0;
    for (let t = 0; t < 33; t += 0.1) ev.push([t, 'signals', undefined]);
    at(0.2, 'run_start');
    // twelve placements in the meadow, mostly clean, one messy, then perfects
    const grades = ['clean', 'clean', 'perfect', 'clean', 'clean', 'messy', 'clean', 'perfect', 'perfect', 'clean', 'clean', 'clean'];
    grades.forEach((g, i) => {
      const t0 = 0.8 + i * 0.9;
      at(t0, 'piece_spawned', { shape: 'T' });
      at(t0 + 0.1, 'piece_moved', { x: -1 + (i % 3) });
      at(t0 + 0.2, 'piece_rotated', { dir: i % 2 ? 'ccw' : 'cw', blocked: i === 4 });
      at(t0 + 0.25, 'ghost_fit', { perfect: g === 'perfect' });
      at(t0 + 0.35, 'hard_drop', { distance: 8 });
      at(t0 + 0.5, 'piece_landed', { impact: 0.5, material: 'wood' });
      at(t0 + 0.5, 'contact_hit', { bodyA: `p${i}`, bodyB: 'tower', approachSpeed: 6, materialA: 'wood', materialB: i === 0 ? 'base' : 'wood', point: { x: 0, y: i } });
      at(t0 + 0.55, 'contact_slide', { body: `p${i}`, speed: 1.2 });
      at(t0 + 0.6, 'contact_slide', { body: `p${i}`, speed: 0.8 });
      at(t0 + 0.7, 'piece_settled', { grade: g, material: 'wood' });
      if (g === 'perfect') at(t0 + 0.7, 'perfect', { combo: i });
    });
    at(5, 'bond_formed', {});
    at(6, 'row_solid', { count: 2 });
    at(7, 'height_milestone', { blocks: 10 });
    at(9, 'checkpoint_near', { blocks: 1 });
    for (let k = 0; k <= 10; k++) at(10 + k * 0.2, 'checkpoint_hold', { progress: k / 10 });
    at(12.1, 'checkpoint_claimed', { n: 1, leftover: 6 });
    at(13.8, 'biome_entered', { id: 2 });
    at(14, 'hazard_warning', { type: 'gust', dir: 'left', eta: 2 });
    at(16, 'hazard_start', { type: 'gust', strength: 0.08, dir: 'left' });
    at(18.5, 'hazard_end', { type: 'gust' });
    at(15, 'difficulty_tier_up', { tier: 1 });
    at(15.5, 'slowmo', { on: true, timeScale: 0.4 });
    at(16.2, 'slowmo', { on: false });
    at(16.5, 'hitstop', { ms: 60 });
    at(17, 'piece_lost', {});
    at(17.8, 'piece_gone', { how: 'ground' });
    at(17.9, 'heart_lost', { count: 1, left: 2 });
    at(18, 'pb_crossed', {});
    at(19, 'budget_low', { left: 3 });
    at(19.2, 'clutch', {});
    at(19.5, 'heart_lost', { count: 1, left: 1 });
    at(19.7, 'last_heart', {});
    at(20, 'heart_restored', {});
    // tension ramps into danger before the collapse
    for (let t = 20; t < 23; t += 0.1) ev.push([t, 'tension', { value: Math.min(1, (t - 20) / 2.5) }]);
    at(23, 'collapse_started', { pieces: 40 });
    const mats: Material[] = ['wood', 'wood', 'stone', 'rubber', 'metal', 'ice', 'base', 'ground'];
    for (let k = 0; k < 150; k++) {
      const t = 23 + rng() * 1.6;
      at(t, 'contact_hit', {
        bodyA: `p${Math.floor(rng() * 40)}`, bodyB: `p${Math.floor(rng() * 40)}`,
        approachSpeed: 0.5 + rng() * 15, materialA: mats[Math.floor(rng() * mats.length)], materialB: mats[Math.floor(rng() * mats.length)],
        point: { x: (rng() * 2 - 1) * 6, y: rng() * 20 }, size: 1 + Math.floor(rng() * 6),
      });
      if (k % 15 === 0) at(t, 'bond_broken', { force: 50 + rng() * 300 });
      if (k % 30 === 0) at(t, 'contact_slide', { body: `p${k}`, speed: 2 + rng() * 2 });
    }
    for (let k = 0; k < 5; k++) at(24 + k * 0.2, 'piece_lost', {});
    at(25.5, 'heart_lost', { count: 3, left: 0 });
    at(26, 'run_over', {});
    for (let k = 0; k < 40; k++) at(28 + k * 0.05, 'xp_tick', {});
    at(30.5, 'level_up', { level: 5 });
    at(31.5, 'unlock', { id: 'jelly' });

    ev.sort((a, b) => a[0] - b[0]);
    const cpu: number[] = [];
    for (const [t, name, p] of ev) {
      if (name === 'signals' || name === 'tension') {
        if (name === 'tension') tension = (p!.value as number);
        if (t > 13.8) biomeId = 2;
        altitude = Math.min(40, t * 1.5);
        d.handle('signals', { tension, biome: biomeId, altitude, cameraY: altitude, cameraX: 0, foundationX: 0, sway: Math.sin(t), gravityScale: 1, timeScale: 1 }, t);
      } else {
        const c0 = performance.now();
        d.handle(name, p, t);
        if (name === 'contact_hit') cpu.push(performance.now() - c0);
      }
      caps.sample();
      if (t > 22.5 && t < 23) (scenarios as any)._danger = d.debugState().danger;
    }
    const danger = (scenarios as any)._danger;
    const buf = await ctx.startRendering();
    w.restore();
    const all = analyse(buf);
    const collapse = analyse(buf, 23, 25);
    const meadow = analyse(buf, 1, 12);
    return {
      all: { ...all, windows: all.windows }, collapse: { peak: collapse.peak, nearClip: collapse.nearClip, rms: collapse.rms },
      meadow: { peak: meadow.peak, rms: meadow.rms },
      caps: caps.result(), capLimits: { ...FULL_CAPS, total: FULL_GLOBAL_CAP }, peakVoices: d.voices.peakCount,
      dangerBeforeCollapse: danger, finalMix: d.mixer.state(), warnings: w.seen,
      contactCpuMs: { mean: cpu.reduce((a, b) => a + b, 0) / cpu.length, max: Math.max(...cpu) },
      memoryMB: Math.round(d.bank.bytes() / 1e5) / 10,
    };
  },

  /** A resting tower: below-threshold jitter contacts and low tension must make no sound. */
  async rest() {
    const { ctx, d } = await makeDirector(10);
    d.handle('run_start', {}, 0.1);
    // ambience bed and sweeteners are meant to be heard; mute them so only the tower is measured
    d.mixer.setVolume('ambience', 0, 0.2);
    const rng = mulberry32(5);
    for (let t = 0.2; t < 10; t += 0.1) {
      d.handle('signals', { tension: 0.15, biome: 1, cameraY: 5 }, t);
      if (t > 2.5) {
        for (let k = 0; k < 4; k++) d.handle('contact_hit', { bodyA: `p${k}`, bodyB: 'tower', approachSpeed: rng() * 0.29, materialA: 'wood' }, t);
        d.handle('contact_slide', { body: 'p1', speed: 0.3 }, t);
      }
    }
    const buf = await ctx.startRendering();
    const quiet = analyse(buf, 3.5, 10);
    const start = analyse(buf, 0, 1.5);
    return { quietPeakDb: Math.round(20 * Math.log10(quiet.peak + 1e-9)), startPeakDb: Math.round(20 * Math.log10(start.peak + 1e-9)) };
  },

  /** Harder hits are louder; a far-below-screen hit is quieter. */
  async loudness() {
    const level = async (speed: number, y = 0) => {
      const { ctx, d } = await makeDirector(1.5);
      d.mixer.setVolume('ambience', 0, 0);
      d.handle('signals', { cameraY: 10 }, 0);
      d.handle('contact_hit', { bodyA: 'a', approachSpeed: speed, materialA: 'wood', materialB: 'wood', point: { x: 0, y } }, 0.2);
      return analyse(await ctx.startRendering()).peak;
    };
    const soft = await level(1.2, 10), mid = await level(5, 10), hard = await level(14, 10), below = await level(14, -30);
    return { softDb: db(soft), midDb: db(mid), hardDb: db(hard), belowDb: db(below) };
  },

  /** With mono on, a hard-panned sound comes out identical on both sides. */
  async mono() {
    const out: Record<string, number> = {};
    for (const mono of [false, true]) {
      const { ctx, d } = await makeDirector(1);
      d.setMono(mono);
      d.mixer.setVolume('ambience', 0, 0);
      d.play('impact.wood.3', { when: 0.1, pan: 1, vary: false });
      out[mono ? 'mono' : 'stereo'] = analyse(await ctx.startRendering()).lrDiff;
    }
    return out;
  },

  /** Every JuiceBus event with no payload, then with junk, must not throw or warn. */
  async robustness() {
    const { ctx, d } = await makeDirector(4);
    const w = warnings();
    let t = 0.1;
    d.handle('run_start', {}, t);
    for (const name of JUICE_EVENTS) d.handle(name, undefined, (t += 0.02));
    for (const name of JUICE_EVENTS) d.handle(name, { x: NaN, y: 'up', approachSpeed: Infinity, grade: 42, material: 'cheese', id: -3, count: 1e9, type: null }, (t += 0.02));
    d.handle('made_up_event', { a: 1 }, (t += 0.02));
    const buf = await ctx.startRendering();
    w.restore();
    const s = analyse(buf);
    return { warnings: w.seen, nonFinite: s.nonFinite, peak: s.peak, voices: d.voices.peakCount };
  },

  /** Danger starts at tension 0.85, holds until it falls below 0.75. */
  async danger() {
    const { d } = await makeDirector(1);
    d.handle('run_start', {}, 0);
    const seq = [0.5, 0.84, 0.86, 0.8, 0.76, 0.74, 0.9];
    return seq.map((v, i) => {
      d.handle('signals', { tension: v }, 0.1 + i * 0.1);
      return d.debugState().danger;
    });
  },

  /** A body with no material sounds like the biome it was placed in; slabs and stone stay stone. */
  async materials() {
    const { d } = await makeDirector(2);
    const played = spyPlays(d);
    d.handle('piece_spawned', {}, 0);
    d.handle('biome_entered', { id: 5 }, 0.01);
    await d.bank.prepareBiome(5);
    const hit = (t: number, p: Record<string, unknown>) => {
      played.length = 0;
      d.handle('contact_hit', { bodyA: `b${t}`, bodyB: `c${t}`, approachSpeed: 8, point: { x: 0, y: 2 }, size: 4, ...p }, t);
      return played.filter((n) => n.startsWith('impact.')).map((n) => n.split('.')[1]);
    };
    return {
      current: hit(0.2, {}),
      placed: hit(0.4, { biomeA: 4, biomeB: 4 }),
      mixed: hit(0.6, { biomeA: 4, biomeB: 5 }),
      onStone: hit(0.8, { biomeA: 5, materialB: 'stone' }),
    };
  },

  /** Power-ups and Second Wind: each moment has its sound, Slow-Mo is released, and Second Wind never nags. */
  async powers() {
    const { ctx, d } = await makeDirector(15);
    const w = warnings();
    const played = spyPlays(d);
    const at = (t: number, events: [string, Record<string, unknown>?][]) => {
      played.length = 0;
      for (const [name, p] of events) d.handle(name, p ?? {}, t);
      return [...played];
    };
    const overlays = () => d.mixer.state().overlays;
    at(0.1, [['piece_spawned', { shape: 'T' }]]);
    const swept = (n: number) => ({ pieces: Array.from({ length: n }, (_, i) => ({ id: i, shape: 'O', x: i - n / 2, y: 1 })) });
    const r = {
      bubble: at(0.5, [['bubble_spawned', { id: 1, kind: 'glue', x: 1, y: 6 }]]),
      collect: at(1.5, [['power_collected', { id: 1, kind: 'glue', slot: 0, x: 1, y: 6 }]]),
      glue: at(2.5, [['power_used', { kind: 'glue', slot: 0, shapes: 3 }]]),
      glueLanding: at(3, [['piece_landed', { shape: 'T', impact: 0.5, x: 0, glue: true }], ['bond_formed', { pos: { x: 0, y: 1 }, glue: true }]]),
      refused: at(3.5, [['power_refused', { kind: 'glue', slot: 1 }]]),
      slowIn: at(4, [['power_used', { kind: 'slowmo', slot: 1, shapes: 3 }]]),
      slowOverlays: overlays(),
      slowOut: at(5.5, [['power_ended', { kind: 'slowmo' }]]),
      afterOverlays: overlays(),
      glueEnd: at(5.6, [['power_ended', { kind: 'glue' }]]),
      expired: at(7, [['bubble_expired', { id: 2, kind: 'undo', x: -1, y: 5 }]]),
      undo: at(7.5, [['power_used', { kind: 'undo', slot: 0, id: 9, shape: 'L', x: -2, y: 3 }]]),
      quickset: at(8, [['power_used', { kind: 'quickset', slot: 1, ids: [1, 2, 3] }]]),
      clean: at(8.8, [['pieces_swept', swept(4)], ['power_used', { kind: 'clean', slot: 0, ...swept(4), refund: 4 }]]),
      readyAtStart: at(9.5, [['second_wind_ready', { how: 'start' }]]),
      earned: at(9.6, [['checkpoint_claimed', { n: 2, grade: 'S', leftover: 0 }], ['second_wind_ready', { how: 'earned' }], ['power_granted', { kind: 'undo', slot: 0, why: 'grade' }]]),
      secondWind: at(12.5, [['pieces_swept', swept(6)], ['second_wind', { pieces: 6, refund: 6, hearts: 3, restored: 2, bricks: 20 }], ['heart_restored', { left: 3 }]]),
    };
    const buf = await ctx.startRendering();
    w.restore();
    const s = analyse(buf);
    return { ...r, warnings: w.seen, nonFinite: s.nonFinite, peak: s.peak, peakVoices: d.voices.peakCount };
  },

  /** Every new run is picked up from its first spawn, even with no run_start; a stray spawn at run_over is not. */
  async reruns() {
    const { d } = await makeDirector(1);
    const base = () => d.mixer.state().base;
    const seen: string[] = [];
    d.handle('piece_spawned', {}, 0.1);
    seen.push(base());
    d.handle('run_over', {}, 5);
    d.handle('piece_spawned', {}, 5);
    seen.push(base());
    d.handle('piece_spawned', {}, 12);
    seen.push(base());
    d.handle('run_over', {}, 20);
    d.handle('piece_spawned', {}, 26);
    seen.push(base());
    return seen;
  },
};

/** Records the name of every sound the director plays. */
function spyPlays(d: AudioDirector): string[] {
  const names: string[] = [];
  const target = d as unknown as { play: (name: string, ...rest: unknown[]) => unknown };
  const orig = target.play.bind(d);
  target.play = (name, ...rest) => {
    names.push(name);
    return orig(name, ...rest);
  };
  return names;
}

const db = (x: number) => Math.round(20 * Math.log10(x + 1e-9) * 10) / 10;

(window as any).scenarios = scenarios;
