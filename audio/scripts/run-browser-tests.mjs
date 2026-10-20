// Bundles the browser harness, runs every scenario in headless Chromium on an
// OfflineAudioContext, and checks the results. No server or speakers needed.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  entryPoints: [join(root, 'test/browser/harness.ts')],
  bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;
const worker = await build({
  entryPoints: [join(root, 'src/bake/worker.ts')],
  bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning',
});
const workerCode = worker.outputFiles[0].text;

// the end-to-end test needs the game's sim next to this folder, with its packages installed
const gameDir = process.env.GAME_DIR || join(root, '..', 'game');
const haveSim = existsSync(join(gameDir, 'src/sim/testApi.ts')) && existsSync(join(gameDir, 'node_modules/phaser-box2d'));
let simCode = '';
if (haveSim) {
  const sim = await build({
    entryPoints: [join(root, 'test/browser/sim-harness.ts')],
    bundle: true, format: 'iife', target: 'es2022', write: false, logLevel: 'warning',
    alias: { '@game': join(gameDir, 'src') },
    nodePaths: [join(gameDir, 'node_modules')],
  });
  simCode = sim.outputFiles[0].text;
}

// CHROMIUM_PATH overrides the browser Playwright would pick
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: code });
if (simCode) await page.addScriptTag({ content: simCode });

const checks = {
  worker(r) {
    assert.equal(r.baking, 'worker', 'the bank bakes in the worker');
    assert.ok(r.sameNames && r.compared > 100 && r.maxDiff === 0, `worker audio is identical to main-thread audio (${r.compared} buffers, max diff ${r.maxDiff})`);
    assert.ok(r.workerStall < 60, `baking in the worker never blocks the main thread for long (worst ${r.workerStall} ms)`);
    assert.ok(r.threadStall > r.workerStall, 'the worker blocks the main thread less than baking in place');
    assert.equal(r.fallback, 'main thread', 'a broken worker falls back to main-thread baking');
  },
  bank(r) {
    assert.equal(r.bad, 0, 'no buffer has NaN or samples above full scale');
    assert.equal(r.silent, 0, 'no buffer is silent');
    // budget (audio section 4.8): about 25 MB of SFX, 5 MB of beds and 12 MB of notes
    assert.ok(Math.max(...r.memoryMB) < 42, `decoded audio stays under 42 MB in every biome (got ${r.memoryMB.join(', ')})`);
  },
  run(r) {
    assert.equal(r.all.nonFinite, 0, 'no NaN in the mix');
    assert.ok(r.all.peak <= 1, `mix never exceeds full scale (peak ${r.all.peak.toFixed(3)})`);
    assert.ok(r.collapse.nearClip < 50, `collapse does not slam the limiter (${r.collapse.nearClip} samples at 0.99+)`);
    assert.ok(r.meadow.rms > 0.003, 'placements are audible');
    assert.ok(r.collapse.rms > r.meadow.rms, 'the collapse is louder than normal play');
    for (const [cat, n] of Object.entries(r.caps.peak)) assert.ok(n <= r.capLimits[cat], `${cat} voices ${n} within cap ${r.capLimits[cat]}`);
    assert.ok(r.caps.total <= r.capLimits.total, `total voices ${r.caps.total} within ${r.capLimits.total}`);
    assert.equal(r.dangerBeforeCollapse, true, 'danger is on as tension peaks');
    assert.equal(r.finalMix.base, 'results', 'game over ends on the results mix');
    assert.deepEqual(r.warnings, [], 'no warnings');
    assert.ok(r.contactCpuMs.mean < 0.5, `a contact costs ${r.contactCpuMs.mean.toFixed(3)} ms of CPU on average`);
  },
  rest(r) {
    assert.ok(r.startPeakDb > -30, 'the run-start chime plays');
    assert.ok(r.quietPeakDb < -70, `a resting tower is silent (peak ${r.quietPeakDb} dBFS)`);
  },
  loudness(r) {
    assert.ok(r.softDb < r.midDb && r.midDb < r.hardDb, `harder hits are louder (${r.softDb} < ${r.midDb} < ${r.hardDb} dB)`);
    assert.ok(r.belowDb < r.hardDb - 6, `hits far below the screen are quieter (${r.belowDb} vs ${r.hardDb} dB)`);
  },
  mono(r) {
    assert.ok(r.stereo > 0.01, 'panning works in stereo');
    assert.ok(r.mono < 1e-6, `mono output is identical on both sides (diff ${r.mono})`);
  },
  robustness(r) {
    assert.deepEqual(r.warnings, [], 'bad payloads never throw');
    assert.equal(r.nonFinite, 0);
    assert.ok(r.peak <= 1);
  },
  danger(r) {
    assert.deepEqual(r, [false, false, true, true, true, false, true], 'danger hysteresis');
  },
};

checks.sim = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN in the mix');
  assert.ok(r.peak <= 1, `the mix never exceeds full scale (peak ${r.peak.toFixed(3)})`);
  assert.ok(r.nearClip < 100, `the limiter is rarely hit (${r.nearClip} samples at 0.99+)`);
  assert.ok(r.counts.contact_hit > 50 && r.counts.piece_settled > 5, 'the bot built something');
  assert.ok(r.rms > 0.005, 'the run is audible');
  for (const [cat, n] of Object.entries(r.voices.peak)) assert.ok(n <= r.voices.limits[cat], `${cat} voices ${n} within cap`);
  assert.ok(r.voices.total <= r.voices.limits.total, 'total voices within cap');
  assert.ok(r.cpu.meanMs < 0.2, `an event costs ${r.cpu.meanMs.toFixed(3)} ms on average`);
  if (r.counts.run_over) assert.equal(r.state.mix.base, 'results', `the run ends on the results mix (${r.mixLog.join(', ')})`);
};

let failed = 0;
const only = process.argv.slice(2);
for (const [name, check] of Object.entries(checks)) {
  if (only.length && !only.includes(name)) continue;
  if (name === 'sim' && !haveSim) {
    console.log(`skip sim: Gameplay's sim was not found at ${gameDir} (run npm install there first)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await page.evaluate(([n, w]) => (n === 'sim' ? window.simScenario(90, 11) : window.scenarios[n](w)), [name, workerCode]);
    check(r);
    console.log(`ok   ${name} (${Date.now() - t0} ms) ${summary(name, r)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
await browser.close();
process.exitCode = failed ? 1 : 0;

function summary(name, r) {
  if (name === 'worker') return `worker bake ${r.workerMs} ms (longest main-thread stall ${r.workerStall} ms) vs main thread ${r.threadMs} ms (stall ${r.threadStall} ms)`;
  if (name === 'sim') return `${r.counts.contact_hit} hits, ${r.counts.piece_settled ?? 0} settles, ${r.counts.piece_lost ?? 0} lost, peak ${r.peak.toFixed(3)}, voices ${r.voices.total}, event ${r.cpu.meanMs.toFixed(3)} ms`;
  if (name === 'bank') return `bake ${r.buildMs} ms, ${r.names} sounds, memory per biome ${r.memoryMB.join('/')} MB`;
  if (name === 'run') return `peak ${r.all.peak.toFixed(3)}, voices ${r.caps.total}/${r.capLimits.total}, contact ${r.contactCpuMs.mean.toFixed(3)} ms`;
  if (name === 'rest') return `resting tower ${r.quietPeakDb} dBFS`;
  if (name === 'loudness') return `${r.softDb} / ${r.midDb} / ${r.hardDb} dB, below-screen ${r.belowDb} dB`;
  return JSON.stringify(r).slice(0, 120);
}

