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

// The frame's colour, read from the canvas itself at the end of the next frame (so no HUD or toast
// gets in), with the hold's grey left on or switched off for that one frame. Two frames in a row
// show the same scene, so nothing moves between them. Mean chroma (max - min channel, 0 to 1) in
// two boxes: the scene above the line (sky, clouds, the shape in hand) and the checkpoint plaque.
const frameColour = grey => page.evaluate(grey => new Promise(res => {
  const sc = window.__wobble.scene, game = sc.game, gl = game.renderer.gl;
  sc.events.once('prerender', () => { if (!grey) { sc.holdFilter.setActive(false); sc.frontFilter.setActive(false); } });
  game.events.once('postrender', () => {
    const cam = sc.cameras.main, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const box = (x, y, w, h) => {
      [x, y, w, h] = [x, y, w, h].map(Math.round);
      const d = new Uint8Array(w * h * 4);
      gl.readPixels(x, H - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
      return Math.round(sum / (d.length / 4) * 1000) / 1000;
    };
    const plaque = sc.lines.at(-1).parts()[2], r = 0.35 * sc.ppb * cam.zoom;
    const px = (plaque.x - cam.worldView.x) * cam.zoom, py = (plaque.y - cam.worldView.y) * cam.zoom;
    res({ scene: box(0, 0.05 * H, W, 0.35 * H), plaque: box(px - r, py - r, 2 * r, 2 * r), filterOn: sc.holdFilter.active });
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
  });
}), grey);

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
  // The checkpoint keeps its colour however slowly the software renderer draws, until the step that checks the other way.
  sc.sim.tuning.holdSplitMs = 1e9;
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
await holdAt(0.6);
// A tower still settling can break the hold and start it again from nothing, so the ring is pinned
// back to 60% until the grey is in.
await page.waitForFunction(() => { const sc = window.__wobble.scene, s = sc.sim; if (s.holdState().active && s.hold.progress < 0.6) s.hold.progress = 0.6; return sc.grey > 0.35; }, null, { timeout: 30000 }).catch(() => {});
const during = await mood();
await page.screenshot({ path: `${out}/01-hold-grey.png` });
const colour1 = await frameColour(true), colour0 = await frameColour(false);
step('the screen fades part-way to grey while the hold fills', during.hold.active && during.active && during.grey > 0.15 && during.grey <= 0.56 && during.alpha === during.grey && during.front === during.grey, JSON.stringify(during));
step('the checkpoint goes on its own plain camera meanwhile', during.split && during.cams[0] && during.cams[1] && during.lineOn === true, JSON.stringify(during));
const ratio = k => Math.round(colour1[k] / Math.max(0.001, colour0[k]) * 100) / 100;
step('on screen, the scene loses colour and the checkpoint plaque keeps it', colour1.filterOn && !colour0.filterOn && colour0.scene > 0.05 && ratio('scene') < 1 - 0.6 * during.grey && ratio('plaque') > 0.9, JSON.stringify({ grey: colour1, plain: colour0, scene: ratio('scene'), plaque: ratio('plaque') }));

// Objects are sorted onto the cameras when the split starts, and the ones added during it at the
// next frame, once their depth is set (#65): an effect in front of the line, a backdrop piece behind it.
const added = await page.evaluate(() => new Promise(res => {
  const sc = window.__wobble.scene, m = sc.cameras.main.id, l = sc.lineCam.id, f = sc.frontCam.id;
  const fx = sc.add.rectangle(0, 0, 4, 4, 0xffffff).setDepth(30), bg = sc.add.rectangle(0, 0, 4, 4, 0xffffff).setDepth(1);
  sc.game.events.once('postrender', () => {
    res({ split: sc.split, front: fx.cameraFilter === (m | l), back: bg.cameraFilter === (l | f) });
    fx.destroy(); bg.destroy();
  });
}));
step('shapes and effects added during the hold land on the right camera', added.split && added.front && added.back, JSON.stringify(added));

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

// Where frames already draw slowly, the split's two extra cameras and second grey pass cost too
// much (#65): the hold greys the checkpoint with the rest, on one camera. Then the ring finishes.
await page.evaluate(() => { window.__wobble.scene.sim.tuning.holdSplitMs = 0; });
await inHand();
const n2 = await placed(), cp2 = await page.evaluate(() => window.__wobble.scene.sim.checkpoint);
await drop(0);
await page.waitForFunction(n2 => window.__wobble.scene.sim.stats.placed > n2, n2, { timeout: 30000 }).catch(() => {});
await inHand();
await page.waitForTimeout(1500);
const liteHeld = await holdAt(0.6);
await page.waitForFunction(() => { const sc = window.__wobble.scene, s = sc.sim; if (s.holdState().active && s.hold.progress < 0.6) s.hold.progress = 0.6; return sc.grey > 0.35; }, null, { timeout: 30000 }).catch(() => {});
const lite = await mood();
const liteGrey = await frameColour(true), litePlain = await frameColour(false);
const liteRatio = k => Math.round(liteGrey[k] / Math.max(0.001, litePlain[k]) * 100) / 100;
step('where frames draw slowly, the hold greys the checkpoint too, on one camera', liteHeld && lite.hold.active && lite.active && lite.grey > 0.15 && !lite.split && !lite.cams[0] && !lite.cams[1] && liteGrey.filterOn && liteRatio('scene') < 1 - 0.6 * lite.grey && liteRatio('plaque') < 1 - 0.6 * lite.grey, JSON.stringify({ liteHeld, lite, grey: liteGrey, plain: litePlain, scene: liteRatio('scene'), plaque: liteRatio('plaque') }));
await page.evaluate(() => { const s = window.__wobble.scene.sim; s.lineY = Math.min(s.lineY, s.height().committed); s.tuning.holdTime = 0.5; s.tuning.holdSplitMs = 1e9; });
await page.waitForFunction(cp2 => window.__wobble.scene.sim.checkpoint > cp2, cp2, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => window.__wobble.scene.grey === 0 && window.__wobble.scene.greyPop === -1, null, { timeout: 15000 }).catch(() => {});

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
