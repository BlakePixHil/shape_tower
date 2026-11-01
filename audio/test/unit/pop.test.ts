// Blockling Pop's score (Pop plan, Music and sound): the four families, the lounge feel, layers that
// stay in key, every note in its warm-up list, the haptics map, and Pop's sounds scoped to Pop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_BARS, VARIATIONS, Theme, pent, tonicAt, triadPcs, voice, type NoteEvent } from '../../src/music/composer';
import { popBreather, popFanfare, popNiceTry, popNotes, popSparkle, popTension } from '../../src/music/popcomposer';
import { LOUNGE, POP_FAMILIES, popFamily, popStyleFor } from '../../src/music/styles-pop';
import { PENTATONIC } from '../../src/music/theory';
import { BIOMES, biomeKey, cosmosRotation } from '../../src/biomes';
import { instrumentRate, renderNote } from '../../src/synth/instruments';
import { SOUNDS } from '../../src/synth/recipes';
import { POP_SHAPE_KEYS, SHAPE_VOICE } from '../../src/synth/voice';
import { PATTERNS } from '../../src/haptics';
import { POP_NOTE_BUDGET, modeScope, towerOnly } from '../../src/bank';
import { mulberry32 } from '../../src/synth/dsp';

const pc = (m: number) => ((m % 12) + 12) % 12;
const DIATONIC = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const CYCLE = THEME_BARS * VARIATIONS;
const popTheme = (id: number, cp = 0) => {
  const rot = id === 10 ? cosmosRotation(cp) : 0;
  const s = popStyleFor(id, rot);
  return new Theme(s, biomeKey(id, cp), s.tune ?? id);
};
/** Every theme a Pop run can play: each biome, and Deep Cosmos's four rotations. */
const ALL = [...BIOMES.map((b) => ({ name: b.name, th: popTheme(b.id) })), ...[29, 35, 41].map((cp) => ({ name: `Deep Cosmos at ${cp}`, th: popTheme(10, cp) }))];
const key = (e: { inst: string; midis: number[]; spread?: number }): string => `${e.inst}:${e.midis.join(',')}:${e.spread ?? 0}`;

/** Every bar a Pop run can play from a theme: the bed, groove and lead at both densities, and Pop's extra bars. */
function everything(th: Theme): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < CYCLE + 5; bar++) {
    for (const d of [0, 1, 2] as const) out.push(...th.bar(bar, d));
    out.push(...popTension(th, bar), ...popSparkle(th, bar), ...popBreather(th, bar));
  }
  for (const i of [0, 1] as const) out.push(...popFanfare(th, i), ...popNiceTry(th, i));
  return out;
}

test('Pop plays at 96 BPM with a light swing, every note at half rate', () => {
  for (const s of [...Object.values(POP_FAMILIES), LOUNGE]) {
    assert.equal(s.bpm, 96);
    assert.ok(s.swing > 0 && s.swing <= 0.1, `a light swing (${s.swing})`);
    assert.ok(s.low && s.swingAll && s.sevenths);
    assert.ok(s.pop, 'every family names its board and sparkle instruments');
  }
  const th = popTheme(1);
  assert.ok(Math.abs(th.barLen - 2.5) < 1e-9, `a bar is 2.5 s (${th.barLen})`);
  for (const inst of ['marimba', 'glassBell', 'celesta', 'vibes', 'kalimba', 'keys'] as const) assert.equal(instrumentRate(inst, true), 0.5);
  assert.equal(instrumentRate('marimba'), 1, "the tower's marimba stays at full rate");
});

test('the families follow the sky, and Deep Cosmos rotates them over a nebula choir', () => {
  const fams = BIOMES.slice(0, 9).map((b) => popFamily(b.id));
  assert.deepEqual(fams, ['ground', 'ground', 'sky', 'sky', 'sky', 'space', 'space', 'space', 'space']);
  assert.deepEqual([0, 1, 2, 3].map((r) => popFamily(10, r)), ['ground', 'sky', 'space', 'ground']);
  for (let r = 0; r < 4; r++) assert.equal(popStyleFor(10, r).hold, 'choir', 'a nebula pad in Deep Cosmos');
  assert.equal(popStyleFor(10, 3).tune, 1, "the home rotation plays the Meadow's tune");
  assert.equal(POP_FAMILIES.ground.pad, 'keys', 'the soft electric keys play the bed');
  assert.ok(POP_FAMILIES.space.half, 'half-time drums in space');
  // Treetops plays Ground in its own key and with its own tunes
  const a = popTheme(1), b = popTheme(2);
  assert.notEqual(a.key.root, b.key.root);
  assert.notEqual(a.bar(0, 1).filter((e) => e.part === 'lead').map((e) => e.midis[0] - a.key.root).join(), b.bar(0, 1).filter((e) => e.part === 'lead').map((e) => e.midis[0] - b.key.root).join());
});

test("Pop's band stays in key: diatonic chords, pentatonic melodies, a minor tension pad", () => {
  for (const { name, th } of ALL) {
    const k = th.key;
    const pent = new Set(PENTATONIC[k.mode].map((i) => pc(k.root + i)));
    const dia = new Set(DIATONIC[k.mode].map((i) => pc(k.root + i)));
    for (const e of everything(th)) {
      if (e.inst === 'drums') continue;
      const scale = e.part === 'lead' || (e.part === 'support' && e.inst === 'kalimba') ? pent : dia;
      for (const m of e.midis) assert.ok(scale.has(pc(m)), `${name}: ${e.part} ${e.inst} plays ${m}, out of key`);
    }
    for (let bar = 0; bar < 8; bar += 2) {
      const pad = popTension(th, bar).find((e) => e.midis.length === 3)!;
      const root = pad.midis.map(pc);
      const third = (x: number, y: number) => (((y - x) % 12) + 12) % 12;
      // a minor triad: some rotation of it has a minor third then a major third
      const minor = [0, 1, 2].some((r) => {
        const [x, y, z] = [root[r], root[(r + 1) % 3], root[(r + 2) % 3]];
        return third(x, y) === 3 && third(y, z) === 4;
      });
      assert.ok(minor, `${name}: the tension pad is a minor chord (${pad.midis.join(',')})`);
    }
  }
});

test("every note Pop's band plays is in its warm-up list, and the notes fit Pop's budget", () => {
  let worst = 0, worstName = '';
  for (const { name, th } of [...ALL, { name: 'lounge', th: new Theme(LOUNGE, BIOMES[0].key, 1) }]) {
    const warm = [...th.notes(), ...popNotes(th)];
    const have = new Set(warm.map(key));
    for (const e of everything(th)) assert.ok(have.has(key(e)), `${name}: ${key(e)} is played but never warmed`);
    assert.ok(warm.every((r) => r.low), `${name}: every Pop note asks for half rate`);
    // the board's notes the director warms: the landing ladder and glissando steps, and its answer chords
    const v = th.style.pop!, k = th.key;
    for (let st = 0; st <= 15; st++) warm.push({ inst: v.board, midis: [pent(k, tonicAt(k, v.boardLow), st)], low: true });
    for (const d of new Set([0, ...th.style.progressions.flat()])) warm.push({ inst: v.board, midis: voice(triadPcs(k, d), v.boardLow), low: true });
    warm.push({ inst: v.board, midis: voice(triadPcs(k, 0), v.boardLow), spread: 0.03, low: true });
    // what the cache holds (one buffer per key), rendered at half of 48 kHz
    const unique = new Map(warm.map((r) => [key(r), r]));
    let bytes = 0;
    for (const r of unique.values()) bytes += Math.max(...r.midis.map((m) => renderNote(r.inst, m, 24000, mulberry32(m)).length)) * 4;
    if (bytes > worst) [worst, worstName] = [bytes, name];
  }
  console.log(`# the biggest Pop band with its board notes (${worstName}) holds ${(worst / 1e6).toFixed(1)} MB`);
  // a biome change holds the old band and the new one for a moment
  assert.ok(2 * worst < POP_NOTE_BUDGET, `two Pop bands fit the ${POP_NOTE_BUDGET / 1e6} MB note cache (${worstName}: ${(worst / 1e6).toFixed(1)} MB)`);
});

test('the layers do what the plan says', () => {
  const th = popTheme(1);
  // tension: a heartbeat kick, the bass on the tonic, a pad; no melody, no groove kit
  const t = popTension(th, 0);
  assert.ok(t.filter((e) => e.inst === 'drums').length === 4, 'lub-dub on 1 and 3');
  assert.ok(t.some((e) => e.inst === th.style.bass && pc(e.midis[0]) === pc(th.key.root) && e.dur === 4), 'a pedal on the tonic');
  // the breather is pad and kalimba only
  for (let bar = 0; bar < 8; bar++) for (const e of popBreather(th, bar)) assert.ok(e.inst === 'kalimba' || e.part === 'pad', `breather plays ${e.inst}`);
  // the fanfare climbs and lands on the tonic
  const f1 = popFanfare(th, 1).filter((e) => e.part === 'lead');
  assert.equal(pc(f1[f1.length - 1].midis[0]), pc(th.key.root), 'the fanfare lands on the tonic');
  const run = popFanfare(th, 0).filter((e) => e.part === 'lead').map((e) => e.midis[0]);
  assert.ok(run.every((m, i) => i === 0 || m > run[i - 1]), 'the fanfare run rises');
  // "nice try" steps down and ends on the tonic, never a sad sting
  const nt = [...popNiceTry(th, 0), ...popNiceTry(th, 1)].filter((e) => e.part === 'lead').map((e) => e.midis[0]);
  assert.ok(nt.every((m, i) => i === 0 || m < nt[i - 1]) && pc(nt[nt.length - 1]) === pc(th.key.root), `nice try steps down to the tonic (${nt.join(' ')})`);
  // sparkle arpeggios sit above the lead
  assert.ok(popSparkle(th, 0).every((e) => e.midis[0] >= th.style.pop!.sparkleLow));
});

test("Pop's sounds exist, load only in Pop, and every shape has a voice", () => {
  const pop = Object.keys(SOUNDS).filter((n) => modeScope(n) === 'pop');
  for (const n of ['pop.boop', 'pop.snap', 'pop.shimmer', 'pop.plip', 'pop.tick', 'pop.fizz', 'pop.rewind', 'pop.whoosh', 'pop.shuffle', 'pop.flick', 'pop.boing', 'pop.uh']) {
    assert.ok(pop.includes(n), `${n} is a Pop sound`);
  }
  assert.ok(SOUNDS['pop.shimmer'].loop, 'the would-pop shimmer loops');
  for (const n of pop) assert.ok((SOUNDS[n].rate ?? 1) <= 0.5, `${n} bakes at half rate or less`);
  // the tower sounds Pop lets go are real names, and nothing Pop plays is among them
  for (const n of Object.keys(SOUNDS).filter(towerOnly)) assert.ok(SOUNDS[n]);
  for (const n of ['row.clack', 'flag', 'swap', 'sweep', 'windgust', 'bubble.pop', 'meteor.whistle', 'meteor.pop', 'shimmer', 'confetti', 'firework', 'ui.error', 'impact.stone.2']) {
    assert.ok(!towerOnly(n), `${n} stays loaded in Pop`);
  }
  for (const k of POP_SHAPE_KEYS) assert.ok(Number.isFinite(SHAPE_VOICE[k]), `${k} has a voice pitch`);
  assert.ok(SHAPE_VOICE.Pip > SHAPE_VOICE.Domino && SHAPE_VOICE.Plank < SHAPE_VOICE.O, 'small shapes squeak, long ones grumble');
});

test("Pop's haptics map", () => {
  const strongest = (n: keyof typeof PATTERNS) => Math.max(...PATTERNS[n].events.map((e) => e.i));
  assert.ok(strongest('light') < strongest('medium') && strongest('medium') < strongest('heavy'), 'light pick-up, medium place, heavy pop');
  assert.ok(PATTERNS.select.optional && strongest('select') < 0.2, 'the ghost snap is a faint, optional tick');
  assert.equal(PATTERNS.heavyDouble.events.length, 2, 'a double pulse for a multi-line pop');
  assert.ok(PATTERNS.success.events.length === 2 && PATTERNS.error.events.length === 3, 'success and error shapes');
});
