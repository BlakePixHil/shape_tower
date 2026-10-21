// Shapes left (Blake's playtest, 2026-10-21: "sometimes a game ends and I don't know why"). The counter
// chip turns amber with a pip per shape at 5 left and red and pulsing at 3; shapeAlert puts a banner up
// at the sim's budget_low moments (5, 3, 1) and when a run ends on shapes; alertEdge glows red round the
// screen while 3 or fewer are left.

import { uiIconUrl } from './icons.ts';

/** At or below this many shapes left the counter turns amber and shows pips. */
export const SHAPES_LOW = 5;
/** At or below this many the counter turns red and the alert edge comes on. */
export const SHAPES_ALERT = 3;

/** The shapes-left chip. Update it with setShapeCounter. */
export function shapeCounter(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui ui-shapes';
  el.setAttribute('role', 'status');
  el.innerHTML = `<img alt="" src="${uiIconUrl('shapes', 20)}"><b class="ui-num">0</b><span class="ui-shapes-pips">${'<i></i>'.repeat(SHAPES_LOW)}</span>`;
  return el;
}

/**
 * Shows `left` shapes (∞ when `infinite`). At SHAPES_LOW or fewer it's amber with a pip per shape, at
 * SHAPES_ALERT or fewer red and pulsing, at 0 dark red. Each shape spent while low pops a pip and bumps
 * the chip. Cheap to call every frame: it only touches the DOM when `left` changes.
 */
export function setShapeCounter(el: HTMLElement, left: number, infinite = false): void {
  const n = infinite ? Infinity : Math.max(0, left), was = el.dataset.left === undefined ? NaN : Number(el.dataset.left);
  if (n === was) return;
  el.dataset.left = String(n);
  el.querySelector('b')!.textContent = infinite ? '∞' : String(n);
  el.classList.toggle('low', n <= SHAPES_LOW);
  el.classList.toggle('alert', n <= SHAPES_ALERT);
  el.classList.toggle('out', n <= 0);
  el.setAttribute('aria-label', infinite ? 'Unlimited shapes' : `${n} ${n === 1 ? 'shape' : 'shapes'} left`);
  el.querySelectorAll('.ui-shapes-pips i').forEach((p, i) => {
    p.classList.toggle('on', i < n);
    p.classList.toggle('pop', i >= n && i < was);
  });
  if (n < was && n <= SHAPES_LOW) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

/**
 * A banner for the shapes running out; append it to the HUD and it removes itself. More than
 * SHAPES_ALERT left: a soft amber pill ("5 shapes left"). SHAPES_ALERT or fewer: a big red line that
 * shakes in with a red flash round the screen ("3 SHAPES LEFT!", "LAST SHAPE!") and a tip that the
 * next checkpoint brings more. 0: "OUT OF SHAPES!" stamped in, for when a run ends on shapes (append it
 * before the summary). `top` is a CSS length (default 24%).
 */
export function shapeAlert(left: number, o: { top?: string; still?: boolean } = {}): HTMLElement {
  const n = Math.max(0, left), hard = n <= SHAPES_ALERT;
  const el = document.createElement('div');
  el.className = `ui ui-salert ${n === 0 ? 'out' : hard ? 'hard' : 'soft'}${o.still ? ' ui-still' : ''}`;
  if (o.top) el.style.setProperty('--top', o.top);
  el.setAttribute('role', hard ? 'alert' : 'status');
  const icon = `<img alt="" src="${uiIconUrl('shapes', hard ? 40 : 22)}">`;
  if (!hard) {
    el.innerHTML = `<span class="ui-chip amber">${icon}${n} shapes left</span>`;
  } else {
    const title = n === 0 ? 'OUT OF SHAPES!' : n === 1 ? 'LAST SHAPE!' : `${n} SHAPES LEFT!`;
    el.innerHTML = `<span class="ui-sa-flash"></span><div class="ui-sa-title">${icon}<span>${title}</span></div>`
      + (n > 0 ? `<span class="ui-chip">Reach the next checkpoint for more</span>` : '');
  }
  el.addEventListener('animationend', e => { if (e.target === el) el.remove(); });
  setTimeout(() => el.remove(), 4000);
  return el;
}

/** A red glow round the screen's edge; append it to the HUD once and switch it with setAlertEdge. */
export function alertEdge(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui ui-edge';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Turns the edge glow on (it pulses slowly) or off. Pass `left <= SHAPES_ALERT && !infinite`. */
export function setAlertEdge(el: HTMLElement, on: boolean): void { el.classList.toggle('on', on); }
