// The "sticker toy" UI kit's CSS (art-direction.md §8.1): Paper panels, 3 px Ink outlines, a 4 px hard
// Ink shadow, 16 px corners, chunky Fredoka. Buttons press down onto their shadow and bounce back.
// Every class starts with ui- and the colors live in custom properties on .ui, so it sits beside the
// game's own CSS without clashing. Add .ui-still to any element (or turn on the OS's Reduce Motion)
// to stop its animations.

import { FONT_BODY, FONT_DISPLAY, INK, INK_SOFT, PAPER, SIGNAL } from '../config.ts';

export function uiCss(): string {
  return `
.ui { --ink: ${INK}; --ink-soft: ${INK_SOFT}; --paper: ${PAPER}; --paper-2: #F3E7D3; --gold: ${SIGNAL.gold}; --mint: ${SIGNAL.mint};
  --amber: ${SIGNAL.amber}; --danger: ${SIGNAL.danger}; --xp: ${SIGNAL.xp}; --display: ${FONT_DISPLAY}; --body: ${FONT_BODY};
  font-family: var(--body); color: var(--ink); -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
.ui *, .ui *::before, .ui *::after { box-sizing: border-box; }
.ui img { -webkit-user-drag: none; }
.ui-num { font-variant-numeric: tabular-nums; }
.ui-outline { color: #fff; -webkit-text-stroke: 3px var(--ink); paint-order: stroke fill; }

/* Panels and overlays */
.ui-overlay { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px; background: rgba(34,24,58,0.6); animation: ui-fade 180ms ease-out; overflow-y: auto; }
.ui-panel { position: relative; width: min(344px, 100%); background: var(--paper); border: 3px solid var(--ink); border-radius: 16px; box-shadow: 0 4px 0 var(--ink); padding: 18px; text-align: center; animation: ui-pop 320ms cubic-bezier(.3,1.6,.5,1); }
.ui-panel.rise { animation: ui-rise 420ms cubic-bezier(.2,1.3,.4,1); }
.ui-h1 { font: 700 30px/1.1 var(--display); margin: 0 0 12px; letter-spacing: 0.01em; }
.ui-h2 { font: 700 18px/1.2 var(--display); margin: 14px 0 8px; text-align: left; }
.ui-kicker { font: 700 12px/1 var(--display); letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); }
.ui-note { font: 600 13px/1.3 var(--body); color: var(--ink-soft); margin: 6px 0 0; display: flex; gap: 5px; align-items: center; justify-content: center; }
.ui-note img { width: 16px; height: 16px; }
.ui-close { position: absolute; top: 10px; right: 10px; z-index: 1; }
.ui-stack { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.ui-row { display: flex; gap: 10px; justify-content: center; align-items: center; }

/* Buttons: press down onto the shadow, bounce back past 1 on release */
.ui-btn { appearance: none; -webkit-appearance: none; margin: 0; font: 600 18px/1.1 var(--display); color: var(--ink); background: var(--paper);
  border: 3px solid var(--ink); border-radius: 16px; box-shadow: 0 4px 0 var(--ink); padding: 9px 18px; min-height: 48px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; touch-action: manipulation;
  transition: transform 300ms cubic-bezier(.3,2.2,.5,1), box-shadow 300ms cubic-bezier(.3,2.2,.5,1); }
.ui-btn img { width: 24px; height: 24px; flex: none; }
.ui-btn:active { transform: translateY(4px) scale(0.97); box-shadow: 0 0 0 var(--ink); transition-duration: 50ms; }
.ui-btn:focus-visible { outline: 3px solid var(--xp); outline-offset: 3px; }
.ui-btn.primary { background: var(--gold); }
.ui-btn.mint { background: var(--mint); }
.ui-btn.big { font-size: 26px; min-height: 64px; padding: 12px 30px; border-radius: 20px; }
.ui-btn.big img { width: 30px; height: 30px; }
.ui-btn.wide { width: 100%; }
.ui-btn.icon { flex: none; width: 48px; height: 48px; min-height: 0; padding: 0; border-radius: 14px; }
.ui-btn.icon.sm { width: 44px; height: 44px; border-radius: 12px; }
.ui-btn.icon.sm img { width: 20px; height: 20px; }
.ui-btn:disabled, .ui-btn.disabled { background: var(--paper-2); color: var(--ink-soft); border-color: var(--ink-soft); box-shadow: 0 4px 0 var(--ink-soft); cursor: default; pointer-events: none; }
.ui-btn:disabled img, .ui-btn.disabled img { opacity: 0.6; }

/* Chips, pills and plates */
.ui-chip { display: inline-flex; align-items: center; gap: 5px; font: 700 15px/1 var(--display); background: var(--paper); border: 3px solid var(--ink); border-radius: 12px;
  box-shadow: 0 3px 0 var(--ink); padding: 4px 9px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-chip img { width: 18px; height: 18px; }
.ui-chip.gold { background: var(--gold); } .ui-chip.amber { background: var(--amber); } .ui-chip.mint { background: var(--mint); }
.ui-chip.violet { background: var(--xp); color: #fff; }
.ui-plate { display: inline-block; position: relative; font: 700 13px/1 var(--display); letter-spacing: 0.04em; color: #fff; background: var(--xp);
  border: 3px solid var(--ink); border-radius: 8px; box-shadow: 0 3px 0 var(--ink); padding: 5px 14px; white-space: nowrap; }
.ui-plate::before, .ui-plate::after { content: ''; position: absolute; top: 5px; width: 12px; height: 16px; background: #5236D6; border: 3px solid var(--ink); z-index: -1; }
.ui-plate::before { left: -10px; border-right: 0; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 45% 50%); }
.ui-plate::after { right: -10px; border-left: 0; clip-path: polygon(0 0, 100% 0, 55% 50%, 100% 100%, 0 100%); }

/* Badges and avatars */
.ui-badge { display: block; width: var(--s, 44px); height: var(--s, 44px); flex: none; }
.ui-badge.cosmic { animation: ui-nebula 7s ease-in-out infinite; }
.ui-avatar { display: block; width: var(--s, 56px); height: var(--s, 56px); flex: none; }

/* XP bar: violet with slowly moving stripes, the badge at the start and the next unlock at the end */
.ui-xp { display: flex; align-items: center; gap: 6px; width: 100%; }
.ui-xp-track { position: relative; flex: 1; height: 20px; background: #fff; border: 3px solid var(--ink); border-radius: 999px; box-shadow: 0 3px 0 var(--ink); overflow: hidden; }
.ui-xp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: var(--fill, 0%); border-radius: 999px; transition: width 260ms ease-out;
  background: repeating-linear-gradient(-45deg, rgba(255,255,255,0.22) 0 7px, rgba(255,255,255,0) 7px 14px) 0 0 / 19.8px 19.8px, var(--xp);
  animation: ui-stripes 1.8s linear infinite; }
.ui-xp-text { position: absolute; inset: 0; display: grid; place-items: center; font: 700 11px/1 var(--display); color: #fff; -webkit-text-stroke: 2.5px var(--ink); paint-order: stroke fill; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
.ui-xp-next { width: 30px; height: 30px; display: grid; place-items: center; background: var(--paper); border: 3px solid var(--ink); border-radius: 50%; box-shadow: 0 2px 0 var(--ink); flex: none; }
.ui-xp-next img { width: 18px; height: 18px; }
.ui-xp-next.lvl { background: none; border: 0; box-shadow: none; }
.ui-xp-next.lvl img { width: 30px; height: 30px; }

/* Stat tiles */
.ui-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ui-stat { display: flex; align-items: center; gap: 7px; background: #fff; border: 3px solid var(--ink); border-radius: 12px; padding: 5px 8px; text-align: left; min-width: 0; }
.ui-stat img { width: 26px; height: 26px; flex: none; }
.ui-stat > div { min-width: 0; }
.ui-stat b { display: block; font: 700 19px/1.05 var(--display); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-stat b.sm { font-size: 14px; line-height: 1.35; }
.ui-stat span { display: block; font: 800 10px/1.1 var(--body); color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }

/* XP lines tick in one at a time: add .in to each */
.ui-lines { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.ui-line { display: flex; justify-content: space-between; font: 700 14px/1.3 var(--body); color: var(--ink-soft); opacity: 0; transform: translateX(-14px); }
.ui-line b { font: 700 15px/1.3 var(--display); color: var(--ink); font-variant-numeric: tabular-nums; }
.ui-line.in { opacity: 1; transform: none; transition: opacity 200ms, transform 320ms cubic-bezier(.3,1.8,.5,1); }
.ui-line.total { border-top: 2px dashed rgba(34,24,58,0.25); padding-top: 3px; margin-top: 2px; }
.ui-line.total b { color: var(--xp); }

/* Run summary */
.ui-summary { padding: 16px 16px 18px; }
.ui-sum-head { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-bottom: 10px; }
.ui-height { font: 700 56px/0.95 var(--display); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.ui-height small { font-size: 24px; margin-left: 2px; }
.ui-best { margin-top: 4px; animation: ui-wiggle 1.6s ease-in-out 600ms infinite; }
.ui-sum-mid { display: flex; gap: 12px; align-items: stretch; margin-bottom: 12px; }
.ui-sum-mid .ui-postcard { transform: rotate(-3deg); margin: 2px 0 0 2px; }
.ui-sum-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ui-score { display: flex; align-items: center; justify-content: space-between; background: var(--gold); border: 3px solid var(--ink); border-radius: 12px; padding: 4px 10px; box-shadow: 0 3px 0 var(--ink); }
.ui-score span { font: 800 11px/1 var(--body); text-transform: uppercase; letter-spacing: 0.06em; }
.ui-score b { font: 700 24px/1.1 var(--display); font-variant-numeric: tabular-nums; }
.ui-sum-right .ui-stats { gap: 6px; }
/* Narrow tiles: icon and number on one line, the label under both */
.ui-sum-right .ui-stat { flex-wrap: wrap; padding: 3px 6px 4px; gap: 0 5px; }
.ui-sum-right .ui-stat > div { display: contents; }
.ui-sum-right .ui-stat img { width: 20px; height: 20px; }
.ui-sum-right .ui-stat b { font-size: 18px; flex: 1; }
.ui-sum-right .ui-stat span { flex-basis: 100%; font-size: 9px; letter-spacing: 0.02em; }
.ui-sum-xp { background: rgba(122,92,255,0.08); border: 2px solid rgba(122,92,255,0.25); border-radius: 14px; padding: 10px 10px 8px; margin-bottom: 14px; }
.ui-sum-extra { margin-bottom: 12px; }
.ui-sum-extra:empty { display: none; }
.ui-sum-actions { display: flex; flex-direction: column; gap: 10px; }

/* Level-up takeover: rays, the badge flips to the new number, confetti, the unlock card */
.ui-levelup { position: fixed; inset: 0; z-index: 30; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px 16px; overflow: hidden;
  background: radial-gradient(circle at 50% 38%, rgba(122,92,255,0.92), rgba(54,30,130,0.95) 45%, rgba(34,24,58,0.97)); animation: ui-fade 200ms ease-out; text-align: center; }
.ui-rays { position: absolute; left: 50%; top: 38%; width: 170vmax; height: 170vmax; margin: -85vmax 0 0 -85vmax; pointer-events: none;
  background: repeating-conic-gradient(rgba(255,194,61,0.28) 0deg 9deg, rgba(255,194,61,0) 9deg 22.5deg);
  -webkit-mask: radial-gradient(circle, #000 8%, rgba(0,0,0,0.6) 25%, transparent 50%); mask: radial-gradient(circle, #000 8%, rgba(0,0,0,0.6) 25%, transparent 50%);
  animation: ui-spin 18s linear infinite, ui-fade 600ms ease-out; }
.ui-lu-title { position: relative; font: 700 46px/1 var(--display); letter-spacing: 0.02em; color: #fff; -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill; animation: ui-pop 480ms cubic-bezier(.3,1.8,.5,1) 100ms both; }
.ui-flip { position: relative; width: var(--s, 132px); height: var(--s, 132px); perspective: 600px; animation: ui-pop 480ms cubic-bezier(.3,1.8,.5,1) both; }
.ui-flip-in { position: absolute; inset: 0; transform-style: preserve-3d; animation: ui-flip 700ms cubic-bezier(.4,1.6,.5,1) 550ms both; }
.ui-flip-in img { position: absolute; inset: 0; width: 100%; height: 100%; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.ui-flip-in img + img { transform: rotateY(180deg); }
.ui-flip::after { content: ''; position: absolute; inset: -30%; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.75), rgba(255,255,255,0) 60%); opacity: 0; animation: ui-shine 700ms ease-out 900ms; pointer-events: none; }
.ui-lu-name { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; animation: ui-rise 420ms cubic-bezier(.2,1.3,.4,1) 1100ms both; }
.ui-lu-name .ui-kicker { color: #E6DEFF; }
.ui-unlock { position: relative; display: flex; align-items: center; gap: 12px; text-align: left; width: min(320px, 100%); background: var(--paper); border: 3px solid var(--ink);
  border-radius: 16px; box-shadow: 0 4px 0 var(--ink); padding: 12px 14px; animation: ui-rise 460ms cubic-bezier(.2,1.3,.4,1) 1400ms both; }
.ui-unlock > img { width: 52px; height: 52px; flex: none; }
.ui-unlock b { display: block; font: 700 19px/1.15 var(--display); }
.ui-unlock span { display: block; font: 600 13px/1.3 var(--body); color: var(--ink-soft); }
.ui-unlock .ui-kicker { color: var(--xp); margin-bottom: 2px; }
.ui-levelup .ui-btn { position: relative; animation: ui-rise 420ms cubic-bezier(.2,1.3,.4,1) 1700ms both; min-width: 160px; }
.ui-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ui-confetti i { position: absolute; top: -24px; left: var(--x); width: var(--w); height: calc(var(--w) * 0.55); background: var(--c); border: 2px solid var(--ink); border-radius: 3px;
  animation: ui-fall var(--d) cubic-bezier(.3,.1,.6,1) var(--t) both; }

/* Main menu: the scene shows through; profile top-left, settings top-right, logo up top, Play and modes at the bottom */
.ui-menu { position: fixed; inset: 0; z-index: 10; pointer-events: none; display: flex; flex-direction: column; align-items: center;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 14px calc(env(safe-area-inset-bottom, 0px) + 18px); }
.ui-menu > * { pointer-events: auto; }
.ui-menu-top { width: 100%; display: flex; justify-content: space-between; align-items: flex-start; }
.ui-profile-chip { appearance: none; margin: 0; display: flex; align-items: center; gap: 8px; background: var(--paper); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 0 4px 0 var(--ink);
  padding: 4px 12px 4px 4px; cursor: pointer; font: inherit; color: inherit; text-align: left; transition: transform 300ms cubic-bezier(.3,2.2,.5,1), box-shadow 300ms cubic-bezier(.3,2.2,.5,1); }
.ui-profile-chip:active { transform: translateY(4px) scale(0.97); box-shadow: 0 0 0 var(--ink); transition-duration: 50ms; }
.ui-ring { position: relative; width: 52px; height: 52px; flex: none; }
.ui-ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.ui-ring .ui-avatar { position: absolute; inset: 7px; width: 38px; height: 38px; }
.ui-ring .ui-badge { position: absolute; right: -9px; bottom: -8px; --s: 26px; }
.ui-profile-chip b { display: block; font: 700 16px/1.1 var(--display); max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-profile-chip span { display: block; font: 700 11px/1.2 var(--body); color: var(--ink-soft); white-space: nowrap; }
.ui-menu .ui-logo { margin-top: 4vh; }
.ui-menu-bottom { margin-top: auto; width: min(360px, 100%); display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.ui-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ui-mode { appearance: none; margin: 0; position: relative; display: flex; align-items: center; gap: 8px; background: var(--paper); border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 4px 0 var(--ink);
  padding: 7px 10px; font: inherit; color: inherit; text-align: left; cursor: pointer; transition: transform 300ms cubic-bezier(.3,2.2,.5,1), box-shadow 300ms cubic-bezier(.3,2.2,.5,1); }
.ui-mode:active { transform: translateY(4px) scale(0.97); box-shadow: 0 0 0 var(--ink); transition-duration: 50ms; }
.ui-mode > img { width: 34px; height: 34px; flex: none; }
.ui-mode b { display: block; font: 700 16px/1.1 var(--display); }
.ui-mode span { display: block; font: 700 11px/1.2 var(--body); color: var(--ink-soft); }
.ui-mode.locked { background: var(--paper-2); border-color: var(--ink-soft); box-shadow: 0 4px 0 var(--ink-soft); cursor: default; }
.ui-mode.locked > img { filter: grayscale(1); opacity: 0.5; }
.ui-mode.locked b { color: var(--ink-soft); }
.ui-lock { position: absolute; top: -10px; right: -8px; display: flex; align-items: center; gap: 2px; font: 700 12px/1 var(--display); background: var(--gold); border: 3px solid var(--ink); border-radius: 10px; padding: 2px 6px 2px 3px; box-shadow: 0 2px 0 var(--ink); }
.ui-lock img { width: 16px; height: 16px; }

/* Logo: letter tiles drop in one by one and squash, then the Blockling peeks out from behind the O */
.ui-logo { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.ui-logo-row { display: flex; gap: 3px; }
.ui-logo-row + .ui-logo-row { margin-left: calc(var(--tile) * 0.36); }
.ui-logo-tile { display: block; width: var(--tile); height: var(--tile); transform: rotate(var(--r)); transform-origin: 50% 100%;
  animation: ui-drop 640ms cubic-bezier(.35,0,.45,1) calc(150ms + var(--i) * 85ms) both; }
.ui-logo-o { position: relative; display: block; }
.ui-logo-o .ui-logo-tile { position: relative; }
.ui-logo-peek { position: absolute; width: calc(var(--tile) * 0.62); height: calc(var(--tile) * 0.62); right: calc(var(--tile) * -0.16); top: calc(var(--tile) * -0.28);
  transform: rotate(14deg); animation: ui-peek 900ms cubic-bezier(.3,1.7,.5,1) 1250ms both; }

/* Postcards */
.ui-postcard { position: relative; flex: none; width: var(--w); background: #fff; border: 3px solid var(--ink); border-radius: 8px; box-shadow: 0 3px 0 var(--ink); padding: 3px 3px 0; }
.ui-pc-art { display: block; width: 100%; border-radius: 4px; object-fit: cover; }
.ui-pc-q { display: grid; place-items: center; filter: saturate(0.25) brightness(0.7); }
.ui-pc-q span { font: 700 20px/1 var(--display); color: #fff; -webkit-text-stroke: 3px var(--ink); paint-order: stroke fill; }
.ui-pc-name { display: block; font: 700 11px/1 var(--display); padding: 5px 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.ui-pc-stamp { position: absolute; top: 7px; right: 7px; width: 20px; height: 24px; display: grid; place-items: center; font: 700 11px/1 var(--display); color: #fff; -webkit-text-stroke: 2px var(--ink); paint-order: stroke fill;
  background: var(--c); border: 2px dashed #fff; outline: 2px solid var(--ink); border-radius: 2px; }
.ui-pc-mark { position: absolute; left: 4px; top: 30%; padding: 3px 5px; font: 800 8px/1 var(--body); letter-spacing: 0.06em; color: rgba(34,24,58,0.75); border: 2px solid rgba(34,24,58,0.6); border-radius: 999px; transform: rotate(-14deg); background: rgba(255,255,255,0.55); white-space: nowrap; }
.ui-postcard.locked { border-color: var(--ink-soft); box-shadow: 0 3px 0 var(--ink-soft); }
.ui-postcard.locked .ui-pc-stamp { opacity: 0.5; }
.ui-postcard.locked .ui-pc-name { color: var(--ink-soft); }

/* Profile */
.ui-profile { width: min(360px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 16px; scrollbar-width: none; }
.ui-prof-head { display: flex; gap: 12px; align-items: center; text-align: left; margin-bottom: 12px; }
.ui-prof-head .ui-avatar { --s: 72px; }
.ui-prof-head b { display: block; font: 700 24px/1.1 var(--display); }
.ui-prof-head .ui-row { justify-content: flex-start; gap: 8px; margin-top: 6px; }
.ui-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.ui-cards .ui-postcard { width: 100%; padding: 2px 2px 0; border-width: 2px; border-radius: 6px; box-shadow: 0 2px 0 var(--ink); }
.ui-cards .ui-pc-name { font-size: 8px; padding: 3px 1px 4px; }
.ui-cards .ui-pc-stamp, .ui-cards .ui-pc-mark { display: none; }
.ui-cards .ui-pc-q span { font-size: 13px; -webkit-text-stroke-width: 2px; }

/* Settings */
.ui-settings { width: min(360px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 16px 16px 18px; text-align: left; scrollbar-width: none; }
.ui-group { background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 4px 12px; }
.ui-set { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; border-bottom: 2px dashed rgba(34,24,58,0.15); }
.ui-set:last-child { border-bottom: 0; }
.ui-set > span { font: 700 15px/1.2 var(--body); display: flex; gap: 8px; align-items: center; }
.ui-set > span img { width: 22px; height: 22px; }
.ui-set.col { flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 0; }
.ui-toggle { appearance: none; -webkit-appearance: none; margin: 0; flex: none; position: relative; width: 54px; height: 32px; border: 3px solid var(--ink); border-radius: 999px; background: var(--paper-2);
  box-shadow: 0 3px 0 var(--ink); cursor: pointer; transition: background 160ms; }
.ui-toggle::before { content: ''; position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid var(--ink); transition: transform 260ms cubic-bezier(.3,1.8,.5,1); }
.ui-toggle:checked { background: var(--mint); }
.ui-toggle:checked::before { transform: translateX(22px); }
.ui-toggle:focus-visible, .ui-slider:focus-visible { outline: 3px solid var(--xp); outline-offset: 3px; }
/* The input is a 44 px tall touch target; the 16 px track is drawn in its middle */
.ui-slider { appearance: none; -webkit-appearance: none; margin: 0; flex: 1; min-width: 120px; height: 44px; background: transparent; cursor: pointer; }
.ui-slider::-webkit-slider-runnable-track { height: 16px; box-sizing: border-box; border: 3px solid var(--ink); border-radius: 999px; background: linear-gradient(to right, var(--xp) 0 var(--v, 50%), #fff var(--v, 50%) 100%); }
.ui-slider::-moz-range-track { height: 10px; border: 3px solid var(--ink); border-radius: 999px; background: linear-gradient(to right, var(--xp) 0 var(--v, 50%), #fff var(--v, 50%) 100%); }
.ui-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 28px; height: 28px; margin-top: -9px; border-radius: 50%; background: var(--gold); border: 3px solid var(--ink); box-shadow: 0 3px 0 var(--ink); }
.ui-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: var(--gold); border: 3px solid var(--ink); box-shadow: 0 3px 0 var(--ink); }
.ui-seg { display: flex; border: 3px solid var(--ink); border-radius: 12px; overflow: hidden; box-shadow: 0 3px 0 var(--ink); }
.ui-seg label { flex: 1; position: relative; cursor: pointer; }
.ui-seg input { position: absolute; opacity: 0; pointer-events: none; }
.ui-seg label span { display: block; text-align: center; font: 600 14px/1 var(--display); padding: 9px 6px; background: #fff; }
.ui-seg label + label span { border-left: 3px solid var(--ink); }
.ui-seg input:checked + span { background: var(--gold); }
.ui-seg input:focus-visible + span { outline: 3px solid var(--xp); outline-offset: -5px; }

/* Hazard telegraph chip: amber, at the edge the hazard comes from, countdown ring and push chevrons */
.ui-hazard { position: fixed; top: var(--y, 30%); z-index: 15; pointer-events: none; display: flex; align-items: center; gap: 2px; background: var(--amber);
  border: 3px solid var(--ink); border-radius: 16px; box-shadow: 0 4px 0 var(--ink); padding: 4px 6px 4px 4px; animation: ui-hz-in 420ms cubic-bezier(.3,1.6,.5,1) both; }
.ui-hazard.from-left { left: calc(env(safe-area-inset-left, 0px) + 8px); --d: 1; }
.ui-hazard.from-right { right: calc(env(safe-area-inset-right, 0px) + 8px); --d: -1; flex-direction: row-reverse; padding: 4px 4px 4px 6px; }
.ui-hz-dial { position: relative; width: 44px; height: 44px; flex: none; }
.ui-hz-dial svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.ui-hz-dial circle { fill: none; }
.ui-hz-dial .trk { fill: #fff; stroke: rgba(34,24,58,0.18); stroke-width: 5; }
.ui-hz-dial .cd { stroke: var(--ink); stroke-width: 5; stroke-linecap: round; stroke-dashoffset: 0; animation: ui-hz-count var(--eta, 2s) linear var(--el, 0s) both; }
.ui-hazard.paused, .ui-hazard.paused * { animation-play-state: paused !important; }
.ui-hz-dial img { position: absolute; left: 9px; top: 9px; width: 26px; height: 26px; }
.ui-hazard.from-right .ui-hz-dial img { transform: scaleX(-1); }
.ui-hz-arrow { display: flex; transform: scaleX(var(--d)); }
.ui-hz-arrow svg { width: 11px; height: 20px; margin-right: -2px; animation: ui-hz-chev 800ms ease-in-out infinite; }
.ui-hz-arrow svg + svg { animation-delay: 200ms; }
.ui-hz-arrow path { fill: none; stroke: var(--ink); stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
.ui-hazard.go { animation: ui-hz-push 625ms ease-in-out infinite; background: #FF8F1F; }
.ui-hazard.go .cd { animation: none; stroke-dashoffset: 0; }
.ui-hazard.go .ui-hz-arrow svg { animation-duration: 500ms; }
.ui-hazard.out { animation: ui-hz-out 360ms cubic-bezier(.5,0,.8,.4) both; }

/* Altitude rail (right edge, under the Next column) and off-screen chips */
.ui-rail { position: fixed; right: calc(env(safe-area-inset-right, 0px) + 2px); top: var(--top, 200px); z-index: 5; pointer-events: none; }
.ui-rail canvas { display: block; }
.ui-offchip { position: fixed; left: var(--x, 50%); z-index: 6; pointer-events: none; display: flex; align-items: center; gap: 3px; font: 700 16px/1 var(--display);
  background: var(--gold); border: 3px solid var(--ink); border-radius: 12px; box-shadow: 0 3px 0 var(--ink); padding: 3px 9px; font-variant-numeric: tabular-nums;
  opacity: 0; transform: translateX(-50%) scale(0.5); transition: opacity 160ms, transform 360ms cubic-bezier(.3,1.8,.5,1); }
.ui-offchip.up { top: calc(env(safe-area-inset-top, 0px) + var(--top, 120px)); }
.ui-offchip.down { bottom: calc(env(safe-area-inset-bottom, 0px) + var(--bottom, 96px)); }
.ui-offchip.danger { background: var(--danger); color: #fff; }
.ui-offchip.danger b, .ui-offchip.danger .ui-oc-arrow { -webkit-text-stroke: 2.5px var(--ink); paint-order: stroke fill; }
.ui-oc-arrow { font-size: 12px; }
.ui-offchip.show { opacity: 1; transform: translateX(-50%); }
.ui-offchip.up.show .ui-oc-arrow { animation: ui-oc-bob 1s ease-in-out infinite; }
.ui-offchip.down.show .ui-oc-arrow { animation: ui-oc-drop 1s ease-in-out infinite; }

/* A hazard's first-appearance card, styled like the biome title */
.ui-hcard { position: fixed; left: 0; right: 0; top: var(--top, 18%); z-index: 16; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 6px;
  animation: ui-hc 3.2s cubic-bezier(.3,1.5,.5,1) both; }
.ui-hc-title { display: flex; align-items: center; gap: 6px; font: 700 32px/1 var(--display); color: #fff; -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill; letter-spacing: 0.03em; white-space: nowrap; }
.ui-hc-title img { width: 40px; height: 40px; }
.ui-hcard .ui-chip { font-size: 16px; padding: 5px 12px; }

@keyframes ui-fade { from { opacity: 0; } }
@keyframes ui-pop { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); } }
@keyframes ui-rise { 0% { transform: translateY(40px); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes ui-stripes { to { background-position: 19.8px 0, 0 0; } }
@keyframes ui-spin { to { transform: rotate(360deg); } }
@keyframes ui-flip { 0% { transform: rotateY(0); } 100% { transform: rotateY(180deg); } }
@keyframes ui-shine { 0% { opacity: 0.9; transform: scale(0.4); } 100% { opacity: 0; transform: scale(1.2); } }
@keyframes ui-fall { 0% { transform: translateY(0) rotate(0); opacity: 1; } 85% { opacity: 1; } 100% { transform: translateY(110vh) translateX(var(--dx)) rotate(var(--rot)); opacity: 0; } }
@keyframes ui-drop { 0% { transform: translateY(-110vh) rotate(var(--r)); } 62% { transform: translateY(0) rotate(var(--r)) scale(1.16, 0.8); }
  80% { transform: translateY(-8%) rotate(var(--r)) scale(0.95, 1.07); } 100% { transform: translateY(0) rotate(var(--r)) scale(1); } }
@keyframes ui-peek { 0% { transform: translate(-30%, 60%) rotate(-10deg); opacity: 0; } 30% { opacity: 1; } 100% { transform: rotate(14deg); opacity: 1; } }
@keyframes ui-wiggle { 0%, 100% { transform: rotate(0); } 10% { transform: rotate(-6deg) scale(1.06); } 20% { transform: rotate(5deg) scale(1.06); } 30% { transform: rotate(0); } }
@keyframes ui-nebula { 50% { filter: hue-rotate(-28deg) saturate(1.2); } }
@keyframes ui-hz-in { 0% { transform: translateX(calc(var(--d) * -140%)); } 100% { transform: none; } }
@keyframes ui-hz-out { 0% { transform: none; opacity: 1; } 100% { transform: translateX(calc(var(--d) * -140%)); opacity: 0; } }
@keyframes ui-hz-count { from { stroke-dashoffset: ${(2 * Math.PI * 19).toFixed(1)}; } to { stroke-dashoffset: 0; } }
@keyframes ui-hz-chev { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes ui-hz-push { 0%, 100% { transform: none; } 50% { transform: translateX(calc(var(--d) * 4px)) rotate(calc(var(--d) * 3deg)); } }
@keyframes ui-hc { 0% { opacity: 0; transform: translateY(-24px) scale(0.7); } 12% { opacity: 1; transform: none; } 85% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-16px); } }
@keyframes ui-oc-bob { 0%, 100% { transform: none; } 50% { transform: translateY(-3px); } }
@keyframes ui-oc-drop { 0%, 100% { transform: none; } 50% { transform: translateY(3px); } }
@keyframes ui-hc-fade { 0%, 100% { opacity: 0; } 8%, 88% { opacity: 1; } }

/* Still: no motion. Information keeps its timing: the hazard countdown still fills, and the hazard card fades in and out. */
.ui-still:not(.ui-hcard), .ui-still *:not(.cd) { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
.ui-still .ui-confetti, .ui-still .ui-rays { display: none; }
.ui-hcard.ui-still { animation-name: ui-hc-fade; }
@media (prefers-reduced-motion: reduce) {
  .ui:not(.ui-hcard), .ui *:not(.cd) { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .ui .ui-confetti, .ui .ui-rays { display: none; }
  .ui-hcard { animation-name: ui-hc-fade; }
}
`;
}

/** Add the UI kit's CSS to the page once. */
export function injectUiCss(doc: Document = document): void {
  if (doc.getElementById('st-ui-kit')) return;
  const style = doc.createElement('style');
  style.id = 'st-ui-kit';
  style.textContent = uiCss();
  doc.head.appendChild(style);
}
