import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cooldowns, FULL_CAPS, FULL_GLOBAL_CAP, VoiceAllocator, type VoiceInfo } from '../../src/voices';
import type { Category, Priority } from '../../src/types';

function voice(a: VoiceAllocator, category: Category, priority: Priority, loudness = 0.5, start = 0, dur = 10): VoiceInfo & { stopped: boolean } {
  const v = { id: a.newId(), category, priority, loudness, start, end: start + dur, stopped: false, stop: () => (v.stopped = true) };
  return v;
}

function fill(a: VoiceAllocator, category: Category, priority: Priority, n: number, now = 0): VoiceInfo[] {
  const out: VoiceInfo[] = [];
  for (let i = 0; i < n; i++) {
    const r = a.admit({ category, priority, loudness: 0.5, now });
    assert.ok(r.ok, `voice ${i} admitted`);
    const v = voice(a, category, priority, 0.5, now + i * 0.001);
    a.add(v);
    out.push(v);
  }
  return out;
}

test('category caps hold and a lower-priority voice is stolen first', () => {
  const a = new VoiceAllocator();
  fill(a, 'impact', 4, FULL_CAPS.impact, 1);
  const r = a.admit({ category: 'impact', priority: 4, loudness: 0.1, now: 1 });
  assert.equal(r.ok, false, 'a quieter voice of the same priority is refused');
  const r2 = a.admit({ category: 'impact', priority: 2, loudness: 0.5, now: 1 });
  assert.ok(r2.ok && r2.victims.length === 1 && r2.victims[0].priority === 4);
});

test('the quietest, then oldest, voice is the victim', () => {
  const a = new VoiceAllocator();
  const vs = [voice(a, 'note', 3, 0.5, 0), voice(a, 'note', 3, 0.2, 1), voice(a, 'note', 3, 0.2, 0.5), voice(a, 'note', 3, 0.9, 0)];
  vs.forEach((v) => a.add(v));
  const r = a.admit({ category: 'note', priority: 2, loudness: 0.5, now: 2 });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.victims[0], vs[2]);
});

test('P1 voices are never stolen, and P1 always plays', () => {
  const a = new VoiceAllocator();
  fill(a, 'stinger', 1, FULL_CAPS.stinger, 0);
  const r = a.admit({ category: 'stinger', priority: 2, loudness: 1, now: 5 });
  assert.equal(r.ok, false);
  const r1 = a.admit({ category: 'stinger', priority: 1, loudness: 1, now: 5 });
  assert.ok(r1.ok && r1.victims.length === 0);
});

test('P3 yields when three P1/P2 sounds started in the last 100 ms', () => {
  const a = new VoiceAllocator();
  fill(a, 'misc', 2, 3, 1);
  assert.equal(a.admit({ category: 'note', priority: 3, loudness: 1, now: 1.05 }).ok, false);
  assert.equal(a.admit({ category: 'note', priority: 3, loudness: 1, now: 1.2 }).ok, true);
});

test('the global cap of 32 holds across categories', () => {
  const a = new VoiceAllocator();
  for (const c of Object.keys(FULL_CAPS) as Category[]) fill(a, c, 4, FULL_CAPS[c], 0);
  assert.equal(a.count(), FULL_GLOBAL_CAP + 0);
  assert.equal(a.admit({ category: 'impact', priority: 4, loudness: 0.1, now: 0.5 }).ok, false);
});

test('low-end devices get half the voices', () => {
  const a = new VoiceAllocator(true);
  assert.equal(a.globalCap, 16);
  assert.equal(a.caps.impact, 4);
  assert.ok(Object.values(a.caps).every((c) => c >= 1));
});

test('finished voices free their slot', () => {
  const a = new VoiceAllocator();
  const vs = fill(a, 'scrape', 4, FULL_CAPS.scrape, 0);
  vs.forEach((v) => (v.end = 0.5));
  assert.ok(a.admit({ category: 'scrape', priority: 4, loudness: 0.1, now: 1 }).ok);
  assert.equal(a.count('scrape'), 0);
});

test('cooldowns space out repeats per key', () => {
  const c = new Cooldowns();
  assert.ok(c.ready('body:1', 0, 0.06));
  assert.equal(c.ready('body:1', 0.05, 0.06), false);
  assert.ok(c.ready('body:2', 0.05, 0.06));
  assert.ok(c.ready('body:1', 0.07, 0.06));
  for (let i = 0; i < 2000; i++) c.ready(`k${i}`, i, 1);
  assert.ok(c.ready('body:1', 0.08, 0.06), 'old keys are forgotten');
});
