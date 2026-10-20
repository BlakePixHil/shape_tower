// Pure sample-level DSP helpers. Everything here works on mono Float32Arrays,
// has no Web Audio dependency, and is deterministic for a given seed, so sound
// recipes can be unit-tested in Node and rendered once into AudioBuffers.

export type Rng = () => number;

export const TAU = Math.PI * 2;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-9));
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const semis = (s: number) => Math.pow(2, s / 12);

export function alloc(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(sr * seconds)));
}

/** Adds src into dst starting at offset (seconds), scaled by gain. */
export function mixInto(dst: Float32Array, src: Float32Array, sr: number, offsetSec = 0, gain = 1): Float32Array {
  const o = Math.round(offsetSec * sr);
  const n = Math.min(src.length, dst.length - o);
  for (let i = Math.max(0, -o); i < n; i++) dst[i + o] += src[i] * gain;
  return dst;
}

export function scale(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function noise(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1;
  return x;
}

/** Brown-ish noise (integrated white noise with leak), good for rumbles and wind. */
export function brown(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.985 * y + (rng() * 2 - 1) * 0.15;
    x[i] = y;
  }
  return normalize(x, 0.9);
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';
type FreqArg = number | ((t: number) => number);

/**
 * RBJ biquad. `freq` may be a function of time (seconds); coefficients are then
 * recomputed every 32 samples, which is plenty for sweeps.
 */
export function biquad(x: Float32Array, sr: number, type: FilterType, freq: FreqArg, q = 0.707, gainDb = 0): Float32Array {
  const y = new Float32Array(x.length);
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  const coeffs = (f: number) => {
    const w = (TAU * clamp(f, 10, sr * 0.45)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q);
    let a0: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'peaking': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      }
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  };
  const dynamic = typeof freq === 'function';
  if (!dynamic) coeffs(freq as number);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (dynamic && (i & 31) === 0) coeffs((freq as (t: number) => number)(i / sr));
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Exponential decay envelope multiplied in place: e^(-t/tau), after an optional linear attack. */
export function decay(x: Float32Array, sr: number, tau: number, attack = 0.001): Float32Array {
  const na = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    const a = i < na ? i / na : 1;
    x[i] *= a * Math.exp(-t / tau);
  }
  return x;
}

/** Multiplies x in place by an envelope function of time. */
export function shape(x: Float32Array, sr: number, env: (t: number) => number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= env(i / sr);
  return x;
}

/** Attack-hold-release envelope helper: linear rise, hold, then exponential-ish fall to zero at `total`. */
export function ahr(attack: number, hold: number, total: number): (t: number) => number {
  return (t) => {
    if (t < attack) return t / attack;
    if (t < attack + hold) return 1;
    const r = (t - attack - hold) / Math.max(1e-4, total - attack - hold);
    return r >= 1 ? 0 : Math.pow(1 - r, 2);
  };
}

export type Wave = 'sine' | 'tri' | 'saw' | 'square';

/** Oscillator with a constant or time-varying frequency (seconds -> Hz). */
export function osc(n: number, sr: number, freq: FreqArg, wave: Wave = 'sine', phase0 = 0): Float32Array {
  const x = new Float32Array(n);
  let ph = phase0;
  const f = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < n; i++) {
    const p = ph - Math.floor(ph);
    switch (wave) {
      case 'sine': x[i] = Math.sin(TAU * p); break;
      case 'tri': x[i] = 1 - 4 * Math.abs(p - 0.5); break;
      case 'saw': x[i] = 2 * p - 1; break;
      case 'square': x[i] = p < 0.5 ? 1 : -1; break;
    }
    ph += f(i / sr) / sr;
  }
  return x;
}

export interface Mode {
  /** frequency in Hz */
  f: number;
  /** relative amplitude */
  a: number;
  /** decay time constant in seconds */
  tau: number;
}

/**
 * Bank of damped two-pole resonators driven by an excitation signal. This is
 * modal synthesis: a short noise burst through it sounds like a struck object.
 */
export function resonate(excitation: Float32Array, sr: number, modes: Mode[], outLen?: number): Float32Array {
  const n = outLen ?? excitation.length;
  const y = new Float32Array(n);
  for (const m of modes) {
    if (m.f >= sr * 0.45) continue;
    const w = (TAU * m.f) / sr;
    const r = Math.exp(-1 / (m.tau * sr));
    const c1 = 2 * r * Math.cos(w), c2 = -r * r, g = Math.sin(w) * m.a;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = i < excitation.length ? excitation[i] : 0;
      const yi = c1 * y1 + c2 * y2 + g * xi;
      y2 = y1; y1 = yi;
      y[i] += yi;
    }
  }
  return y;
}

/** Sum of decaying sines (clean bells, chimes). */
export function partials(n: number, sr: number, modes: Mode[], rng?: Rng): Float32Array {
  const y = new Float32Array(n);
  for (const m of modes) {
    if (m.f >= sr * 0.45) continue;
    const ph = rng ? rng() : 0;
    const w = (TAU * m.f) / sr;
    for (let i = 0; i < n; i++) y[i] += m.a * Math.sin(w * i + TAU * ph) * Math.exp(-i / sr / m.tau);
  }
  return y;
}

/** Short noise burst used to excite resonators. `ms` is its length; `color` lowpasses it (Hz). */
export function burst(sr: number, rng: Rng, ms: number, color = 8000, len?: number): Float32Array {
  const n = len ?? Math.round(sr * 0.002 + (sr * ms) / 1000);
  const nb = Math.max(2, Math.round((sr * ms) / 1000));
  const x = new Float32Array(n);
  for (let i = 0; i < nb; i++) {
    const env = Math.sin((Math.PI * i) / nb);
    x[i] = (rng() * 2 - 1) * env;
  }
  return color < sr * 0.45 ? biquad(x, sr, 'lowpass', color, 0.7) : x;
}

/** Karplus-Strong plucked string. */
export function pluck(n: number, sr: number, f: number, rng: Rng, damp = 0.996, bright = 0.5): Float32Array {
  const period = Math.max(2, Math.round(sr / f));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = rng() * 2 - 1;
  const y = new Float32Array(n);
  let idx = 0;
  const k = 0.5 + 0.5 * bright;
  for (let i = 0; i < n; i++) {
    const cur = ring[idx];
    const next = ring[(idx + 1) % period];
    y[i] = cur;
    ring[idx] = damp * (k * cur + (1 - k) * next);
    idx = (idx + 1) % period;
  }
  return y;
}

/** Two-operator FM tone; index decays with tauIndex. */
export function fm(n: number, sr: number, fc: number, ratio: number, index: number, tauIndex: number): Float32Array {
  const y = new Float32Array(n);
  const fmHz = fc * ratio;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const I = index * Math.exp(-t / tauIndex);
    y[i] = Math.sin(TAU * fc * t + I * Math.sin(TAU * fmHz * t));
  }
  return y;
}

/** Sparse random clicks (debris, gravel, crackle). density = clicks per second. */
export function crackle(n: number, sr: number, rng: Rng, density: number, env: (t: number) => number = () => 1): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (rng() < (density * env(t)) / sr) {
      const amp = 0.3 + 0.7 * rng();
      const len = 8 + Math.floor(rng() * 40);
      const sign = rng() < 0.5 ? -1 : 1;
      for (let j = 0; j < len && i + j < n; j++) y[i + j] += sign * amp * Math.exp(-j / (len * 0.25)) * (rng() * 2 - 1);
    }
  }
  return y;
}

export function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

export function normalize(x: Float32Array, target = 0.9): Float32Array {
  const p = peak(x);
  if (p > 1e-9) scale(x, target / p);
  return x;
}

/** Short fades at both ends so no buffer starts or stops with a click. */
export function fadeEdges(x: Float32Array, sr: number, inMs = 0.5, outMs = 8): Float32Array {
  const ni = Math.min(x.length, Math.round((sr * inMs) / 1000));
  const no = Math.min(x.length, Math.round((sr * outMs) / 1000));
  for (let i = 0; i < ni; i++) x[i] *= i / ni;
  for (let i = 0; i < no; i++) x[x.length - 1 - i] *= i / no;
  return x;
}

/** Gentle tanh saturation (adds harmonics so low thumps survive phone speakers). */
export function saturate(x: Float32Array, drive = 2): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) / k;
  return x;
}

/** Makes a seamless loop by crossfading the tail over the head. Returns a shorter buffer. */
export function loopify(x: Float32Array, sr: number, fadeSec: number): Float32Array {
  const nf = Math.min(Math.round(fadeSec * sr), Math.floor(x.length / 3));
  const out = x.slice(0, x.length - nf);
  for (let i = 0; i < nf; i++) {
    const t = i / nf;
    out[i] = out[i] * Math.sqrt(t) + x[x.length - nf + i] * Math.sqrt(1 - t);
  }
  return out;
}

/** Trims trailing near-silence (below thresh) so buffers are no longer than needed. */
export function trimTail(x: Float32Array, sr: number, thresh = 0.0005): Float32Array {
  let end = x.length - 1;
  while (end > 0 && Math.abs(x[end]) < thresh) end--;
  const keep = Math.min(x.length, end + Math.round(sr * 0.01));
  return fadeEdges(x.slice(0, Math.max(keep, 16)), sr, 0, 4);
}

/** Stereo impulse response for the shared reverb: decaying, darkening noise. */
export function reverbIR(sr: number, seconds: number, rng: Rng): [Float32Array, Float32Array] {
  const n = Math.round(sr * seconds);
  const make = () => {
    const x = noise(n, rng);
    const y = biquad(x, sr, 'lowpass', (t) => 9000 * Math.exp(-t * 2.2) + 600, 0.6);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      y[i] *= Math.exp(-t / (seconds * 0.28)) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
    }
    return normalize(y, 0.5);
  };
  return [make(), make()];
}
