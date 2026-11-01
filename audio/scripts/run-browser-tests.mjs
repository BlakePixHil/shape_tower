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

// Blockling Pop's sim is plain TypeScript (no packages), so its end-to-end test runs whenever it is there
const haveSimPop = existsSync(join(gameDir, 'src/pop/sim/pop.ts'));
let popSimCode = '';
if (haveSimPop) {
  const sim = await build({
    entryPoints: [join(root, 'test/browser/popsim-harness.ts')],
    bundle: true, format: 'iife', target: 'es2022', write: false, logLevel: 'warning',
    alias: { '@pop': join(gameDir, 'src/pop') },
  });
  popSimCode = sim.outputFiles[0].text;
}

// CHROMIUM_PATH overrides the browser Playwright would pick
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: code });
if (simCode) await page.addScriptTag({ content: simCode });
if (popSimCode) await page.addScriptTag({ content: popSimCode });

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
  materials(r) {
    // Stratosphere is glass; Storm Belt is metal (art-direction §4.6)
    assert.deepEqual(r.current, ['glass'], 'no material or biome: the current biome');
    assert.deepEqual(r.placed, ['metal'], 'a piece placed in Storm Belt still sounds like metal in the Stratosphere');
    assert.deepEqual(r.mixed, ['metal', 'glass'], 'each body follows its own biome');
    assert.deepEqual(r.onStone, ['glass', 'stone'], 'an explicit material wins');
  },
  powers(r) {
    assert.deepEqual(r.warnings, [], 'no warnings');
    assert.ok(r.nonFinite === 0 && r.peak <= 1, `the mix stays clean (peak ${r.peak.toFixed(3)})`);
    assert.deepEqual(r.bubble, ['bubble.spawn'], 'a bubble bloops in');
    assert.deepEqual(r.expired, ['boop'], 'an expired bubble fades with a soft boop');
    assert.ok(r.collect.includes('bubble.pop'), 'collecting pops the bubble');
    assert.deepEqual(r.glue, ['glue.on'], 'Glue squelches on');
    assert.ok(r.glueLanding.filter((n) => n === 'glue.squelch').length === 2 && !r.glueLanding.includes('bond.tink'), `glued landings and bonds squelch (${r.glueLanding})`);
    assert.deepEqual(r.refused, ['rotate.blocked'], 'a refused power thunks');
    assert.ok(r.slowIn.includes('slow.in') && r.slowOverlays.includes('slowPower'), 'Slow-Mo stretches in and softens the mix');
    assert.ok(r.slowOut.includes('slow.out') && !r.afterOverlays.includes('slowPower'), 'Slow-Mo is released on power_ended');
    assert.deepEqual(r.glueEnd, ['bubble.pop'], 'Glue ending is one soft pop');
    assert.deepEqual(r.undo, ['undo'], 'Undo fwips');
    assert.deepEqual(r.quickset, ['quickset'], 'Quick-Set cascades');
    assert.deepEqual(r.clean, ['sweep', 'shimmer'], 'Clean Slate sweeps once, then sparkles');
    assert.deepEqual(r.readyAtStart, [], 'Second Wind ready at run start is silent');
    assert.equal(r.earned.filter((n) => n === 'shimmer').length, 2, `earning Second Wind and a granted power each get one soft cue (${r.earned})`);
    assert.ok(r.secondWind.includes('windgust') && !r.secondWind.includes('heartup'), `Second Wind gusts, and its chord stands in for the heart chime (${r.secondWind})`);
  },
  reruns(r) {
    assert.ok(r[0] === 'playing' && r[1] !== 'playing' && r[2] === 'playing' && r[3] === 'playing', `each run starts from its first spawn (${r.join(', ')})`);
  },
};

const BAR = 2.4;
checks.music = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN in the music');
  assert.ok(r.peak <= 1 && r.nearClip === 0, `the music never clips (peak ${r.peak.toFixed(3)})`);
  assert.equal(r.stats.misses, 0, `every note was baked before its bar (${r.stats.misses} missed: ${r.stats.missed.join(" ")})`);
  assert.ok(r.maxVoices <= 16 && r.stats.peakVoices <= 16, `the band stays within its 16 voices (peak ${r.stats.peakVoices})`);
  const at = (what) => r.log.find((e) => e.what === what)?.t;
  const t0 = at('run start');
  const onBar = (t) => t !== undefined && Math.abs(((t - t0) / BAR) - Math.round((t - t0) / BAR)) < 0.01;
  assert.ok(Math.abs(t0 - 0.12) < 0.01, `the run's band starts with the run (${t0})`);
  assert.ok(onBar(at('L2 on')) && Math.abs(at('L2 on') - (t0 + 2 * BAR)) < 0.01, `the groove joins on the bar after the intro (${at('L2 on')})`);
  assert.ok(onBar(at('L3 on')) && at('L3 on') >= t0 + 2 * BAR, `the lead joins on a bar line once the streak reaches 4 (${at('L3 on')})`);
  assert.ok(Math.abs(at('L3 off (tension)') - 12) < 0.15, `high tension takes the lead out right away (${at('L3 off (tension)')})`);
  assert.ok(r.log.some((e) => e.what === 'L3 on' && e.t > 16), 'the lead comes back once the tower calms down');
  assert.ok(onBar(at('L2 off (breakdown)')), `breakdowns start on a bar line (${at('L2 off (breakdown)')})`);
  assert.ok(r.log.some((e) => e.what === 'L2 on' && e.t > at('L2 off (breakdown)')), 'the groove returns after the breakdown');
  assert.ok(onBar(at('L5 on')) && at('L5 on') >= 30.8, `the riser starts in the last 15% to a checkpoint (${at('L5 on')})`);
  assert.equal(at('L5 off (claimed)'), 33, 'the riser resolves on the claim');
  const band = r.log.find((e) => e.what.startsWith('band 2:'));
  // the next bar line not already scheduled (bars go out 0.35 s ahead)
  assert.ok(band && onBar(band.t) && band.t > 36 && band.t < 36 + BAR + 0.35, `Treetops' band takes over on the next bar line (${band?.t})`);
  assert.equal(at('tape stop'), 46, 'game over stops the tape');
  assert.ok(at('results') > 47 && at('results') < 50, `the results loop follows the "nice try" phrase (${at('results')})`);
  const L = r.levels;
  for (const [k, v] of Object.entries(L)) if (k !== 'stopped') assert.ok(v.rmsDb > -48 && v.rmsDb < -14, `music is audible but sits under the effects: ${k} ${v.rmsDb} dB`);
  assert.ok(L.full.rmsDb > L.intro.rmsDb, `the groove adds energy (${L.intro.rmsDb} -> ${L.full.rmsDb} dB)`);
  assert.ok(L.breakdown.rmsDb < L.full.rmsDb, `breakdowns give the ear a rest (${L.breakdown.rmsDb} vs ${L.full.rmsDb} dB)`);
  assert.ok(L.stopped.peakDb < -45, `after the tape stop the music is silent (${L.stopped.peakDb} dBFS)`);
};

checks.screens = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN');
  assert.deepEqual(r.modes, ['menu', 'profile', 'menu', 'off'], 'screens switch the music');
  assert.equal(r.stats.misses, 0, 'the lullaby was baked first');
  assert.ok(r.menuDb > -45 && r.profileDb > -45 && r.backDb > -45, `menus play the lullaby (${r.menuDb} / ${r.profileDb} / ${r.backDb} dB)`);
  // Blake (2026-11-01): switching menus must not restart the music
  const [b0, b1, b2, b3] = r.bars;
  assert.ok(b0 > 2 && b1 >= b0 && b1 <= b0 + 1, `menu to profile carries on at bar ${b0} (then ${b1})`);
  assert.ok(b2 > b1 && b3 >= b2 && b3 <= b2 + 1, `profile to menu carries on at bar ${b2} (then ${b3})`);
  assert.equal(r.log.filter((w) => w === 'menu' || w === 'profile').length, 3, `each switch is logged once (${r.log.join(', ')})`);
  assert.ok(r.afterDb < -70, `'none' fades it out (${r.afterDb} dB)`);
  const x = r.results;
  assert.equal(x.misses, 0, 'the results loop was baked first');
  assert.ok(x.before > 8, `the results loop is in its second pass (${x.before})`);
  assert.equal(x.after, x.before % 8, `the menu carries on from where the results loop is (bar ${x.before} -> ${x.after})`);
  assert.ok(x.bar <= x.after + 1, `and doesn't jump ahead (${x.bar})`);
  assert.deepEqual(x.log, ['results', 'menu'], 'results then menu, no restart');
  assert.ok(x.beforeDb > -45 && x.afterDb > -45, `music plays through the handover (${x.beforeDb} / ${x.afterDb} dB)`);
};

const FLOURISHES = ['shimmer', 'confetti', 'firework', 'kaching', 'swell', 'stonewave', 'foundation', 'phew', 'lockon', 'bond.tink', 'drumroll', 'entry.', 'voice.'];
checks.juice = (r) => {
  const has = (names, n) => names.some((x) => x === n || (n.endsWith('.') && x.startsWith(n)));
  for (const n of ['shimmer', 'confetti', 'kaching', 'lockon', 'firework', 'voice.yay']) assert.ok(has(r.on.names, n), `juice on plays ${n}`);
  for (const n of FLOURISHES) assert.ok(!has(r.off.names, n), `juice off drops ${n} (${r.off.names.join(' ')})`);
  for (const n of ['settle', 'flag', 'row.clack', 'heartpop', 'bubble.pop', 'windgust', 'gust.warn', 'gust.push', 'impact.']) {
    assert.ok(has(r.off.names, n), `juice off keeps ${n} (${r.off.names.join(' ')})`);
  }
  assert.ok(r.off.notes <= 2 && r.on.notes > 15, `the landing melody and stinger chords go with juice off (${r.on.notes} -> ${r.off.notes} notes; the first-gust chime stays)`);
  assert.ok(r.on.log.includes('L3 off (tension)') && !r.off.log.includes('L3 off (tension)'), 'the band follows tension only with juice on');
  assert.ok(r.on.log.includes('tape stop') && !r.off.log.includes('tape stop'), 'only juice on tape-stops');
  assert.ok(r.on.reactive && !r.off.reactive);
};

checks.restart = (r) => {
  assert.ok(r.before.running && r.before.checkpoint === 1 && r.before.mode === 'run', 'the first run is going');
  assert.ok(!r.between.running && r.between.mode === 'off', 'connecting a new bus closes it quietly');
  assert.ok(r.after.running && r.after.checkpoint === 0 && r.after.mode === 'run' && r.after.base === 'playing', 'the new sim gets a fresh run');
  assert.equal(r.starts, 2, 'and a fresh band');
};

checks.voices = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN');
  assert.deepEqual(r.said.map((v) => v.name), ['whee', 'oof', 'yay', 'yay', 'fall', 'aww'], `the right reaction at each moment, one every 4 s (${JSON.stringify(r.said)})`);
  assert.ok(r.said.every((v) => v.bus === 'voices'), 'voices play on their own bus, under their own slider');
  const st = (x) => 12 * Math.log2(x);
  assert.ok(Math.abs(st(r.said[0].rate) - 5) < 0.1 && Math.abs(st(r.said[1].rate) + 5) < 0.1, `a Gumdrop squeaks and a Plank grumbles (${r.said[0].rate}, ${r.said[1].rate})`);
  assert.ok(Math.abs(r.said[2].t - 7.3) < 0.01 && r.said[3].t > r.said[2].t, 'a checkpoint gets a little chorus of yays');
};

checks.achievements = (r) => {
  for (const k of ['on', 'off']) assert.equal(r[k].nonFinite, 0, 'no NaN');
  const on = r.on.notes, off = r.off.notes;
  assert.ok(on.bronze >= 2 && on.bronze < on.gold && on.gold < on.platinum, `the sparkle grows with the tier (${JSON.stringify(on)})`);
  assert.equal(on.tooSoon, 0, 'a second toast within half a second is not stamped twice');
  assert.ok(on.strip >= 3 && on.again === 0, `the run-over strip gets one sting (${JSON.stringify(on)})`);
  assert.deepEqual(r.on.stamps, [1, 3.5, 6, 10], 'every toast and the strip get a stamp');
  assert.equal(r.on.ducks, 0, 'achievements never duck the music');
  assert.ok(r.on.bronzeDb > r.on.landingDb - 12 && r.on.platinumDb < r.on.landingDb, `a toast is heard but stays under the play (bronze ${r.on.bronzeDb}, platinum ${r.on.platinumDb}, a hard landing ${r.on.landingDb} dB RMS)`);
  // juice off keeps the stamp, since it is information, and drops the sparkle
  assert.deepEqual(r.off.stamps, [1, 3.5, 6, 10], 'juice off keeps every stamp');
  assert.ok(Object.values(off).every((n) => n === 0), `juice off drops the sparkle notes (${JSON.stringify(off)})`);
  assert.ok(!r.off.names.includes('shimmer') && !r.off.names.includes('confetti'), `and the shimmer (${r.off.names.join(' ')})`);
};

checks.hold = (r) => {
  const { on, off, zen } = r;
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what} (${a} against ${b} dB)`);
  near(on.start, on.base, 1.5, 'the hold starts with the music where it was');
  near(on.full, on.start - 6, 1, 'a full ring drains the music by about 6 dB');
  assert.ok(on.knock < on.full - 3, `a knock in the hold dips the music (${on.knock} against ${on.full} dB)`);
  near(on.after, on.base, 1.5, 'the music comes back when the hold ends');
  // juice off: the hold overlay only, no drain and no breath
  near(off.full, off.start, 1, 'juice off does not drain the music');
  near(off.knock, off.full, 1, 'juice off does not dip on a knock');
  // Zen has no countdown pressure: the same as juice off here
  near(zen.full, zen.start, 1, 'a Zen hold does not drain the music');
  near(zen.knock, zen.full, 1, 'a Zen hold does not dip on a knock');
};

checks.gusts = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN');
  assert.ok(r.builtDb > -45, `a warning builds toward its gust (${r.builtDb} dB)`);
  assert.ok(r.cancelledDb < r.builtDb - 30, `a cancelled warning stops building (${r.cancelledDb} dB against ${r.builtDb} dB)`);
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
  assert.ok(r.runs.length >= 2 && r.counts.run_over >= 1, `the bot played more than one run (${r.runs.length})`);
  for (const run of r.runs.slice(1)) {
    const started = r.mixLog.some((m) => Number(m.split(':')[0]) >= run.from && m.endsWith('->playing'));
    assert.ok(started && run.hits > 0, `a later run, connected after its run_start, gets the playing mix (${r.mixLog.join(', ')})`);
  }
  assert.ok(r.mixLog.some((m) => m.endsWith('->results')), `a run ends on the results mix (${r.mixLog.join(', ')})`);
  assert.ok(r.counts.power_used > 0 && r.counts.second_wind > 0, 'the bot used power-ups and Second Wind');
  assert.equal(r.musicRuns, r.runs.length, `the band plays in every run (${r.musicRuns} of ${r.runs.length})`);
  assert.equal(r.music.misses, 0, `every band note was baked in time (${r.music.misses} missed: ${r.music.missed.join(' ')})`);
  assert.ok(r.music.peakVoices <= 16, `the band stays within its 16 voices (${r.music.peakVoices})`);
  // audio section 4.8: about 25 MB of effects, 20 MB of instruments for two biomes, 15 MB of ambience
  assert.ok(r.memoryMB < 60, `decoded audio stays under 60 MB with the band playing (${r.memoryMB} MB)`);
  // the bot stays in Meadow and Treetops: wood pieces on stone slabs
  assert.ok(r.played.wood > 0 && r.played.stone > 0, `pieces sound like wood and slabs like stone (${JSON.stringify(r.played)})`);
};

// Blockling Pop (Pop plan, Music and sound)
const near = (a, b, tol, what) => assert.ok(a !== undefined && Math.abs(a - b) <= tol, `${what} at ${b.toFixed(2)} s (got ${a})`);

checks.pop = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN in the mix');
  assert.ok(r.peak <= 1, `the band never exceeds full scale (peak ${r.peak.toFixed(3)})`);
  assert.equal(r.bpm, 96, 'Pop plays at 96 BPM');
  assert.equal(r.misses, 0, `every note was baked in time (${r.missed.join(' ')})`);
  assert.ok(r.peakVoices <= 16, `the band stays within its 16 voices (${r.peakVoices})`);
  const times = (what) => r.log.filter((e) => e.what === what).map((e) => e.t);
  const at = (what, i = 0) => times(what)[i];
  // the first downbeat waited for the bed to bake, then a bar every 2.5 s
  const bar0 = at('groove on') - 2.5;
  assert.ok(bar0 > 0.1 && bar0 < 1.1, `the run's first bar starts within a second (${bar0})`);
  const bar = (n) => bar0 + n * 2.5;
  near(at('groove on'), bar(1), 0.011, 'the groove comes in on the bar after the first pop');
  near(at('lead on'), bar(3), 0.011, 'the lead comes in at combo 3');
  near(at('sparkle on'), bar(5), 0.011, 'sparkle comes in at combo 6');
  near(at('sparkle off'), bar(6), 0.011, 'sparkle leaves when the combo ends');
  near(at('lead off'), bar(7), 0.011, 'the lead holds two bars after the combo, then leaves');
  near(at('tension on'), bar(8), 0.011, 'tension comes in at 70% full');
  assert.ok(times('groove off').some((t) => Math.abs(t - bar(8)) < 0.011), 'the groove thins under tension');
  near(at('tension off'), bar(10), 0.011, 'tension holds at 60% full and lifts below 55%');
  near(at('breather on'), bar(11), 0.011, 'the breather comes in when the board drops under 20%');
  near(at('breather off'), bar(15), 0.011, 'the breather lasts 4 bars');
  // All Clear at 39 s: the fanfare on the next beat, two bars, then the breather
  const fan = at('fanfare');
  assert.ok(fan > 39.04 && fan <= 39.04 + 0.625 + 0.01, `the fanfare starts on the next beat after the All Clear (${fan})`);
  const beats = (fan - bar0) / 0.625;
  assert.ok(Math.abs(beats - Math.round(beats)) < 0.02, `the fanfare lands on the band's beat grid (${beats.toFixed(3)} beats)`);
  near(at('sparkle on', 1), fan, 0.011, 'the fanfare brings in the sparkle');
  near(at('breather on', 1), fan + 5, 0.011, 'the breather follows two bars of fanfare');
  // run over at 55 s: tape stop, "nice try" from 55.9 s for two bars, then Pop's results loop
  near(at('tape stop'), 55, 0.011, 'the tape stop');
  near(at('nice try'), 55.9, 0.011, '"nice try"');
  near(at('popResults'), 60.9, 0.011, "Pop's results loop after two bars of nice try");
  assert.equal(r.mode, 'popResults');
  const L = r.levels;
  assert.ok(L.groove > L.bed && L.full > L.groove, `each layer adds to the mix (bed ${L.bed}, groove ${L.groove}, full ${L.full} dB)`);
  assert.ok(L.breather < L.groove - 3, `the breather is a breath (${L.breather} against ${L.groove} dB)`);
  assert.ok(L.fanfare > L.groove, `the fanfare is the loudest moment (${L.fanfare} dB)`);
  for (const k of ['tension', 'niceTry', 'results']) assert.ok(L[k] > -40 && L[k] < -20, `${k} is heard at a lounge level (${L[k]} dB)`);
};

checks.popsfx = (r) => {
  const on = r.on, off = r.off;
  for (const x of [on, off]) {
    assert.equal(x.nonFinite, 0, 'no NaN in the mix');
    assert.ok(x.peak <= 1, `the mix never exceeds full scale (peak ${x.peak.toFixed(3)})`);
  }
  const boops = on.plays.filter((p) => p.name === 'pop.boop');
  assert.ok(boops.length === 2 && boops[0].rate > 1.3 && boops[1].rate < 0.85, `a Pip squeaks and a Plank grumbles when picked up (${boops.map((b) => b.rate.toFixed(2))})`);
  const snaps = on.plays.filter((p) => p.name === 'pop.snap');
  assert.equal(snaps.length, 2, 'two ghost snaps 20 ms apart make one sound');
  assert.ok(snaps[1].rate > snaps[0].rate, 'a ghost that would pop lines snaps higher');
  assert.ok(on.shimmerAt.held && !on.shimmerAt.placed, 'the would-pop shimmer plays while held and stops on the drop');
  assert.equal(on.plays.filter((p) => p.name === 'pop.shimmer').length, 1, 'one shimmer while the count changes');
  assert.equal(on.placeNotes, 1, 'a placement plays one landing note');
  // the glissando: two lines, the first notes at once, then 39 ms steps from the end of the 60 ms freeze
  // each step plays both lines (a third apart); the lone high note is the two-line pop's sparkle
  const per = new Map();
  for (const n of on.gliss) per.set(n.when, (per.get(n.when) ?? 0) + 1);
  const steps = [...per].filter(([, c]) => c === 2).map(([t]) => t).sort((a, b) => a - b);
  assert.equal(steps.length, 9, `nine steps for two 9-cell lines (${steps.length})`);
  assert.equal(steps[0], 2, 'the first note sounds at once');
  near(steps[1], 2 + 0.06 + 0.039, 0.0005, 'the second note after the freeze');
  for (let k = 2; k < 9; k++) near(steps[k] - steps[k - 1], 0.039, 0.0005, `step ${k} 39 ms later`);
  const g = on.grid, sixteenth = g.beat / 4;
  const answer = on.answer.filter((c) => c.inst !== 'keys');
  assert.ok(answer.length >= 1, 'the board answers the pop');
  for (const c of on.answer) {
    const k = (c.when - g.t0) / sixteenth;
    assert.ok(c.when >= 2.04 && Math.abs(k - Math.round(k)) < 1e-3, `the answer lands on the next sixteenth (${c.when.toFixed(4)}, ${k.toFixed(3)} sixteenths)`);
  }
  assert.ok(on.plays.filter((p) => p.name === 'pop.uh').length === 1, 'a shape that stops fitting says "uh" once');
  assert.equal(on.plays.filter((p) => p.name === 'ui.error').length, 1, '"No room!" plays once, not again at the run over');
  assert.ok(on.said.includes('aww'), 'the Blocklings go "aww" at the end');
  for (const h of ['light', 'select', 'medium', 'heavyDouble', 'error']) assert.ok(on.haptics.includes(h), `haptic ${h}`);
  // juice off: what happened stays, the flourishes go
  for (const n of ['pop.boop', 'pop.snap', 'pop.shimmer', 'row.clack', 'pop.plip', 'ui.error']) assert.ok(off.plays.some((p) => p.name === n), `juice off keeps ${n}`);
  assert.equal(off.plays.filter((p) => p.name === 'pop.plip').length, 9, 'juice off still plays the wave');
  assert.ok(off.gliss.length === 0 && off.answer.length === 0 && off.placeNotes === 0, 'juice off drops the board notes');
  assert.ok(!off.plays.some((p) => p.name.startsWith('voice.') || p.name === 'pop.uh'), 'juice off drops the voices');
  assert.equal(on.misses + off.misses, 0, 'the band missed no notes');
};

checks.popscreens = (r) => {
  const at = (what, i = 0) => r.log.filter((e) => e.what === what).map((e) => e.t)[i];
  assert.equal(r.nonFinite, 0, 'no NaN in the mix');
  assert.equal(r.misses, 0, 'the lounge and the run missed no notes');
  near(at('menu'), 0.1, 0.011, 'the menu plays the lullaby');
  near(at('pop'), 3, 0.011, 'the Pop hub plays the lounge');
  near(at('pop start'), 8, 0.011, 'a run starts its band');
  near(at('popResults'), 18.9, 0.011, "the run's results loop");
  near(at('pop', 1), 23, 0.011, 'back to the hub');
  near(at('menu', 1), 26, 0.011, 'out to the menu');
  // results to the hub: the same lounge on one clock, carrying on from the loop's bar
  const [before, after, next] = r.bars.hub;
  assert.ok(after === before && next === before, `the lounge carries on from the results loop (bar ${before} -> ${after}, ${next})`);
  assert.ok(Math.min(...r.around) > -40, `no gap from the results to the hub (${r.around.join(', ')} dB)`);
  assert.equal(r.bars.menu[0], 0, 'the main menu crossfades to its own lullaby');
  for (const [k, v] of Object.entries(r.levels)) assert.ok(v > -40, `${k} is playing (${v} dB)`);
  assert.equal(r.mode, 'menu');
};

checks.popsim = (r) => {
  assert.equal(r.nonFinite, 0, 'no NaN in the mix');
  assert.ok(r.peak <= 1, `the mix never exceeds full scale (peak ${r.peak.toFixed(3)})`);
  assert.ok(r.nearClip < 100, `the limiter is rarely hit (${r.nearClip} samples at 0.99+)`);
  assert.ok(r.counts.pop_place > 50 && r.counts.pop_lines > 10, `the bot played (${r.counts.pop_place} placements, ${r.counts.pop_lines} pops)`);
  assert.ok(r.runs.length >= 2 && r.counts.pop_run_over >= 1, `the bot played more than one run (${r.runs.length})`);
  assert.ok(r.rms > 0.005, 'the run is audible');
  for (const [cat, n] of Object.entries(r.voices.peak)) assert.ok(n <= r.voices.limits[cat], `${cat} voices ${n} within cap`);
  assert.ok(r.voices.total <= r.voices.limits.total, 'total voices within cap');
  assert.ok(r.cpu.meanMs < 0.25, `an event costs ${r.cpu.meanMs.toFixed(3)} ms on average`);
  assert.equal(r.music.misses, 0, `every band note was baked in time (${r.music.missed.join(' ')})`);
  assert.ok(r.music.peakVoices <= 16, `the band stays within its 16 voices (${r.music.peakVoices})`);
  assert.equal(r.starts, r.runs.length, 'the band starts with every run');
  assert.equal(r.niceTries, r.counts.pop_run_over, '"nice try" after every run over');
  for (const l of ['groove', 'lead']) assert.ok(r.layers.includes(l), `the ${l} layer played (${r.layers.join(', ')})`);
  assert.ok(r.bands.length >= 1, `a new biome brought its band (${r.bands.join(', ')})`);
  // milestone 3 sims: the bot uses its head-start power, Spin and Second Wind
  if (r.counts.pop_bubble) assert.ok(Object.keys(r.powers).length > 0 && r.counts.pop_power_got !== 0, `the bot used powers (${JSON.stringify(r.powers)})`);
  // Pop holds fewer effects than the tower and a bigger note cache: the same 60 MB budget
  assert.ok(r.memoryMB < 60, `decoded audio stays under 60 MB in Pop (${r.memoryMB} MB)`);
  assert.equal(r.mode, 'pop');
};

let failed = 0;
const only = process.argv.slice(2);
for (const [name, check] of Object.entries(checks)) {
  if (only.length && !only.includes(name)) continue;
  if (name === 'sim' && !haveSim) {
    console.log(`skip sim: Gameplay's sim was not found at ${gameDir} (run npm install there first)`);
    continue;
  }
  if (name === 'popsim' && !haveSimPop) {
    console.log(`skip popsim: Blockling Pop's sim was not found at ${gameDir}/src/pop/sim`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await page.evaluate(([n, w]) => (n === 'sim' ? window.simScenario(150, 11) : n === 'popsim' ? window.popSimScenario(150, 5) : window.scenarios[n](w)), [name, workerCode]);
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
  if (name === 'sim') return `${r.runs.length} runs, ${r.counts.contact_hit} hits (${Object.entries(r.played).map(([m, n]) => `${m} ${n}`).join(', ')}), ${r.counts.piece_settled ?? 0} settles, ${r.counts.power_used ?? 0} powers and ${r.counts.second_wind ?? 0} Second Winds used, peak ${r.peak.toFixed(3)}, voices ${r.voices.total}, event ${r.cpu.meanMs.toFixed(3)} ms; band ${r.music.notes} notes, ${r.music.stolen} stolen, peak ${r.music.peakVoices} voices, memory ${r.memoryMB} MB; ${Object.entries(r.ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(", ")}`;
  if (name === 'bank') return `bake ${r.buildMs} ms, ${r.names} sounds, memory per biome ${r.memoryMB.join('/')} MB`;
  if (name === 'run') return `peak ${r.all.peak.toFixed(3)}, voices ${r.caps.total}/${r.capLimits.total}, contact ${r.contactCpuMs.mean.toFixed(3)} ms`;
  if (name === 'rest') return `resting tower ${r.quietPeakDb} dBFS`;
  if (name === 'achievements') return `notes per tier ${['bronze', 'gold', 'platinum', 'strip'].map((k) => `${k} ${r.on.notes[k]}`).join(', ')}; bronze ${r.on.bronzeDb}, platinum ${r.on.platinumDb} against a hard landing ${r.on.landingDb} dB RMS; juice off: stamps only`;
  if (name === 'hold') return `music ${r.on.base} dB, hold ${r.on.start}, full ring ${r.on.full}, knock ${r.on.knock}, after ${r.on.after}; juice off full ring ${r.off.full}, Zen ${r.zen.full}`;
  if (name === 'music') return `levels ${Object.entries(r.levels).map(([k, v]) => `${k} ${v.rmsDb}`).join(', ')} dB; ${r.stats.notes} notes, ${r.stats.stolen} stolen, ${r.stats.dropped} dropped, peak ${r.stats.peakVoices} voices`;
  if (name === 'screens') return `menu ${r.menuDb} dB, profile ${r.profileDb} dB, back ${r.backDb} dB, after ${r.afterDb} dB; bars ${r.bars.join('/')}; results ${r.results.before} -> menu ${r.results.after}`;
  if (name === 'pop') return `layers ${r.log.filter((e) => / on$|fanfare|nice try|popResults/.test(e.what)).map((e) => `${e.what.replace(/ on$/, '')} ${e.t}`).join(', ')}; levels ${Object.entries(r.levels).map(([k, v]) => `${k} ${v}`).join(', ')} dB`;
  if (name === 'popsfx') return `gliss ${r.on.gliss.length} notes, answer at ${r.on.answer.map((c) => c.when.toFixed(3)).join('/')}, juice off ${r.off.plays.length} sounds`;
  if (name === 'popscreens') return `${r.log.map((e) => `${e.what} ${e.t}`).join(', ')}; levels ${Object.entries(r.levels).map(([k, v]) => `${k} ${v}`).join(', ')} dB`;
  if (name === 'popsim') return `${r.runs.length} runs (${r.runs.map((x) => `${x.moves} moves, ${x.lines} lines, cp ${x.cp}`).join('; ')}), layers ${r.layers.join('/')}, bands ${r.bands.join('/') || 'one'}, powers ${Object.entries(r.powers).map(([k, v]) => `${k} ${v}`).join('/') || 'none'}, peak ${r.peak.toFixed(3)}, voices ${r.voices.total}, event ${r.cpu.meanMs.toFixed(3)} ms; band ${r.music.notes} notes, ${r.music.stolen} stolen, peak ${r.music.peakVoices} voices, memory ${r.memoryMB} MB`;
  if (name === 'loudness') return `${r.softDb} / ${r.midDb} / ${r.hardDb} dB, below-screen ${r.belowDb} dB`;
  return JSON.stringify(r).slice(0, 120);
}

