// Renders one clip: replays a bot run in the built game (game/dist-app/index.html, the phone app's
// page with its fonts inlined) in headless Chromium on a virtual clock, captures 1080x1920 frames at
// 30 fps, mixes the game's own audio offline from everything the game told Sound's director, burns in
// the captions and an end card, and encodes an MP4 with ffmpeg.

import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunResult } from './runs.ts';
import { ACHIEVEMENTS } from '../../game/src/meta/achievements.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const GAME_PAGE = join(ROOT, 'game', 'dist-app', 'index.html');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

export const FPS = 30;
/** The page is a big phone (540 x 960 CSS px) drawn at 2x: the game's canvas is exactly 1080 x 1920. */
export const VIEW = { width: 540, height: 960, dpr: 2 };
/** Another phone shape for stills (the App Store's screenshots are an iPhone's taller screen). Clips stay 9:16. */
export function setView(v: { width: number; height: number; dpr: number }): void { Object.assign(VIEW, v); }
const FRAME_MS = 1000 / FPS;
/** The whole page at device pixels (CDP captures CSS pixels unless the clip says otherwise). */
const full = () => ({ x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: VIEW.dpr });
/** Seconds of play the mix hears before the clip, so the band and the ambience are already going. */
const PREROLL = 40;
/** Frames drawn (not kept) before the first kept one, so the camera and the frame pacing settle. */
const LEAD_STEPS = 150;

export interface CaptionLine { text: string; hi?: boolean }
export interface Caption {
  /** ms into the clip it pops in (or the first frame at or past `atStep`), and how long it stays (default: to the end card). */
  at?: number;
  atStep?: number;
  for?: number;
  lines: CaptionLine[];
  /** Fraction of the height for its top edge (default 0.16, below the HUD and clear of the apps' own top bar). */
  top?: number;
  /** CSS px at 540 wide (default 34, i.e. 68 px in the video). */
  size?: number;
}

export interface ClipJob {
  run: RunResult;
  /** Steps of the run the clip shows. */
  from: number;
  to: number;
  /** Keep filming this long after `to` or the run's end (the run-over stamp, the panorama), ms. */
  tailMs?: number;
  /** Never longer than this, ms (before the end card). */
  maxMs?: number;
  captions: Caption[];
  end?: { cta: string; sub?: string; ms?: number };
  /** HUD mode tag ("DAILY #13 · SCORED"). */
  tag?: string;
  out: string;
  /** Also save the frame at this ms as a JPEG (a cover for the post). */
  cover?: { at: number; path: string };
  /** Save these frames as PNGs instead of (or as well as) a video: at ms into the clip, or the first frame at or past a step. */
  stills?: { at?: number; atStep?: number; path: string }[];
  /** No video, only the stills. */
  stillsOnly?: boolean;
  /** Called in the page before each kept frame, e.g. to open a screen for a still. */
  log?: (s: string) => void;
}

export interface ClipResult { out: string; frames: number; seconds: number; problems: string[]; audio: { peak: number; rms: number; misses: number } | null }

let mixCode: string | null = null;
async function mixBundle(): Promise<string> {
  if (mixCode) return mixCode;
  const r = await build({ entryPoints: [join(here, 'mix.ts')], bundle: true, format: 'iife', target: 'es2022', write: false, logLevel: 'warning' });
  mixCode = r.outputFiles[0].text;
  return mixCode;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROMIUM, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
}

/** A fresh game page on the virtual clock, booted to its menu. */
export async function openGame(browser: Browser, opts: { profile?: Record<string, unknown>; storage?: Record<string, string> } = {}): Promise<{ ctx: BrowserContext; page: Page; problems: string[] }> {
  if (!existsSync(GAME_PAGE)) throw new Error(`no ${GAME_PAGE}: run "npm run build:app" in game/ first`);
  const ctx = await browser.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.dpr, isMobile: true, hasTouch: true });
  // Nothing leaves the machine: the page is a file, and the ladder or anything else stays unreachable.
  await ctx.route(/^(?!file:|data:|blob:)/, r => r.abort());
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  if (opts.profile || opts.storage) {
    await page.addInitScript(([p, s]) => {
      if (p) localStorage.setItem('shape-tower-profile-v1', JSON.stringify(p));
      for (const [k, v] of Object.entries(s ?? {})) localStorage.setItem(k, v);
    }, [opts.profile ?? null, opts.storage ?? null] as const);
  }
  await page.addInitScript(ids => { (window as any).__clipAchievements = ids; }, ACHIEVEMENTS.map(a => a.id));
  await page.addInitScript({ path: join(here, 'clock.js') });
  await page.addInitScript({ path: join(here, 'driver.js') });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await page.goto(`file://${GAME_PAGE}`);
  // Boot on the virtual clock, yielding in between so fonts, images and the audio worker get real time.
  for (let i = 0; ; i++) {
    if (i > 300) throw new Error('the game never showed its menu');
    await page.evaluate(() => (window as any).__clock.run(100));
    const ok = await page.evaluate(() => !!document.querySelector('.sc-root.show [data-action="play"]') && !!(window as any).__wobble?.audio);
    if (ok) break;
    await page.waitForTimeout(25);
  }
  for (let i = 0; i < 30; i++) { await page.evaluate(() => (window as any).__clock.run(100)); await page.waitForTimeout(10); }
  await page.evaluate(() => { (window as any).__clip.tap(); (window as any).__clip.keepLogo(); });
  return { ctx, page, problems };
}

/** Starts the run and fast-forwards (nothing drawn) to `step`. */
export async function startRun(page: Page, run: RunResult, step: number, tag?: string): Promise<void> {
  const s = run.spec;
  await page.evaluate(spec => (window as any).__clip.start(spec), {
    mode: s.mode, seed: s.seed, tuning: s.tuning, secondWind: s.secondWind, inputs: run.inputs, digests: run.digests, tag,
  });
  await page.evaluate(() => (window as any).__clip.draw(false));
  for (;;) {
    const at = await page.evaluate(to => (window as any).__clip.skipTo(to, 50, 120), step - LEAD_STEPS);
    if (at >= step - LEAD_STEPS) break;
    const st = await page.evaluate(() => (window as any).__clip.state());
    if (st.state !== 'playing') break;
    await page.waitForTimeout(1);
  }
  await page.evaluate(() => (window as any).__clip.draw(true));
  // Drawn frames up to the first kept one.
  for (let i = 0; i < 2000; i++) {
    const st = await page.evaluate(ms => { (window as any).__clock.frame(ms); return (window as any).__clip.state(); }, FRAME_MS);
    if (st.step >= step || st.state !== 'playing') break;
  }
}

const ease = (t: number) => Math.max(0, Math.min(1, t));

/** The overlay for frame time `t` (ms into the clip) of a clip `len` ms long before its end card. */
function overlayAt(job: ClipJob, t: number, len: number): { cap: unknown; end: unknown } {
  let cap: unknown = null;
  for (const c of job.captions) {
    if (c.at === undefined) continue;
    const until = c.for !== undefined ? c.at + c.for : len;
    if (t < c.at || t > until + 220) continue;
    const a = t > until ? 1 - (t - until) / 220 : ease((t - c.at) / 120);
    cap = { lines: c.lines, top: c.top ?? 0.16, size: c.size ?? 34, a, pop: ease((t - c.at) / 260) };
  }
  const end = job.end && t >= len ? { cta: job.end.cta, sub: job.end.sub, a: ease((t - len) / 350) } : null;
  return { cap, end };
}

/** Films the clip and writes the MP4 (and any stills). */
export async function renderClip(browser: Browser, job: ClipJob): Promise<ClipResult> {
  const log = job.log ?? (() => {});
  const { ctx, page, problems } = await openGame(browser);
  const tmp = mkdtempSync(join(tmpdir(), 'clip-'));
  try {
    log(`run ${job.run.spec.mode} seed ${job.run.spec.seed}: steps ${job.from} to ${job.to}`);
    const c0 = Date.now();
    await startRun(page, job.run, job.from, job.tag);
    log(`  fast-forward ${((Date.now() - c0) / 1000).toFixed(0)} s`);
    const c1 = Date.now();
    job.captions = job.captions.map(c => ({ ...c }));
    const cdp = await ctx.newCDPSession(page);
    const t0 = await page.evaluate(() => performance.now());
    const endMs = job.end ? (job.end.ms ?? 1800) : 0;
    let len = Infinity; // ms of play before the end card, known once the stop condition is met
    let frames = 0;
    let stopAt = Infinity;
    // In step order: a still at ms is at the step that many ms in.
    const stepOf = (x: { at?: number; atStep?: number }) => x.atStep ?? job.from + ((x.at ?? 0) * 60) / 1000;
    const stills = [...(job.stills ?? [])].sort((a, b) => stepOf(a) - stepOf(b));
    for (let f = 0; ; f++) {
      const t = f * FRAME_MS;
      if (t >= Math.min(len + endMs, (job.maxMs ?? 30000) + endMs)) break;
      if (len === Infinity && t >= (job.maxMs ?? 30000)) len = t;
      const ov = overlayAt(job, t, len === Infinity ? Number.MAX_SAFE_INTEGER : len);
      const st = await page.evaluate(([ms, cap, end]) => {
        const w = window as any;
        if (ms > 0) w.__clock.frame(ms);
        w.__clip.paint(cap, end);
        return w.__clip.state();
      }, [f === 0 ? 0 : FRAME_MS, ov.cap, ov.end] as const);
      for (const c of job.captions) if (c.at === undefined && c.atStep !== undefined && st.step >= c.atStep) c.at = t + FRAME_MS;
      if (len === Infinity && stopAt === Infinity && (st.step >= job.to || st.state !== 'playing')) stopAt = t + (job.tailMs ?? 0);
      // The run summary (with QA's questions) never goes in a clip: the end card takes over first.
      if (len === Infinity && (t >= stopAt || st.screen)) len = t;
      const due = stills.length && (stills[0].at !== undefined ? t >= stills[0].at : st.step >= stills[0].atStep!);
      const want = due ? stills.shift()! : null;
      if (!job.stillsOnly) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, clip: full() });
        writeFileSync(join(tmp, `${String(f).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
        if (job.cover && Math.abs(t - job.cover.at) < FRAME_MS / 2) writeFileSync(job.cover.path, Buffer.from(shot.data, 'base64'));
      }
      if (want) {
        const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: full() });
        mkdirSync(dirname(want.path), { recursive: true });
        writeFileSync(want.path, Buffer.from(png.data, 'base64'));
        if (job.stillsOnly && !stills.length) { frames = f + 1; break; }
      }
      frames = f + 1;
    }
    const t1 = await page.evaluate(() => performance.now());
    const pageState = await page.evaluate(() => ({ problems: (window as any).__clip.problems as string[], audioLog: (window as any).__clip.audioLog }));
    problems.push(...pageState.problems);
    await ctx.close();
    if (job.stillsOnly) return { out: '', frames, seconds: frames / FPS, problems, audio: null };

    log(`  ${frames} frames ${((Date.now() - c1) / 1000).toFixed(0)} s`);
    // The mix: the director hears the run from PREROLL s before the clip (its settings from the start).
    const c2 = Date.now();
    const origin = Math.max(0, t0 - PREROLL * 1000);
    const SETTINGS = new Set(['setJuice', 'setZen', 'setVolume', 'setMono', 'setCalm', 'setLockOnChime']);
    const calls = (pageState.audioLog as [number, string, unknown[]][])
      .filter(c => c[0] >= origin || SETTINGS.has(c[1]))
      .map(c => [Math.max(0, c[0] - origin), c[1], c[2]]);
    const mixPage = await browser.newPage();
    await mixPage.setContent('<!doctype html><title>mix</title>');
    await mixPage.addScriptTag({ content: await mixBundle() });
    const mix = await mixPage.evaluate(([l, from, to]) => (window as any).renderMix(l, { from, to }), [calls, t0 - origin, t1 + FRAME_MS - origin] as const) as { pcm: string; peak: number; rms: number; misses: number; ms: number };
    await mixPage.close();
    log(`  mix of ${calls.length} calls ${((Date.now() - c2) / 1000).toFixed(0)} s (peak ${mix.peak.toFixed(2)}, rms ${mix.rms.toFixed(3)}, ${mix.misses} missed notes)`);
    writeFileSync(join(tmp, 'mix.wav'), wav(Buffer.from(mix.pcm, 'base64'), 48000, 2));

    mkdirSync(dirname(job.out), { recursive: true });
    const seconds = frames / FPS;
    const fadeAt = Math.max(0, seconds - 0.8);
    const ff = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(tmp, '%05d.jpg'), '-i', join(tmp, 'mix.wav'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
      '-af', `afade=t=out:st=${fadeAt.toFixed(2)}:d=0.8`, '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', job.out,
    ], { encoding: 'utf8' });
    if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
    return { out: job.out, frames, seconds, problems, audio: { peak: mix.peak, rms: mix.rms, misses: mix.misses } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    await ctx.close().catch(() => {});
  }
}

/** 16-bit PCM in a WAV container. */
function wav(pcm: Buffer, rate: number, channels: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
