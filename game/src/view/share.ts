// The run summary's share button (launch marketing plan, "The Daily Tower as the share hook"): Art's share
// card of the whole tower (bakeShareCard with the panorama) and the Wordle-style text line with its link
// (meta/share.ts). In the phone apps it opens the phone's share sheet with both; a browser uses its own
// share sheet, or copies the text when it has none (the game page inside claude.ai).

import { bakeShareCard, type PanoramaData, type ShareCardData } from '@art/index.ts';
import { shareText, type ShareRun } from '../meta/share.ts';
import type { Sim } from '../sim/sim.ts';
import { isNativeApp, nativeShare } from '../native.ts';

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

/** The tower as the run left it, for the card's panorama: every piece still standing and every foundation. */
export function towerOf(sim: Sim, bestBefore: number): PanoramaData {
  const base = sim.foundations[0]?.top ?? 0;
  return {
    pieces: sim.pieceViews().filter(p => p.state !== 'lost' && p.state !== 'controlled')
      .map(p => ({ shape: p.shape, x: p.x, y: p.y, angle: Math.atan2(p.s, p.c), stone: p.state === 'stone' })),
    slabs: sim.foundationViews().map(f => ({ x: f.x, top: f.top, width: f.width, grade: f.grade })),
    top: sim.stats.maxHeight,
    pb: bestBefore > 0 ? bestBefore + base : undefined,
  };
}

/** Whether this copy of the game can share at all: the phone apps, or a browser with a share sheet or a clipboard. */
export function canShare(): boolean {
  if (isNativeApp()) return true;
  return typeof navigator !== 'undefined' && (typeof navigator.share === 'function' || typeof navigator.clipboard?.writeText === 'function');
}

const toBlob = (cv: HTMLCanvasElement): Promise<Blob | null> => new Promise(r => cv.toBlob(r, 'image/png'));

async function copy(text: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Bakes the card and shares it with the text line. */
export async function shareRun(run: ShareRun, card: ShareCardData): Promise<ShareOutcome> {
  const text = shareText(run);
  // The card's lettering needs the game's fonts, which the menu has long since loaded.
  await document.fonts?.ready;
  const cv = bakeShareCard(card);
  if (isNativeApp()) return (await nativeShare(text, cv.toDataURL('image/png').split(',')[1])) ? 'shared' : 'cancelled';
  if (typeof navigator.share !== 'function') return copy(text);
  const blob = await toBlob(cv);
  const file = blob ? new File([blob], 'shape-tower.png', { type: 'image/png' }) : null;
  try {
    await navigator.share(file && navigator.canShare?.({ files: [file] }) ? { text, files: [file] } : { text });
    return 'shared';
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
    // A share sheet the page isn't allowed to use (inside another site's frame): copy the text instead.
    return copy(text);
  }
}

/** The line under the summary's buttons after a share. */
export function shareNote(o: ShareOutcome): string | null {
  return { shared: null, cancelled: null, copied: 'Copied! Paste it to a friend.', failed: "Couldn't share from here." }[o];
}
