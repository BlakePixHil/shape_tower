// The in-game HUD and screens as DOM over the canvas (art-direction.md §8: "sticker toy" UI).
// Screen space only: camera shake never moves it.

import { bakePiece, powerBarCss, powerIconUrl } from '@art/index.ts';
import type { PowerKind, SecondWindState } from '../sim/sim.ts';
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
.st-chip.warn { background: #FFAA2B; }
.st-chip.danger { background: #FF4D6D; color: #fff; }
.st-chip.pulse { animation: st-pulse 400ms; }
@keyframes st-pulse { 50% { transform: scale(1.25); } }
.st-center { position: absolute; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 8px); display: flex; flex-direction: column; align-items: center; gap: 4px; }
.st-height { font: 700 38px 'Fredoka', sans-serif; color: #fff; -webkit-text-stroke: 3px ${INK}; paint-order: stroke fill; line-height: 1; font-variant-numeric: tabular-nums; transition: transform 120ms; }
.st-height.bump { transform: scale(1.15); }
.st-height small { font-size: 18px; }
.st-pill { background: #FFC23D; border: 3px solid ${INK}; border-radius: 999px; box-shadow: 0 3px 0 ${INK}; font: 700 13px 'Fredoka', sans-serif; padding: 1px 10px; white-space: nowrap; position: relative; overflow: hidden; }
.st-pill .st-fill { position: absolute; inset: 0; background: #3EE6A8; transform-origin: left; transform: scaleX(0); }
.st-pill span { position: relative; }
.st-title { position: absolute; left: 50%; top: 22%; transform: translate(-50%, -40px); opacity: 0; font: 700 34px 'Fredoka', sans-serif; color: #fff; -webkit-text-stroke: 4px ${INK}; paint-order: stroke fill; letter-spacing: 0.05em; transition: transform 500ms cubic-bezier(.2,1.6,.4,1), opacity 300ms; white-space: nowrap; }
.st-title.show { transform: translate(-50%, 0); opacity: 1; }
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
.st-lab { position: absolute; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); }
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
.st-arrow { position: absolute; bottom: 8px; font: 700 26px 'Fredoka', sans-serif; color: #FF4D6D; -webkit-text-stroke: 2px ${INK}; paint-order: stroke fill; opacity: 0; transition: opacity 200ms; }
`;

const HEART = (fill: string) => `<svg viewBox="0 0 24 24" class="st-heart"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.5h2c.7-1.3 2.2-2.5 4.3-2.5 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="${fill}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

export interface RunStats { height: number; checkpoints: number; score: number; xp: number; perfects: number; rows: number; placed: number; cause: string; biome: string }

export class Hud {
  readonly root: HTMLDivElement;
  private hearts: HTMLDivElement;
  private bricks: HTMLDivElement;
  private heightEl: HTMLDivElement;
  private pill: HTMLDivElement;
  private pillText: HTMLSpanElement;
  private pillFill: HTMLDivElement;
  private next: HTMLCanvasElement[];
  private holdCanvas: HTMLCanvasElement;
  private holdCard: HTMLDivElement;
  private title: HTMLDivElement;
  private vignette: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private hint: HTMLDivElement;
  private arrow: HTMLDivElement;
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
    style.textContent = CSS + powerBarCss(); // Art's power bar styles go on top of ours
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'st-hud';
    this.root.innerHTML = `
      <div class="st-top">
        <div class="st-col">
          <div class="st-row"><button class="st-btn st-iconbtn" data-id="pause" aria-label="Pause">❚❚</button><div class="st-hearts" data-id="hearts"></div></div>
          <div class="st-card" data-id="holdcard" style="width:58px;height:58px"><div class="st-cap">HOLD</div><canvas data-id="hold"></canvas></div>
          <div class="st-chip" data-id="bricks">🧱 <span>0</span></div>
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
      <div class="st-title" data-id="title"></div>
      <div class="st-hint" data-id="hint"><span>drag ↔ move</span><span>tap ⟳ rotate</span><span>drag ↓ faster</span><span>flick ↓ drop</span><span>flick ↑ hold</span></div>
      <div class="st-arrow" data-id="arrow">▼</div>
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
    this.bricks = q('bricks');
    this.heightEl = q('height');
    this.pill = q('pill');
    this.pillText = this.pill.querySelector('span')!;
    this.pillFill = this.pill.querySelector('.st-fill')!;
    this.next = [q('next0'), q('next1')];
    this.holdCanvas = q('hold');
    this.holdCard = q('holdcard');
    this.title = q('title');
    this.hint = q('hint');
    this.arrow = q('arrow');
    this.pauseBtn = q('pause');
    this.labBtn = q('lab');
    this.slotBtns = [q('slot0'), q('slot1')];
    this.windBtn = q('wind');
    this.activeEl = q('active');
    this.windBtn.querySelector('img')!.src = powerIconUrl('wind', 46);
    this.slotBtns.forEach((b, i) => { b.onclick = () => this.onPower(i); });
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
    this.sizeCanvas(this.holdCanvas, 46);
  }

  private sizeCanvas(c: HTMLCanvasElement, css: number): void {
    c.width = css * this.dpr; c.height = css * this.dpr;
    c.style.width = c.style.height = `${css}px`;
  }

  private preview(shape: string): HTMLCanvasElement {
    let c = this.previewCache.get(shape);
    if (!c) { c = bakePiece(shape, 0, 48, { finish: 'wood' }).canvas; this.previewCache.set(shape, c); }
    return c;
  }

  private draw(c: HTMLCanvasElement, shape: string | null, dim = false): void {
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!shape) return;
    const p = this.preview(shape);
    const k = Math.min(c.width * 0.86 / p.width, c.height * 0.86 / p.height);
    ctx.globalAlpha = dim ? 0.8 : 1;
    ctx.drawImage(p, (c.width - p.width * k) / 2, (c.height - p.height * k) / 2, p.width * k, p.height * k);
  }

  setNext(shapes: string[]): void {
    const key = shapes.join(',');
    if (key === this.nextKey) return;
    this.nextKey = key;
    this.draw(this.next[0], shapes[0] ?? null);
    this.draw(this.next[1], shapes[1] ?? null, true);
  }

  setHold(shape: string | null, used: boolean): void {
    const key = `${shape}|${used}`;
    if (key === this.holdKey) return;
    this.holdKey = key;
    this.draw(this.holdCanvas, shape);
    this.holdCard.style.opacity = used ? '0.55' : '1';
  }

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

  setBricks(left: number, infinite: boolean): void {
    const span = this.bricks.querySelector('span')!;
    const text = infinite ? '∞' : String(Math.max(0, left));
    if (span.textContent !== text) span.textContent = text;
    this.bricks.classList.toggle('warn', !infinite && left <= 5 && left > 1);
    this.bricks.classList.toggle('danger', !infinite && left <= 1);
  }

  pulseBricks(): void {
    this.bricks.classList.remove('pulse');
    void this.bricks.offsetWidth;
    this.bricks.classList.add('pulse');
  }

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

  titleCard(text: string): void {
    this.title.textContent = text;
    this.title.classList.add('show');
    setTimeout(() => this.title.classList.remove('show'), 1800);
  }

  flash(alpha = 0.2): void {
    this.flashEl.style.opacity = String(alpha);
    setTimeout(() => (this.flashEl.style.opacity = '0'), 60);
  }

  setTension(t: number): void {
    const v = Math.max(0, (t - 0.6) / 0.4);
    this.vignette.style.opacity = (v * (0.75 + 0.25 * Math.sin(performance.now() / 160))).toFixed(3);
  }

  lostArrow(xFrac: number): void {
    this.arrow.style.left = `${Math.max(4, Math.min(96, xFrac * 100))}%`;
    this.arrow.style.opacity = '1';
    setTimeout(() => (this.arrow.style.opacity = '0'), 700);
  }

  /**
   * The power bar: two slots, Second Wind (hidden when off or used, greyed until earned, glowing
   * when the player is down to a last heart or 3 bricks) and chips for Glue or Slow-Mo running.
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
  const causes: Record<string, string> = { bricks: 'Out of bricks!', hearts: 'Out of hearts!', quit: 'You quit' };
  return `<h2>${causes[s.cause] ?? 'Run over'}</h2>
    <div class="st-stats">
      <span>Height</span><b>${s.height.toFixed(1)} m</b>
      <span>Checkpoints</span><b>${s.checkpoints}</b>
      <span>Highest biome</span><b>${s.biome}</b>
      <span>Perfects</span><b>${s.perfects}</b>
      <span>Solid Rows</span><b>${s.rows}</b>
      <span>Bricks placed</span><b>${s.placed}</b>
      <span>Score</span><b>${s.score.toLocaleString()}</b>
      <span>XP</span><b>+${s.xp}</b>
    </div>`;
}
