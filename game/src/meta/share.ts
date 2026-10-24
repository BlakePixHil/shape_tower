// Sharing a run (launch marketing plan, "The Daily Tower as the share hook"): the text line that goes
// with Art's share card, Wordle style, and the short link back to the game. Pure functions, so they run
// in Node for tests. Public copy: never name other games (no trademarks).

import { biomeFor } from '../sim/tuning.ts';

/**
 * Where share links point: the landing page on our Cloudflare server (online/cloudflare/landing.ts),
 * which sends phones to the right store. One place to change when the game gets its own domain.
 */
export const SHARE_BASE = 'https://shape-tower.shape-tower.workers.dev';

/** One square per claimed checkpoint, coloured by its biome (1 = Meadow ... 10 = Deep Cosmos). */
export const BIOME_SQUARES = ['', '🟩', '🟫', '⬜', '🟪', '🟦', '⬛', '🟨', '🟥', '🟧', '⭐'];
/** Squares per row, and the most rows before the rest is a count. */
const ROW = 10;
const ROWS = 3;

export type ShareMode = 'endless' | 'daily' | 'zen';

export interface ShareRun {
  mode: ShareMode;
  /** Best height this run, in metres above the plinth. */
  height: number;
  checkpoints: number;
  newBest?: boolean;
  /** Daily #N (the Daily only). */
  daily?: number;
  /** A Daily practice run, not the day's one scored try: the text says so. */
  practice?: boolean;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const metres = (h: number): string => `${(Math.max(0, Math.floor(h * 10 + 1e-6)) / 10).toFixed(1)} m`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The checkpoints as rows of squares: one per claim, in its biome's colour; past the last row, "+N". */
export function checkpointSquares(checkpoints: number): string {
  const n = Math.max(0, Math.floor(checkpoints));
  const shown = Math.min(n, ROW * ROWS);
  const rows: string[] = [];
  for (let i = 0; i < shown; i += ROW) {
    let row = '';
    for (let c = i + 1; c <= Math.min(shown, i + ROW); c++) row += BIOME_SQUARES[biomeFor(c).id];
    rows.push(row);
  }
  if (n > shown) rows[rows.length - 1] += ` +${n - shown}`;
  return rows.join('\n');
}

/** The link that goes with a run: the Daily's own page (with the height to beat), or the game's. */
export function shareLink(r: ShareRun, base = SHARE_BASE): string {
  const h = `h=${(Math.floor(Math.max(0, r.height) * 10 + 1e-6) / 10).toFixed(1)}`;
  return r.mode === 'daily' && r.daily ? `${base}/d/${r.daily}?${h}` : `${base}/?${h}`;
}

/** The headline: "Shape Tower Daily #47: 38.2 m, 9 checkpoints". */
export function shareHeadline(r: ShareRun): string {
  const cps = plural(r.checkpoints, 'checkpoint');
  if (r.mode === 'daily') return `Shape Tower Daily #${r.daily}${r.practice ? ' (practice)' : ''}: ${metres(r.height)}, ${cps}`;
  if (r.mode === 'zen') return `Shape Tower Zen: ${metres(r.height)}, ${cps}`;
  return `Shape Tower: ${metres(r.height)}, ${cps}${r.newBest ? ' (new best!)' : ''}`;
}

/** The whole text that goes with the card: headline, the squares (when there are any), then the link. */
export function shareText(r: ShareRun, base = SHARE_BASE): string {
  const squares = checkpointSquares(r.checkpoints);
  return [shareHeadline(r), squares, shareLink(r, base)].filter(Boolean).join('\n');
}

/** The postmark on the card: "DAILY #47" for the Daily, else the date ("24 OCT 2026"). */
export function sharePostmark(r: ShareRun, now = new Date()): string {
  if (r.mode === 'daily' && r.daily) return `DAILY #${r.daily}`;
  return `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}
