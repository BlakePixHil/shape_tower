// Blockling Pop's extra bars (Pop plan, Music and sound): the layers that follow the board on top of
// a Theme's bed, groove and lead, and the two set pieces. Everything is seeded by the theme and bar,
// so popNotes() can list every note ahead of time and the band never misses one.
//
//   Tension    board 70% full: a heartbeat kick, a pedal on the tonic and a minor pad (the groove thins)
//   Sparkle    combo 6 or more, and the All Clear: eighth-note arpeggios and a glockenspiel ping
//   Breather   the board drops under 20% full: pad and kalimba only, for 4 bars
//   Fanfare    All Clear: 2 bars from the next beat
//   Nice try   run over: 2 gentle bars in the current family

import type { NoteRequest } from '../bank';
import { hash } from '../bake/jobs';
import { mulberry32 } from '../synth/dsp';
import { DRUM } from '../synth/band';
import { KEYS_ROLL, THEME_BARS, VARIATIONS, pent, tonicAt, triadPcs, voice, type NoteEvent, type Theme } from './composer';

/** Bars a pattern can differ over: three passes of a 32-bar theme. */
const CYCLE = THEME_BARS * VARIATIONS;

/** The minor chord the tension pad holds: vi or ii over a major tonic, i or iv in a minor key. */
function tensionDegree(th: Theme, bar: number): number {
  const second = Math.floor((((bar % THEME_BARS) + THEME_BARS) % THEME_BARS) / 4) % 2 === 1;
  return th.key.mode === 'major' ? (second ? 1 : 5) : second ? 3 : 0;
}

/** Board 70% full: lub-dub kicks on 1 and 3, the bass holding the tonic, a minor pad every two bars. */
export function popTension(th: Theme, bar: number): NoteEvent[] {
  const s = th.style;
  const out: NoteEvent[] = [];
  for (const b of [0, 2]) {
    out.push({ part: 'tension', inst: 'drums', midis: [DRUM.feltKick], beat: b, dur: 1, vel: 0.9 });
    out.push({ part: 'tension', inst: 'drums', midis: [DRUM.feltKick], beat: b + 0.5, dur: 1, vel: 0.55 });
  }
  out.push({ part: 'tension', inst: s.bass, midis: [tonicAt(th.key, s.bassLow)], beat: 0, dur: 4, vel: 0.9 });
  if (bar % 2 === 0) {
    const pcs = triadPcs(th.key, tensionDegree(th, bar));
    out.push({ part: 'tension', inst: s.hold ?? 'padSoft', midis: voice(pcs, s.holdLow ?? s.padLow), beat: 0, dur: 8, vel: 0.7 });
  }
  return out;
}

/** Combo 6+: an eighth-note arpeggio up and down the chord's tones, and a glockenspiel ping every other bar. */
export function popSparkle(th: Theme, bar: number): NoteEvent[] {
  const s = th.style, v = s.pop!;
  const tones = voice(triadPcs(th.key, th.degreeAt(bar)), v.sparkleLow);
  const up = [...tones, tones[0] + 12, tones[1] + 12];
  const rng = mulberry32(hash(`${th.tune}:spark:${((bar % CYCLE) + CYCLE) % CYCLE}`));
  const order = rng() < 0.5 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 2, 1, 3, 2, 4, 3, 1];
  const out: NoteEvent[] = order.map((k, i) => ({
    part: 'sparkle', inst: v.sparkle, midis: [up[k]], beat: i % 2 ? i / 2 + s.swing : i / 2, dur: 0.5, vel: i % 2 ? 0.45 : 0.6,
  }));
  if (bar % 2 === 0) out.push({ part: 'sparkle', inst: 'glassBell', midis: [tones[0] + 12], beat: 0, dur: 2, vel: 0.5 });
  return out;
}

/** After a big pop: the pad and a few kalimba notes, nothing else. */
export function popBreather(th: Theme, bar: number): NoteEvent[] {
  const s = th.style;
  const out: NoteEvent[] = [];
  const pcs = triadPcs(th.key, th.degreeAt(bar));
  if (bar % 2 === 0) out.push({ part: 'pad', inst: s.hold ?? 'padSoft', midis: voice(pcs, s.holdLow ?? s.padLow), beat: 0, dur: 8, vel: 0.8 });
  const base = tonicAt(th.key, 62);
  const rng = mulberry32(hash(`${th.tune}:breathe:${((bar % CYCLE) + CYCLE) % CYCLE}`));
  const count = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    out.push({ part: 'support', inst: 'kalimba', midis: [pent(th.key, base, Math.floor(rng() * 8))], beat: Math.floor(rng() * 8) / 2, dur: 1, vel: 0.45 + 0.25 * rng() });
  }
  return out;
}

/**
 * The All Clear: a rising run on the lead over I and IV, then V into a held high tonic, with the
 * keys, the bass, a snap roll and the sparkle layer. Bar `i` is 0 or 1.
 */
export function popFanfare(th: Theme, i: 0 | 1): NoteEvent[] {
  const s = th.style, k = th.key;
  const base = tonicAt(k, s.leadLow);
  const chords = i === 0 ? [0, 3] : [4, 0];
  const out: NoteEvent[] = [];
  chords.forEach((d, h) => {
    const pcs = triadPcs(k, d);
    out.push({ part: 'pad', inst: s.pad, midis: voice(pcs, s.padLow), spread: KEYS_ROLL, beat: h * 2, dur: 2, vel: 0.85 });
    out.push({ part: 'bass', inst: s.bass, midis: [voice([pcs[0]], s.bassLow)[0]], beat: h * 2, dur: 2, vel: 0.9 });
    const tones = voice(pcs, s.pop!.sparkleLow);
    tones.concat(tones[0] + 12).forEach((m, j) => out.push({ part: 'sparkle', inst: s.pop!.sparkle, midis: [m], beat: h * 2 + j / 2, dur: 0.5, vel: 0.55 }));
  });
  if (i === 0) {
    for (let j = 0; j < 8; j++) out.push({ part: 'lead', inst: s.lead, midis: [pent(k, base, j)], beat: j / 2, dur: 0.5, vel: 0.7 + 0.03 * j });
    for (let j = 0; j < 4; j++) out.push({ part: 'drums', inst: 'drums', midis: [s.kit.snare], beat: 3 + j / 4, dur: 0.25, vel: 0.45 + 0.12 * j });
  } else {
    // the run topped out on step 7; it steps down over V and lands on the tonic an octave up
    out.push({ part: 'lead', inst: s.lead, midis: [pent(k, base, 6)], beat: 0, dur: 1.5, vel: 0.85 });
    out.push({ part: 'lead', inst: s.lead, midis: [pent(k, base, 5)], beat: 2, dur: 2, vel: 1 });
    out.push({ part: 'drums', inst: 'drums', midis: [s.kit.kick], beat: 0, dur: 1, vel: 0.9 });
    out.push({ part: 'drums', inst: 'drums', midis: [DRUM.openHat], beat: 2, dur: 1, vel: 0.5 });
    out.push({ part: 'drums', inst: 'drums', midis: [s.kit.kick], beat: 2, dur: 1, vel: 0.8 });
    out.push({ part: 'sparkle', inst: 'glassBell', midis: [voice([triadPcs(k, 0)[0]], s.pop!.sparkleLow)[0] + 12], beat: 2, dur: 2, vel: 0.6 });
  }
  return out;
}

/** Run over: "nice try", IV then I, the lead stepping down to the tonic. Never a sad sting. Bar `i` is 0 or 1. */
export function popNiceTry(th: Theme, i: 0 | 1): NoteEvent[] {
  const s = th.style, k = th.key;
  const base = tonicAt(k, s.leadLow);
  const pcs = triadPcs(k, i === 0 ? 3 : 0);
  const out: NoteEvent[] = [
    { part: 'pad', inst: s.pad, midis: voice(pcs, s.padLow), spread: KEYS_ROLL, beat: 0, dur: 4, vel: 0.7 },
    { part: 'bass', inst: s.bass, midis: [voice([pcs[0]], s.bassLow)[0]], beat: 0, dur: 4, vel: 0.7 },
  ];
  if (i === 0) [4, 3, 2].forEach((p, j) => out.push({ part: 'lead', inst: s.lead, midis: [pent(k, base, p)], beat: j, dur: 1, vel: 0.7 - 0.05 * j }));
  else out.push({ part: 'lead', inst: s.lead, midis: [pent(k, base, 0)], beat: 0, dur: 3, vel: 0.7 });
  return out;
}

/** Every note Pop's extra bars can ask for in this theme, so the bank bakes them before they play. */
export function popNotes(th: Theme): NoteRequest[] {
  const seen = new Map<string, NoteRequest>();
  const add = (e: NoteEvent) => {
    const key = `${e.inst}:${e.midis.join(',')}:${e.spread ?? 0}`;
    if (!seen.has(key)) seen.set(key, { inst: e.inst, midis: e.midis, spread: e.spread, low: true });
  };
  for (let b = 0; b < CYCLE; b++) {
    popTension(th, b).forEach(add);
    popSparkle(th, b).forEach(add);
    popBreather(th, b).forEach(add);
  }
  for (const i of [0, 1] as const) {
    popFanfare(th, i).forEach(add);
    popNiceTry(th, i).forEach(add);
  }
  return [...seen.values()];
}
