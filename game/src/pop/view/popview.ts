// Blockling Pop's play screen (Pop plan §8, §9): the board on the biome's sky, the score on top, the tray
// under the board and the next tray and the bag along the bottom. Drag a tray shape: it grows to board
// size and lifts above the finger, the ghost snaps to the nearest cell it fits with some hysteresis,
// the lines it would complete glow, and letting go stamps it in. The sim is final the instant a shape
// lands; everything here plays on top and never blocks the next pick-up.
//
// Canvas 2D over the shell's Phaser canvas (which sleeps while Pop is up), with a DOM top bar from the
// art UI kit. Milestone 1's juice is a first pass: stamps, the pop wave, confetti, points, banners,
// shake and the run-over tumble. The full pop sequence comes with milestone 2.

import { BIOMES, INK, bakePostcard, uiIconUrl, type Expression } from '@art/index.ts';
import { CELLS, LINE_CELLS } from '../sim/board.ts';
import { BAG, type PopEvent, type PopIntent, type PopSim } from '../sim/pop.ts';
import { POP_SHAPES, type Turn } from '../sim/shapes.ts';
import type { Slot } from '../sim/deal.ts';
import { PopArt, bakeBagBox, bakeBoard, shapeColors } from './draw.ts';
import { PopFx } from './fx.ts';
import { PopFrames } from '../save.ts';

/** The calls Pop makes into Sound's director (a subset of AudioDirector). */
export interface PopAudio {
  handle(name: string, payload?: Record<string, unknown>): void;
  ui(kind: 'tap' | 'tap2' | 'back' | 'open' | 'close' | 'error' | 'start'): void;
}

export interface PopHooks {
  audio(): PopAudio | null;
  reducedMotion(): boolean;
  /** Effects on (Gate 1): off keeps the ghost, the line glow, the score and a plain pop. */
  juice(): boolean;
  /** The best score before this run, for the top bar. */
  best(): number;
  onPause(): void;
  /** After every move: save the run. */
  onChange(sim: PopSim): void;
  /** The run is over and its last moment has played: show the results. */
  onOver(sim: PopSim): void;
}

const CSS = `
.pop-root { position: fixed; inset: 0; z-index: 6; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; background: #A9DEFF; }
.pop-bg { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity 1.2s ease; }
.pop-cv { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.pop-top { position: absolute; left: 0; right: 0; top: 0; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 0; display: grid; grid-template-columns: 64px 1fr 64px; align-items: start; pointer-events: none; }
.pop-top .ui-btn { pointer-events: auto; }
.pop-score { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pop-score b { font: 700 36px/1 var(--display, Fredoka, sans-serif); color: #fff; -webkit-text-stroke: 7px var(--ink, ${INK}); paint-order: stroke fill; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
.pop-score span, .pop-cp { font: 800 12px/1 var(--body, Nunito, sans-serif); color: var(--ink, ${INK}); background: rgba(255,247,232,0.94); border: 2px solid var(--ink, ${INK}); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
.pop-cp { justify-self: end; display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 5px; margin-top: 6px; }
.pop-cp img { width: 18px; height: 18px; }
.pop-combo { position: absolute; display: flex; align-items: center; gap: 4px; font: 700 18px/1 var(--display, Fredoka, sans-serif); color: #fff; background: #FF8A3D; border: 3px solid var(--ink, ${INK}); border-radius: 999px; padding: 3px 9px 3px 10px; box-shadow: 0 3px 0 var(--ink, ${INK}); transform: translate(-100%, -50%) scale(0); transform-origin: 100% 50%; transition: transform 180ms cubic-bezier(.3,1.6,.5,1); pointer-events: none; -webkit-text-stroke: 4px var(--ink, ${INK}); paint-order: stroke fill; }
.pop-combo.on { transform: translate(-100%, -50%) scale(1); }
.pop-combo i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #FFE08A; border: 2px solid var(--ink, ${INK}); }
.pop-combo i.off { background: rgba(255,255,255,0.35); }
.pop-label { position: absolute; font: 800 11px/1 var(--body, Nunito, sans-serif); letter-spacing: 0.08em; color: var(--ink, ${INK}); opacity: 0.75; transform: translateX(-50%); pointer-events: none; text-transform: uppercase; }
`;

interface Comp { s: number; piece: number; cells: [number, number][]; x: number; y: number; face: boolean; size: number }
interface Held { slot: number; px: number; py: number; t0: number; ghost: { x: number; y: number } | null; lines: number[]; id: number }
interface Spring { slot: number; x: number; y: number; scale: number; t0: number }
interface Popping { cell: number; s: number; start: number; burst: boolean }
interface Body { b: HTMLCanvasElement; x: number; y: number; vx: number; vy: number; rot: number; vr: number }

const now = () => performance.now();
const backOut = (t: number) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const BANNERS = ['', '', 'Double!', 'Triple!', 'TOWERING!', 'SKY-HIGH!'];

export class PopView {
  readonly root: HTMLDivElement;
  sim: PopSim | null = null;
  paused = false;
  /** Active play time this run (ms), for the ad meter and the XP floor. */
  playMs = 0;
  /** This run's frame times, for QA's run record. */
  frames = new PopFrames();

  private hooks: PopHooks;
  private cv: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private bgBiome = -1;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private cpEl: HTMLElement;
  private comboEl: HTMLElement;
  private nextLabel: HTMLElement;
  private bagLabel: HTMLElement;
  private raf = 0;
  private last = 0;
  private lastRaw = 0;

  // layout, device px
  private k = 1;
  private W = 0;
  private H = 0;
  private cell = 40;
  private pad = 8;
  private bx = 0;
  private by = 0;
  private trayY = 0;
  private trayH = 0;
  private bag = { x: 0, y: 0, s: 0 };
  private nextBox = { x: 0, y: 0, w: 0, h: 0 };

  private art!: PopArt;
  private boardCv: HTMLCanvasElement | null = null;
  private bagCv: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  private fx = new PopFx(1);
  private comps: Comp[] = [];
  private held: Held | null = null;
  private springs: Spring[] = [];
  private popping: Popping[] = [];
  private flashes: { cells: number[]; t0: number }[] = [];
  private stamps = new Map<number, number>(); // piece → when it landed
  private trayIn = -1e9;
  private shownScore = 0;
  private pointer = -1;
  private bodies: Body[] = [];
  private overAt = -1;
  private overDone = false;
  private holdUntil = 0; // hitstop: effects wait until then
  private seenTray = 0;

  constructor(parent: HTMLElement, hooks: PopHooks) {
    this.hooks = hooks;
    if (!document.getElementById('pop-css')) {
      const st = document.createElement('style');
      st.id = 'pop-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'pop-root';
    this.root.style.display = 'none';
    this.cv = document.createElement('canvas');
    this.cv.className = 'pop-cv';
    this.c = this.cv.getContext('2d')!;
    const top = document.createElement('div');
    top.className = 'pop-top';
    top.innerHTML = `<button type="button" class="ui-btn icon" data-act="pause" aria-label="Pause"><img alt="" src="${uiIconUrl('pause', 24)}"></button>
      <div class="pop-score"><b>0</b><span>Best 0</span></div>
      <div class="pop-cp"><img alt="" src="${uiIconUrl('flag', 18)}"><span>0/8</span></div>`;
    this.scoreEl = top.querySelector('.pop-score b')!;
    this.bestEl = top.querySelector('.pop-score span')!;
    this.cpEl = top.querySelector('.pop-cp span')!;
    this.comboEl = document.createElement('div');
    this.comboEl.className = 'pop-combo';
    this.nextLabel = document.createElement('div');
    this.nextLabel.className = 'pop-label';
    this.nextLabel.textContent = 'Next';
    this.bagLabel = document.createElement('div');
    this.bagLabel.className = 'pop-label';
    this.bagLabel.textContent = 'Bag';
    this.root.append(this.cv, top, this.comboEl, this.nextLabel, this.bagLabel);
    parent.appendChild(this.root);
    top.querySelector<HTMLElement>('[data-act="pause"]')!.onclick = () => { if (this.sim && !this.sim.over) hooks.onPause(); };
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e, false));
    this.cv.addEventListener('pointercancel', e => this.up(e, true));
    window.addEventListener('resize', () => { if (this.active) this.layout(); });
  }

  get active(): boolean { return this.root.style.display !== 'none'; }

  /** Shows the screen for a run: a new one, or one replayed from its save (`playMs` already played). */
  start(sim: PopSim, playMs = 0): void {
    this.sim = sim;
    this.playMs = playMs;
    this.frames = new PopFrames();
    this.paused = false;
    this.held = null;
    this.springs = [];
    this.popping = [];
    this.flashes = [];
    this.stamps.clear();
    this.bodies = [];
    this.overAt = -1;
    this.overDone = false;
    this.seenTray = sim.trays;
    this.shownScore = sim.score;
    this.root.style.display = '';
    this.layout();
    this.fx.clear();
    this.rebuild();
    this.trayIn = now();
    sim.sink = { emit: (name, payload) => this.onEvent({ name, payload }) };
    this.hud();
    this.hooks.audio()?.handle('run_start', {});
    this.last = now();
    this.lastRaw = this.last;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  /** Takes the screen down (the results are showing, or the player went home). */
  hide(): void {
    this.root.style.display = 'none';
    cancelAnimationFrame(this.raf);
    if (this.sim) this.sim.sink = null;
    this.held = null;
  }

  setPaused(on: boolean): void {
    this.paused = on;
    if (on && this.held) this.cancelHeld();
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    const Wc = window.innerWidth, Hc = window.innerHeight;
    this.k = Math.min(2, window.devicePixelRatio || 1);
    const k = this.k;
    this.cv.width = Math.round(Wc * k);
    this.cv.height = Math.round(Hc * k);
    this.W = this.cv.width; this.H = this.cv.height;
    const safe = safeArea();
    const topC = safe.top + 62, botSafe = safe.bottom + 8;
    // Cells about 38 pt on a 390 pt phone; the board, the tray (2.4 cells), the bottom row (1.7 cells).
    let cellC = Math.floor(Math.min((Wc - 24) / 9.5, (Hc - topC - botSafe - 30) / 13.4));
    cellC = Math.max(22, Math.min(58, cellC));
    const padC = Math.max(6, Math.round(cellC * 0.24));
    const boardC = cellC * 9 + padC * 2, trayC = cellC * 2.6, botC = cellC * 1.8;
    const spare = Math.max(0, Hc - topC - botSafe - boardC - trayC - botC - 12);
    const byC = topC + spare * 0.35 + padC;
    this.cell = cellC * k;
    this.pad = padC * k;
    this.bx = Math.round(((Wc - cellC * 9) / 2) * k);
    this.by = Math.round(byC * k);
    this.trayY = Math.round((byC + cellC * 9 + padC + 8 + spare * 0.2) * k);
    this.trayH = Math.round(trayC * k);
    const botY = this.trayY + this.trayH + spare * 0.15 * k;
    const bagS = Math.round(cellC * 1.7 * k);
    this.bag = { x: this.W - bagS - Math.max(16 * k, (Wc / 3 - cellC * 1.7) / 2 * k), y: botY, s: bagS };
    this.nextBox = { x: this.W / 2 - cellC * 2.6 * k, y: botY, w: cellC * 5.2 * k, h: bagS };
    this.art = new PopArt(this.cell, this.sim?.biome ?? 0);
    this.boardCv = bakeBoard(this.cell, this.pad);
    this.bagCv = [bakeBagBox(bagS, false), bakeBagBox(bagS, true)];
    this.fx = new PopFx(k);
    this.comboEl.style.left = `${(this.bx + this.cell * 9 + this.pad * 0.6) / k}px`;
    this.comboEl.style.top = `${(this.by - this.pad * 0.6) / k}px`;
    this.nextLabel.style.left = `${(this.nextBox.x + this.nextBox.w / 2) / k}px`;
    this.nextLabel.style.top = `${(this.nextBox.y + this.nextBox.h + 4 * k) / k}px`;
    this.bagLabel.style.left = `${(this.bag.x + this.bag.s / 2) / k}px`;
    this.bagLabel.style.top = `${(this.bag.y + this.bag.s + 4 * k) / k}px`;
    this.backdrop(true);
  }

  /** The biome's sky behind it all (Art's postcard at screen size), cross-fading when the biome changes. */
  private backdrop(force = false): void {
    const b = this.sim?.biome ?? 0;
    if (!force && b === this.bgBiome) return;
    this.bgBiome = b;
    const Wc = window.innerWidth, Hc = window.innerHeight;
    let cv: HTMLCanvasElement;
    try { cv = bakePostcard(b, Wc, Hc, Math.min(1.5, this.k)); } catch { return; }
    cv.className = 'pop-bg';
    cv.style.opacity = force || !this.bg ? '1' : '0';
    this.root.insertBefore(cv, this.cv);
    const old = this.bg;
    this.bg = cv;
    if (old && !force) {
      requestAnimationFrame(() => { cv.style.opacity = '1'; });
      setTimeout(() => old.remove(), 1400);
    } else old?.remove();
  }

  // ---------------------------------------------------------------- the board's pieces

  /** Groups the board's cells into pieces and their fragments (4-connected), each drawn as one body. */
  private rebuild(): void {
    const sim = this.sim!;
    const seen = new Uint8Array(CELLS);
    const comps: Comp[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (seen[i] || sim.cellShape[i] < 0) continue;
      const piece = sim.cellPiece[i], s = sim.cellShape[i];
      const cells: [number, number][] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % 9, y = (c / 9) | 0;
        cells.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx > 8 || ny > 8) continue;
          const n = ny * 9 + nx;
          if (!seen[n] && sim.cellPiece[n] === piece && sim.cellShape[n] === s) { seen[n] = 1; stack.push(n); }
        }
      }
      comps.push({ s, piece, cells, x: Math.min(...cells.map(v => v[0])), y: Math.min(...cells.map(v => v[1])), face: false, size: cells.length });
    }
    // A piece's face sits on its biggest fragment (Pop plan §3).
    const best = new Map<number, Comp>();
    for (const cp of comps) { const b = best.get(cp.piece); if (!b || cp.size > b.size) best.set(cp.piece, cp); }
    for (const cp of best.values()) cp.face = true;
    this.comps = comps;
  }

  // ---------------------------------------------------------------- events from the sim

  private onEvent(e: PopEvent): void {
    const a = this.hooks.audio();
    const p = e.payload;
    const juice = this.hooks.juice();
    const t = now();
    switch (e.name) {
      case 'pop_placed': {
        this.rebuild();
        this.stamps.set(p.piece as number, t);
        a?.handle('piece_landed', { impact: 0.35, shape: p.shape });
        a?.handle('piece_settled', { grade: 'clean' });
        if (juice) {
          const cells = p.cells as number[];
          const xs = cells.map(c => c % 9), ys = cells.map(c => (c / 9) | 0);
          const y1 = this.by + (Math.max(...ys) + 1) * this.cell;
          this.fx.dust(this.bx + Math.min(...xs) * this.cell, y1, this.cell);
          this.fx.dust(this.bx + (Math.max(...xs) + 1) * this.cell, y1, this.cell);
        }
        break;
      }
      case 'pop_lines': {
        const n = p.count as number;
        const order = p.order as number[][];
        const cells = p.cells as number[], shapes = p.shapes as number[];
        const stop = n >= 3 ? 80 : n === 2 ? 60 : 40;
        this.holdUntil = t + (juice ? stop : 0);
        const start = new Map<number, number>();
        order.forEach(line => line.forEach((c, i) => { const d = i * (juice ? 39 : 0); if (!start.has(c) || d < start.get(c)!) start.set(c, d); }));
        cells.forEach((c, i) => this.popping.push({ cell: c, s: shapes[i], start: t + (juice ? stop : 0) + (start.get(c) ?? 0), burst: false }));
        this.flashes.push({ cells, t0: t });
        // Points fly up from the middle of what popped.
        const cx = cells.reduce((s, c) => s + (c % 9), 0) / cells.length, cy = cells.reduce((s, c) => s + ((c / 9) | 0), 0) / cells.length;
        const px = this.bx + (cx + 0.5) * this.cell, py = this.by + (cy + 0.5) * this.cell;
        this.fx.text(`+${(p.points as number).toLocaleString('en-US')}`, px, py, { size: 26, fill: '#FFE08A', rise: 50, life: 1000 });
        if (juice) {
          if (n >= 2) this.fx.text(BANNERS[Math.min(5, n)], this.bx + this.cell * 4.5, this.by + this.cell * 3.2, { size: n >= 4 ? 46 : 40, fill: n >= 4 ? '#FF8A3D' : '#FFFFFF', rise: 16, life: 1200, pop: true });
          this.fx.kick(n >= 3 ? 0.55 : n === 2 ? 0.4 : 0.25);
        }
        a?.handle('row_solid', { count: n });
        if ((p.combo as number) >= 3) a?.handle('perfect', { combo: p.combo });
        break;
      }
      case 'pop_all_clear':
        if (juice) {
          this.fx.text('ALL CLEAR!', this.bx + this.cell * 4.5, this.by + this.cell * 4.6, { size: 50, fill: '#FFE08A', rise: 10, life: 1700, pop: true });
          this.fx.kick(0.8);
        }
        a?.handle('pb_crossed', {});
        break;
      case 'pop_checkpoint':
        if (juice) this.fx.text(`Checkpoint ${p.n}!`, this.bx + this.cell * 4.5, this.by - this.pad * 1.6, { size: 24, fill: '#A6F4C5', rise: 20, life: 1400, pop: true });
        a?.handle('checkpoint_claimed', { n: p.n });
        break;
      case 'biome_entered':
        a?.handle('biome_entered', { id: p.id });
        this.art = new PopArt(this.cell, this.sim!.biome);
        setTimeout(() => this.backdrop(), 500);
        break;
      case 'pop_tray':
        if ((p.n as number) > this.seenTray) { this.seenTray = p.n as number; this.trayIn = t; }
        break;
      case 'pop_bag':
        a?.handle('hold_swap', {});
        break;
      case 'pop_no_room':
        if (juice) this.fx.text('No room!', this.bx + this.cell * 4.5, this.by + this.cell * 4.5, { size: 48, fill: '#FF8FA3', rise: 0, life: 1500, pop: true });
        break;
      case 'run_over':
        a?.handle('run_over', { cause: p.cause });
        this.overAt = t;
        break;
    }
    this.hud();
  }

  private hud(): void {
    const sim = this.sim;
    if (!sim) return;
    this.bestEl.textContent = `Best ${Math.max(this.hooks.best(), sim.score).toLocaleString('en-US')}`;
    const pr = sim.cpProgress;
    this.cpEl.textContent = `${BIOMES[sim.biome].name} ${pr.into}/${pr.need}`;
    if (sim.combo >= 1) {
      const mult = Math.min(sim.tuning.comboMax, 1 + sim.tuning.comboStep * (sim.combo - 1));
      this.comboEl.innerHTML = `×${mult}${Array.from({ length: sim.tuning.sparks }, (_, i) => `<i class="${i < sim.sparks ? '' : 'off'}"></i>`).join('')}`;
      this.comboEl.classList.add('on');
    } else this.comboEl.classList.remove('on');
  }

  // ---------------------------------------------------------------- input

  private toDev(e: PointerEvent): [number, number] {
    const r = this.cv.getBoundingClientRect();
    return [(e.clientX - r.left) * this.k, (e.clientY - r.top) * this.k];
  }

  /** The tray slot (0-2) or the bag (3) under a point, or -1. */
  private slotAt(x: number, y: number): number {
    const g = 12 * this.k;
    const b = this.bag;
    if (x >= b.x - g && x <= b.x + b.s + g && y >= b.y - g && y <= b.y + b.s + g) return BAG;
    if (y >= this.trayY - g && y <= this.trayY + this.trayH + g) return Math.max(0, Math.min(2, Math.floor(x / (this.W / 3))));
    return -1;
  }

  /** Where a slot's shape sits at rest: its centre, device px. */
  private slotCentre(i: number): [number, number] {
    if (i === BAG) return [this.bag.x + this.bag.s / 2, this.bag.y + this.bag.s / 2];
    return [(i + 0.5) * (this.W / 3), this.trayY + this.trayH / 2];
  }

  private slotScale(i: number, t: Turn): number {
    if (i === BAG) return Math.min(0.42, (this.bag.s * 0.78) / (Math.max(t.w, t.h) * this.cell));
    return Math.min(0.6, (this.trayH * 0.92) / (t.h * this.cell), (this.W / 3 * 0.9) / (t.w * this.cell));
  }

  private down(e: PointerEvent): void {
    const sim = this.sim;
    if (!sim || sim.over || this.paused || this.pointer !== -1) return;
    const [x, y] = this.toDev(e);
    const slot = this.slotAt(x, y);
    if (slot < 0 || !sim.slot(slot) || this.springs.some(s => s.slot === slot)) return;
    this.pointer = e.pointerId;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    this.held = { slot, px: x, py: y, t0: now(), ghost: null, lines: [], id: e.pointerId };
    this.track();
    this.hooks.audio()?.ui('tap');
  }

  private move(e: PointerEvent): void {
    if (!this.held || e.pointerId !== this.pointer) return;
    const [x, y] = this.toDev(e);
    this.held.px = x; this.held.py = y;
    this.track();
  }

  private up(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    const h = this.held, sim = this.sim;
    if (!h || !sim) return;
    this.held = null;
    if (!cancel && h.ghost && this.intent({ t: 'place', slot: h.slot, x: h.ghost.x, y: h.ghost.y })) return;
    const [x, y] = this.toDev(e);
    if (!cancel && h.slot !== BAG && this.slotAt(x, y) === BAG && sim.canBag(h.slot)) {
      if (this.intent({ t: 'bag', slot: h.slot })) return;
    }
    this.springBack(h);
  }

  private cancelHeld(): void {
    if (this.held) this.springBack(this.held);
    this.held = null;
    this.pointer = -1;
  }

  private springBack(h: Held): void {
    const t = this.sim?.turn(h.slot);
    if (!t) return;
    const [cx, cy] = this.heldCentre(h, t);
    this.springs.push({ slot: h.slot, x: cx, y: cy, scale: this.heldScale(h), t0: now() });
    this.hooks.audio()?.ui('back');
  }

  /** The held shape's centre: over the finger, its bottom edge 1.1 cells above it (Pop plan §3). */
  private heldCentre(h: Held, t: Turn): [number, number] {
    return [h.px, h.py - this.cell * (1.1 + t.h / 2)];
  }

  private heldScale(h: Held): number {
    const t = this.sim?.turn(h.slot);
    const from = t ? this.slotScale(h.slot, t) : 0.6;
    const u = Math.min(1, (now() - h.t0) / 120);
    return from + (1 - from) * backOut(u);
  }

  /** The ghost: the nearest anchor the shape fits, keeping the current one within 0.35 cells of slack. */
  private track(): void {
    const h = this.held, sim = this.sim;
    if (!h || !sim) return;
    const t = sim.turn(h.slot);
    if (!t) return;
    const [cx, cy] = this.heldCentre(h, t);
    const ax = (cx - this.bx) / this.cell - t.w / 2, ay = (cy - this.by) / this.cell - t.h / 2;
    const prev = h.ghost;
    if (prev && Math.abs(ax - prev.x) < 0.85 && Math.abs(ay - prev.y) < 0.85 && sim.canPlace(h.slot, prev.x, prev.y)) return;
    let best: { x: number; y: number } | null = null, bd = 0.9 * 0.9;
    const rx = Math.round(ax), ry = Math.round(ay);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx, y = ry + dy;
        const d = (x - ax) ** 2 + (y - ay) ** 2;
        if (d < bd && sim.canPlace(h.slot, x, y)) { bd = d; best = { x, y }; }
      }
    }
    const moved = (best?.x !== prev?.x || best?.y !== prev?.y);
    h.ghost = best;
    h.lines = best ? sim.wouldPop(h.slot, best.x, best.y) : [];
    if (moved && best) this.hooks.audio()?.handle('ghost_fit', { perfect: h.lines.length > 0 });
  }

  private intent(it: PopIntent): boolean {
    const sim = this.sim;
    if (!sim || !sim.apply(it)) return false;
    this.rebuild();
    this.hooks.onChange(sim);
    return true;
  }

  // ---------------------------------------------------------------- frame

  private frame(t: number): void {
    this.raf = requestAnimationFrame(tt => this.frame(tt));
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const sim = this.sim;
    if (!sim) return;
    if (!this.paused && !sim.over && !document.hidden) { this.playMs += dt; this.frames.add(t - this.lastRaw); }
    this.lastRaw = t;
    const juice = this.hooks.juice();
    if (t >= this.holdUntil) this.fx.step(dt);
    // The score counts up to the sim's.
    if (this.shownScore !== sim.score) {
      this.shownScore += Math.max(1, Math.ceil((sim.score - this.shownScore) * Math.min(1, dt / 120)));
      if (this.shownScore > sim.score) this.shownScore = sim.score;
      this.scoreEl.textContent = this.shownScore.toLocaleString('en-US');
    }
    // Run over: "No room!" for a beat, then everything tumbles off the board (or straight on, without juice).
    if (this.overAt >= 0 && !this.overDone) {
      const since = t - this.overAt;
      const tumble = juice && !this.hooks.reducedMotion() && sim.cause === 'noroom';
      if (tumble && since > 600 && !this.bodies.length && this.comps.length) this.startTumble();
      if (since > (sim.cause === 'noroom' ? (tumble ? 1900 : 900) : 250)) {
        this.overDone = true;
        this.hooks.onOver(sim);
      }
    }
    for (const b of this.bodies) { b.vy += 0.0022 * this.k * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt; }
    this.draw(t, juice);
  }

  private startTumble(): void {
    for (const cp of this.comps) {
      const bk = this.art.cells(cp.s, cp.cells, cp.face ? 'dizzy' : null);
      const x = this.bx + cp.x * this.cell - Math.ceil(0.2 * this.art.s), y = this.by + cp.y * this.cell - Math.ceil(0.2 * this.art.s);
      this.bodies.push({ b: bk.canvas, x, y, vx: (Math.random() - 0.5) * 0.25 * this.k, vy: -(0.15 + Math.random() * 0.3) * this.k, rot: 0, vr: (Math.random() - 0.5) * 0.008 });
    }
    this.comps = [];
  }

  private draw(t: number, juice: boolean): void {
    const c = this.c, sim = this.sim!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    const [ox, oy] = juice && !this.hooks.reducedMotion() ? this.fx.offset() : [0, 0];
    c.translate(ox, oy);
    // The board.
    if (this.boardCv) c.drawImage(this.boardCv, this.bx - this.pad, this.by - this.pad);
    const fill = sim.filled / CELLS;
    const mood: Expression = fill >= 0.85 ? 'panic' : fill >= 0.7 ? 'worried' : 'idle';
    const glow = new Set<number>();
    for (const id of this.held?.lines ?? []) for (const cc of LINE_CELLS[id]) glow.add(cc);
    // Pieces and fragments.
    const pad = Math.ceil(0.2 * this.art.s);
    for (const cp of this.comps) {
      const lit = glow.size > 0 && cp.cells.some(([x, y]) => glow.has(y * 9 + x));
      const st = this.stamps.get(cp.piece);
      const age = st === undefined ? 1e9 : t - st;
      const face: Expression | null = cp.face ? (age < 160 ? 'squint' : lit ? 'proud' : mood) : null;
      const bk = this.art.cells(cp.s, cp.cells, face);
      const x = this.bx + cp.x * this.cell - pad, y = this.by + cp.y * this.cell - pad;
      if (juice && age < 220) {
        // The stamp: 15% squash and an elastic bounce back.
        const u = age / 220, sq = 0.15 * Math.exp(-u * 4) * Math.cos(u * 9);
        const w = bk.canvas.width, h = bk.canvas.height;
        c.save();
        c.translate(x + w / 2, y + h);
        c.scale(1 + sq, 1 - sq);
        c.drawImage(bk.canvas, -w / 2, -h);
        c.restore();
      } else c.drawImage(bk.canvas, x, y);
    }
    // Lines about to pop glow white-gold, pulsing at 2 Hz.
    if (glow.size) {
      c.fillStyle = `rgba(255,236,150,${0.28 + 0.18 * Math.sin(t / 80)})`;
      for (const cc of glow) c.fillRect(this.bx + (cc % 9) * this.cell, this.by + ((cc / 9) | 0) * this.cell, this.cell, this.cell);
    }
    // Popping cells: waiting for the wave, swelling, then bursting into confetti.
    this.popping = this.popping.filter(pp => {
      const x = this.bx + (pp.cell % 9) * this.cell, y = this.by + ((pp.cell / 9) | 0) * this.cell;
      const u = t - pp.start;
      if (u >= 70) {
        if (!pp.burst && juice) { const col = shapeColors(pp.s); this.fx.burst(x + this.cell / 2, y + this.cell / 2, this.cell, [col.base, col.light, col.base, '#FFFFFF']); }
        return false;
      }
      const bk = this.art.cells(pp.s, [[0, 0]], juice ? 'proud' : null);
      const sc = u < 0 ? 1 : 1 + 0.2 * (u / 70);
      c.save();
      c.translate(x + this.cell / 2, y + this.cell / 2);
      c.scale(sc, sc);
      c.drawImage(bk.canvas, -this.cell / 2 - pad, -this.cell / 2 - pad);
      if (u >= 0) { c.globalAlpha = Math.min(1, u / 70) * 0.8; c.fillStyle = '#FFFFFF'; c.fillRect(-this.cell / 2, -this.cell / 2, this.cell, this.cell); c.globalAlpha = 1; }
      c.restore();
      return true;
    });
    // The line flash: a white-gold wash over what popped, fading.
    this.flashes = this.flashes.filter(f => {
      const u = (t - f.t0) / 420;
      if (u >= 1) return false;
      c.fillStyle = `rgba(255,240,170,${0.45 * (1 - u)})`;
      for (const cc of f.cells) c.fillRect(this.bx + (cc % 9) * this.cell, this.by + ((cc / 9) | 0) * this.cell, this.cell, this.cell);
      return true;
    });
    // The ghost.
    const h = this.held;
    if (h?.ghost) {
      const sl = sim.slot(h.slot)!;
      const bk = this.art.shape(sl.s, sl.q, 1, null);
      c.globalAlpha = 0.38;
      c.drawImage(bk.canvas, this.bx + h.ghost.x * this.cell - pad, this.by + h.ghost.y * this.cell - pad);
      c.globalAlpha = 1;
      const tt = sim.turn(h.slot)!;
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = Math.max(2, this.cell * 0.07);
      for (const [x, y] of tt.cells) c.strokeRect(this.bx + (h.ghost.x + x) * this.cell + c.lineWidth, this.by + (h.ghost.y + y) * this.cell + c.lineWidth, this.cell - c.lineWidth * 2, this.cell - c.lineWidth * 2);
    }
    // Tumbling blocks after No room.
    for (const b of this.bodies) {
      c.save();
      c.translate(b.x + b.b.width / 2, b.y + b.b.height / 2);
      c.rotate(b.rot);
      c.drawImage(b.b, -b.b.width / 2, -b.b.height / 2);
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // The tray, the next tray and the bag (never shaken).
    this.drawSlots(t, juice);
    c.translate(ox, oy);
    this.fx.draw(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // The held shape, over everything.
    if (h) {
      const sl = sim.slot(h.slot);
      const tt = sim.turn(h.slot);
      if (sl && tt) {
        const sc = this.heldScale(h);
        const bk = this.art.shape(sl.s, sl.q, 1, juice ? 'falling' : 'idle');
        const [cx, cy] = this.heldCentre(h, tt);
        c.save();
        c.translate(cx, cy);
        c.scale(sc, sc);
        c.drawImage(bk.canvas, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
        c.restore();
      }
    }
  }

  private drawSlots(t: number, juice: boolean): void {
    const c = this.c, sim = this.sim!;
    // The bag's box.
    if (this.bagCv) c.drawImage(this.bagCv[sim.bagUsed && !sim.bag ? 1 : 0], this.bag.x, this.bag.y);
    for (let i = 0; i <= BAG; i++) {
      const sl = sim.slot(i);
      if (!sl || this.held?.slot === i) continue;
      const tt = sim.turn(i)!;
      const fits = sim.fitsAnywhere(i);
      const rest = this.slotScale(i, tt);
      let [cx, cy] = this.slotCentre(i);
      let sc = rest;
      const sp = this.springs.find(s => s.slot === i);
      if (sp) {
        const u = Math.min(1, (t - sp.t0) / 220);
        const e = backOut(u);
        cx = sp.x + (cx - sp.x) * e; cy = sp.y + (cy - sp.y) * e; sc = sp.scale + (rest - sp.scale) * e;
        if (u >= 1) this.springs = this.springs.filter(s => s !== sp);
      } else if (i !== BAG && juice && !this.hooks.reducedMotion()) {
        // A new tray flips in, one shape after another, 60 ms apart.
        const u = (t - this.trayIn - i * 60) / 240;
        if (u < 1) sc = rest * (u <= 0 ? 0 : backOut(u));
      }
      if (sc <= 0.01) continue;
      const face: Expression = !fits ? 'worried' : sp ? 'dizzy' : 'idle';
      const bk = this.art.shape(sl.s, sl.q, 1, face);
      const img = fits ? bk.canvas : this.art.grey(bk.canvas);
      c.save();
      c.translate(cx, cy);
      c.scale(sc, sc);
      c.drawImage(img, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
      c.restore();
    }
    // The next tray: small silhouettes, so every tray is seen one tray early.
    const n = sim.next;
    const w = this.nextBox.w / 3;
    n.forEach((sl: Slot, i) => {
      const sh = POP_SHAPES[sl.s], tt = sh.turns[sh.byQ[sl.q & 3]];
      const sc = Math.min(0.3, (w * 0.8) / (tt.w * this.cell), (this.nextBox.h * 0.8) / (tt.h * this.cell));
      const bk = this.art.shape(sl.s, sl.q, 1, null);
      c.save();
      c.globalAlpha = 0.85;
      c.translate(this.nextBox.x + (i + 0.5) * w, this.nextBox.y + this.nextBox.h / 2);
      c.scale(sc, sc);
      c.drawImage(bk.canvas, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
      c.restore();
    });
    c.globalAlpha = 1;
  }
}

/** The safe-area insets in CSS px (notches, home bars), read from a probe. */
function safeArea(): { top: number; bottom: number } {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  p.remove();
  return out;
}
