// Haptics bridge (audio section 7). Patterns are data; backends translate them
// to @capacitor/haptics calls in the app, to navigator.vibrate on Android web,
// or to nothing. Rate limits: strong hits at most every 150 ms, ticks at most
// 15 per second.

import type { HapticsLevel } from './types';

export interface HapticEvent {
  /** start offset in ms */
  t: number;
  /** intensity 0-1 */
  i: number;
  /** sharpness 0-1 (used by richer backends) */
  s?: number;
  /** continuous duration in ms; omitted for a transient */
  d?: number;
}

export interface HapticPattern {
  events: HapticEvent[];
  /** dropped entirely at the Light level */
  optional?: boolean;
}

export const PATTERNS = {
  uiTap: { events: [{ t: 0, i: 0.3, s: 0.8 }] },
  move: { events: [{ t: 0, i: 0.15, s: 0.9 }], optional: true },
  rotate: { events: [{ t: 0, i: 0.35, s: 0.8 }] },
  rotateBlocked: { events: [{ t: 0, i: 0.5, s: 0.2 }] },
  lockOn: { events: [{ t: 0, i: 0.45, s: 1 }, { t: 40, i: 0.45, s: 1 }] },
  spawn: { events: [{ t: 0, i: 0.2, s: 0.6 }], optional: true },
  land1: { events: [{ t: 0, i: 0.4, s: 0.5 }] },
  land2: { events: [{ t: 0, i: 0.6, s: 0.5 }] },
  land3: { events: [{ t: 0, i: 0.85, s: 0.4 }, { t: 10, i: 0.5, s: 0.1, d: 90 }] },
  land4: { events: [{ t: 0, i: 1, s: 0.4 }, { t: 10, i: 0.6, s: 0.1, d: 120 }] },
  rubber: { events: [{ t: 0, i: 0.6, s: 0.5 }, { t: 90, i: 0.25, s: 0.5 }] },
  settle: { events: [{ t: 0, i: 0.3, s: 0.9 }] },
  perfect: { events: [{ t: 0, i: 0.45, s: 1 }] },
  heartbeat: { events: [{ t: 0, i: 0.55, s: 0.2 }, { t: 170, i: 0.35, s: 0.2 }] },
  clutch: { events: [{ t: 0, i: 0.4, s: 0.3, d: 300 }] },
  pieceLost: { events: [{ t: 0, i: 0.4, s: 0.2, d: 400 }] },
  heartLost: { events: [{ t: 0, i: 0.6, s: 0.4 }, { t: 110, i: 0.6, s: 0.4 }] },
  lastHeart: { events: [{ t: 0, i: 0.5, s: 0.1, d: 250 }] },
  heartRestored: { events: [{ t: 0, i: 0.3, s: 0.8 }, { t: 60, i: 0.3, s: 0.8 }] },
  collapse: { events: [{ t: 0, i: 0.8, s: 0.1, d: 700 }, { t: 120, i: 0.9, s: 0.5 }, { t: 330, i: 0.8, s: 0.5 }, { t: 520, i: 0.7, s: 0.5 }] },
  gameOver: { events: [{ t: 0, i: 1, s: 0.3 }] },
  bondSnap: { events: [{ t: 0, i: 0.7, s: 1 }] },
  solidRow: { events: [{ t: 0, i: 0.9, s: 0.5 }] },
  holdTick: { events: [{ t: 0, i: 0.2, s: 0.9 }], optional: true },
  holdCancel: { events: [{ t: 0, i: 0.4, s: 0.2 }] },
  checkpoint: { events: [{ t: 0, i: 0.4, s: 0.7 }, { t: 90, i: 0.6, s: 0.7 }, { t: 180, i: 0.8, s: 0.7 }, { t: 260, i: 0.5, s: 0.3, d: 300 }] },
  foundation: { events: [{ t: 0, i: 0.7, s: 0.4 }] },
  biome: { events: [{ t: 0, i: 0.25, s: 0.2, d: 800 }] },
  celebrate: { events: [{ t: 0, i: 0.5, s: 0.8 }, { t: 120, i: 0.5, s: 0.8 }, { t: 240, i: 0.8, s: 0.8 }, { t: 480, i: 1, s: 0.6 }] },
  hazardWarn: { events: [{ t: 0, i: 0.2, s: 0.2, d: 600 }], optional: true },
  xpTick: { events: [{ t: 0, i: 0.2, s: 0.9 }], optional: true },
  medium: { events: [{ t: 0, i: 0.55, s: 0.5 }] },
  double: { events: [{ t: 0, i: 0.5, s: 0.5 }, { t: 90, i: 0.5, s: 0.5 }] },
  light: { events: [{ t: 0, i: 0.25, s: 0.6 }] },
} satisfies Record<string, HapticPattern>;

export type PatternName = keyof typeof PATTERNS;

/** The subset of @capacitor/haptics the bridge uses. Pass the plugin's `Haptics` export. */
export interface CapacitorHapticsLike {
  impact(options: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' | string }): Promise<void> | void;
  vibrate?(options?: { duration?: number }): Promise<void> | void;
}

export interface HapticsBackend {
  readonly name: string;
  play(events: HapticEvent[], scale: number): void;
}

export class CapacitorBackend implements HapticsBackend {
  readonly name = 'capacitor';
  constructor(private plugin: CapacitorHapticsLike, private timers: Timers = defaultTimers) {}

  play(events: HapticEvent[], scale: number): void {
    for (const e of events) {
      const fire = () => {
        if (e.d) {
          // approximate a continuous buzz with a train of impacts every 50 ms
          const steps = Math.max(1, Math.round(e.d / 50));
          for (let k = 0; k < steps; k++) this.timers.set(() => this.hit(e.i * scale * (1 - k / steps / 2)), k * 50);
        } else this.hit(e.i * scale);
      };
      if (e.t <= 0) fire();
      else this.timers.set(fire, e.t);
    }
  }

  private hit(i: number): void {
    if (i < 0.08) return;
    const style = i < 0.4 ? 'LIGHT' : i < 0.7 ? 'MEDIUM' : 'HEAVY';
    try {
      void this.plugin.impact({ style });
    } catch {
      /* a failed haptic must never break the game */
    }
  }
}

export class VibrateBackend implements HapticsBackend {
  readonly name = 'vibrate';
  constructor(private vibrate: (pattern: number[]) => boolean) {}

  play(events: HapticEvent[], scale: number): void {
    // compile to navigator.vibrate's on/off millisecond list
    const out: number[] = [];
    let cursor = 0;
    for (const e of [...events].sort((a, b) => a.t - b.t)) {
      const i = e.i * scale;
      if (i < 0.12) continue;
      const on = Math.round(e.d ? e.d * i : 6 + 28 * i);
      const gap = Math.max(0, e.t - cursor);
      if (out.length === 0) {
        if (gap > 0) out.push(0, gap);
      } else out.push(gap);
      out.push(on);
      cursor = e.t + on;
    }
    if (out.length) {
      try {
        this.vibrate(out);
      } catch {
        /* ignore */
      }
    }
  }
}

export class NullBackend implements HapticsBackend {
  readonly name = 'none';
  play(): void {}
}

export interface Timers {
  set(fn: () => void, ms: number): void;
}
const defaultTimers: Timers = { set: (fn, ms) => void setTimeout(fn, ms) };

export interface HapticsOptions {
  plugin?: CapacitorHapticsLike | null | false;
  level?: HapticsLevel;
  /** clock in ms, injectable for tests */
  now?: () => number;
  timers?: Timers;
}

export class Haptics {
  level: HapticsLevel;
  readonly backend: HapticsBackend;
  private lastStrong = -1e9;
  private lastLight = -1e9;
  private now: () => number;

  constructor(opts: HapticsOptions = {}) {
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.backend = pickBackend(opts.plugin, opts.timers);
    this.level = opts.level ?? defaultHapticsLevel();
  }

  /** Plays a named pattern. `strength` (0-1) scales it, e.g. by impact force. Returns false if skipped. */
  play(name: PatternName, strength = 1): boolean {
    if (this.level === 'off') return false;
    const p: HapticPattern = PATTERNS[name];
    if (p.optional && this.level === 'light') return false;
    const scale = (this.level === 'light' ? 0.6 : 1) * Math.max(0, Math.min(1, strength));
    const maxI = Math.max(...p.events.map((e) => e.i)) * scale;
    const t = this.now();
    if (maxI >= 0.5) {
      if (t - this.lastStrong < 150) return false;
      this.lastStrong = t;
    } else {
      if (t - this.lastLight < 1000 / 15) return false;
      this.lastLight = t;
    }
    this.backend.play(p.events, scale);
    return true;
  }
}

function pickBackend(plugin: CapacitorHapticsLike | null | false | undefined, timers?: Timers): HapticsBackend {
  if (plugin === false) return new NullBackend();
  const g = globalThis as any;
  const cap: CapacitorHapticsLike | undefined = plugin ?? g?.Capacitor?.Plugins?.Haptics;
  if (cap && typeof cap.impact === 'function' && (plugin || g?.Capacitor?.isNativePlatform?.())) return new CapacitorBackend(cap, timers);
  const nav = g?.navigator;
  if (nav && typeof nav.vibrate === 'function') return new VibrateBackend((pat) => nav.vibrate(pat));
  return new NullBackend();
}

export function defaultHapticsLevel(): HapticsLevel {
  const ua: string = (globalThis as any)?.navigator?.userAgent ?? '';
  // Android motors vary widely, so Android starts lighter (audio section 7.4)
  return /Android/i.test(ua) ? 'light' : 'full';
}
