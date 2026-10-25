// Bakes the phone apps' launcher icons and the loading splash's parts from Art's brand art into
// android/app/src/main/res and ios/App/App (asset catalog and LaunchScreen.storyboard), and the web
// splash's parts into assets/splash. Run after Art changes the icon or the logo:
// node scripts/bake-native-assets.mjs
// Needs Chromium (Playwright) for the canvas; on a Mac, CHROMIUM can point at Google Chrome. Fonts come
// from assets/fonts, so it runs offline.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const at = p => new URL(p, import.meta.url).pathname;
const RES = at('../android/app/src/main/res');
const WEB = at('../assets/splash');
const IOS = at('../ios/App/App');

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

/** An 8-bit RGB PNG (no alpha channel) from `w` × `h` packed RGB bytes. */
function rgbPng(w, h, rgb) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const rows = Buffer.alloc((w * 3 + 1) * h); // each row: filter 0, then its pixels
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

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

// iOS: the App Store icon, and the launch screen's parts as images in points at 1x, 2x and 3x.
// The store turns away an icon with an alpha channel, which a canvas PNG always has, so it goes
// through rgbPng.
const rgbOf = png => page.evaluate(async src => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let out = '';
  for (let i = 0; i < d.length; i += 4) out += String.fromCharCode(d[i], d[i + 1], d[i + 2]);
  return btoa(out);
}, `data:image/png;base64,${png.toString('base64')}`);
const ICON = 1024;
put(`${IOS}/Assets.xcassets/AppIcon.appiconset`, 'AppIcon-512@2x.png', rgbPng(ICON, ICON, Buffer.from(await rgbOf(await bake('icon', ICON, 'full', false)), 'base64')));
const SKY_H = 1024; // a strip of the sky's gradient, stretched to the screen
const skyStrip = Buffer.from((await page.evaluate(([s, h]) => {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = h;
  const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, s[0]); g.addColorStop(0.6, s[1]); g.addColorStop(1, s[2]);
  c.fillStyle = g; c.fillRect(0, 0, 4, h);
  return cv.toDataURL('image/png');
}, [sky, SKY_H])).split(',')[1], 'base64');
const iosParts = { SplashSky: [[1, skyStrip]], SplashLogo: [], SplashCloud: [], SplashHills: [] };
for (const k of [1, 2, 3]) {
  iosParts.SplashLogo.push([k, (await logoAt(k)).png]);
  iosParts.SplashCloud.push([k, await bake('cloud', CLOUD * k, 'png')]);
  iosParts.SplashHills.push([k, await bake('hills', HILLS[0] * k, HILLS[1] * k, 'png')]);
}
await browser.close();
rmSync(`${IOS}/Assets.xcassets/Splash.imageset`, { recursive: true, force: true }); // Capacitor's placeholder
for (const [name, files] of Object.entries(iosParts)) {
  const dir = `${IOS}/Assets.xcassets/${name}.imageset`;
  rmSync(dir, { recursive: true, force: true });
  for (const [k, buf] of files) put(dir, `${name}@${k}x.png`, buf);
  put(dir, 'Contents.json', JSON.stringify({
    images: files.map(([k]) => ({ idiom: 'universal', filename: `${name}@${k}x.png`, scale: `${k}x` })),
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n');
}

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

// iOS's launch screen, the third twin: points instead of dp, pinned to the screen's edges (not the safe
// area) like the other two. The frames only matter in Xcode's editor; the constraints place everything.
const [W, H] = [375, 667], SCREEN = 'Lsv-Vw-sc1';
let lastId = 0;
const nextId = () => `L${String(++lastId).padStart(2, '0')}-sp-Ln5`;
const pin = (a, attr, b, attrB = attr, constant = 0) =>
  `<constraint firstItem="${a}" firstAttribute="${attr}" secondItem="${b}" secondAttribute="${attrB}"${constant ? ` constant="${constant}"` : ''} id="${nextId()}"/>`;
const pinned = [], images = [];
const imageView = (image, [x, y, w, h], size) => {
  const id = nextId();
  images.push(`                            <imageView userInteractionEnabled="NO" contentMode="scaleToFill" image="${image}" translatesAutoresizingMaskIntoConstraints="NO" id="${id}">
                                <rect key="frame" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>${size ? `
                                <constraints>
${['width', 'height'].filter((_, i) => size[i] !== null).map(a => `                                    <constraint firstAttribute="${a}" constant="${size[a === 'width' ? 0 : 1]}" id="${nextId()}"/>`).join('\n')}
                                </constraints>` : ''}
                            </imageView>`);
  return id;
};
const skyView = imageView('SplashSky', [0, 0, W, H]);
pinned.push(...['leading', 'trailing', 'top', 'bottom'].map(s => pin(skyView, s, SCREEN)));
for (const c of clouds) {
  const x = 'left' in c ? c.left : W - c.right - c.w, y = 'top' in c ? c.top : H - c.bottom - c.h;
  const v = imageView('SplashCloud', [x, y, c.w, c.h], [c.w, c.h]);
  pinned.push('left' in c ? pin(v, 'leading', SCREEN, 'leading', c.left) : pin(SCREEN, 'trailing', v, 'trailing', c.right));
  pinned.push('top' in c ? pin(v, 'top', SCREEN, 'top', c.top) : pin(SCREEN, 'bottom', v, 'bottom', c.bottom));
}
const hillsView = imageView('SplashHills', [0, H - HILLS[1], W, HILLS[1]], [null, HILLS[1]]);
pinned.push(...['leading', 'trailing', 'bottom'].map(s => pin(hillsView, s, SCREEN)));
const logoView = imageView('SplashLogo', [(W - logoBox.w) / 2, H / 2 - LOGO_UP - logoBox.h / 2, logoBox.w, logoBox.h], [logoBox.w, logoBox.h]);
pinned.push(pin(logoView, 'centerX', SCREEN), pin(logoView, 'centerY', SCREEN, 'centerY', -LOGO_UP));
const rgbOfHex = hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));
const [r, g, b] = rgbOfHex(sky[2]);
const pngSize = buf => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
put(`${IOS}/Base.lproj`, 'LaunchScreen.storyboard', `<?xml version="1.0" encoding="UTF-8"?>
<!-- The launch screen, made by scripts/bake-native-assets.mjs: don't edit. Android's drawable/splash.xml and assets/splash/layout.css are its twins. -->
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="17132" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="17105"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="${SCREEN}">
                        <rect key="frame" x="0.0" y="0.0" width="${W}" height="${H}"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
${images.join('\n')}
                        </subviews>
                        <color key="backgroundColor" red="${r}" green="${g}" blue="${b}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <constraints>
${pinned.map(c => `                            ${c}`).join('\n')}
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
    <resources>
${Object.entries(iosParts).map(([name, files]) => { const [w, h] = pngSize(files[0][1]); return `        <image name="${name}" width="${w}" height="${h}"/>`; }).join('\n')}
    </resources>
</document>
`);
console.log('baked icons and the splash into', RES, IOS, 'and', WEB, `(logo ${logoBox.w}x${logoBox.h})`);
