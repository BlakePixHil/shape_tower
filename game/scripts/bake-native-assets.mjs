// Bakes the phone app's launcher icons and the loading splash's parts from Art's brand art into
// android/app/src/main/res, and the web splash's parts into assets/splash. Run after Art changes the
// icon or the logo: node scripts/bake-native-assets.mjs
// Needs Chromium (Playwright) for the canvas. Fonts come from assets/fonts, so it runs offline.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rolldown } from 'rolldown';

const at = p => new URL(p, import.meta.url).pathname;
const RES = at('../android/app/src/main/res');
const WEB = at('../assets/splash');

const bundle = await rolldown({ input: at('./native-assets-entry.ts'), logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'iife' });

const font = (file, family, weights) => `@font-face { font-family: '${family}'; font-weight: ${weights}; `
  + `src: url(data:font/woff2;base64,${readFileSync(at(`../assets/fonts/${file}`)).toString('base64')}) format('woff2'); }`;
const fonts = font('fredoka-latin.woff2', 'Fredoka', '300 700') + font('nunito-latin.woff2', 'Nunito', '200 1000');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent(`<!doctype html><style>${fonts}</style><body></body>`);
await page.addScriptTag({ content: output[0].code });
await page.evaluate(() => Promise.all(['700 20px Fredoka', '600 20px Fredoka', '700 16px Nunito'].map(f => document.fonts.load(f))));

const bake = async (fn, ...args) => Buffer.from((await page.evaluate(([f, a]) => window.nativeAssets[f](...a), [fn, args])).split(',')[1], 'base64');
const put = (dir, name, buf) => { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${name}`, buf); };

// Launcher icons: legacy square and round at 48 dp, adaptive layers at 108 dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  put(`${RES}/mipmap-${d}`, 'ic_launcher.png', await bake('icon', 48 * k, 'full', false));
  put(`${RES}/mipmap-${d}`, 'ic_launcher_round.png', await bake('icon', 48 * k, 'full', true));
  put(`${RES}/mipmap-${d}`, 'ic_launcher_foreground.png', await bake('icon', 108 * k, 'foreground', false));
  put(`${RES}/mipmap-${d}`, 'ic_launcher_background.png', await bake('icon', 108 * k, 'background', false));
}

// The loading splash: the Meadow sky, three clouds, hills along the bottom and the menu's logo, the
// same on the phone's launch screen (drawable/splash.xml, Android draws it before the app starts) and
// the web splash (assets/splash/layout.css, under src/view/splash.css), so one hands over to the other
// without a seam. Sizes and places are dp on Android and CSS px on the web; this script writes both.
const TILE = 58, MARGIN = 3; // the menu's logo tiles (Art's mainMenu) and room for their outlines
const LOGO_UP = 56; // the logo's middle sits this far above the screen's
const CLOUD = 100, CLOUD_H = 1.95 / 3.3; // the cloud is baked CLOUD wide; each one scales it
const CLOUDS = [{ left: 20, top: 140, w: 100 }, { right: 22, top: 236, w: 70 }, { right: 48, bottom: 196, w: 86 }];
const HILLS = [360, 150]; // baked size; stretched across the bottom, HILLS[1] tall
// The web splash's loading stack (blocks CELL px, padded PAD blocks for outlines): each [shape,
// rotation, x, y] in blocks from the bottom-left of the plank. splash.css drops them in order.
const STACK = [['Plank', 0, 0, 0], ['O', 0, 1.5, 1], ['T', 0, 1, 3], ['Domino', 1, 2, 5]], CELL = 20, PAD = 0.12;
const STACK_W = 5, STACK_H = 7, STACK_AT = 190; // its box in blocks; its foot sits STACK_AT px below the screen's middle

const sky = await page.evaluate(() => window.nativeAssets.sky());
const logoAt = async k => {
  const pg = await browser.newPage({ deviceScaleFactor: k });
  await pg.setContent(`<!doctype html><style>${fonts}</style><body style="margin:0"></body>`);
  await pg.addScriptTag({ content: output[0].code });
  const box = await pg.evaluate(([t, m]) => window.nativeAssets.logo(t, m), [TILE, MARGIN]);
  const png = await pg.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h }, omitBackground: true });
  await pg.close();
  return { box, png };
};
let logoBox = null;
for (const [d, k] of Object.entries(DENSITIES)) {
  const { box, png } = await logoAt(k);
  logoBox = box;
  put(`${RES}/drawable-${d}`, 'splash_logo.png', png);
  put(`${RES}/drawable-${d}`, 'splash_cloud.png', await bake('cloud', CLOUD * k, 'png'));
  put(`${RES}/drawable-${d}`, 'splash_hills.png', await bake('hills', HILLS[0] * k, HILLS[1] * k, 'png'));
}
// Before the parts, the launch screen was one picture, stretched to the screen.
for (const dir of ['drawable', ...Object.keys(DENSITIES).flatMap(d => [`drawable-port-${d}`, `drawable-land-${d}`])]) rmSync(`${RES}/${dir}/splash.png`, { force: true });

// The web's parts at 3x (the hills are soft, 2x does).
const { png: logo3 } = await logoAt(3);
put(WEB, 'logo.webp', await bake('webp', `data:image/png;base64,${logo3.toString('base64')}`));
put(WEB, 'cloud.webp', await bake('cloud', CLOUD * 3, 'webp'));
put(WEB, 'hills.webp', await bake('hills', HILLS[0] * 2, HILLS[1] * 2, 'webp'));
for (const [key, q] of STACK) put(WEB, `stack-${key}.webp`, await bake('piece', key, q, CELL * 3, PAD, 'webp'));
const stackDims = await Promise.all(STACK.map(([key, q]) => page.evaluate(([k, r]) => window.nativeAssets.dims(k, r), [key, q])));
await browser.close();

// The layout, twice.
const n = v => +v.toFixed(1);
const clouds = CLOUDS.map(c => ({ ...c, h: n(c.w * CLOUD_H) }));
const edge = (c, unit) => ['left', 'right', 'top', 'bottom'].filter(s => s in c).map(s => [s, `${c[s]}${unit}`]);
put(`${RES}/drawable`, 'splash.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- The launch screen, made by scripts/bake-native-assets.mjs: don't edit. assets/splash/layout.css is its twin on the web. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><gradient android:angle="270" android:startColor="${sky[0]}" android:centerColor="${sky[1]}" android:centerY="0.6" android:endColor="${sky[2]}" /></shape></item>
${clouds.map(c => `    <item android:gravity="${'top' in c ? 'top' : 'bottom'}|${'left' in c ? 'left' : 'right'}" ${edge(c, 'dp').map(([s, v]) => `android:${s}="${v}"`).join(' ')} android:width="${c.w}dp" android:height="${c.h}dp" android:drawable="@drawable/splash_cloud" />`).join('\n')}
    <item android:gravity="bottom|fill_horizontal" android:height="${HILLS[1]}dp" android:drawable="@drawable/splash_hills" />
    <item android:gravity="center" android:bottom="${LOGO_UP * 2}dp" android:width="${logoBox.w}dp" android:height="${logoBox.h}dp" android:drawable="@drawable/splash_logo" />
</layer-list>
`);
const cell = v => `${n(v * CELL)}px`;
put(WEB, 'layout.css', `/* The web splash's layout, made by scripts/bake-native-assets.mjs: don't edit. android/.../drawable/splash.xml is its twin. */
#splash .sp-sky { background: linear-gradient(${sky[0]}, ${sky[1]} 60%, ${sky[2]}); }
#splash .sp-logo { left: calc(50% - ${logoBox.w / 2}px); top: calc(50% - ${LOGO_UP + logoBox.h / 2}px); width: ${logoBox.w}px; height: ${logoBox.h}px; }
${clouds.map((c, i) => `#splash .sp-cloud-${i} { ${edge(c, 'px').map(([s, v]) => `${s}: ${v};`).join(' ')} width: ${c.w}px; height: ${c.h}px; }`).join('\n')}
#splash .sp-hills { height: ${HILLS[1]}px; }
#splash .sp-stack { left: calc(50% - ${cell(STACK_W / 2)}); top: calc(50% + ${STACK_AT}px - ${cell(STACK_H)}); width: ${cell(STACK_W)}; height: ${cell(STACK_H)}; }
${STACK.map(([, , x, y], i) => `#splash .sp-p${i} { left: ${cell(x - PAD)}; bottom: ${cell(y - PAD)}; width: ${cell(stackDims[i][0] + PAD * 2)}; height: ${cell(stackDims[i][1] + PAD * 2)}; }`).join('\n')}
`);
console.log('baked icons and the splash into', RES, 'and', WEB, `(logo ${logoBox.w}x${logoBox.h})`);
