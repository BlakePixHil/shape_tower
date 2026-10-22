// UI smoke and layout checks for Art's UI kit screens (qa-section.md 10.2, F13.3, F15.3): opens each
// screen of the built art preview at three phone and tablet sizes, saves a screenshot, and checks
// that nothing scrolls sideways, every control is on screen and at least 44 px both ways, no text is
// cut off, and the page logs no errors.
// Usage: node scripts/ui-screens.mjs [art/dist/index.html] [out dir] [fonts dir]   (after `npm run build` in art/)
// Headless Chromium can't fetch Google Fonts through the agent proxy, so a fonts dir with fonts.css
// and its .woff2 files (fetched with curl) is served in their place; without one the fallback font is
// used and the report says so.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = resolve(process.argv[2] ?? `${root}/art/dist/index.html`);
const html = readFileSync(htmlPath);
const out = resolve(process.argv[3] ?? `${root}/qa/reports/ui-screens`);
const fonts = process.argv[4] ? resolve(process.argv[4]) : null;
mkdirSync(out, { recursive: true });
// Playwright from this checkout's art/ or game/, or from the checkout the build came from.
const { chromium } = (() => {
  for (const from of [`${root}/art/`, `${root}/game/`, `${dirname(dirname(htmlPath))}/`]) {
    try { return createRequire(from)('@playwright/test'); } catch { /* try the next */ }
  }
  throw new Error('Playwright not found: run npm ci in art/ or game/');
})();

const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/index.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

// 'daily' needs an art build with the Daily Tower card (#60); '&done=1' shows a played day. 'portraits' is the
// Daily ladder's 19 portrait styles, animated (#67).
const SCREENS = ['menu', 'pause', 'summary', 'levelup', 'profile', 'settings', 'daily', 'daily&done=1', 'portraits'];
const SIZES = [
  { name: 'small 16:9', width: 360, height: 640 },
  { name: 'tall 19.5:9', width: 390, height: 844 },
  { name: 'tablet 4:3', width: 768, height: 1024 },
];
const MIN_TAP = 44;

// The container's Chromium when Playwright's own build for this version isn't installed.
const executablePath = process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [];
let bad = 0;
for (const size of SIZES) {
  for (const screen of SCREENS) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (fonts && existsSync(`${fonts}/fonts.css`)) {
      await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: readFileSync(`${fonts}/fonts.css`, 'utf8') }));
      await page.route('https://fonts.gstatic.com/**', (r) => {
        const f = `${fonts}/${new URL(r.request().url()).pathname.split('/').pop()}`;
        return existsSync(f) ? r.fulfill({ contentType: 'font/woff2', body: readFileSync(f) }) : r.abort();
      });
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}?ui=${screen}&still=1&maxtex=1`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const found = await page.evaluate((MIN_TAP) => {
      const vw = innerWidth, vh = innerHeight;
      const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
      const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      const problems = [];
      const sw = document.scrollingElement.scrollWidth;
      if (sw > vw + 1) problems.push(`the page scrolls sideways (${sw} px wide in a ${vw} px viewport)`);
      const controls = [...document.querySelectorAll('button, a[href], input, select, [role=button], [role=switch], [role=slider]')].filter(visible);
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        // A range input's hit area is its whole track, so only its height matters.
        const isRange = el.matches('input[type=range]');
        const isToggleInput = el.matches('input[type=checkbox], input[type=radio]') && el.closest('label');
        if (r.left < -1 || r.right > vw + 1) problems.push(`"${label(el)}" runs off the side (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`);
        const box = isToggleInput ? el.closest('label').getBoundingClientRect() : r;
        if (!isRange && (box.width < MIN_TAP - 0.5 || box.height < MIN_TAP - 0.5)) problems.push(`"${label(el)}" is ${Math.round(box.width)} × ${Math.round(box.height)} px, under ${MIN_TAP}`);
        if (isRange && box.height < MIN_TAP / 2) problems.push(`slider "${label(el)}" is only ${Math.round(box.height)} px tall`);
      }
      // Text cut off: a box that hides overflow and has more text than room.
      for (const el of document.querySelectorAll('body *')) {
        if (!visible(el) || !el.textContent.trim() || el.children.length > 3) continue;
        const cs = getComputedStyle(el);
        const hides = /hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
        if (hides && el.scrollWidth > el.clientWidth + 1) problems.push(`text cut off in "${label(el)}" (${el.scrollWidth} px of text in ${el.clientWidth})`);
      }
      // The screen's own panel should fit the viewport or scroll inside itself.
      const panels = [...document.querySelectorAll('body > *')].filter((el) => visible(el) && el.tagName !== 'CANVAS' && el.tagName !== 'SCRIPT');
      for (const el of panels) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.bottom > vh + 1 && !/auto|scroll/.test(cs.overflowY) && cs.position === 'fixed') problems.push(`"${label(el)}" is taller than the screen and doesn't scroll (${Math.round(r.bottom)} of ${vh})`);
      }
      return { problems, controls: controls.length, fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) };
    }, MIN_TAP);
    const shot = `${out}/${screen.replace(/[&=]/g, '-')}-${size.width}x${size.height}.png`;
    await page.screenshot({ path: shot });
    const problems = [...new Set(found.problems), ...errors.map((e) => `page error: ${e}`)];
    if (problems.length) bad++;
    rows.push({ screen, size: `${size.width}×${size.height} (${size.name})`, controls: found.controls, fonts: [...new Set(found.fonts)], problems, shot });
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${screen} at ${size.width}×${size.height}: ${found.controls} controls${problems.length ? `\n  ${problems.slice(0, 8).join('\n  ')}` : ''}`);
    await page.close();
  }
}
await browser.close();
server.close();
writeFileSync(`${out}/report.json`, JSON.stringify(rows, null, 1));
const fontNote = rows[0]?.fonts.length ? `fonts loaded: ${rows[0].fonts.join(', ')}` : 'no web fonts loaded (fallback font)';
console.log(`${rows.length - bad} of ${rows.length} screen and size pairs pass; ${fontNote}`);
process.exitCode = bad ? 1 : 0;
