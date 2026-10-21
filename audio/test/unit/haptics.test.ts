import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapacitorBackend, Haptics, PATTERNS, VibrateBackend, type CapacitorHapticsLike } from '../../src/haptics';

function fakePlugin() {
  const calls: string[] = [];
  const plugin: CapacitorHapticsLike = { impact: ({ style }) => void calls.push(style) };
  return { plugin, calls };
}

function fakeTimers() {
  const queue: { fn: () => void; ms: number }[] = [];
  return {
    timers: { set: (fn: () => void, ms: number) => void queue.push({ fn, ms }) },
    flush: () => queue.splice(0).sort((a, b) => a.ms - b.ms).forEach((q) => q.fn()),
  };
}

test('impact styles follow intensity', () => {
  const { plugin, calls } = fakePlugin();
  const t = fakeTimers();
  let now = 0;
  const h = new Haptics({ plugin, level: 'full', now: () => now, timers: t.timers });
  assert.equal(h.backend.name, 'capacitor');
  h.play('land4');
  now += 1000;
  h.play('land1');
  now += 1000;
  h.play('uiTap');
  t.flush();
  assert.equal(calls[0], 'HEAVY');
  assert.ok(calls.includes('MEDIUM'));
  assert.equal(calls.at(-1), 'LIGHT');
});

test('strong hits are limited to one per 150 ms', () => {
  const { plugin, calls } = fakePlugin();
  let now = 0;
  const h = new Haptics({ plugin, level: 'full', now: () => now, timers: fakeTimers().timers });
  assert.ok(h.play('land2'));
  now = 100;
  assert.equal(h.play('land2'), false);
  now = 151;
  assert.ok(h.play('land2'));
  assert.equal(calls.length, 2);
});

test('light ticks are limited to 15 per second', () => {
  const { plugin } = fakePlugin();
  let now = 0;
  const h = new Haptics({ plugin, level: 'full', now: () => now, timers: fakeTimers().timers });
  let played = 0;
  for (; now < 1000; now += 10) if (h.play('xpTick')) played++;
  assert.ok(played <= 15 && played >= 14, `played ${played}`);
});

test('the light level drops optional patterns and softens the rest', () => {
  const { plugin, calls } = fakePlugin();
  let now = 0;
  const h = new Haptics({ plugin, level: 'light', now: () => now, timers: fakeTimers().timers });
  assert.equal(h.play('move'), false);
  assert.ok(h.play('land4'));
  assert.equal(calls[0], 'MEDIUM', 'HEAVY becomes MEDIUM at 60%');
  now = 1000;
  h.level = 'off';
  assert.equal(h.play('gameOver'), false);
});

test('continuous events become a train of impacts', () => {
  const { plugin, calls } = fakePlugin();
  const t = fakeTimers();
  new CapacitorBackend(plugin, t.timers).play(PATTERNS.collapse.events, 1);
  t.flush();
  assert.ok(calls.length >= 14, `got ${calls.length}`);
});

test('navigator.vibrate gets an on/off millisecond list', () => {
  const got: number[][] = [];
  new VibrateBackend((p) => (got.push(p), true)).play(PATTERNS.heartLost.events, 1);
  assert.equal(got.length, 1);
  const [first, gap, second] = got[0];
  assert.ok(first > 0 && gap > 0 && second > 0);
  assert.equal(got[0].length, 3);
});

test('a throwing plugin never throws into the game', () => {
  const h = new Haptics({ plugin: { impact: () => { throw new Error('nope'); } }, level: 'full', now: () => 0 });
  assert.doesNotThrow(() => h.play('land3'));
});

test('every pattern stays within 0 to 1 and plays in time order', () => {
  for (const [name, p] of Object.entries(PATTERNS)) {
    for (const e of p.events) assert.ok(e.i >= 0 && e.i <= 1 && e.t >= 0, name);
    const ts = p.events.map((e) => e.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b), name);
  }
});
