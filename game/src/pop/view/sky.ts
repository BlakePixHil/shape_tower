// Blockling Pop's sky (Blake's playtest, 2026-11-01 evening): each area's backdrop alive behind the board,
// as the tower's is. Art's biome props (art/src/backdrops.ts) drift, bob, spin, sway, fall, flicker and
// pulse at the rates the tower's Backdrop gives them (art/src/phaser/backdrop.ts), laid out as Art's
// postcard lays them (a 390 px wide virtual screen, the Meadow's ground near the bottom), and the stars
// twinkle. A new area arrives like a climb: its sky fades in while the old area's props sink away and the
// new ones come down into place. Under Reduce motion it is the still postcard, cross-fading, as before.
//
// Every prop is its own element, moved with CSS transforms, so a frame costs a few style writes and no
// repainting; the sky itself is a CSS gradient and the stars are CSS tiles.

import { BIOMES, BIOME_BAKERS, STAR_LAYERS, bakePostcard, bakeStarTile, starAmount, type BackdropPart } from '@art/index.ts';

/** The virtual screen width the props are laid out on (Art's postcard: art/src/ui/postcard.ts). */
const VW = 390;
const TAU = Math.PI * 2;
/** How long an arrival (the climb into a new area) takes, ms. */
export const SKY_ARRIVE_MS = 1600;

/** A flash's brightness at time t: a fast rise, a flicker and a slow decay (the tower Backdrop's flashAt). */
function flashAt(t: number, f: NonNullable<BackdropPart['flash']>): number {
  const ph = ((t % f.every) + f.every) % f.every;
  if (ph >= f.dur) return 0;
  const x = ph / f.dur, env = x < 0.12 ? x / 0.12 : (1 - (x - 0.12) / 0.88) ** 2;
  return env * (0.75 + 0.25 * Math.sin(x * 40)) * f.alpha;
}

const moves = (P: BackdropPart): boolean =>
  !!(P.drift || P.spin || P.bob || P.sway || P.fall || P.flash || P.pulse || P.enter || (P.frames && P.frames.length > 1));

interface Live {
  P: BackdropPart;
  el: HTMLCanvasElement;
  /** Size in virtual px. */
  w: number;
  h: number;
  phase: number;
  frame: number;
  moving: boolean;
}

export class PopSky {
  /** The whole sky (the view steps it with checkpoint progress). */
  readonly el: HTMLDivElement;
  readonly biome: number;
  /** Reduce motion: the still postcard. */
  readonly still: boolean;
  private props: HTMLDivElement | null = null;
  private live: Live[] = [];
  private stars: { el: HTMLDivElement; i: number }[] = [];
  private starsAt = 0;
  private sc = 1;
  private VH = 0;
  private t = 0;
  /** Seconds since this area arrived (the props' enter animations). */
  private age = 0;
  private arriving: boolean;

  /**
   * Area `biome`'s sky at w x h CSS px, baked at k device px per CSS px. `arriving`: it climbs in over the
   * current one (call arrive() once it is in the page).
   */
  constructor(biome: number, w: number, h: number, k: number, still: boolean, arriving: boolean) {
    this.biome = biome;
    this.still = still;
    this.arriving = arriving && !still;
    const el = document.createElement('div');
    el.className = 'pop-bg pop-sky';
    this.el = el;
    if (still) {
      const cv = bakePostcard(biome, w, h, k);
      cv.className = 'pop-sky-card';
      el.appendChild(cv);
      return;
    }
    const b = BIOMES[biome], sc = w / VW, kk = k * sc;
    this.sc = sc;
    this.VH = (VW * h) / w;
    const sky = document.createElement('div');
    sky.className = 'pop-sky-bg';
    sky.style.background = `linear-gradient(${b.sky[0]} 0%, ${b.sky[1]} 55%, ${b.sky[2]} 100%)`;
    el.appendChild(sky);
    this.starsAt = starAmount(biome + 0.3);
    if (this.starsAt > 0.01) {
      STAR_LAYERS.forEach((_, i) => {
        const tile = bakeStarTile(i, kk), s = document.createElement('div');
        s.className = 'pop-sky-stars';
        s.style.backgroundImage = `url(${tile.toDataURL()})`;
        s.style.backgroundSize = `${tile.width / k}px ${tile.height / k}px`;
        s.style.opacity = String(this.starsAt);
        sky.appendChild(s);
        this.stars.push({ el: s, i });
      });
    }
    const props = document.createElement('div');
    props.className = 'pop-sky-props';
    el.appendChild(props);
    this.props = props;
    const parts = BIOME_BAKERS[biome](VW, this.VH, kk).sort((p, q) => p.z - q.z);
    parts.forEach((P, n) => {
      // Deep Cosmos's other nebula palettes stay away (the postcard shows the first), as do one-off arrival props.
      if (P.palette !== undefined && P.palette !== 0) return;
      const r = P.res ?? 1, pw = P.canvas.width / (kk * r), ph = P.canvas.height / (kk * r);
      let cv = P.canvas;
      if (P.frames && P.frames.length > 1) {
        cv = document.createElement('canvas');
        cv.width = P.canvas.width; cv.height = P.canvas.height;
        cv.getContext('2d')!.drawImage(P.frames[0], 0, 0);
      }
      cv.className = moves(P) ? 'pop-sky-part moving' : 'pop-sky-part';
      cv.style.width = `${pw * sc}px`;
      cv.style.height = `${ph * sc}px`;
      cv.style.transformOrigin = `${(P.originX ?? 0) * 100}% ${(P.originY ?? 0) * 100}%`;
      const L: Live = { P, el: cv, w: pw, h: ph, phase: ((n * 2.399 + P.x * 0.013 + P.z * 1.37) % 1) * TAU, frame: 0, moving: moves(P) };
      this.live.push(L);
      props.appendChild(cv);
      this.place(L);
    });
  }

  /** Starts the climb in: the sky fades in over the old one and the props come down into place. */
  arrive(): void {
    if (this.still) {
      this.el.style.opacity = '0';
      requestAnimationFrame(() => { this.el.style.opacity = '1'; });
      return;
    }
    const sky = this.el.firstElementChild as HTMLElement, props = this.props!;
    sky.style.opacity = '0';
    props.style.opacity = '0';
    props.style.transform = 'translateY(-45%)';
    // Two frames, so the start styles are drawn before the transition runs.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sky.style.opacity = '1';
      props.style.opacity = '1';
      props.style.transform = 'translateY(0)';
    }));
  }

  /** The climb out: this area's props sink away (its sky stays under the new one until removed). */
  leave(): void {
    if (this.still || !this.props) return;
    this.props.style.opacity = '0';
    this.props.style.transform = 'translateY(45%)';
  }

  /** Moves the props on by dt ms. */
  update(dt: number): void {
    if (this.still) return;
    this.t += dt / 1000;
    this.age += dt / 1000;
    for (const L of this.live) if (L.moving) this.place(L);
    for (const S of this.stars) {
      const L = STAR_LAYERS[S.i];
      S.el.style.opacity = (this.starsAt * (1 - L.twinkle * (0.5 + 0.5 * Math.sin(this.t * L.hz * TAU + S.i * 2.1)))).toFixed(3);
    }
  }

  /** A part at time t, as the tower's Backdrop places it with the camera still. */
  private place(L: Live): void {
    const { P, w, h } = L, t = this.t, sc = this.sc;
    let alpha = 1, enterDy = 0;
    if (P.flash) alpha *= flashAt(t + (P.flash.offset ?? 0), P.flash);
    if (P.pulse) alpha *= P.pulse[1] + (1 - P.pulse[1]) * (0.5 + 0.5 * Math.sin(t * P.pulse[0] * TAU + L.phase));
    if (P.enter && this.arriving) {
      const f = Math.min(1, Math.max(0, (this.age - (P.enter.delay ?? 0)) / P.enter.dur)), ee = 1 - (1 - f) ** 3;
      if (P.enter.fade) alpha *= ee;
      if (P.enter.dy) enterDy = P.enter.dy * (1 - ee);
    }
    let x = P.x;
    if (P.drift) {
      const half = w / 2, span = VW + half * 2;
      x = (((P.x + t * P.drift + half) % span) + span) % span - half;
    }
    let y = P.anchor === 'entry' ? P.y : this.VH * 0.84 + P.y;
    if (P.fall) y += t * P.fall;
    const oy = P.originY ?? 0;
    if (P.wrapY) {
      const top = y - oy * h, wy = P.wrapY;
      y = (P.tile ? -((((-top) % wy) + wy) % wy) : ((((top + h) % wy) + wy) % wy) - h) + oy * h;
    }
    y += enterDy;
    if (P.bob) y += Math.sin(t * 1.7 + L.phase) * P.bob;
    const rot = P.spin ? t * P.spin : P.sway ? Math.sin(t * 1.3 + L.phase) * P.sway : 0;
    if (P.frames && P.frames.length > 1) {
      const f = Math.floor(t * (P.fps ?? 4) + L.phase) % P.frames.length;
      if (f !== L.frame) {
        L.frame = f;
        const c = L.el.getContext('2d')!;
        c.clearRect(0, 0, L.el.width, L.el.height);
        c.drawImage(P.frames[f], 0, 0);
      }
    }
    const tx = (x - (P.originX ?? 0) * w) * sc, ty = (y - oy * h) * sc;
    L.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)${rot ? ` rotate(${rot.toFixed(4)}rad)` : ''}`;
    const a = alpha <= 0.01 ? '0' : alpha >= 0.999 ? '' : alpha.toFixed(3);
    if (L.el.style.opacity !== a) L.el.style.opacity = a;
  }

  /** For the browser check: how many props move, and where the first moving one is now. */
  probe(): { parts: number; moving: number; first: string; stars: number } {
    const m = this.live.filter(L => L.moving);
    return { parts: this.live.length, moving: m.length, first: m[0]?.el.style.transform ?? '', stars: this.stars.length };
  }
}

/** The sky's CSS (added once with the view's). */
export const SKY_CSS = `
.pop-sky { overflow: hidden; pointer-events: none; }
.pop-sky-card { position: absolute; inset: 0; width: 100%; height: 100%; }
.pop-sky-bg { position: absolute; inset: 0; transition: opacity ${SKY_ARRIVE_MS}ms ease; }
.pop-sky-stars { position: absolute; inset: 0; background-repeat: repeat; }
.pop-sky-props { position: absolute; inset: 0; transition: opacity ${SKY_ARRIVE_MS}ms ease, transform ${SKY_ARRIVE_MS}ms cubic-bezier(.45,0,.25,1); }
.pop-sky-part { position: absolute; left: 0; top: 0; }
.pop-sky-part.moving { will-change: transform, opacity; }
`;
