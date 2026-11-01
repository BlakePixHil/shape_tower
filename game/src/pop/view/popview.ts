// Blockling Pop's play screen (Pop plan §8, §9): the board on the biome's sky, the score on top, the tray
// under the board and the next tray and the bag along the bottom. Drag a tray shape: it grows to board
// size and lifts above the finger, the ghost snaps to the nearest cell it fits with some hysteresis,
// the lines it would complete glow, and letting go stamps it in. The sim is final the instant a shape
// lands; everything here plays on top and never blocks the next pick-up.
//
// Canvas 2D over the shell's Phaser canvas (which sleeps while Pop is up), with a DOM top bar from the
// art UI kit. Board pieces sit flush in their cells. Milestone 2's juice (Pop plan §8): the stamp and
// neighbours' jiggle, hitstop, the pop wave, cells swelling and bursting, faces flying up to the
// checkpoint pill, the shockwave ring and zoom punch, the combo chip's glow, sparks and rainbow, the
// All Clear (slow-mo, board bounce, cannons, the tray jumping), the filling board's red edge, and the
// run over's slow-mo and tumble. Effects run on their own clock (`vt`), so slow-mo never touches input.
// Milestone 3 (Pop plan §7, §8): power bubbles on the board, the two power slots and Second Wind at the
// bottom left (the tower's two taps), aiming Sweep and Meteor on the board, Spin's taps on the tray,
// each power's animation, and No room waiting with End run while a power could help.

import { BIOMES, INK, bakePostcard, cellsPose, silhouette, uiIconUrl, type Expression } from '@art/index.ts';
import { CELLS, LINE_CELLS } from '../sim/board.ts';
import { BAG, type PopEvent, type PopIntent, type PopPower, type PopSim } from '../sim/pop.ts';
import { POP_POWER_COLORS, POP_POWER_NAMES, POP_POWER_TAGS, bakePopBubble, bakePopIcon, drawPopIcon, popIconUrl } from './icons.ts';
import { POP_KEYS, POP_SHAPES, type Turn } from '../sim/shapes.ts';
import type { Slot } from '../sim/deal.ts';
import { FLUSH, PopArt, bakeBagBox, bakeBoard, shapeColors } from './draw.ts';
import { PopFx } from './fx.ts';
import { PopFrames } from '../save.ts';

/**
 * The calls Pop makes into Sound's director (a subset of AudioDirector). Once Sound's Pop score lands, the
 * director has `setMode`: the view switches it to 'pop' and sends Pop's own events instead of the tower's
 * stand-ins (Pop plan §10):
 *   pop_run_start {biome, cp, fill} · pop_pickup {shape} · pop_ghost {lines} · pop_would_pop {count, 0 = stop}
 *   pop_drop_back · pop_place {shape, cells, combo}
 *   pop_lines {count, combo, cells, lines: cells per line, hitstop ms} (Sound plays the glissando from it:
 *     the first note at once, then 39 ms steps from the end of the hitstop, like the wave)
 *   pop_combo {combo} · pop_combo_end {combo} · pop_all_clear · pop_checkpoint {n} · biome_entered {id}
 *   pop_tray {n} · pop_bag · pop_cant_fit {slot} · pop_fill {fill 0-1, after every move}
 *   pop_no_room {waiting: a power could help, so the run waits} · pop_run_over {cause} (as the run ends: the tumble starts)
 * Milestone 3's powers (kinds: undo, spin, sweep, meteor, fresh):
 *   pop_bubble {kind} (lands) · pop_bubble_got {kind} (covered: into a slot) · pop_bubble_gone (expired)
 *   pop_power_got {kind, why: big | clear | cp | head} · pop_power {kind} (used; Meteor's arrives as the
 *   target is set, its impact 260 ms later as pop_meteor_hit) · pop_power_refused · pop_aim {kind} · pop_aim_cancel
 *   pop_spin (a tap turns a shape) · pop_wind_ready {why: cp} · pop_wind_armed (first tap) · pop_second_wind
 * Biome ids are the tower's, 1-based (1 Meadow … 10 Deep Cosmos); the sim's are 0-based.
 */
export interface PopAudio {
  handle(name: string, payload?: Record<string, unknown>): void;
  ui(kind: 'tap' | 'tap2' | 'back' | 'open' | 'close' | 'error' | 'start'): void;
  setMode?(mode: 'pop' | 'tower'): void;
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
  /**
   * The first-run guide's tips, each shown once ever (Pop plan §14): true means show it now (and it counts
   * as seen). Ids: intro (the card), bag, bubble, combo, next.
   */
  coach?(id: string): boolean;
  /** Pop's settings (Pop plan §14); read every frame, so a change in Settings shows straight away. */
  settings?(): PopViewSettings;
}

const CSS = `
.pop-root { position: fixed; inset: 0; z-index: 6; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; background: #A9DEFF; }
.pop-bg { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity 1.2s ease; }
.pop-cv { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.pop-top { position: absolute; left: 0; right: 0; top: 0; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 0; display: grid; grid-template-columns: 1fr auto 1fr; column-gap: 8px; align-items: start; pointer-events: none; }
.pop-top > .ui-btn { justify-self: start; }
.pop-top .ui-btn { pointer-events: auto; }
/* The pause button matches the tower's (hud.ts .st-iconbtn): 44 px, filled paper, ink border and shadow. */
.pop-top > .ui-btn.icon { border-radius: 14px; }
.pop-score { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pop-score b { font: 700 36px/1 var(--display, Fredoka, sans-serif); color: #fff; -webkit-text-stroke: 7px var(--ink, ${INK}); paint-order: stroke fill; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
.pop-score span { font: 800 12px/1 var(--body, Nunito, sans-serif); color: var(--ink, ${INK}); background: rgba(255,247,232,0.94); border: 2px solid var(--ink, ${INK}); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
/* The area pill: the count big on top, the area's name small under it, and the pill filling with gold as
   the checkpoint nears. It keeps to its own column (the name trims before anything leaves the pill). */
.pop-cp { --p: 0%; justify-self: end; box-sizing: border-box; display: flex; align-items: center; gap: 5px; margin-top: 4px; padding: 4px 10px 4px 6px; color: var(--ink, ${INK}); border: 2px solid var(--ink, ${INK}); border-radius: 14px; background: linear-gradient(90deg, rgba(255,214,102,0.95) var(--p), rgba(255,247,232,0.94) var(--p)); }
.pop-cp img { width: 20px; height: 20px; flex: none; }
.pop-cp > div { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.pop-cp b { font: 700 16px/1 var(--display, Fredoka, sans-serif); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pop-cp small { white-space: nowrap; font: 800 9px/1.1 var(--body, Nunito, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.8; }
.pop-combo { position: absolute; display: flex; align-items: center; gap: 4px; font: 700 18px/1 var(--display, Fredoka, sans-serif); color: #fff; background: #FF8A3D; border: 3px solid var(--ink, ${INK}); border-radius: 999px; padding: 3px 9px 3px 10px; box-shadow: 0 3px 0 var(--ink, ${INK}); transform: translate(-100%, -50%) scale(0); transform-origin: 100% 50%; transition: transform 180ms cubic-bezier(.3,1.6,.5,1); pointer-events: none; -webkit-text-stroke: 4px var(--ink, ${INK}); paint-order: stroke fill; }
.pop-combo.on { transform: translate(-100%, -50%) scale(1); }
.pop-combo i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #FFE08A; border: 2px solid var(--ink, ${INK}); }
.pop-combo i.off { background: rgba(255,255,255,0.35); }
.pop-combo.warm { box-shadow: 0 3px 0 var(--ink, ${INK}), 0 0 16px 5px rgba(255,170,60,0.85); }
.pop-combo.sparks::after { content: ''; position: absolute; inset: -11px -7px; border-radius: 999px; pointer-events: none;
  background: radial-gradient(circle at 50% 0, #FFF6B0 0 3px, transparent 4px), radial-gradient(circle at 50% 100%, #FFF6B0 0 3px, transparent 4px), radial-gradient(circle at 0 50%, #FFFFFF 0 2px, transparent 3px), radial-gradient(circle at 100% 50%, #FFFFFF 0 2px, transparent 3px);
  animation: pop-orbit 1.1s linear infinite; }
.pop-combo.rainbow { border-color: transparent; background: linear-gradient(#FF8A3D, #FF8A3D) padding-box, linear-gradient(90deg, #FF5E7E, #FFB547, #FFE45E, #6EE7A8, #5EC8FF, #B28BFF, #FF5E7E) 0 0 / 200% 100% border-box; animation: pop-rainbow 1.4s linear infinite; }
.pop-combo.tick { animation: pop-tick 220ms ease-out; }
.pop-combo.rainbow.tick { animation: pop-tick 220ms ease-out, pop-rainbow 1.4s linear infinite; }
@keyframes pop-orbit { to { transform: rotate(360deg); } }
@keyframes pop-rainbow { from { background-position: 0 0, 0 0; } to { background-position: 0 0, 200% 0; } }
@keyframes pop-tick { 0% { scale: 1; } 40% { scale: 1.25; } 100% { scale: 1; } }
.pop-score b.bump { animation: pop-bump 240ms cubic-bezier(.3,1.6,.5,1); }
@keyframes pop-bump { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 100% { transform: scale(1); } }
.pop-cp.bump { animation: pop-bump 240ms cubic-bezier(.3,1.6,.5,1); }
.pop-bg { transform-origin: 50% 100%; transition: opacity 1.2s ease, transform 1.4s cubic-bezier(.4,0,.2,1); }
.pop-label { position: absolute; font: 800 11px/1 var(--body, Nunito, sans-serif); letter-spacing: 0.08em; color: var(--ink, ${INK}); opacity: 0.75; transform: translateX(-50%); pointer-events: none; text-transform: uppercase; }
.pop-pw { position: absolute; display: flex; gap: 6px; align-items: center; }
.pop-pw .st-btn { pointer-events: auto; padding: 0; display: grid; place-items: center; position: relative; touch-action: manipulation; }
.pop-pw .st-slot { width: var(--ps, 46px); height: var(--ps, 46px); border-radius: 13px; }
.pop-pw .st-wind { width: var(--ws, 52px); height: var(--ws, 52px); }
.pop-pw .st-slot.empty { background: rgba(255,247,232,0.35); border-style: dashed; box-shadow: none; pointer-events: none; }
.pop-pw .st-slot.off:not(.empty) { filter: saturate(0.4) brightness(0.95); }
.pop-pw .st-slot.aim { box-shadow: 0 4px 0 var(--ink, ${INK}), 0 0 0 4px #FFFFFF, 0 0 18px 8px rgba(255,224,138,0.95); transform: translateY(-3px); }
.pop-pw .st-slot.glow, .pop-pw .st-wind.glow { animation: pop-pw-glow 900ms ease-in-out infinite; }
.pop-pw .st-tag { font-size: 9px; bottom: -8px; }
.pop-pw .st-slot.pop, .pop-pw .st-wind.pop { animation: pop-bump 320ms cubic-bezier(.3,1.6,.5,1); }
.pop-pw .st-slot.nope, .pop-pw .st-wind.nope { animation: pop-nope 300ms; }
@keyframes pop-pw-glow { 0%, 100% { box-shadow: 0 4px 0 var(--ink, ${INK}), 0 0 0 0 rgba(255,224,138,0); } 50% { box-shadow: 0 4px 0 var(--ink, ${INK}), 0 0 0 6px rgba(255,224,138,0.9), 0 0 20px 8px rgba(255,224,138,0.6); transform: scale(1.06); } }
@keyframes pop-nope { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
.pop-end { position: absolute; left: 50%; transform: translate(-50%, -50%); display: none; pointer-events: auto; font-size: 18px !important; padding: 8px 20px !important; background: #FFC23D !important; }
.pop-end.show { display: block; animation: pop-bump 320ms cubic-bezier(.3,1.6,.5,1); }
.pop-hint { position: absolute; left: 50%; transform: translate(-50%, -50%); font: 800 14px/1.1 var(--body, Nunito, sans-serif); color: var(--ink, ${INK}); background: rgba(255,247,232,0.96); border: 2px solid var(--ink, ${INK}); border-radius: 999px; padding: 6px 12px; pointer-events: none; opacity: 0; transition: opacity 200ms; white-space: nowrap; }
.pop-hint.show { opacity: 1; }
.pop-coach { position: absolute; z-index: 3; max-width: 220px; font: 800 15px/1.2 var(--body, Nunito, sans-serif); color: var(--ink, ${INK}); background: #FFF7E8; border: 3px solid var(--ink, ${INK}); border-radius: 14px; padding: 7px 12px; box-shadow: 0 3px 0 var(--ink, ${INK}); text-align: center; pointer-events: none; opacity: 0; transition: opacity 180ms; }
.pop-coach.show { opacity: 1; animation: pop-bump 320ms cubic-bezier(.3,1.6,.5,1); }
.pop-coach::after { content: ''; position: absolute; left: var(--ax, 50%); width: 12px; height: 12px; background: #FFF7E8; border: 3px solid var(--ink, ${INK}); border-top: 0; border-left: 0; transform: translateX(-50%) rotate(45deg); bottom: -9px; }
.pop-coach.below::after { bottom: auto; top: -9px; transform: translateX(-50%) rotate(225deg); }
.pop-intro { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(34,24,58,0.45); pointer-events: auto; }
.pop-intro .pop-intro-card { max-width: 320px; background: #FFF7E8; border: 3px solid var(--ink, ${INK}); border-radius: 18px; box-shadow: 0 5px 0 var(--ink, ${INK}); padding: 18px 18px 16px; text-align: center; animation: pop-bump 360ms cubic-bezier(.3,1.6,.5,1); }
.pop-intro h2 { margin: 0 0 8px; font: 700 26px/1.1 var(--display, Fredoka, sans-serif); color: var(--ink, ${INK}); }
.pop-intro p { margin: 0 0 14px; font: 700 16px/1.35 var(--body, Nunito, sans-serif); color: var(--ink, ${INK}); }
.pop-intro .st-btn { font-size: 20px !important; padding: 10px 26px !important; background: #FFC23D !important; }
`;

interface Comp { s: number; piece: number; cells: [number, number][]; x: number; y: number; face: boolean; size: number }
interface Held { slot: number; px: number; py: number; t0: number; ghost: { x: number; y: number } | null; lines: number[]; id: number; tap?: boolean }

/** Pop's settings as the view reads them (view/settings.ts popViewFor). */
export interface PopViewSettings {
  /** The held shape's bottom edge above the finger, in cells; null: centred on the finger. */
  lift: number | null;
  /** Tap mode: tap a shape, tap the board to aim, tap the ghost to place. */
  tap: boolean;
  /** The bottom row mirrored: the bag on the left, the power slots on the right. */
  left: boolean;
  /** Glow the lines a drop would pop. */
  preview: boolean;
  /** Stronger grid lines and square tints. */
  grid: boolean;
}
const VIEW_DEFAULTS: PopViewSettings = { lift: 1.1, tap: false, left: false, preview: true, grid: false };
interface Spring { slot: number; x: number; y: number; scale: number; t0: number }
interface Popping { cell: number; s: number; start: number; burst: boolean; smash?: boolean }
/** A block flying off the board (the run over's tumble, a Sweep, Second Wind's gust); it waits until `at`. */
interface Body { b: HTMLCanvasElement; x: number; y: number; vx: number; vy: number; rot: number; vr: number; at?: number; g?: number }
/** Aiming Sweep (a row or column) or Meteor (a 3×3 block) on the board. */
interface Aim { slot: number; kind: 'sweep' | 'meteor'; target: number; line: number | null; press: { x: number; y: number; cell: number; moved: boolean; onTarget: boolean } | null }
/** A power's icon flying from the board into its slot. */
interface IconFly { kind: PopPower; x0: number; y0: number; slot: number; t0: number }
/** A shape leaving the tray (Fresh Deal, Second Wind) as the new ones flip in. */
interface Leaving { s: number; q: number; x: number; y: number; scale: number; t0: number }
/** A popped Blockling's face flying up to the checkpoint pill on an arc. */
interface Flyer { s: number; x0: number; y0: number; t0: number; dur: number; lift: number }

const now = () => performance.now();
const backOut = (t: number) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const BANNERS = ['', '', 'Double!', 'Triple!', 'TOWERING!', 'SKY-HIGH!'];
/** The guide's first pop: party colours. */
const CONFETTI = ['#FFE08A', '#FF8FA3', '#5EC8FF', '#A6F4C5', '#FFFFFF', '#FF8A3D'];

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
  private topEl: HTMLElement;
  private pillEl: HTMLElement;
  private cpEl: HTMLElement;
  private areaEl: HTMLElement;
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
  private flashes: { cells: number[]; t0: number; color?: string }[] = [];
  private stamps = new Map<number, number>(); // piece → when it landed
  /** Rules 3 merges: cells keep their old look until the pop around them has played (cell → shape, piece, new piece). */
  private merging = new Map<number, { s: number; piece: number; now: number }>();
  private mergeAt = 0;
  private trayIn = -1e9;
  private shownScore = 0;
  private pointer = -1;
  private bodies: Body[] = [];
  private overAt = -1;
  private overDone = false;
  private holdUntil = 0; // hitstop: effects wait until then
  private seenTray = 0;
  /** The effects clock (ms): real time, slowed for the All Clear and the run over. */
  private vt = 0;
  private slowUntil = -1;
  private slowK = 1;
  /** Zoom punch: when and how much (1.02 for a line up to 1.1 for an All Clear). */
  private punch = { t0: -1e9, z: 0 };
  private bounceAt = -1e9;
  private hopAt = -1e9;
  private jiggles = new Map<number, number>(); // piece → when a neighbour landed
  private flyers: Flyer[] = [];
  private lean = 0;
  private lastMove = { x: 0, t: 0, vx: 0 };
  private trailAt = 0;
  private lastCombo = 0;
  private fitsWas = [true, true, true, true];
  private wouldWas = 0;
  // milestone 3: powers
  private pwEl: HTMLDivElement;
  private slotBtns: HTMLButtonElement[];
  private windBtn: HTMLButtonElement;
  private endBtn: HTMLButtonElement;
  private hintEl: HTMLDivElement;
  private pwKey = '';
  private aim: Aim | null = null;
  private pending: { slot: number; x: number; y: number; id: number } | null = null;
  private windArmedUntil = 0;
  private windSpentAt = -1e9;
  private lastWind = '';
  private bubbleAt = new Map<number, number>(); // bubble cell → when it landed
  private gone: { cell: number; kind: PopPower; t0: number }[] = [];
  private spinAt = [-1e9, -1e9, -1e9, -1e9];
  private meteors: { cell: number; t0: number; hit: boolean; cells: number[] }[] = [];
  private sweeps: { line: number; t0: number }[] = [];
  private gustAt = -1e9;
  private rewindAt = -1e9;
  private iconFlys: IconFly[] = [];
  private leaving: Leaving[] = [];
  // the first-run guide (Pop plan §14)
  private coachEl: HTMLDivElement;
  private introEl: HTMLDivElement | null = null;
  private coachUntil = 0;
  private coachTimer = 0;
  /** The hand showing the first drag: when it started, or -1 once it's done. */
  private handAt = -1;
  /** Pop's settings this frame, and the layout they were laid out with (grid and hand). */
  private vs: PopViewSettings = VIEW_DEFAULTS;
  private laidFor = '';

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
    // .ui gives the top bar Art's kit colours and fonts (--paper, --ink, --display), which .ui-btn needs:
    // without them the pause button had no fill (Blake, 2026-11-01).
    top.className = 'pop-top ui';
    top.innerHTML = `<button type="button" class="ui-btn icon sm" data-act="pause" aria-label="Pause"><img alt="" src="${uiIconUrl('pause', 24)}"></button>
      <div class="pop-score"><b>0</b><span>Best 0</span></div>
      <div class="pop-cp"><img alt="" src="${uiIconUrl('flag', 20)}"><div><b>0/5</b><small>Meadow</small></div></div>`;
    this.scoreEl = top.querySelector('.pop-score b')!;
    this.bestEl = top.querySelector('.pop-score span')!;
    this.topEl = top;
    this.pillEl = top.querySelector('.pop-cp')!;
    this.cpEl = top.querySelector('.pop-cp b')!;
    this.areaEl = top.querySelector('.pop-cp small')!;
    this.comboEl = document.createElement('div');
    this.comboEl.className = 'pop-combo';
    this.nextLabel = document.createElement('div');
    this.nextLabel.className = 'pop-label';
    this.nextLabel.textContent = 'Next';
    this.bagLabel = document.createElement('div');
    this.bagLabel.className = 'pop-label';
    this.bagLabel.textContent = 'Bag';
    // The power slots and Second Wind (Pop plan §8: bottom left, where thumbs rest), End run for No room, and a hint line.
    this.pwEl = document.createElement('div');
    this.pwEl.className = 'pop-pw';
    this.pwEl.innerHTML = `<button type="button" class="st-btn st-slot empty" aria-label="Empty power-up slot"></button>
      <button type="button" class="st-btn st-slot empty" aria-label="Empty power-up slot"></button>
      <button type="button" class="st-btn st-slot st-wind earn" aria-label="Second Wind"><img class="st-icon" alt=""><span class="st-tag">CP 2</span></button>`;
    const btns = [...this.pwEl.querySelectorAll<HTMLButtonElement>('button')];
    this.slotBtns = btns.slice(0, 2);
    this.windBtn = btns[2];
    this.slotBtns.forEach((b, i) => { b.onclick = () => this.tapPower(i); });
    this.windBtn.onclick = () => this.tapWind();
    this.endBtn = document.createElement('button');
    this.endBtn.type = 'button';
    this.endBtn.className = 'st-btn pop-end';
    this.endBtn.textContent = 'End run';
    this.endBtn.onclick = () => { if (this.sim?.stuck) this.intent({ t: 'end' }); };
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'pop-hint';
    this.coachEl = document.createElement('div');
    this.coachEl.className = 'pop-coach';
    this.coachEl.setAttribute('role', 'status');
    this.coachEl.style.display = 'none';
    this.root.append(this.cv, top, this.comboEl, this.nextLabel, this.bagLabel, this.pwEl, this.endBtn, this.hintEl, this.coachEl);
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
    this.merging.clear();
    this.bodies = [];
    this.overAt = -1;
    this.overDone = false;
    this.flyers = [];
    this.jiggles.clear();
    this.slowUntil = -1;
    this.punch = { t0: -1e9, z: 0 };
    this.bounceAt = -1e9;
    this.hopAt = -1e9;
    this.lean = 0;
    this.lastCombo = sim.combo;
    this.seenTray = sim.trays;
    this.shownScore = sim.score;
    this.aim = null;
    this.pending = null;
    this.windArmedUntil = 0;
    this.windSpentAt = -1e9;
    this.lastWind = sim.wind;
    this.bubbleAt.clear();
    for (const b of sim.bubbles) this.bubbleAt.set(b.cell, -1e9);
    this.gone = [];
    this.spinAt = [-1e9, -1e9, -1e9, -1e9];
    this.meteors = [];
    this.sweeps = [];
    this.gustAt = -1e9;
    this.rewindAt = -1e9;
    this.iconFlys = [];
    this.leaving = [];
    this.pwKey = '';
    this.hint('');
    this.coachOff();
    this.introEl?.remove();
    this.introEl = null;
    this.handAt = -1;
    this.vs = this.hooks.settings?.() ?? VIEW_DEFAULTS;
    this.root.style.display = '';
    this.layout();
    this.fx.clear();
    this.rebuild();
    this.trayIn = this.vt;
    sim.sink = { emit: (name, payload) => this.onEvent({ name, payload }) };
    this.hud();
    this.hooks.audio()?.setMode?.('pop');
    this.say('pop_run_start', { biome: sim.biome + 1, cp: sim.cp, fill: sim.filled / CELLS }, a => a.handle('run_start', {}));
    this.fitsWas = [true, true, true, true];
    this.wouldWas = 0;
    // A first Pop run: one card, then the hand shows the first drag (Pop plan §14).
    if (sim.guide && sim.placements === 0 && this.hooks.coach?.('intro')) this.intro();
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
    this.aim = null;
    this.pending = null;
    this.hint('');
    this.coachOff();
    this.introEl?.remove();
    this.introEl = null;
    this.hooks.audio()?.setMode?.('tower');
  }

  setPaused(on: boolean): void {
    this.paused = on;
    if (on && this.held) this.cancelHeld();
    if (on) { this.pending = null; if (this.aim) this.aim.press = null; this.pointer = -1; }
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
    const left = this.vs.left;
    this.laidFor = `${left}|${this.vs.grid}`;
    const bagEdge = Math.max(16 * k, (Wc / 3 - cellC * 1.7) / 2 * k);
    this.bag = { x: left ? bagEdge : this.W - bagS - bagEdge, y: botY, s: bagS };
    // The bottom row: the two power slots and Second Wind on the left, the next tray between them and the bag.
    // Left-handed mirrors it: the bag on the left, the powers on the right (Pop plan §14).
    const psC = Math.round(cellC * 1.2), wsC = Math.round(cellC * 1.34), gapC = 6;
    const groupC = psC * 2 + wsC + gapC * 2;
    const edgeC = Math.max(12, (Wc / 3 - groupC) / 2);
    const leftC = left ? Wc - edgeC - groupC : edgeC;
    this.pwEl.style.setProperty('--ps', `${psC}px`);
    this.pwEl.style.setProperty('--ws', `${wsC}px`);
    this.pwEl.style.left = `${leftC}px`;
    this.pwEl.style.top = `${(botY + bagS / 2) / k - wsC / 2}px`;
    const nx0 = left ? this.bag.x + bagS + 8 * k : (leftC + groupC + 8) * k, nx1 = left ? (leftC - 8) * k : this.bag.x - 8 * k;
    const nw = Math.max(cellC * 2.4 * k, Math.min(cellC * 5.2 * k, nx1 - nx0));
    this.nextBox = { x: (nx0 + nx1) / 2 - nw / 2, y: botY, w: nw, h: bagS };
    this.endBtn.style.top = `${(this.trayY + this.trayH / 2) / k}px`;
    this.hintEl.style.top = `${Math.max(topC + 14, byC - padC - 22)}px`;
    // The top bar (pause, score, the area pill) keeps inside the board frame's left and right edges.
    const frameC = Math.max(12, Math.floor((Wc - cellC * 9) / 2 - padC));
    this.topEl.style.paddingLeft = this.topEl.style.paddingRight = `${frameC}px`;
    this.art = new PopArt(this.cell, this.sim?.biome ?? 0);
    this.boardCv = bakeBoard(this.cell, this.pad, this.vs.grid);
    this.bagCv = [bakeBagBox(bagS, false), bakeBagBox(bagS, true)];
    this.fx = new PopFx(k);
    this.comboEl.style.left = `${(this.bx + this.cell * 9 + this.pad * 0.6) / k}px`;
    // The combo chip sits just above the board's top-right corner, clear of its cells.
    this.comboEl.style.top = `${Math.max(topC - 2, byC - padC - 20)}px`;
    this.nextLabel.style.left = `${(this.nextBox.x + this.nextBox.w / 2) / k}px`;
    this.nextLabel.style.top = `${(this.nextBox.y + this.nextBox.h + 4 * k) / k}px`;
    this.bagLabel.style.left = `${(this.bag.x + this.bag.s / 2) / k}px`;
    this.bagLabel.style.top = `${(this.bag.y + this.bag.s + 4 * k) / k}px`;
    this.backdrop(true);
    this.skyStep();
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
    // A merge still waiting for its pop to play shows the split pieces it was made from.
    const held = (c: number) => { const m = this.merging.get(c); return m && sim.cellPiece[c] === m.now ? m : null; };
    const shapeAt = (c: number) => held(c)?.s ?? sim.cellShape[c];
    const pieceAt = (c: number) => held(c)?.piece ?? sim.cellPiece[c];
    for (let i = 0; i < CELLS; i++) {
      if (seen[i] || sim.cellShape[i] < 0) continue;
      const piece = pieceAt(i), s = shapeAt(i);
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
          if (!seen[n] && sim.cellShape[n] >= 0 && pieceAt(n) === piece && shapeAt(n) === s) { seen[n] = 1; stack.push(n); }
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
    const calm = this.hooks.reducedMotion();
    const t = this.vt;
    switch (e.name) {
      case 'pop_placed': {
        this.rebuild();
        this.stamps.set(p.piece as number, t);
        this.say('pop_place', { shape: p.shape, cells: (p.cells as number[]).length, combo: this.sim!.combo }, au => {
          au.handle('piece_landed', { impact: 0.35, shape: p.shape });
          au.handle('piece_settled', { grade: 'clean' });
        });
        if (juice) {
          const cells = p.cells as number[];
          const xs = cells.map(c => c % 9), ys = cells.map(c => (c / 9) | 0);
          const y1 = this.by + (Math.max(...ys) + 1) * this.cell;
          this.fx.dust(this.bx + Math.min(...xs) * this.cell, y1, this.cell);
          this.fx.dust(this.bx + (Math.max(...xs) + 1) * this.cell, y1, this.cell);
          // Its neighbours jiggle.
          const sim = this.sim!, near = new Set<number>();
          for (const c of cells) {
            const x = c % 9, y = (c / 9) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx > 8 || ny > 8) continue;
              const pc = sim.cellPiece[ny * 9 + nx];
              if (pc !== p.piece && sim.cellShape[ny * 9 + nx] >= 0) near.add(pc);
            }
          }
          for (const pc of near) this.jiggles.set(pc, t);
        }
        break;
      }
      case 'pop_lines': {
        const n = p.count as number;
        // The guide's first pop gets extra confetti (Pop plan §14).
        if (this.sim!.guide && this.sim!.lines === n && juice && !calm) {
          const fy = this.by + this.cell * 9;
          this.fx.cannon(this.bx - this.cell * 0.3, fy, -Math.PI * 0.32, this.cell, CONFETTI, 46);
          this.fx.cannon(this.bx + this.cell * 9.3, fy, -Math.PI * 0.68, this.cell, CONFETTI, 46);
        }
        const order = p.order as number[][];
        const cells = p.cells as number[], shapes = p.shapes as number[];
        const stop = juice ? (n >= 3 ? 80 : n === 2 ? 60 : 40) : 0;
        const step = juice ? 39 : 0;
        this.holdUntil = t + stop;
        const start = new Map<number, number>();
        order.forEach(line => line.forEach((c, i) => { const d = i * step; if (!start.has(c) || d < start.get(c)!) start.set(c, d); }));
        cells.forEach((c, i) => this.popping.push({ cell: c, s: shapes[i], start: t + stop + (start.get(c) ?? 0), burst: false }));
        this.flashes.push({ cells, t0: t });
        // Points fly up from the middle of what popped.
        const cx = cells.reduce((s, c) => s + (c % 9), 0) / cells.length, cy = cells.reduce((s, c) => s + ((c / 9) | 0), 0) / cells.length;
        const px = this.bx + (cx + 0.5) * this.cell, py = this.by + (cy + 0.5) * this.cell;
        this.fx.text(`+${(p.points as number).toLocaleString('en-US')}`, px, py, { size: 26, fill: '#FFE08A', rise: 50, life: 1000 });
        if (juice) {
          if (n >= 2) this.fx.text(BANNERS[Math.min(5, n)], this.bx + this.cell * 4.5, this.by + this.cell * 3.2, { size: n >= 4 ? 46 : 40, fill: n >= 4 ? '#FF8A3D' : '#FFFFFF', rise: 16, life: 1200, pop: true });
          if (!calm) {
            this.fx.kick(n >= 3 ? 0.55 : n === 2 ? 0.4 : 0.25);
            this.punch = { t0: t + stop, z: Math.min(0.08, 0.02 * n) };
          }
          // A soft shockwave from each line's middle once it has emptied (about 400 ms in).
          for (const line of order) {
            const mid = line[(line.length / 2) | 0];
            const lx = this.bx + ((mid % 9) + 0.5) * this.cell, ly = this.by + (((mid / 9) | 0) + 0.5) * this.cell;
            this.fx.ring(lx, ly, this.cell * 3.2, { delay: stop + step * line.length, life: 460, width: this.cell * 0.22 });
          }
          // Faces fly up to the checkpoint pill: one per piece that popped, six at most.
          const seen = new Set<number>();
          const pieces = p.pieces as number[] | undefined;
          cells.forEach((c, i) => {
            const key = pieces ? pieces[i] : c;
            if (seen.has(key) || seen.size >= 6) return;
            seen.add(key);
            this.flyers.push({ s: shapes[i], x0: this.bx + ((c % 9) + 0.5) * this.cell, y0: this.by + (((c / 9) | 0) + 0.5) * this.cell, t0: t + stop + (start.get(c) ?? 0) + 60, dur: 620 + seen.size * 40, lift: this.cell * (1.6 + Math.random()) });
          });
        }
        this.say('pop_lines', { count: n, combo: p.combo, cells: cells.length, lines: order.map(l => l.length), hitstop: stop }, au => {
          au.handle('row_solid', { count: n });
          if ((p.combo as number) >= 3) au.handle('perfect', { combo: p.combo });
        });
        break;
      }
      case 'pop_merge': {
        // Split pieces snap together into whole shapes (rules 3, Blake's playtest 2026-11-01): once the
        // pop around them has played, they take the new shape's look with a stamp and a white flash.
        const merges = p.merges as { cells: number[]; piece: number; wasShape: number[]; wasPiece: number[] }[];
        const at = t + (juice ? 360 : 0);
        for (const m of merges) {
          m.cells.forEach((c, i) => this.merging.set(c, { s: m.wasShape[i], piece: m.wasPiece[i], now: m.piece }));
          this.stamps.set(m.piece, at);
          if (juice) this.flashes.push({ cells: m.cells, t0: at, color: '255,255,255' });
        }
        this.mergeAt = at;
        this.say('pop_merge', { count: merges.length, cells: merges.reduce((a, m) => a + m.cells.length, 0), delay: at - t }, au => au.handle('piece_settled', { grade: 'clean' }));
        break;
      }
      case 'pop_score':
        if (juice) bump(this.scoreEl);
        break;
      case 'pop_all_clear':
        if (juice) {
          this.fx.text('ALL CLEAR!', this.bx + this.cell * 4.5, this.by + this.cell * 4.6, { size: 50, fill: '#FFE08A', rise: 10, life: 1900, pop: true });
          this.slowUntil = t + 300; this.slowK = 0.5;
          this.fx.ring(this.bx + this.cell * 4.5, this.by + this.cell * 4.5, this.cell * 7.5, { delay: 120, life: 700, width: this.cell * 0.35 });
          const cols = ['#FF5E7E', '#FFB547', '#FFE45E', '#6EE7A8', '#5EC8FF', '#B28BFF', '#FFFFFF'];
          this.fx.cannon(0, this.H, -Math.PI / 3, this.cell, cols, 45);
          this.fx.cannon(this.W, this.H, -Math.PI * 2 / 3, this.cell, cols, 45);
          this.hopAt = t;
          if (!calm) { this.fx.kick(0.8); this.punch = { t0: t, z: 0.1 }; this.bounceAt = t + 150; }
        }
        this.say('pop_all_clear', {}, au => au.handle('pb_crossed', {}));
        break;
      case 'pop_checkpoint': {
        if (juice) {
          this.fx.text(`Checkpoint ${p.n}!`, this.bx + this.cell * 4.5, this.by - this.pad * 1.6, { size: 24, fill: '#A6F4C5', rise: 20, life: 1400, pop: true });
          const [fx0, fy0] = this.pillCentre();
          for (let i = 0; i < 3; i++) this.fx.burst(fx0, fy0, this.cell, ['#A6F4C5', '#FFE08A', '#FFFFFF', '#5EC8FF'], 8);
          bump(this.pillEl);
        }
        this.say('pop_checkpoint', { n: p.n }, au => au.handle('checkpoint_claimed', { n: p.n }));
        this.skyStep();
        break;
      }
      case 'biome_entered':
        a?.handle('biome_entered', { id: (p.id as number) + 1 });
        this.art = new PopArt(this.cell, this.sim!.biome);
        setTimeout(() => this.backdrop(), 500);
        break;
      case 'pop_tray':
        if ((p.n as number) > this.seenTray) { this.seenTray = p.n as number; this.trayIn = t; this.say('pop_tray', { n: p.n }); }
        if (p.n === 3 && this.coachFree() && this.hooks.coach?.('next')) {
          this.coach('Your next tray: plan ahead!', (this.nextBox.x + this.nextBox.w / 2) / this.k, (this.nextBox.y - 6 * this.k) / this.k);
        }
        break;
      case 'pop_combo':
        this.say('pop_combo', { combo: p.combo });
        if (p.combo === 2 && this.coachFree() && this.hooks.coach?.('combo')) {
          const r = this.comboEl.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
          this.coach('Combo! Pop again within a few shapes to keep it going.', r.left - rr.left + r.width / 2, r.bottom - rr.top + 12, true);
        }
        break;
      case 'pop_combo_end':
        this.say('pop_combo_end', { combo: p.combo });
        break;
      case 'pop_bag':
        this.say('pop_bag', {}, au => au.handle('hold_swap', {}));
        break;
      case 'pop_no_room':
        this.say('pop_no_room', { waiting: p.waiting });
        if (juice) this.fx.text('No room!', this.bx + this.cell * 4.5, this.by + this.cell * 4.5, { size: 48, fill: '#FF8FA3', rise: 0, life: 1500, pop: true });
        if (p.waiting) this.hint('No room! Use a power, or End run');
        break;
      // ---- milestone 3: bubbles, powers and Second Wind
      case 'pop_bubble': {
        const cell = p.cell as number;
        this.bubbleAt.set(cell, t);
        this.say('pop_bubble', { kind: p.kind, why: p.why }, au => au.handle('bubble_spawned', {}));
        if (this.coachFree() && this.hooks.coach?.('bubble')) {
          const [x, y] = this.cellCentre(cell);
          this.coach('Cover it! A shape on a bubble wins its power.', x / this.k, (y - this.cell * 0.55) / this.k);
        }
        break;
      }
      case 'pop_bubble_got': {
        const cell = p.cell as number, kind = p.kind as PopPower, slot = p.slot as number;
        const [x, y] = this.cellCentre(cell);
        this.bubbleAt.delete(cell);
        if (juice) {
          const col = POP_POWER_COLORS[kind];
          this.fx.burst(x, y, this.cell, ['#FFFFFF', col, '#FFFFFF', '#CFF6FF'], 14);
          this.fx.ring(x, y, this.cell * 1.3, { life: 320, width: this.cell * 0.12, color: '#FFFFFF' });
        }
        if (slot >= 0) this.iconFlys.push({ kind, x0: x, y0: y, slot, t0: t });
        this.say('pop_bubble_got', { kind }, au => au.handle('power_collected', {}));
        break;
      }
      case 'pop_bubble_gone':
        this.bubbleAt.delete(p.cell as number);
        this.gone.push({ cell: p.cell as number, kind: p.kind as PopPower, t0: t });
        this.say('pop_bubble_gone', {}, au => au.handle('bubble_expired', {}));
        break;
      case 'pop_power_got': {
        const kind = p.kind as PopPower, slot = p.slot as number;
        if (p.why !== 'head') {
          const [x, y] = [this.bx + this.cell * 4.5, this.by + this.cell * 4.5];
          this.iconFlys.push({ kind, x0: x, y0: y, slot, t0: t + 350 });
          if (juice) this.fx.text(`+ ${POP_POWER_NAMES[kind]}`, x, this.by + this.cell * 6, { size: 22, fill: '#FFFFFF', rise: 24, life: 1200, pop: true });
          this.say('pop_power_got', { kind, why: p.why }, au => au.handle('power_granted', {}));
        }
        break;
      }
      case 'pop_power':
        this.onPower(p, t, juice, calm);
        break;
      case 'pop_spin':
        this.spinAt[p.slot as number] = t;
        this.say('pop_spin', { slot: p.slot }, au => au.ui('tap2'));
        break;
      case 'pop_wind_ready':
        if (juice) {
          const r = this.windBtn.getBoundingClientRect();
          this.fx.text('Second Wind ready!', Math.max(this.cell * 3, (r.left + r.width / 2) * this.k), (r.top - 12) * this.k, { size: 18, fill: '#CFF6FF', rise: 24, life: 1600, pop: true });
        }
        setTimeout(() => this.bumpBtn(this.windBtn), 400);
        this.say('pop_wind_ready', { why: p.why }, au => au.handle('second_wind_ready', { how: 'earned' }));
        break;
      case 'pop_second_wind':
        this.onWind(p, t, juice, calm);
        break;
      case 'run_over':
        this.overAt = t;
        // Sound's run over (tumble, tape stop, "nice try") plays as the run ends: with the tumble, or now.
        if (!(juice && !calm && p.cause === 'noroom')) this.say('pop_run_over', { cause: p.cause }, au => au.handle('run_over', { cause: p.cause }));
        // The last moment plays at half speed for 0.4 s.
        if (juice && p.cause === 'noroom') { this.slowUntil = t + 200; this.slowK = 0.5; }
        break;
    }
    this.hud();
  }

  /** A cell's centre on the board, device px. */
  private cellCentre(c: number): [number, number] {
    return [this.bx + ((c % 9) + 0.5) * this.cell, this.by + (((c / 9) | 0) + 0.5) * this.cell];
  }

  /** Blocks flying off the board from `cells` (Sweep, Second Wind): each starts after `delay(cell)` ms. */
  private fling(cells: number[], shapes: number[], v: (c: number) => [number, number], delay: (c: number) => number, g = 1): void {
    const pad = Math.ceil(0.2 * this.art.s);
    cells.forEach((c, i) => {
      const bk = this.art.cells(shapes[i], [[0, 0]], 'dizzy');
      const [vx, vy] = v(c);
      this.bodies.push({ b: bk.canvas, x: this.bx + (c % 9) * this.cell - pad, y: this.by + ((c / 9) | 0) * this.cell - pad, vx, vy, rot: 0, vr: (Math.random() - 0.5) * 0.012, at: this.vt + delay(c), g });
    });
  }

  /** The old tray shapes in `slots` slide away as the new ones flip in. */
  private dealAgain(old: ({ s: number; q: number } | null)[], slots: number[], t: number): void {
    for (const i of slots) {
      const o = old[i];
      if (!o) continue;
      const [x, y] = this.slotCentre(i);
      const sh = POP_SHAPES[o.s], tt = sh.turns[sh.byQ[o.q & 3]];
      this.leaving.push({ s: o.s, q: o.q, x, y, scale: this.slotScale(i, tt), t0: t });
    }
    this.trayIn = t + 120;
  }

  /** A power was used (the sim has already changed): its animation and sound. */
  private onPower(p: Record<string, unknown>, t: number, juice: boolean, calm: boolean): void {
    const kind = p.kind as PopPower;
    this.bumpBtn(this.slotBtns[p.slot as number]);
    switch (kind) {
      case 'undo': {
        // A tape rewind: the shape flies back to its slot and popped cells come back.
        const removed = p.removed as number[];
        const back = p.back as number;
        this.rewindAt = t;
        this.seenTray = this.sim!.trays;
        if (removed.length) {
          const cx = removed.reduce((a, c) => a + this.cellCentre(c)[0], 0) / removed.length;
          const cy = removed.reduce((a, c) => a + this.cellCentre(c)[1], 0) / removed.length;
          this.springs = this.springs.filter(sp => sp.slot !== back);
          this.springs.push({ slot: back, x: cx, y: cy, scale: 1, t0: t });
        }
        const restored = p.restored as number[];
        if (restored.length) this.flashes.push({ cells: restored, t0: t, color: '200,170,255' });
        if (juice) this.fx.text('Rewind!', this.bx + this.cell * 4.5, this.by + this.cell * 3.4, { size: 34, fill: '#D9C6FF', rise: 12, life: 900, pop: true });
        this.say('pop_power', { kind }, au => au.handle('power_used', { kind: 'undo' }));
        break;
      }
      case 'spin':
        this.hint('Tap a shape to turn it');
        this.say('pop_power', { kind }, au => au.ui('open'));
        break;
      case 'sweep': {
        const line = p.line as number, cells = p.cells as number[], shapes = p.shapes as number[];
        const row = line < 9;
        this.sweeps.push({ line, t0: t });
        // The broom runs along the line in 320 ms; each Blockling tumbles off as it passes, going "whee".
        const along = (c: number) => (row ? c % 9 : (c / 9) | 0);
        const k = this.k;
        this.fling(cells, shapes, () => (row ? [0.5 * k, -0.25 * k] : [(Math.random() - 0.5) * 0.15 * k, 0.15 * k]), c => along(c) * 32);
        const [x, y] = this.cellCentre(LINE_CELLS[line][4]);
        this.fx.text(`+${(p.points as number).toLocaleString('en-US')}`, x, y, { size: 26, fill: '#FFE08A', rise: 50, life: 1000 });
        if (juice && !calm) this.fx.kick(0.3);
        this.say('pop_power', { kind, cells: cells.length }, au => { au.handle('pieces_swept', { pieces: cells }); au.handle('power_used', { kind: 'clean' }); });
        break;
      }
      case 'meteor': {
        // The cells stay until the meteor lands (260 ms), then shatter into stone chips.
        const cells = p.cells as number[], shapes = p.shapes as number[];
        const hitAt = t + 260;
        cells.forEach((c, i) => this.popping.push({ cell: c, s: shapes[i], start: hitAt, burst: false, smash: true }));
        this.meteors.push({ cell: p.cell as number, t0: t, hit: false, cells });
        this.say('pop_power', { kind }, au => au.handle('power_used', { kind: 'clean' }));
        break;
      }
      case 'fresh':
        this.dealAgain(p.old as ({ s: number; q: number } | null)[], p.slots as number[], t);
        if (juice) this.fx.text('Fresh Deal!', this.W / 2, this.trayY - this.cell * 0.2, { size: 26, fill: '#CFF6FF', rise: 16, life: 900, pop: true });
        this.say('pop_power', { kind }, au => au.ui('open'));
        break;
    }
  }

  /** Second Wind: a gust crosses the board and the chosen rows and columns blow away left to right, then a Fresh Deal. */
  private onWind(p: Record<string, unknown>, t: number, juice: boolean, calm: boolean): void {
    const cells = p.cells as number[], shapes = p.shapes as number[];
    this.gustAt = t;
    this.windSpentAt = now();
    const k = this.k;
    this.fling(cells, shapes, () => [(0.55 + Math.random() * 0.35) * k, -(0.1 + Math.random() * 0.25) * k], c => 120 + (c % 9) * 45, 0.45);
    this.dealAgain(p.old as ({ s: number; q: number } | null)[], p.slots as number[], t + 400);
    if (juice) this.fx.text('Second Wind!', this.bx + this.cell * 4.5, this.by + this.cell * 4.2, { size: 40, fill: '#CFF6FF', rise: 14, life: 1500, pop: true });
    if (juice && !calm) this.fx.kick(0.35);
    this.hint('');
    this.say('pop_second_wind', { cells: cells.length }, au => au.handle('second_wind', {}));
  }

  /** The checkpoint pill's centre in device px (where faces fly to). */
  private pillCentre(): [number, number] {
    const r = this.pillEl.getBoundingClientRect();
    return [(r.left + r.width / 2) * this.k, (r.top + r.height / 2) * this.k];
  }

  /** The sky rises a step with every checkpoint inside a biome, and settles when the next biome arrives. */
  private skyStep(): void {
    const sim = this.sim;
    if (!sim || !this.bg) return;
    const pr = sim.cpProgress;
    const into = Math.max(0, Math.min(1, pr.into / Math.max(1, pr.need)));
    this.bg.style.transform = this.hooks.reducedMotion() ? '' : `translateY(${(into * 5).toFixed(2)}%) scale(1.06)`;
  }

  private hud(): void {
    const sim = this.sim;
    if (!sim) return;
    this.bestEl.textContent = `Best ${Math.max(this.hooks.best(), sim.score).toLocaleString('en-US')}`;
    const pr = sim.cpProgress;
    const count = `${pr.into}/${pr.need}`, area = BIOMES[sim.biome].name;
    if (this.cpEl.textContent !== count) this.cpEl.textContent = count;
    if (this.areaEl.textContent !== area) this.areaEl.textContent = area;
    this.pillEl.style.setProperty('--p', `${Math.round(100 * Math.max(0, Math.min(1, pr.into / Math.max(1, pr.need))))}%`);
    const el = this.comboEl, juice = this.hooks.juice();
    if (sim.combo >= 1) {
      const mult = Math.min(sim.tuning.comboMax, 1 + sim.tuning.comboStep * (sim.combo - 1));
      el.innerHTML = `×${mult}${Array.from({ length: sim.tuning.sparks }, (_, i) => `<i class="${i < sim.sparks ? '' : 'off'}"></i>`).join('')}`;
      el.classList.add('on');
      // The chip warms from a combo of 3, grows orbiting sparks from 6 and a rainbow edge from 10.
      el.classList.toggle('warm', juice && sim.combo >= 3);
      el.classList.toggle('sparks', juice && sim.combo >= 6);
      el.classList.toggle('rainbow', juice && sim.combo >= 10);
      if (juice && sim.combo > this.lastCombo) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
    } else el.classList.remove('on', 'warm', 'sparks', 'rainbow', 'tick');
    this.lastCombo = sim.combo;
    this.powerBar();
  }

  // ---------------------------------------------------------------- powers and Second Wind (milestone 3)

  /** The power slots, Second Wind's button and End run, kept in step with the sim (cheap when nothing changed). */
  private powerBar(): void {
    const sim = this.sim;
    if (!sim) return;
    const t = now();
    const armed = t < this.windArmedUntil && sim.wind === 'ready';
    const trouble = !sim.over && (sim.stuck || sim.filled / CELLS >= 0.75);
    const can = [0, 1].map(i => sim.canPower(i));
    const blowing = sim.wind === 'used' && t - this.windSpentAt < 450;
    // A power on its way into a slot shows there once its icon lands.
    const incoming = new Set(this.iconFlys.map(f => f.slot));
    const shown = sim.powers.map((k, i) => (incoming.has(i) ? null : k));
    const key = `${shown.join()}|${sim.wind}|${armed}|${trouble}|${this.aim?.slot ?? -1}|${sim.stuck}|${sim.over}|${can.join()}|${blowing}`;
    if (key === this.pwKey) return;
    this.pwKey = key;
    shown.forEach((k, i) => {
      const b = this.slotBtns[i];
      if ((b.dataset.pop ?? '') !== (k ?? '')) {
        if (k) {
          b.dataset.pop = k;
          b.innerHTML = `<img class="st-icon" alt="" src="${popIconUrl(k, 34)}"><span class="st-tag">${POP_POWER_TAGS[k]}</span>`;
          b.style.background = `radial-gradient(circle at 50% 36%, #FFFFFF 0 26%, ${wash(POP_POWER_COLORS[k], 0.25)} 62%, ${wash(POP_POWER_COLORS[k], 0.5)} 100%)`;
        } else { delete b.dataset.pop; b.innerHTML = ''; b.style.background = ''; }
        b.setAttribute('aria-label', k ? POP_POWER_NAMES[k] : 'Empty power-up slot');
      }
      b.classList.toggle('empty', !k);
      b.classList.toggle('off', !!k && !can[i]);
      b.classList.toggle('aim', this.aim?.slot === i);
      b.classList.toggle('glow', !!k && sim.stuck && (k === 'spin' ? sim.canRescue() : can[i]));
    });
    const w = this.windBtn;
    const img = w.querySelector('img')!;
    if (!img.src) img.src = popIconUrl('wind', 38);
    if (blowing) setTimeout(() => { this.pwKey = ''; this.powerBar(); }, 470);
    w.classList.toggle('spent', blowing);
    w.style.display = sim.wind === 'off' || (sim.wind === 'used' && !blowing) ? 'none' : '';
    w.classList.toggle('earn', sim.wind === 'earn');
    w.classList.toggle('armed', armed);
    w.classList.toggle('glow', sim.wind === 'ready' && trouble && !armed);
    w.querySelector('.st-tag')!.textContent = sim.wind === 'earn' ? `CP ${sim.tuning.windCp}` : armed ? 'TAP AGAIN' : '2ND WIND';
    this.endBtn.classList.toggle('show', sim.stuck && !sim.over);
  }

  private bumpBtn(b: HTMLElement, refused = false): void {
    b.classList.remove('pop', 'nope');
    void b.offsetWidth;
    b.classList.add(refused ? 'nope' : 'pop');
  }

  private hint(text: string): void {
    if (text) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', !!text);
  }

  private refused(b: HTMLElement): void {
    this.bumpBtn(b, true);
    this.say('pop_power_refused', {}, a => a.handle('power_refused', {}));
  }

  /** A tap on a power slot: Undo and Fresh Deal go at once, Spin turns on, Sweep and Meteor start aiming (a second tap cancels). */
  private tapPower(i: number): void {
    const sim = this.sim;
    if (!sim || sim.over || this.paused) return;
    const k = sim.powers[i];
    if (!k) return;
    if (this.aim) {
      const same = this.aim.slot === i;
      this.endAim();
      if (same) { this.say('pop_aim_cancel', {}, a => a.ui('back')); return; }
    }
    if (this.held) this.cancelHeld();
    if (!sim.canPower(i)) { this.refused(this.slotBtns[i]); return; }
    if (k === 'sweep' || k === 'meteor') {
      this.aim = { slot: i, kind: k, target: k === 'meteor' ? this.bestMeteor() : -1, line: null, press: null };
      this.hint(k === 'sweep' ? 'Swipe along a row or column' : 'Drag the target, tap it to smash');
      this.say('pop_aim', { kind: k }, a => a.ui('open'));
      this.pwKey = '';
      this.powerBar();
      return;
    }
    if (!this.intent({ t: 'power', slot: i })) this.refused(this.slotBtns[i]);
  }

  private endAim(): void {
    this.aim = null;
    if (this.pointer !== -1 && !this.held && !this.pending) this.pointer = -1;
    this.hint(this.sim?.spinning ? 'Tap a shape to turn it' : '');
    this.pwKey = '';
    this.powerBar();
  }

  /** Second Wind: the tower's two taps, the first arming it for 2.5 s. */
  private tapWind(): void {
    const sim = this.sim;
    if (!sim || sim.over || this.paused) return;
    if (sim.wind !== 'ready') { this.refused(this.windBtn); return; }
    if (this.aim) this.endAim();
    if (now() < this.windArmedUntil) {
      this.windArmedUntil = 0;
      if (this.held) this.cancelHeld();
      this.intent({ t: 'wind' });
    } else {
      this.windArmedUntil = now() + 2500;
      this.say('pop_wind_armed', {}, a => a.ui('tap2'));
      setTimeout(() => { this.pwKey = ''; this.powerBar(); }, 2550);
    }
    this.pwKey = '';
    this.powerBar();
  }

  /** Meteor's first target: the cell whose 3×3 block holds the most blocks, nearest the middle among ties. */
  private bestMeteor(): number {
    const sim = this.sim!;
    let best = 40, bn = -1, bd = 99;
    for (let c = 0; c < CELLS; c++) {
      const n = sim.meteorCells(c).filter(x => sim.cellShape[x] >= 0).length;
      const d = Math.abs((c % 9) - 4) + Math.abs(((c / 9) | 0) - 4);
      if (n > bn || (n === bn && d < bd)) { best = c; bn = n; bd = d; }
    }
    return best;
  }

  /** The board cell under a point, or −1. */
  private cellAt(x: number, y: number): number {
    const cx = Math.floor((x - this.bx) / this.cell), cy = Math.floor((y - this.by) / this.cell);
    return cx >= 0 && cy >= 0 && cx < 9 && cy < 9 ? cy * 9 + cx : -1;
  }

  /** Sweep's line for a press at `cell` that hasn't moved: the fuller of its row and column (the row on a tie). */
  private fullerLine(cell: number): number {
    const sim = this.sim!;
    const n = (id: number) => LINE_CELLS[id].filter(c => sim.cellShape[c] >= 0).length;
    const r = (cell / 9) | 0, col = 9 + (cell % 9);
    return n(col) > n(r) ? col : r;
  }

  private aimDown(x: number, y: number, id: number): void {
    const a = this.aim!, sim = this.sim!;
    const cell = this.cellAt(x, y);
    if (cell < 0) return;
    this.pointer = id;
    const onTarget = a.kind === 'meteor' && sim.meteorCells(a.target).includes(cell);
    a.press = { x, y, cell, moved: false, onTarget };
    if (a.kind === 'sweep') a.line = null;
  }

  private aimMove(x: number, y: number): void {
    const a = this.aim!, pr = a.press;
    if (!pr) return;
    const dx = x - pr.x, dy = y - pr.y;
    if (Math.hypot(dx, dy) > this.cell * 0.3) pr.moved = true;
    if (!pr.moved) return;
    if (a.kind === 'sweep') a.line = Math.abs(dx) >= Math.abs(dy) ? (pr.cell / 9) | 0 : 9 + (pr.cell % 9);
    else {
      const cx = Math.max(0, Math.min(8, Math.floor((x - this.bx) / this.cell))), cy = Math.max(0, Math.min(8, Math.floor((y - this.by) / this.cell)));
      if (cy * 9 + cx !== a.target) { a.target = cy * 9 + cx; this.say('pop_aim_move', {}, au => au.ui('tap')); }
    }
  }

  private aimUp(x: number, y: number): void {
    const a = this.aim!, sim = this.sim!, pr = a.press;
    a.press = null;
    if (!pr) return;
    if (a.kind === 'sweep') {
      const line = pr.moved ? a.line : this.fullerLine(pr.cell);
      a.line = null;
      if (line === null || (!pr.moved && this.cellAt(x, y) < 0)) return;
      if (!sim.canSweep(line)) { this.refused(this.slotBtns[a.slot]); return; }
      const slot = a.slot;
      if (this.intent({ t: 'power', slot, arg: line })) this.endAim();
      return;
    }
    // Meteor: a tap on the target smashes it; a drag (or a tap elsewhere) moves it.
    if (!pr.moved && !pr.onTarget) { a.target = pr.cell; this.say('pop_aim_move', {}, au => au.ui('tap')); return; }
    if (pr.moved) { this.hint('Tap the target to smash'); return; }
    if (!sim.canMeteor(a.target)) { this.refused(this.slotBtns[a.slot]); return; }
    if (this.intent({ t: 'power', slot: a.slot, arg: a.target })) this.endAim();
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
    if (this.coachEl.classList.contains('show')) this.coachOff(); // a tip never stands in the way: any touch closes it
    const [x, y] = this.toDev(e);
    if (this.aim) {
      this.aimDown(x, y, e.pointerId);
      if (this.pointer === e.pointerId) try { this.cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
      return;
    }
    if (this.vs.tap) { this.tapDown(x, y); return; }
    const slot = this.slotAt(x, y);
    if (slot < 0 || !sim.slot(slot) || this.springs.some(s => s.slot === slot)) return;
    this.pointer = e.pointerId;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    // Spin on: a tap turns the shape; it's picked up only once the finger moves.
    if (sim.spinning && sim.canSpin(slot)) { this.pending = { slot, x, y, id: e.pointerId }; return; }
    this.pickUp(slot, x, y, e.pointerId);
  }

  /**
   * Tap mode (Pop plan §14): tap a shape to lift it, tap a board cell to aim it there (the ghost shows
   * where it would sit), tap the ghost to place it. The bag takes a lifted shape; tapping it again, or
   * anywhere else, puts it back.
   */
  private tapDown(x: number, y: number): void {
    const sim = this.sim!, h = this.held;
    const slot = this.slotAt(x, y);
    if (h?.tap) {
      if (slot === BAG && h.slot !== BAG && sim.canBag(h.slot)) { this.held = null; this.intent({ t: 'bag', slot: h.slot }); return; }
      const cell = this.cellAt(x, y), t = sim.turn(h.slot);
      if (cell >= 0 && t) {
        // On the ghost: place it.
        if (h.ghost && t.cells.some(([cx, cy]) => (h.ghost!.y + cy) * 9 + h.ghost!.x + cx === cell)) {
          const g = h.ghost;
          this.held = null;
          if (!this.intent({ t: 'place', slot: h.slot, x: g.x, y: g.y })) this.springBack(h);
          return;
        }
        // Elsewhere on the board: aim there, the shape centred on the tapped cell.
        const lift = this.vs.lift;
        h.px = this.bx + ((cell % 9) + 0.5) * this.cell;
        h.py = this.by + (Math.floor(cell / 9) + 0.5) * this.cell + (lift === null ? 0 : this.cell * (lift + t.h / 2));
        this.track();
        this.say('pop_aim_move', {}, a => a.ui('tap'));
        return;
      }
      // Off the board: put it back, and lift another if that's what was tapped.
      this.cancelHeld();
      if (slot < 0 || slot === h.slot) return;
    }
    if (slot < 0 || !sim.slot(slot) || this.springs.some(s => s.slot === slot)) return;
    if (sim.spinning && sim.canSpin(slot)) { this.intent({ t: 'spin', slot }); return; }
    const [sx, sy] = this.slotCentre(slot);
    this.pickUp(slot, sx, sy, -1);
    this.held!.tap = true;
  }

  private pickUp(slot: number, x: number, y: number, id: number): void {
    const sim = this.sim!;
    this.held = { slot, px: x, py: y, t0: now(), ghost: null, lines: [], id };
    this.lastMove = { x, t: now(), vx: 0 };
    this.lean = 0;
    this.track();
    this.say('pop_pickup', { shape: sim.slot(slot)!.s }, a => a.ui('tap'));
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    if (this.aim) { this.aimMove(...this.toDev(e)); return; }
    if (this.pending) {
      const [x, y] = this.toDev(e), pd = this.pending;
      if (Math.hypot(x - pd.x, y - pd.y) > this.cell * 0.3) { this.pending = null; this.pickUp(pd.slot, x, y, pd.id); }
      return;
    }
    if (!this.held) return;
    const [x, y] = this.toDev(e);
    const tn = now(), lm = this.lastMove, dtm = Math.max(4, tn - lm.t);
    lm.vx = lm.vx * 0.5 + ((x - lm.x) / dtm) * 0.5;
    lm.x = x; lm.t = tn;
    this.held.px = x; this.held.py = y;
    this.track();
  }

  private up(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    if (this.aim) { if (cancel) this.aim.press = null; else this.aimUp(...this.toDev(e)); return; }
    if (this.pending) {
      const pd = this.pending;
      this.pending = null;
      if (!cancel) this.intent({ t: 'spin', slot: pd.slot });
      return;
    }
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
    this.springs.push({ slot: h.slot, x: cx, y: cy, scale: this.heldScale(h), t0: this.vt });
    this.say('pop_drop_back', {}, a => a.ui('back'));
  }

  /** The held shape's centre: over the finger, its bottom edge 1.1 cells above it (Pop plan §3; the setting changes it, §14). */
  private heldCentre(h: Held, t: Turn): [number, number] {
    const lift = this.vs.lift;
    return [h.px, h.py - (lift === null ? 0 : this.cell * (lift + t.h / 2))];
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
    if (moved && best) this.say('pop_ghost', { lines: h.lines.length }, a => a.handle('ghost_fit', { perfect: h.lines.length > 0 }));
    if (h.lines.length !== this.wouldWas) { this.wouldWas = h.lines.length; this.say('pop_would_pop', { count: h.lines.length }); }
  }

  /** Sends Pop's own sound event when Sound's Pop score is there, else the tower's stand-in (if any). */
  private say(name: string, payload: Record<string, unknown> = {}, fallback?: (a: PopAudio) => void): void {
    const a = this.hooks.audio();
    if (!a) return;
    if (a.setMode) a.handle(name, payload);
    else fallback?.(a);
  }

  private intent(it: PopIntent): boolean {
    const sim = this.sim;
    if (!sim) return false;
    // A merge still waiting shows now: the next move goes on the board as it really is.
    if (this.merging.size) { this.merging.clear(); this.rebuild(); }
    if (!sim.apply(it)) return false;
    if (it.t === 'place') this.handAt = -1;
    this.rebuild();
    this.hooks.onChange(sim);
    if (this.wouldWas) { this.wouldWas = 0; this.say('pop_would_pop', { count: 0 }); }
    this.say('pop_fill', { fill: sim.filled / CELLS });
    if (!this.aim) this.hint(sim.spinning ? 'Tap a shape to turn it' : sim.stuck ? 'No room! Use a power, or End run' : '');
    this.powerBar();
    // A tray shape that just stopped fitting says "uh" once.
    for (let i = 0; i <= BAG; i++) {
      const fits = !sim.slot(i) || sim.fitsAnywhere(i);
      if (!fits && this.fitsWas[i] && !sim.over) this.say('pop_cant_fit', { slot: i });
      // The first time a tray shape can't fit while the bag could take it, the bag gets a tip.
      if (!fits && i < BAG && !sim.over && sim.canBag(i) && this.coachFree() && this.hooks.coach?.('bag')) {
        this.coach('Doesn\'t fit? Drag it to the bag to keep it for later.', (this.bag.x + this.bag.s / 2) / this.k, (this.bag.y - 6 * this.k) / this.k);
      }
      this.fitsWas[i] = fits;
    }
    return true;
  }

  // ---------------------------------------------------------------- the first-run guide (Pop plan §14)

  /** The first Pop run's card. Its button starts the hand. */
  private intro(): void {
    const el = document.createElement('div');
    el.className = 'pop-intro';
    el.innerHTML = `<div class="pop-intro-card" role="dialog" aria-label="How to play Blockling Pop"><h2>Blockling Pop</h2>
      <p>Drag shapes onto the board. Fill a row, column or square to pop it. When nothing fits, the run's over.</p>
      <button type="button" class="st-btn">Let's pop!</button></div>`;
    el.querySelector('button')!.onclick = () => {
      el.remove();
      this.introEl = null;
      this.handAt = this.vt;
      this.hooks.audio()?.ui('start');
    };
    this.introEl = el;
    this.root.appendChild(el);
  }

  /** No tip is up, and none was in the last moment (one at a time). */
  private coachFree(): boolean { return !this.introEl && now() > this.coachUntil; }

  /** A tip bubble pointing at (x, y) in CSS px: above it, or below with `below`. Touches go through it; any touch or 4.5 s closes it. */
  private coach(text: string, x: number, y: number, below = false): void {
    const el = this.coachEl, W = window.innerWidth;
    el.textContent = text;
    el.style.display = '';
    el.classList.toggle('below', below);
    const w = Math.min(220, W - 32);
    const left = Math.max(16, Math.min(W - 16 - w, x - w / 2));
    el.style.width = `${w}px`;
    el.style.left = `${left}px`;
    el.style.setProperty('--ax', `${Math.max(16, Math.min(w - 16, x - left))}px`);
    // Placed by its top edge, not a transform: the pop-in animation uses transform.
    el.style.top = `${below ? y : y - el.offsetHeight}px`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.coachUntil = now() + 4500;
    clearTimeout(this.coachTimer);
    this.coachTimer = window.setTimeout(() => this.coachOff(), 4500);
  }

  private coachOff(): void {
    clearTimeout(this.coachTimer);
    this.coachEl.classList.remove('show');
    this.coachEl.style.display = 'none';
    this.coachUntil = Math.min(this.coachUntil, now() + 600);
  }

  /** The hand: from the tray's first shape to the gap in the bottom row, over and over until the first placement. */
  private drawHand(t: number): void {
    const sim = this.sim!;
    if (this.handAt < 0 || this.held || this.paused || sim.placements > 0 || !sim.slot(0)) return;
    const c = this.c, cell = this.cell;
    const u = ((t - this.handAt) % 2200) / 2200;
    const [sx, sy] = this.slotCentre(0);
    const ex = this.bx + cell * 7, ey = this.by + cell * 8.5;
    // Rest on the shape, glide up to the gap, linger, fade.
    const m = u < 0.18 ? 0 : u < 0.62 ? (u - 0.18) / 0.44 : 1;
    const e = m * m * (3 - 2 * m);
    const x = sx + (ex - sx) * e, y = sy + (ey - sy) * e - Math.sin(e * Math.PI) * cell * 1.2;
    const alpha = u < 0.08 ? u / 0.08 : u > 0.86 ? Math.max(0, (1 - u) / 0.14) : 1;
    c.save();
    c.globalAlpha = alpha;
    // The gap's outline, where the I goes.
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = Math.max(2, cell * 0.07);
    c.setLineDash([cell * 0.18, cell * 0.12]);
    c.strokeRect(this.bx + cell * 5 + 2, this.by + cell * 8 + 2, cell * 4 - 4, cell - 4);
    c.setLineDash([]);
    // A fingertip: a press ring at the start, then the dot.
    const press = u < 0.18 ? u / 0.18 : 0;
    if (press > 0) {
      c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.lineWidth = cell * 0.06;
      c.beginPath(); c.arc(sx, sy, cell * (0.35 + press * 0.4), 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.strokeStyle = INK;
    c.lineWidth = Math.max(2, cell * 0.08);
    c.beginPath(); c.arc(x, y, cell * 0.3, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- frame

  private frame(t: number): void {
    this.raf = requestAnimationFrame(tt => this.frame(tt));
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const sim = this.sim;
    if (!sim) return;
    // Settings can change mid-run (Pause, Settings): the left-handed row and the grid need a new layout.
    this.vs = this.hooks.settings?.() ?? VIEW_DEFAULTS;
    if (`${this.vs.left}|${this.vs.grid}` !== this.laidFor) this.layout();
    if (this.held?.tap && !this.vs.tap) this.cancelHeld();
    if (!this.paused && !sim.over && !document.hidden) { this.playMs += dt; this.frames.add(t - this.lastRaw); }
    this.lastRaw = t;
    const juice = this.hooks.juice();
    // The effects clock: slow-mo for the All Clear and the run over, never for input.
    const sdt = dt * (this.vt < this.slowUntil ? this.slowK : 1);
    this.vt += sdt;
    if (this.merging.size && this.vt >= this.mergeAt) { this.merging.clear(); this.rebuild(); }
    const vt = this.vt;
    if (vt >= this.holdUntil) this.fx.step(sdt);
    // The held shape leans up to 5° into its motion and leaves a faint stardust trail.
    const lm = this.lastMove;
    lm.vx *= Math.exp(-dt / 70);
    const calm = this.hooks.reducedMotion();
    const want = this.held && juice && !calm ? Math.max(-1, Math.min(1, lm.vx / (this.cell * 0.012))) * 0.087 : 0;
    this.lean += (want - this.lean) * Math.min(1, dt / 70);
    if (this.held && juice && Math.abs(lm.vx) > this.cell * 0.002 && t - this.trailAt > 45) {
      this.trailAt = t;
      const tt = sim.turn(this.held.slot);
      if (tt) { const [hx, hy] = this.heldCentre(this.held, tt); this.fx.dust2(hx + (Math.random() - 0.5) * tt.w * this.cell * 0.6, hy + tt.h * this.cell * 0.4, this.cell); }
    }
    // The score counts up to the sim's.
    if (this.shownScore !== sim.score) {
      this.shownScore += Math.max(1, Math.ceil((sim.score - this.shownScore) * Math.min(1, dt / 120)));
      if (this.shownScore > sim.score) this.shownScore = sim.score;
      this.scoreEl.textContent = this.shownScore.toLocaleString('en-US');
    }
    // Run over: "No room!" for a beat, then everything tumbles off the board (or straight on, without juice).
    if (this.overAt >= 0 && !this.overDone) {
      const since = vt - this.overAt;
      const tumble = juice && !this.hooks.reducedMotion() && sim.cause === 'noroom';
      if (tumble && since > 600 && !this.bodies.length && this.comps.length) {
        this.startTumble();
        this.say('pop_run_over', { cause: sim.cause }, au => au.handle('run_over', { cause: sim.cause }));
      }
      if (since > (sim.cause === 'noroom' ? (tumble ? 1900 : 900) : 250)) {
        this.overDone = true;
        this.hooks.onOver(sim);
      }
    }
    for (const b of this.bodies) {
      if (b.at !== undefined && vt < b.at) continue;
      b.vy += 0.0022 * (b.g ?? 1) * this.k * sdt; b.x += b.vx * sdt; b.y += b.vy * sdt; b.rot += b.vr * sdt;
    }
    if (this.bodies.length && this.overAt < 0) this.bodies = this.bodies.filter(b => b.y < this.H + this.cell * 2 && b.x > -this.cell * 3 && b.x < this.W + this.cell * 3);
    // Meteor: the strike lands 260 ms after the target is set.
    for (const m of this.meteors) {
      if (m.hit || vt < m.t0 + 260) continue;
      m.hit = true;
      const [x, y] = this.cellCentre(m.cell);
      if (juice) {
        this.fx.ring(x, y, this.cell * 2.6, { life: 420, width: this.cell * 0.3, color: '#FFE0A0' });
        for (let i = 0; i < 3; i++) this.fx.dust(x + (i - 1) * this.cell, y + this.cell * 1.2, this.cell);
        this.flashes.push({ cells: this.sim!.meteorCells(m.cell), t0: vt, color: '255,236,190' });
        if (!this.hooks.reducedMotion()) { this.fx.kick(0.5); this.punch = { t0: vt, z: 0.04 }; }
      }
      this.say('pop_meteor_hit', { cells: m.cells.length }, au => au.handle('row_solid', { count: 2 }));
    }
    this.meteors = this.meteors.filter(m => vt < m.t0 + 900);
    this.draw(vt, juice);
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
    const calm = this.hooks.reducedMotion();
    const [ox, oy] = juice && !calm ? this.fx.offset() : [0, 0];
    c.translate(ox, oy);
    // Zoom punch about the board's centre, and the All Clear's bounce about its foot.
    const bcx = this.bx + this.cell * 4.5, bcy = this.by + this.cell * 4.5, bfoot = this.by + this.cell * 9 + this.pad;
    if (juice && !calm) {
      const u = (t - this.punch.t0) / 280;
      const z = u >= 0 && u < 1 ? this.punch.z * (u < 0.15 ? u / 0.15 : (1 - (u - 0.15) / 0.85) ** 2) : 0;
      if (z) { c.translate(bcx, bcy); c.scale(1 + z, 1 + z); c.translate(-bcx, -bcy); }
      const v = (t - this.bounceAt) / 520;
      if (v >= 0 && v < 1) {
        const b = 0.045 * Math.exp(-v * 4) * Math.cos(v * 13);
        c.translate(bcx, bfoot); c.scale(1 + b, 1 - b); c.translate(-bcx, -bfoot);
      }
    }
    const boardT = c.getTransform();
    // The board.
    if (this.boardCv) c.drawImage(this.boardCv, this.bx - this.pad, this.by - this.pad);
    const fill = sim.filled / CELLS;
    const mood: Expression = fill >= 0.85 ? 'panic' : fill >= 0.7 ? 'worried' : 'idle';
    const glow = new Set<number>();
    if (this.vs.preview) for (const id of this.held?.lines ?? []) for (const cc of LINE_CELLS[id]) glow.add(cc);
    // Pieces and fragments.
    const pad = Math.ceil(0.2 * this.art.s);
    for (const cp of this.comps) {
      const lit = glow.size > 0 && cp.cells.some(([x, y]) => glow.has(y * 9 + x));
      const st = this.stamps.get(cp.piece);
      const age = st === undefined || t < st ? 1e9 : t - st;
      const face: Expression | null = cp.face ? (age < 160 ? 'squint' : lit ? 'proud' : mood) : null;
      const bk = this.art.cells(cp.s, cp.cells, face);
      const x = this.bx + cp.x * this.cell - pad, y = this.by + cp.y * this.cell - pad;
      const jt = this.jiggles.get(cp.piece);
      const ju = jt === undefined ? 1 : (t - jt) / 280;
      if (juice && !calm && ju < 1 && age >= 220) {
        // A neighbour landed: a little jiggle about its foot.
        const j = 0.05 * Math.exp(-ju * 3) * Math.sin(ju * Math.PI * 4);
        const w = bk.canvas.width, h = bk.canvas.height;
        c.save();
        c.translate(x + w / 2, y + h - pad);
        c.scale(1 - j * 0.6, 1 + j);
        c.drawImage(bk.canvas, -w / 2, -h + pad);
        c.restore();
      } else if (juice && age < 220) {
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
        if (!pp.burst && juice) {
          const col = shapeColors(pp.s);
          this.fx.burst(x + this.cell / 2, y + this.cell / 2, this.cell, pp.smash ? ['#A8927E', '#CDBBA7', '#7D6A58', col.base] : [col.base, col.light, col.base, '#FFFFFF'], pp.smash ? 9 : 7);
        }
        return false;
      }
      const bk = this.art.cells(pp.s, [[0, 0]], juice ? (pp.smash ? 'worried' : 'proud') : null);
      const sc = u < 0 ? 1 : pp.smash ? 1 - 0.3 * (u / 70) : 1 + 0.2 * (u / 70);
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
      if (u < 0) return true;
      if (u >= 1) return false;
      c.fillStyle = `rgba(${f.color ?? '255,240,170'},${0.45 * (1 - u)})`;
      for (const cc of f.cells) c.fillRect(this.bx + (cc % 9) * this.cell, this.by + ((cc / 9) | 0) * this.cell, this.cell, this.cell);
      return true;
    });
    this.drawPowers(t, juice, calm);
    // The ghost: the shape as it will sit, flush, at 35%, with a glowing outline.
    const h = this.held;
    if (h?.ghost) {
      const sl = sim.slot(h.slot)!;
      const tt = sim.turn(h.slot)!;
      const cells = tt.cells.map(([x, y]) => [x, y] as [number, number]);
      const bk = this.art.cells(sl.s, cells, null);
      const gx = this.bx + h.ghost.x * this.cell, gy = this.by + h.ghost.y * this.cell;
      c.globalAlpha = 0.35;
      c.drawImage(bk.canvas, gx - pad, gy - pad);
      c.globalAlpha = 1;
      const path = silhouette(cellsPose(POP_KEYS[sl.s], cells), this.cell, undefined, FLUSH);
      c.save();
      c.translate(gx, gy);
      c.lineJoin = 'round';
      if (juice) { c.shadowColor = 'rgba(255,246,200,0.95)'; c.shadowBlur = this.cell * 0.35; }
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = Math.max(2, this.cell * 0.08);
      c.stroke(path);
      c.restore();
      // Two lines or more: a faint preview of the banner above the board.
      if (juice && this.vs.preview && h.lines.length >= 2) this.fx.label(c, BANNERS[Math.min(5, h.lines.length)], bcx, this.by - this.pad - this.cell * 0.55, 30, '#FFFFFF', 0.5 + 0.15 * Math.sin(t / 80));
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
    // The board filling up past 85%: a soft red edge, breathing.
    if (juice && fill >= 0.85 && !sim.over) {
      const a = 0.3 + 0.1 * Math.sin(t / 320);
      const g = c.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.3, this.W / 2, this.H / 2, Math.hypot(this.W, this.H) * 0.55);
      g.addColorStop(0, 'rgba(255,60,90,0)');
      g.addColorStop(1, `rgba(255,60,90,${a.toFixed(3)})`);
      c.fillStyle = g;
      c.fillRect(0, 0, this.W, this.H);
    }
    // The tray, the next tray and the bag (never shaken).
    this.drawSlots(t, juice);
    c.setTransform(boardT);
    this.fx.draw(c);
    this.drawHand(t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawFlyers(t);
    this.drawIconFlys(t);
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
        c.rotate(this.lean);
        c.scale(sc, sc);
        c.drawImage(bk.canvas, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
        c.restore();
      }
    }
  }

  /** Two white turning arrows going round a tray shape while Spin is on. */
  private spinRing(cx: number, cy: number, t: number, r: number): void {
    const c = this.c;
    const a0 = (t / 900) % (Math.PI * 2);
    c.save();
    c.lineCap = 'round';
    for (const off of [0, Math.PI]) {
      const s0 = a0 + off, s1 = s0 + 1.9;
      c.beginPath(); c.arc(cx, cy, r, s0, s1);
      c.strokeStyle = 'rgba(34,24,58,0.55)'; c.lineWidth = this.cell * 0.13; c.stroke();
      c.strokeStyle = '#FFFFFF'; c.lineWidth = this.cell * 0.07; c.stroke();
      const hx = cx + Math.cos(s1) * r, hy = cy + Math.sin(s1) * r, tx = -Math.sin(s1), ty = Math.cos(s1), w = this.cell * 0.13;
      c.beginPath();
      c.moveTo(hx + tx * w * 1.3, hy + ty * w * 1.3);
      c.lineTo(hx + Math.cos(s1) * w, hy + Math.sin(s1) * w);
      c.lineTo(hx - Math.cos(s1) * w, hy - Math.sin(s1) * w);
      c.closePath();
      c.fillStyle = '#FFFFFF'; c.fill();
      c.strokeStyle = 'rgba(34,24,58,0.55)'; c.lineWidth = this.cell * 0.03; c.stroke();
    }
    c.restore();
  }

  /** On the board: bubbles, aiming, and the powers' own moments (broom, meteor, gust, rewind). */
  private drawPowers(t: number, juice: boolean, calm: boolean): void {
    const c = this.c, sim = this.sim!, cell = this.cell;
    // Bubbles float down onto their cell and wobble; a ring round each counts down its placements.
    for (const b of sim.bubbles) {
      const [x, y] = this.cellCentre(b.cell);
      const at = this.bubbleAt.get(b.cell) ?? -1e9;
      const u = Math.min(1, (t - at) / 340);
      const drop = juice && !calm ? (1 - backOut(u)) * -cell * 0.9 : 0;
      const bob = juice && !calm ? Math.sin(t / 330 + b.cell) * cell * 0.04 : 0;
      const r = cell * 0.44;
      const img = bakePopBubble(b.kind, Math.round(r));
      const sc = juice ? 0.4 + 0.6 * Math.min(1, u * 1.4) : 1;
      const blink = b.left <= 2 && juice && Math.sin(t / 90) > 0.3 ? 0.55 : 1;
      c.save();
      c.globalAlpha = blink;
      c.translate(x, y + drop + bob);
      c.scale(sc * (1 + Math.sin(t / 210 + b.cell) * 0.03), sc * (1 - Math.sin(t / 210 + b.cell) * 0.03));
      c.drawImage(img, -img.width / 2, -img.height / 2);
      c.restore();
      c.beginPath();
      c.arc(x, y + drop + bob, r + cell * 0.06, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * b.left) / sim.tuning.bubbleLife);
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = Math.max(2, cell * 0.06);
      c.lineCap = 'round';
      c.stroke();
    }
    this.gone = this.gone.filter(g => {
      const u = (t - g.t0) / 450;
      if (u >= 1) return false;
      const [x, y] = this.cellCentre(g.cell);
      const img = bakePopBubble(g.kind, Math.round(cell * 0.44));
      c.save();
      c.globalAlpha = 1 - u;
      c.translate(x, y - u * cell * 0.4);
      c.scale(1 - u * 0.6, 1 - u * 0.6);
      c.drawImage(img, -img.width / 2, -img.height / 2);
      c.restore();
      return true;
    });
    // Aiming: the board dims; Sweep lights the line under the swipe, Meteor shows its target.
    const a = this.aim;
    if (a) {
      c.fillStyle = 'rgba(34,24,58,0.16)';
      c.fillRect(this.bx, this.by, cell * 9, cell * 9);
      const lit = (cells: number[], rgb: string, al: number) => { c.fillStyle = `rgba(${rgb},${al})`; for (const cc of cells) c.fillRect(this.bx + (cc % 9) * cell, this.by + ((cc / 9) | 0) * cell, cell, cell); };
      const pulse = 0.3 + 0.12 * Math.sin(t / 110);
      if (a.kind === 'sweep' && a.press) {
        if (a.line !== null) lit(LINE_CELLS[a.line], '120,255,200', pulse + 0.15);
        else { lit(LINE_CELLS[(a.press.cell / 9) | 0], '120,255,200', pulse * 0.6); lit(LINE_CELLS[9 + (a.press.cell % 9)], '120,255,200', pulse * 0.6); }
      }
      if (a.kind === 'meteor') {
        lit(sim.meteorCells(a.target), '255,110,70', pulse);
        const [x, y] = this.cellCentre(a.target);
        c.save();
        c.translate(x, y);
        c.rotate(t / 700);
        c.strokeStyle = '#FFFFFF';
        c.lineWidth = Math.max(2, cell * 0.08);
        c.setLineDash([cell * 0.35, cell * 0.2]);
        c.beginPath(); c.arc(0, 0, cell * 1.55, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(cell * 0.35, 0); c.lineTo(cell * 0.85, 0); c.stroke(); }
        c.restore();
      }
    }
    // Sweep: the broom runs along the line.
    this.sweeps = this.sweeps.filter(sw => {
      const u = (t - sw.t0) / 340;
      if (u >= 1) return false;
      const row = sw.line < 9, i = row ? sw.line : sw.line - 9;
      const along = -0.5 + u * 10;
      const x = this.bx + (row ? along : i + 0.5) * cell, y = this.by + (row ? i + 0.5 : along) * cell;
      c.save();
      c.translate(x, y);
      if (!row) c.rotate(Math.PI / 2);
      drawPopIcon(c, 'sweep', 0, 0, cell * 1.5);
      c.restore();
      return true;
    });
    // Meteor: a stone with a flame trail streaks in from the top right and lands on the target.
    for (const m of this.meteors) {
      const u = (t - m.t0) / 260;
      if (u < 0 || u >= 1) continue;
      const [x1, y1] = this.cellCentre(m.cell);
      const x0 = x1 + cell * 6, y0 = y1 - cell * 9;
      const e = u * u;
      const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
      const g = c.createLinearGradient(x, y, x + cell * 2.2, y - cell * 3.3);
      g.addColorStop(0, 'rgba(255,200,80,0.95)');
      g.addColorStop(1, 'rgba(255,90,40,0)');
      c.strokeStyle = g;
      c.lineWidth = cell * 0.5;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + cell * 2.2, y - cell * 3.3); c.stroke();
      drawPopIcon(c, 'meteor', x, y, cell * 1.2);
    }
    // Second Wind: white gusts sweep across the board.
    const gu = (t - this.gustAt) / 900;
    if (gu >= 0 && gu < 1 && juice) {
      c.save();
      c.strokeStyle = `rgba(255,255,255,${0.85 * (1 - gu)})`;
      c.lineWidth = cell * 0.12;
      c.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        const y = this.by + cell * (0.8 + k * 1.5), x = this.bx - cell * 2 + (gu * 1.3 + (k % 3) * 0.12) * cell * 12;
        c.beginPath();
        c.moveTo(x - cell * 2.5, y);
        c.quadraticCurveTo(x, y - cell * 0.4, x + cell * 0.6, y - cell * 0.1);
        c.arc(x + cell * 0.6, y - cell * 0.45, cell * 0.35, Math.PI / 2, -Math.PI, true);
        c.stroke();
      }
      c.restore();
    }
    // Undo: a lilac rewind wash over the board.
    const ru = (t - this.rewindAt) / 380;
    if (ru >= 0 && ru < 1) {
      c.fillStyle = `rgba(178,140,255,${0.3 * (1 - ru)})`;
      c.fillRect(this.bx - this.pad, this.by - this.pad, cell * 9 + this.pad * 2, cell * 9 + this.pad * 2);
    }
  }

  /** Power icons flying from the board into their slot, which bounces as one lands. */
  private drawIconFlys(t: number): void {
    if (!this.iconFlys.length) return;
    const c = this.c;
    let landed = false;
    this.iconFlys = this.iconFlys.filter(f => {
      const u = (t - f.t0) / 520;
      if (u < 0) return true;
      const r = this.slotBtns[f.slot].getBoundingClientRect();
      const tx = (r.left + r.width / 2) * this.k, ty = (r.top + r.height / 2) * this.k;
      if (u >= 1) { this.bumpBtn(this.slotBtns[f.slot]); landed = true; return false; }
      const e = u * u * (3 - 2 * u);
      const mx = (f.x0 + tx) / 2, my = Math.min(f.y0, ty) - this.cell * 2;
      const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * tx;
      const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * ty;
      const img = bakePopIcon(f.kind, Math.round(this.cell * 0.9));
      const sc = 1.2 - 0.4 * e;
      c.drawImage(img, x - (img.width * sc) / 2, y - (img.height * sc) / 2, img.width * sc, img.height * sc);
      return true;
    });
    if (landed) this.powerBar();
  }

  /** Popped faces flying up to the checkpoint pill on an arc, shrinking as they go. */
  private drawFlyers(t: number): void {
    if (!this.flyers.length) return;
    const c = this.c;
    const [tx, ty] = this.pillCentre();
    let landed = false;
    this.flyers = this.flyers.filter(f => {
      const u = (t - f.t0) / f.dur;
      if (u >= 1) { landed = true; return false; }
      if (u < 0) return true;
      const e = u * u * (3 - 2 * u);
      const mx = (f.x0 + tx) / 2, my = Math.min(f.y0, ty) - f.lift;
      const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * tx;
      const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * ty;
      const bk = this.art.cells(f.s, [[0, 0]], 'proud');
      const sc = 0.6 - 0.35 * e;
      c.save();
      c.globalAlpha = u > 0.85 ? (1 - u) / 0.15 : 1;
      c.translate(x, y);
      c.rotate(e * 2.4);
      c.scale(sc, sc);
      c.drawImage(bk.canvas, -bk.canvas.width / 2, -bk.canvas.height / 2);
      c.restore();
      return true;
    });
    if (landed) bump(this.pillEl);
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
        // A new tray flips in, one shape after another, 60 ms apart, then bobs gently.
        const u = (t - this.trayIn - i * 60) / 240;
        if (u < 1) sc = rest * (u <= 0 ? 0 : backOut(u));
        cy += Math.sin(t / 650 + i * 1.9) * this.cell * 0.035;
        // All Clear: the tray's Blocklings jump.
        const v = (t - this.hopAt - i * 70) / 560;
        if (v >= 0 && v < 1) cy -= Math.sin(v * Math.PI) * this.cell * 0.7;
      }
      if (sc <= 0.01) continue;
      const face: Expression = !fits ? 'worried' : sp ? 'dizzy' : t - this.hopAt < 700 ? 'proud' : 'idle';
      const bk = this.art.shape(sl.s, sl.q, 1, face);
      const img = fits ? bk.canvas : this.art.grey(bk.canvas);
      // Spin on: turning arrows round every shape that can turn; a tap snaps it round in 80 ms.
      if (sim.spinning && sim.canTurn(i) && !sp) this.spinRing(cx, cy, t, i === BAG ? this.bag.s * 0.5 : Math.min(this.trayH * 0.55, this.W / 6 * 0.85));
      const su = (t - this.spinAt[i]) / 110;
      const rot = su >= 0 && su < 1 ? -(Math.PI / 2) * (1 - backOut(su)) : 0;
      c.save();
      c.translate(cx, cy);
      if (rot) c.rotate(rot);
      c.scale(sc, sc);
      c.drawImage(img, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
      c.restore();
    }
    // Shapes leaving the tray (Fresh Deal, Second Wind): they drop and fade as the new ones flip in.
    this.leaving = this.leaving.filter(l => {
      const u = (t - l.t0) / 260;
      if (u >= 1) return false;
      if (u < 0) return true;
      const bk = this.art.shape(l.s, l.q, 1, 'dizzy');
      c.save();
      c.globalAlpha = 1 - u;
      c.translate(l.x, l.y + u * u * this.cell * 1.6);
      c.rotate(u * 0.5);
      c.scale(l.scale * (1 - u * 0.3), l.scale * (1 - u * 0.3));
      c.drawImage(bk.canvas, -bk.canvas.width * bk.originX, -bk.canvas.height * bk.originY);
      c.restore();
      return true;
    });
    c.globalAlpha = 1;
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

/** Restarts an element's bump animation. */
function bump(el: HTMLElement): void {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
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

/** A power colour washed toward Paper by `t` (0 Paper, 1 the colour), as a hex string. */
function wash(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16), P = [0xff, 0xf7, 0xe8];
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(P[i] + (v - P[i]) * t));
  return `#${ch.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
