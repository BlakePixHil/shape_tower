// Touch gestures (gameplay.md §2): relative drag to move, tap to rotate, drag down for soft drop,
// flick down for hard drop, flick up for hold. Thresholds are in CSS px.

export interface GestureTarget {
  /** The steered shape's logical x target, or null when nothing is steered. */
  ctrlX(): number | null;
  /** CSS px per block (screen width / 12). */
  blockPx(): number;
  sensitivity(): number;
  moveTo(x: number): void;
  /** +1 clockwise, −1 counter-clockwise (the sim's convention). */
  rotate(dir: number): void;
  soft(on: boolean): void;
  hard(lockX: number | undefined): void;
  hold(): void;
  /** Two-finger drag to peek down the tower (blocks, positive = look lower). */
  peek(blocks: number | null): void;
  /** Splits taps: left half counter-clockwise, right half clockwise. */
  splitTap(): boolean;
}

interface Sample { x: number; y: number; t: number }

const TAP_MS = 200;
const TAP_PX = 12;
const SOFT_PX = 40;
const FLICK_WINDOW_MS = 120;
const FLICK_SPEED = 1.2;      // screen heights per second
const FLICK_TRAVEL = 0.1;     // of screen height
const FLICK_TAN = Math.tan((35 * Math.PI) / 180); // also: a fast downward stroke this close to vertical doesn't steer
const STROKE_SPEED = 0.5;     // screen heights per second: faster than this downward is a drop stroke
const STROKE_MAX_MS = 600;
const HYSTERESIS = 0.15;

export class Gestures {
  private id: number | null = null;
  private start: Sample | null = null;
  private origin = { x: 0 };      // finger x that maps to baseX
  private baseX: number | null = null;
  private sent: number | null = null;
  private samples: Sample[] = [];
  private xHistory: { t: number; x: number }[] = [];
  private softOn = false;
  private softFrom: Sample | null = null; // where the current straight-down stretch began
  private maxY = 0;
  private moved = 0;
  private second: { id: number; y0: number } | null = null;
  private buffered: { kind: 'rotate' | 'hard' | 'hold'; dir?: number; t: number } | null = null;

  constructor(private el: HTMLElement, private target: GestureTarget) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.keyUp);
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('keyup', this.keyUp);
  }

  /** Called every frame: applies a tap or flick that arrived while no shape was steered (§2, buffering). */
  update(now: number): void {
    const b = this.buffered;
    if (!b) return;
    if (now - b.t > 450) { this.buffered = null; return; }
    if (this.target.ctrlX() === null) return;
    this.buffered = null;
    if (b.kind === 'rotate') this.target.rotate(b.dir ?? 1);
    else if (b.kind === 'hard') this.target.hard(undefined);
    else this.target.hold();
    if (this.id !== null) this.rebase(this.samples[this.samples.length - 1]?.x ?? 0);
  }

  private rebase(fingerX: number): void {
    this.baseX = this.target.ctrlX();
    this.sent = this.baseX;
    this.origin.x = fingerX;
  }

  private down = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.id !== null) {
      if (this.second === null) { this.second = { id: e.pointerId, y0: e.clientY }; }
      return;
    }
    this.el.setPointerCapture?.(e.pointerId);
    this.id = e.pointerId;
    const s = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    this.start = s;
    this.samples = [s];
    this.maxY = s.y;
    this.moved = 0;
    this.softOn = false;
    this.softFrom = s;
    this.rebase(s.x);
    this.xHistory = [{ t: s.t, x: this.baseX ?? 0 }];
  };

  private move = (e: PointerEvent): void => {
    if (this.second && e.pointerId === this.second.id) {
      const bp = this.target.blockPx();
      this.target.peek(Math.max(0, (e.clientY - this.second.y0) / bp));
      return;
    }
    if (e.pointerId !== this.id || !this.start) return;
    e.preventDefault();
    const s = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    this.samples.push(s);
    if (this.samples.length > 64) this.samples.shift();
    this.moved = Math.max(this.moved, Math.hypot(s.x - this.start.x, s.y - this.start.y));
    if (this.second) return;

    // Horizontal: relative drag with half-block snapping and hysteresis. The sideways drift of a
    // fast downward stroke doesn't steer: the anchor moves with the finger instead.
    const prev = this.samples[this.samples.length - 2];
    const r = this.samples.find(p => p.t >= s.t - 50) ?? this.samples[0];
    const rdy = s.y - r.y;
    const stroking = r !== s && rdy / (Math.max(1, s.t - r.t) / 1000) / window.innerHeight > STROKE_SPEED && Math.abs(s.x - r.x) <= rdy * FLICK_TAN;
    if (this.baseX === null) this.rebase(s.x);
    if (stroking && prev) this.origin.x += s.x - prev.x;
    else if (this.baseX !== null && this.sent !== null) {
      const raw = this.baseX + ((s.x - this.origin.x) / this.target.blockPx()) * this.target.sensitivity();
      if (Math.abs(raw - this.sent) >= 0.25 + HYSTERESIS) {
        const snapped = Math.round(raw * 2) / 2;
        if (snapped !== this.sent) {
          this.sent = snapped;
          this.target.moveTo(snapped);
          this.softFrom = s; // steering sideways: a soft drop needs a fresh downward stretch
        }
      }
    }
    if (this.sent !== null) {
      this.xHistory.push({ t: s.t, x: this.sent });
      if (this.xHistory.length > 64) this.xHistory.shift();
    }

    // Soft drop: a downward drag within about 22° of vertical for 40 px since the shape last moved
    // sideways, so a diagonal drag only steers (QA-003). Ends on an upward move.
    const from = this.softFrom ?? this.start;
    const dy = s.y - from.y, dx = s.x - from.x;
    if (!this.softOn && dy > SOFT_PX && dy > 2.5 * Math.abs(dx)) { this.softOn = true; this.target.soft(true); }
    this.maxY = Math.max(this.maxY, s.y);
    if (this.softOn && s.y < this.maxY - TAP_PX) { this.softOn = false; this.target.soft(false); this.maxY = s.y; }
  };

  private up = (e: PointerEvent): void => {
    if (this.second && e.pointerId === this.second.id) { this.second = null; this.target.peek(null); return; }
    if (e.pointerId !== this.id || !this.start) return;
    e.preventDefault();
    const end = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    this.samples.push(end);
    const H = window.innerHeight;
    const startT = end.t - FLICK_WINDOW_MS;
    const w0 = this.samples.find(p => p.t >= startT) ?? this.samples[0];
    const dt = Math.max(1, end.t - w0.t) / 1000;
    const vy = (end.y - w0.y) / dt / H;
    const wdx = end.x - w0.x, wdy = end.y - w0.y;
    const travel = Math.abs(end.y - this.start.y) / H;
    const vertical = Math.abs(wdx) <= Math.abs(wdy) * FLICK_TAN;
    const dur = end.t - this.start.t;
    const wasSoft = this.softOn;
    if (this.softOn) { this.softOn = false; this.target.soft(false); }

    if (vertical && travel > FLICK_TRAVEL && Math.abs(vy) > FLICK_SPEED) {
      if (vy > 0) {
        // Lock in the x the shape had just before the downward stroke began, so a swipe that isn't
        // straight down never shifts the drop (§2).
        const lockT = Math.max(this.start.t, Math.min(w0.t, this.strokeStart(end)));
        let lockX: number | undefined;
        for (const h of this.xHistory) if (h.t <= lockT) lockX = h.x;
        lockX ??= this.xHistory[0]?.x;
        if (this.target.ctrlX() === null) this.buffered = { kind: 'hard', t: end.t };
        else this.target.hard(lockX);
      } else {
        if (this.target.ctrlX() === null) this.buffered = { kind: 'hold', t: end.t };
        else this.target.hold();
      }
    } else if (!wasSoft && dur < TAP_MS && this.moved < TAP_PX && !this.second) {
      const dir = this.target.splitTap() && end.x < window.innerWidth / 2 ? -1 : 1;
      if (this.target.ctrlX() === null) this.buffered = { kind: 'rotate', dir, t: end.t };
      else this.target.rotate(dir);
    }
    this.id = null;
    this.start = null;
  };

  /** When the finger's final downward stroke began: walk back while it keeps moving down fast. */
  private strokeStart(end: Sample): number {
    const H = window.innerHeight;
    let t0 = end.t, slow = 0;
    for (let i = this.samples.length - 1; i > 0 && end.t - this.samples[i - 1].t <= STROKE_MAX_MS; i--) {
      const a = this.samples[i - 1], b = this.samples[i];
      const vy = (b.y - a.y) / (Math.max(1, b.t - a.t) / 1000) / H;
      if (vy < STROKE_SPEED) { if (vy < 0 || ++slow > 1) break; continue; } // one slow sample is jitter
      slow = 0;
      t0 = a.t;
    }
    return t0;
  }

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId === this.second?.id) { this.second = null; this.target.peek(null); }
    if (e.pointerId !== this.id) return;
    if (this.softOn) { this.softOn = false; this.target.soft(false); }
    this.id = null;
    this.start = null;
  };

  private key = (e: KeyboardEvent): void => {
    if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const x = this.target.ctrlX();
    switch (e.key) {
      case 'ArrowLeft': case 'a': if (x !== null) this.target.moveTo(x - 0.5); break;
      case 'ArrowRight': case 'd': if (x !== null) this.target.moveTo(x + 0.5); break;
      case 'ArrowUp': case 'w': case 'x': this.target.rotate(1); break;
      case 'z': this.target.rotate(-1); break;
      case 'ArrowDown': case 's': this.target.soft(true); break;
      case ' ': this.target.hard(undefined); break;
      case 'c': case 'Shift': this.target.hold(); break;
      default: return;
    }
    e.preventDefault();
  };

  private keyUp = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 's') this.target.soft(false);
  };
}
