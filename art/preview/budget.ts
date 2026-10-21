// &ui=shapes: the bag and the shapes-left warnings over the running scene. The counter counts down from 8
// every 1.4 s and starts again; the banners fire at 5, 3, 1 and 0, where the game's budget_low events and
// a run ending on shapes will call them. Tap the bag to swap. &left=<n> holds the count and shows that
// banner frozen at &at=<ms> (default 700), for screenshots.

import {
  alertEdge, bagButton, bagSwap, drawPiece, pose, setAlertEdge, setShapeCounter, shapeAlert, shapeCounter,
} from '../src/index.ts';

/** A held-shape preview like the game's: the piece centred in a square canvas, `css` px. */
function preview(key: string, css: number): HTMLCanvasElement {
  const k = 2, cv = document.createElement('canvas'), p = pose(key, 0);
  cv.width = cv.height = css * k;
  cv.style.width = cv.style.height = `${css}px`;
  const c = cv.getContext('2d')!, s = (css * k * 0.8) / Math.max(p.w, p.h, 2);
  c.translate((css * k - p.w * s) / 2, (css * k - p.h * s) / 2);
  drawPiece(c, key, 0, s, { face: 'idle', shadow: false, detail: true });
  return cv;
}

export function shapesDemo(still: boolean, held?: number, at = 700): void {
  const wrap = document.createElement('div');
  wrap.className = 'pv-sheet';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:12;pointer-events:none';
  const counter = shapeCounter(), edge = alertEdge();
  counter.style.cssText = 'position:absolute;left:14px;top:84px';
  if (still) { counter.classList.add('ui-still'); edge.classList.add('ui-still'); }
  // The bag where Gameplay moves it, bottom right; and its other states along the bottom.
  const order = ['T', 'O', 'L', 'S', 'I'], bag = bagButton({ size: 64, state: { held: true } });
  let i = 0;
  const put = (b: HTMLElement, key: string) => b.querySelector('.ui-bag-slot')!.replaceChildren(preview(key, 46));
  put(bag, order[0]);
  bag.style.cssText = 'position:absolute;right:14px;bottom:150px;pointer-events:auto';
  bag.onclick = () => { i = (i + 1) % order.length; put(bag, order[i]); bagSwap(bag); };
  const states = document.createElement('div');
  states.style.cssText = 'position:absolute;left:0;right:0;bottom:150px;display:flex;gap:10px;justify-content:center;padding-right:90px';
  const empty = bagButton({ state: { held: false } }), used = bagButton({ state: { held: true, used: true } }), locked = bagButton({ state: { held: false, locked: 'Lv 2' } });
  put(used, 'Z');
  states.append(empty, used, locked);
  wrap.append(edge, counter, states, bag);
  document.body.appendChild(wrap);
  const show = (n: number, fire: boolean) => {
    setShapeCounter(counter, n);
    setAlertEdge(edge, n <= 3);
    if (fire && (n === 5 || n === 3 || n === 1 || n === 0)) {
      const a = wrap.appendChild(shapeAlert(n, { still }));
      if (held !== undefined) for (const x of a.getAnimations({ subtree: true })) { x.pause(); x.currentTime = at; }
    }
  };
  if (held !== undefined) { setShapeCounter(counter, held + 1); show(held, true); return; }
  let n = 8;
  show(n, false);
  setInterval(() => { n = n <= 0 ? 8 : n - 1; show(n, true); }, 1400);
}
