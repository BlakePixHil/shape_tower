// Bakes the phone app's launcher icons and splash screens from Art's brand art (art/src/brand.ts)
// into android/app/src/main/res. Run after changing the art: node scripts/bake-native-assets.mjs
// Needs Chromium (Playwright) for the canvas, and the network once for Art's fonts.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rolldown } from 'rolldown';

const at = p => new URL(p, import.meta.url).pathname;
const RES = at('../android/app/src/main/res');

const bundle = await rolldown({ input: at('./native-assets-entry.ts'), logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'iife' });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent(`<!doctype html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@500;700;800&display=swap"><body></body>`);
await page.addScriptTag({ content: output[0].code });
await page.evaluate(() => Promise.all(['700 20px Fredoka', '600 20px Fredoka', '700 16px Nunito'].map(f => document.fonts.load(f))));

const png = async (fn, ...args) => Buffer.from((await page.evaluate(([f, a]) => window.nativeAssets[f](...a), [fn, args])).split(',')[1], 'base64');
const put = (dir, name, buf) => { mkdirSync(`${RES}/${dir}`, { recursive: true }); writeFileSync(`${RES}/${dir}/${name}`, buf); };

// Launcher icons: legacy square and round at 48 dp, adaptive layers at 108 dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  put(`mipmap-${d}`, 'ic_launcher.png', await png('icon', 48 * k, 'full', false));
  put(`mipmap-${d}`, 'ic_launcher_round.png', await png('icon', 48 * k, 'full', true));
  put(`mipmap-${d}`, 'ic_launcher_foreground.png', await png('icon', 108 * k, 'foreground', false));
  put(`mipmap-${d}`, 'ic_launcher_background.png', await png('icon', 108 * k, 'background', false));
}
// Splash screens, portrait and landscape, at Capacitor's sizes.
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  put(`drawable-port-${d}`, 'splash.png', await png('splash', w, h));
  put(`drawable-land-${d}`, 'splash.png', await png('splash', h, w));
}
put('drawable', 'splash.png', await png('splash', 480, 320));
await browser.close();
console.log('baked icons and splashes into', RES);
