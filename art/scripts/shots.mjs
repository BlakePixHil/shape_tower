// Screenshots of the built preview (npm run build first), one per query string, at phone size.
// npm run shots -- "state=stable&maxtex=1" "gallery=1&maxtex=1"
// Headless Chromium renders WebGL with SwiftShader; pass maxtex=1 there (see README, "Headless WebGL").
// CHROMIUM=/path/to/chrome uses that browser instead of Playwright's own download.

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const queries = process.argv.slice(2);
if (!queries.length) queries.push('state=stable&maxtex=1');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const q of queries) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(`${q}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${q}: ${m.text()}`); });
  await page.goto(`file://${dir}dist/index.html?${q}`);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  const file = `${dir}shots/${q.replace(/[^a-z0-9]+/gi, '_')}.png`;
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
