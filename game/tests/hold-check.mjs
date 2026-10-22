// Plays the built game headless to a checkpoint's hold (Blake, 2026-10-21: "when the checkpoint is
// counting down, the screen should slightly fade grayscale (not fully) and pause on shape interactions
// briefly"): the screen fades part-way to grey as the hold fills while the checkpoint itself keeps its
// colour (Art), a knock during it freezes the frame for a beat, colour comes back with a little
// overshoot once the checkpoint is claimed, and Zen stays in colour.
//   npm run build:game && node tests/hold-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/hold';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
// At 1x: the software renderer draws the hold's extra grey pass slowly, and the sim slows with it.
const DSF = 1;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => { window.claude = { use: async () => null }; });
await page.goto(url);
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); if (process.env.HOLD_DEBUG) console.error(ok ? 'ok' : 'FAIL', name, info.slice(0, 300)); };
const mood = () => page.evaluate(() => {
  const sc = window.__wobble.scene, f = sc.holdFilter, line = sc.lines.at(-1), main = sc.cameras.main;
  return {
    grey: sc.grey, active: !!f?.active, alpha: f?.colorMatrix.alpha ?? null, front: sc.frontFilter?.colorMatrix.alpha ?? null, hold: sc.sim.holdState(), juice: sc.view.juice !== false,
    split: sc.split, cams: [sc.lineCam?.visible, sc.frontCam?.visible],
    // Where each camera draws the active line: on the plain camera only.
    lineOn: line ? line.parts().every(o => o.cameraFilter === (main.id | sc.frontCam.id)) : null,
  };
});

// The screenshot's colour: mean chroma (max - min channel, 0 to 1) inside a box, read in the page.
// Boxes are in world px around a point, and turned into screenshot px through the main camera.
const where = () => page.evaluate(k => {
  const sc = window.__wobble.scene, cam = sc.cameras.main, cv = sc.game.canvas, r = cv.getBoundingClientRect();
  const toShot = (wx, wy) => [(r.left + (wx - cam.worldView.x) * cam.zoom * r.width / cv.width) * k, (r.top + (wy - cam.worldView.y) * cam.zoom * r.height / cv.height) * k];
  const plaque = sc.lines.at(-1).parts()[2], cell = sc.ppb * cam.zoom * r.width / cv.width * k;
  return { plaque: [...toShot(plaque.x, plaque.y), 0.35 * cell], sky: [0.25 * innerWidth * k, 0.22 * innerHeight * k, 0.12 * innerWidth * k] };
}, DSF);
const chroma = (png, boxes) => page.evaluate(async ({ b64, boxes }) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const res = {};
  for (const [k, [x, y, h]] of Object.entries(boxes)) {
    const d = g.getImageData(Math.round(x - h), Math.round(y - h), Math.round(2 * h), Math.round(2 * h)).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
    res[k] = Math.round(sum / (d.length / 4) * 1000) / 1000;
  }
  return res;
}, { b64: png.toString('base64'), boxes });
const shoot = async name => { const png = await page.screenshot({ path: `${out}/${name}.png` }); return chroma(png, await where()); };

await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(2000);
await page.click('[data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });
const before = await mood();
step('a run starts in full colour, with the filter off and one camera', before.juice && before.grey === 0 && before.active === false && !before.split && !before.cams[0] && !before.cams[1], JSON.stringify(before));

// Log the scene's hit-stops and the sim's knocks (contacts of 1 block/s or more), each with whether
// a hold was filling at the time.
await page.evaluate(() => {
  const sc = window.__wobble.scene, orig = sc.hooks.onJuice, onEvent = sc.onEvent.bind(sc);
  window.__stops = [];
  window.__knocks = [];
  // "During the hold" is the scene's own reading of the events: a knock that breaks the hold counts.
  sc.hooks.onJuice = (n, p) => { if (n === 'hitstop') window.__stops.push({ ms: p.ms, hold: sc.holdOn, zen: sc.sim.tuning.zen }); orig?.(n, p); };
  sc.onEvent = e => { if (e.name === 'contact_hit' && e.payload.approachSpeed >= 1) window.__knocks.push({ speed: Math.round(e.payload.approachSpeed * 10) / 10, hold: sc.holdOn }); onEvent(e); };
  sc.sim.tuning.infiniteHearts = true;
  sc.sim.tuning.infiniteBudget = true;
});
// The ring fills in sim time, and the sim's pace under the software renderer swings from run to
// run, so the test never races it: the ring is held at 60% (deep enough grey to measure) until the
// knock is in, then let go. A shape is in hand before each hold starts, because the next shape
// waits until a hold resolves.
const drop = x => page.evaluate(x => { const sim = window.__wobble.scene.sim; if (sim.ctrl && !sim.ctrl.hard) { sim.intent({ type: 'moveTo', x }); sim.intent({ type: 'hardDrop' }); return true; } return false; }, x);
const inHand = () => page.waitForFunction(() => { const s = window.__wobble.scene.sim; return !!s.ctrl && !s.ctrl.hard; }, null, { timeout: 30000 });
const placed = () => page.evaluate(() => window.__wobble.scene.sim.stats.placed);
const holdAt = progress => page.evaluate(progress => {
  const s = window.__wobble.scene.sim;
  s.tuning.holdTime = 1e9;
  s.lineY = s.height().committed;
  return new Promise(res => { const t0 = performance.now(), tick = () => { if (s.holdState().active) { s.hold.progress = progress; res(true); } else if (performance.now() - t0 > 15000) res(false); else setTimeout(tick, 20); }; tick(); });
}, progress);
for (let i = 0; i < 2; i++) { await inHand(); await drop(i * 2 - 1); }
await page.waitForFunction(() => { const s = window.__wobble.scene.sim; return s.stats.placed >= 2 && s.height().committed > s.foundation.top + 0.5; }, null, { timeout: 30000 });
await inHand();
await page.waitForTimeout(1500);
const colour0 = await shoot('00-before-hold');
await holdAt(0.6);
await page.waitForFunction(() => window.__wobble.scene.grey > 0.35, null, { timeout: 30000 }).catch(() => {});
const during = await mood();
const colour1 = await shoot('01-hold-grey');
step('the screen fades part-way to grey while the hold fills', during.hold.active && during.active && during.grey > 0.15 && during.grey <= 0.56 && during.alpha === during.grey && during.front === during.grey, JSON.stringify(during));
step('the checkpoint goes on its own plain camera meanwhile', during.split && during.cams[0] && during.cams[1] && during.lineOn === true, JSON.stringify(during));
const ratio = k => Math.round(colour1[k] / Math.max(0.001, colour0[k]) * 100) / 100;
step('on screen, the sky loses colour and the checkpoint plaque keeps it', ratio('sky') < 1 - 0.6 * during.grey && ratio('plaque') > 0.9, JSON.stringify({ before: colour0, during: colour1, sky: ratio('sky'), plaque: ratio('plaque') }));

// The shape in hand, hard-dropped onto the tower during the hold, knocks it (a hard drop lands at
// 2 blocks/s): a freeze-frame, even when the knock jostles the top and breaks the hold.
await drop(0);
await page.waitForFunction(() => window.__stops.some(s => s.hold), null, { timeout: 20000 }).catch(() => {});
const stops = await page.evaluate(() => ({ stops: window.__stops, knocks: window.__knocks.filter(k => k.hold), hold: window.__wobble.scene.sim.holdState() }));
const knock = stops.stops.find(s => s.hold);
step('a knock during the hold freezes the frame for a beat', !!knock && knock.ms >= 60 && knock.ms <= 120, JSON.stringify(stops));

// Let the ring finish (the line sits just under the tower top; a broken hold starts again once the
// top settles), sampling the filter's mix each frame from before the claim: colour comes back past
// normal (a negative mix), then settles.
await page.evaluate(() => {
  const sc = window.__wobble.scene, s = sc.sim;
  window.__mix = [];
  const tick = () => { window.__mix.push({ t: performance.now(), mix: sc.holdFilter.colorMatrix.alpha, pop: sc.greyPop, cp: s.checkpoint, split: sc.split }); if (window.__mix.length < 2000) requestAnimationFrame(tick); };
  tick();
  s.lineY = Math.min(s.lineY, s.height().committed);
  s.tuning.holdTime = 0.5;
});
await page.waitForFunction(() => window.__wobble.scene.sim.checkpoint >= 2, null, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => window.__wobble.scene.grey === 0 && window.__wobble.scene.greyPop === -1, null, { timeout: 15000 }).catch(() => {});
const after = await mood();
await page.screenshot({ path: `${out}/02-claimed.png` });
// Frames here come too far apart to catch a 150 ms beat, so the claim's overshoot is checked for
// starting, and its curve is read by running the scene's mood at chosen times.
const mix = await page.evaluate(() => {
  const sc = window.__wobble.scene, m = window.__mix, post = m.filter(x => x.cp >= 2);
  const seen = { popped: post.some(x => x.pop >= 0), low: Math.min(...post.map(x => x.mix)), splitWhilePop: post.some(x => x.pop >= 0 && x.split) };
  const at0 = 1e9, curve = {};
  sc.greyPop = at0; sc.greyPopFrom = 0.5;
  for (const t of [0, 35, 70, 100, 150, 219, 300, 400, 469, 480]) { sc.updateHoldMood(0, at0 + t); curve[t] = Math.round(sc.holdFilter.colorMatrix.alpha * 1000) / 1000; }
  return { seen, curve, after: sc.greyPop };
});
const c = mix.curve, over = Object.entries(c).filter(([, v]) => v <= -0.19).map(([t]) => Number(t));
step('on the claim the colour overshoots (about 1.2 saturation for 150 ms) on one camera, then settles', mix.seen.popped && !mix.seen.splitWhilePop && c[0] === 0.5 && Math.min(...Object.values(c)) >= -0.2 && over.length && Math.max(...over) - Math.min(...over) >= 100 && Math.max(...over) - Math.min(...over) <= 200 && c[300] < 0 && c[300] > -0.2 && c[480] === 0 && mix.after === -1, JSON.stringify(mix));
step('after the claim the colour is back, the filter is off and the extra cameras are hidden', after.grey === 0 && after.active === false && !after.split && !after.cams[0] && !after.cams[1] && (await page.evaluate(() => window.__wobble.scene.sim.checkpoint)) >= 2, JSON.stringify(after));

// Zen has no countdown to build up to: a hold there stays in colour, and a knock doesn't freeze.
// One shape on the new slab, then a hold (held open again) with a shape in hand to knock with.
await page.evaluate(() => { const s = window.__wobble.scene.sim; s.tuning.zen = true; window.__stops.length = 0; window.__knocks.length = 0; });
await inHand();
const n0 = await placed();
await drop(0);
await page.waitForFunction(n0 => window.__wobble.scene.sim.stats.placed > n0, n0, { timeout: 30000 }).catch(() => {});
await inHand();
await page.waitForTimeout(1500);
const zenHeld = await holdAt(0.6);
const zenGrey = await mood();
const n1 = await placed();
await drop(0);
await page.waitForFunction(n1 => window.__wobble.scene.sim.stats.placed > n1, n1, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
const zen = await mood();
const zenHits = await page.evaluate(() => ({ stops: window.__stops.filter(s => s.hold), knocks: window.__knocks.filter(k => k.hold) }));
step('in Zen a hold stays in colour and a knock does not freeze', zenHeld && [zenGrey, zen].every(m => m.grey === 0 && !m.active && !m.split) && zenHits.knocks.length > 0 && zenHits.stops.length === 0, JSON.stringify({ zenHeld, zenGrey, zen, zenHits }));

const failed = steps.filter(s => !s.ok).map(s => s.name);
console.log(JSON.stringify({ steps, failed, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (failed.length || errors.length) process.exitCode = 1;
