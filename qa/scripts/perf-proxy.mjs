// The throttled-browser proxy for the performance budgets (qa-section.md 7.1, 8 and 10.2). Headless
// Chromium is slowed with CPU throttling until the game's own silent benchmark (S1's tower, the one
// every phone build runs) takes as long as it would on each tier's phone, and then QA's bot plays the
// built game for a few minutes on each tier while the page records, for every frame, the main
// thread's time split into sim steps (physics and the rules), the rest of the scene update (logic,
// juice, camera) and Phaser's render calls; every physics step with the awake body count; JS heap;
// and long tasks. The bot plays inside the page, through sim.intent before each step, so a seed gives
// the same run on every tier however slow the frames are.
//
// Tiers are set from one real phone: the bench record from Blake's phone (ANCHOR below) and published
// Geekbench 6 single-core scores. A tier's bench target is the phone's bench time × (phone score / tier
// score). Only the renderer's main thread is throttled. WebGL here is SwiftShader, which can't draw
// this game at 60 FPS on a few shared cores (the GPU process, not the page, sets the pace), so frame
// intervals here say nothing about phones and only the main thread is judged. A frame at 60 Hz is
// estimated as that frame's work outside sim steps plus one step, since a slow frame here runs up
// to 4. The page runs at device pixel ratio 0.5 (--dpr) to keep SwiftShader's share small; the
// main thread's work barely depends on it. Real frame pacing comes from the phones' run records.
//
// Usage: node scripts/perf-proxy.mjs [game checkout] [--minutes 3] [--tiers phone,mid,low] [--seed 7]
//          [--engines box2d,rapier] [--bench-from <checkout>] [--dpr 0.5] [--out dir]
//   --minutes 0 runs only the calibration and the S1 bench per engine and tier.
//   The game checkout's game/ must have npm ci done; dist-game is built if missing.
//   --bench-from: the checkout whose bench calibrates the tiers (default: the game checkout). Use the
//   build the anchor record was made on, so the bench code is the one the phone ran.
//   --profile: samples the main thread while the bot plays and lists what ran in each stretch of 100 ms
//   or more without a break. Pair it with --page and an unminified build for readable names:
//   ST_APP=game npx vite build --minify false --outDir <dir>, then --page <dir>/game.html.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const checkout = resolve(args[0] && !args[0].startsWith('--') ? args[0] : root);
const minutes = Number(flag('minutes', '3'));
const seed0 = Number(flag('seed', '7'));
const out = resolve(flag('out', `${root}/qa/reports/perf-proxy`));
const benchFrom = resolve(flag('bench-from', checkout));
const dpr = Number(flag('dpr', '0.5'));
const profiling = args.includes('--profile');
mkdirSync(out, { recursive: true });

// Blake's phone, bench record gp27lklgarubuk0bs2k0 (build ec0c30a, 2026-10-20): Android 10 WebView,
// Chrome 155, 8 cores, 448 × 998 at 2.25 and 120 Hz. That screen is a Pixel 9 Pro XL or 10 Pro XL
// (1344 × 2992 panel at its default 1008 × 2244), and 8 cores rule out the 9-core Tensor G3.
// Taking the faster Tensor G5 (Geekbench 6 single-core about 2,200) makes the slower tiers harsher.
const ANCHOR = { record: 'gp27lklgarubuk0bs2k0', build: 'ec0c30a', bench60: 2.582, bench152: 3.687, gb6: 2200 };
// Geekbench 6 single-core: Galaxy A55 (Exynos 1480) about 1,150, the slower of the mid-tier Androids
// (Pixel 8a is about 1,570); Galaxy A15 (Helio G99) about 730 for the low tier.
const TIERS = {
  phone: { name: "Blake's phone", gb6: ANCHOR.gb6, budget: 'mid' },
  mid: { name: 'mid tier (Galaxy A55 class)', gb6: 1150, budget: 'mid' },
  low: { name: 'low tier (Galaxy A15 class)', gb6: 730, budget: 'low' },
};
const tiers = flag('tiers', 'phone,mid,low').split(',').map((t) => t.trim()).filter((t) => TIERS[t]);

const req = createRequire(`${root}/qa/`);
const esbuild = req('esbuild');
const { chromium } = (() => {
  for (const from of [`${checkout}/game/`, `${root}/game/`, `${root}/art/`]) {
    try { return createRequire(from)('@playwright/test'); } catch { /* try the next */ }
  }
  throw new Error('Playwright not found: run npm ci in game/');
})();
const executablePath = process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const gitShort = (dir) => { try { return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

const bundle = async (code, dir) => (await esbuild.build({
  stdin: { contents: code, resolveDir: dir, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'error',
})).outputFiles[0].text;
const benchJs = await bundle(`import { runBench } from './src/sim/bench.ts'; (window as any).__bench = runBench;`, `${benchFrom}/game`);
// This build's bench, on each engine it has (Rapier from the bake-off adapter, when present).
const hasRapier = existsSync(`${checkout}/game/src/sim/engine/rapier.ts`);
const engines = flag('engines', hasRapier ? 'box2d,rapier' : 'box2d').split(',').filter((e) => e === 'box2d' || (e === 'rapier' && hasRapier));
const nowJs = await bundle(hasRapier
  ? `import { runBench } from './src/sim/bench.ts'; import { RapierEngine, initRapier } from './src/sim/engine/rapier.ts'; import { registerEngine } from './src/sim/sim.ts';
     const ready = initRapier(() => import('@dimforge/rapier2d-deterministic-compat')).then(() => registerEngine('rapier', (s: any) => new RapierEngine(s)));
     (window as any).__benchNow = async (engine: 'box2d' | 'rapier') => { await ready; return runBench(undefined, engine); };`
  : `import { runBench } from './src/sim/bench.ts'; (window as any).__benchNow = async () => runBench();`, `${checkout}/game`);
const botJs = await bundle(`import { Bot } from '${root}/qa/src/bot.ts'; import { extents } from './src/sim/shapes.ts'; (window as any).__qa = { Bot, extents };`, `${checkout}/game`);

const gameHtml = resolve(flag('page', `${checkout}/game/dist-game/game.html`));
if (!existsSync(gameHtml)) execFileSync('npm', ['run', '-s', 'build:game'], { cwd: `${checkout}/game`, stdio: 'inherit' });

const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const throttled = async (page, rate) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
};
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const median = (xs) => pct(xs, 0.5);

// One cold run of a bench in a fresh page, as a phone runs it once per build.
async function bench(rate, js = benchJs, engine = null) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<!doctype html><title>bench</title>');
  await throttled(page, rate);
  await page.addScriptTag({ content: js });
  const res = await page.evaluate((engine) => (engine ? window.__benchNow(engine) : window.__bench()), engine);
  await ctx.close();
  return { p60: res.phases[0].mean, p152: res.phases[1].mean, p95at60: res.phases[0].p95, p95at152: res.phases[1].p95, awake: res.phases.map((p) => p.awake) };
}
async function benchAt(rate, js, engine) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await bench(rate, js, engine));
  const m = (k) => median(runs.map((r) => r[k]));
  return { rate, p60: m('p60'), p152: m('p152'), p95at60: m('p95at60'), p95at152: m('p95at152'), awake: runs[0].awake };
}

const base = await benchAt(1);
console.log(`unthrottled bench: ${r2(base.p60)} ms at 60 bodies, ${r2(base.p152)} ms at 152`);
const calib = {};
for (const t of tiers) {
  const target = ANCHOR.bench152 * (ANCHOR.gb6 / TIERS[t].gb6);
  let rate = Math.max(1, target / base.p152);
  let m = await benchAt(rate);
  for (let i = 0; i < 3 && Math.abs(m.p152 / target - 1) > 0.05; i++) {
    rate = Math.max(1, rate * (target / m.p152));
    m = await benchAt(rate);
  }
  calib[t] = { target, ...m };
  console.log(`${t}: rate ${r2(rate)} gives ${r2(m.p152)} ms at 152 bodies (target ${r2(target)}) and ${r2(m.p60)} ms at 60`);
}

// S1 on this build, per engine and tier: a stress case tracked between builds, with no pass/fail
// time (qa-section.md Q39). Physics is judged in play, below.
const s1 = [];
for (const t of tiers) {
  for (const e of engines) {
    const m = await benchAt(calib[t].rate, nowJs, e);
    s1.push({ tier: t, engine: e, ...m });
    console.log(`S1 ${e} on ${t}: ${r2(m.p60)} ms at ${m.awake[0]} awake, ${r2(m.p152)} ms at ${m.awake[1]} (p95 ${r2(m.p95at60)} / ${r2(m.p95at152)})`);
  }
}
const benchOnly = minutes === 0;

// The game, played by QA's bot on one tier.
async function play(t) {
  const { rate } = calib[t];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    const writes = (window.__dbWrites = []);
    const doc = (col, id = Math.random().toString(36).slice(2)) => ({ set: async (d) => { writes.push({ op: 'set', path: `${col}/${id}`, data: d }); }, update: async (d) => { writes.push({ op: 'update', path: `${col}/${id}`, data: d }); } });
    window.claude = { use: async (name) => (name === 'db' ? { collection: (col) => ({ doc: (id) => doc(col, id) }) } : null) };
    // A level-6 player past the first-run rules: Hold and a head-start power, no warm-up, no intro card.
    if (!localStorage.getItem('shape-tower-profile-v1')) {
      localStorage.setItem('shape-tower-profile-v1', JSON.stringify({ level: 6, xp: 0, total: 3000, runs: 8, sliceRuns: 2, askedGhost: true, seenGusts: true, player: 'p-qa-proxy' }));
      localStorage.setItem('shape-tower-played', '1');
    }
  });
  await throttled(page, rate);
  await page.goto(new URL(`file://${gameHtml}`).href);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 60000 });
  await page.addScriptTag({ content: botJs });
  await page.evaluate((seed0) => {
    const { scene, game } = window.__wobble;
    // frames: [interval, Phaser's smoothed delta, whole step ms, scene update ms, sim steps, their ms, physics ms,
    // QA's bot ms, s since setup (about the profile's clock), s into the run, the sim events of the frame]. The bot
    // plays inside the scene update, so its time is taken out of every judged figure.
    const qa = (window.__qaPerf = { frames: [], phys: [], awakeAt: [], heap: [], longtasks: [], runs: [], seed: seed0, t0: performance.now() });
    let fSteps = 0, fStepMs = 0, fPhys = 0, fUpd = 0, fBot = 0, fEv = [];
    const playing = () => scene.started && !scene.paused && scene.sim && scene.sim.state === 'playing';
    // Each run's seed: the scene takes it from the first Math.random() in newRun.
    const newRun = scene.newRun;
    scene.newRun = function (demo) {
      if (demo) return newRun.call(this, demo);
      const rnd = Math.random;
      let first = true;
      Math.random = () => (first ? ((first = false), qa.seed / 2 ** 32) : rnd());
      try { return newRun.call(this, demo); } finally { Math.random = rnd; qa.runs.push({ seed: this.sim.seed, startedAt: performance.now() }); qa.seed++; }
    };
    let bot = null, botSim = null;
    const stepSim = scene.stepSim;
    scene.stepSim = function () {
      const sim = this.sim;
      if (this.started && sim !== botSim) {
        botSim = sim;
        bot = new window.__qa.Bot({ seed: sim.seed, naturalFall: 0.2, powers: true }, window.__qa.extents);
        sim.bus.on('*', (e) => fEv.push(e.name));
        const step = sim.step.bind(sim);
        sim.step = (...a) => {
          const t0 = performance.now();
          const r = step(...a);
          const ms = performance.now() - t0;
          qa.phys.push(ms);
          fPhys += ms;
          if (sim.stepIndex % 30 === 0) {
            const views = sim.pieceViews();
            qa.awakeAt.push([qa.phys.length - 1, views.filter((v) => sim.engine.isAwake(v.id)).length, views.length]);
          }
          return r;
        };
      }
      const b0 = performance.now();
      if (bot && sim === botSim && playing()) bot.tick(sim);
      fBot += performance.now() - b0;
      const t0 = performance.now();
      stepSim.call(this);
      fStepMs += performance.now() - t0;
      fSteps++;
    };
    const su = scene.sys.sceneUpdate;
    scene.sys.sceneUpdate = function (time, delta) { const t0 = performance.now(); su.call(this, time, delta); fUpd += performance.now() - t0; };
    const cb = game.loop.callback;
    game.loop.callback = (time, delta) => {
      const on = playing();
      fSteps = 0; fStepMs = 0; fPhys = 0; fUpd = 0; fBot = 0; fEv = [];
      const t0 = performance.now();
      cb(time, delta);
      if (on) qa.frames.push([game.loop.rawDelta, delta, performance.now() - t0, fUpd, fSteps, fStepMs, fPhys, fBot, (t0 - qa.t0) / 1000, scene.sim.stepIndex / 60, [...new Set(fEv)].join(' ')]);
    };
    setInterval(() => { if (performance.memory) qa.heap.push([performance.now(), performance.memory.usedJSHeapSize]); }, 1000);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
  }, seed0);
  const prof = profiling ? await page.context().newCDPSession(page) : null;
  if (prof) { await prof.send('Profiler.enable'); await prof.send('Profiler.setSamplingInterval', { interval: 500 }); await prof.send('Profiler.start'); }
  await page.click('[data-action="play"]');
  const t0 = Date.now();
  const states = [];
  while (Date.now() - t0 < minutes * 60_000) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => { const sc = window.__wobble.scene; return { state: sc.sim.state, steps: sc.sim.stepIndex, cps: sc.sim.stats.checkpoints, placed: sc.sim.stats.placed }; });
    states.push({ wall: (Date.now() - t0) / 1000, ...s });
    if (s.state !== 'playing') {
      // Run over: through the panorama, the tally and any level-up, then Play again.
      await page.waitForSelector('.sc-root.show [data-action="continue"], .sc-root.show [data-action="again"]', { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(4000);
      if (await page.$('.sc-root.show [data-action="continue"]')) { await page.click('.sc-root.show [data-action="continue"]'); await page.waitForTimeout(500); }
      const ask = await page.$('.sc-ask .ui-btn');
      if (ask) { await ask.click(); await page.waitForTimeout(300); }
      await page.evaluate(() => { const p = window.__wobble.profile; if (p) p.sliceRuns = 2; }); // keep juice on
      const again = await page.$('.sc-root.show [data-action="again"]');
      if (!again) break;
      await again.click();
      await page.waitForTimeout(500);
    }
  }
  const qa = await page.evaluate(() => {
    const q = window.__qaPerf;
    return { ...q, juice: window.__wobble.scene.view.juice, records: window.__dbWrites.filter((w) => w.op === 'set' && w.data.kind === 'run').map((w) => ({ seed: w.data.seed, frames: w.data.frames, cause: w.data.cause, checkpoints: w.data.checkpoints, simSeconds: w.data.simSeconds })) };
  });
  const stretches = prof ? busyStretches((await prof.send('Profiler.stop')).profile) : [];
  const cdp = await page.context().newCDPSession(page);
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] }))).metrics?.map((m) => [m.name, m.value]) ?? []);
  await ctx.close();
  return { tier: t, rate, qa, states, errors, metrics, stretches };
}

// Stretches of a CPU profile where the main thread never went idle for 100 ms or more: when each
// began, how long it ran, the functions with the most self time, and the call stack seen most.
function busyStretches(profile, minMs = 100) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = (n) => `${n.callFrame.functionName || '(anonymous)'}${n.callFrame.url ? `:${n.callFrame.lineNumber + 1}` : ''}`;
  const chain = (id) => { const out = []; for (let n = byId.get(id); n && out.length < 8; n = byId.get(parent.get(n.id))) if (!/^\((root|program)\)$/.test(n.callFrame.functionName)) out.push(label(n)); return out.join(' < '); };
  const found = [];
  let cur = null;
  let t = profile.startTime;
  const close = () => { if (cur && (cur.end - cur.start) / 1000 >= minMs) found.push(cur); cur = null; };
  profile.samples.forEach((id, i) => {
    t += profile.timeDeltas[i];
    const n = byId.get(id);
    if (n.callFrame.functionName === '(idle)') return close();
    const w = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    cur ??= { start: t, end: t, self: new Map(), stacks: new Map() };
    cur.end = t + w * 1000;
    cur.self.set(label(n), (cur.self.get(label(n)) ?? 0) + w);
    const c = chain(id);
    cur.stacks.set(c, (cur.stacks.get(c) ?? 0) + w);
  });
  close();
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([f, ms]) => ({ f, ms: r2(ms) }));
  return found.sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 8)
    .map((x) => ({ at: r2((x.start - profile.startTime) / 1e6), ms: r2((x.end - x.start) / 1000), self: top(x.self, 4), stack: top(x.stacks, 1)[0] }));
}

// Physics in play (qa-section.md Q39): p95 per step, and at most 40 bodies awake at once.
const LIMITS = {
  mid: { onTime: 0.99, over33: null, phys: 4, maxAwake: 40, heapMB: 400 },
  // Low tier until beta: physics within 75% of its budget on the proxy (qa-section.md §4.2 item 7).
  low: { onTime: 0.95, over33: 0.01, phys: 3, maxAwake: 40, heapMB: 300 },
};
const results = [];
for (const t of benchOnly ? [] : tiers) {
  const r = await play(t);
  const { qa } = r;
  const L = LIMITS[TIERS[t].budget];
  const frames = qa.frames.map((f) => f[0]);
  const stepAvg = median(qa.frames.filter((f) => f[4] > 0).map((f) => f[5] / f[4])) ?? 0;
  // One 60 Hz frame: this frame's work outside its steps, plus one step (its own average, or the median).
  const est = qa.frames.map(([, , tot, , n, stepMs, , bot]) => tot - bot - stepMs + (n ? stepMs / n : stepAvg));
  const render = qa.frames.map(([, , tot, upd]) => tot - upd);
  const logic = qa.frames.map(([, , , upd, n, stepMs, phys, bot]) => upd - bot - stepMs + (n ? (stepMs - phys) / n : 0));
  const botMs = qa.frames.map((f) => f[7]);
  const onTime = est.filter((f) => f <= 13.7).length / Math.max(1, est.length);
  const over33 = est.filter((f) => f > 33.4).length / Math.max(1, est.length);
  const over100 = est.filter((f) => f > 100).length;
  // Physics per step, grouped by the awake count sampled every 30 steps.
  const band = { to60: [], to150: [], over150: [] };
  for (let k = 0; k < qa.awakeAt.length; k++) {
    const [i, awake] = qa.awakeAt[k];
    const from = k ? qa.awakeAt[k - 1][0] + 1 : 0;
    const slice = qa.phys.slice(from, i + 1);
    (awake <= 60 ? band.to60 : awake <= 150 ? band.to150 : band.over150).push(...slice);
  }
  const heap = qa.heap.map(([, b]) => b / 1e6);
  const warm = qa.heap.filter(([ts]) => ts - (qa.runs[0]?.startedAt ?? 0) > 30_000).map(([, b]) => b / 1e6);
  const maxAwake = Math.max(0, ...qa.awakeAt.map(([, a]) => a));
  const simSeconds = qa.phys.length / 60;
  const wallPlaying = frames.reduce((s, f) => s + f, 0) / 1000;
  const row = {
    tier: t, name: TIERS[t].name, rate: r2(r.rate), bench: { at60: r2(calib[t].p60), at152: r2(calib[t].p152), target152: r2(calib[t].target) },
    runs: qa.runs.length, seeds: qa.runs.map((x) => x.seed), juice: qa.juice, checkpoints: Math.max(0, ...r.states.map((s) => s.cps)), placed: r.states.reduce((m, s) => Math.max(m, s.placed), 0),
    frames: { count: frames.length, intervalP50: r2(pct(frames, 0.5)), intervalP95: r2(pct(frames, 0.95)), onTime: r2(onTime * 100), over33: r2(over33 * 100), over100 },
    cpu: { p50: r2(pct(est, 0.5)), p95: r2(pct(est, 0.95)), p99: r2(pct(est, 0.99)), max: r2(Math.max(0, ...est)) },
    logic: { p50: r2(pct(logic, 0.5)), p95: r2(pct(logic, 0.95)), p99: r2(pct(logic, 0.99)) },
    render: { p50: r2(pct(render, 0.5)), p95: r2(pct(render, 0.95)), p99: r2(pct(render, 0.99)) },
    stepMs: r2(stepAvg),
    bot: { p50: r2(pct(botMs, 0.5)), p95: r2(pct(botMs, 0.95)), max: r2(Math.max(0, ...botMs)) },
    // The slowest frames, split: whole, the scene update, sim steps (count, ms, physics), the bot.
    worst: est.map((e, i) => [e, i]).sort((x, y) => y[0] - x[0]).slice(0, 5).map(([e, i]) => { const f = qa.frames[i]; return { est: r2(e), tot: r2(f[2]), upd: r2(f[3]), steps: f[4], stepMs: r2(f[5]), phys: r2(f[6]), bot: r2(f[7]), at: r2(f[8]), runS: r2(f[9]), events: f[10] }; }),
    // What the game's run record sees (Phaser's 10-frame average) against the raw intervals.
    smoothing: { rawOver33: r2(100 * frames.filter((f) => f > 33.4).length / Math.max(1, frames.length)), recordOver33: r2(100 * qa.frames.filter((f) => f[1] > 33.4).length / Math.max(1, frames.length)), rawMax: r2(Math.max(0, ...frames)), recordMax: r2(Math.max(0, ...qa.frames.map((f) => f[1]))) },
    physics: { steps: qa.phys.length, maxAwake, p95: r2(pct(qa.phys, 0.95)), max: r2(Math.max(0, ...qa.phys)), to60: { n: band.to60.length, p95: r2(pct(band.to60, 0.95)), max: r2(Math.max(0, ...band.to60)) }, to150: { n: band.to150.length, p95: r2(pct(band.to150, 0.95)), max: r2(Math.max(0, ...band.to150)) }, over150: { n: band.over150.length, p95: r2(pct(band.over150, 0.95)) } },
    simPace: r2(wallPlaying ? simSeconds / wallPlaying : null),
    heapMB: { start: r2(heap[0]), peak: r2(Math.max(0, ...heap)), afterWarmup: r2(warm[0]), end: r2(heap[heap.length - 1]) },
    longtasks: { count: qa.longtasks.length, over100: qa.longtasks.filter(([, d]) => d > 100).length, max: r2(Math.max(0, ...qa.longtasks.map(([, d]) => d))) },
    records: qa.records, errors: r.errors, stretches: r.stretches,
  };
  const checks = [
    [`main thread fits a 60 Hz frame with 3 ms headroom (≤ 13.7 ms) in ${Math.round(L.onTime * 100)}% of frames`, onTime >= L.onTime, `${row.frames.onTime}% (p99 ${row.cpu.p99} ms)`],
    ...(L.over33 !== null ? [[`at most ${L.over33 * 100}% of frames over 33 ms of main-thread work`, over33 <= L.over33, `${row.frames.over33}%`]] : []),
    ['no frame over 100 ms of main-thread work', over100 === 0, `${over100}`],
    ['game logic ≤ 2 ms per frame (p95)', (row.logic.p95 ?? 0) <= 2, `${row.logic.p95} ms`],
    ['render calls ≤ 5 ms per frame (p95)', (row.render.p95 ?? 0) <= 5, `${row.render.p95} ms`],
    [`physics ≤ ${L.phys} ms per step in play (p95)`, (row.physics.p95 ?? 0) <= L.phys, `${row.physics.p95} ms over ${row.physics.steps} steps (≤60 awake ${row.physics.to60.p95 ?? '–'}, 61-150 ${row.physics.to150.p95 ?? '–'})`],
    [`at most ${L.maxAwake} bodies awake at once`, maxAwake <= L.maxAwake, `${maxAwake}`],
    [`JS heap peak ≤ ${L.heapMB} MB`, row.heapMB.peak <= L.heapMB, `${row.heapMB.peak} MB`],
    ['no page errors', r.errors.length === 0, r.errors.slice(0, 3).join(' | ') || 'none'],
  ];
  row.checks = checks.map(([what, ok, got]) => ({ what, ok, got }));
  results.push(row);
  console.log(`${t} (${TIERS[t].name}, throttle ×${row.rate}): ${row.frames.count} frames, ${row.frames.onTime}% fit, main thread p50/p99 ${row.cpu.p50}/${row.cpu.p99} ms (logic p95 ${row.logic.p95}, render p95 ${row.render.p95}, step ${row.stepMs}), physics p95 ${row.physics.p95} ms (max awake ${maxAwake}), heap peak ${row.heapMB.peak} MB, sim pace ${row.simPace}`);
  for (const c of row.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.what}: ${c.got}`);
}
await browser.close();

const game = gitShort(checkout), harness = gitShort(root), benchBuild = gitShort(benchFrom);
const allOk = results.every((r) => r.checks.every((c) => c.ok));
const lines = [
  `# Perf proxy: ${allOk ? 'PASS' : 'FAIL'}`, '',
  `Game ${game}, harness ${harness}, bench from ${benchBuild} · ${minutes} min per tier, bot with powers, seeds from ${seed0} · ${new Date().toISOString()}`, '',
  `Unthrottled bench on this machine: ${r2(base.p60)} ms at 60 bodies, ${r2(base.p152)} ms at 152. Anchor: Blake's phone, record ${ANCHOR.record} (build ${ANCHOR.build}), ${ANCHOR.bench60} and ${ANCHOR.bench152} ms.`, '',
  '| Tier | Throttle | Bench 152 (target) | Frames that fit | Main thread p50 / p99 | Logic p95 | Render p95 | Physics p95 in play | Max awake | Heap peak |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ×${r.rate} | ${r.bench.at152} (${r.bench.target152}) ms | ${r.frames.onTime}% | ${r.cpu.p50} / ${r.cpu.p99} ms | ${r.logic.p95} ms | ${r.render.p95} ms | ${r.physics.p95} ms | ${r.physics.maxAwake} | ${r.heapMB.peak} MB |`),
  '',
  `## S1 bench on this build (${game}), mean step`, '',
  'A stress case tracked against the last good build, with no pass/fail time (qa-section.md Q39).', '',
  '| Tier | Engine | 60 bodies | 152 bodies | p95 (60 / 152) |',
  '|---|---|---|---|---|',
  ...s1.map((x) => `| ${TIERS[x.tier].name} | ${x.engine} | ${r2(x.p60)} ms | ${r2(x.p152)} ms | ${r2(x.p95at60)} / ${r2(x.p95at152)} ms |`),
  '',
  ...results.flatMap((r) => [`## ${r.name}`, '', ...r.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.what}: ${c.got}`), `- ${r.runs} runs (seeds ${r.seeds.join(', ')}), juice ${r.juice ? 'on' : 'off'}, best ${r.checkpoints} checkpoints, ${r.placed} shapes in the longest run`, `- ${r.frames.count} frames; their intervals here (SwiftShader-bound, not judged): p50 ${r.frames.intervalP50}, p95 ${r.frames.intervalP95} ms; the sim kept ${r.simPace}× real time`,
    `- the delta the game records: ${r.smoothing.recordOver33}% over 33 ms and longest ${r.smoothing.recordMax} ms, where the raw intervals have ${r.smoothing.rawOver33}% and ${r.smoothing.rawMax} ms`, `- QA's bot, taken out of every figure above: p50 ${r.bot.p50}, p95 ${r.bot.p95}, max ${r.bot.max} ms per frame`, `- slowest frames (whole / scene update / steps: count, ms, physics / bot, in ms; then when, as s since setup on the busy-stretch clock and s into the run; then the sim events in that frame): ${r.worst.map((w) => `${w.tot} / ${w.upd} / ${w.steps}, ${w.stepMs}, ${w.phys} / ${w.bot} at ${w.at} s (run ${w.runS} s)${w.events ? ` [${w.events}]` : ''}`).join('; ')}`, `- long tasks: ${r.longtasks.count} (${r.longtasks.over100} over 100 ms, longest ${r.longtasks.max} ms)`, `- heap: ${r.heapMB.start} MB at start, ${r.heapMB.afterWarmup} MB after 30 s, ${r.heapMB.end} MB at the end`,
    ...r.stretches.map((x) => `- busy ${x.ms} ms at ${x.at} s: ${x.self.map((f) => `${f.f} ${f.ms}`).join(', ')}; mostly ${x.stack?.f} (${x.stack?.ms} ms)`), '']),
];
writeFileSync(`${out}/perf-proxy.md`, lines.join('\n'));
writeFileSync(`${out}/perf-proxy.json`, JSON.stringify({ game, harness, benchBuild, minutes, base, calib, anchor: ANCHOR, s1, results }, null, 1));
console.log(`report: ${out}/perf-proxy.md`);
process.exitCode = allOk ? 0 : 1;
