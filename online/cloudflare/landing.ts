// The page a shared link opens (launch marketing plan, "A link that works on any phone"): what the friend
// stacked, and the way to the right store for the phone that opened it. GET / (the game), /d/<n> (Daily
// #n, both with ?h=<metres> to beat), and /get, which sends a phone straight to its store. Plain HTML,
// no scripts, no cookies; the picture (og.png) and icon are static files in online/public. Public copy
// never names other games.

import { dailyDay, dailyNumber } from '../../game/src/meta/daily.ts';

export const PACKAGE = 'com.blakepixhil.shapetower';
/** The App Store link once the iPhone app is out; until then iPhones see "coming soon". */
export const APP_STORE_URL = '';
const PRIVACY_URL = 'https://github.com/BlakePixHil/shape_tower/blob/main/PRIVACY.md';

export type Phone = 'android' | 'ios' | 'other';

export function phoneOf(ua: string | null): Phone {
  if (!ua) return 'other';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

/** Link previews (chat apps, social sites) and crawlers: they don't count as visits. */
export const isBot = (ua: string | null): boolean => !ua || /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|vkshare|skype|curl|wget|python|headless/i.test(ua);

/** Google Play, tagged so Play Console's acquisition report shows installs that came from share links. */
export function playUrl(campaign: string): string {
  const referrer = `utm_source=share_link&utm_medium=link&utm_campaign=${campaign}`;
  return `https://play.google.com/store/apps/details?id=${PACKAGE}&referrer=${encodeURIComponent(referrer)}`;
}

/** Where /get sends a phone: its store, or the page when there's no store for it yet. */
export function storeRedirect(phone: Phone): string | null {
  if (phone === 'android') return playUrl('get');
  if (phone === 'ios' && APP_STORE_URL) return APP_STORE_URL;
  return null;
}

/** The height to beat from ?h=, or null when it isn't a believable one. */
export function heightParam(v: string | null): number | null {
  if (v === null || !/^\d{1,4}(\.\d)?$/.test(v)) return null;
  const h = Number(v);
  return h > 0 && h <= 5000 ? h : null;
}

/** Daily #n from the path /d/<n>: a whole number from 1 up to today's. */
export function dailyParam(v: string, now = Date.now()): number | null {
  if (!/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= dailyNumber(dailyDay(new Date(now))) ? n : null;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const m = (h: number): string => `${h.toFixed(1)} m`;

export interface Landing {
  /** Daily #n, or null for the game's own page. */
  daily: number | null;
  height: number | null;
  phone: Phone;
  /** The page's own address, for link previews. */
  url: string;
  origin: string;
  now?: number;
}

/** The words on the page: title, the line under it, and the preview text. */
export function landingCopy(o: Landing): { title: string; kicker: string; lead: string; preview: string } {
  const today = dailyNumber(dailyDay(new Date(o.now ?? Date.now())));
  if (o.daily) {
    const isToday = o.daily === today;
    const kicker = `Daily #${o.daily}`;
    if (o.height) {
      return {
        kicker,
        title: isToday ? `Can you beat ${m(o.height)}?` : `They stacked ${m(o.height)}`,
        lead: isToday
          ? `A friend stacked ${m(o.height)} on today's Daily Tower. Everyone gets the same shapes today, and one scored try.`
          : `A friend stacked ${m(o.height)} on Daily #${o.daily}. Today's tower is #${today}: everyone gets the same shapes, and one scored try.`,
        preview: `Shape Tower Daily #${o.daily}: ${m(o.height)}. Can you stack higher?`,
      };
    }
    return { kicker, title: 'The Daily Tower', lead: `Everyone gets the same shapes each day, and one scored try. Today's tower is #${today}.`, preview: `Shape Tower Daily #${o.daily}` };
  }
  if (o.height) {
    return { kicker: 'Shape Tower', title: `Can you beat ${m(o.height)}?`, lead: `A friend stacked ${m(o.height)}. Stack wobbly shapes as high as you can, from a meadow up through the clouds to deep space.`, preview: `Shape Tower: ${m(o.height)}. Can you stack higher?` };
  }
  return { kicker: 'Shape Tower', title: 'Stack & Balance', lead: 'Stack wobbly shapes as high as you can, from a meadow up through the clouds to deep space. A new Daily Tower every day, the same for everyone.', preview: 'Shape Tower: Stack & Balance' };
}

export function landingPage(o: Landing): string {
  const c = landingCopy(o);
  const play = playUrl(o.daily ? 'daily' : 'run');
  const playBtn = `<a class="btn" href="${esc(play)}">Get it on Google Play</a>`;
  const ios = APP_STORE_URL ? `<a class="btn" href="${esc(APP_STORE_URL)}">Download on the App Store</a>` : '<p class="soon">Coming soon to iPhone and iPad</p>';
  const stores = o.phone === 'ios'
    ? `${ios}${APP_STORE_URL ? '' : `<p class="alt">On Android? <a href="${esc(play)}">Get it on Google Play</a></p>`}`
    : o.phone === 'android' ? playBtn : `${playBtn}${ios}`;
  const title = `${c.kicker === 'Shape Tower' ? 'Shape Tower' : `Shape Tower ${c.kicker}`}: ${c.title}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(c.lead)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Shape Tower">
<meta property="og:title" content="${esc(c.preview)}">
<meta property="og:description" content="${esc(c.lead)}">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:image" content="${esc(o.origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Shape Tower logo over a sunny meadow">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#8EC8FF">
<link rel="icon" href="/icon.png">
<style>
:root { --ink: #22183A; --soft: #5B4F7A; --paper: #FFF7E8; --gold: #FFC93C; --sky: #8EC8FF; --grass: #7FD36B; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; font-family: ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  background: linear-gradient(#8EC8FF, #BFE3FF 60%, #DFF4C9 85%, var(--grass)); display: flex; flex-direction: column; align-items: center; }
main { width: 100%; max-width: 480px; padding: 16px 16px 8px; }
.hero { display: block; width: 100%; height: auto; border: 3px solid var(--ink); border-radius: 18px; box-shadow: 0 6px 0 var(--ink); background: var(--sky); }
.card { margin-top: 18px; background: var(--paper); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 0 6px 0 var(--ink); padding: 18px 18px 20px; text-align: center; }
.kicker { margin: 0; font-weight: 800; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); }
h1 { margin: 6px 0 8px; font-size: 32px; line-height: 1.1; text-wrap: balance; }
.lead { margin: 0 0 16px; font-size: 17px; line-height: 1.4; }
.btn { display: block; margin: 10px auto 0; max-width: 320px; padding: 14px 18px; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 4px 0 var(--ink);
  background: var(--gold); color: var(--ink); font-weight: 800; font-size: 19px; text-decoration: none; }
.btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.soon { margin: 12px 0 0; font-weight: 700; color: var(--soft); }
.alt { margin: 10px 0 0; font-size: 15px; }
.alt a, footer a { color: var(--ink); }
footer { padding: 8px 16px 20px; font-size: 13px; color: var(--soft); }
</style>
</head>
<body>
<main>
<img class="hero" src="/og.png" width="1200" height="630" alt="Shape Tower">
<div class="card">
<p class="kicker">${esc(c.kicker)}</p>
<h1>${esc(c.title).replace(/(\d) m\b/g, '$1&nbsp;m')}</h1>
<p class="lead">${esc(c.lead)}</p>
${stores}
</div>
</main>
<footer><a href="${PRIVACY_URL}">Privacy</a> · No sign-up, no cookies.</footer>
</body>
</html>
`;
}

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** What a landing request means for the counters (null: not one of ours). */
export type LandingHit = 'link:home' | 'link:daily' | 'link:store:android' | 'link:store:ios' | 'link:store:other';

/** Answers GET /, /d/<n> and /get; null for any other path. `hit` says what to count (never for bots). */
export function landing(request: Request, now = Date.now()): { response: Response; hit: LandingHit | null } | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const u = new URL(request.url), ua = request.headers.get('user-agent'), phone = phoneOf(ua), bot = isBot(ua);
  const height = heightParam(u.searchParams.get('h'));
  if (u.pathname === '/get') {
    const to = storeRedirect(phone);
    return { response: new Response(null, { status: 302, headers: { location: to ?? '/', 'cache-control': 'no-store' } }), hit: bot ? null : `link:store:${phone}` };
  }
  let daily: number | null = null;
  if (u.pathname.startsWith('/d/')) {
    daily = dailyParam(u.pathname.slice(3).replace(/\/$/, ''), now);
    if (daily === null) return { response: new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }), hit: null };
  } else if (u.pathname !== '/') {
    return null;
  }
  // The page's own address for link previews: only what was understood, never the raw query.
  const url = `${u.origin}${u.pathname}${height ? `?h=${height.toFixed(1)}` : ''}`;
  const html = landingPage({ daily, height, phone, url, origin: u.origin, now });
  return { response: new Response(request.method === 'HEAD' ? null : html, { headers: HEADERS }), hit: bot ? null : daily ? 'link:daily' : 'link:home' };
}
