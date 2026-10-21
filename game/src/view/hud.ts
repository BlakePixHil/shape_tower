// The in-game HUD and screens as DOM over the canvas (art-direction.md §8: "sticker toy" UI).
// Screen space only: camera shake never moves it.

import {
  SHAPES_ALERT, alertEdge, altitudeRail, bagButton, bagSwap, bakePiece, biomeCard, checkpointChip, hazardCard, hazardChip, hazardChipEnd, hazardChipGo, injectUiCss,
  offscreenChip, plumbBob, powerBarCss, powerIconUrl, setAlertEdge, setBag, setOffscreenChip, setPlumb, setRail, setShapeCounter, setWindsock, shapeAlert, shapeCounter,
  uiIconUrl, windsock, type HazardType,
} from '@art/index.ts';
import type { PowerKind, SecondWindState } from '../sim/sim.ts';
import { geometry } from '../sim/shapes.ts';
import { crackCanvas } from './cracks.ts';
import { INK } from './palette.ts';

/** The short label under each power's slot. */
export const POWER_TAGS: Record<PowerKind, string> = { clean: 'SWEEP', quickset: 'SET', undo: 'UNDO', glue: 'GLUE', slowmo: 'SLOW' };
export const POWER_NAMES: Record<PowerKind, string> = { clean: 'Clean Slate', quickset: 'Quick-Set', undo: 'Undo', glue: 'Glue', slowmo: 'Slow-Mo' };

const CSS = `
.st-hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Fredoka', 'Nunito', system-ui, sans-serif; color: ${INK}; user-select: none; -webkit-user-select: none; z-index: 5; }
.st-hud * { box-sizing: border-box; }
.st-top { position: absolute; left: 0; right: 0; top: 0; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 0; display: flex; justify-content: space-between; align-items: flex-start; }
.st-col { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.st-row { display: flex; gap: 8px; align-items: center; }
.st-btn { pointer-events: auto; background: #FFF7E8; border: 3px solid ${INK}; border-radius: 14px; box-shadow: 0 4px 0 ${INK}; font: 600 16px 'Fredoka', system-ui, sans-serif; color: ${INK}; padding: 6px 12px; cursor: pointer; transition: transform 80ms; touch-action: manipulation; }
.st-btn:active { transform: translateY(4px); box-shadow: 0 0 0 ${INK}; }
.st-iconbtn { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; font-size: 18px; }
.st-hearts { display: flex; gap: 3px; }
.st-heart { width: 22px; height: 22px; transition: transform 200ms; }
.st-heart.lost { animation: st-crack 500ms forwards; }
.st-heart.pop { animation: st-pop 300ms; }
@keyframes st-crack { 0% { transform: scale(1.3); } 40% { transform: scale(1) rotate(-10deg); } 100% { transform: translateY(30px) rotate(-40deg) scale(0.6); opacity: 0; } }
@keyframes st-pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
.st-card { background: #FFF7E8; border: 3px solid ${INK}; border-radius: 14px; box-shadow: 0 4px 0 ${INK}; display: grid; place-items: center; position: relative; }
.st-card canvas { display: block; }
.st-card .st-cap { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); font: 700 10px 'Fredoka', sans-serif; background: ${INK}; color: #FFF7E8; border-radius: 6px; padding: 0 5px; letter-spacing: 0.06em; }
.st-chip { background: #FFF7E8; border: 3px solid ${INK}; border-radius: 12px; box-shadow: 0 3px 0 ${INK}; font: 700 15px 'Fredoka', sans-serif; padding: 2px 9px; display: flex; gap: 5px; align-items: center; font-variant-numeric: tabular-nums; }
.st-chip.pulse { animation: st-pulse 400ms; }
.st-set { gap: 3px; padding: 3px 8px; }
.st-set[hidden] { display: none; }
.st-set i { width: 9px; height: 9px; border-radius: 50%; border: 2px solid ${INK}; background: transparent; }
.st-set i.on { background: #9AA7B8; }
.st-set.ready { background: #FFE08A; }
.st-set.ready i.on { background: #6B7A90; }
@keyframes st-pulse { 50% { transform: scale(1.25); } }
.st-center { position: absolute; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 8px); display: flex; flex-direction: column; align-items: center; gap: 4px; }
.st-height { font: 700 38px 'Fredoka', sans-serif; color: #fff; -webkit-text-stroke: 3px ${INK}; paint-order: stroke fill; line-height: 1; font-variant-numeric: tabular-nums; transition: transform 120ms; }
.st-height.bump { transform: scale(1.15); }
.st-height small { font-size: 18px; }
.st-pill { background: #FFC23D; border: 3px solid ${INK}; border-radius: 999px; box-shadow: 0 3px 0 ${INK}; font: 700 13px 'Fredoka', sans-serif; padding: 1px 10px; white-space: nowrap; position: relative; overflow: hidden; }
.st-pill .st-fill { position: absolute; inset: 0; background: #3EE6A8; transform-origin: left; transform: scaleX(0); }
.st-pill span { position: relative; }
.st-hud .ui-rail { top: calc(env(safe-area-inset-top, 0px) + 148px); right: 23px; } /* centred under the Next column */
.st-hud .ui-offchip.up { --top: 84px; } /* under the checkpoint pill */
.st-vignette { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 90px 30px rgba(255,77,109,0.85); opacity: 0; z-index: 4; }
.st-flash { position: fixed; inset: 0; pointer-events: none; background: #fff; opacity: 0; z-index: 4; transition: opacity 60ms; }
.st-overlay { position: fixed; inset: 0; display: none; place-items: center; background: rgba(34,24,58,0.55); pointer-events: auto; z-index: 8; padding: 16px; }
.st-overlay.show { display: grid; }
.st-panel { background: #FFF7E8; border: 3px solid ${INK}; border-radius: 18px; box-shadow: 0 6px 0 ${INK}; padding: 18px 18px 16px; width: min(340px, 100%); text-align: center; font-family: 'Nunito', system-ui, sans-serif; animation: st-pop 300ms; }
.st-panel h1 { font: 700 30px 'Fredoka', sans-serif; margin: 0 0 4px; }
.st-panel h2 { font: 700 22px 'Fredoka', sans-serif; margin: 0 0 8px; }
.st-panel p { margin: 6px 0; font-size: 15px; }
.st-panel .st-btn { margin: 6px 4px 0; font-size: 18px; padding: 8px 18px; }
.st-panel .st-big { background: #FFC23D; font-size: 22px; padding: 10px 26px; }
.st-stats { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; text-align: left; margin: 8px 0; font-size: 15px; }
.st-stats b { font-family: 'Fredoka', sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
.st-ask { margin-top: 10px; padding-top: 10px; border-top: 2px dashed rgba(34,24,58,0.25); }
.st-hint { position: absolute; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom, 0px) + 96px); display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; padding: 0 16px; opacity: 0.9; transition: opacity 600ms; }
.st-hint span { background: rgba(255,247,232,0.9); border: 2px solid ${INK}; border-radius: 10px; font: 600 12px 'Fredoka', sans-serif; padding: 2px 8px; }
.st-lab { position: absolute; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 168px); } /* over the bag and the hints */
.st-hud .st-bag { position: absolute; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); pointer-events: auto; } /* by the thumb (Blake's playtest) */
.st-powers { position: absolute; left: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); display: flex; gap: 8px; align-items: flex-end; }
.st-slot { width: 54px; height: 54px; padding: 0; display: grid; place-items: center; font-size: 26px; line-height: 1; position: relative; }
.st-slot.empty { background: rgba(255,247,232,0.35); border-style: dashed; box-shadow: none; pointer-events: none; }
.st-slot.pop { animation: st-pop 320ms; }
.st-slot.nope { animation: st-nope 300ms; }
@keyframes st-nope { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
.st-tag { position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%); font: 700 10px 'Fredoka', sans-serif; background: ${INK}; color: #FFF7E8; border-radius: 6px; padding: 0 5px; letter-spacing: 0.06em; white-space: nowrap; }
.st-wind { width: 62px; height: 62px; font-size: 30px; background: linear-gradient(#BFF3FF, #7FD8FF); }
.st-wind.earn { opacity: 0.55; filter: grayscale(0.8); pointer-events: none; }
.st-wind.armed { background: linear-gradient(#FFF1A8, #FFC23D); animation: st-pulse 500ms infinite; }
.st-wind.glow { animation: st-glow 900ms infinite; }
@keyframes st-glow { 50% { box-shadow: 0 4px 0 ${INK}, 0 0 0 7px rgba(127,216,255,0.75); transform: scale(1.06); } }
.st-wind.hide, .st-slot.hide { display: none; }
.st-active { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.st-active .st-chip { font-size: 13px; padding: 1px 7px; }
.st-gauges { display: flex; gap: 8px; margin-top: 6px; }
.st-gauges:empty { display: none; }
`;

/** A hazard chip that should be showing: `dir` is the way it pushes, `left` the seconds until it starts (0 once it has). */
export interface HazardWant { type: HazardType; dir: -1 | 1; left: number; id?: number }

/** Where each chip sits down the screen edge, so two at once (a gust in a crosswind) don't stack. */
const CHIP_Y: Record<HazardType, string> = { gust: '52%', crosswind: '40%', junk: '46%', meteor: '34%', dust: '58%', sway: '40%' };
const WARNING = 2; // s, the sim's HAZARD_WARNING and GUST_WARNING

const HEART = (fill: string) => `<svg viewBox="0 0 24 24" class="st-heart"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.5h2c.7-1.3 2.2-2.5 4.3-2.5 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="${fill}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

export interface RunStats { height: number; checkpoints: number; score: number; xp: number; perfects: number; rows: number; placed: number; cause: string; biome: string }

export class Hud {
  readonly root: HTMLDivElement;
  private hearts: HTMLDivElement;
  private shapes: HTMLElement;
  private edge: HTMLElement;
  private setEl: HTMLDivElement;
  private setKey = '';
  private heightEl: HTMLDivElement;
  private pill: HTMLDivElement;
  private pillText: HTMLSpanElement;
  private pillFill: HTMLDivElement;
  private next: HTMLCanvasElement[];
  private holdCanvas: HTMLCanvasElement;
  private bag: HTMLButtonElement;
  private vignette: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private hint: HTMLDivElement;
  private chips = new Map<HazardType, { el: HTMLElement; key: string; go: boolean }>();
  private gauges: HTMLDivElement;
  private sock: HTMLElement | null = null;
  private bob: HTMLElement | null = null;
  private rail: HTMLElement;
  private cpChip: HTMLElement;
  private cpChipKey = '';
  private lostChip: HTMLElement;
  private lostTimer = 0;
  readonly pauseBtn: HTMLButtonElement;
  readonly labBtn: HTMLButtonElement;
  private slotBtns: HTMLButtonElement[];
  private windBtn: HTMLButtonElement;
  private activeEl: HTMLDivElement;
  private powerKey = '';
  private windArmedUntil = 0;
  private windSpentAt = 0;
  private lastWind: SecondWindState = 'earn';
  /** A power slot was tapped. */
  onPower: (slot: number) => void = () => {};
  /** The bag was tapped (the same as a flick up): swap the shape in hand with the one in the bag. */
  onHold: () => void = () => {};
  /** Second Wind was tapped twice (the first tap arms it, so a stray tap can't spend it). */
  onSecondWind: () => void = () => {};
  private lastHearts = -1;
  private lastHeight = 0;
  private nextKey = '';
  private holdKey = '';
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private previewCache = new Map<string, HTMLCanvasElement>();

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    injectUiCss(); // Art's kit: the rail, chips and hazard telegraphs need it
    style.textContent = CSS + powerBarCss(); // Art's power bar styles go on top of ours
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'st-hud';
    this.root.innerHTML = `
      <div class="st-top">
        <div class="st-col">
          <div class="st-row"><button class="st-btn st-iconbtn" data-id="pause" aria-label="Pause">❚❚</button><div class="st-hearts" data-id="hearts"></div></div>
          <div class="st-chip st-set" data-id="set" hidden aria-label="Set streak"><span>🪨</span></div>
          <div class="st-gauges" data-id="gauges"></div>
        </div>
        <div class="st-col" style="align-items:flex-end">
          <div class="st-card" style="width:68px;height:68px"><div class="st-cap">NEXT</div><canvas data-id="next0"></canvas></div>
          <div class="st-card" style="width:46px;height:46px;opacity:0.75"><canvas data-id="next1"></canvas></div>
        </div>
      </div>
      <div class="st-center">
        <div class="st-height" data-id="height">0<small> m</small></div>
        <div class="st-pill" data-id="pill"><div class="st-fill"></div><span>CP 1</span></div>
      </div>
      <div class="st-hint" data-id="hint"><span>drag ↔ move</span><span>tap ⟳ rotate</span><span>drag ↓ faster</span><span>flick ↓ drop</span><span>flick ↑ bag</span></div>
      <div class="st-powers">
        <button class="st-btn st-slot empty" data-id="slot0" aria-label="Power-up 1"></button>
        <button class="st-btn st-slot empty" data-id="slot1" aria-label="Power-up 2"></button>
        <button class="st-btn st-slot st-wind earn" data-id="wind" aria-label="Second Wind"><img class="st-icon" alt=""><span class="st-tag">CP 2</span></button>
        <div class="st-active" data-id="active"></div>
      </div>
      <button class="st-btn st-lab" data-id="lab">⚙ Lab</button>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(id: string) => this.root.querySelector(`[data-id="${id}"]`) as T;
    this.hearts = q('hearts');
    this.setEl = q('set');
    // Art's shapes-left chip (art/src/ui/budget.ts) where the brick chip was, under the hearts.
    this.shapes = shapeCounter();
    this.shapes.dataset.id = 'shapes';
    this.setEl.before(this.shapes);
    this.edge = this.root.appendChild(alertEdge());
    this.heightEl = q('height');
    this.pill = q('pill');
    this.pillText = this.pill.querySelector('span')!;
    this.pillFill = this.pill.querySelector('.st-fill')!;
    this.next = [q('next0'), q('next1')];
    // The bag (art/src/ui/bag.ts) replaces the Hold card; the held shape's preview stands in it.
    this.holdCanvas = document.createElement('canvas');
    this.bag = this.root.appendChild(bagButton({ size: 64 }));
    this.bag.classList.add('st-bag');
    this.bag.dataset.id = 'holdcard';
    this.bag.querySelector('.ui-bag-slot')!.appendChild(this.holdCanvas);
    this.hint = q('hint');
    this.gauges = q('gauges');
    // Art's HUD pieces (art/src/ui/rail.ts, hazard.ts): the rail, the off-screen chips, the hazard chip.
    this.rail = this.root.appendChild(altitudeRail(Math.round(Math.min(200, window.innerHeight * 0.26))));
    this.cpChip = this.root.appendChild(checkpointChip(1));
    this.lostChip = this.root.appendChild(offscreenChip({ dir: 'down', label: '' }));
    this.pauseBtn = q('pause');
    this.labBtn = q('lab');
    this.slotBtns = [q('slot0'), q('slot1')];
    this.windBtn = q('wind');
    this.activeEl = q('active');
    this.windBtn.querySelector('img')!.src = powerIconUrl('wind', 46);
    this.slotBtns.forEach((b, i) => { b.onclick = () => this.onPower(i); });
    this.bag.onclick = () => { if (!this.bag.classList.contains('locked')) this.onHold(); };
    this.windBtn.onclick = () => {
      const now = performance.now();
      if (now < this.windArmedUntil) { this.windArmedUntil = 0; this.onSecondWind(); }
      else this.windArmedUntil = now + 2500;
      this.powerKey = '';
    };
    this.vignette = document.createElement('div');
    this.vignette.className = 'st-vignette';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'st-flash';
    this.overlay = document.createElement('div');
    this.overlay.className = 'st-overlay';
    parent.append(this.vignette, this.flashEl, this.overlay);
    this.sizeCanvas(this.next[0], 56);
    this.sizeCanvas(this.next[1], 36);
    this.sizeCanvas(this.holdCanvas, 54);
  }

  private sizeCanvas(c: HTMLCanvasElement, css: number): void {
    c.width = css * this.dpr; c.height = css * this.dpr;
    c.style.width = c.style.height = `${css}px`;
  }

  /** A shape's preview picture; a brittle one (gameplay.md §4.3) shows its cracks. */
  private preview(shape: string, brittle = false): HTMLCanvasElement {
    const key = brittle ? `${shape}!` : shape;
    let c = this.previewCache.get(key);
    if (!c) {
      const b = bakePiece(shape, 0, 48, { finish: 'wood' });
      c = b.canvas;
      if (brittle) c = crackCanvas(c, shape, b.s, b.originX * c.width - geometry(shape).width * b.s / 2, INK);
      this.previewCache.set(key, c);
    }
    return c;
  }

  private draw(c: HTMLCanvasElement, shape: string | null, dim = false, brittle = false): void {
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!shape) return;
    const p = this.preview(shape, brittle);
    const k = Math.min(c.width * 0.86 / p.width, c.height * 0.86 / p.height);
    ctx.globalAlpha = dim ? 0.8 : 1;
    ctx.drawImage(p, (c.width - p.width * k) / 2, (c.height - p.height * k) / 2, p.width * k, p.height * k);
  }

  setNext(shapes: string[], brittle: boolean[] = []): void {
    const key = shapes.map((k, i) => (brittle[i] ? `${k}!` : k)).join(',');
    if (key === this.nextKey) return;
    this.nextKey = key;
    this.draw(this.next[0], shapes[0] ?? null, false, !!brittle[0]);
    this.draw(this.next[1], shapes[1] ?? null, true, !!brittle[1]);
  }

  /** The bag shows a padlock until level 2 (gameplay.md §10.3). */
  lockHold(locked: boolean): void { setBag(this.bag, { locked: locked ? 'Lv 2' : null }); }

  setHold(shape: string | null, used: boolean, brittle = false): void {
    const key = `${shape}|${used}|${brittle}`;
    if (key === this.holdKey) return;
    this.holdKey = key;
    this.draw(this.holdCanvas, shape, false, brittle);
    setBag(this.bag, { held: !!shape, used });
  }

  /** A bag swap: the sack squashes and the new shape drops in. */
  swapBag(): void { bagSwap(this.bag); }

  setHearts(n: number, max: number, infinite: boolean): void {
    if (infinite) { if (this.lastHearts !== -2) { this.hearts.innerHTML = HEART('#FF4D6D') + '<b style="font:700 16px Fredoka">∞</b>'; this.lastHearts = -2; } return; }
    if (n === this.lastHearts) return;
    const prev = this.lastHearts;
    this.hearts.innerHTML = '';
    for (let i = 0; i < Math.max(max, n); i++) {
      const wrap = document.createElement('span');
      wrap.innerHTML = HEART(i < n ? '#FF4D6D' : 'rgba(34,24,58,0.18)');
      const el = wrap.firstElementChild as SVGElement;
      if (prev >= 0 && n > prev && i >= prev && i < n) el.classList.add('pop');
      this.hearts.appendChild(el);
    }
    if (prev > n && prev >= 0) {
      // A heart cracks and flies off (§7.1).
      for (let i = n; i < prev; i++) {
        const wrap = document.createElement('span');
        wrap.innerHTML = HEART('#FF4D6D');
        const el = wrap.firstElementChild as SVGElement;
        el.classList.add('lost');
        el.style.position = 'absolute';
        el.style.marginLeft = `${i * 25}px`;
        this.hearts.appendChild(el);
      }
    }
    this.lastHearts = n;
  }

  /** Shapes left (gameplay.md §7.2): amber with pips at 5 or fewer, red and pulsing with a red screen edge at 3 or fewer. */
  setBricks(left: number, infinite: boolean): void {
    setShapeCounter(this.shapes, left, infinite);
    setAlertEdge(this.edge, !infinite && left <= SHAPES_ALERT);
  }

  /**
   * The set streak (gameplay.md §9.1): a pip per Clean or Perfect placement in a row, out of `need`.
   * Full, it glows: the next full row turns to stone. Hidden where rows set at once (need 0).
   */
  setStreak(count: number, need: number): void {
    const key = `${count}/${need}`;
    if (key === this.setKey) return;
    this.setKey = key;
    this.setEl.hidden = need <= 0;
    if (need <= 0) return;
    const pips = [...this.setEl.querySelectorAll('i')];
    for (let i = pips.length; i < need; i++) this.setEl.appendChild(document.createElement('i'));
    for (let i = need; i < pips.length; i++) pips[i].remove();
    this.setEl.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < count));
    this.setEl.classList.toggle('ready', count >= need);
    this.setEl.setAttribute('aria-label', count >= need ? 'Set streak ready: the next full row turns to stone' : `Set streak ${count} of ${need}`);
  }

  /** A full row is waiting for the streak. */
  pulseSet(): void {
    this.setEl.classList.remove('pulse');
    void this.setEl.offsetWidth;
    this.setEl.classList.add('pulse');
  }

  /** The banner at the sim's budget_low moments (5, 3 and 1 left): a soft pill, then a big red line. */
  shapesAlert(left: number, still: boolean): void {
    this.clearAlerts();
    this.root.appendChild(shapeAlert(left, { still }));
  }

  /**
   * Why the run ended, stamped big ("OUT OF SHAPES!" or "OUT OF HEARTS!"), so it's never a mystery
   * (Blake's playtest). It goes on the page, not the HUD, so it stays up as the HUD hides for the
   * panorama; it removes itself, or clearAlerts takes it down when the summary opens.
   */
  runEndAlert(cause: string, still: boolean): void {
    if (cause !== 'bricks' && cause !== 'hearts') return;
    this.clearAlerts();
    const el = shapeAlert(0, { still });
    if (cause === 'hearts') {
      el.querySelector('.ui-sa-title span')!.textContent = 'OUT OF HEARTS!';
      el.querySelector('img')!.src = uiIconUrl('heart', 40);
    }
    el.dataset.id = 'run-end';
    document.body.appendChild(el);
  }

  clearAlerts(): void { document.querySelectorAll('.ui-salert').forEach(e => e.remove()); }

  setHeight(h: number): void {
    const v = Math.max(0, Math.floor(h * 10) / 10);
    const text = `${v.toFixed(1)}`;
    const cur = this.heightEl.firstChild!;
    if (cur.textContent !== text) {
      cur.textContent = text;
      if (v > this.lastHeight + 0.05) {
        this.heightEl.classList.add('bump');
        setTimeout(() => this.heightEl.classList.remove('bump'), 120);
      }
      this.lastHeight = Math.max(this.lastHeight, v);
    }
  }

  setCheckpoint(n: number, toGo: number, hold: number | null): void {
    const text = hold !== null ? 'Hold steady!' : `CP ${n} · ${Math.max(0, Math.ceil(toGo * 2) / 2)} to go`;
    if (this.pillText.textContent !== text) this.pillText.textContent = text;
    this.pillFill.style.transform = `scaleX(${hold ?? 0})`;
  }

  /**
   * The altitude rail (art-direction.md §8.2), Art's canvas: the whole run from the ground up in
   * biome colours, checkpoint ticks (gold for the next), the best height and the tower top. Heights
   * in blocks above the plinth; ticks end with the checkpoint being climbed to. Cheap every frame.
   */
  setRail(r: { ticks: number[]; best: number; top: number }): void {
    setRail(this.rail, { top: r.top, cps: r.ticks, claimed: r.ticks.length - 1, pb: r.best > 1 ? r.best : undefined });
  }

  /** The gold chip at the top edge while the checkpoint line is off-screen above ("▲ 4"). */
  setCheckpointChip(n: number | null): void {
    const key = String(n);
    if (key === this.cpChipKey) return;
    this.cpChipKey = key;
    if (n !== null) setOffscreenChip(this.cpChip, String(n));
    this.cpChip.classList.toggle('show', n !== null);
  }

  /** Art's "Now entering" card for biome `biome` (0 = Meadow); it plays about 2.3 s and removes itself. */
  biomeTitle(biome: number, o: { newPostcard: boolean; still: boolean }): void {
    this.root.querySelectorAll('.ui-btitle').forEach(e => e.remove());
    this.root.appendChild(biomeCard(biome, o));
  }

  /**
   * The hazard chips (gameplay.md §8.3, Art's telegraph), one per hazard type, at the edge the hazard
   * pushes from. A chip appears when its hazard is warned, its ring filling over the 2 s, pushes once
   * it starts, and slides out when it's no longer wanted (over, or called off by a hold). A new id
   * (the next piece of junk) or a flipped side starts a fresh chip.
   */
  syncHazards(want: HazardWant[]): void {
    const on = new Set<HazardType>();
    for (const w of want) {
      on.add(w.type);
      const key = `${w.dir}|${w.id ?? ''}`;
      let c = this.chips.get(w.type);
      if (c && c.key !== key) { hazardChipEnd(c.el); c = undefined; }
      if (!c) {
        const elapsed = Math.max(0, Math.min(WARNING, WARNING - w.left));
        c = { el: this.root.appendChild(hazardChip({ type: w.type, dir: w.dir, eta: WARNING, y: CHIP_Y[w.type], elapsed })), key, go: false };
        this.chips.set(w.type, c);
      }
      if (w.left <= 0 && !c.go) { hazardChipGo(c.el); c.go = true; }
    }
    for (const [type, c] of this.chips) if (!on.has(type)) { hazardChipEnd(c.el); this.chips.delete(type); }
  }

  /** Holds the hazard chips' countdowns while the game is paused. */
  pauseHazard(paused: boolean): void { for (const c of this.chips.values()) c.el.classList.toggle('paused', paused); }

  /**
   * The weather gauges under the bricks: the windsock while a crosswind blows (`wind` in g, + to the
   * right) and the plumb bob while gravity sways (`tilt`, -1 to 1, where it's about to pull). Null hides one.
   */
  setGauges(wind: number | null, tilt: number | null): void {
    if (wind === null) { this.sock?.remove(); this.sock = null; }
    else {
      const dir = wind < 0 ? -1 : 1, strength = Math.min(1, Math.abs(wind) / 0.1);
      if (!this.sock) this.sock = this.gauges.appendChild(windsock({ dir, strength }));
      else setWindsock(this.sock, dir, strength);
    }
    if (tilt === null) { this.bob?.remove(); this.bob = null; }
    else {
      if (!this.bob) this.bob = this.gauges.appendChild(plumbBob({ tilt }));
      else setPlumb(this.bob, tilt);
    }
  }

  /** A hazard's first appearance: Art's one-line card ("Gusts ahead! Keep it wide."), about 3 s. */
  hazardCard(type: HazardType = 'gust', still = false): void {
    this.root.appendChild(hazardCard(type, { still }));
  }

  /** A Zen run starts with a card like a hazard's: what Zen is, and how it ends (gameplay.md §12). */
  zenCard(still = false): void {
    const el = document.createElement('div');
    el.className = `ui ui-hcard${still ? ' ui-still' : ''}`;
    el.dataset.id = 'zen';
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="ui-hc-title"><img alt="" src="${uiIconUrl('zen', 40)}"><span>Zen mode</span></div>`
      + '<span class="ui-chip mint">No shapes to count, no hearts to lose</span><span class="ui-chip mint">Pause and tap Finish when you\'re done</span>';
    el.addEventListener('animationend', e => { if (e.animationName.startsWith('ui-hc')) el.remove(); });
    setTimeout(() => el.remove(), 5000);
    this.root.appendChild(el);
  }

  /** The first brittle shape a player sees gets a card like a hazard's (gameplay.md §4.3). */
  brittleCard(shape: string, still = false): void {
    const el = document.createElement('div');
    el.className = `ui ui-hcard${still ? ' ui-still' : ''}`;
    el.setAttribute('role', 'status');
    const icon = this.preview(shape, true).toDataURL();
    el.innerHTML = `<div class="ui-hc-title"><img alt="" src="${icon}" style="object-fit:contain"><span>Brittle shape!</span></div>`
      + '<span class="ui-chip amber">Breaks under 3 shapes</span><span class="ui-chip amber">Set it in stone, or toss it free</span>';
    el.addEventListener('animationend', e => { if (e.animationName.startsWith('ui-hc')) el.remove(); });
    setTimeout(() => el.remove(), 5000);
    this.root.appendChild(el);
  }

  flash(alpha = 0.2): void {
    this.flashEl.style.opacity = String(alpha);
    setTimeout(() => (this.flashEl.style.opacity = '0'), 60);
  }

  setTension(t: number): void {
    const v = Math.max(0, (t - 0.6) / 0.4);
    this.vignette.style.opacity = (v * (0.75 + 0.25 * Math.sin(performance.now() / 160))).toFixed(3);
  }

  /** The red ▼ at the bottom edge where a piece fell out of view. */
  lostArrow(xFrac: number): void {
    this.lostChip.style.setProperty('--x', `${Math.max(6, Math.min(94, xFrac * 100))}%`);
    this.lostChip.classList.add('show');
    clearTimeout(this.lostTimer);
    this.lostTimer = window.setTimeout(() => this.lostChip.classList.remove('show'), 900);
  }

  /**
   * The power bar: two slots, Second Wind (hidden when off or used, greyed until earned, glowing
   * when the player is down to a last heart or 3 shapes) and chips for Glue or Slow-Mo running.
   */
  setPowers(slots: (PowerKind | null)[], wind: SecondWindState, glueLeft: number, slowLeft: number, trouble: boolean): void {
    const armed = performance.now() < this.windArmedUntil && wind === 'ready';
    const key = `${slots.join()}|${wind}|${glueLeft}|${slowLeft}|${trouble}|${armed}`;
    if (key === this.powerKey) return;
    this.powerKey = key;
    slots.forEach((k, i) => {
      const b = this.slotBtns[i];
      if (b.dataset.kind === (k ?? undefined)) return;
      b.classList.toggle('empty', !k);
      if (k) b.dataset.kind = k; else delete b.dataset.kind;
      b.innerHTML = k ? `<img class="st-icon" alt="" src="${powerIconUrl(k, 40)}"><span class="st-tag">${POWER_TAGS[k]}</span>` : '';
      b.setAttribute('aria-label', k ? POWER_NAMES[k] : 'Empty power-up slot');
    });
    const w = this.windBtn;
    // Spent: it blows away (Art's `spent` animation, 450 ms), then hides.
    const now = performance.now();
    if (wind === 'used' && this.lastWind === 'ready') this.windSpentAt = now;
    this.lastWind = wind;
    const blowing = wind === 'used' && now - this.windSpentAt < 450;
    if (blowing) this.powerKey = ''; // keep checking until it has blown away
    w.classList.toggle('spent', blowing);
    w.classList.toggle('hide', wind === 'off' || (wind === 'used' && !blowing));
    w.classList.toggle('earn', wind === 'earn');
    w.classList.toggle('armed', armed);
    w.classList.toggle('glow', wind === 'ready' && trouble && !armed);
    w.querySelector('.st-tag')!.textContent = wind === 'earn' ? 'CP 2' : armed ? 'TAP AGAIN' : '2ND WIND';
    let chips = '';
    if (glueLeft > 0) chips += `<div class="st-chip"><img class="st-icon" alt="Glue" src="${powerIconUrl('glue', 16)}">${glueLeft}</div>`;
    if (slowLeft > 0) chips += `<div class="st-chip"><img class="st-icon" alt="Slow-Mo" src="${powerIconUrl('slowmo', 16)}">${slowLeft}</div>`;
    this.activeEl.innerHTML = chips;
  }

  /** Bounces a slot (-1: Second Wind) when something arrives in it, or shakes it when refused. */
  bumpPower(slot: number, refused = false): void {
    const b = slot < 0 ? this.windBtn : this.slotBtns[slot];
    if (!b) return;
    const cls = refused ? 'nope' : 'pop';
    b.classList.remove('pop', 'nope');
    void b.offsetWidth;
    b.classList.add(cls);
  }

  /** Screen position (CSS px) of a slot's centre, for effects that fly into it. */
  slotCentre(slot: number): { x: number; y: number } {
    const r = (slot < 0 ? this.windBtn : this.slotBtns[slot] ?? this.windBtn).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  hideHint(): void { this.hint.style.opacity = '0'; }
  showHint(): void { this.hint.style.opacity = '0.9'; }

  /** Shows a modal card. Buttons: [label, handler, primary?]. */
  card(html: string, buttons: [string, () => void, boolean?][], extra?: (panel: HTMLDivElement) => void): void {
    this.overlay.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'st-panel';
    panel.innerHTML = html;
    const row = document.createElement('div');
    for (const [label, fn, primary] of buttons) {
      const b = document.createElement('button');
      b.className = 'st-btn' + (primary ? ' st-big' : '');
      b.textContent = label;
      b.onclick = () => fn();
      row.appendChild(b);
    }
    panel.appendChild(row);
    extra?.(panel);
    this.overlay.appendChild(panel);
    this.overlay.classList.add('show');
  }

  closeCard(): void { this.overlay.classList.remove('show'); this.overlay.innerHTML = ''; }
  get cardOpen(): boolean { return this.overlay.classList.contains('show'); }

  reset(): void {
    this.powerKey = '';
    this.setKey = '';
    this.chips.clear();
    this.root.querySelectorAll('.ui-hazard, .ui-hcard, .ui-btitle').forEach(e => e.remove());
    this.clearAlerts();
    this.setGauges(null, null);
    this.setCheckpointChip(null);
    this.windArmedUntil = 0;
    this.windSpentAt = 0;
    this.lastWind = 'earn';
    for (const b of this.slotBtns) delete b.dataset.kind;
    this.lastHearts = -1;
    this.lastHeight = 0;
    this.nextKey = '';
    this.holdKey = '';
  }
}

export function statsHtml(s: RunStats): string {
  const causes: Record<string, string> = { bricks: 'Out of shapes!', hearts: 'Out of hearts!', quit: 'You quit' };
  return `<h2>${causes[s.cause] ?? 'Run over'}</h2>
    <div class="st-stats">
      <span>Height</span><b>${s.height.toFixed(1)} m</b>
      <span>Checkpoints</span><b>${s.checkpoints}</b>
      <span>Highest biome</span><b>${s.biome}</b>
      <span>Perfects</span><b>${s.perfects}</b>
      <span>Solid Rows</span><b>${s.rows}</b>
      <span>Shapes placed</span><b>${s.placed}</b>
      <span>Score</span><b>${s.score.toLocaleString()}</b>
      <span>XP</span><b>+${s.xp}</b>
    </div>`;
}
