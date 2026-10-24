// The clip's sound, in headless Chromium: Sound's own director on an OfflineAudioContext, told
// everything the game told the live one while the frames were drawn, each call at its time on the
// page's clock. It is the game's mix, made offline instead of played (the audio module's sim
// check works the same way: audio/test/browser/sim-harness.ts).
// Bundled by src/render.ts with esbuild; the page calls window.renderMix.

import { AudioDirector } from '../../audio/src/director';

const SR = 48000;
/** The live director ticks every 50 ms (its real-time ticker); offline, the render stops that often. */
const TICK = 0.05;
/** After these the next band or the results loop bakes; offline no time passes, so wait for it. */
const BAKE_AFTER = new Set(['checkpoint_claimed', 'biome_entered', 'run_over']);

type Call = [number, string, unknown[]];

interface MixResult { pcm: string; peak: number; rms: number; misses: number; ms: number }

(window as unknown as { renderMix: unknown }).renderMix = async (log: Call[], o: { from: number; to: number; volumes?: Record<string, number> }): Promise<MixResult> => {
  const T0 = performance.now();
  const seconds = o.to / 1000 + 0.25;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const d = new AudioDirector({ context: ctx, haptics: false, storage: null, seed: 1, lowEnd: false });
  // The game's default settings (game/src/view/settings.ts), set before the bank is ready so no slider sound plays.
  const vol = { music: 0.7, sfx: 1, voices: 0.8, ...o.volumes };
  d.setVolume('music', vol.music);
  d.setVolume('sfx', vol.sfx);
  d.setVolume('voices', vol.voices);
  await d.ready;
  await d.music.prewarm();
  const calls = log.filter(c => c[0] / 1000 < seconds).sort((a, b) => a[0] - b[0]);
  let i = 0;
  let failure: unknown = null;
  const advance = async (k: number) => {
    const t1 = (k + 1) * TICK;
    d.tick(Math.max(ctx.currentTime, k * TICK));
    for (; i < calls.length && calls[i][0] / 1000 < t1; i++) {
      const [t, m, a] = calls[i];
      const when = Math.max(t / 1000, ctx.currentTime);
      switch (m) {
        case 'handle': {
          const name = String(a[0]);
          d.handle(name, (a[1] ?? undefined) as Record<string, unknown> | undefined, when);
          if (BAKE_AFTER.has(name)) await d.music.prewarm();
          break;
        }
        case 'ui': d.ui(a[0] as Parameters<AudioDirector['ui']>[0], when); break;
        case 'screen': d.screen(a[0] as Parameters<AudioDirector['screen']>[0], when); if (a[0] !== 'none') await d.music.prewarm(); break;
        case 'attach': d.attach(when); break;
        case 'setJuice': d.setJuice(!!a[0]); break;
        case 'setZen': d.setZen(!!a[0]); break;
        case 'setVolume': d.setVolume(a[0] as 'music' | 'sfx' | 'voices', Number(a[1])); break;
        case 'setMono': d.setMono(!!a[0]); break;
        case 'setCalm': d.setCalm(!!a[0]); break;
        case 'setLockOnChime': d.setLockOnChime(!!a[0]); break;
      }
    }
  };
  await advance(0);
  const n = Math.ceil(seconds / TICK);
  for (let k = 1; k < n; k++) {
    ctx.suspend(k * TICK).then(() => advance(k)).catch(e => { failure ??= e; }).finally(() => ctx.resume());
  }
  const buf = await ctx.startRendering();
  if (failure) throw failure;
  // The clip's stretch as 16-bit stereo, base64.
  const a = buf.getChannelData(0), b = buf.getChannelData(1);
  const i0 = Math.max(0, Math.round((o.from / 1000) * SR)), i1 = Math.min(a.length, Math.round((o.to / 1000) * SR));
  const pcm = new Int16Array((i1 - i0) * 2);
  let peak = 0, sum = 0;
  for (let k = i0; k < i1; k++) {
    for (let c = 0; c < 2; c++) {
      const x = c ? b[k] : a[k];
      const v = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      pcm[(k - i0) * 2 + c] = Math.round(v * 32767);
    }
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  const music = d.music.state() as { misses?: number };
  return { pcm: btoa(bin), peak, rms: Math.sqrt(sum / Math.max(1, pcm.length)), misses: music.misses ?? 0, ms: performance.now() - T0 };
};
