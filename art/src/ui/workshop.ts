// The Workshop (monetisation plan v2; build plan Part A): the one screen in the game with buy buttons.
// A Paper panel under a striped shop awning: the Supporter offer, the upgrades as wide cards (art, name,
// what it gives, a note, and the price button or an Owned chip), portraits three to a row, then Restore
// purchases and where the prices come from. The game owns the store: it passes plain data, redraws one
// card as a price arrives or a purchase goes through (setWorkshopItem), and shows how it went
// (setWorkshopNote). Prices only ever appear here. Needs uiCss(); adds its own rules once.

import { INK, PAPER, SIGNAL } from '../config.ts';
import { drawPowerIcon } from '../powers.ts';
import { ART_SHAPES } from '../shapes.ts';
import { O, circlePath, heart, ink, part, rrPath, twinkle } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';
import { type UiIcon, drawNoAds, uiIconUrl } from './icons.ts';
import { portraitHtml } from './portraits.ts';
import type { AvatarSpec } from './screens.ts';

/** What a card shows on its left: a product's art, a portrait style on the player's Blockling, or a set. */
export type WorkshopArt =
  | 'supporter' | 'builders_pass' | 'remove_ads' | 'second_wind_ready'
  | { portrait: string } | { set: string };

/**
 * buy: the price button (a null price shows it loading, not tappable). owned: an Owned chip. busy: the
 * button with a spinner, not tappable, while the store answers. pending: "Waiting for payment" (a
 * purchase the store hasn't finished). unavailable: a grey button with no price.
 */
export type WorkshopState = 'buy' | 'owned' | 'busy' | 'pending' | 'unavailable';

export interface WorkshopItem {
  /** The product id. Its button is data-action="buy" data-id="<id>". */
  id: string;
  name: string;
  /** One line: what it gives. Portraits, three to a row, leave it out. */
  text: string;
  art: WorkshopArt;
  /** The store's price string ("$4.99", "4,99 €"); null while it loads or when the store has none. */
  price: string | null;
  state: WorkshopState;
  /** A small line under the text: "Includes Remove Ads", "Unlocks 19 rewards now". */
  note?: string;
  /** A corner sticker: "Best value", "Animated". */
  badge?: string;
}

export type WorkshopStore = 'play' | 'appstore' | 'test' | 'offline';

export interface WorkshopSection { id: string; title: string; text?: string; items: WorkshopItem[] }

export interface WorkshopData {
  sections: WorkshopSection[];
  /** Portraits show the player's own Blockling. */
  avatar: AvatarSpec;
  /** Where the prices come from, for the footer line. */
  store: WorkshopStore;
  /** Hold animated portraits still (Reduce Motion). */
  still?: boolean;
}

/** The Workshop's words. */
export const WORKSHOP_COPY = {
  title: 'Workshop',
  sub: 'Everything here is optional. The whole game stays free to play.',
  restore: 'Restore purchases',
  store: {
    play: 'Prices from Google Play.',
    appstore: 'Prices from the App Store.',
    test: 'Test store: nothing is charged, and test purchases stay on this device.',
    offline: "Can't reach the store right now. What you own still works.",
  } as Record<WorkshopStore, string>,
  test: {
    kicker: 'Test purchase',
    text: 'This is a test build, so nothing is charged.',
    cost: (price: string) => `In the store app this would cost ${price}.`,
    confirm: 'Buy (test)',
    cancel: 'Cancel',
  },
};

// ---------------------------------------------------------------------------------------------
// Product art: stickers in a unit box centred on the origin, like the icons.

const GOLD = ['#FFC23D', '#FFE08A', '#D9971A'] as const;
const VIOLET = [SIGNAL.xp, '#B9A8FF', '#5236D6'] as const;
const ROSE = ['#F2A98A', '#FFD6C2', '#C97B5E'] as const;
const RIBBON = ['#FF4F64', '#FF9DAA', '#CC2E48'] as const;
const SKY = '#7FD8FF';
type Tri = readonly [string, string, string];
const fill = (c: Ctx, p: Path2D, t: Tri, lip?: number) => part(c, p, t[0], t[1], t[2], lip);

function line(c: Ctx, p: Path2D, w: number, col = INK): void {
  c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = col; c.stroke(p);
}
const tube = (c: Ctx, p: Path2D, w: number, col: string) => { line(c, p, w + O * 2); line(c, p, w, col); };

function poly(pts: [number, number][]): Path2D {
  const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p;
}

function starPath(x: number, y: number, R: number, r: number, n = 5): Path2D {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, d = i % 2 ? r : R; pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d]); }
  return poly(pts);
}

/** One block of shape `key`, u across, its top-left at (x, y); `w` is its outline (small blocks want a thin one). */
function block(c: Ctx, key: string, x: number, y: number, u: number, w = O): void {
  const s = ART_SHAPES[key], b = rrPath(x, y, u, u, u * 0.22), lip = u * 0.16;
  c.save(); c.clip(b);
  c.fillStyle = s.light; c.fill(b);
  c.fillStyle = s.base; c.fillRect(x - 1, y + lip, u + 2, u);
  c.fillStyle = s.shade; c.fillRect(x - 1, y + u - lip * 0.9, u + 2, u);
  c.restore();
  ink(c, b, w);
}

function sparkle(c: Ctx, x: number, y: number, r: number, col = '#FFFFFF'): void {
  const p = twinkle(x, y, r); c.fillStyle = col; c.fill(p); ink(c, p, O * 0.6);
}

/** Supporter Pack: a rose-gold rosette with ribbon tails and a heart, the supporter's colors. */
function drawSupporter(c: Ctx): void {
  const cy = -0.07;
  for (const sx of [-1, 1]) fill(c, poly([[sx * 0.01, cy + 0.12], [sx * 0.15, cy + 0.08], [sx * 0.28, 0.45], [sx * 0.19, 0.38], [sx * 0.11, 0.47]]), RIBBON, 0.03);
  const n = 14, R = 0.29, b = 0.045, ros = new Path2D();
  for (let i = 0; i <= n * 12; i++) {
    const a = (i / (n * 12)) * TAU, r = R + b * (0.5 + 0.5 * Math.cos(n * a));
    i ? ros.lineTo(Math.cos(a) * r, cy + Math.sin(a) * r) : ros.moveTo(Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ros.closePath();
  fill(c, ros, ROSE, 0.04);
  const inner = circlePath(0, cy, 0.21);
  c.fillStyle = '#FFE7DA'; c.fill(inner); ink(c, inner, O * 0.45);
  fill(c, heart(0, cy + 0.02, 0.42), RIBBON, 0.035);
  c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.ellipse(-0.075, cy - 0.04, 0.035, 0.02, -0.6, 0, TAU); c.fill();
  sparkle(c, 0.33, -0.36, 0.08, GOLD[1]);
  sparkle(c, -0.36, -0.26, 0.05, GOLD[1]);
}

/** Builder's Pass: a violet ticket with a gold star on its stub and three blocks stepping up, the level track. */
function drawPass(c: Ctx): void {
  c.save(); c.rotate(-0.2);
  const W = 0.44, H = 0.25, r = 0.06, px = -0.16, nr = 0.05, t = new Path2D();
  t.moveTo(-W + r, -H); t.lineTo(px - nr, -H); t.arc(px, -H, nr, Math.PI, 0, true); t.lineTo(W - r, -H); t.arcTo(W, -H, W, -H + r, r);
  t.lineTo(W, H - r); t.arcTo(W, H, W - r, H, r); t.lineTo(px + nr, H); t.arc(px, H, nr, 0, Math.PI, true); t.lineTo(-W + r, H);
  t.arcTo(-W, H, -W, H - r, r); t.lineTo(-W, -H + r); t.arcTo(-W, -H, -W + r, -H, r); t.closePath();
  fill(c, t, VIOLET, 0.045);
  c.save(); c.clip(t);
  c.fillStyle = GOLD[0]; c.fillRect(px + 0.07, -1, 0.045, 2);
  c.setLineDash([0.045, 0.04]); line(c, poly([[px, -H + nr], [px, H - nr]]), 0.025, PAPER); c.setLineDash([]);
  c.restore();
  ink(c, t);
  fill(c, starPath(-0.3, 0.005, 0.11, 0.05), GOLD, 0.025);
  const win = rrPath(-0.03, -0.19, 0.42, 0.38, 0.05);
  c.fillStyle = '#FFFFFF'; c.fill(win); ink(c, win, O * 0.6);
  // A staircase of blocks: the level track, one step a level.
  const u = 0.105, x0 = 0.01, base = 0.155;
  (['S', 'O', 'L'] as const).forEach((k, i) => { for (let j = 0; j <= i; j++) block(c, k, x0 + i * (u + 0.012), base - (j + 1) * (u + 0.004), u, O * 0.5); });
  c.restore();
  sparkle(c, 0.34, -0.36, 0.07, GOLD[1]);
}

/** Remove Ads: the crossed-out AD sticker, with a sparkle. */
function drawRemoveAds(c: Ctx): void {
  drawNoAds(c);
  sparkle(c, 0.36, -0.36, 0.07, GOLD[1]);
}

/** Second Wind always ready: the Second Wind icon inside a sky-blue loop, round every run. */
function drawWindReady(c: Ctx): void {
  const r = 0.39, a0 = Math.PI * 0.8, a1 = Math.PI * 2.42, loop = new Path2D();
  loop.arc(0, 0, r, a0, a1);
  tube(c, loop, 0.065, SKY);
  const P = [Math.cos(a1) * r, Math.sin(a1) * r], T = [-Math.sin(a1), Math.cos(a1)], N = [Math.cos(a1), Math.sin(a1)];
  const head = poly([[P[0] + T[0] * 0.13, P[1] + T[1] * 0.13], [P[0] + N[0] * 0.1, P[1] + N[1] * 0.1], [P[0] - N[0] * 0.1, P[1] - N[1] * 0.1]]);
  c.fillStyle = SKY; c.fill(head); ink(c, head, O * 0.9);
  drawPowerIcon(c, 'wind', 0.01, 0.01, 0.62);
}

/** A Workshop set until its own art exists: an open box with three blocks in it, a ribbon in the set's color. */
function drawSet(c: Ctx, id: string): void {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const rib = ([RIBBON, VIOLET, [SIGNAL.mint, '#B4FADF', '#1FB884'], GOLD] as Tri[])[h % 4];
  const u = 0.2;
  c.save(); c.translate(-0.2, -0.16); c.rotate(-0.3); block(c, 'Z', -u / 2, -u / 2, u); c.restore();
  c.save(); c.translate(0.18, -0.18); c.rotate(0.25); block(c, 'I', -u / 2, -u / 2, u); c.restore();
  block(c, 'O', -u / 2, -0.3, u);
  const box = rrPath(-0.36, -0.06, 0.72, 0.42, 0.06);
  fill(c, box, ['#F2C891', '#FFE2B8', '#C99A62'], 0.04);
  c.save(); c.clip(box); c.fillStyle = rib[0]; c.fillRect(-0.07, -1, 0.14, 2); c.restore();
  ink(c, box);
  fill(c, rrPath(-0.4, -0.12, 0.8, 0.12, 0.04), ['#E9B872', '#FFE2B8', '#B9874E'], 0.025);
}

type ArtName = Exclude<WorkshopArt, { portrait: string }>;

/** Draw a product's art centred at (x, y), `size` px square. Portraits are portraitHtml's. */
export function drawWorkshopArt(c: Ctx, art: ArtName, x: number, y: number, size: number): void {
  c.save(); c.translate(x, y); c.scale(size, size);
  if (typeof art === 'object') drawSet(c, art.set);
  else ({ supporter: drawSupporter, builders_pass: drawPass, remove_ads: drawRemoveAds, second_wind_ready: drawWindReady })[art](c);
  c.restore();
}

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);

/** A product's art as a cached PNG URL, `cssPx` square at the device's resolution. */
export function workshopArtUrl(art: ArtName, cssPx: number, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr), key = typeof art === 'object' ? `set:${art.set}` : art;
  return canvasUrl(`shop:${key}:${px}`, () => {
    const cv = makeCanvas(px, px);
    drawWorkshopArt(ctx2d(cv), art, px / 2, px / 2, px);
    return cv;
  });
}

// ---------------------------------------------------------------------------------------------
// The panel

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const icon = (name: UiIcon, px = 24): string => `<img alt="" src="${uiIconUrl(name, px)}">`;
const isPortrait = (a: WorkshopArt): a is { portrait: string } => typeof a === 'object' && 'portrait' in a;
const artKey = (a: WorkshopArt): string => (typeof a === 'string' ? a : isPortrait(a) ? `pt:${a.portrait}` : `set:${a.set}`);

/** What each panel was built with, for redrawing one card. */
const built = new WeakMap<HTMLElement, { avatar: AvatarSpec; still: boolean }>();

function artHtml(a: WorkshopArt, px: number, avatar: AvatarSpec, still: boolean): string {
  return isPortrait(a) ? portraitHtml(a.portrait, avatar, px, { still }) : `<img alt="" src="${workshopArtUrl(a, px)}">`;
}

function actionHtml(it: WorkshopItem, small: boolean): string {
  const name = esc(it.name), price = it.price ? esc(it.price) : '';
  if (it.state === 'owned') return `<span class="ui-chip mint ui-shop-owned">${icon('check', small ? 15 : 18)}Owned</span>`;
  if (it.state === 'pending') return `<span class="ui-shop-pending" role="status"><i></i>Waiting for payment</span>`;
  if (it.state === 'unavailable') return `<button type="button" class="ui-btn ui-shop-buy" disabled aria-label="${name} isn't available right now">${small ? 'Unavailable' : 'Not available'}</button>`;
  if (it.state === 'busy') return `<button type="button" class="ui-btn primary ui-shop-buy busy" disabled aria-busy="true" aria-label="Buying ${name}"><i class="ui-shop-spin"></i><span>${price || '…'}</span></button>`;
  if (!price) return `<button type="button" class="ui-btn primary ui-shop-buy loading" disabled aria-label="${name}: loading the price"><i class="ui-shop-dots"><b></b><b></b><b></b></i></button>`;
  return `<button type="button" class="ui-btn primary ui-shop-buy" data-action="buy" data-id="${esc(it.id)}" aria-label="Buy ${name} for ${price}">${price}</button>`;
}

function cardHtml(it: WorkshopItem, avatar: AvatarSpec, still: boolean): string {
  const badge = it.badge ? `<span class="ui-shop-badge">${esc(it.badge)}</span>` : '';
  const note = it.note ? `<small class="ui-shop-tip">${esc(it.note)}</small>` : '';
  const art = `<div class="ui-shop-art" data-art="${esc(artKey(it.art))}">${artHtml(it.art, isPortrait(it.art) ? 66 : it.art === 'supporter' ? 70 : 60, avatar, still)}</div>`;
  if (isPortrait(it.art)) {
    return `<div class="ui-shop-item pt ${it.state}" data-id="${esc(it.id)}">${badge}${art}<b>${esc(it.name)}</b>${note}<div class="ui-shop-act">${actionHtml(it, true)}</div></div>`;
  }
  return `<div class="ui-shop-item ${it.state}${it.art === 'supporter' ? ' feature' : ''}" data-id="${esc(it.id)}">${badge}${art}
    <div class="ui-shop-txt"><b>${esc(it.name)}</b><span>${esc(it.text)}</span>${note}</div><div class="ui-shop-act">${actionHtml(it, false)}</div></div>`;
}

function storeHtml(store: WorkshopStore): string {
  return `<p class="ui-shop-store ${store}">${icon(store === 'offline' ? 'info' : store === 'test' ? 'toolbox' : 'check', 16)}<span>${esc(WORKSHOP_COPY.store[store])}</span></p>`;
}

/**
 * The Workshop, on an Ink overlay: sections of cards from `d`, portraits three to a row, Restore
 * purchases and the store line at the bottom. Actions: close, buy (data-id on the button: the product
 * id), restore. Buttons that can't be tapped (loading, busy, unavailable) don't fire.
 */
export function workshopPanel(d: WorkshopData): HTMLElement {
  injectWorkshopCss();
  const still = !!d.still;
  const section = (s: WorkshopSection): string => {
    const wide = s.items.filter(i => !isPortrait(i.art)), pts = s.items.filter(i => isPortrait(i.art));
    return `<section class="ui-shop-sec" data-sec="${esc(s.id)}"><h2 class="ui-h2">${esc(s.title)}</h2>${s.text ? `<p class="ui-shop-sectext">${esc(s.text)}</p>` : ''}
      ${wide.length ? `<div class="ui-shop-list">${wide.map(i => cardHtml(i, d.avatar, still)).join('')}</div>` : ''}
      ${pts.length ? `<div class="ui-shop-grid">${pts.map(i => cardHtml(i, d.avatar, still)).join('')}</div>` : ''}</section>`;
  };
  const root = el(`<div class="ui ui-overlay ui-shop-ov${still ? ' ui-still' : ''}" role="dialog" aria-label="${WORKSHOP_COPY.title}"><div class="ui-panel ui-shop">
    <div class="ui-shop-top"><div class="ui-shop-awning" aria-hidden="true"><i></i></div><button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close">${icon('close', 20)}</button></div>
    <div class="ui-shop-head">${icon('workshop', 46)}<div><h1 class="ui-h1">${WORKSHOP_COPY.title}</h1><p>${esc(WORKSHOP_COPY.sub)}</p></div></div>
    ${d.sections.map(section).join('')}
    <div class="ui-shop-foot">
      <button type="button" class="ui-btn wide ui-shop-restore" data-action="restore">${icon('restore', 24)}<span>${WORKSHOP_COPY.restore}</span></button>
      ${storeHtml(d.store)}
    </div>
  </div><p class="ui-shop-msg" role="status" aria-live="polite"></p></div>`);
  built.set(root, { avatar: d.avatar, still });
  return root;
}

function panelOf(host: HTMLElement): HTMLElement | null {
  return host.classList.contains('ui-shop-ov') ? host : host.querySelector<HTMLElement>('.ui-shop-ov') ?? host.closest<HTMLElement>('.ui-shop-ov');
}

/**
 * Redraw one card from `item` (matched by id): a price arriving, busy while the store answers, owned
 * after, pending, a new note. Its art stays as it was, so an animated portrait doesn't restart.
 */
export function setWorkshopItem(panel: HTMLElement, item: WorkshopItem): void {
  const root = panelOf(panel);
  if (!root) return;
  const old = [...root.querySelectorAll<HTMLElement>('.ui-shop-item')].find(e => e.dataset.id === item.id);
  if (!old) return;
  const b = built.get(root) ?? { avatar: {}, still: false };
  const next = el(cardHtml(item, b.avatar, b.still));
  const oldArt = old.querySelector<HTMLElement>('.ui-shop-art'), newArt = next.querySelector<HTMLElement>('.ui-shop-art');
  if (oldArt && newArt && oldArt.dataset.art === newArt.dataset.art) newArt.replaceWith(oldArt);
  if (item.state === 'owned' && !old.classList.contains('owned')) next.classList.add('got');
  old.replaceWith(next);
}

const notes = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * A short message over the bottom of the Workshop: "Restored 2 purchases", "Purchase cancelled". It goes
 * after 3.5 s unless `stay`; '' hides it now. Tone good is mint, bad is red, none is Paper.
 */
export function setWorkshopNote(panel: HTMLElement, text: string, tone?: 'good' | 'bad', o: { stay?: boolean } = {}): void {
  const root = panelOf(panel), msg = root?.querySelector<HTMLElement>('.ui-shop-msg');
  if (!root || !msg) return;
  clearTimeout(notes.get(root));
  if (!text) { msg.classList.remove('on'); return; }
  msg.className = `ui-shop-msg${tone ? ` ${tone}` : ''}`;
  msg.innerHTML = `${icon(tone === 'bad' ? 'info' : tone === 'good' ? 'check' : 'workshop', 20)}<span>${esc(text)}</span>`;
  void msg.offsetWidth;
  msg.classList.add('on');
  if (!o.stay) notes.set(root, setTimeout(() => msg.classList.remove('on'), 3500));
}

/** Change the footer's store line, e.g. offline to play once the store answers. */
export function setWorkshopStore(panel: HTMLElement, store: WorkshopStore): void {
  const p = panelOf(panel)?.querySelector('.ui-shop-store');
  if (p) p.outerHTML = storeHtml(store);
}

/** The Restore purchases button's busy state while the store looks. */
export function setWorkshopRestoring(panel: HTMLElement, on: boolean): void {
  const b = panelOf(panel)?.querySelector<HTMLButtonElement>('.ui-shop-restore');
  if (!b) return;
  b.disabled = on;
  b.classList.toggle('busy', on);
  b.querySelector('span')!.textContent = on ? 'Restoring…' : WORKSHOP_COPY.restore;
}

/**
 * The test store's confirm sheet, over the Workshop: "Test purchase", the item's art and name, and that
 * nothing is charged (with what the store app would charge, when the price is known). Actions: confirm,
 * cancel. Pass the player's avatar for a portrait.
 */
export function testPurchaseSheet(item: WorkshopItem, o: { avatar?: AvatarSpec; still?: boolean } = {}): HTMLElement {
  injectWorkshopCss();
  const t = WORKSHOP_COPY.test;
  return el(`<div class="ui ui-overlay ui-shop-test-ov${o.still ? ' ui-still' : ''}" role="dialog" aria-label="${t.kicker}"><div class="ui-panel ui-shop-test">
    <div class="ui-shop-tape" aria-hidden="true">TEST · TEST · TEST · TEST · TEST · TEST</div>
    <span class="ui-kicker">${t.kicker}</span>
    <div class="ui-shop-test-art">${artHtml(item.art, 96, o.avatar ?? {}, !!o.still)}</div>
    <b class="ui-shop-test-name">${esc(item.name)}</b>
    <p>${esc(t.text)}${item.price ? ` ${esc(t.cost(item.price))}` : ''}</p>
    <div class="ui-stack">
      <button type="button" class="ui-btn primary big wide" data-action="confirm">${t.confirm}</button>
      <button type="button" class="ui-btn wide" data-action="cancel">${t.cancel}</button>
    </div>
  </div></div>`);
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

const CSS = `
.ui-shop-ov { overflow: hidden; }
.ui-shop { width: min(380px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 0 14px 14px; text-align: left; }
.ui-shop::-webkit-scrollbar { display: none; }
/* The awning stays at the top as the cards scroll under it, with the close button: red and white stripes
   with a scalloped edge, its Ink line a hard shadow under the scallops. */
.ui-shop-top { position: sticky; top: 0; z-index: 2; height: 30px; margin: 0 -14px; pointer-events: none; }
.ui-shop-awning { position: absolute; inset: 0; filter: drop-shadow(0 3px 0 var(--ink)); }
.ui-shop-awning i { position: absolute; inset: 0; border-radius: 13px 13px 0 0; background: linear-gradient(rgba(255,255,255,0.35) 0 4px, transparent 4px), repeating-linear-gradient(90deg, var(--danger) 0 24px, #fff 24px 48px);
  -webkit-mask: radial-gradient(circle 12px at 12px 18px, #000 97%, transparent 100%) 0 0 / 24px 30px repeat-x, linear-gradient(#000, #000) 0 0 / 100% 18px no-repeat;
  mask: radial-gradient(circle 12px at 12px 18px, #000 97%, transparent 100%) 0 0 / 24px 30px repeat-x, linear-gradient(#000, #000) 0 0 / 100% 18px no-repeat; }
.ui-shop-top .ui-close { top: 6px; right: 8px; pointer-events: auto; }
.ui-shop-head { display: flex; align-items: center; gap: 10px; margin: 12px 44px 4px 0; }
.ui-shop-head > img { width: 46px; height: 46px; flex: none; }
.ui-shop-head .ui-h1 { margin: 0; }
.ui-shop-head p { margin: 3px 0 0; font: 700 13px/1.3 var(--body); color: var(--ink-soft); }
.ui-shop-sec .ui-h2 { margin: 16px 0 6px; }
.ui-shop-sectext { margin: -2px 0 8px; font: 600 13px/1.3 var(--body); color: var(--ink-soft); }
.ui-shop-list { display: flex; flex-direction: column; gap: 10px; }
.ui-shop-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 8px; margin-top: 10px; }
.ui-shop-list + .ui-shop-grid { margin-top: 14px; }
.ui-shop-item { position: relative; display: grid; grid-template-columns: 60px minmax(0, 1fr) auto; gap: 10px; align-items: center; background: #fff; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); padding: 8px 8px 8px 7px; }
.ui-shop-art { display: grid; place-items: center; }
.ui-shop-art > img { display: block; width: 60px; height: 60px; }
.ui-shop-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ui-shop-txt b { font: 700 17px/1.1 var(--display); }
.ui-shop-txt span { font: 600 12px/1.3 var(--body); color: var(--ink-soft); }
.ui-shop-tip { display: block; margin-top: 2px; font: 800 11.5px/1.25 var(--body); color: #5236D6; }
.ui-shop-act { display: flex; justify-content: flex-end; }
.ui-shop-buy { min-width: 84px; min-height: 44px; padding: 6px 12px; font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-shop-buy:disabled { font-size: 13px; }
.ui-shop-buy.busy, .ui-shop-buy.loading { background: var(--gold); color: var(--ink); border-color: var(--ink); box-shadow: 0 4px 0 var(--ink); opacity: 0.75; }
.ui-shop-buy.busy span { font-size: 16px; }
.ui-shop-spin { width: 16px; height: 16px; flex: none; border: 3px solid rgba(34,24,58,0.25); border-top-color: var(--ink); border-radius: 50%; animation: ui-spin 700ms linear infinite; }
.ui-shop-dots { display: flex; gap: 4px; }
.ui-shop-dots b { width: 7px; height: 7px; border-radius: 50%; background: var(--ink); opacity: 0.3; animation: ui-shop-dot 900ms ease-in-out infinite; }
.ui-shop-dots b + b { animation-delay: 150ms; } .ui-shop-dots b + b + b { animation-delay: 300ms; }
@keyframes ui-shop-dot { 50% { opacity: 0.9; transform: translateY(-2px); } }
.ui-shop-owned { font-size: 14px; padding: 4px 8px; }
.ui-shop-item.got .ui-shop-owned { animation: ui-pop 420ms cubic-bezier(.3,1.8,.5,1); }
.ui-shop-pending { display: flex; align-items: center; gap: 5px; max-width: 92px; font: 800 11px/1.2 var(--body); color: var(--ink); background: var(--amber); border: 2px solid var(--ink); border-radius: 10px; padding: 4px 7px; }
.ui-shop-pending i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--ink); animation: ui-shop-dot 1.2s ease-in-out infinite; }
.ui-shop-item.owned { background: #F2FFF9; }
.ui-shop-item.unavailable .ui-shop-art { opacity: 0.55; filter: grayscale(0.6); }
.ui-shop-badge { position: absolute; top: -11px; right: 10px; z-index: 1; font: 700 11px/1 var(--display); letter-spacing: 0.03em; white-space: nowrap; background: var(--gold); border: 2px solid var(--ink); border-radius: 8px; box-shadow: 0 2px 0 var(--ink); padding: 3px 7px; transform: rotate(3deg); }
/* The Supporter offer: rose and gold, a size up. */
.ui-shop-item.feature { grid-template-columns: 70px minmax(0, 1fr) auto; background: linear-gradient(160deg, #FFE7EE, #FFF4DE 70%); border-width: 3px; box-shadow: 0 4px 0 var(--ink); padding: 10px 8px 10px 7px; }
.ui-shop-item.feature .ui-shop-art > img { width: 70px; height: 70px; }
.ui-shop-item.feature .ui-shop-txt b { font-size: 19px; }
.ui-shop-item.feature .ui-shop-badge { background: #FF9DB8; }
/* Portraits: three to a row, the portrait over its name and price. */
.ui-shop-item.pt { grid-template-columns: 1fr; justify-items: center; gap: 5px; padding: 10px 5px 7px; text-align: center; }
.ui-shop-item.pt > b { font: 700 13px/1.1 var(--display); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-shop-item.pt .ui-shop-tip { margin: 0; font-size: 10.5px; }
.ui-shop-item.pt .ui-shop-act { justify-content: center; width: 100%; }
.ui-shop-item.pt .ui-shop-buy { min-width: 0; width: 100%; min-height: 40px; padding: 4px 6px; font-size: 16px; border-radius: 12px; }
.ui-shop-item.pt .ui-shop-buy:disabled { font-size: 11.5px; }
.ui-shop-item.pt .ui-shop-owned { font-size: 13px; padding: 3px 7px; }
.ui-shop-item.pt .ui-shop-pending { max-width: none; font-size: 10px; padding: 3px 5px; }
.ui-shop-item.pt .ui-shop-badge { top: -10px; right: 50%; transform: translateX(50%) rotate(-3deg); font-size: 10px; padding: 2px 6px; }
.ui-shop-foot { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
.ui-shop-restore { font-size: 17px; min-height: 48px; }
.ui-shop-restore.busy { background: var(--paper-2); color: var(--ink-soft); }
.ui-shop-store { display: flex; align-items: center; gap: 6px; margin: 0; padding: 7px 9px; font: 700 12px/1.3 var(--body); color: var(--ink-soft); border: 2px dashed rgba(34,24,58,0.25); border-radius: 10px; }
.ui-shop-store img { width: 16px; height: 16px; flex: none; }
.ui-shop-store.test { color: var(--ink); background: #FFF0C8; border-color: var(--amber); }
.ui-shop-store.offline { color: var(--ink); background: #FFE9EC; border-color: var(--danger); }
/* The message toast, over the panel's bottom edge. */
.ui-shop-msg { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 22px); z-index: 4; display: flex; align-items: center; gap: 7px; max-width: min(340px, calc(100% - 32px)); margin: 0;
  font: 700 15px/1.25 var(--display); background: var(--paper); border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 4px 0 var(--ink); padding: 8px 14px 8px 9px;
  opacity: 0; transform: translate(-50%, 16px) scale(0.92); transition: opacity 180ms, transform 320ms cubic-bezier(.3,1.7,.5,1); pointer-events: none; }
.ui-shop-msg.on { opacity: 1; transform: translate(-50%, 0); }
.ui-shop-msg.good { background: var(--mint); }
.ui-shop-msg.bad { background: #FFD1D9; }
.ui-shop-msg img { width: 20px; height: 20px; flex: none; }
/* The test store's sheet: a strip of hazard tape so a test purchase never looks like the real thing. */
.ui-shop-test-ov { z-index: 21; }
.ui-shop-test { width: min(320px, 100%); padding: 30px 18px 18px; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ui-shop-tape { position: absolute; left: -10px; right: -10px; top: 0; height: 22px; display: grid; place-items: center; overflow: hidden; white-space: nowrap; font: 700 11px/1 var(--display); letter-spacing: 0.2em; color: var(--ink);
  background: repeating-linear-gradient(-45deg, var(--gold) 0 12px, #FFE08A 12px 24px); border-bottom: 3px solid var(--ink); }
.ui-shop-test-art { display: grid; place-items: center; margin: 4px 0 2px; }
.ui-shop-test-art > img { width: 96px; height: 96px; }
.ui-shop-test-name { font: 700 22px/1.15 var(--display); }
.ui-shop-test p { margin: 2px 0 10px; font: 600 14px/1.35 var(--body); color: var(--ink-soft); }
.ui-shop-test .ui-stack { width: 100%; }
@media (max-width: 350px) {
  .ui-shop { padding: 0 10px 12px; }
  .ui-shop-top { margin: 0 -10px; }
  .ui-shop-item { grid-template-columns: 48px minmax(0, 1fr) auto; gap: 8px; }
  .ui-shop-art > img { width: 48px; height: 48px; }
  .ui-shop-item.feature { grid-template-columns: 56px minmax(0, 1fr) auto; }
  .ui-shop-item.feature .ui-shop-art > img { width: 56px; height: 56px; }
  .ui-shop-buy { min-width: 74px; font-size: 16px; padding: 6px 8px; }
  .ui-shop-grid { gap: 12px 6px; }
}
`;

/** Adds the Workshop's rules to the page once (its builders do it themselves). */
export function injectWorkshopCss(): void {
  if (typeof document === 'undefined' || document.getElementById('st-ui-workshop')) return;
  const style = document.createElement('style');
  style.id = 'st-ui-workshop';
  style.textContent = CSS;
  document.head.appendChild(style);
}
