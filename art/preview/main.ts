// Art kit preview: the Meadow, a small tower, an active piece and its landing guide, all through
// the Phaser 4 adapter exactly as the game will use it.
// URL options: ?state=stable|perfect|risky|tip|miss (else cycles) &climb=<blocks> &zoom=<n>
// &sp=<sky position> &tension=<0..1> &gallery=1 (every shape, rotation and look).
// &cp=near|hold|claim holds one checkpoint-line phase (else it cycles near, hold, claim).
// &vfx=1 shows every effect texture, tinted, over a day and a night sky, with a looping claim burst.
// &tour=1 climbs from the Meadow through Treetops into Cloudlands, playing each arrival; &from=<sp> starts the
// climb there and carries on up to Deep Cosmos (e.g. &tour=1&from=2.6).
// &arrive=1 replays the current biome's arrival every 4 s (with &sp=1.2 or &sp=2.2).
// &landmarks=1 shows the four Deep Cosmos landmark textures on the Deep Cosmos sky.
// &at=<s> plays the current biome's arrival once and freezes the backdrop that many seconds into it.
// &pal=<0..3> picks the Deep Cosmos nebula palette; &palcycle=1 moves to the next one every 7 s, with its landmark.
// &powers=1 shows the power bubbles (spawn, bob, collect or fade), the power effects and a DOM power
// bar with every icon and Second Wind state. &pw=idle holds the bubbles; &fx=sweep|glue|slowmo|gust holds one effect.
// &pstrip=1 shows frozen frames of a bubble's spawn, idle, collect and fade, and the power effect textures.
// Options also work after a # (e.g. #gallery), for hosts that drop the query string.

import * as Phaser from 'phaser';
import {
  ART_SHAPES, ArtTextures, BIOMES, INK, LANDMARKS, POWER, POWER_COLORS, POWER_KINDS, SIGNAL, VFX, VFX_NAMES, hexNum, Backdrop, BlocklingView, CheckpointLine, GuideView, PbMarker,
  PowerBubble, SkyClock, bakeLandmark, pedestalHeight, pose, powerBarCss, powerIconUrl, rimAmount, skyColors,
  type Expression, type GuideShow, type PowerIcon, type SceneLike, type VfxName,
} from '../src/index.ts';

const qs = new URLSearchParams(location.search || location.hash.slice(1));
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);

interface Placed { view: BlocklingView; key: string; q: number; c: number; r: number; angle?: number; stone?: number; dx?: number }

class Preview extends Phaser.Scene {
  private tex!: ArtTextures;
  private backdrop!: Backdrop;
  private guide!: GuideView;
  private sky = new SkyClock();
  private tower: Placed[] = [];
  private active!: BlocklingView;
  private groundY = 0;
  private cell = 0;
  private left = 0;
  private top = 0;
  private time0 = 0;
  private line: CheckpointLine | null = null;
  private lineBorn = 0;
  private pb!: PbMarker;
  private lastBiome = 0;
  private palSet = false;

  constructor() { super('preview'); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    const scene: SceneLike = this; // The adapter's structural types must accept a real Phaser scene.
    this.cell = W / 12;
    this.tex = new ArtTextures(scene, { cellPx: this.cell });
    if (qs.has('gallery')) { this.gallery(W); return; }
    if (qs.has('vfx')) { this.vfxSheet(W, H); return; }
    if (qs.has('pstrip')) { this.powerStrip(W, H); return; }
    if (qs.has('landmarks')) { this.landmarkSheet(W, H); return; }

    this.cameras.main.setZoom(num('zoom', 1));
    this.backdrop = new Backdrop(scene, { width: W, height: H });
    this.sky.set(num('sp', 0.15));

    this.groundY = H * 0.8;
    const pedW = 6;
    this.left = W / 2 - pedW / 2 * this.cell;
    this.top = this.groundY - pedestalHeight() * this.cell;
    const ped = this.tex.pedestal(pedW);
    this.add.image(W / 2, this.top, ped.key, ped.frame).setOrigin(ped.originX, ped.originY).setScale(this.tex.scale).setDepth(5);

    const T: Omit<Placed, 'view'>[] = [
      { key: 'I', q: 0, c: 0, r: 0, stone: 1 },
      { key: 'O', q: 0, c: 4, r: 0, stone: 1 },
      { key: 'S', q: 0, c: 0, r: 1 },
      { key: 'Domino', q: 0, c: 2, r: 1 },
      { key: 'L', q: 0, c: 3, r: 2 },
      { key: 'Z', q: 0, c: 0, r: 3 },
      { key: 'T', q: 2, c: 2, r: 4, angle: -0.06 },
      { key: 'J', q: 1, c: 4, r: 4, angle: 0.04 },
    ];
    T.forEach((p, i) => {
      const view = new BlocklingView(this.tex, p.key, { seed: i * 3 + 1, depth: 10 + i * 0.01, finish: 'wood' });
      this.tower.push({ ...p, view });
    });
    this.active = new BlocklingView(this.tex, 'L', { seed: 99, depth: 20, finish: 'wood' }).setExpression('falling');
    this.guide = new GuideView(this.tex, 1000);
    this.pb = new PbMarker(this.tex, 899);
    this.time0 = this.time.now;
    if (qs.has('powers')) powerBar();
  }

  // ---- power-ups ----

  /** Frozen frames of a bubble's life (spawn, collect, fly to a slot, fade) over a day and a night sky. */
  private landmarkSheet(W: number, H: number): void {
    const [a, , c] = skyColors(9.5), g = this.add.graphics();
    g.fillGradientStyle(hexNum(a), hexNum(a), hexNum(c), hexNum(c), 1).fillRect(0, 0, W, H);
    const k = 2, cells = [[0.5, 0.17], [0.27, 0.45], [0.72, 0.45], [0.5, 0.78]];
    LANDMARKS.forEach((L, n) => {
      const key = `lm${n}`, cv = bakeLandmark(n, W, H, k);
      this.textures.addCanvas(key, cv);
      const fit = Math.min(1, (n === 0 ? W : W * 0.5) / (cv.width / k), H * 0.3 / (cv.height / k));
      const [fx, fy] = cells[n];
      this.add.image(W * fx, H * fy, key).setScale(fit / k);
      this.add.text(W * fx, H * fy + H * 0.13, `${L.name} (${L.dur} s)`, { fontFamily: 'sans-serif', fontSize: '11px', color: '#FFF7E8' }).setOrigin(0.5, 0.5);
    });
  }

  private powerStrip(W: number, H: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x8FD3FF, 1).fillRect(0, 0, W, H * 0.62);
    g.fillStyle(0x0B1230, 1).fillRect(0, H * 0.62, W, H * 0.38);
    const u = this.cell, cols = 5, step = 1 / 60;
    const row = (label: string, y: number, kind: (typeof POWER_KINDS)[number], frames: number[], act?: (b: PowerBubble) => void, to?: boolean) => {
      this.add.text(8, y - u * 1.25, label, { fontFamily: 'sans-serif', fontSize: '11px', color: '#22183A' });
      frames.forEach((at, c) => {
        const x = W * (c + 0.5) / cols, b = new PowerBubble(this.tex, kind, 30);
        let t = 0;
        b.set(x, y).update(0);
        if (act) { while (t < 0.6) { b.update(step); t += step; } }
        if (act) to ? b.collect({ x: x + 2.2 * u, y: y + 1.6 * u }) : act(b);
        for (let e = 0; e < at; e += step) b.update(step);
      });
    };
    row('spawn 0.05 / 0.1 / 0.17 / 0.25 / 0.34 s', u * 1.6, 'clean', [0.05, 0.1, 0.17, 0.25, 0.34]);
    row('idle: bob and sway', u * 4.1, 'glue', [0.7, 0.9, 1.1, 1.3, 1.5]);
    row('collect: burst', u * 6.6, 'undo', [0.02, 0.06, 0.12, 0.2, 0.32], b => b.collect());
    row('collect to a slot (down-right)', u * 9.1, 'slowmo', [0.04, 0.12, 0.2, 0.28, 0.38], () => {}, true);
    row('fade: expired', u * 11.6, 'quickset', [0.05, 0.12, 0.2, 0.3, 0.4], b => b.fade());
    // Night: every bubble idle, then the effect textures.
    POWER_KINDS.forEach((k, i) => { const b = new PowerBubble(this.tex, k, 30); b.set(W * (i + 0.5) / 5, H * 0.62 + u * 1.5); for (let e = 0; e < 0.8; e += step) b.update(step); });
    const fxs: [VfxName, number, number][] = [['sweep', hexNum(POWER_COLORS.clean), 0.6], ['honey', 0xFFFFFF, 1.6], ['spark', hexNum(SIGNAL.gold), 1.6], ['ripple', hexNum(POWER_COLORS.slowmo), 0.8], ['gust', 0xFFFFFF, 0.7], ['shard', 0xFFFFFF, 1.6]];
    fxs.forEach(([n, tint, sc], i) => {
      const r = this.tex.vfx(n);
      this.add.image(W * (i + 0.5) / 6, H * 0.62 + u * 4.6, r.key, r.frame).setTint(tint).setScale(this.tex.scale * sc).setRotation(n === 'spark' ? -0.6 : 0);
      this.add.text(W * (i + 0.5) / 6, H * 0.62 + u * 6.8, n, { fontFamily: 'sans-serif', fontSize: '10px', color: '#FFF7E8' }).setOrigin(0.5, 0.5);
    });
  }

  private bubbles: { b: PowerBubble; born: number; i: number }[] = [];
  private fxs: { img: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; g: number; drag: number; age: number; life: number; s0: number; s1: number; spin: number; face: boolean; a0: number }[] = [];
  private fxPhase = '';

  private fx(name: VfxName, x: number, y: number, vx: number, vy: number, o: { tint?: number; add?: boolean; life?: number; s0?: number; s1?: number; g?: number; drag?: number; spin?: number; face?: boolean; alpha?: number } = {}): void {
    const r = this.tex.vfx(name), img = this.add.image(x, y, r.key, r.frame).setDepth(40);
    if (o.tint !== undefined) img.setTint(o.tint);
    if (o.add) img.setBlendMode(Phaser.BlendModes.ADD);
    const nat = VFX[name as keyof typeof VFX] ?? 0.4;
    this.fxs.push({ img, x, y, vx, vy, g: o.g ?? 0, drag: o.drag ?? 0, age: 0, life: o.life ?? 0.6, s0: (o.s0 ?? nat) / nat, s1: (o.s1 ?? nat) / nat, spin: o.spin ?? 0, face: !!o.face, a0: o.alpha ?? 1 });
  }

  private powersUpdate(t: number, dt: number, pieceX: number, pieceY: number, contacts: [number, number][]): void {
    const u = this.cell, W = this.scale.width, view = this.cameras.main.worldView;
    // Bubbles: each one spawns, waits, flickers on its last shape, then is collected (flying to a slot) or fades.
    const hold = qs.get('pw') === 'idle';
    POWER_KINDS.forEach((kind, i) => {
      const cyc = hold ? 0 : Math.floor((t + i * 0.5) / 4.2);
      let e = this.bubbles.find(b => b.i === i);
      if (!e || (!hold && e.born !== cyc)) {
        e?.b.destroy();
        e = { b: new PowerBubble(this.tex, kind, 30), born: cyc, i };
        this.bubbles = this.bubbles.filter(b => b.i !== i).concat(e);
      }
      const lt = hold ? 1 : (t + i * 0.5) - cyc * 4.2;
      const x = W * (i + 0.5) / 5, y = this.top - (8.2 + (i % 2) * 0.9) * u;
      e.b.set(x, y).ending(!hold && lt > 2.1);
      if (!hold && lt > 2.9) {
        const slot = document.querySelector(`[data-slot="${(cyc + i) % 2}"]`)?.getBoundingClientRect();
        if ((cyc + i) % 3 !== 2) e.b.collect(slot ? { x: view.x + slot.left + slot.width / 2, y: view.y + slot.top + slot.height / 2 } : undefined);
        else e.b.fade();
      }
      e.b.update(dt);
    });

    // Effects, two seconds each: Clean Slate, Glue, Slow-Mo, Second Wind.
    const pick = qs.get('fx'), order = ['sweep', 'glue', 'slowmo', 'gust'];
    const phase = pick ?? order[Math.floor(t / 2.2) % 4], pt = pick ? t % 2.2 : t % 2.2;
    const began = phase !== this.fxPhase || (pick !== null && pt < dt);
    this.fxPhase = phase;
    const towerL = this.left - 0.5 * u, towerR = this.left + 6.5 * u, stretchY = this.top - 2.5 * u;
    if (phase === 'sweep' && began) {
      this.fx('sweep', towerL - u, stretchY, (towerR - towerL + 2 * u) / 0.32, 0, { tint: hexNum(POWER_COLORS.clean), add: true, life: 0.42, alpha: 0.9 });
      for (const [c, r] of [[1, 2], [3.5, 3], [5, 1.5]]) this.time.delayedCall(80 + c * 40, () => {
        const px = this.left + c * u, py = this.top - r * u;
        for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28, v = u * (1 + Math.random() * 2.5); this.fx('puff', px, py, Math.cos(a) * v, Math.sin(a) * v - u, { tint: hexNum(BIOMES[0].dust), life: 0.5, s0: 0.45, s1: 0.9, drag: 3, alpha: 0.9 }); }
        this.fx('sparkle', px, py, 0, 0, { tint: hexNum(POWER_COLORS.clean), add: true, life: 0.4, s0: 0.8, s1: 0.1 });
      });
    }
    if (phase === 'glue') {
      if (Math.random() < dt * 9) this.fx('honey', pieceX + (Math.random() - 0.5) * 2.4 * u, pieceY + 0.9 * u, 0, u * 0.6, { life: 0.8, g: u * 7, s0: 0.3, s1: 0.22 });
      if (Math.floor(pt / 0.7) !== Math.floor((pt - dt) / 0.7)) for (const [cx, cy] of contacts) for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = u * (3 + Math.random() * 3);
        this.fx('spark', cx, cy, Math.cos(a) * v, Math.sin(a) * v, { tint: hexNum(SIGNAL.gold), add: true, life: 0.35, s0: 0.45, s1: 0.2, drag: 4, face: true });
      }
    }
    if (phase === 'slowmo') {
      if (began) this.fx('ripple', pieceX, pieceY, 0, 0, { tint: hexNum(POWER_COLORS.slowmo), add: true, life: 0.7, s0: 0.6, s1: 3.4 });
      if (Math.random() < dt * 10) this.fx('stardust', pieceX + (Math.random() - 0.5) * 2.6 * u, pieceY - 0.5 * u, 0, -u * 0.6, { tint: hexNum(POWER_COLORS.slowmo), add: true, life: 0.9, s0: 0.24, s1: 0.05, drag: 1 });
    }
    if (phase === 'gust' && began) {
      this.fx('ripple', W / 2, stretchY - 2 * u, 0, 0, { tint: hexNum(POWER_COLORS.wind), add: true, life: 0.6, s0: 1, s1: 5 });
      for (let k = 0; k < 16; k++) {
        const y = view.y + view.height * (0.12 + 0.7 * Math.random());
        this.fx('gust', view.x - (1.5 + Math.random() * 5) * u, y, u * (20 + Math.random() * 8), 0, { life: 0.95, alpha: 0.85, s0: 2.4 + Math.random(), s1: 2.6 });
      }
    }
    for (const p of this.fxs) {
      p.age += dt;
      const f = p.age / p.life;
      p.vy += p.g * dt; p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.img.setPosition(p.x, p.y).setScale((p.s0 + (p.s1 - p.s0) * f) * this.tex.scale).setAlpha(p.a0 * (f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4)));
      p.img.setRotation(p.face ? Math.atan2(p.vy, p.vx) : p.img.rotation + p.spin * dt);
      if (f >= 1) p.img.destroy();
    }
    this.fxs = this.fxs.filter(p => p.age < p.life);
  }

  private gallery(W: number): void {
    this.cameras.main.setBackgroundColor('#2B2F7A');
    const keys = Object.keys(ART_SHAPES), cell = this.cell * 0.5;
    const tex = new ArtTextures(this, { cellPx: cell });
    let x = 8, y = 8, rowH = 0;
    const looks: { stone?: boolean; rim?: boolean; ex?: Expression }[] = [{}, { ex: 'worried' }, { stone: true }, { rim: true, ex: 'panic' }];
    for (const k of keys) for (let q = 0; q < 4; q++) {
      const look = looks[q];
      const p = pose(k, q), w = p.w * cell, h = p.h * cell;
      if (x + w + 10 > W) { x = 8; y += rowH + 14; rowH = 0; }
      const v = new BlocklingView(tex, k, { seed: q }).setPose(x + w / 2 + 4, y + h / 2 + 4, q * Math.PI / 2 + num('res', 0));
      if (look.stone) v.setStone(1);
      if (look.rim) v.setRim(1);
      if (look.ex) v.setExpression(look.ex);
      v.update(0.016);
      x += w + 14; rowH = Math.max(rowH, h);
    }
  }

  private sparks: { img: Phaser.GameObjects.Image; vx: number; vy: number; spin: number; age: number; life: number; s0: number; s1: number }[] = [];
  private burstAt = -10;

  private vfxSheet(W: number, H: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x6EC3FF, 1).fillRect(0, 0, W, H * 0.42);
    g.fillStyle(0x0B1230, 1).fillRect(0, H * 0.42, W, H * 0.58);
    const tint: Record<string, number> = {
      puff: hexNum(BIOMES[0].dust), ring: hexNum(SIGNAL.gold), shockwave: hexNum(SIGNAL.gold), sparkle: hexNum(SIGNAL.gold),
      stardust: hexNum(BIOMES[5].dust), chip: 0xB9B1A6, confetti: hexNum(ART_SHAPES.T.base), rays: hexNum('#FFE58F'), flash: 0xFFFFFF,
      sweep: hexNum(POWER_COLORS.clean), spark: hexNum(SIGNAL.gold), ripple: hexNum(POWER_COLORS.slowmo), shard: hexNum(POWER_COLORS.undo),
    };
    const names = VFX_NAMES, cols = 6, cell = W / cols;
    for (const [half, y0] of [[0, 14], [1, H * 0.42 + 14]] as [number, number][]) {
      names.forEach((n, i) => {
        const r = this.tex.vfx(n), cx = (i % cols + 0.5) * cell, cy = y0 + Math.floor(i / cols) * cell * 1.05 + cell * 0.45;
        const nat = (n in VFX ? VFX[n as keyof typeof VFX] : 0.4) * this.cell;
        const fit = Math.min(1, (cell * 0.72) / Math.max(1, nat)) * this.tex.scale;
        const img = this.add.image(cx, cy, r.key, r.frame).setScale(fit);
        if (tint[n]) img.setTint(tint[n]);
        if (half === 0) this.add.text(cx, cy + cell * 0.42, n, { fontFamily: 'sans-serif', fontSize: '10px', color: '#22183A' }).setOrigin(0.5, 0.5);
      });
    }
  }

  private vfxUpdate(t: number, dt: number): void {
    const W = this.scale.width, H = this.scale.height, cx = W / 2, cy = H * 0.8, u = this.cell;
    if (t - this.burstAt > 2.4) {
      this.burstAt = t;
      const add = (name: Parameters<ArtTextures['vfx']>[0], vx: number, vy: number, o: { tint?: number; life?: number; s0?: number; s1?: number; spin?: number } = {}) => {
        const r = this.tex.vfx(name), img = this.add.image(cx, cy, r.key, r.frame).setTint(o.tint ?? 0xFFFFFF).setRotation(Math.random() * 6.28);
        this.sparks.push({ img, vx, vy, spin: o.spin ?? 0, age: 0, life: o.life ?? 1.2, s0: o.s0 ?? 1, s1: o.s1 ?? 0.6 });
      };
      add('shockwave', 0, 0, { tint: hexNum(SIGNAL.gold), life: 0.5, s0: 0.3, s1: 2.2 });
      add('rays', 0, 0, { tint: 0xFFE58F, life: 0.9, s0: 0.6, s1: 1.4, spin: 0.8 });
      add('flash', 0, 0, { life: 0.25, s0: 1, s1: 2 });
      const minis = ['mini_I', 'mini_O', 'mini_T', 'mini_L', 'mini_J', 'mini_S', 'mini_Z'] as const;
      for (let i = 0; i < 36; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = u * (5 + Math.random() * 6);
        add(i % 3 ? minis[i % 7] : 'confetti', Math.cos(a) * v, Math.sin(a) * v, { tint: i % 3 ? 0xFFFFFF : hexNum(ART_SHAPES[minis[i % 7].slice(5)].base), life: 1.6 + Math.random() * 0.6, spin: (Math.random() - 0.5) * 12, s1: 0.8 });
      }
      for (let i = 0; i < 8; i++) add('sparkle', (Math.random() - 0.5) * u * 6, -u * (2 + Math.random() * 4), { tint: hexNum(SIGNAL.gold), life: 0.8, s0: 1, s1: 0.2 });
    }
    for (const p of this.sparks) {
      p.age += dt;
      const f = p.age / p.life;
      p.vy += u * 12 * dt * (p.vx || p.vy ? 1 : 0); p.vx *= Math.exp(-1.2 * dt); p.vy *= Math.exp(-1.2 * dt);
      p.img.x += p.vx * dt; p.img.y += p.vy * dt; p.img.rotation += p.spin * dt;
      p.img.setScale((p.s0 + (p.s1 - p.s0) * f) * this.tex.scale).setAlpha(f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4));
      if (f >= 1) p.img.destroy();
    }
    this.sparks = this.sparks.filter(p => p.age < p.life);
  }

  update(time: number, deltaMs: number): void {
    if (qs.has('gallery') || qs.has('pstrip') || qs.has('landmarks')) return;
    if (qs.has('vfx')) { this.vfxUpdate((time - this.time0) / 1000, Math.min(0.05, deltaMs / 1000)); return; }
    const dt = Math.min(0.05, deltaMs / 1000), t = (time - this.time0) / 1000;
    const cell = this.cell, cam = this.cameras.main;
    const tour = qs.has('tour'), from = num('from', 0);
    cam.scrollY = -(tour ? Math.max(0, t - 1) * 2.2 : num('climb', 0)) * cell;

    const clock = this.sky.update(dt, 0, 0.2);
    const sp = tour ? Math.min(qs.has('from') ? 9.7 : 2.6, from + Math.max(0, t - 1) * 0.3) : qs.has('sp') ? num('sp', 0) : clock;
    // From scrollY, not worldView, which only catches up after the first frame renders.
    const ground = (this.groundY - (cam.scrollY + cam.height * (1 - 1 / cam.zoom) / 2)) * cam.zoom;
    if (qs.has('at')) {
      // Frozen frame: play the arrival once and step the backdrop to `at` seconds into it, then hold.
      if (!this.palSet) {
        this.backdrop.update(0, ground, sp);
        this.backdrop.arrival(Math.floor(sp + 0.02));
        for (let e = 0; e < num('at', 0); e += 1 / 60) this.backdrop.update(1 / 60, ground, sp);
      }
      this.backdrop.update(0, ground, sp);
    } else this.backdrop.update(dt, ground, sp);
    if (qs.has('at')) this.palSet = true;
    if (qs.has('pal') && !this.palSet) { this.palSet = true; this.backdrop.setCosmos(BIOMES[9].firstCp + 6 * num('pal', 0)); }
    if (qs.has('palcycle') && Math.floor(t / 7) !== Math.floor((t - dt) / 7)) this.backdrop.setCosmos(BIOMES[9].firstCp + 6 * Math.floor(t / 7));
    const bi = Math.floor(sp + 0.02);
    if (tour && bi > this.lastBiome && t > 0.5) this.backdrop.arrival(bi);
    if (qs.has('arrive') && Math.floor((t - 0.5) / 4) !== Math.floor((t - 0.5 - dt) / 4)) this.backdrop.arrival(bi);
    this.lastBiome = bi;
    const rim = rimAmount(sp);

    const tension = qs.has('tension') ? num('tension', 0) : 0.5 + 0.5 * Math.sin(t * 0.5);
    const topEx: Expression = tension >= 0.85 ? 'panic' : tension >= 0.3 ? 'worried' : 'idle';
    for (const p of this.tower) {
      const P = pose(p.key, p.q);
      const x = this.left + (p.c + P.w / 2) * cell, y = this.top - (p.r + P.h / 2) * cell;
      p.view.setPose(x, y, p.q * Math.PI / 2 + (p.angle ?? 0)).setStone(p.stone ?? 0).setRim(rim);
      p.view.setLively(p.r >= 2).setExpression(p.r >= 4 ? topEx : 'idle').setSweat(tension >= 0.6);
      p.view.update(dt);
    }

    // Active piece and its guide.
    const states: GuideShow['state'][] = ['stable', 'stable', 'risky', 'tip', 'miss'];
    const pick = qs.has('powers') ? 'stable' : qs.get('state');
    const idx = pick ? ['stable', 'perfect', 'risky', 'tip', 'miss'].indexOf(pick) : Math.floor(t / 2.4) % 5;
    const state = states[Math.max(0, idx)], perfect = idx === 1;
    const AQ = 2, A = pose('L', AQ), aw = A.w * cell, ah = A.h * cell;
    // Landing columns per state: flat on the T (stable/perfect), hanging off an edge (risky, tip), beside the tower (miss).
    const col = [1, 1.5, 3.5, 4.5, 6.6][Math.max(0, idx)];
    const pieceX = this.left + (col + A.w / 2) * cell, pieceY = this.top - 10.5 * cell + Math.sin(t * 1.5) * 3;
    const landTop = this.top - 6 * cell;
    const ghostY = landTop - ah / 2;
    this.active.setPose(pieceX, pieceY, AQ * Math.PI / 2 + Math.sin(t * 1.3) * 0.03).setRim(rim);
    this.active.update(dt);
    const contacts: [number, number][] = state === 'miss' ? [] : [0, 1, 2].filter(i => col + i < 6.5 && col + i >= 0).map(i => [pieceX - aw / 2 + (i + 0.5) * cell, landTop]);
    this.guide.show({
      key: 'L', q: AQ, pieceX, pieceY, ghostX: pieceX, ghostY, state, perfect,
      contacts: state === 'tip' ? contacts.slice(0, 1) : contacts,
      missBottomY: cam.worldView.y + cam.worldView.height,
      viewLeft: cam.worldView.x, viewRight: cam.worldView.x + cam.worldView.width,
    });
    this.guide.update(dt);
    void aw;

    if (qs.has('powers')) { this.powersUpdate(t, dt, pieceX, pieceY, contacts); return; }

    // Checkpoint line 8 blocks up: the tower closes in (0-2.5 s), holds steady (2.5-4.5 s), claims, and starts over.
    const pedW = 6, cpY = this.top - 8 * cell, view = cam.worldView;
    const cycle = 7.5, phase = qs.get('cp');
    if (!this.line || (!phase && t - this.lineBorn > cycle)) { this.line?.destroy(); this.line = new CheckpointLine(this.tex, 3, 900); this.lineBorn = t; }
    const lt = phase === 'near' ? 2 : phase === 'hold' ? 3.8 : phase === 'claim' ? 99 : t - this.lineBorn;
    this.line.set({ y: cpY, x0: view.x - cell, x1: view.x + view.width + cell, near: Math.min(1, lt / 2.5), hold: lt > 2.5 ? Math.min(1, (lt - 2.5) / 2) : 0 });
    if (lt >= 4.5 && !this.line.claimed) this.line.claim(this.left, this.left + pedW * cell);
    this.line.update(dt);
    this.pb.set(this.top - 4.5 * cell, view.x - cell, view.x + view.width + cell, this.left - 1.4 * cell).update(dt);
    if (Math.floor(t / cycle) !== Math.floor((t - dt) / cycle)) this.pb.pop();
  }
}

/** A DOM power bar like the game's HUD, plus every icon and Second Wind state, styled by powerBarCss(). */
function powerBar(): void {
  const css = `
.st-hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Fredoka', 'Nunito', system-ui, sans-serif; color: ${INK}; z-index: 5; }
.st-btn { pointer-events: auto; background: #FFF7E8; border: 3px solid ${INK}; border-radius: 14px; box-shadow: 0 4px 0 ${INK}; font: 600 16px 'Fredoka', system-ui, sans-serif; color: ${INK}; padding: 0; box-sizing: border-box; }
.st-powers { position: absolute; left: 12px; bottom: 14px; display: flex; gap: 8px; align-items: flex-end; }
.st-slot { width: ${POWER.slotPx}px; height: ${POWER.slotPx}px; display: grid; place-items: center; position: relative; }
.st-slot.empty { background: rgba(255,247,232,0.35); border-style: dashed; box-shadow: none; }
.st-tag { position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%); font: 700 10px 'Fredoka', sans-serif; background: ${INK}; color: #FFF7E8; border-radius: 6px; padding: 0 5px; letter-spacing: 0.06em; white-space: nowrap; }
.st-wind { width: ${POWER.windPx}px; height: ${POWER.windPx}px; }
.st-sheet { position: absolute; left: 0; right: 0; top: 10px; display: flex; flex-direction: column; gap: 22px; align-items: center; }
.st-sheet .st-row { display: flex; gap: 10px; align-items: flex-end; }
.st-cap { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); font: 600 9px 'Fredoka', sans-serif; color: ${INK}; background: rgba(255,247,232,0.8); border-radius: 4px; padding: 0 3px; white-space: nowrap; }
.st-chip { pointer-events: none; background: #FFF7E8; border: 2px solid ${INK}; border-radius: 10px; font: 600 13px 'Fredoka', sans-serif; padding: 1px 7px; }
${powerBarCss()}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const tags: Record<string, string> = { clean: 'SWEEP', quickset: 'SET', undo: 'UNDO', glue: 'GLUE', slowmo: 'SLOW' };
  const img = (k: PowerIcon, px: number) => `<img class="st-icon" alt="" src="${powerIconUrl(k, px * POWER.iconFill)}">`;
  const slot = (k: string, attrs = '') => `<button class="st-btn st-slot" data-kind="${k}" ${attrs}>${img(k as PowerIcon, POWER.slotPx)}<span class="st-tag">${tags[k]}</span></button>`;
  const wind = (cls: string, tag: string, cap?: string) => `<button class="st-btn st-slot st-wind ${cls}">${img('wind', POWER.windPx)}<span class="st-tag">${tag}</span>${cap ? `<span class="st-cap">${cap}</span>` : ''}</button>`;
  const hud = document.createElement('div');
  hud.className = 'st-hud';
  hud.innerHTML = `
<div class="st-sheet">
  <div class="st-row">${POWER_KINDS.map(k => slot(k)).join('')}</div>
  <div class="st-row">${wind('earn', 'CP 2', 'earning')}${wind('', '2ND WIND', 'ready')}${wind('armed', 'TAP AGAIN', 'armed')}${wind('glow', '2ND WIND', 'trouble')}${wind('spent', '2ND WIND', 'spent')}</div>
  <div class="st-row"><span class="st-chip"><img class="st-icon" alt="" src="${powerIconUrl('glue', 16)}">3</span><span class="st-chip"><img class="st-icon" alt="" src="${powerIconUrl('slowmo', 16)}">2</span></div>
</div>
<div class="st-powers">${slot('clean', 'data-slot="0"')}${slot('glue', 'data-slot="1"')}${wind('', '2ND WIND')}</div>`;
  document.body.appendChild(hud);
  // Replay the spent animation.
  const spent = hud.querySelector('.st-wind.spent');
  setInterval(() => { spent?.classList.remove('spent'); void (spent as HTMLElement | null)?.offsetWidth; spent?.classList.add('spent'); }, 1500);
}

new Phaser.Game({
  type: qs.get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#FFF7E8',
  render: qs.has('maxtex') ? { maxTextures: num('maxtex', 1) } : {},
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [Preview],
});
