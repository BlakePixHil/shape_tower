// The composer and the band: themes are deterministic, stay in key, vary pass
// by pass, and every note they ask for is one the bank can bake ahead of time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_BARS, VARIATIONS, Theme, type NoteEvent } from '../../src/music/composer';
import { LULLABY, styleFor } from '../../src/music/styles';
import { PENTATONIC } from '../../src/music/theory';
import { BIOMES, biomeKey, cosmosRotation } from '../../src/biomes';
import { renderNote } from '../../src/synth/instruments';
import { BAND, DRUM } from '../../src/synth/band';
import { mulberry32 } from '../../src/synth/dsp';

const pc = (m: number) => ((m % 12) + 12) % 12;
const DIATONIC = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const themeFor = (id: number, cp = 0) => {
  const rot = id === 10 ? cosmosRotation(cp) : 0;
  const s = styleFor(id, rot);
  return new Theme(s, biomeKey(id, cp), s.tune ?? id);
};
const sig = (es: NoteEvent[]) => es.map((e) => `${e.part}:${e.inst}:${e.midis.join('.')}@${e.beat.toFixed(3)}`).join(' ');

test('the same theme and bar always give the same notes', () => {
  for (const b of BIOMES) {
    const x = themeFor(b.id), y = themeFor(b.id);
    for (let bar = 0; bar < THEME_BARS * VARIATIONS; bar += 5) assert.equal(sig(x.bar(bar, 1)), sig(y.bar(bar, 1)), `${b.name} bar ${bar}`);
  }
});

test('melodies use the landing scale, and the band plays in key', () => {
  for (const b of BIOMES) {
    const th = themeFor(b.id);
    const key = th.key;
    const pent = new Set(PENTATONIC[key.mode].map((i) => pc(key.root + i)));
    const dia = new Set(DIATONIC[key.mode].map((i) => pc(key.root + i)));
    for (let bar = 0; bar < THEME_BARS * VARIATIONS; bar++) {
      for (const e of th.bar(bar, 2)) {
        if (e.part === 'drums') continue;
        const scale = e.part === 'lead' || (e.part === 'support' && (th.style.supportPattern === 'sparkle')) ? pent : dia;
        for (const m of e.midis) assert.ok(scale.has(pc(m)), `${b.name} bar ${bar} ${e.part} ${e.inst} plays ${m}, out of key`);
      }
    }
    for (let i = 0; i < 4; i++) for (const e of th.riser(i, styleFor(Math.min(10, b.id + 1)))) assert.ok(pent.has(pc(e.midis[0])), `${b.name} riser in key`);
  }
});

test('every note a theme plays is in its warm-up list, so nothing renders mid-run', () => {
  for (const b of BIOMES) {
    const th = themeFor(b.id);
    const next = styleFor(Math.min(10, b.id + 1));
    const have = new Set(th.notes(next).map((r) => `${r.inst}:${r.midis.join(',')}:${r.spread ?? 0}`));
    const need = new Set<string>();
    for (let bar = 0; bar < THEME_BARS * VARIATIONS + 5; bar++) {
      for (const d of [0, 1, 2] as const) for (const e of th.bar(bar, d)) need.add(`${e.inst}:${e.midis.join(',')}:${e.spread ?? 0}`);
      for (const e of th.tension(bar, 0.9)) need.add(`${e.inst}:${e.midis.join(',')}:0`);
    }
    for (let i = 0; i < 4; i++) for (const e of th.riser(i, next)) need.add(`${e.inst}:${e.midis.join(',')}:0`);
    for (const k of need) assert.ok(have.has(k), `${b.name}: ${k} is played but never warmed`);
    assert.ok(have.size <= 60, `${b.name}: ${have.size} notes to bake is more than the memory plan allows`);
  }
});

test('each pass of a theme plays a different variation, and A sections share their opening', () => {
  for (const b of BIOMES) {
    const th = themeFor(b.id);
    const lead = (bar: number) => sig(th.bar(bar, 1).filter((e) => e.part === 'lead'));
    const passes = new Set<string>();
    for (let p = 0; p < VARIATIONS; p++) passes.add([0, 1, 2, 3].map((k) => lead(p * THEME_BARS + k)).join('|'));
    assert.equal(passes.size, VARIATIONS, `${b.name}: the ${VARIATIONS} variations differ`);
    // A' opens like A, so the tune is recognisable; B (bars 16 to 23) is new material
    assert.equal(lead(8), lead(0), `${b.name}: A' opens like A`);
    assert.notEqual(lead(16), lead(0), `${b.name}: B is new material`);
    // the fourth pass comes back to the first variation
    assert.equal(lead(VARIATIONS * THEME_BARS), lead(0));
  }
});

test('busier grooves have more drum hits, and fills mark the end of each section', () => {
  for (const b of BIOMES) {
    const th = themeFor(b.id);
    const hits = (d: 0 | 1 | 2) => th.bar(1, d).filter((e) => e.part === 'drums').length;
    assert.ok(hits(0) <= hits(1) && hits(1) <= hits(2) && hits(0) < hits(2), `${b.name}: density 0/1/2 give ${hits(0)}/${hits(1)}/${hits(2)} hits`);
    const late = (bar: number) => th.bar(bar, 1).filter((e) => e.part === 'drums' && e.beat >= 3).map((e) => e.midis[0]).sort().join();
    assert.notEqual(late(7), late(6), `${b.name}: bar 8 of a section has a fill`);
  }
});

test('half-time biomes put the backbeat on beat 3', () => {
  for (const b of BIOMES) {
    const s = styleFor(b.id);
    const snares = themeFor(b.id).bar(1, 1).filter((e) => e.part === 'drums' && e.midis[0] === s.kit.snare).map((e) => Math.round(e.beat));
    if (s.half) assert.deepEqual([...new Set(snares)], [2], `${b.name}: half-time snare`);
    else assert.ok(snares.includes(1) && snares.includes(3), `${b.name}: backbeat on 2 and 4`);
  }
});

test('Deep Cosmos rotates its lead with the key, and comes home to the Meadow tune', () => {
  const leads = [0, 1, 2, 3].map((r) => styleFor(10, r).lead);
  assert.equal(new Set(leads).size, 4);
  const home = styleFor(10, 3);
  assert.equal(home.tune, 1);
  assert.deepEqual(home.progressions, styleFor(1).progressions);
  assert.equal(biomeKey(10, 23 + 18).root % 12, 0, 'the fourth rotation is in C');
  // the homecoming melody is the Meadow's own
  const meadow = themeFor(1), cosmos = themeFor(10, 23 + 18);
  const tune = (th: Theme) => th.bar(0, 1).filter((e) => e.part === 'lead').map((e) => `${pc(e.midis[0])}@${e.beat}`).join();
  assert.equal(tune(cosmos), tune(meadow));
});

test('the lullaby has no drums', () => {
  const th = new Theme(LULLABY, BIOMES[0].key, 1);
  for (let bar = 0; bar < THEME_BARS; bar++) assert.equal(th.bar(bar, 2).filter((e) => e.part === 'drums').length, 0);
});

test('every band instrument and drum renders clean', () => {
  const sr = 24000;
  for (const inst of BAND) {
    const midis = inst === 'drums' ? Object.values(DRUM) : [40, 60, 76];
    for (const m of midis) {
      const y = renderNote(inst, m, sr, mulberry32(m));
      let peak = 0;
      for (const v of y) {
        assert.ok(Number.isFinite(v), `${inst} ${m}: non-finite sample`);
        peak = Math.max(peak, Math.abs(v));
      }
      assert.ok(peak <= 1 && peak > 0.05, `${inst} ${m}: peak ${peak.toFixed(3)}`);
      assert.ok(y.length / sr <= 5.5, `${inst} ${m}: ${(y.length / sr).toFixed(2)} s is too long`);
    }
  }
});
