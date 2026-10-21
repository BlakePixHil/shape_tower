// Bus graph, snapshots, ducking and the master safety chain (audio section 8).
//
//   voice -> bus input -> lowpass -> snapshot gain -> duck gain -> volume -> master
//   sfx bus input -> reverb send (biome "air") -> convolver -> master
//   master -> compressor -> soft clipper -> mono switch -> destination

import { dbToGain } from './synth/dsp';
import type { BusName } from './types';

export const BUSES: BusName[] = ['music', 'sfx', 'ambience', 'ui', 'voices'];

interface BusTarget {
  gainDb?: number;
  lowpass?: number;
}
export type Snapshot = Partial<Record<BusName, BusTarget>>;

export const BASE_SNAPSHOTS = {
  menu: { music: { gainDb: -2 }, ambience: { gainDb: -6 } },
  playing: {},
  results: { ambience: { gainDb: -10, lowpass: 2500 }, sfx: { gainDb: -4 } },
  gameover: { music: { gainDb: -40, lowpass: 300 }, ambience: { gainDb: -30, lowpass: 400 }, sfx: { gainDb: -6 } },
} satisfies Record<string, Snapshot>;
export type BaseSnapshot = keyof typeof BASE_SNAPSHOTS;

export const OVERLAYS = {
  danger: { music: { gainDb: -2, lowpass: 2000 }, ambience: { gainDb: -6 } },
  hold: { music: { lowpass: 900 }, ambience: { gainDb: -4, lowpass: 2000 } },
  pause: { music: { gainDb: -8, lowpass: 800 }, sfx: { gainDb: -60 }, voices: { gainDb: -60 }, ambience: { gainDb: -10, lowpass: 1200 } },
  lastHeart: { music: { gainDb: -2 } },
  slowmo: { music: { lowpass: 1200 }, ambience: { lowpass: 1500 } },
  slowPower: { music: { lowpass: 2600 }, ambience: { gainDb: -2, lowpass: 3000 } },
} satisfies Record<string, Snapshot>;
export type Overlay = keyof typeof OVERLAYS;

/** What a full hold ring adds on top of the hold overlay (setHoldDepth): extra dB, and the lowpass it closes an octave from. */
const HOLD_DEPTH: Partial<Record<BusName, { gainDb: number; lowpass?: number }>> = {
  music: { gainDb: -6, lowpass: OVERLAYS.hold.music.lowpass },
  ambience: { gainDb: -4 },
};

interface Duck {
  db: number;
  start: number;
  end: number;
}

interface Bus {
  input: GainNode;
  lp: BiquadFilterNode;
  snap: GainNode;
  duck: GainNode;
  vol: GainNode;
  ducks: Duck[];
}

export class Mixer {
  readonly buses: Record<BusName, Bus>;
  readonly master: GainNode;
  private out: GainNode;
  private monoNode: GainNode;
  private reverbSend: GainNode;
  private convolver: ConvolverNode;
  private base: BaseSnapshot = 'menu';
  private overlays = new Set<Overlay>();
  /** how far the checkpoint hold has drained the mix, 0 to 1 (only while the hold overlay is on) */
  private holdDepth = 0;

  constructor(private ctx: BaseAudioContext) {
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 4;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    this.out = ctx.createGain();
    this.monoNode = ctx.createGain();
    this.master.connect(comp).connect(clip).connect(this.out).connect(this.monoNode).connect(ctx.destination);

    const mk = (): Bus => {
      const input = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      lp.Q.value = 0.5;
      const snap = ctx.createGain();
      const duck = ctx.createGain();
      const vol = ctx.createGain();
      input.connect(lp).connect(snap).connect(duck).connect(vol).connect(this.master);
      return { input, lp, snap, duck, vol, ducks: [] };
    };
    this.buses = { music: mk(), sfx: mk(), ambience: mk(), ui: mk(), voices: mk() };

    // one shared reverb, fed from the sfx bus; its send level is the biome's "air"
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.1;
    // the impulse response is baked in the background and arrives through setReverb
    const conv = (this.convolver = ctx.createConvolver());
    const ret = ctx.createGain();
    ret.gain.value = 0.6;
    this.buses.sfx.lp.connect(this.reverbSend).connect(conv).connect(ret).connect(this.buses.sfx.snap);
    this.apply(0, 0.001);
  }

  /** Installs the reverb's stereo impulse response (silent until then). */
  setReverb(l: Float32Array, r: Float32Array, sampleRate = this.ctx.sampleRate): void {
    const ir = this.ctx.createBuffer(2, l.length, sampleRate);
    ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    this.convolver.buffer = ir;
  }

  input(bus: BusName): AudioNode {
    return this.buses[bus].input;
  }

  setVolume(bus: BusName, linear: number, when: number): void {
    this.buses[bus].vol.gain.setTargetAtTime(Math.max(0, linear), when, 0.03);
  }

  setMono(on: boolean): void {
    // a single-channel node downmixes everything; the destination plays it on both speakers
    this.monoNode.channelCount = on ? 1 : 2;
    this.monoNode.channelCountMode = on ? 'explicit' : 'max';
  }

  setAir(amount: number, when: number): void {
    this.reverbSend.gain.setTargetAtTime(Math.max(0, amount), when, 0.8);
  }

  fadeMaster(to: number, when: number, tc = 0.05): void {
    this.out.gain.cancelScheduledValues(when);
    this.out.gain.setTargetAtTime(to, when, tc);
  }

  setBase(name: BaseSnapshot, when: number, tc = 0.12): void {
    this.base = name;
    this.apply(when, tc);
  }

  setOverlay(name: Overlay, on: boolean, when: number, tc = 0.08): void {
    if (on === this.overlays.has(name)) return;
    if (on) this.overlays.add(name);
    else this.overlays.delete(name);
    if (name === 'hold' && !on) this.holdDepth = 0;
    this.apply(when, tc);
  }

  clearOverlays(when: number): void {
    this.overlays.clear();
    this.holdDepth = 0;
    this.apply(when, 0.1);
  }

  /**
   * Drains the mix further as the hold ring fills (Blake, 2026-10-21: the screen greys part-way
   * during the countdown): at full depth the music is a further 6 dB down with its lowpass an
   * octave lower, and the ambience a further 4 dB down.
   */
  setHoldDepth(amount: number, when: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (Math.abs(a - this.holdDepth) < 0.01) return;
    this.holdDepth = a;
    if (this.overlays.has('hold')) this.apply(when, 0.15);
  }

  state(): { base: BaseSnapshot; overlays: Overlay[] } {
    return { base: this.base, overlays: [...this.overlays] };
  }

  private apply(when: number, tc: number): void {
    const layers: Snapshot[] = [BASE_SNAPSHOTS[this.base], ...[...this.overlays].map((o) => OVERLAYS[o])];
    for (const b of BUSES) {
      let db = 0;
      let lp = 20000;
      for (const s of layers) {
        const t = s[b];
        if (!t) continue;
        db += t.gainDb ?? 0;
        if (t.lowpass !== undefined) lp = Math.min(lp, t.lowpass);
      }
      if (this.holdDepth > 0 && this.overlays.has('hold')) {
        const d = HOLD_DEPTH[b];
        if (d) {
          db += d.gainDb * this.holdDepth;
          if (d.lowpass) lp = Math.min(lp, d.lowpass * Math.pow(0.5, this.holdDepth));
        }
      }
      const bus = this.buses[b];
      bus.snap.gain.setTargetAtTime(dbToGain(Math.max(-80, db)), when, tc);
      bus.lp.frequency.setTargetAtTime(lp, when, tc);
    }
  }

  /** Ducks a bus by `db` from `when` for `dur` seconds. Overlapping ducks take the deepest. */
  duck(bus: BusName, db: number, when: number, dur: number): void {
    const b = this.buses[bus];
    b.ducks = b.ducks.filter((d) => d.end > when - 0.5);
    b.ducks.push({ db: Math.min(0, db), start: when, end: when + dur });
    const points = [...new Set([when, ...b.ducks.flatMap((d) => [d.start, d.end]).filter((t) => t >= when)])].sort((x, y) => x - y);
    const p = b.duck.gain;
    p.cancelScheduledValues(when);
    let prev = 0;
    for (const t of points) {
      const depth = Math.min(0, ...b.ducks.filter((d) => d.start <= t && d.end > t).map((d) => d.db));
      p.setTargetAtTime(dbToGain(depth), t, depth < prev ? 0.03 : 0.2);
      prev = depth;
    }
  }
}

/** Linear up to 0.8, then a smooth knee that never exceeds 1.0. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    c[i] = Math.sign(x) * Math.min(0.999, y);
  }
  return c;
}
