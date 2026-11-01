// The loading splash, headless at phone size: it is on the page before the game's script runs, its
// Blocklings stack while the game boots, and once the menu is up its logo glides into the menu's own
// logo, lands on it to the pixel, and goes, leaving the menu's logo showing (still, no second drop-in).
// The menu takes taps while it leaves. Reduce Motion fades it instead; a start that fails offers a reload.
//   npm run build:game && node tests/splash-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/splash';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); };

/** A page at Blake's phone size that freezes the splash's hand-over the moment it starts. */
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 448, height: 825 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: o.reducedMotion ?? 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(freeze => {
    window.claude = { use: async () => null };
    // When the DOM is parsed, before the game's module runs.
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      window.__parsed = { splash: !!document.querySelector('#splash .sp-logo img'), game: '__wobble' in window };
      // The first frame after that: the game's script has started, its menu is a while off.
      requestAnimationFrame(() => {
        window.__loading = {
          anims: document.getAnimations().map(a => a.animationName).filter(n => n?.startsWith('sp-')).sort(),
          images: [...document.querySelectorAll('#splash img')].every(i => i.complete && i.naturalWidth > 0),
          menu: !!document.querySelector('.sc-root.show'),
        };
      });
    });
    if (!freeze) return;
    new MutationObserver((_, mo) => {
      const sp = document.getElementById('splash');
      if (!sp?.classList.contains('out')) return;
      mo.disconnect();
      const anims = document.getAnimations().filter(a => !(a instanceof CSSAnimation));
      anims.forEach(a => a.pause());
      const play = document.querySelector('.sc-root [data-action="play"]').getBoundingClientRect();
      const hit = document.elementFromPoint(play.left + play.width / 2, play.top + play.height / 2);
      const logo = document.querySelector('.sc-root .ui-logo');
      window.__handoff = { anims, playHit: !!hit?.closest('.sc-root'), still: logo.classList.contains('ui-still'), hidden: logo.style.visibility === 'hidden' };
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }, o.freeze ?? false);
  if (o.init) await page.addInitScript(o.init);
  await page.goto(url);
  return { ctx, page, errors };
}

// 1. A normal start.
{
  const { ctx, page, errors } = await open({ freeze: true });
  const parsed = await page.evaluate(() => window.__parsed);
  step('the splash is on the page before the game runs', parsed?.splash && !parsed.game, JSON.stringify(parsed));
  await page.screenshot({ path: `${out}/01-loading.png` });
  const loading = await page.waitForFunction(() => window.__loading, null, { timeout: 30000 }).then(h => h.jsonValue());
  step('while the game boots the Blocklings stack, the logo bobs and the clouds drift', ['sp-bob', 'sp-drift', 'sp-drop1', 'sp-drop2', 'sp-drop3'].every(n => loading.anims.includes(n)) && loading.images && !loading.menu, JSON.stringify(loading));

  await page.waitForFunction(() => window.__handoff, null, { timeout: 60000 });
  const ho = await page.evaluate(() => { const { anims, ...rest } = window.__handoff; return { ...rest, n: anims.length }; });
  step('the menu takes taps while the splash leaves', ho.playHit, JSON.stringify(ho));
  step('the menu logo is still (no second drop-in) and hidden until the glide lands', ho.still && ho.hidden, JSON.stringify(ho));
  await page.waitForTimeout(800); // the menu's images decode
  await page.evaluate(() => window.__handoff.anims.forEach(a => { a.currentTime = 260; }));
  await page.screenshot({ path: `${out}/02-glide.png` });
  const land = await page.evaluate(() => {
    window.__handoff.anims.forEach(a => { a.currentTime = (a.effect.getComputedTiming().endTime ?? 0); });
    const l = document.querySelector('#splash .sp-logo').getBoundingClientRect();
    const rs = [...document.querySelectorAll('.sc-root .ui-logo img')].map(r => r.getBoundingClientRect());
    const m = { left: Math.min(...rs.map(r => r.left)) - 3, right: Math.max(...rs.map(r => r.right)) + 3, bottom: Math.max(...rs.map(r => r.bottom)) + 3 };
    return { dx: +(l.left - m.left).toFixed(1), dr: +(l.right - m.right).toFixed(1), db: +(l.bottom - m.bottom).toFixed(1) };
  });
  step('the splash logo lands on the menu logo', Math.abs(land.dx) <= 1.5 && Math.abs(land.dr) <= 1.5 && Math.abs(land.db) <= 1.5, JSON.stringify(land));
  await page.evaluate(() => window.__handoff.anims.forEach(a => a.play()));
  const gone = await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).then(() => true, () => false);
  const after = await page.evaluate(() => { const l = document.querySelector('.sc-root .ui-logo'); return { visible: l.style.visibility !== 'hidden', still: l.classList.contains('ui-still') }; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/03-menu.png` });
  step('then the splash goes and the menu logo shows', gone && after.visible, JSON.stringify(after));
  step('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 2. Reduce Motion: the splash fades, no glide.
{
  // The hand-over's animations are read the moment it starts, as in the normal start: the 220 ms fade can
  // be over before a read after the menu shows, which made this step fail now and then under load.
  const { ctx, page, errors } = await open({
    reducedMotion: 'reduce',
    init: () => new MutationObserver((_, mo) => {
      if (!document.getElementById('splash')?.classList.contains('out')) return;
      mo.disconnect();
      window.__calm = document.getAnimations().filter(a => !(a instanceof CSSAnimation)).map(a => a.effect.target?.id || a.effect.target?.className);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] }),
  });
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 60000 });
  const anims = await page.waitForFunction(() => window.__calm, null, { timeout: 10000 }).then(h => h.jsonValue(), () => []);
  const gone = await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).then(() => true, () => false);
  step('Reduce Motion fades the splash out without the glide', gone && anims.length === 1 && anims[0] === 'splash', JSON.stringify(anims));
  step('no page errors with Reduce Motion', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 3. A start that fails (no WebGL): the splash stays and offers a reload.
{
  const { ctx, page } = await open({ init: () => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : get.call(this, t, ...a); }; } });
  const shown = await page.waitForSelector('#splash .sp-retry', { timeout: 40000 }).then(() => true, () => false);
  await page.screenshot({ path: `${out}/04-failed.png` });
  step('a start that fails keeps the splash and offers a reload', shown, shown ? await page.textContent('#splash .sp-retry') : 'no retry note');
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 2));
for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.info ? `  (${s.info})` : ''}`);
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `${failed} of ${steps.length} steps failed` : `all ${steps.length} steps passed`);
process.exit(failed ? 1 : 0);
