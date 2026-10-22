// Baked images as cached PNG URLs for the DOM (<img> and CSS). Asking for one the first time bakes it
// and encodes it in that frame (issue #33), so they're baked on the CPU, where reading them back for the
// PNG doesn't wait on the GPU, and warmUrls bakes them ahead: one per idle slice, encoded with toBlob,
// which runs off the main thread.

import { cpuBaked } from './util.ts';

export type UrlMaker = () => HTMLCanvasElement;

const urls = new Map<string, string>();
/** While warmUrls collects its list: what the *Url helpers asked for. */
let collecting: Map<string, UrlMaker> | null = null;

/** The cached URL for `key`, baked with `make` and encoded right now if it isn't cached yet. */
export function canvasUrl(key: string, make: UrlMaker): string {
  const u = urls.get(key);
  if (u) return u;
  if (collecting) { collecting.set(key, make); return ''; }
  const v = cpuBaked(make).toDataURL('image/png');
  urls.set(key, v);
  return v;
}

/**
 * Like canvasUrl, but a short `blob:` URL instead of a data URL, for images repeated down a list (a
 * ladder's portraits): the page's HTML stays small however many rows use one. It lives as long as the page.
 */
export function canvasBlobUrl(key: string, make: UrlMaker): string {
  const u = urls.get(key);
  if (u) return u;
  if (collecting) { collecting.set(key, make); return ''; }
  const data = cpuBaked(make).toDataURL('image/png');
  let v = data;
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const bin = atob(data.slice(data.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    v = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  }
  urls.set(key, v);
  return v;
}

/**
 * Bakes ahead every image that `ask` asks for by calling *Url helpers (they return '' meanwhile), one
 * per idle slice, encoding each off the main thread. Resolves once they're all cached. One asked for
 * before then is baked on the spot, as it would be without warming.
 */
export function warmUrls(ask: () => void): Promise<void> {
  const asked = new Map<string, UrlMaker>();
  collecting = asked;
  try { ask(); } finally { collecting = null; }
  const list = [...asked];
  return new Promise(done => {
    let i = 0, open = 0, baked = false;
    const finish = () => { if (baked && !open) done(); };
    const step = (dl?: IdleDeadline) => {
      do {
        if (i >= list.length) { baked = true; finish(); return; }
        const [key, make] = list[i++];
        if (urls.has(key)) continue;
        const cv = cpuBaked(make);
        if (!cv.toBlob) { urls.set(key, cv.toDataURL('image/png')); continue; }
        open++;
        cv.toBlob(b => {
          open--;
          if (!urls.has(key)) urls.set(key, b ? URL.createObjectURL(b) : cv.toDataURL('image/png'));
          finish();
        }, 'image/png');
      } while (dl && dl.timeRemaining() > 8);
      idle(step);
    };
    idle(step);
  });
}

function idle(f: (dl?: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(f);
  else setTimeout(f, 20);
}
