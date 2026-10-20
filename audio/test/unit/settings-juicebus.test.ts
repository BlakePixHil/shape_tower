import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type StorageLike } from '../../src/settings';
import { connectJuiceBus } from '../../src/juicebus';
import { JUICE_EVENTS } from '../../src/types';
import { biome, biomeKey, BIOMES, DEEP_COSMOS_KEYS, FIRST_DEEP_COSMOS_CHECKPOINT } from '../../src/biomes';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test('settings round-trip through storage', () => {
  const s = memory();
  saveSettings({ ...DEFAULT_SETTINGS, music: 0.2, haptics: 'light', mono: true }, s);
  const back = loadSettings(s);
  assert.equal(back.music, 0.2);
  assert.equal(back.haptics, 'light');
  assert.equal(back.mono, true);
  assert.equal(back.sfx, 1);
});

test('broken or hostile settings fall back to defaults', () => {
  const s = memory();
  s.setItem('shapeTower.audio.v1', '{not json');
  assert.deepEqual(loadSettings(s), DEFAULT_SETTINGS);
  s.setItem('shapeTower.audio.v1', JSON.stringify({ music: 7, sfx: 'loud', haptics: 'max' }));
  const back = loadSettings(s, { haptics: 'light' });
  assert.equal(back.music, 1);
  assert.equal(back.sfx, 1);
  assert.equal(back.haptics, 'light');
  const throwing: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadSettings(throwing), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS, throwing));
});

test('connectJuiceBus forwards every event and unhooks cleanly', () => {
  const bus = new EventEmitter();
  const got: [string, unknown][] = [];
  const off = connectJuiceBus(bus, { handle: (n, p) => void got.push([n, p]) });
  for (const name of JUICE_EVENTS) assert.equal(bus.listenerCount(name), 1, name);
  bus.emit('piece_settled', { grade: 'perfect' });
  bus.emit('run_start');
  bus.emit('signals', 'not an object');
  assert.deepEqual(got, [['piece_settled', { grade: 'perfect' }], ['run_start', undefined], ['signals', undefined]]);
  off();
  for (const name of JUICE_EVENTS) assert.equal(bus.listenerCount(name), 0, name);
});

test('biome data covers 1 to 10 and clamps outside it', () => {
  assert.deepEqual(BIOMES.map((b) => b.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(biome(0).id, 1);
  assert.equal(biome(42).id, 10);
  assert.ok(BIOMES.every((b) => b.air >= 0 && b.air <= 0.5));
});

test('Deep Cosmos rotates through its keys every 6 checkpoints', () => {
  const first = biomeKey(10, FIRST_DEEP_COSMOS_CHECKPOINT);
  assert.deepEqual(first, DEEP_COSMOS_KEYS[0]);
  assert.deepEqual(biomeKey(10, FIRST_DEEP_COSMOS_CHECKPOINT + 6), DEEP_COSMOS_KEYS[1]);
  assert.deepEqual(biomeKey(10, FIRST_DEEP_COSMOS_CHECKPOINT + 6 * DEEP_COSMOS_KEYS.length), DEEP_COSMOS_KEYS[0]);
  assert.deepEqual(biomeKey(3, 99), BIOMES[2].key);
});
