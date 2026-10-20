import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LandingLadder, LADDER_STEPS } from '../../src/music/ladder';
import { harmonyAbove, keyName, run, scaleNote, tonicChord, type Key } from '../../src/music/theory';

const C: Key = { root: 72, mode: 'major' };
const Am: Key = { root: 69, mode: 'minor' };

test('pentatonic scale degrees wrap across octaves', () => {
  assert.deepEqual(run(C, 0, 6), [72, 74, 76, 79, 81, 84]);
  assert.deepEqual(run(Am, 0, 5), [69, 72, 74, 76, 79]);
  assert.equal(scaleNote(C, -1), 69);
  assert.equal(harmonyAbove(C, 0), 76);
  assert.equal(keyName(Am), 'A minor');
});

test('tonic chords grow with size', () => {
  assert.deepEqual(tonicChord(C, 1), [72, 76, 79]);
  assert.deepEqual(tonicChord(Am, 2), [69, 72, 76, 81]);
  assert.equal(tonicChord(C, 3).length, 7);
});

test('clean settles climb one scale step at a time', () => {
  const l = new LandingLadder();
  const notes = Array.from({ length: LADDER_STEPS }, () => l.settle(C, 'clean').notes[0]);
  assert.deepEqual(notes, run(C, 0, LADDER_STEPS));
  // the ninth wraps back to the bottom of the ladder
  assert.equal(l.settle(C, 'clean').notes[0], 72);
});

test('a perfect settle adds the harmony note two steps up', () => {
  const l = new LandingLadder();
  l.settle(C, 'clean');
  const r = l.settle(C, 'perfect');
  assert.deepEqual(r.notes, [scaleNote(C, 1), scaleNote(C, 3)]);
});

test('a messy settle clonks and resets the ladder', () => {
  const l = new LandingLadder();
  l.settle(C, 'clean');
  l.settle(C, 'clean');
  const m = l.settle(C, 'messy');
  assert.equal(m.kind, 'clonk');
  assert.equal(m.streak, 0);
  assert.equal(l.settle(C, 'clean').step, 0);
});

test('sparkle at a streak of 4, bloom and melody unlock every 8', () => {
  const l = new LandingLadder();
  const rs = Array.from({ length: 16 }, () => l.settle(C, 'clean'));
  assert.deepEqual(rs.map((r, i) => (r.sparkle ? i + 1 : 0)).filter(Boolean), [4, 12]);
  assert.deepEqual(rs.map((r, i) => (r.bloom ? i + 1 : 0)).filter(Boolean), [8, 16]);
  assert.equal(l.melodyUnlocked, true);
  l.newBiome();
  assert.equal(l.melodyUnlocked, false);
  assert.equal(l.currentStreak, 16, 'a biome change keeps the streak');
});
