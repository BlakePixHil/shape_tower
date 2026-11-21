// The voiceover Short: about 45 seconds for YouTube Shorts (1080 x 1920), a voice walking through the
// game over real play, captions popping in on its words, the game's own music underneath, and an end card
// saying where it is out. What it says and shows is short/script.ts.
//
//   node --experimental-strip-types scripts/short.ts [--out <file>] [--no-build] [--only <shot,shot>] [--fresh]
//        [--regions "<text>"] [--work <folder>]
//
// How it is made:
//   1. The voice: scripts/voice.py (Kokoro, an open text-to-speech model that runs on this machine) reads
//      each line and times every word. Set VOICE_PYTHON to the Python that has kokoro-onnx, soundfile and
//      pocketsphinx, and KOKORO_DIR to the folder with the two model files (see voice.py).
//   2. The timeline: lines one after another with short gaps; each shot starts on a word of a line.
//   3. The shots: bot runs replayed in the built game (src/render.ts, sounds only, no music), the app's
//      screens framed as a phone on the brand's sky, the run-over panorama played backwards (ground to
//      space), and the puzzle mode played with real drags. Each is filmed once and kept in the work folder.
//   4. The music: the Meadow band playing its whole theme (Sound's director offline, juice off so it
//      doesn't follow a run), under everything and ducked under the voice.
//   5. The overlay (short/overlay.ts): captions, label and end card, photographed apart from the game.
//   6. ffmpeg joins it: shots cut hard, overlay on top, voice + sounds + music, loudness set for YouTube.
//
// Default file: /mnt/project-files/marketing/short/shape-tower-short.mp4, with a .jpg cover and upload.md
// (title, description, tags) beside it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { checkWords } from '../src/clips.ts';
import { SEASONED, STORE } from '../src/player.ts';
import { FPS, ROOT, VIEW, launch, mixCalls, openGame, renderClip, startRun, wav } from '../src/render.ts';
import { findMoments, type RunResult } from '../src/runs.ts';
import { CARD, LINES, RUNS, SHOTS, UPLOAD, VOICE, checkShort, say, wordsOf, type RunName, type Shot, type Word } from '../short/script.ts';
import { PHONE, frameHtml, overlayHtml, type OverlayCaption, type OverlaySpec } from '../short/overlay.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = flag('--out') ?? '/mnt/project-files/marketing/short/shape-tower-short.mp4';
const WORK = flag('--work') ?? join(tmpdir(), 'shape-tower-short');
const ONLY = new Set((flag('--only') ?? '').split(',').filter(Boolean));
const FRESH = args.includes('--fresh');
const REGIONS = flag('--regions') ?? CARD.regions;
const ICON = '/mnt/project-files/art/app-icon-burst-1024.png';
const FRAME_MS = 1000 / FPS;
const here = join(ROOT, 'marketing');
mkdirSync(WORK, { recursive: true });

function run(cmd: string, a: string[], opts: { cwd?: string; input?: string } = {}): string {
  const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${a.slice(0, 6).join(' ')}…: ${r.stderr || r.error}`);
  return r.stdout;
}
const ffmpeg = (...a: string[]) => run('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 10);
const snap = (t: number) => Math.round(t * FPS) / FPS;

// ------------------------------------------------------------------ 1. the voice
interface Voiced { id: string; file: string; seconds: number; words: { w: string; t0: number; t1: number }[]; aligned: boolean; heard: string }

{ const wrong = checkShort(); if (wrong.length) throw new Error(wrong.join('; ')); }
checkWords(...LINES.map(l => say(l.text)), UPLOAD.title, ...UPLOAD.description, ...UPLOAD.tags, CARD.badge.text, CARD.free.text, REGIONS, ...SHOTS.map(s => s.label ?? ''));
const voiceSpec = { ...VOICE, lines: LINES.map(l => ({ id: l.id, say: say(l.text) })) };
const voiceDir = join(WORK, `voice-${hash(voiceSpec)}`);
if (FRESH || !existsSync(join(voiceDir, 'voice.json'))) {
  mkdirSync(voiceDir, { recursive: true });
  writeFileSync(join(voiceDir, 'lines.json'), JSON.stringify(voiceSpec));
  console.log(`voice: ${VOICE.voice}, ${LINES.length} lines`);
  writeFileSync(join(voiceDir, 'voice.json'), run(process.env.VOICE_PYTHON ?? 'python3', [join(here, 'scripts', 'voice.py'), join(voiceDir, 'lines.json'), voiceDir]));
}
const voiced = new Map<string, Voiced>((JSON.parse(readFileSync(join(voiceDir, 'voice.json'), 'utf8')).lines as Voiced[]).map(v => [v.id, v]));
for (const l of LINES) {
  const v = voiced.get(l.id)!;
  const want = wordsOf(say(l.text));
  if (v.words.length !== want.length) throw new Error(`line ${l.id}: ${v.words.length} timed words for ${want.length} written`);
  if (!v.aligned) console.log(`  line ${l.id}: words not lined up with the sound (spread evenly instead)`);
  console.log(`  ${l.id} ${v.seconds.toFixed(2)} s, heard: "${v.heard}"`);
}

// ------------------------------------------------------------------ 2. the timeline
const lineAt = new Map<string, number>();
let clock = 0;
for (const l of LINES) {
  clock += l.gap ?? 0.3;
  lineAt.set(l.id, clock);
  clock += voiced.get(l.id)!.seconds;
}
const TOTAL = snap(clock + CARD.hold);
const FRAMES = Math.round(TOTAL * FPS);
const wordAt = ([line, word]: Word): number => {
  const v = voiced.get(line);
  if (!v || !v.words[word]) throw new Error(`no word ${word} in line ${line}`);
  return lineAt.get(line)! + v.words[word].t0;
};
/** The end card comes up just before its line. */
const CARD_AT = snap(lineAt.get(CARD.line)! - 0.4);

interface Timed extends Shot { start: number; frames: number }
const timed: Timed[] = SHOTS.map((s, i) => ({ ...s, start: i === 0 ? 0 : snap(wordAt(s.at) - (s.early ?? 0.12)), frames: 0 }));
// The last shot runs on under the card as it fades in.
timed.forEach((s, i) => { s.frames = Math.round(((timed[i + 1]?.start ?? CARD_AT + 0.4) - s.start) * FPS); });
for (const s of timed) if (s.frames < 12) throw new Error(`shot ${s.id} is only ${s.frames} frames`);
const shotAt = (t: number) => [...timed].reverse().find(s => t >= s.start - 1e-6) ?? timed[0];

// Captions: each `|` part of a line pops in on its first word and stays until the next.
const captions: OverlayCaption[] = [];
for (const l of LINES) {
  if (l.card) continue;
  const v = voiced.get(l.id)!, t0 = lineAt.get(l.id)!;
  let w = 0;
  const parts = l.text.split('|').map(part => {
    const first = w;
    w += wordsOf(part).length;
    return { first, lines: part.split('/').map(x => x.trim()).filter(Boolean).map(x => ({ text: x.replace(/^\^\s*/, ''), hi: x.startsWith('^') })) };
  });
  parts.forEach((p, i) => {
    const at = Math.max(0, t0 + v.words[p.first].t0 - 0.06);
    const next = parts[i + 1];
    const framed = shotAt(at + 0.1).footage.kind === 'screen';
    const longest = Math.max(...p.lines.map(x => x.text.length));
    captions.push({
      t0: at, t1: next ? t0 + v.words[next.first].t0 - 0.06 : t0 + v.seconds + 0.22, swap: !!next, lines: p.lines,
      top: framed ? 0.048 : 0.16, size: longest > 17 ? 36 : 42,
    });
  });
}
// A caption never outstays the next line's first.
captions.forEach((c, i) => { const n = captions[i + 1]; if (n && c.t1 > n.t0) { c.t1 = n.t0; c.swap = true; } });
const cardLine = lineAt.get(CARD.line)!, cardWords = voiced.get(CARD.line)!.words;
const overlay: OverlaySpec = {
  captions,
  labels: timed.filter(s => s.label).map(s => ({ t0: s.start, t1: s.start + s.frames / FPS, text: s.label! })),
  card: {
    t0: CARD_AT,
    badge: { text: CARD.badge.text, t: cardLine + cardWords[CARD.badge.word].t0 - 0.05 },
    stores: CARD.stores.map(s => ({ text: s.text, t: cardLine + cardWords[s.word].t0 - 0.05 })),
    free: { text: CARD.free.text, t: cardLine + cardWords[CARD.free.word].t0 - 0.05 },
    regions: REGIONS,
  },
};
console.log(`timeline: ${TOTAL.toFixed(2)} s, ${timed.length} shots, ${captions.length} captions, end card at ${CARD_AT.toFixed(2)} s`);
for (const s of timed) console.log(`  ${s.start.toFixed(2).padStart(6)} s  ${s.id} (${s.footage.kind}, ${(s.frames / FPS).toFixed(2)} s)`);
if (TOTAL >= 59) throw new Error(`${TOTAL} s is too long for a Short: trim the script`);
if (args.includes('--plan')) process.exit(0);

// ------------------------------------------------------------------ 3. the shots
if (!args.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build:app'], { cwd: join(ROOT, 'game'), stdio: 'inherit' });
  if (b.status !== 0) throw new Error('game build failed');
}
const runs = new Map<RunName, RunResult>();
const runOf = (name: RunName) => { if (!runs.has(name)) runs.set(name, RUNS[name]()); return runs.get(name)!; };
const problems: string[] = [];

/** JPEG frames in a folder to an MP4 with a silent sound track (every shot has one, so they join the same way). */
function encodeSilent(dir: string, out: string): void {
  ffmpeg('-framerate', String(FPS), '-i', join(dir, '%05d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-shortest', out);
}
const shoot = async (page: Page, cdp: { send: (m: 'Page.captureScreenshot', p: object) => Promise<{ data: string }> }, path: string) => {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: VIEW.dpr } });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};
const tick = (page: Page, ms = FRAME_MS) => page.evaluate(m => (window as any).__clock.frame(m), ms);

/** One of the app's screens, alive for `frames` frames (its buttons bob, its bars fill), with a slow scroll if asked. */
async function filmScreen(browser: Browser, taps: string[], frames: number, scroll: number, out: string): Promise<void> {
  const { ctx, page, problems: p } = await openGame(browser, { profile: SEASONED, storage: STORE });
  const dir = `${out}.frames`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    for (const [i, t] of taps.entries()) {
      await page.evaluate(sel => {
        const b = document.querySelector<HTMLElement>(`.sc-root.show ${sel.startsWith('[') ? sel : `[data-action="${sel}"]`}`);
        if (!b) throw new Error(`no ${sel} button`);
        b.click();
      }, t);
      // Up to the last tap the screens settle unseen; the last one opens on camera, a few frames in.
      const settle = i < taps.length - 1 ? 1200 : 200;
      for (let k = 0; k < settle / 100; k++) { await page.evaluate(() => (window as any).__clock.run(100)); await page.waitForTimeout(12); }
    }
    const cdp = await ctx.newCDPSession(page);
    for (let f = 0; f < frames; f++) {
      if (f) await tick(page);
      if (scroll) await page.evaluate(([y]) => {
        // The tallest scrolling part of the open screen.
        const all = [...document.querySelectorAll<HTMLElement>('.sc-root.show, .sc-root.show *')].filter(e => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        const el = all.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (el) el.scrollTop = y;
      }, [(scroll * Math.max(0, f - 8)) / FPS] as const);
      await shoot(page, cdp as never, join(dir, `${String(f).padStart(5, '0')}.jpg`));
    }
    problems.push(...p);
  } finally {
    await ctx.close();
  }
  encodeSilent(dir, out);
  rmSync(dir, { recursive: true, force: true });
}

/** The puzzle mode: a few unseen moves to fill the board, then moves dragged on camera at a person's pace. */
async function filmPop(browser: Browser, warmup: number, frames: number, out: string): Promise<void> {
  const { ctx, page, problems: p } = await openGame(browser, {
    profile: { ...SEASONED, pop: { runs: 6, best: 3120, seen: ['intro', 'bag', 'bubble', 'combo', 'next'] } }, storage: STORE,
  });
  const dir = `${out}.frames`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    // The same deal every time: the run's seed comes from Math.random.
    await page.evaluate(() => { let s = 20761; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
    await page.evaluate(() => document.querySelector<HTMLElement>('.sc-root.show [data-action="pop"]')!.click());
    for (let k = 0; k < 20; k++) { await page.evaluate(() => (window as any).__clock.run(100)); await page.waitForTimeout(15); }
    // A continue-or-new card, if a run was saved: none here (fresh storage).
    const active = await page.evaluate(() => !!(window as any).__wobble.pop?.view?.active);
    if (!active) throw new Error('the puzzle mode did not open');
    /** The best move by lines popped, then by keeping the board tidy (low and to the left), with the drag that makes it. */
    const plan = (minLines: number) => page.evaluate(([min]) => {
      const v = (window as any).__wobble.pop.view, sim = v.sim, k = v.k;
      if (sim.over) return null;
      let best: { slot: number; x: number; y: number; lines: number } | null = null, bv = -1e9;
      for (const slot of [0, 1, 2]) {
        const t = sim.turn(slot);
        if (!t) continue;
        for (const pl of t.places) {
          if (!sim.canPlace(slot, pl.x, pl.y)) continue;
          const lines = sim.wouldPop(slot, pl.x, pl.y).length;
          const val = lines * 100 + pl.y * 2 - Math.abs(pl.x - 4) * 0.2 + (lines >= min ? 1000 : 0);
          if (val > bv) { bv = val; best = { slot, x: pl.x, y: pl.y, lines }; }
        }
      }
      if (!best) return null;
      const t = sim.turn(best.slot);
      const [sx, sy] = v.slotCentre(best.slot);
      const cx = v.bx + (best.x + t.w / 2) * v.cell, cy = v.by + (best.y + t.h / 2) * v.cell;
      return { ...best, from: [sx / k, sy / k], to: [cx / k, (cy + v.cell * (1.1 + t.h / 2)) / k], filled: sim.filled as number };
    }, [minLines] as const);
    type Plan = NonNullable<Awaited<ReturnType<typeof plan>>>;
    const cdp = await ctx.newCDPSession(page);
    let f = 0;
    const keep = async () => { if (f < frames) await shoot(page, cdp as never, join(dir, `${String(f++).padStart(5, '0')}.jpg`)); };
    /** A drag over `n` frames (eased), filmed or not, then `rest` frames for the pop to play. */
    const drag = async (m: Plan, n: number, rest: number, film: boolean) => {
      await page.mouse.move(m.from[0], m.from[1]);
      await page.mouse.down();
      for (let i = 1; i <= n; i++) {
        const u = i / n, e = u * u * (3 - 2 * u);
        await page.mouse.move(m.from[0] + (m.to[0] - m.from[0]) * e, m.from[1] + (m.to[1] - m.from[1]) * e);
        await tick(page);
        if (film) await keep();
      }
      for (let i = 0; i < 3; i++) { await tick(page); if (film) await keep(); }
      await page.mouse.up();
      for (let i = 0; i < rest; i++) { await tick(page); if (film) await keep(); }
    };
    // Unseen: fill the board without popping much, so the filmed moves have lines to finish.
    for (let i = 0; i < warmup; i++) {
      const m = await plan(9);
      if (!m) break;
      await drag(m, 3, 14, false);
    }
    await keep();
    for (let guard = 0; f < frames && guard < 40; guard++) {
      const m = await plan(1);
      if (!m) { await tick(page); await keep(); continue; }
      await drag(m, 13, m.lines ? 20 : 7, true);
    }
    while (f < frames) { await tick(page); await keep(); }
    problems.push(...p);
  } finally {
    await ctx.close();
  }
  encodeSilent(dir, out);
  rmSync(dir, { recursive: true, force: true });
}

/** Films (or finds in the work folder) every shot; returns each one's file. */
async function filmShots(browser: Browser): Promise<string[]> {
  const files: string[] = [];
  for (const s of timed) {
    const ft = s.footage;
    let from = 0;
    if (ft.kind === 'run') {
      const r = runOf(ft.run);
      // The moment lands on its word: the shot starts that much play before it.
      from = Math.round(ft.step(r) - (ft.on ? (wordAt(ft.on) + (ft.lead ?? 0) - s.start) * 60 : 0));
      if (from < 60) throw new Error(`shot ${s.id} would start before its run does`);
    }
    const file = join(WORK, `shot-${s.id}-${hash({ ft, from, frames: s.frames, step: ft.kind === 'run' ? String(ft.step) : '' })}.mp4`);
    files.push(file);
    if (existsSync(file) && !FRESH && !ONLY.has(s.id)) { console.log(`shot ${s.id}: kept`); continue; }
    console.log(`shot ${s.id}: ${ft.kind}, ${s.frames} frames`);
    const log = (x: string) => console.log(`  ${x}`);
    if (ft.kind === 'run') {
      const r = await renderClip(browser, {
        run: runOf(ft.run), from, to: from + s.frames * 2 + 600, tailMs: 60000, maxMs: (s.frames - 0.5) * FRAME_MS, captions: [], tag: ft.tag,
        out: file, volumes: { music: 0 }, fadeMs: 40, crf: 12, log,
      });
      if (r.frames !== s.frames) problems.push(`shot ${s.id}: ${r.frames} frames filmed of ${s.frames}`);
      problems.push(...r.problems.map(p => `shot ${s.id}: ${p}`));
    } else if (ft.kind === 'climb') {
      // The whole panorama once (kept), then its sweep backwards, fitted to the shot.
      const r = runOf(ft.run);
      const pano = join(WORK, `pano-${ft.run}-${hash(r.spec)}.mp4`);
      if (!existsSync(pano) || FRESH) {
        const m = findMoments(r).find(x => x.kind === 'climb');
        if (!m) throw new Error(`the ${ft.run} run has no climb`);
        const res = await renderClip(browser, { run: r, from: m.to - 60, to: m.to, tailMs: 14000, maxMs: 15000, captions: [], out: pano, volumes: { music: 0 }, crf: 12, log });
        problems.push(...res.problems.map(p => `shot ${s.id}: ${p}`));
      }
      const sweep = panoSweep(pano);
      const want = s.frames / FPS;
      // Backwards, at the speed that makes the sweep fill the shot (a short hold on the top at the end).
      const speed = Math.max(0.5, (sweep.to - sweep.from) / (want - 0.35));
      ffmpeg('-ss', sweep.from.toFixed(3), '-to', sweep.to.toFixed(3), '-i', pano, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-filter_complex', `[0:v]reverse,setpts=PTS/${speed.toFixed(4)},fps=${FPS},tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${s.frames},setpts=PTS-STARTPTS[v]`,
        '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file);
      console.log(`  sweep ${sweep.from.toFixed(2)} to ${sweep.to.toFixed(2)} s of the panorama, backwards at ${speed.toFixed(2)}x`);
    } else if (ft.kind === 'screen') await filmScreen(browser, ft.taps, s.frames, ft.scroll ?? 0, file);
    else await filmPop(browser, ft.warmup, s.frames, file);
  }
  return files;
}

/**
 * Where the panorama's camera moves: from the first frame that differs from the one before the sweep to
 * the last that still changes, read from ffmpeg's scene scores (a still tower scores about 0).
 */
function panoSweep(pano: string): { from: number; to: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', pano, '-vf', 'scale=108:192,tblend=all_mode=difference,blackframe=amount=0:threshold=12,metadata=print:file=-', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  // blackframe's pblack is the share of pixels that barely changed since the frame before: under 97% means the camera is moving.
  const frames: { t: number; still: number }[] = [];
  let t = 0;
  for (const line of r.stdout.split('\n')) {
    const a = /pts_time:([\d.]+)/.exec(line);
    if (a) t = Number(a[1]);
    const b = /lavfi\.blackframe\.pblack=(\d+)/.exec(line);
    if (b) frames.push({ t, still: Number(b[1]) });
  }
  const moving = frames.filter(f => f.still < 97);
  if (moving.length < FPS) throw new Error('could not find the panorama\'s sweep');
  // The longest run of moving frames (gaps of up to a third of a second allowed).
  let best = { from: moving[0].t, to: moving[0].t }, cur = { ...best };
  for (const f of moving.slice(1)) {
    if (f.t - cur.to <= 0.34) cur.to = f.t; else cur = { from: f.t, to: f.t };
    if (cur.to - cur.from > best.to - best.from) best = { ...cur };
  }
  return { from: Math.max(0, best.from - 0.1), to: best.to + 0.1 };
}

// ------------------------------------------------------------------ 4. the music
/** The Meadow band's whole theme for `seconds`: a run's first calls, juice off, nothing after the first shape. */
async function musicBed(browser: Browser, seconds: number, out: string): Promise<void> {
  const r = runOf('collapse');
  const { ctx, page } = await openGame(browser);
  let log: [number, string, unknown[]][];
  try {
    await startRun(page, r, 200);
    log = await page.evaluate(() => (window as any).__clip.audioLog);
  } finally {
    await ctx.close();
  }
  const spawn = log.findIndex(c => c[1] === 'handle' && c[2][0] === 'piece_spawned');
  if (spawn < 0) throw new Error('the run never spawned a shape');
  const t0 = log[spawn][0];
  // Settings and the run's start only; no menu music before it, and the band told not to follow the run.
  const calls: unknown[][] = [[0, 'setJuice', [false]]];
  for (const c of log.slice(0, spawn + 1)) {
    if (c[1] === 'setJuice' || c[1] === 'screen' || c[1] === 'ui') continue;
    calls.push([c[1] === 'handle' ? 500 + Math.max(0, c[0] - t0) : 0, c[1], c[2]]);
  }
  const mix = await mixCalls(browser, calls, 500, 500 + (seconds + 4) * 1000, { music: 0.7, sfx: 0, voices: 0 });
  writeFileSync(out, wav(Buffer.from(mix.pcm, 'base64'), 48000, 2));
  console.log(`music: ${seconds.toFixed(0)} s of the Meadow band (peak ${mix.peak.toFixed(2)}, rms ${mix.rms.toFixed(3)}, ${mix.misses} missed notes)`);
  if (mix.rms < 0.003) problems.push('the music bed is silent');
}

// ------------------------------------------------------------------ 5. the overlay
async function filmOverlay(browser: Browser, dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  try {
    await page.setContent(overlayHtml(ROOT, overlay, existsSync(ICON) ? ICON : null));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
    let last = '', lastFile = '', shots = 0;
    for (let f = 0; f < FRAMES; f++) {
      const key = await page.evaluate(t => (window as any).paint(t), f / FPS);
      const file = join(dir, `${String(f).padStart(5, '0')}.png`);
      if (key === last && lastFile) linkSync(lastFile, file);
      else { await page.screenshot({ path: file, omitBackground: true }); lastFile = file; shots++; }
      last = key;
    }
    console.log(`overlay: ${FRAMES} frames (${shots} drawn)`);
  } finally {
    await page.close();
  }
  const frame = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  try {
    await frame.setContent(frameHtml(ROOT));
    await frame.screenshot({ path: join(dir, 'frame.png'), omitBackground: true });
  } finally {
    await frame.close();
  }
}

// ------------------------------------------------------------------ film
const browser = await launch();
let files: string[];
const bed = join(WORK, 'bed.wav');
const ovDir = join(WORK, 'overlay');
try {
  files = await filmShots(browser);
  if (!existsSync(bed) || FRESH) await musicBed(browser, 60, bed);
  await filmOverlay(browser, ovDir);
} finally {
  await browser.close();
}

// ------------------------------------------------------------------ 6. the join
const inputs: string[] = [];
const graph: string[] = [];
const add = (...a: string[]) => { inputs.push(...a); return (inputs.filter(x => x === '-i').length - 1); };
// The shots, cut hard; screens sit in the phone frame.
const frameIn = add('-loop', '1', '-framerate', String(FPS), '-i', join(ovDir, 'frame.png'));
const parts: string[] = [];
timed.forEach((s, i) => {
  const n = add('-i', files[i]);
  const len = s.frames / FPS;
  if (s.footage.kind === 'screen') {
    graph.push(`[${n}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS,scale=${PHONE.width}:${PHONE.height}:flags=lanczos,pad=1080:1920:${PHONE.left}:${PHONE.top}:color=0x2B2140[s${i}]`);
    graph.push(`[${frameIn}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS[f${i}]`, `[s${i}][f${i}]overlay=format=auto,format=yuv420p,setsar=1[v${i}]`);
  } else graph.push(`[${n}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}]`);
  graph.push(`[${n}:a]aresample=48000,atrim=end=${len.toFixed(4)},apad=whole_dur=${len.toFixed(4)},afade=t=in:d=0.03,afade=t=out:st=${(len - 0.04).toFixed(4)}:d=0.04,asetpts=PTS-STARTPTS[a${i}]`);
  parts.push(`[v${i}][a${i}]`);
});
const shotsEnd = timed[timed.length - 1].start + timed[timed.length - 1].frames / FPS;
graph.push(`${parts.join('')}concat=n=${timed.length}:v=1:a=1[cut][sfx0]`);
graph.push(`[cut]tpad=stop_mode=clone:stop_duration=${(TOTAL - shotsEnd + 0.5).toFixed(3)},trim=end_frame=${FRAMES}[base]`);
const ovIn = add('-framerate', String(FPS), '-i', join(ovDir, '%05d.png'));
graph.push(`[base][${ovIn}:v]overlay=format=auto,format=yuv420p[vout]`);
// The voice: each line at its time, evened out and brightened a little.
const voiceParts: string[] = [];
LINES.forEach((l, i) => {
  const n = add('-i', voiced.get(l.id)!.file);
  const ms = Math.round(lineAt.get(l.id)! * 1000);
  graph.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}:all=1[l${i}]`);
  voiceParts.push(`[l${i}]`);
});
graph.push(`${voiceParts.join('')}amix=inputs=${LINES.length}:normalize=0,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=3,loudnorm=I=-16:TP=-2:LRA=7,apad=whole_dur=${TOTAL},asplit=2[vo][key]`);
// The sounds of play, under the voice; the music under both, ducked while the voice speaks.
graph.push(`[sfx0]apad=whole_dur=${TOTAL},volume=-9dB,afade=t=out:st=${(CARD_AT - 0.1).toFixed(3)}:d=0.5[sfx]`);
const bedIn = add('-i', bed);
graph.push(`[${bedIn}:a]silenceremove=start_periods=1:start_threshold=-55dB,atrim=end=${TOTAL},volume=-5dB,afade=t=in:d=0.15,afade=t=out:st=${(TOTAL - 1.3).toFixed(3)}:d=1.3[bed0]`);
graph.push(`[bed0][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=450:makeup=1[bed]`);
graph.push(`[vo][sfx][bed]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[aout]`);

mkdirSync(dirname(OUT), { recursive: true });
ffmpeg(...inputs, '-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', TOTAL.toFixed(3),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT);
// A cover: the end card, fully in.
ffmpeg('-ss', (TOTAL - 0.6).toFixed(2), '-i', OUT, '-frames:v', '1', '-q:v', '2', OUT.replace(/\.mp4$/, '.jpg'));
// The words for the upload, and the captions as a subtitle file (YouTube can show them as real captions too).
const stamp = (t: number) => { const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
writeFileSync(OUT.replace(/\.mp4$/, '.srt'), LINES.map((l, i) => `${i + 1}\n${stamp(lineAt.get(l.id)!)} --> ${stamp(lineAt.get(l.id)! + voiced.get(l.id)!.seconds)}\n${say(l.text)}\n`).join('\n'));
writeFileSync(join(dirname(OUT), 'upload.md'), [
  '# Shape Tower Short: upload text', '', '## Title', '', UPLOAD.title, '', '## Description', '', ...UPLOAD.description, '', UPLOAD.tags.join(' '), '',
  '## Voiceover', '', ...LINES.map(l => `- ${say(l.text)}`), '',
  `Voice: Kokoro "${VOICE.voice}" (open source, Apache 2.0), made on our own machine. Music and sounds: the game's own.`, '',
].join('\n'));
copyFileSync(join(voiceDir, 'voice.json'), join(WORK, 'voice.json'));
if (problems.length) console.log(`PROBLEMS:\n  ${problems.join('\n  ')}`);
console.log(`done: ${OUT} (${TOTAL.toFixed(1)} s)`);
