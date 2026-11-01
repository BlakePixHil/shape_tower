// Every achievement badge at the store consoles' sizes (gameplay.md §18.5), from the built preview (npm run build first):
// exports/achievements/play/<id>.png (512 px, transparent) and exports/achievements/gamecenter/<id>.png (1024 px, flattened).
// npm run export:badges [-- list.json]: the list is [{ id, tier, icon, biome?, pop? }, ...] (pop: true for Blockling Pop's look);
// without one it uses the preview's copy (the tower's and Pop's).
// CHROMIUM=/path/to/chrome uses that browser instead of Playwright's own download.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const listFile = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`file://${dir}dist/index.html?export=1&ui=none`);
await page.waitForFunction(() => 'achievementExport' in window);
const list = listFile ? JSON.parse(readFileSync(listFile, 'utf8')) : await page.evaluate(() => window.achievementExport.list);
for (const store of ['play', 'gamecenter']) {
  const out = `${dir}exports/achievements/${store}/`;
  mkdirSync(out, { recursive: true });
  for (const a of list) {
    const url = await page.evaluate(([b, s]) => window.achievementExport.bake(b, s), [a, store]);
    writeFileSync(`${out}${a.id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`${list.length} badges -> ${out}`);
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
