// Bakes the share links' picture (og.png, 1200 × 630, for link previews and the landing page) and icon
// into online/public, where the Cloudflare server serves them as static files (wrangler.jsonc "assets";
// the page is online/cloudflare/landing.ts). Run after Art changes the logo or the icon:
// node scripts/bake-share-assets.mjs   (needs Chromium; fonts from assets/fonts, so it runs offline)

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rolldown } from 'rolldown';

const at = p => new URL(p, import.meta.url).pathname;
const OUT = at('../../online/public');

const bundle = await rolldown({ input: at('./share-assets-entry.ts'), logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'iife' });
const font = (file, family, weights) => `@font-face { font-family: '${family}'; font-weight: ${weights}; `
  + `src: url(data:font/woff2;base64,${readFileSync(at(`../assets/fonts/${file}`)).toString('base64')}) format('woff2'); }`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent(`<!doctype html><style>${font('fredoka-latin.woff2', 'Fredoka', '300 700') + font('nunito-latin.woff2', 'Nunito', '200 1000')}</style><body></body>`);
await page.addScriptTag({ content: output[0].code });
await page.evaluate(() => Promise.all(['700 20px Fredoka', '600 20px Fredoka', '700 16px Nunito'].map(f => document.fonts.load(f))));
mkdirSync(OUT, { recursive: true });
for (const name of ['og', 'icon']) {
  const png = Buffer.from((await page.evaluate(n => window.shareAssets[n](), name)).split(',')[1], 'base64');
  writeFileSync(`${OUT}/${name}.png`, png);
  console.log(`online/public/${name}.png ${(png.length / 1024).toFixed(0)} KB`);
}
await browser.close();
