// Every procedural sound renders clean: non-silent, finite, never above full
// scale, a sensible length, distinct variations and seamless loops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, renderBed } from '../../src/synth/recipes';
import { renderNote, MATERIAL_INSTRUMENT, type InstrumentId } from '../../src/synth/instruments';
import { mulberry32 } from '../../src/synth/dsp';
import { BIOMES } from '../../src/biomes';
import { biomeScope, biomeWindow, modeScope, towerOnly } from '../../src/bank';

const SR = 48000;

/** A loop seam is clean when the jump across it is no bigger than the signal's usual sample-to-sample motion. */
function seamOk(y: Float32Array): { ok: boolean; jump: number; typical: number } {
  let sum = 0;
  for (let i = 1; i < y.length; i++) sum += (y[i] - y[i - 1]) ** 2;
  const typical = Math.sqrt(sum / (y.length - 1));
  const jump = Math.abs(y[0] - y[y.length - 1]);
  return { ok: jump <= 4 * typical + 1e-4, jump, typical };
}

function check(name: string, y: Float32Array, maxSeconds: number) {
  assert.ok(y.length > 0, `${name}: empty`);
  let peak = 0;
  for (let i = 0; i < y.length; i++) {
    const a = Math.abs(y[i]);
    if (!Number.isFinite(a)) assert.fail(`${name}: non-finite sample at ${i}`);
    if (a > peak) peak = a;
  }
  assert.ok(peak <= 1, `${name}: peak ${peak.toFixed(3)} above full scale`);
  assert.ok(peak >= 0.05, `${name}: nearly silent (peak ${peak.toFixed(4)})`);
  assert.ok(y.length / SR <= maxSeconds, `${name}: ${(y.length / SR).toFixed(2)} s is too long`);
  return peak;
}

test('every sound and variation renders clean, within the memory budget', () => {
  const bytesOf = new Map<string, number>();
  const t0 = performance.now();
  const names = Object.keys(SOUNDS);
  for (const name of names) {
    const def = SOUNDS[name];
    const sr = SR * (def.rate ?? 1);
    const takes: Float32Array[] = [];
    let bytes = 0;
    for (let v = 0; v < def.variants; v++) {
      const y = def.render(sr, mulberry32(1000 + v), v);
      check(`${name}#${v}`, y, (def.loop ? 30 : 8) * (sr / SR));
      if (def.loop) {
        assert.ok(y.length / SR >= 0.5, `${name}: loop shorter than 0.5 s`);
        const seam = seamOk(y);
        assert.ok(seam.ok, `${name}: loop seam jumps by ${seam.jump.toFixed(3)} (typical step ${seam.typical.toFixed(3)})`);
      }
      takes.push(y);
      bytes += y.length * 4;
    }
    bytesOf.set(name, bytes);
    for (let a = 0; a < takes.length; a++) {
      for (let b = a + 1; b < takes.length; b++) {
        const same = takes[a].length === takes[b].length && takes[a].every((s, i) => s === takes[b][i]);
        assert.ok(!same, `${name}: variations ${a} and ${b} are identical`);
      }
    }
  }
  const ms = performance.now() - t0;
  const all = [...bytesOf.values()].reduce((a, b) => a + b, 0);
  // what is actually held while playing in each biome: core sounds plus that biome's window, and in
  // Blockling Pop its own sounds instead of the tower sounds it never plays
  const held = (mode: 'tower' | 'pop') => BIOMES.map((b) => {
    const win = biomeWindow(b.id);
    let sum = 0;
    for (const [name, n] of bytesOf) {
      if ((modeScope(name) ?? 'tower') !== mode && modeScope(name)) continue;
      if (mode === 'pop' && towerOnly(name)) continue;
      const sc = biomeScope(name);
      if (!sc || sc.some((x) => win.includes(x))) sum += n;
    }
    return sum;
  });
  const worst = Math.max(...held('tower'));
  const pop = Math.max(...held('pop'));
  console.log(`# ${names.length} sounds rendered in ${ms.toFixed(0)} ms; ${(all / 1e6).toFixed(1)} MB if all were loaded, at most ${(worst / 1e6).toFixed(1)} MB held in any biome (48 kHz), ${(pop / 1e6).toFixed(1)} MB in Pop`);
  assert.ok(worst < 25e6, `SFX held in memory stays under the 25 MB budget (worst ${(worst / 1e6).toFixed(1)} MB)`);
  assert.ok(pop < 25e6, `and in Blockling Pop (worst ${(pop / 1e6).toFixed(1)} MB)`);
});

test('the core sounds Wobble Lab needs all exist', () => {
  const core = ['spawn', 'move', 'rotate.cw', 'rotate.ccw', 'rotate.blocked', 'drop', 'harddrop', 'swap', 'lockon', 'settle',
    'creak', 'groan', 'heartbeat', 'fallwhistle', 'plonk', 'heartpop', 'collapse.crack', 'collapse.rumble', 'flag',
    'scrape.rough', 'scrape.smooth', 'scrape.squeak', 'ui.tap', 'xp.tick', 'confetti', 'shimmer'];
  for (const m of Object.keys(MATERIAL_INSTRUMENT)) for (let t = 1; t <= 4; t++) core.push(`impact.${m}.${t}`);
  for (let b = 1; b <= 10; b++) core.push(`entry.${b}`);
  for (const s of new Set(BIOMES.flatMap((b) => b.sweeteners))) core.push(`amb.${s}`);
  const missing = core.filter((n) => !SOUNDS[n]);
  assert.deepEqual(missing, []);
});

test('every instrument plays across the landing-note range', () => {
  const insts: InstrumentId[] = ['marimba', 'kalimba', 'glassBell', 'pluck', 'wobble', 'vibes', 'celesta', 'whistle', 'bellLow', 'clonk', 'gong', 'twang'];
  for (const inst of insts) {
    for (let midi = 36; midi <= 98; midi += 5) check(`${inst}@${midi}`, renderNote(inst, midi, SR, mulberry32(midi)), 6);
  }
});

test('every biome ambience bed loops cleanly', () => {
  for (const b of BIOMES) {
    const y = renderBed(b.bed, SR / 2, mulberry32(b.id), 24);
    check(`bed ${b.name}`, y, 12.5);
    const seam = seamOk(y);
    assert.ok(seam.ok, `bed ${b.name}: loop seam jumps by ${seam.jump.toFixed(3)} (typical step ${seam.typical.toFixed(3)})`);
  }
});
