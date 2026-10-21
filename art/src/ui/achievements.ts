// Achievements (gameplay.md §18): a round medal per achievement that gains ornaments with its tier. Bronze is
// a plain rim, Silver adds a ring of beads, Gold a scalloped rim and ribbon tails, Platinum a sunburst, a gem and
// a sparkle. The glyph sits in the middle; biome achievements show their postcard instead. Locked badges are
// grey, and unearned secret ones are a grey "?" that gives nothing away. Also the DOM for them: the toast that
// drops in during a run, the run summary's strip, the profile row and the Achievements panel. Needs uiCss().

import { INK, SIGNAL } from '../config.ts';
import { O, circlePath, ink, twinkle } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';
import { type UiIcon, drawUiIcon, uiIconUrl } from './icons.ts';
import { bakePostcard } from './postcard.ts';

export type AchTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AchTierInfo { name: string; base: string; light: string; shade: string; /** The middle's gradient, centre to edge. */ field: [string, string] }

export const ACH_TIERS: Record<AchTier, AchTierInfo> = {
  bronze: { name: 'Bronze', base: '#D08A4E', light: '#F2B98A', shade: '#9A5A2A', field: ['#FFF8F0', '#F7D9BC'] },
  silver: { name: 'Silver', base: '#C9D1DE', light: '#F4F7FB', shade: '#8E98AB', field: ['#FFFFFF', '#DCE4F0'] },
  gold: { name: 'Gold', base: '#FFC23D', light: '#FFE08A', shade: '#D9971A', field: ['#FFFDF2', '#FFE6A0'] },
  platinum: { name: 'Platinum', base: '#CFE0F7', light: '#FFFFFF', shade: '#8C9FC6', field: ['#FFF6FD', '#D3E3FF'] },
};

export interface AchievementBadge {
  /** The glyph in the middle (a biome achievement shows it only while locked, like the profile's unreached postcards). */
  icon: UiIcon;
  tier: AchTier;
  /** Not earned yet: the whole badge in grey. */
  locked?: boolean;
  /** A secret achievement not earned yet: a grey "?" medal with no glyph, tier or biome. Leave it off once earned. */
  secret?: boolean;
  /** A biome achievement (0 = Meadow): once earned, its postcard fills the middle. */
  biome?: number;
}

const GREY = { base: '#B8B2C4', light: '#DAD6E2', shade: '#8C869A', field: ['#F4F2F7', '#D9D5E1'] as [string, string] };

/** "?" from Fredoka Bold (SIL OFL 1.1) in thousandths of an em, centred, y down. A path, so it never needs the font. */
const QMARK = 'M2 115Q-40 115 -58 104Q-75 92 -79 74Q-82 56 -82 37V30Q-82 -2 -72 -21Q-61 -40 -45 -52Q-28 -63 -9 -70Q10 -78 26 -86Q43 -93 53 -104Q64 -116 64 -136Q64 -165 48 -178Q32 -191 -4 -191Q-20 -191 -31 -187Q-42 -183 -48 -178Q-53 -172 -56 -166Q-66 -136 -79 -119Q-91 -102 -110 -98Q-129 -95 -161 -107Q-195 -121 -211 -134Q-226 -147 -228 -165Q-229 -183 -220 -212Q-219 -215 -213 -230Q-206 -246 -192 -268Q-178 -289 -154 -310Q-129 -331 -93 -345Q-56 -359 -4 -359Q62 -359 114 -330Q167 -300 197 -250Q228 -201 228 -139Q228 -94 214 -62Q200 -29 179 -8Q158 13 136 25Q115 37 99 42Q84 47 81 47L88 35V45Q88 62 84 78Q80 95 62 105Q44 115 2 115ZM-1 359Q-59 359 -78 337Q-96 315 -96 262Q-96 240 -92 218Q-88 196 -68 182Q-48 167 0 167Q59 167 77 189Q96 211 96 264Q96 286 92 308Q88 330 67 344Q47 359 -1 359Z';

/** The medal's centre (a touch above the middle, so the ribbons fit below), its outer and its inner radius. */
const CY = -0.03, R = 0.36, RF = 0.27;

/** A polar outline around the centre: r(a) for n points. */
function polar(n: number, r: (a: number) => number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU - Math.PI / 2, d = r(a); i ? p.lineTo(Math.cos(a) * d, CY + Math.sin(a) * d) : p.moveTo(Math.cos(a) * d, CY + Math.sin(a) * d); }
  p.closePath();
  return p;
}

/** Fill with a light lip on top and a shade lip below, outlined with one clean Ink line even where subpaths overlap. */
function solid(c: Ctx, p: Path2D, t: { base: string | CanvasGradient; light: string; shade: string }, lip = 0.05): void {
  c.lineJoin = 'round'; c.lineWidth = O * 2; c.strokeStyle = INK; c.stroke(p);
  c.save(); c.clip(p);
  c.fillStyle = t.light; c.fill(p);
  c.translate(0, lip); c.fillStyle = t.base; c.fill(p);
  c.translate(0, -lip * 2.2);
  const band = new Path2D(); band.rect(-2, -2, 4, 4); band.addPath(p);
  c.fillStyle = t.shade; c.fill(band, 'evenodd');
  c.restore();
}

/** Two ribbon tails behind the medal, notched at the ends. */
function ribbons(c: Ctx, col: { base: string; light: string; shade: string }): void {
  for (const sx of [-1, 1]) {
    const p = new Path2D();
    p.moveTo(sx * 0.05, 0.12); p.lineTo(sx * 0.2, 0.08); p.lineTo(sx * 0.3, 0.47); p.lineTo(sx * 0.21, 0.4); p.lineTo(sx * 0.14, 0.49); p.closePath();
    solid(c, p, col, 0.03);
  }
}

const postcards = new Map<string, HTMLCanvasElement>();
function postcardFor(biome: number, px: number): HTMLCanvasElement {
  const w = Math.max(8, Math.round(px)), key = `${biome}:${w}`;
  let cv = postcards.get(key);
  if (!cv) { cv = bakePostcard(biome, w, Math.round((w * 4) / 3), 1); postcards.set(key, cv); }
  return cv;
}

/** Draw the medal in a unit box centred on the origin; `px` is its real size, for the postcard's resolution. */
function drawMedal(c: Ctx, b: AchievementBadge, px: number): void {
  const secret = !!b.secret, tier = secret ? 'bronze' : b.tier, t = secret ? GREY : ACH_TIERS[tier];
  if (tier === 'gold') ribbons(c, { base: SIGNAL.danger, light: '#FF8FA3', shade: '#CC2E48' });
  if (tier === 'platinum') ribbons(c, { base: SIGNAL.xp, light: '#B9A8FF', shade: '#5236D6' });

  // The rim: plain, beaded, scalloped or a sunburst behind a plain rim.
  if (tier === 'platinum') {
    solid(c, polar(32, a => (Math.round(((a + Math.PI / 2) / TAU) * 32) % 2 ? R + 0.035 : R + 0.11)), ACH_TIERS.gold, 0.03);
    // A mother-of-pearl rim: pink to sky across the medal.
    const g = c.createLinearGradient(-R, CY - R, R, CY + R);
    g.addColorStop(0, '#FFE3F6'); g.addColorStop(0.5, '#E6E1FF'); g.addColorStop(1, '#BFEFFF');
    solid(c, circlePath(0, CY, R), { base: g, light: '#FFFFFF', shade: t.shade });
  } else if (tier === 'gold') {
    solid(c, polar(160, a => R + 0.012 + 0.03 * Math.abs(Math.cos(a * 8))), t);
  } else if (tier === 'silver') {
    const p = new Path2D(); p.arc(0, CY, R - 0.005, 0, TAU);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; p.moveTo(Math.cos(a) * R + 0.04, CY + Math.sin(a) * R); p.arc(Math.cos(a) * R, CY + Math.sin(a) * R, 0.04, 0, TAU); }
    solid(c, p, t);
  } else {
    solid(c, circlePath(0, CY, R), t);
  }

  // A shine along the rim's upper left.
  const sh = new Path2D(); sh.arc(0, CY, (R + RF) / 2, Math.PI * 1.08, Math.PI * 1.42);
  c.lineCap = 'round'; c.lineWidth = 0.035; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.stroke(sh);

  // The middle: a soft gradient, or the biome's postcard.
  const field = circlePath(0, CY, RF);
  c.save(); c.clip(field);
  const card = !secret && !b.locked && b.biome !== undefined;
  if (card) {
    const cv = postcardFor(b.biome!, px * RF * 2.2), w = RF * 2.2, h = (w * cv.height) / cv.width;
    c.drawImage(cv, -w / 2, CY + RF - h * 0.94, w, h);
  } else {
    const g = c.createRadialGradient(-0.08, CY - 0.1, 0, 0, CY, RF);
    g.addColorStop(0, t.field[0]); g.addColorStop(1, t.field[1]);
    c.fillStyle = g; c.fill(field);
  }
  if (tier === 'gold' || tier === 'platinum') {
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath(); c.moveTo(-0.02, CY - RF); c.lineTo(0.1, CY - RF); c.lineTo(-0.14, CY + RF); c.lineTo(-0.26, CY + RF); c.closePath(); c.fill();
  }
  c.restore();
  ink(c, field, O * 0.8);

  // The glyph, or the "?".
  if (secret) {
    const k = 0.4 / 718, q = new Path2D(QMARK);
    c.save(); c.translate(0, CY + 0.005); c.scale(k, k);
    c.lineJoin = 'round'; c.lineWidth = 0.06 / k; c.strokeStyle = INK; c.stroke(q);
    c.fillStyle = '#FFFFFF'; c.fill(q);
    c.restore();
  } else if (!card) {
    drawUiIcon(c, b.icon, 0, CY, RF * 1.95);
  }

  if (tier === 'platinum') {
    // A gem on top of the rim and a sparkle.
    const gem = new Path2D(); gem.moveTo(0, CY - R - 0.07); gem.lineTo(0.06, CY - R + 0.0); gem.lineTo(0, CY - R + 0.06); gem.lineTo(-0.06, CY - R + 0.0); gem.closePath();
    solid(c, gem, { base: '#7FE3F5', light: '#D2F8FF', shade: '#3AA9C9' }, 0.02);
    const tw = twinkle(0.27, CY - 0.27, 0.1); c.fillStyle = '#FFFFFF'; c.fill(tw); ink(c, tw, O * 0.7);
  }
}

/** Turn a baked badge grey: luminance with its contrast eased, alpha kept. */
function greyOut(cv: HTMLCanvasElement): void {
  const c = ctx2d(cv), im = c.getImageData(0, 0, cv.width, cv.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], v = 150 + (y - 150) * 0.55;
    d[i] = v * 0.98; d[i + 1] = v * 0.97; d[i + 2] = v * 1.04;
  }
  c.putImageData(im, 0, 0);
}

/** The badge baked into a canvas `px` square, transparent around the medal. Use 512 for Play Games and 1024 for Game Center. */
export function bakeAchievementBadge(b: AchievementBadge, px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px), c = ctx2d(cv);
  c.save(); c.translate(px / 2, px / 2); c.scale(px, px);
  drawMedal(c, b, px);
  c.restore();
  if (b.locked || b.secret) greyOut(cv);
  return cv;
}

/**
 * The earned badge as the store consoles want it (gameplay.md §18.5). 'play': 512 px on transparent, for Google Play
 * Games. 'gamecenter': 1024 px, flattened onto a Paper disc on the tier's tint and kept inside the circle Game
 * Center crops to.
 */
export function bakeAchievementForStore(b: AchievementBadge, store: 'play' | 'gamecenter'): HTMLCanvasElement {
  const spec = { ...b, locked: false, secret: false };
  if (store === 'play') return bakeAchievementBadge(spec, 512);
  const px = 1024, cv = makeCanvas(px, px), c = ctx2d(cv), t = ACH_TIERS[b.tier];
  const g = c.createRadialGradient(px / 2, px * 0.42, 0, px / 2, px / 2, px * 0.72);
  g.addColorStop(0, '#FFF7E8'); g.addColorStop(1, t.field[1]);
  c.fillStyle = g; c.fillRect(0, 0, px, px);
  const s = Math.round(px * 0.84);
  c.drawImage(bakeAchievementBadge(spec, s), (px - s) / 2, (px - s) / 2 + px * 0.02, s, s);
  return cv;
}

/** Draw the badge centred at (x, y), `size` px square. */
export function drawAchievementBadge(c: Ctx, b: AchievementBadge, x: number, y: number, size: number): void {
  const s = Math.round(size);
  c.drawImage(bakeAchievementBadge(b, s), x - s / 2, y - s / 2, s, s);
}

const urls = new Map<string, string>();
const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);

/** A PNG data URL of the badge, `cssPx` CSS px square at the device's resolution. Cached. */
export function achievementBadgeUrl(b: AchievementBadge, cssPx: number, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr);
  const key = b.secret ? `?:${px}` : `${b.tier}:${b.icon}:${b.biome ?? ''}:${!!b.locked}:${px}`;
  let u = urls.get(key);
  if (!u) { u = bakeAchievementBadge(b, px).toDataURL('image/png'); urls.set(key, u); }
  return u;
}

// ---------------------------------------------------------------------------------------------
// DOM

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-21' -> '21 Oct 2026'; anything else as it is. */
const day = (s: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s; };

function el(html: string): HTMLElement {
  const t = document.createElement('template'); t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export interface AchievementToastData {
  name: string;
  tier: AchTier;
  icon: UiIcon;
  biome?: number;
  /** When more came at once than the toasts show: "+N more" under the name. */
  more?: number;
}

export interface AchievementToastOptions {
  /** Vertical position (CSS length). Default: where the biome title card goes, under the height counter. */
  top?: string;
  /** Reduce Motion: fade in and out instead of sliding. */
  still?: boolean;
  /** Juice off: no stamp bounce, shine or sparkle. */
  plain?: boolean;
  /** Keep it on screen after it lands (no slide-out); remove it yourself. */
  stay?: boolean;
}

/**
 * The in-run toast: the badge stamps onto a card in its tier's color with "Achievement!" and the name. Append it
 * to the HUD; it slides down, holds and slides back up in 2.2 s, then removes itself. Ignores touches.
 */
export function achievementToast(d: AchievementToastData, o: AchievementToastOptions = {}): HTMLElement {
  const t = ACH_TIERS[d.tier];
  const root = el(`<div class="ui ui-achtoast ${d.tier}${o.still ? ' ui-still' : ''}${o.plain ? ' plain' : ''}${o.stay ? ' stay' : ''}" role="status"
    aria-label="Achievement! ${esc(d.name)}${d.more ? `, and ${d.more} more` : ''}" style="--tc:${t.base};--tl:${t.light}${o.top ? `;--top:${o.top}` : ''}">
    <div class="ui-at-card"><span class="ui-at-shine"></span>
      <span class="ui-at-badge"><img alt="" src="${achievementBadgeUrl({ icon: d.icon, tier: d.tier, biome: d.biome }, 56)}"><i><img alt="" src="${uiIconUrl('perfect', 26)}"></i></span>
      <span class="ui-at-text"><span class="ui-at-kick">Achievement!</span><span class="ui-at-name">${esc(d.name)}</span>${d.more ? `<span class="ui-at-more">+${d.more} more</span>` : ''}</span>
    </div></div>`);
  if (!o.stay) {
    root.addEventListener('animationend', e => { if (e.target === root) root.remove(); });
    setTimeout(() => root.remove(), 4000);
  }
  return root;
}

export interface AchievementStripItem { name: string; tier: AchTier; icon: UiIcon; biome?: number }

/** The run summary's "New achievements" strip: the badges pop in one by one. Put it in the summary's .ui-sum-extra. */
export function achievementStrip(items: AchievementStripItem[]): HTMLElement {
  return el(`<div class="ui ui-achstrip"><span class="ui-kicker">New achievements</span><div>${items.map((a, i) =>
    `<img alt="${esc(a.name)}" title="${esc(a.name)}" style="--i:${i}" src="${achievementBadgeUrl({ icon: a.icon, tier: a.tier, biome: a.biome }, 44)}">`).join('')}</div></div>`);
}

/** The profile's row under the stats: a trophy, "Achievements", the count and a bar. Action: achievements. */
export function achievementsRow(d: { got: number; total: number }): HTMLElement {
  return el(`<button type="button" class="ui ui-achrow" data-action="achievements" aria-label="Achievements, ${d.got} of ${d.total}">
    <img alt="" src="${uiIconUrl('trophy', 30)}"><span class="ui-ach-mid"><b>Achievements</b>${bar(d.got, d.total)}</span><b class="ui-num">${d.got} / ${d.total}</b>
    <img class="ui-ach-go" alt="" src="${uiIconUrl('play', 16)}"></button>`);
}

function bar(n: number, of: number, text = ''): string {
  return `<span class="ui-ach-bar"><i style="width:${of > 0 ? Math.min(100, (n / of) * 100).toFixed(1) : 0}%"></i>${text ? `<em class="ui-num">${text}</em>` : ''}</span>`;
}

export interface AchievementItem {
  id: string;
  name: string;
  /** How to earn it, one line. */
  text: string;
  tier: AchTier;
  icon: UiIcon;
  biome?: number;
  /** The day it was earned ('YYYY-MM-DD'); missing while locked. */
  got?: string;
  /** For counted ones while locked: [so far, goal]. */
  progress?: [number, number];
  /** Secret: until it's earned its name and text are left out of the page. */
  secret?: boolean;
}

export interface AchievementGroup { name: string; items: AchievementItem[] }

/** The Achievements panel: the total, then each group's badges with name, how to earn it, the date or progress. Action: close. */
export function achievementsPanel(d: { groups: AchievementGroup[] }): HTMLElement {
  const all = d.groups.flatMap(g => g.items), got = all.filter(a => a.got).length;
  const row = (a: AchievementItem): string => {
    const hidden = a.secret && !a.got;
    const badge = achievementBadgeUrl(hidden ? { icon: a.icon, tier: a.tier, secret: true } : { icon: a.icon, tier: a.tier, biome: a.biome, locked: !a.got }, 52);
    const name = hidden ? 'Secret' : esc(a.name), text = hidden ? 'Keep playing to find this one.' : esc(a.text);
    const tail = a.got ? `<span class="ui-ach-date">${esc(day(a.got))}</span>`
      : a.progress && !hidden ? bar(a.progress[0], a.progress[1], `${num(a.progress[0])} / ${num(a.progress[1])}`) : '';
    return `<li class="ui-ach${a.got ? ' got' : ' locked'}${hidden ? ' secret' : ''}"><img alt="" src="${badge}">`
      + `<div><b>${name}</b><span>${text}</span>${tail}</div>${a.got ? `<i class="ui-ach-tier ${a.tier}">${ACH_TIERS[a.tier].name}</i>` : ''}</li>`;
  };
  return el(`<div class="ui ui-overlay" role="dialog" aria-label="Achievements"><div class="ui-panel ui-achs">
    <button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close"><img alt="" src="${uiIconUrl('close', 20)}"></button>
    <h1 class="ui-h1">Achievements</h1>
    <div class="ui-ach-total"><img alt="" src="${uiIconUrl('trophy', 34)}">${bar(got, all.length, `${got} / ${all.length}`)}</div>
    ${d.groups.map(g => `<h2 class="ui-h2">${esc(g.name)}<span class="ui-num">${g.items.filter(a => a.got).length} / ${g.items.length}</span></h2>
      <ul class="ui-ach-list">${g.items.map(row).join('')}</ul>`).join('')}
  </div></div>`);
}
