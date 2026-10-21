// The play scene: runs the sim on a fixed step and draws it with the art kit. Everything here is
// presentation; the sim never reads from the view, so juice can't change physics (gameplay.md §11).
//
// World px: x * ppb, y down (py = -y * ppb), ground under the pedestal at y = -1. The main camera
// scrolls and zooms (12 to 15 blocks across). Layers are depths.

import * as Phaser from 'phaser';
import {
  ArtTextures, Backdrop, BIOMES as ART_BIOMES, BUNTING_KEYS, BlocklingView, Celebration, CheckpointLine, GuideView, HazardFx, JUNK_KINDS, PbMarker, POWER_COLORS, PowerBubble, SkyClock, VFX,
  WindView, windDrifters,
  biomeForCheckpoint, rimAmount, type Expression, type Finish, type GuideState, type TexRef, type VfxName,
} from '@art/index.ts';
import { DT, Sim, type Bubble, type PieceView, type PowerKind, type SecondWindMode, type Shot, type Tint } from '../sim/sim.ts';
import { SHAPES, extents } from '../sim/shapes.ts';
import { biomeFor, type Tuning } from '../sim/tuning.ts';
import { crackPaths } from './cracks.ts';
import { Particles, Shaker, TimeControl, easeElasticOut, type ParticleOpts } from './fx.ts';
import { Hud, POWER_NAMES, type HazardWant } from './hud.ts';
import { Gestures } from './input.ts';
import type { LabState, ViewSettings } from './panel.ts';
import type { RunStart } from './records.ts';
import { AMBER, CONFETTI, GOLD, INK, MINT, XP_VIOLET, num } from './palette.ts';

export interface BusEvent { name: string; step: number; payload: Record<string, unknown> }

export interface SceneHooks {
  hud: Hud;
  lab: LabState;
  /** Every JuiceBus event, after the view has handled it (run records). */
  onEvent?(e: BusEvent, sim: Sim): void;
  /** A new sim was made (connect audio to its bus here). */
  onRunStart?(sim: Sim, info: RunStart): void;
  /** The menu's demo tower was made: not a run, so nothing is recorded. */
  onDemo?(sim: Sim): void;
  /** After every fixed step. */
  onStep?(sim: Sim): void;
  onRunOver?(sim: Sim, payload: Record<string, unknown>): void;
  onFrame?(ms: number): void;
  /** View-side juice for Sound: hitstop, slowmo, pb_crossed (gameplay.md §11.1). */
  onJuice?(name: string, payload: Record<string, unknown>): void;
  /** Whether the new run starts with Second Wind ready (the day's first run, or the upgrade). */
  secondWind?(): SecondWindMode;
  /** Whether reaching biome `biome` (0 = Meadow) earns its postcard for the first time. */
  newPostcard?(biome: number): boolean;
  /** Whether this player has yet to see a brittle shape (its card shows once). */
  brittleIntro?(): boolean;
}

interface PieceSprite {
  id: number;
  shape: string;
  view: BlocklingView;
  squash: number;
  squashAt: number;
  stone: number;
  stoneAt: number | null;
  lost: boolean;
  gone: boolean;
}

interface Pose { x: number; y: number; a: number }

const ACROSS = 12;
/** The longest the run-over panorama waits at the top for the backdrop to bake its path (ms). */
const PANO_WAIT = 1000;
const ACROSS_MAX = 15;
const TAU = Math.PI * 2;
const PEDESTAL_LEGS = 0.4; // deck 0.6 + legs 0.4 = the sim's 1-block plinth
/** Blocks of settled height between celebrations (height_milestone, gameplay.md §11.1). */
const MILESTONE = 25;
const D = { slab: 5, line: 8, piece: 10, fx: 30, front: 35, guide: 40, bubble: 45, ctrl: 50, text: 60 };

// The main menu's demo tower: [shape, x, rot], dropped one at a time onto the plinth.
const DEMO: [string, number, number][] = [['O', -2, 0], ['O', 2, 0], ['I', 0, 0], ['T', -1.5, 2], ['L', 1.5, 0], ['O', 0, 0], ['I', 0, 1]];
const DEMO_TUNING: Partial<Tuning> = { firstGap: 60, gapCap: 60, infiniteBudget: true, infiniteHearts: true, powerUps: false, gusts: false };
const ORBIT = ART_BIOMES.findIndex(b => b.id === 'orbit'); // landings throw stardust from here up
const STONE_CHIP = 0xb9b1a6;
const WIND_BLUE = POWER_COLORS.wind;

export class PlayScene extends Phaser.Scene {
  sim!: Sim;
  hooks!: SceneHooks;
  paused = false;
  started = false;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private ppb = 0;     // world px per block (zoom 1 = 12 blocks across)
  private zoom = 1;

  private art!: ArtTextures;
  private backdrop!: Backdrop;
  private guide!: GuideView;
  private skyClock = new SkyClock();
  private lines: CheckpointLine[] = []; // claimed lines still kept, then the active one
  private pb!: PbMarker;

  private particles!: Particles;
  private shaker = new Shaker();
  private timeCtl = new TimeControl();
  private gestures!: Gestures;
  private view!: ViewSettings;

  private sprites = new Map<number, PieceSprite>();
  private slabs = new Map<number, { img: Phaser.GameObjects.Image; born: number; landed: boolean }>();
  private ctrlSprite: PieceSprite | null = null;
  private ctrl = { x: 0, ang: 0, angV: 0, spawnAt: 0, nopeAt: -1, lastX: 0, lean: 0, shape: '', lift: 0, liftAt: 0, cushionAt: 0 };
  private prev = new Map<number, Pose>();
  private cur = new Map<number, Pose>();
  private prevCtrlY = 0;
  private curCtrlY = 0;
  private views: PieceView[] = [];
  private acc = 0;
  private cam = { x: 0, y: 0, across: ACROSS, lowSince: -1, peek: 0, peekTarget: 0 };
  private tint = { shown: 'ok' as Tint, pending: 'ok' as Tint, since: 0 };
  private stoneWave: { top: number; at: number } | null = null;
  private rowWave: { x0: number; at: number } | null = null;
  private lastSettledId = -1;
  bestHeight = 0;
  private pbCrossed = false;
  private overAt = -1;
  private slowOn = false;
  private overPayload: Record<string, unknown> | null = null;
  private bubbleView: { id: number; view: PowerBubble } | null = null;
  private poppedBubbles: PowerBubble[] = []; // still playing their collect or fade
  private taughtBubble = false;
  private wind!: WindView; // Art's gust telegraph and streaks: information, so they stay with juice off
  private hz!: HazardFx; // Art's space hazards (junk, meteors, dust devils): information too
  private party!: Celebration; // Art's fireworks, balloons, rainbow and comets: juice, so off with it
  private nextMilestone = MILESTONE;
  private hzShots = new Map<number, Shot['phase']>(); // what's drawn for each shot
  private hzDevil: { id: number; phase: 'warn' | 'blow' } | null = null;
  private dustPuffAt = 0; // sim s
  private cracks!: Phaser.GameObjects.Graphics;     // on brittle pieces in the tower
  private ctrlCracks!: Phaser.GameObjects.Graphics; // on the shape in hand
  private brittleShown = false;
  private demoing = false;
  private demoIdx = 0;
  private demoAt = 0;
  // Run over: the camera glides down the whole tower (the panorama), with the sky following height.
  // The glide waits (up to PANO_WAIT ms) for the backdrop to bake the biomes on its path.
  private pano: { from: number; to: number; t0: number; dur: number; done: (() => void) | null; start: number } | null = null;
  private skyMarks: { y: number; sp: number }[] = [];

  private readyResolve: () => void = () => {};
  /** Resolves once create() has run and the first sim exists. */
  readonly ready = new Promise<void>(r => { this.readyResolve = r; });

  constructor() { super('play'); }

  init(data: { hooks: SceneHooks }): void {
    this.hooks = data.hooks;
    this.view = this.hooks.lab.view;
  }

  // ---------------------------------------------------------------- setup

  create(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.scale.width;
    this.H = this.scale.height;
    this.ppb = this.W / ACROSS;
    // The canvas already renders at device resolution, so the kit bakes at 1 texture px per game px.
    this.art = new ArtTextures(this, { cellPx: this.ppb, texScale: 1 });
    this.art.prewarm(Object.keys(SHAPES), { finishes: ['wood'], hazards: true, celebrations: true });
    this.backdrop = new Backdrop(this, { width: this.W, height: this.H, texScale: 1, frontDepth: D.front, reduceMotion: this.view.reducedMotion });
    this.guide = new GuideView(this.art, D.guide);
    this.pb = new PbMarker(this.art, D.line - 0.1);
    this.particles = new Particles(this, D.fx);
    this.wind = new WindView(this.art, { width: this.W, height: this.H, drifters: 'leaves' });
    this.hz = new HazardFx(this.art, { depth: D.fx });
    this.party = new Celebration(this.art, { width: this.W, height: this.H });
    this.cracks = this.add.graphics().setDepth(D.piece + 2);
    this.ctrlCracks = this.add.graphics().setDepth(D.ctrl + 1);

    this.gestures = new Gestures(this.game.canvas.parentElement ?? this.game.canvas, {
      ctrlX: () => (this.started && !this.paused && this.sim?.ctrl ? this.sim.ctrl.xTarget : null),
      blockPx: () => (this.ppb * this.zoom) / this.dpr,
      sensitivity: () => this.sim?.tuning.sensitivity ?? 1,
      moveTo: x => this.intent({ type: 'moveTo', x }),
      rotate: dir => this.intent({ type: 'rotate', dir }),
      soft: on => this.intent({ type: 'softDrop', on }),
      hard: lockX => this.intent({ type: 'hardDrop', lockX }),
      hold: () => this.intent({ type: 'hold' }),
      peek: b => { this.cam.peekTarget = b === null ? 0 : Math.min(b, 30); },
      splitTap: () => this.view.splitTap,
    });
    this.applyView(this.view);
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.W = size.width; this.H = size.height;
      this.cameras.main.setSize(this.W, this.H);
      this.backdrop.resize(this.W, this.H);
      this.wind.resize(this.W, this.H);
      this.party.resize(this.W, this.H);
    });
    this.events.once('shutdown', () => this.gestures.destroy());
    try { this.bestHeight = Number(localStorage.getItem('shape-tower-best') ?? 0) || 0; } catch { /* none */ }
    this.newRun();
    this.readyResolve();
  }

  private text(s: string, sizePt: number, color: string): Phaser.GameObjects.Text {
    return this.add.text(0, 0, s, {
      fontFamily: 'Fredoka, Nunito, system-ui, sans-serif', fontSize: `${Math.round(sizePt * this.dpr)}px`, fontStyle: '700',
      color, stroke: INK, strokeThickness: Math.round(4 * this.dpr),
    });
  }

  // ---------------------------------------------------------------- runs

  newRun(demo = false): void {
    this.sim?.dispose();
    for (const s of this.sprites.values()) s.view.destroy();
    this.sprites.clear();
    if (this.ctrlSprite) { this.ctrlSprite.view.destroy(); this.ctrlSprite = null; }
    for (const s of this.slabs.values()) s.img.destroy();
    this.slabs.clear();
    this.particles?.clear();
    this.wind?.clear();
    this.hz?.clear();
    this.party?.clear();
    this.nextMilestone = MILESTONE;
    this.hzShots.clear();
    this.hzDevil = null;
    this.dustPuffAt = 0;
    this.backdrop?.setTilt(0);
    this.guide.hide();
    for (const l of this.lines) l.destroy();
    this.lines = [];
    this.pb.hide();
    this.bubbleView?.view.destroy();
    this.bubbleView = null;
    for (const b of this.poppedBubbles) b.destroy();
    this.poppedBubbles = [];
    this.prev.clear();
    this.cur.clear();
    this.views = [];
    this.acc = 0;
    this.overAt = -1;
    this.overPayload = null;
    this.pbCrossed = false;
    this.skyClock.set(0);
    this.pano = null;
    this.backdrop?.endTour();
    this.skyMarks = [{ y: -1, sp: 0 }];
    this.cam.x = 0;
    this.cam.y = -1 + 0.3 * this.H / this.ppb;
    this.cam.across = ACROSS;
    this.hooks.hud.reset();
    this.demoing = demo;
    if (demo) {
      this.started = false;
      this.demoIdx = 0;
      this.demoAt = performance.now() + 500;
      this.sim = new Sim({ seed: 7, tuning: { ...this.hooks.lab.tuning, ...DEMO_TUNING }, autoSpawn: false, rookieOpening: false, secondWind: 'off' });
      this.hooks.onDemo?.(this.sim);
      for (const e of this.sim.drainEvents()) this.onEvent(e);
      return;
    }
    let first = false;
    try { first = !localStorage.getItem('shape-tower-played'); localStorage.setItem('shape-tower-played', '1'); } catch { /* none */ }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const info: RunStart = { seed, tuning: { ...this.hooks.lab.tuning }, rookieOpening: first, secondWind: this.hooks.secondWind?.() ?? 'earn', juice: this.view.juice !== false };
    this.sim = new Sim({ seed, tuning: { ...info.tuning }, autoSpawn: true, rookieOpening: first, secondWind: info.secondWind });
    this.hooks.hud.showHint();
    this.hooks.onRunStart?.(this.sim, info);
    for (const e of this.sim.drainEvents()) this.onEvent(e);
  }

  start(): void { this.started = true; }

  /** The main menu's idle tower: a few shapes dropped one by one. No run, no controls. */
  demo(): void { this.newRun(true); }

  /**
   * Run over: the camera glides from the top of the tower down to the ground through every biome
   * visited, then calls done. Reduce Motion skips it.
   */
  panorama(done: () => void): void {
    const visH = this.H / (this.W / this.cam.across);
    const to = -1 + 0.3 * visH;
    const from = this.cam.y;
    if (this.view.reducedMotion || from - to < 2) { done(); return; }
    const dur = Math.max(1.4, Math.min(4.5, 1.2 + (from - to) / 30)) * 1000;
    this.skyMarks.push({ y: from, sp: this.skyClock.sp });
    this.backdrop.prepareTour(this.skyClock.sp, this.skyAt(to));
    const now = performance.now();
    this.pano = { from, to, t0: Infinity, dur, done, start: now };
  }

  /** A tap during the panorama skips to the end. */
  skipPanorama(): void {
    const p = this.pano;
    if (!p?.done) return;
    p.t0 = performance.now() - p.dur;
    this.backdrop.tourGlide();
  }

  /** The sky position for a camera height during the panorama: between the claims' marks. */
  private skyAt(y: number): number {
    const m = this.skyMarks;
    if (y <= m[0].y) return m[0].sp;
    for (let i = 1; i < m.length; i++) {
      if (y <= m[i].y) {
        const t = (y - m[i - 1].y) / Math.max(0.001, m[i].y - m[i - 1].y);
        return m[i - 1].sp + (m[i].sp - m[i - 1].sp) * t;
      }
    }
    return m[m.length - 1].sp;
  }

  /** The HUD's power slots and Second Wind button. */
  usePower(slot: number): void { this.intent({ type: 'power', slot }); }
  useSecondWind(): void { this.intent({ type: 'secondWind' }); }
  hold(): void { this.intent({ type: 'hold' }); }

  retune(patch: Partial<Tuning>): void { this.sim.retune(patch); }

  applyView(v: ViewSettings): void {
    this.view = v;
    if (this.bubbleView) this.bubbleView.view.reduceMotion = v.reducedMotion;
    // Gate 1's juice off: no shake, hit-stop, slow motion, particles, squash or celebration toasts.
    const juice = v.juice !== false;
    this.shaker.scale = v.reducedMotion || !juice ? 0 : v.shake;
    this.timeCtl.enabled = !v.reducedMotion && juice;
    this.particles.enabled = juice;
    this.guide.reduceMotion = v.reducedMotion;
    this.backdrop.reduceMotion = v.reducedMotion;
    this.wind.reduceMotion = v.reducedMotion;
    this.hz.reduceMotion = v.reducedMotion;
    if (this.party) this.party.reduceMotion = v.reducedMotion;
    for (const l of this.lines) l.reduceMotion = v.reducedMotion;
    this.pb.reduceMotion = v.reducedMotion;
    this.guide.opacity = v.guideOpacity ?? 1;
    for (const s of this.sprites.values()) s.view.setFaces(v.faces);
    this.ctrlSprite?.view.setFaces(v.faces);
  }

  private hitstop(now: number, ms: number): void {
    if (!this.timeCtl.enabled) return;
    this.timeCtl.hitstop(now, ms);
    this.hooks.onJuice?.('hitstop', { ms });
  }

  private slowmo(now: number, scale: number, ms: number): void {
    if (!this.timeCtl.enabled) return;
    this.timeCtl.slowmo(now, scale, ms);
    this.slowOn = true;
    this.hooks.onJuice?.('slowmo', { on: true, timeScale: scale });
  }

  private intent(i: Parameters<Sim['intent']>[0]): void {
    if (!this.started || this.paused || this.sim.state !== 'playing') return;
    this.sim.intent(i);
    if (i.type !== 'softDrop') this.hooks.hud.hideHint();
  }

  // ---------------------------------------------------------------- loop

  update(_time: number, deltaMs: number): void {
    const now = performance.now();
    const dt = Math.min(deltaMs, 50) / 1000;
    // Run records want the real frame time (QA-009): Phaser's delta is smoothed over 10 frames and caps
    // stalls, so hitches would vanish from the stats. Gameplay keeps the smoothed one.
    this.hooks.onFrame?.(this.game.loop.rawDelta);
    this.gestures.update(now);
    if (this.demoing && !this.paused && this.demoIdx < DEMO.length && now >= this.demoAt) {
      const [shape, x, rot] = DEMO[this.demoIdx++];
      this.sim.placePiece({ shape, x, y: this.sim.height().provisional + 3.5, rot, as: 'dynamic' });
      this.demoAt = now + 750;
    }
    const timeScale = (this.started || this.demoing) && !this.paused ? this.timeCtl.scale(now) : 0;
    if (this.slowOn && this.timeCtl.scale(now) === 1) { this.slowOn = false; this.hooks.onJuice?.('slowmo', { on: false, timeScale: 1 }); }
    this.acc += dt * timeScale;
    let n = 0;
    while (this.acc >= DT && n < 4) { this.stepSim(); this.acc -= DT; n++; }
    if (n === 4) this.acc = Math.min(this.acc, DT);
    this.render(dt, Math.max(0, Math.min(1, this.acc / DT)), now, timeScale);
    if (this.overPayload && now >= this.overAt) {
      const p = this.overPayload;
      this.overPayload = null;
      this.hooks.onRunOver?.(this.sim, p);
    }
  }

  private stepSim(): void {
    for (const [id, t] of this.cur) this.prev.set(id, t);
    this.prevCtrlY = this.curCtrlY;
    this.sim.step();
    this.hooks.onStep?.(this.sim);
    this.views = this.sim.pieceViews();
    const next = new Map<number, Pose>();
    for (const v of this.views) {
      const pose = { x: v.x, y: v.y, a: Math.atan2(v.s, v.c) };
      next.set(v.id, pose);
      if (!this.prev.has(v.id)) this.prev.set(v.id, pose);
    }
    for (const id of this.prev.keys()) if (!next.has(id)) this.prev.delete(id);
    this.cur = next;
    if (this.sim.ctrl) this.curCtrlY = this.sim.ctrl.y;
    for (const e of this.sim.drainEvents()) this.onEvent(e);
  }

  // ---------------------------------------------------------------- events

  private onEvent(e: BusEvent): void {
    const now = performance.now();
    const p = e.payload as Record<string, any>;
    switch (e.name) {
      case 'piece_spawned': {
        this.spawnCtrlSprite(now);
        // The first brittle shape a player sees, in hand or in the preview, gets its card (§4.3).
        const next = (p.nextBrittle ?? []) as boolean[];
        if (!this.brittleShown && !this.demoing && (p.brittle || next.some(Boolean)) && (this.hooks.brittleIntro?.() ?? true)) {
          this.brittleShown = true;
          this.hooks.hud.brittleCard(p.brittle ? p.shape : (p.next as string[])[next.indexOf(true)], this.view.reducedMotion);
        }
        break;
      }
      case 'piece_rotated': if (p.blocked) this.ctrl.nopeAt = now; break;
      case 'piece_landed': this.onLanded(p, now); break;
      case 'piece_settled': {
        this.lastSettledId = p.id;
        const s = this.sprites.get(p.id);
        if (s && p.grade === 'clean') this.glint(s, MINT);
        break;
      }
      case 'perfect': {
        const s = this.sprites.get(this.lastSettledId);
        if (s) {
          s.view.flash('proud', 1.2);
          this.glint(s, GOLD);
          this.sparkle(s, GOLD);
          this.popNear(s, 'PERFECT!', GOLD, 22);
          if (p.combo > 1) this.popNear(s, `COMBO ×${p.combo}`, '#FFFFFF', 15, 0.9);
        }
        break;
      }
      case 'clutch': {
        this.slowmo(now, 0.4, 500);
        const s = this.sprites.get(this.lastSettledId);
        if (s) this.popNear(s, 'CLUTCH!', XP_VIOLET, 22);
        break;
      }
      case 'bond_formed': {
        const pos = p.pos as { x: number; y: number };
        if (p.glue) {
          // Glued bonds throw gold sparks, each pointing along its flight.
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * TAU, v = this.ppb * (2 + Math.random() * 2.5);
            const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
            this.particles.spawn(pos.x * this.ppb, -pos.y * this.ppb, vx, vy, this.fx('spark', 0.4, 0.15, { tint: num(GOLD), life: 0.35, drag: 2, angle: Math.atan2(vy, vx), blend: Phaser.BlendModes.ADD }));
          }
          break;
        }
        for (let i = 0; i < 3; i++) this.particles.spawn((pos.x + (i - 1) * 0.3) * this.ppb, -pos.y * this.ppb, 0, 0, this.fx('dot', 0.14, 0.02, { life: 0.25, alpha: 0.9, blend: Phaser.BlendModes.ADD }));
        break;
      }
      case 'bond_broken': {
        const pos = p.pos as { x: number; y: number };
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * TAU, v = this.ppb * (2 + Math.random() * 3);
          this.particles.spawn(pos.x * this.ppb, -pos.y * this.ppb, Math.cos(a) * v, Math.sin(a) * v - this.ppb * 3, this.fx('chip', 0.24, 0.12, { tint: STONE_CHIP, life: 0.6, gravity: this.ppb * 20, spin: 8 }));
        }
        this.particles.spawn(pos.x * this.ppb, -pos.y * this.ppb, 0, 0, this.fx('crack', 0.8, 0.8, { life: 0.7 }));
        this.shaker.add(0.18);
        break;
      }
      case 'row_solid': this.onRows(p, now); break;
      case 'row_ready': this.onRowsReady(p); break;
      case 'brittle_strain': this.onStrain(p); break;
      case 'brittle_broke': this.onCrumble(p, now); break;
      case 'brittle_mended': {
        const s = this.sprites.get(p.id);
        if (s) { this.glint(s, GOLD); this.popNear(s, `MENDED +${Math.round(p.points)}`, GOLD, 18); }
        break;
      }
      case 'brittle_tossed': {
        const pose = this.cur.get(p.id);
        if (pose) this.pop('FREE TOSS', Math.max(this.cam.x - this.cam.across / 2 + 2, Math.min(this.cam.x + this.cam.across / 2 - 2, pose.x)), this.sim.foundation.top + 1.5, MINT, 16);
        break;
      }
      case 'piece_lost': {
        if (p.brittle) { const s = this.sprites.get(p.id); if (s) s.lost = true; break; } // free: no fuss
        this.slowmo(now, 0.35, 500);
        const s = this.sprites.get(p.id);
        if (s) {
          s.lost = true;
          s.view.setExpression('panic');
          const pose = this.cur.get(p.id);
          if (pose) this.hooks.hud.lostArrow(0.5 + (pose.x - this.cam.x) / this.cam.across);
        }
        this.shaker.add(0.2);
        break;
      }
      case 'budget_low': this.hooks.hud.pulseBricks(); break;
      // Gusts and crosswind are WindView's; junk, meteors and dust devils draw from the sim each frame (drawHazards).
      case 'hazard_warning':
        if (p.type === 'gust') {
          this.wind.drifters = windDrifters(this.biomeIndex());
          this.wind.warn(p.dir, p.eta);
        }
        if (p.intro) this.hooks.hud.hazardCard(p.type, this.view.reducedMotion);
        break;
      case 'hazard_start':
        if (p.type === 'gust') this.wind.start(p.strength, p.dir);
        else if (p.type === 'crosswind') { this.wind.drifters = windDrifters(this.biomeIndex()); this.wind.steady(p.strength, p.dir); }
        break;
      case 'hazard_end':
        if (p.type === 'gust') this.wind.end();
        else if (p.type === 'crosswind') this.wind.steady(0);
        break;
      case 'hazard_hit': this.onHazardHit(p); break;
      case 'checkpoint_cancelled': this.pop('Wobbly!', this.sim.foundation.x, this.sim.lineY + 0.6, AMBER, 18); break;
      case 'checkpoint_claimed':
        this.onClaim(p, now);
        this.skyMarks.push({ y: this.sim.foundation.top, sp: this.skyClock.sp });
        this.backdrop.setCosmos(this.sim.checkpoint); // Deep Cosmos changes palette every 6 checkpoints
        break;
      case 'biome_entered':
        this.hooks.hud.biomeTitle(Number(p.id) - 1, { newPostcard: this.hooks.newPostcard?.(Number(p.id) - 1) ?? false, still: this.view.reducedMotion });
        if (this.juice) this.backdrop.arrival(Number(p.id) - 1); // birds for Treetops, the cloud punch-through for Cloudlands
        break;
      case 'bubble_spawned': this.showBubble(now); break;
      case 'bubble_expired': this.dropBubble(false, p); break;
      case 'power_collected': this.dropBubble(true, p); this.hooks.hud.bumpPower(p.slot as number); break;
      case 'power_granted': {
        // An S grade or checkpoint 2 hands one over: it shows after the claim's own toasts.
        const f = this.sim.foundation;
        const kind = p.kind as PowerKind;
        this.time.delayedCall(900, () => {
          this.pop(`+ ${POWER_NAMES[kind].toUpperCase()}`, f.x, f.top + 3, POWER_COLORS[kind], 18);
          this.hooks.hud.bumpPower(p.slot as number);
        });
        break;
      }
      case 'power_refused': this.hooks.hud.bumpPower(typeof p.slot === 'number' ? p.slot : -1, true); break;
      case 'power_used': this.onPowerUsed(p, now); break;
      case 'pieces_swept': {
        for (const q of p.pieces as { x: number; y: number }[]) this.poof(q.x, q.y, POWER_COLORS.clean, 10);
        break;
      }
      case 'second_wind_ready': {
        this.hooks.hud.bumpPower(-1);
        if (p.how === 'earned') this.time.delayedCall(1200, () => this.pop('SECOND WIND READY', this.sim.foundation.x, this.sim.foundation.top + 3.6, WIND_BLUE, 18));
        break;
      }
      case 'second_wind': this.onSecondWind(now); break;
      case 'piece_lifted':
        // The sim moves the shape in hand clear of a new slab in one step; ease it up instead.
        this.ctrl.lift = this.prevCtrlY - this.curCtrlY;
        this.ctrl.liftAt = now;
        this.prevCtrlY = this.curCtrlY;
        break;
      case 'run_over': {
        this.slowmo(now, 0.4, 900);
        this.overAt = now + 1300;
        this.overPayload = p;
        const h = Number(p.height) - this.sim.foundations[0].top;
        if (h > this.bestHeight) { this.bestHeight = h; try { localStorage.setItem('shape-tower-best', String(h)); } catch { /* none */ } }
        for (const s of this.sprites.values()) if (!s.lost && s.stone < 1) s.view.setExpression('dizzy');
        break;
      }
    }
    this.hooks.onEvent?.(e, this.sim);
  }

  private onLanded(p: Record<string, any>, now: number): void {
    const id = p.id as number;
    const impact = p.impact as number;
    if (this.ctrlSprite) {
      const s = this.ctrlSprite;
      this.ctrlSprite = null;
      s.id = id;
      s.view.setDepth(D.piece);
      this.sprites.set(id, s);
      s.squash = this.juice ? Math.max(0.25, impact) : 0;
      s.squashAt = now;
      s.view.setExpression('idle').impact(Math.max(0.4, impact));
    }
    // Dust at the bottom edge, coloured by biome (§7.1).
    const pose = p.pose as { x: number; y: number; rot: number };
    const e = extents(p.shape, pose.rot);
    const by = -(pose.y + e.minY) * this.ppb;
    const nDust = Math.round(4 + 8 * impact);
    const bi = this.biomeIndex();
    const dust = num(ART_BIOMES[bi].dust);
    for (let i = 0; i < nDust; i++) {
      const fx = pose.x + e.minX + Math.random() * (e.maxX - e.minX);
      const dir = fx < pose.x ? -1 : 1;
      const o = bi >= ORBIT
        ? this.fx('stardust', 0.2 + impact * 0.15, 0.05, { tint: dust, life: 0.6, drag: 3, spin: 4, blend: Phaser.BlendModes.ADD })
        : this.fx('puff', 0.25 + impact * 0.2, 0.55, { tint: dust, life: 0.45, drag: 4, alpha: 0.85 });
      this.particles.spawn(fx * this.ppb, by, dir * this.ppb * (1 + Math.random() * 2.5) * (0.4 + impact), -this.ppb * (0.3 + Math.random()), o);
    }
    if (impact > 0.5) this.shaker.add(0.32 * impact);
  }

  private onRows(p: Record<string, any>, now: number): void {
    this.hitstop(now, 50);
    const count = p.count as number;
    const w = p.width as number, x0 = (p.x as number) - w / 2;
    for (const ry of p.rows as number[]) {
      const bar = this.add.rectangle(x0 * this.ppb, -ry * this.ppb, this.ppb * 0.7, this.ppb * 1.1, 0xffffff, 0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(D.fx);
      this.tweens.add({ targets: bar, x: (x0 + w) * this.ppb, duration: Math.max(160, w * 40), ease: 'Sine.InOut', onComplete: () => this.tweens.add({ targets: bar, alpha: 0, duration: 150, onComplete: () => bar.destroy() }) });
    }
    this.rowWave = { x0, at: now };
    const words = ['', 'SOLID!', 'DOUBLE!', 'TRIPLE!', 'TOWERING!'];
    this.toast(words[Math.min(4, count)], p.x as number, Math.max(...(p.rows as number[])) + 1.2, '#FFFFFF', 24 + count * 2);
    this.shaker.add(0.22 + 0.06 * count);
  }

  /** Full rows waiting for the set streak: a faint outline across each, and the meter pulses. Information, so it shows with juice off too. */
  /** A brittle shape cracks further: chips fly, and at the last stage it creaks before it breaks. */
  private onStrain(p: Record<string, any>): void {
    const pose = this.cur.get(p.id);
    if (!pose || p.stage === 0) return;
    const u = this.ppb;
    for (let i = 0; i < 3 + 2 * p.stage; i++) {
      const a = Math.random() * TAU, v = u * (1.5 + Math.random() * 2);
      this.particles.spawn((pose.x + (Math.random() - 0.5)) * u, -pose.y * u, Math.cos(a) * v, Math.sin(a) * v - u * 2, this.fx('chip', 0.2, 0.1, { tint: STONE_CHIP, life: 0.5, gravity: u * 20, spin: 8 }));
    }
    this.shaker.add(0.06 * p.stage);
    if (p.stage === 3) this.pop('CREAK!', pose.x, pose.y + 1, AMBER, 18);
  }

  /** A brittle shape gives way: a burst of dust and chips from each of its cells. */
  private onCrumble(p: Record<string, any>, now: number): void {
    const u = this.ppb;
    for (const c of p.cells as { x: number; y: number }[]) {
      this.poof(c.x, c.y, AMBER, 4);
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU, v = u * (2 + Math.random() * 3);
        this.particles.spawn(c.x * u, -c.y * u, Math.cos(a) * v, Math.sin(a) * v - u * 3, this.fx('chip', 0.3, 0.14, { tint: STONE_CHIP, life: 0.7, gravity: u * 20, spin: 8 }));
      }
    }
    this.shaker.add(0.4);
    this.slowmo(now, 0.4, 450);
    this.pop('CRUMBLE!', p.x, p.y + 1.2, AMBER, 22);
  }

  /** Crack lines over a brittle shape at pose (x, y, a), in blocks (y up). */
  private drawCracks(g: Phaser.GameObjects.Graphics, shape: string, stage: number, x: number, y: number, a: number): void {
    const u = this.ppb, c = Math.cos(a), s = Math.sin(a);
    const pt = (lx: number, ly: number): [number, number] => [(x + lx * c - ly * s) * u, -(y + lx * s + ly * c) * u];
    const paths = crackPaths(shape, stage);
    // A light edge under a dark line reads as a crack on any colour. From stage 2 the edge widens,
    // and at stage 3 it flickers while the shape creaks.
    const edge = stage < 2 ? 0.5 : stage === 2 ? 0.7 : 0.55 + 0.4 * Math.abs(Math.sin(performance.now() / 60));
    const layers: [number, number, number][] = [[stage < 2 ? 0.13 : 0.2, 0xffffff, edge], [stage < 2 ? 0.075 : 0.095, num(INK), 0.85]];
    for (const [w, col, al] of layers) {
      g.lineStyle(Math.max(1.5, u * w), col, al);
      for (const path of paths) {
        g.beginPath();
        path.forEach(([lx, ly], i) => { const [px, py] = pt(lx, ly); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
        g.strokePath();
      }
    }
  }

  private onRowsReady(p: Record<string, any>): void {
    this.hooks.hud.pulseSet();
    const w = p.width as number, x = p.x as number;
    for (const ry of p.rows as number[]) {
      const r = this.add.rectangle(x * this.ppb, -ry * this.ppb, w * this.ppb, this.ppb * 0.96).setStrokeStyle(Math.max(2, this.ppb * 0.06), 0xffffff, 0.7).setDepth(D.fx);
      this.tweens.add({ targets: r, alpha: 0, delay: 350, duration: 650, onComplete: () => r.destroy() });
    }
  }

  private onClaim(p: Record<string, any>, now: number): void {
    this.hitstop(now, 90);
    this.time.delayedCall(90, () => this.slowmo(performance.now(), 0.5, 300));
    const f = this.sim.foundation; // the new slab
    const lineY = f.top - this.sim.tuning.slabThickness;
    // The bunting pops off, the rope turns gold and a flag plants beside the tower (§7.2).
    this.lines[this.lines.length - 1]?.claim((f.x - f.width / 2) * this.ppb, (f.x + f.width / 2) * this.ppb);
    this.stoneWave = { top: lineY, at: now };
    if (!this.view.reducedMotion && this.juice) this.hooks.hud.flash(0.2);
    // Flash, rays and a gold shockwave, then confetti and tiny shapes in every shape colour (§7.2).
    const fx0 = f.x * this.ppb, fy = -lineY * this.ppb;
    this.particles.spawn(fx0, fy, 0, 0, this.fx('flash', 2, 6, { life: 0.25, alpha: 0.9, blend: Phaser.BlendModes.ADD }));
    this.particles.spawn(fx0, fy, 0, 0, this.fx('rays', 3, 7, { tint: num(GOLD), life: 0.9, alpha: 0.6, spin: 0.6, blend: Phaser.BlendModes.ADD }));
    this.particles.spawn(fx0, fy, 0, 0, this.fx('shockwave', 1, 10, { tint: num(GOLD), life: 0.6, alpha: 0.9, blend: Phaser.BlendModes.ADD }));
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = this.ppb * (6 + Math.random() * 9);
      const o = i % 3 === 0
        ? this.fx(`mini_${BUNTING_KEYS[i % BUNTING_KEYS.length]}` as VfxName, 1, 0.7, {})
        : this.fx('confetti', 0.2, 0.14, { tint: CONFETTI[i % CONFETTI.length] });
      this.particles.spawn((f.x - f.width / 2 + f.width * Math.random()) * this.ppb, fy, Math.cos(a) * v, Math.sin(a) * v,
        { ...o, life: 1.4 + Math.random() * 0.6, gravity: this.ppb * 12, drag: 1.2, spin: 10 * (Math.random() - 0.5) });
    }
    this.toast(`CHECKPOINT ${p.n}!`, f.x, lineY + 2.2, GOLD, 26);
    const leftover = p.leftover as number;
    if (leftover > 0) this.time.delayedCall(400, () => this.pop(`+${leftover} bricks left`, f.x, lineY + 1.2, '#FFFFFF', 16));
    this.shaker.add(0.3);
  }

  // ---------------------------------------------------------------- power-ups

  private showBubble(_now: number): void {
    const b = this.sim.bubble;
    if (!b) return;
    this.bubbleView?.view.destroy();
    const view = new PowerBubble(this.art, b.kind, D.bubble);
    view.reduceMotion = this.view.reducedMotion;
    view.set(b.x * this.ppb, -b.y * this.ppb);
    this.bubbleView = { id: b.id, view };
    if (!this.taughtBubble) { this.taughtBubble = true; this.pop('Steer through it!', b.x, b.y + 1.1, '#FFFFFF', 15); }
  }

  private drawBubble(dt: number): void {
    const v = this.bubbleView, b: Bubble | null = this.sim.bubble;
    // The kit adds its own bob and sway; collection uses the sim's fixed circle, which is generous.
    if (v && b && v.id === b.id) v.view.set(b.x * this.ppb, -b.y * this.ppb).ending(b.shapesLeft === 1).update(dt);
    for (const p of this.poppedBubbles) p.update(dt);
    this.poppedBubbles = this.poppedBubbles.filter(p => { if (p.done) p.destroy(); return !p.done; });
  }

  /**
   * The hazards from the sim's state each frame (gameplay.md §8.3): the HUD's chips and weather
   * gauges, HazardFx's telegraphs and objects for junk, meteors and dust devils, and the backdrop
   * leaning with tidal sway. Gust and crosswind streaks are WindView's, from the hazard events.
   */
  private drawHazards(dt: number): void {
    const sim = this.sim, u = this.ppb, live = this.started && !this.demoing, step = sim.stepIndex;
    const want: HazardWant[] = [];
    const g = sim.gust;
    if (g.phase !== 'idle') want.push({ type: 'gust', dir: g.dir > 0 ? 1 : -1, left: g.phase === 'warn' ? (g.startStep - step) * DT : 0 });
    // Crosswind and sway get a chip to announce them; after that the gauges show them.
    const w = sim.weather, wl = (w.startStep - step) * DT;
    if (w.phase !== 'idle' && wl > -1.5) {
      if (w.crosswind > 0) want.push({ type: 'crosswind', dir: w.crossDir, left: Math.max(0, wl) });
      if (w.sway) want.push({ type: 'sway', dir: 1, left: Math.max(0, wl) });
    }
    const on = w.phase === 'on';
    this.hooks.hud.setGauges(on && w.crosswind > 0 ? w.crossDir * w.crosswind * Math.min(1, -wl / 2) : null, on && w.sway ? sim.swayAhead(1) : null);
    this.backdrop.setTilt(-sim.tilt); // gravity pulling right: the world leans the other way

    // Junk and meteors: dashes and a reticle while warned, the object while it flies, gone after.
    const seen = new Set<number>();
    for (const s of sim.shots) {
      seen.add(s.id);
      const id = `s${s.id}`, was = this.hzShots.get(s.id), hx = s.hitX * u, hy = -s.hitY * u;
      if (!was) {
        const left = Math.max(0.1, (s.hitStep - step) * DT);
        if (s.kind === 'junk') this.hz.trajectory(id, s.x * u, -s.y * u, hx, hy);
        else this.hz.incoming(`${id}i`, hx, hy, Math.atan2(s.hitY - s.y, s.x - s.hitX));
        this.hz.reticle(`${id}t`, hx, hy, left);
      }
      if (s.phase === 'out' && was !== 'out') {
        this.hz.unmark(id).unmark(`${id}t`).unmark(`${id}i`);
        if (s.kind === 'meteor') this.hz.remove(id);
      }
      if (s.kind === 'junk' && s.phase !== 'warn') this.hz.junk(id, JUNK_KINDS[s.skin % JUNK_KINDS.length], s.x * u, -s.y * u, (step - s.appearStep) * DT * 3 * s.dir);
      if (s.kind === 'meteor' && s.phase === 'fly') this.hz.meteor(id, s.x * u, -s.y * u);
      this.hzShots.set(s.id, s.phase);
      if (s.phase !== 'out' && !want.some(x => x.type === s.kind)) {
        want.push({ type: s.kind, dir: s.dir > 0 ? -1 : 1, left: Math.max(0, (s.hitStep - step) * DT), id: s.kind === 'junk' ? s.id : undefined });
      }
    }
    for (const sid of [...this.hzShots.keys()]) {
      if (seen.has(sid)) continue;
      this.hz.remove(`s${sid}`).unmark(`s${sid}`).unmark(`s${sid}t`).unmark(`s${sid}i`);
      this.hzShots.delete(sid);
    }

    // Dust devils: the swirl on the side it comes from, then the column crossing the top and the dim.
    const d = sim.devil, shown = this.hzDevil;
    if (shown && (!d || d.id !== shown.id)) {
      this.hz.unmark(`d${shown.id}`).remove(`d${shown.id}c`).dim(0);
      this.hzDevil = null;
    }
    if (d) {
      if (!this.hzDevil) {
        this.hz.swirl(`d${d.id}`, d.x0 * u, -(d.y + 3) * u, Math.max(0.1, (d.startStep - step) * DT), d.dir);
        this.hzDevil = { id: d.id, phase: 'warn' };
      }
      if (d.phase === 'blow') {
        if (this.hzDevil.phase === 'warn') { this.hz.unmark(`d${d.id}`).dim(0.8); this.hzDevil.phase = 'blow'; }
        this.hz.column(`d${d.id}c`, d.x * u, -d.y * u, d.dir);
        const f = sim.foundation, top = sim.height().provisional;
        if (Math.abs(d.x - f.x) < f.width / 2 + 0.5 && sim.time > this.dustPuffAt) {
          this.dustPuffAt = sim.time + 0.12;
          this.particles.spawn((d.x + (Math.random() - 0.5)) * u, -(top - Math.random()) * u, d.dir * u * (2 + Math.random() * 2), -u * Math.random(), this.fx('puff', 0.35, 0.8, { tint: num(ART_BIOMES[this.biomeIndex()].dust), life: 0.5, drag: 3, alpha: 0.85 }));
        }
      }
      want.push({ type: 'dust', dir: d.dir, left: d.phase === 'warn' ? Math.max(0, (d.startStep - step) * DT) : 0, id: d.id });
    }

    this.hooks.hud.syncHazards(live ? want : []);
    this.hooks.hud.pauseHazard(this.paused);
    this.hz.update(dt);
  }

  /** The contact puff (Art's README, "Space hazards"): gold sparks and a ring for junk, dust and chips for a meteor. */
  private onHazardHit(p: Record<string, any>): void {
    const u = this.ppb, x = Number(p.x) * u, y = -Number(p.y) * u, dir = Number(p.dir) || 1;
    if (p.type === 'junk') {
      const n = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (dir > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 1.6, v = u * (3 + Math.random() * 3);
        const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
        this.particles.spawn(x, y, vx, vy, this.fx('spark', 0.4, 0.15, { tint: num(GOLD), life: 0.35, drag: 2, angle: Math.atan2(vy, vx), blend: Phaser.BlendModes.ADD }));
      }
      this.particles.spawn(x, y, 0, 0, this.fx('ring', 0.4, 1.6, { tint: num(GOLD), life: 0.35, alpha: 0.9, blend: Phaser.BlendModes.ADD }));
      this.shaker.add(0.22);
    } else {
      const dust = num(ART_BIOMES[this.biomeIndex()].dust);
      this.particles.spawn(x, y, 0, -u * 0.5, this.fx('puff', 0.6, 1.4, { tint: dust, life: 0.55, drag: 3, alpha: 0.9 }));
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, v = u * (2 + Math.random() * 3);
        this.particles.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, this.fx('chip', 0.24, 0.12, { tint: STONE_CHIP, life: 0.6, gravity: u * 14, spin: 8 }));
      }
      this.shaker.add(0.18);
    }
  }

  /** The bubble bursts and its icon flies to the slot it fills (collected), or drifts away. */
  private dropBubble(collected: boolean, p: Record<string, any>): void {
    const v = this.bubbleView;
    this.bubbleView = null;
    if (!v) return;
    this.poppedBubbles.push(v.view);
    if (!collected) { v.view.fade(); return; }
    const slot = this.hooks.hud.slotCentre(p.slot as number);
    const to = this.cameras.main.getWorldPoint(slot.x * this.dpr, slot.y * this.dpr);
    v.view.collect({ x: to.x, y: to.y });
    const kind = p.kind as PowerKind;
    this.pop(`${POWER_NAMES[kind].toUpperCase()}!`, p.x as number, (p.y as number) + 1, POWER_COLORS[kind], 18);
    this.shaker.add(0.1);
  }

  private poof(x: number, y: number, color: string, n: number): void {
    const u = this.ppb;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = u * (1 + Math.random() * 3);
      this.particles.spawn((x + (Math.random() - 0.5)) * u, -(y + (Math.random() - 0.5)) * u, Math.cos(a) * v, Math.sin(a) * v - u, this.fx('puff', 0.45, 0.9, { tint: num(ART_BIOMES[this.biomeIndex()].dust), life: 0.5, drag: 3, alpha: 0.9 }));
    }
    this.particles.spawn(x * u, -y * u, 0, 0, this.fx('sparkle', 0.8, 0.1, { tint: num(color), life: 0.4, blend: Phaser.BlendModes.ADD }));
  }

  private onPowerUsed(p: Record<string, any>, now: number): void {
    const kind = p.kind as PowerKind;
    const f = this.sim.foundation;
    const top = Math.max(this.sim.height().provisional, f.top);
    const col = POWER_COLORS[kind];
    switch (kind) {
      case 'clean': {
        // A broom-stroke of light across the stretch after the puffs.
        const w = Math.max(8, f.width + 4), x0 = f.x - w / 2;
        this.particles.spawn(x0 * this.ppb, -(f.top + 1.75) * this.ppb, (w / 0.32) * this.ppb, 0, this.fx('sweep', 3.5, 3.5, { tint: num(col), life: 0.32, alpha: 0.9, angle: 0, blend: Phaser.BlendModes.ADD }));
        this.pop('CLEAN SLATE!', f.x, f.top + 3, col, 24);
        this.shaker.add(0.2);
        break;
      }
      case 'quickset':
        // Stone washes down from the top, like a claim.
        this.stoneWave = { top: top + 0.5, at: now };
        this.hitstop(now, 60);
        for (let i = 0; i < 10; i++) {
          const x = f.x + (Math.random() - 0.5) * f.width;
          this.particles.spawn(x * this.ppb, -top * this.ppb, (Math.random() - 0.5) * this.ppb * 4, -this.ppb * (1 + Math.random() * 2), this.fx('chip', 0.22, 0.1, { tint: num(col), life: 0.7, gravity: this.ppb * 14, spin: 6 }));
        }
        this.pop('QUICK-SET!', f.x, top + 1.5, '#FFFFFF', 24);
        this.shaker.add(0.25);
        break;
      case 'undo':
        this.poof(p.x as number, p.y as number, col, 8);
        this.pop('UNDO!', p.x as number, (p.y as number) + 1.2, col, 22);
        break;
      case 'glue':
      case 'slowmo': {
        this.pop(`${POWER_NAMES[kind].toUpperCase()} ×${p.shapes}`, f.x, top + 2.5, col, 22);
        if (kind === 'slowmo') {
          const c = this.sim.ctrl;
          const at = c ? { x: c.x, y: this.curCtrlY } : { x: f.x, y: top + 1 };
          this.particles.spawn(at.x * this.ppb, -at.y * this.ppb, 0, 0, this.fx('ripple', 1, 3.5, { tint: num(col), life: 0.6, alpha: 0.9, angle: 0, blend: Phaser.BlendModes.ADD }));
        }
        break;
      }
    }
  }

  private onSecondWind(now: number): void {
    const u = this.ppb, f = this.sim.foundation;
    const top = Math.max(this.sim.height().provisional, f.top);
    if (!this.view.reducedMotion && this.juice) this.hooks.hud.flash(0.35);
    this.hitstop(now, 80);
    this.pop('SECOND WIND!', f.x, top + 3, WIND_BLUE, 28);
    this.particles.spawn(f.x * u, -top * u, 0, 0, this.fx('ripple', 1.5, 6, { tint: num(WIND_BLUE), life: 0.7, alpha: 0.9, angle: 0, blend: Phaser.BlendModes.ADD }));
    // A gust blows across the screen, left to right at about 20 blocks/s.
    const visH = this.H / (this.ppb * this.zoom);
    const left = this.cam.x - this.cam.across / 2 - 2.5;
    const n = 12 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const y = this.cam.y + (Math.random() - 0.5) * visH * 0.8;
      this.particles.spawn((left - Math.random() * 5) * u, -y * u, u * (18 + Math.random() * 4), 0, this.fx('gust', 2.4, 2.4, { tint: 0xffffff, life: 1.2, alpha: 0.85, angle: 0 }));
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, v = u * (3 + Math.random() * 5);
      this.particles.spawn(f.x * u, -top * u, Math.cos(a) * v, Math.sin(a) * v, this.fx('sparkle', 0.5, 0.05, { tint: num(WIND_BLUE), life: 0.8, drag: 2, spin: 4, blend: Phaser.BlendModes.ADD }));
    }
    this.shaker.add(0.35);
  }

  // ---------------------------------------------------------------- sprites

  private biomeIndex(): number { return biomeForCheckpoint(this.sim.checkpoint); }
  private finish(): Finish | null { return ART_BIOMES[this.biomeIndex()].finish; }

  private makeSprite(shape: string, id: number, depth: number): PieceSprite {
    const view = new BlocklingView(this.art, shape, { seed: id, finish: this.finish(), faces: this.view.faces, depth });
    return { id, shape, view, squash: 0, squashAt: 0, stone: 0, stoneAt: null, lost: false, gone: false };
  }

  private spawnCtrlSprite(now: number): void {
    const c = this.sim.ctrl;
    if (!c) return;
    this.ctrlSprite?.view.destroy();
    this.ctrlSprite = this.makeSprite(c.shape, this.sim.stepIndex, D.ctrl);
    this.ctrlSprite.view.setExpression('falling');
    this.ctrl.x = this.ctrl.lastX = c.x;
    this.ctrl.ang = c.rot * Math.PI / 2;
    this.ctrl.angV = 0;
    this.ctrl.spawnAt = now;
    this.ctrl.shape = c.shape;
    this.prevCtrlY = this.curCtrlY = c.y;
  }

  private glint(s: PieceSprite, color: string): void {
    const pose = this.cur.get(s.id);
    if (!pose) return;
    const q = ((Math.round(pose.a / (Math.PI / 2)) % 4) + 4) % 4;
    const r: TexRef = this.art.silhouette(s.shape, q);
    const rem = pose.a - Math.round(pose.a / (Math.PI / 2)) * (Math.PI / 2);
    const flash = this.add.image(pose.x * this.ppb, -pose.y * this.ppb, r.key, r.frame).setOrigin(r.originX, r.originY)
      .setRotation(-rem).setTint(num(color)).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(D.piece + 1);
    this.tweens.add({ targets: flash, alpha: 0, duration: 320, ease: 'Quad.Out', onComplete: () => flash.destroy() });
  }

  /**
   * Particle options for one of the art kit's effects, sized in blocks (start, end). The mini_*
   * confetti have no size table, so for those the sizes are multiples of their natural size.
   */
  private fx(name: VfxName, size: number, end: number, o: Omit<ParticleOpts, 'tex' | 'frame' | 'scale' | 'endScale'> = {}): ParticleOpts {
    const r = this.art.vfx(name);
    const k = this.art.scale / ((VFX as Record<string, number>)[name] ?? 1);
    return { ...o, tex: r.key, frame: r.frame, scale: size * k, endScale: end * k };
  }

  private sparkle(s: PieceSprite, color: string): void {
    const pose = this.cur.get(s.id);
    if (!pose) return;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.random() * 0.5, v = this.ppb * (1.5 + Math.random() * 1.5);
      this.particles.spawn(pose.x * this.ppb, -pose.y * this.ppb, Math.cos(a) * v, Math.sin(a) * v, this.fx('sparkle', 0.5, 0.1, { tint: num(color), life: 0.6, drag: 3, spin: 3, blend: Phaser.BlendModes.ADD }));
    }
  }

  /** A toast beside a piece, on the side away from the drop column (art-direction.md §5.3). */
  private popNear(s: PieceSprite, text: string, color: string, size: number, dy = 0): void {
    if (!this.juice) return;
    const pose = this.cur.get(s.id);
    if (!pose) return;
    const side = pose.x >= this.sim.foundation.x ? 1 : -1;
    const half = this.cam.across / 2 - 2;
    const x = Math.max(this.cam.x - half, Math.min(this.cam.x + half, pose.x + side * 2.6));
    this.pop(text, x, pose.y + 0.6 - dy, color, size);
  }

  private get juice(): boolean { return this.view.juice !== false; }

  /** A celebration label (juice): skipped when juice is off. Information labels use pop(). */
  private toast(text: string, x: number, y: number, color: string, size: number): void {
    if (this.juice) this.pop(text, x, y, color, size);
  }

  private pop(text: string, x: number, y: number, color: string, size: number): void {
    const t = this.text(text, size, color).setOrigin(0.5).setScale(0).setDepth(D.text);
    // Keep the whole label on screen (a bubble beside the foundation sits near the edge).
    const edge = (this.cam.across / 2) * this.ppb - t.width / 2 - 8 * this.dpr;
    const cx = this.cam.x * this.ppb;
    t.setPosition(Math.max(cx - edge, Math.min(cx + edge, x * this.ppb)), -y * this.ppb);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: t.y - 30 * this.dpr, alpha: 0, delay: 520, duration: 600, ease: 'Quad.In', onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- render

  private render(dt: number, alpha: number, now: number, timeScale: number): void {
    const sim = this.sim;
    this.updateCamera(dt, now);
    const shake = this.shaker.update(dt, 8 * this.dpr);
    const cam = this.cameras.main;
    this.zoom = ACROSS / this.cam.across;
    cam.setZoom(this.zoom);
    cam.centerOn(this.cam.x * this.ppb + shake.x / this.zoom, -this.cam.y * this.ppb + shake.y / this.zoom);
    sim.setCamera(this.cam.x, this.cam.y, timeScale);

    // Sky position follows checkpoint progress through the biome (art-direction.md §3.4).
    const bi = this.biomeIndex();
    const first = ART_BIOMES[bi].firstCp, last = bi < ART_BIOMES.length - 1 ? ART_BIOMES[bi + 1].firstCp - 1 : first + 5;
    const { committed } = sim.height();
    const f = sim.foundation;
    const cpProg = Math.max(0, Math.min(1, (committed - f.top) / Math.max(0.001, sim.lineY - f.top)));
    const prog = (Math.min(sim.checkpoint, last) - first + cpProg) / (last - first + 1);
    const sp = this.pano ? this.skyAt(this.cam.y) : this.skyClock.update(dt, bi, prog, this.view.reducedMotion);
    const ppbScreen = this.ppb * this.zoom;
    this.backdrop.update(dt, this.H / 2 + (this.cam.y + 1) * ppbScreen, sp);

    this.drawSlabs(now);
    this.drawLines(dt, committed);
    this.drawPieces(dt, alpha, now, sp);
    this.drawCtrl(dt, alpha, now, sp);
    this.drawGuide(now);
    this.drawBubble(dt);
    this.drawHazards(dt);
    this.celebrate(committed);
    this.particles.update(dt);
    this.wind.update(dt);
    this.party.update(dt);
    this.updateHud(committed);
  }

  /**
   * Every MILESTONE blocks of settled height: height_milestone for Sound, and the celebration that
   * suits the sky (Art's kit): balloons up to Cloudlands, a rainbow in the Storm Belt and the
   * Stratosphere, a comet shower from Orbit on. Juice off keeps the event and drops the show.
   */
  private celebrate(committed: number): void {
    const h = committed - this.sim.foundations[0].top;
    if (this.demoing || h < this.nextMilestone) return;
    const at = this.nextMilestone;
    while (h >= this.nextMilestone) this.nextMilestone += MILESTONE;
    this.hooks.onJuice?.('height_milestone', { h: at });
    if (!this.juice) return;
    const biome = biomeFor(this.sim.checkpoint).id - 1;
    if (biome <= 2) this.party.balloons();
    else if (biome <= 4) this.party.rainbow();
    else this.party.comets();
  }

  private updateCamera(dt: number, now: number): void {
    const sim = this.sim;
    const pano = this.pano;
    if (pano) {
      // A beat at the top (250 ms, longer while the backdrop bakes the path), then the glide.
      if (pano.t0 === Infinity && now - pano.start >= 250 && (this.backdrop.tourReady || now - pano.start >= PANO_WAIT)) {
        pano.t0 = now;
        this.backdrop.tourGlide();
      }
      const t = Math.max(0, Math.min(1, (now - pano.t0) / pano.dur));
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.cam.y = pano.from + (pano.to - pano.from) * e;
      if (t >= 1 && pano.done && now - pano.t0 >= pano.dur + 350) { const d = pano.done; pano.done = null; this.backdrop.endTour(); d(); }
      return;
    }
    // Zoom out up to 15 blocks when overhangs reach the screen edge (gameplay.md §11.2).
    let dev = 0;
    for (const v of this.views) if (v.state !== 'lost') dev = Math.max(dev, Math.abs(v.x - this.cam.x) + 2.2);
    // A power bubble beside the foundation stays fully in view, halo included.
    if (sim.bubble) dev = Math.max(dev, Math.abs(sim.bubble.x - this.cam.x) + sim.bubble.r + 0.9);
    const across = Math.max(ACROSS, Math.min(ACROSS_MAX, dev * 2));
    this.cam.across += (across - this.cam.across) * (1 - Math.exp(-dt * 2));
    const ppbScreen = this.W / this.cam.across;
    const visH = this.H / ppbScreen;
    // The tower top sits about 40% up the screen.
    let target = sim.height().provisional + 0.1 * visH;
    const c = sim.ctrl;
    if (c) {
      const e = extents(c.shape, c.rot);
      const hudBlocks = (140 * this.dpr) / ppbScreen;
      target = Math.max(target, c.y + e.maxY + 0.6 + hudBlocks - visH / 2);
    }
    // Early on the ground never takes more than the bottom fifth of the screen.
    target = Math.max(target, -1 + 0.3 * visH);
    // The menu's demo tower stands on the plinth 30% up the screen, clear of the buttons.
    if (this.demoing) target = 0.2 * visH;
    this.cam.peek += (this.cam.peekTarget - this.cam.peek) * (1 - Math.exp(-dt * 10));
    target -= this.cam.peek;
    // Rises on a spring; only goes down after a collapse, after a 1 s pause.
    if (target >= this.cam.y || this.cam.peek > 0.05) {
      this.cam.lowSince = -1;
      this.cam.y += (target - this.cam.y) * (1 - Math.exp(-dt * (this.cam.peek > 0.05 ? 10 : 3.5)));
    } else {
      if (this.cam.lowSince < 0) this.cam.lowSince = now;
      if (now - this.cam.lowSince > 1000) this.cam.y += (target - this.cam.y) * (1 - Math.exp(-dt * 2));
    }
    this.cam.x += (sim.foundation.x - this.cam.x) * (1 - Math.exp(-dt * 2));
  }

  private drawSlabs(now: number): void {
    const plinthId = this.sim.foundations[0].id;
    for (const f of this.sim.foundationViews()) {
      let s = this.slabs.get(f.id);
      if (!s) {
        const plinth = f.id === plinthId;
        const r = plinth ? this.art.pedestal(f.width, PEDESTAL_LEGS) : this.art.slab(this.biomeIndex(), f.width);
        const img = this.add.image(f.x * this.ppb, -f.top * this.ppb, r.key, r.frame).setOrigin(r.originX, r.originY).setDepth(D.slab);
        s = { img, born: plinth ? 0 : now, landed: plinth };
        this.slabs.set(f.id, s);
        if (!plinth && f.grade) this.stamp(f.grade, f.x, f.top);
      }
      // Deploy: drops in with a stretch, lands with a squash (art-direction.md §6.2).
      const t = (now - s.born) / 420;
      if (s.born && t < 1.6 && this.juice) {
        const fall = Math.max(0, 1 - t / 0.55);
        s.img.y = -(f.top + 3 * fall * fall) * this.ppb;
        const land = Math.max(0, t - 0.55) / 1.05;
        const sq = t < 0.55 ? 1 + 0.15 * fall : 1 - 0.18 * (1 - easeElasticOut(land));
        s.img.setScale(t < 0.55 ? 0.95 : 1 / Math.max(0.85, sq), sq);
        if (t >= 0.55 && !s.landed) {
          s.landed = true;
          const dust = num(ART_BIOMES[this.biomeIndex()].dust);
          for (let i = 0; i < 14; i++) this.particles.spawn((f.x + (Math.random() - 0.5) * f.width) * this.ppb, -(f.top - f.thickness) * this.ppb, (Math.random() - 0.5) * this.ppb * 5, -this.ppb * Math.random(), this.fx('puff', 0.3, 0.6, { tint: dust, life: 0.5, drag: 3, alpha: 0.8 }));
          this.shaker.add(0.25);
        }
      } else {
        s.img.y = -f.top * this.ppb;
        s.img.setScale(1);
      }
    }
  }

  private stamp(grade: string, x: number, top: number): void {
    const r = this.art.gradeStamp(grade as 'S' | 'A' | 'B' | 'C');
    const img = this.add.image(x * this.ppb, -(top + 1.1) * this.ppb, r.key, r.frame).setOrigin(r.originX, r.originY).setScale(2.4).setAlpha(0).setDepth(D.text);
    this.tweens.add({ targets: img, scale: 1, alpha: 1, delay: 650, duration: 220, ease: 'Back.Out' });
    this.tweens.add({ targets: img, alpha: 0, delay: 2150, duration: 400, onComplete: () => img.destroy() });
  }

  private drawLines(dt: number, committed: number): void {
    const sim = this.sim;
    const u = this.ppb;
    const x0 = (this.cam.x - this.cam.across / 2 - 1) * u, x1 = (this.cam.x + this.cam.across / 2 + 1) * u;
    // The active line glows brighter as the tower gets close and fills its ring while you hold
    // (§7.1). Claimed lines keep their gold rope and flag; only the last few are kept.
    let line = this.lines[this.lines.length - 1];
    if (!line || line.claimed) {
      line = new CheckpointLine(this.art, sim.checkpoint, D.line);
      line.reduceMotion = this.view.reducedMotion;
      this.lines.push(line);
      while (this.lines.length > 4) this.lines.shift()!.destroy();
    }
    const hold = sim.holdState();
    line.set({ y: -sim.lineY * u, x0, x1, near: Math.max(0, Math.min(1, 1 - (sim.lineY - committed) / 4)), hold: hold.active ? hold.progress : 0 });
    for (const l of this.lines) l.update(dt);
    // Personal best marker, with fireworks when you cross it.
    if (this.bestHeight > 1) {
      const by = -this.bestHeight * u;
      this.pb.set(by, x0, x1).update(dt);
      if (!this.pbCrossed && committed > this.bestHeight) {
        this.pbCrossed = true;
        this.pb.pop();
        this.hooks.onJuice?.('pb_crossed', { height: this.bestHeight });
        if (this.juice) this.party.fireworks();
        this.toast('NEW BEST!', this.cam.x, this.bestHeight + 1.5, GOLD, 24);
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * TAU, v = u * (3 + Math.random() * 6);
          this.particles.spawn((this.cam.x + (Math.random() - 0.5) * 8) * u, by - u * 4, Math.cos(a) * v, Math.sin(a) * v, this.fx('dot', 0.2, 0.04, { tint: CONFETTI[i % CONFETTI.length], life: 1, gravity: u * 4, blend: Phaser.BlendModes.ADD }));
        }
      }
    } else this.pb.hide();
  }

  private drawPieces(dt: number, alpha: number, now: number, sp: number): void {
    const u = this.ppb;
    const top = this.sim.height().provisional;
    const tension = this.sim.tension();
    const gusting = this.sim.gust.phase === 'blow';
    const rim = rimAmount(sp);
    const seen = new Set<number>();
    this.cracks.clear();
    for (const v of this.views) {
      seen.add(v.id);
      let s = this.sprites.get(v.id);
      if (!s) {
        s = this.makeSprite(v.shape, v.id, D.piece);
        this.sprites.set(v.id, s);
      }
      const a = this.prev.get(v.id) ?? this.cur.get(v.id)!;
      const b = this.cur.get(v.id)!;
      let da = b.a - a.a;
      if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
      // A brittle shape about to break trembles.
      const shake = v.brittle && v.strain === 3 && this.sim.state === 'playing' ? (Math.random() - 0.5) * 0.06 : 0;
      const x = a.x + (b.x - a.x) * alpha + shake, y = a.y + (b.y - a.y) * alpha, ang = a.a + da * alpha;
      if (v.brittle) this.drawCracks(this.cracks, v.shape, v.strain, x, y, ang);

      // Stone arrives as a wave: down the segment on a claim, across the row on a Solid Row.
      if (v.state === 'stone' && s.stone < 1) {
        if (s.stoneAt === null) {
          let delay = 0;
          if (this.stoneWave && now - this.stoneWave.at < 200) delay = Math.min(900, Math.max(0, (this.stoneWave.top - y) * 45));
          else if (this.rowWave && now - this.rowWave.at < 200) delay = Math.max(0, (x - this.rowWave.x0) * 20);
          s.stoneAt = now + delay;
        }
        if (now >= s.stoneAt) {
          const was = s.stone;
          s.stone = Math.min(1, s.stone + dt / 0.18);
          if (was === 0) this.glint(s, '#FFFFFF');
        }
      }

      // Squash anchored near the contact, with an elastic return (§7.1).
      const st = (now - s.squashAt) / 280;
      let sx = 1, sy = 1;
      if (s.squash > 0 && st < 1) {
        const amt = 0.15 * s.squash * (1 - easeElasticOut(Math.min(1, st)));
        sx = 1 + amt * 0.7; sy = 1 - amt;
      }
      const e = extents(v.shape, Math.round(ang / (Math.PI / 2)));
      const drop = (1 - sy) * (e.maxY - e.minY) * 0.5 * u;

      // Lost pieces fade as they fall past the ground.
      let alphaV = 1;
      if (s.lost && y < -1.5) alphaV = Math.max(0, 1 - (-1.5 - y) / 2);
      if (s.lost && !s.gone && y < -1.2) {
        s.gone = true;
        for (let i = 0; i < 8; i++) this.particles.spawn(x * u, 1.1 * u, (Math.random() - 0.5) * u * 6, -u * (1 + Math.random() * 2), this.fx('puff', 0.3, 0.6, { tint: num(ART_BIOMES[0].dust), life: 0.5, drag: 3, alpha: 0.85 }));
      }

      // Faces: only the top ~10 blocks animate; tension drives the mood (§4.3).
      const lively = v.top > top - 10;
      if (!s.lost && this.sim.state === 'playing') {
        // The top rows squint into a gust (art-direction.md, hazards), unless they're already panicking.
        const mood: Expression = tension >= 0.85 && v.top > top - 6 ? 'panic' : gusting && v.top > top - 3 ? 'squint' : tension >= 0.3 && v.top > top - 4 ? 'worried' : 'idle';
        s.view.setExpression(mood).setSweat(tension >= 0.6);
      }
      s.view.setLively(lively).setStone(s.stone).setRim(rim).setAlpha(alphaV);
      s.view.setPose(x * u, -y * u + drop, ang).setSquash(sx, sy);
      s.view.update(dt);
    }
    for (const [id, s] of this.sprites) {
      if (seen.has(id)) continue;
      s.view.destroy();
      this.sprites.delete(id);
    }
  }

  private drawCtrl(dt: number, alpha: number, now: number, sp: number): void {
    const c = this.sim.ctrl;
    this.ctrlCracks.clear();
    if (!c) {
      if (this.ctrlSprite) { this.ctrlSprite.view.destroy(); this.ctrlSprite = null; }
      return;
    }
    if (!this.ctrlSprite || this.ctrl.shape !== c.shape) this.spawnCtrlSprite(now);
    const s = this.ctrlSprite!;
    const u = this.ppb;
    // Logical x snaps; the sprite springs there over about 60 ms (gameplay.md §2).
    this.ctrl.x += (c.x - this.ctrl.x) * (1 - Math.exp(-dt / 0.022));
    const vx = (this.ctrl.x - this.ctrl.lastX) / Math.max(dt, 1e-3);
    this.ctrl.lastX = this.ctrl.x;
    this.ctrl.lean += (Math.max(-0.087, Math.min(0.087, vx * 0.02)) - this.ctrl.lean) * (1 - Math.exp(-dt / 0.05));
    // Rotation snaps in about 80 ms with overshoot (an underdamped spring).
    const target = c.rot * Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const h = dt / 4, w = 48, z = 0.42;
      this.ctrl.angV += (-(w * w) * (this.ctrl.ang - target) - 2 * z * w * this.ctrl.angV) * h;
      this.ctrl.ang += this.ctrl.angV * h;
    }
    // A lift clear of a new slab eases up over 250 ms instead of jumping.
    const lt = Math.min(1, (now - this.ctrl.liftAt) / 250);
    const y = this.prevCtrlY + (this.curCtrlY - this.prevCtrlY) * alpha + this.ctrl.lift * (1 - lt) * (1 - lt) * (1 - lt);
    // Hovering through a checkpoint hold, or waiting at the top early in a run: a soft cushion of puffs under the shape.
    if ((this.sim.hovering || this.sim.waiting) && !c.hard && !c.soft && now - this.ctrl.cushionAt > 110) {
      this.ctrl.cushionAt = now;
      const e = extents(c.shape, c.rot);
      this.particles.spawn((c.x + e.minX + Math.random() * (e.maxX - e.minX)) * this.ppb, -(y + e.minY - 0.1) * this.ppb, 0, this.ppb * 0.8, this.fx('dot', 0.3, 0.05, { tint: 0xffffff, life: 0.45, alpha: 0.6, blend: Phaser.BlendModes.ADD }));
    }
    // Spawn pop 0 → 1.1 → 1 over 220 ms (§7.1), then stretch while dropping.
    const pt = Math.min(1, (now - this.ctrl.spawnAt) / 220);
    const pop = pt < 1 ? (pt < 0.6 ? (pt / 0.6) * 1.1 : 1.1 - 0.1 * ((pt - 0.6) / 0.4)) : 1;
    let sx = pop, sy = pop;
    if (c.hard) { sx *= 0.92; sy *= 1.12; } else if (c.soft) { sx *= 0.96; sy *= 1.06; }
    const nope = this.ctrl.nopeAt > 0 && now - this.ctrl.nopeAt < 140 ? Math.sin(((now - this.ctrl.nopeAt) / 140) * Math.PI * 3) * 3 * this.dpr : 0;
    s.view.setRim(rimAmount(sp)).setPose(this.ctrl.x * u + nope, -y * u, this.ctrl.ang - this.ctrl.lean).setSquash(sx, sy);
    s.view.update(dt);
    if (c.brittle) this.drawCracks(this.ctrlCracks, c.shape, 0, this.ctrl.x + nope / u, y, this.ctrl.ang - this.ctrl.lean);
    // Glue drips honey; Slow-Mo leaves a drift of sparkles.
    if (this.sim.glueLeft > 0 && Math.random() < 0.12) {
      const e = extents(c.shape, c.rot);
      this.particles.spawn((c.x + e.minX + Math.random() * (e.maxX - e.minX)) * u, -(y + e.minY) * u, 0, u * 0.5, this.fx('honey', 0.32, 0.2, { life: 0.7, gravity: u * 6, angle: 0 }));
    }
    if (this.sim.slowLeft > 0 && !c.hard && Math.random() < 0.2) {
      const e = extents(c.shape, c.rot);
      this.particles.spawn((c.x + e.minX + Math.random() * (e.maxX - e.minX)) * u, -(y + e.maxY) * u, 0, -u * 0.6, this.fx('stardust', 0.22, 0.05, { tint: num(POWER_COLORS.slowmo), life: 0.8, drag: 1, blend: Phaser.BlendModes.ADD }));
    }
    // Speed lines trail a hard drop.
    if (c.hard && Math.random() < 0.6) {
      const e = extents(c.shape, c.rot);
      this.particles.spawn((c.x + e.minX + 0.2 + Math.random() * (e.maxX - e.minX - 0.4)) * u, -(y + e.maxY + 0.5) * u, 0, -u * 2, this.fx('speedline', 0.9, 0.5, { life: 0.16, alpha: 0.6, angle: 0 }));
    }
  }

  private drawGuide(now: number): void {
    const c = this.sim.ctrl;
    const g = c ? this.sim.ghost() : null;
    if (!c || !g || this.sim.state !== 'playing') { this.guide.hide(); return; }
    const u = this.ppb;
    // The tint has 100 ms hysteresis; position never does (gameplay.md §6.2).
    let want: Tint = g.tint;
    if (!this.view.ghostTint && want !== 'none') want = 'ok';
    if (want === 'none' || this.tint.shown === 'none') this.tint.shown = want;
    else if (want !== this.tint.shown) {
      if (this.tint.pending !== want) { this.tint.pending = want; this.tint.since = now; }
      else if (now - this.tint.since >= 100) this.tint.shown = want;
    } else this.tint.pending = want;
    const state: GuideState = { ok: 'stable', amber: 'risky', red: 'tip', none: 'miss' }[this.tint.shown] as GuideState;
    // Contact dots, merged so a flat face shows its ends rather than a row of dots.
    const pts = [...g.contacts].sort((a, b) => a.x - b.x);
    const merged: [number, number][] = [];
    let last: { x: number; y: number } | null = null;
    for (const p of pts) {
      if (last && Math.abs(p.x - last.x) < 0.45 && Math.abs(p.y - last.y) < 0.3) continue;
      merged.push([p.x * u, -(p.y + 0.03) * u]);
      last = p;
    }
    if (pts.length > 1) { const p = pts[pts.length - 1]; if (p !== last) merged.push([p.x * u, -(p.y + 0.03) * u]); }
    const visBottom = this.cam.y - this.H / (this.ppb * this.zoom) / 2;
    this.guide.show({
      key: c.shape, q: ((c.rot % 4) + 4) % 4,
      pieceX: c.x * u, pieceY: -this.curCtrlY * u,
      ghostX: g.x * u, ghostY: -(g.y ?? 0) * u,
      state, perfect: g.perfectFit && state !== 'miss',
      contacts: merged.slice(0, 8),
      missBottomY: -(visBottom + 0.3) * u,
      viewLeft: (this.cam.x - this.cam.across / 2) * u, viewRight: (this.cam.x + this.cam.across / 2) * u,
    });
    this.guide.update(1 / 60);
  }

  private updateHud(committed: number): void {
    const sim = this.sim;
    const hud = this.hooks.hud;
    const t = sim.tuning;
    hud.setHearts(sim.hearts, t.hearts, t.infiniteHearts);
    hud.setBricks(sim.budget - sim.used, t.infiniteBudget);
    hud.setStreak(sim.streak, sim.setNeed);
    hud.setHeight(committed - sim.foundations[0].top);
    const hold = sim.holdState();
    hud.setCheckpoint(sim.checkpoint, sim.lineY - committed, hold.active ? hold.progress : null);
    // The altitude rail: a band per checkpoint stretch, from the ground to the line being climbed to.
    const f = sim.foundations, base = f[0].top;
    const tops = [...f.slice(1).map(x => x.top - base), sim.lineY - base];
    hud.setRail({ ticks: tops, best: this.bestHeight, top: Math.max(0, committed - base) });
    // The gold "▲ 4" chip while the line is above the screen, or hidden behind the top of the HUD.
    const ppbScreen = this.W / this.cam.across;
    const lineCss = (this.cam.y + this.H / ppbScreen / 2 - sim.lineY) * ppbScreen / this.dpr;
    hud.setCheckpointChip(!this.demoing && sim.state === 'playing' && lineCss < 96 ? sim.checkpoint : null);
    hud.setNext(sim.queue.slice(0, 2), sim.nextBrittle());
    hud.setHold(sim.held, sim.holdUsed, sim.heldBrittle);
    hud.setTension(this.view.reducedMotion ? 0 : sim.tension());
    const left = sim.budget - sim.used;
    const trouble = (!t.infiniteHearts && sim.hearts <= 1) || (!t.infiniteBudget && left <= 3);
    hud.setPowers(sim.slots, sim.secondWind, sim.glueLeft, sim.slowLeft, trouble);
  }

  /** Name of the biome the run is in (for the results card). */
  biomeName(): string { return biomeFor(this.sim.checkpoint).name; }
}
