// The Short's overlay, drawn apart from the game so the words can change without filming again: the
// captions (popping in on the voice's words), a small label, and the end card. A page with a clear
// background that scripts/short.ts steps frame by frame (window.paint(seconds)) and photographs; ffmpeg
// lays the pictures over the footage. Also the sky-and-phone frame the app's screens sit in.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OverlayCaption {
  /** Seconds it pops in, and when it goes. */
  t0: number;
  t1: number;
  /** True when the next caption follows straight on (no fade out). */
  swap: boolean;
  lines: { text: string; hi: boolean }[];
  /** Its top edge, as a fraction of the height, and its type size in CSS px at 540 wide. */
  top: number;
  size: number;
}
export interface OverlayCard {
  t0: number;
  badge: { text: string; t: number };
  stores: { text: string; t: number }[];
  free: { text: string; t: number };
  regions: string;
}
export interface OverlaySpec { captions: OverlayCaption[]; labels: { t0: number; t1: number; text: string }[]; card: OverlayCard }

/** Where a screen's picture sits in the 1080 x 1920 frame (video px). */
export const PHONE = { left: 122, top: 318, width: 836, height: 1486, radius: 54, border: 8 };

const b64 = (root: string, ...p: string[]) => readFileSync(join(root, ...p)).toString('base64');
const fonts = (root: string) => `
@font-face { font-family: Fredoka; src: url(data:font/woff2;base64,${b64(root, 'game', 'assets', 'fonts', 'fredoka-latin.woff2')}) format('woff2'); font-weight: 300 700; }
@font-face { font-family: Nunito; src: url(data:font/woff2;base64,${b64(root, 'game', 'assets', 'fonts', 'nunito-latin.woff2')}) format('woff2'); font-weight: 200 1000; }`;

/** The frame for the app's screens: the brand's sky with a clear, rounded window for the phone (1080 x 1920 at dpr 1). */
export function frameHtml(root: string): string {
  const p = PHONE, b = p.border;
  return `<!doctype html><meta charset="utf-8"><style>${fonts(root)}
html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: transparent; }
svg { position: absolute; inset: 0; }
</style>
<svg width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6EC3FF"/><stop offset="0.45" stop-color="#A9DCFF"/><stop offset="0.75" stop-color="#DDF2FF"/><stop offset="1" stop-color="#FFF7E8"/></linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="hole"><rect width="1080" height="1920" fill="#fff"/><rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}" rx="${p.radius - b}" fill="#000"/></mask>
  </defs>
  <g mask="url(#hole)">
    <rect width="1080" height="1920" fill="url(#sky)"/>
    <rect width="1080" height="1100" fill="url(#sun)"/>
    <rect x="${p.left - b}" y="${p.top - b + 22}" width="${p.width + 2 * b}" height="${p.height + 2 * b}" rx="${p.radius}" fill="rgba(43,33,64,0.22)"/>
    <rect x="${p.left - b}" y="${p.top - b}" width="${p.width + 2 * b}" height="${p.height + 2 * b}" rx="${p.radius}" fill="#2B2140"/>
  </g>
</svg>`;
}

/** The overlay page (540 x 960 CSS px, drawn at 2x). */
export function overlayHtml(root: string, spec: OverlaySpec, iconPath: string | null): string {
  const img = (name: string) => `data:image/webp;base64,${b64(root, 'game', 'assets', 'splash', name)}`;
  const icon = iconPath ? `data:image/png;base64,${readFileSync(iconPath).toString('base64')}` : '';
  return `<!doctype html><meta charset="utf-8"><style>${fonts(root)}
html, body { margin: 0; width: 540px; height: 960px; overflow: hidden; background: transparent; }
#cap { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 0 6%; box-sizing: border-box; }
#cap span { display: inline-block; font: 700 var(--fs, 40px)/1.12 Fredoka, sans-serif; color: #fff; -webkit-text-stroke: 7px #2B2140; paint-order: stroke fill;
  letter-spacing: 0.3px; text-shadow: 0 5px 0 rgba(43,33,64,0.35); white-space: nowrap; }
#cap span.hi { color: #FFD23F; }
#label { position: absolute; left: 50%; top: 30.5%; font: 700 21px Fredoka, sans-serif; color: #2B2140; background: #FFC93C; border: 3px solid #2B2140; border-radius: 14px;
  box-shadow: 0 4px 0 #2B2140; padding: 5px 14px; letter-spacing: 0.6px; white-space: nowrap; }
#card { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(#6EC3FF, #A9DEFF 58%, #E4F7FF); opacity: 0; }
#card .sun { position: absolute; left: 50%; top: -210px; width: 700px; height: 450px; margin-left: -350px; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.6), rgba(255,255,255,0)); }
#card .cloud { position: absolute; }
#card .hills { position: absolute; left: 0; bottom: 0; width: 540px; height: 225px; }
#card .icon { position: absolute; left: 50%; top: 118px; width: 128px; height: 128px; margin-left: -64px; border-radius: 30px; border: 4px solid #2B2140; box-shadow: 0 7px 0 rgba(43,33,64,.3); box-sizing: border-box; }
#card .logo { position: absolute; left: 50%; top: 272px; width: 430px; margin-left: -215px; transform-origin: 50% 60%; }
#card .badge { position: absolute; left: 50%; top: 472px; font: 700 38px Fredoka, sans-serif; color: #2B2140; background: #FFC93C; border: 4px solid #2B2140; border-radius: 20px;
  box-shadow: 0 6px 0 #2B2140; padding: 6px 26px; letter-spacing: 1px; white-space: nowrap; }
#card .stores { position: absolute; left: 0; right: 0; top: 566px; display: flex; justify-content: center; gap: 14px; }
#card .store { font: 600 25px Fredoka, sans-serif; color: #fff; background: #2B2140; border-radius: 16px; box-shadow: 0 5px 0 rgba(43,33,64,.3); padding: 11px 20px; white-space: nowrap; }
#card .free { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font: 700 29px Fredoka, sans-serif; color: #2B2140; }
#card .regions { position: absolute; left: 0; right: 0; top: 684px; text-align: center; font: 800 18px Nunito, sans-serif; color: #2B2140; opacity: 0.78; letter-spacing: 0.2px; }
</style>
<div id="cap"></div><div id="label"></div>
<div id="card">
  <div class="sun"></div>
  <img class="cloud" style="left:14px;top:66px;width:112px" src="${img('cloud.webp')}"><img class="cloud" style="right:10px;top:232px;width:84px" src="${img('cloud.webp')}"><img class="cloud" style="left:30px;top:742px;width:96px" src="${img('cloud.webp')}">
  <img class="hills" src="${img('hills.webp')}">
  ${icon ? `<img class="icon" src="${icon}">` : ''}
  <img class="logo" src="${img('logo.webp')}">
  <div class="badge"></div>
  <div class="stores"></div>
  <div class="free"></div>
  <div class="regions"></div>
</div>
<script>
const SPEC = ${JSON.stringify(spec)};
const clamp = t => Math.max(0, Math.min(1, t));
const back = t => { const c = 1.70158, u = clamp(t) - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
/** A part that pops in at time t0: clear before it, overshooting to full size. */
function pop(el, t, t0, centre) {
  const p = (t - t0) / 0.3;
  el.style.opacity = String(clamp((t - t0) / 0.1));
  el.style.transform = (centre ? 'translateX(-50%) ' : '') + 'scale(' + (0.5 + 0.5 * back(p)).toFixed(4) + ')';
}
const card = SPEC.card;
$('#card .badge').textContent = card.badge.text;
$('#card .stores').innerHTML = card.stores.map(s => '<div class="store">' + esc(s.text) + '</div>').join('');
$('#card .free').textContent = card.free.text;
$('#card .regions').textContent = card.regions;
/** Draws the overlay for time t (s) and says what it drew, so a frame that matches the last isn't photographed again. */
window.paint = t => {
  const key = [];
  const cap = $('#cap');
  const c = SPEC.captions.find(x => t >= x.t0 && t < x.t1 + (x.swap ? 0 : 0.16));
  if (!c || t >= card.t0 + 0.2) cap.style.display = 'none';
  else {
    const p = clamp((t - c.t0) / 0.24), a = t > c.t1 ? 1 - (t - c.t1) / 0.16 : clamp((t - c.t0) / 0.09);
    cap.style.display = '';
    cap.style.top = (c.top * 960).toFixed(1) + 'px';
    cap.style.setProperty('--fs', c.size + 'px');
    cap.style.opacity = a.toFixed(3);
    cap.style.transform = 'scale(' + (0.62 + 0.38 * back(p)).toFixed(4) + ') rotate(' + ((1 - p) * -4).toFixed(3) + 'deg)';
    const html = c.lines.map(l => '<span class="' + (l.hi ? 'hi' : '') + '">' + esc(l.text) + '</span>').join('');
    if (cap.dataset.html !== html) { cap.innerHTML = html; cap.dataset.html = html; }
    key.push('c', c.t0, p.toFixed(3), a.toFixed(3));
  }
  const label = $('#label');
  const l = SPEC.labels.find(x => t >= x.t0 + 0.25 && t < x.t1);
  if (!l) label.style.display = 'none';
  else {
    label.style.display = '';
    label.textContent = l.text;
    const p = (t - l.t0 - 0.25) / 0.3;
    label.style.opacity = String(clamp(p * 3));
    label.style.transform = 'translateX(-50%) rotate(-3deg) scale(' + (0.5 + 0.5 * back(p)).toFixed(4) + ')';
    key.push('l', l.t0, clamp(p).toFixed(3));
  }
  const el = $('#card');
  if (t < card.t0) el.style.opacity = '0';
  else {
    const u = t - card.t0;
    el.style.opacity = clamp(u / 0.35).toFixed(3);
    $('#card .logo').style.transform = 'scale(' + (0.8 + 0.2 * back(u / 0.5)).toFixed(4) + ')';
    const icon = $('#card .icon');
    if (icon) icon.style.transform = 'translateY(' + ((1 - back(u / 0.55)) * -60).toFixed(2) + 'px) rotate(' + ((1 - clamp(u / 0.55)) * -8).toFixed(2) + 'deg)';
    pop($('#card .badge'), t, card.badge.t, true);
    document.querySelectorAll('#card .store').forEach((s, i) => pop(s, t, card.stores[i].t, false));
    pop($('#card .free'), t, card.free.t, false);
    pop($('#card .regions'), t, card.free.t + 0.25, false);
    // The clouds drift, so the card is never a still.
    document.querySelectorAll('#card .cloud').forEach((cl, i) => { cl.style.transform = 'translateX(' + ((i % 2 ? -1 : 1) * u * 5).toFixed(2) + 'px)'; });
    key.push('k', u.toFixed(3));
  }
  return key.join(',');
};
</script>`;
}
