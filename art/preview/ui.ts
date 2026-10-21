// UI kit preview: the DOM screens over the running scene, and sheets of the kit's parts.
// &ui=menu|pause|summary|levelup|profile|settings|avatar opens that screen (buttons work: Settings, Profile,
// Close and so on). &ui=icons|badges|logo|brand|hats shows a sheet (brand: app icon, Android layers, splash, share card). &lv=<level> sets the player's level (default 7).
// &still=1 skips the animations, as Reduce Motion does. Without &ui, a Screens row sits above the biome picker.
// &rail=1 shows the altitude rail climbing through a few biomes, with the off-screen checkpoint and lost-piece chips.
// &top=<blocks> starts it there, &hold=1 stops the climb, &span=<blocks> shows a scrolling window instead of the whole run.

import { demoTower } from './tower.ts';
import {
  bakeAppIcon, bakePanorama, bakeShareCard, bakeSplash, panoramaBiome,
  altitudeRail, checkpointChip, offscreenChip, setOffscreenChip, setRail,
  BADGE_TIERS, BIOMES, HATS, INK, UI_ICONS, avatarPanel, avatarUrl, hatUrl, readAvatar, biomeCard, badgeUrl, bakeLogo, injectUiCss, levelUp, logoElement, mainMenu, onAction, pauseCard,
  postcardElement, profilePanel, readSettings, setXpBar, settingsPanel, showAllXpLines, showXpLine, summaryCard, titleFor, uiIconUrl, xpBar,
  type AvatarSpec, type SettingValue, type XpState,
} from '../src/index.ts';

const qs = new URLSearchParams(location.search || location.hash.slice(1));
const still = qs.has('still');
const level = Math.max(1, Number(qs.get('lv') ?? 7));
const step = (L: number): number => Math.round((50 * L ** 1.65 + 50) / 10) * 10;
const xpAt = (L: number, f: number): XpState => ({ level: L, into: Math.round(step(L) * f), need: step(L) });

let avatar: AvatarSpec = { shape: 'O', hat: level >= 4 ? 'cap' : 'party' };
let settings: Record<string, SettingValue> = { music: 0.7, sfx: 0.9, haptics: true, controls: 'gestures', splitTap: false, safeDrop: false, leftHand: false, sensitivity: 1, reducedMotion: false, shake: 1, patterns: false };

function mount(el: HTMLElement): HTMLElement {
  if (still) el.classList.add('ui-still');
  document.body.appendChild(el);
  return el;
}

/** Open one screen; its buttons open the others or close it. */
export function openScreen(name: string): void {
  const close = (el: HTMLElement) => () => el.remove();
  if (name === 'menu') {
    const m = mount(mainMenu({ name: 'Blake', ...xpAt(level, 0.62), avatar, still }));
    onAction(m, a => { if (a === 'play' || a === 'daily' || a === 'zen') m.remove(); else openScreen(a); });
  } else if (name === 'pause') {
    const p = mount(pauseCard());
    onAction(p, a => { if (a === 'settings') openScreen('settings'); else p.remove(); });
  } else if (name === 'summary') {
    summary();
  } else if (name === 'levelup') {
    const l = mount(levelUp({ level: qs.has('lv') ? level : 8 }));
    onAction(l, close(l));
  } else if (name === 'profile') {
    const dates = ['20 OCT 2026', '20 OCT 2026', '21 OCT 2026', '21 OCT 2026', '', null, null, null, null, null];
    const p = mount(profilePanel({ name: 'Blake', ...xpAt(level, 0.62), avatar, postcards: dates,
      stats: { bestHeight: 84.6, bestBiome: 4, bricks: 2318, perfects: 412, rows: 57, checkpoints: 31, runs: 46, streak: 3 } }));
    onAction(p, a => { if (a === 'avatar') openScreen('avatar'); else p.remove(); });
  } else if (name === 'avatar') {
    // Done keeps the choice and refreshes the avatar wherever it shows.
    const v = mount(avatarPanel({ avatar, level }));
    onAction(v, a => {
      if (a === 'done') { avatar = readAvatar(v); document.querySelectorAll<HTMLImageElement>('.ui-prof-head .ui-avatar').forEach(i => { i.src = avatarUrl(avatar, 72); }); }
      v.remove();
    });
  } else if (name === 'settings') {
    const s = mount(settingsPanel(settings));
    onAction(s, a => { if (a === 'close') { settings = readSettings(s); s.remove(); } });
  } else if (name === 'btitle') {
    const freeze = qs.has('bt'), el = mount(biomeCard(Number(qs.get('b') ?? 2), { newPostcard: !qs.has('seen'), stay: freeze }));
    if (freeze) for (const a of el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = Number(qs.get('bt')); }
  } else sheet(name);
}

/** The run summary with its tally: lines tick in one by one while the bar fills, then the level-up. */
function summary(): void {
  const before = xpAt(level, 0.55), lines: [string, string][] = [['Run', '+412'], ['New best', '+50'], ['Daily Boost', '×2'], ['Streak (3 days)', '+10%']];
  const gained = Math.round((412 + 50) * 2 * 1.1);
  const s = mount(summaryCard({ cause: 'Out of bricks!', height: 63.4, newBest: true, biome: 3, score: 18240, checkpoints: 6, perfects: 23, rows: 4, clutches: 1, xp: before, lines, gained }));
  onAction(s, a => { if (a === 'profile') openScreen('profile'); else if (a !== 'share') s.remove(); });
  if (still) { showAllXpLines(s); setXpBar(s, { ...xpAt(level + 1, 0) , into: before.into + gained - before.need }); return; }
  let i = 0;
  const tick = setInterval(() => {
    if (!s.isConnected) { clearInterval(tick); return; }
    if (showXpLine(s, i++)) return;
    clearInterval(tick);
    // Fill to the top, roll over to the next level, then the takeover.
    setXpBar(s, { ...before, into: before.need });
    setTimeout(() => {
      setXpBar(s, { level: level + 1, into: before.into + gained - before.need, need: step(level + 1) });
      const l = mount(levelUp({ level: level + 1 }));
      onAction(l, () => l.remove());
    }, 700);
  }, 420);
}

const SHEET_CSS = `
.pv-sheet { position: fixed; inset: 0; z-index: 40; overflow-y: auto; background: #FFF7E8; padding: 14px 14px 40px; }
.pv-sheet h3 { font: 700 15px Fredoka, sans-serif; margin: 14px 0 8px; color: ${INK}; }
.pv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(54px, 1fr)); gap: 8px 4px; }
.pv-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; font: 600 9px Nunito, sans-serif; color: #5B4F7A; text-align: center; }
.pv-cell img { width: 36px; height: 36px; }
.pv-wrap { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.pv-dark { background: #22183A; border-radius: 14px; padding: 10px; }
.pv-titles { display: flex; flex-direction: column; gap: 14px; align-items: stretch; padding: 4px 0 8px; border-radius: 14px; background: linear-gradient(#6EC3FF, #162452 60%, #1C0A38); }
.pv-titles .ui-btitle { position: relative; top: auto; }
`;

function sheet(name: string): void {
  const root = document.createElement('div');
  root.className = 'ui pv-sheet';
  const style = document.createElement('style'); style.textContent = SHEET_CSS; document.head.appendChild(style);
  if (name === 'icons') {
    root.innerHTML = `<h3>Icons (${UI_ICONS.length})</h3><div class="pv-grid">${UI_ICONS.map(n => `<div class="pv-cell"><img alt="" src="${uiIconUrl(n, 36)}">${n}</div>`).join('')}</div>
      <h3>Small (20 px) on dark</h3><div class="pv-wrap pv-dark">${UI_ICONS.map(n => `<img alt="" style="width:20px;height:20px" src="${uiIconUrl(n, 20)}">`).join('')}</div>
      <h3>Buttons</h3><div class="pv-wrap">
        <button class="ui-btn primary big"><img alt="" src="${uiIconUrl('play', 30)}">Play</button>
        <button class="ui-btn"><img alt="" src="${uiIconUrl('restart', 24)}">Restart</button>
        <button class="ui-btn mint">Mint</button><button class="ui-btn" disabled>Disabled</button>
        <button class="ui-btn icon"><img alt="" src="${uiIconUrl('pause', 24)}"></button>
        <button class="ui-btn icon sm"><img alt="" src="${uiIconUrl('close', 20)}"></button></div>
      <h3>Chips and plate</h3><div class="pv-wrap">
        <span class="ui-chip"><img alt="" src="${uiIconUrl('brick', 18)}">24</span><span class="ui-chip gold"><img alt="" src="${uiIconUrl('trophy', 18)}">New best!</span>
        <span class="ui-chip amber"><img alt="" src="${uiIconUrl('wind', 18)}">Gust</span><span class="ui-chip mint"><img alt="" src="${uiIconUrl('check', 18)}">Safe</span>
        <span class="ui-chip violet"><img alt="" src="${uiIconUrl('xp', 18)}">+120 XP</span>&nbsp;&nbsp;<span class="ui-plate">Brick Layer</span></div>
      <h3>Settings controls</h3><div class="ui-group" style="max-width:340px">
        <label class="ui-set"><span>Toggle on</span><input class="ui-toggle" type="checkbox" checked></label>
        <label class="ui-set"><span>Toggle off</span><input class="ui-toggle" type="checkbox"></label></div>`;
  } else if (name === 'badges') {
    const levels = [1, 5, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 69, 70, 75, 99, 100, 123];
    root.innerHTML = `<h3>Badge tiers</h3><div class="pv-wrap">${BADGE_TIERS.map(t => `<div class="pv-cell"><img alt="" style="width:72px;height:72px" src="${badgeUrl(t.from, 72)}">${t.name}</div>`).join('')}</div>
      <h3>Levels and titles</h3><div class="pv-grid" style="grid-template-columns:repeat(auto-fill,minmax(72px,1fr))">${levels.map(L => `<div class="pv-cell"><img alt="" style="width:44px;height:44px" src="${badgeUrl(L, 44)}">${L}<br>${titleFor(L)}</div>`).join('')}</div>
      <h3>XP bars</h3><div class="ui-stack pv-bars" style="max-width:340px"></div>
      <h3>Avatars</h3><div class="pv-wrap">${['O', 'T', 'L', 'S', 'I', 'Z', 'J', 'Domino'].map((k, i) => `<img alt="" style="width:56px;height:56px" src="${avatarUrl({ shape: k, face: (['idle', 'proud', 'idle', 'worried', 'idle', 'impact', 'idle', 'proud'] as const)[i] }, 56)}">`).join('')}</div>`;
    const bars = root.querySelector('.pv-bars')!;
    for (const [L, f] of [[1, 0.1], [2, 0.95], [7, 0.62], [12, 0.3], [41, 0.8], [72, 0.5]] as const) bars.appendChild(xpBar(xpAt(L, f)));
  } else if (name === 'hats') {
    const shapes = ['O', 'T', 'L', 'J', 'S', 'Z', 'I'];
    root.innerHTML = `<h3>Hats (unlock level)</h3><div class="pv-wrap">${HATS.map(h => `<div class="pv-cell"><img alt="" style="width:72px;height:72px" src="${hatUrl(h.key, 72)}">${h.name}<br>Lv ${h.level}</div>`).join('')}</div>
      <h3>Worn</h3><div class="pv-wrap">${HATS.map((h, i) => `<img alt="" style="width:72px;height:72px" src="${avatarUrl({ shape: shapes[i % shapes.length], face: i % 2 ? 'proud' : 'idle', hat: h.key }, 72)}">`).join('')}</div>
      <h3>Every Blockling in a party hat</h3><div class="pv-wrap">${shapes.map(k => `<img alt="" style="width:56px;height:56px" src="${avatarUrl({ shape: k, hat: 'party' }, 56)}">`).join('')}</div>
      <h3>Small (40 px)</h3><div class="pv-wrap">${HATS.map((h, i) => `<img alt="" style="width:40px;height:40px" src="${avatarUrl({ shape: shapes[(i + 3) % shapes.length], hat: h.key }, 40)}">`).join('')}</div>`;
  } else if (name === 'logo') {
    root.innerHTML = `<h3>Logo (DOM, drops in)</h3><div class="pv-logo" style="display:flex;justify-content:center;padding:8px 0 14px"></div>
      <h3>Logo baked still (splash, share card)</h3><div class="pv-bake" style="display:flex;justify-content:center"></div>
      <h3>Postcards</h3><div class="pv-wrap pv-cards"></div>`;
    root.querySelector('.pv-logo')!.appendChild(logoElement({ tile: 56, still }));
    const cv = bakeLogo(640); cv.style.width = '320px';
    root.querySelector('.pv-bake')!.appendChild(cv);
    const cards = root.querySelector('.pv-cards')!;
    BIOMES.forEach((_, i) => cards.appendChild(postcardElement({ biome: i, width: 104, date: i < 2 ? '21 OCT 2026' : undefined })));
    cards.appendChild(postcardElement({ biome: 7, width: 104, locked: true }));
  } else if (name === 'brand') {
    root.innerHTML = `<h3>App icon (1024, shown at 200) and at 120, 60, 40</h3><div class="pv-wrap pv-icons"></div>
      <h3>Android adaptive: background, foreground, masked circle and squircle</h3><div class="pv-wrap pv-adaptive"></div>
      <h3>Splash and share card</h3><div class="pv-wrap pv-big"></div>`;
    const img = (cv: HTMLCanvasElement, css: number, radius = '22%') => { const i = document.createElement('img'); i.src = cv.toDataURL(); i.style.cssText = `width:${css}px;border-radius:${radius};box-shadow:0 3px 0 ${INK}`; return i; };
    const icons = root.querySelector('.pv-icons')!, full = bakeAppIcon(1024);
    icons.append(img(full, 200), img(bakeAppIcon(240), 120), img(bakeAppIcon(120), 60), img(bakeAppIcon(80), 40));
    const ad = root.querySelector('.pv-adaptive')!, bg = bakeAppIcon(432, 'background'), fg = bakeAppIcon(432, 'foreground');
    const both = document.createElement('canvas'); both.width = both.height = 432; const bc = both.getContext('2d')!; bc.drawImage(bg, 0, 0); bc.drawImage(fg, 0, 0);
    // Android masks the middle 72 of 108 dp.
    const crop = document.createElement('canvas'); crop.width = crop.height = 288; crop.getContext('2d')!.drawImage(both, -72, -72);
    ad.append(img(bg, 90, '0'), img(fg, 90, '0'), img(crop, 90, '50%'), img(crop, 90, '30%'));
    (ad.children[1] as HTMLElement).style.background = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 16px 16px';
    const big = root.querySelector('.pv-big')!;
    big.append(img(bakeSplash(390 * 2, 844 * 2), 150, '12px'), img(bakeShareCard({ height: 63.4, biome: 3, newBest: true, name: 'Blake', level: 7, score: 18240 }), 200, '12px'));
    if (qs.has('share')) { root.innerHTML = ''; root.append(img(bakeShareCard({ height: 63.4, biome: 3, newBest: true, name: 'Blake', level: 7, score: 18240 }), 360, '12px'), img(bakeSplash(390 * 2, 844 * 2), 360, '12px')); }
  } else if (name === 'pano') {
    const t = demoTower(Number(qs.get('ph') ?? 63.4)), biome = panoramaBiome(t);
    root.innerHTML = `<h3>Run-over panorama (${t.top} blocks, ${t.slabs.length - 1} checkpoints) and its share card</h3><div class="pv-wrap pv-pano"></div>`;
    const t0 = performance.now(), pano = bakePanorama(t, 720, 1080), ms = Math.round(performance.now() - t0);
    const card = bakeShareCard({ height: t.top, biome, newBest: true, name: 'Blake', level: 7, score: 18240, tower: t, date: '21 OCT 2026' });
    const img = (cv: HTMLCanvasElement) => { const i = document.createElement('img'); i.src = cv.toDataURL(); i.style.cssText = `width:min(360px,100%);border-radius:12px;box-shadow:0 3px 0 ${INK}`; return i; };
    root.querySelector('.pv-pano')!.append(...(qs.has('card') ? [img(card), img(pano)] : [img(pano), img(card)]));
    root.querySelector('h3')!.textContent += ` (baked in ${ms} ms)`;
  } else if (name === 'titles') {
    root.innerHTML = `<h3>Biome title cards (the first visit adds the New postcard chip)</h3><div class="pv-titles"></div>`;
    const list = root.querySelector('.pv-titles')!;
    BIOMES.forEach((_, i) => list.appendChild(biomeCard(i, { stay: true, newPostcard: i === 2 })));
  }
  mount(root);
  if (name === 'titles') for (const a of root.getAnimations({ subtree: true })) a.finish();
}

/** The Screens row above the biome picker, for browsing the kit without a query string. */
export function screensBar(): void {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 62px);display:flex;justify-content:center;gap:4px;flex-wrap:wrap;padding:0 8px;z-index:3;font:600 11px Fredoka,Nunito,system-ui,sans-serif';
  for (const [k, label] of [['menu', 'Menu'], ['pause', 'Pause'], ['summary', 'Summary'], ['profile', 'Profile'], ['settings', 'Settings'], ['icons', 'Icons'], ['badges', 'Badges'], ['logo', 'Logo'], ['brand', 'Icon'], ['titles', 'Titles'], ['pano', 'Panorama'], ['avatar', 'Avatar'], ['hats', 'Hats']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:#FFC23D;color:${INK};border:2px solid ${INK};border-radius:10px;box-shadow:0 2px 0 ${INK};padding:2px 8px;font:inherit;cursor:pointer`;
    b.onclick = () => {
      document.querySelectorAll('.pv-sheet').forEach(e => e.remove());
      openScreen(k);
      if (k === 'icons' || k === 'badges' || k === 'logo' || k === 'brand' || k === 'titles' || k === 'pano') {
        const x = document.createElement('button');
        x.className = 'ui-btn icon sm'; x.style.cssText = 'position:fixed;top:10px;right:10px;z-index:41';
        x.innerHTML = `<img alt="Close" src="${uiIconUrl('close', 20)}">`;
        x.onclick = () => { document.querySelectorAll('.pv-sheet').forEach(e => e.remove()); x.remove(); };
        document.body.appendChild(x);
      }
    };
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
}

/** The rail climbing at 3 blocks a second from &top=<blocks> (default 0), claiming checkpoints as it passes them. */
function railDemo(): void {
  const cps: number[] = [];
  for (let n = 1, h = 0; n <= 30; n++) { h += 10 + Math.min(n, 14); cps.push(h); }
  const rail = mount(altitudeRail(240)), chip = mount(checkpointChip(1)), lost = mount(offscreenChip({ dir: 'down', label: '' }));
  lost.style.setProperty('--x', '30%');
  const t0 = performance.now(), start = Number(qs.get('top') ?? 0), pb = start + 40;
  const frame = () => {
    const t = (performance.now() - t0) / 1000, top = start + (qs.has('hold') ? 0 : t * 3);
    const claimed = cps.filter(h => h <= top).length;
    setRail(rail, { top, cps, claimed, pb, span: qs.has('span') ? Number(qs.get('span')) : 'run' });
    setOffscreenChip(chip, String(claimed + 1));
    chip.classList.toggle('show', cps[claimed] - top > 6);
    lost.classList.toggle('show', qs.has('hold') || t % 4 < 1.6);
    requestAnimationFrame(frame);
  };
  frame();
}

export function initUiPreview(): void {
  injectUiCss();
  const ui = qs.get('ui');
  if (ui) openScreen(ui);
  if (qs.has('rail')) railDemo();
}
