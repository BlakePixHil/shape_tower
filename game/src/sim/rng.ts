// Seeded integer RNG (mulberry32). Integer maths only, so it is identical on every JS engine.
// The sim uses three independent streams (gameplay.md §15): bag, hazards, cosmetic.

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, n). */
  int(n: number): number { return this.nextU32() % n; }

  /** Float in [0, 1) for cosmetic use only. */
  float(): number { return this.nextU32() / 4294967296; }

  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}

export interface RngStreams { bag: Rng; hazards: Rng; cosmetic: Rng }

export function makeStreams(seed: number): RngStreams {
  const root = new Rng(seed);
  return { bag: new Rng(root.nextU32()), hazards: new Rng(root.nextU32()), cosmetic: new Rng(root.nextU32()) };
}
