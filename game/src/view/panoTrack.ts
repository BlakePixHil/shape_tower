// The run-over panorama's camera path. Blake (2026-11-02): "if it's built crooked, the tower gets cut
// off. The camera needs to track down the mid point of all the shapes (smoothly) so you can see the
// full tower even if it's crooked." So for every camera height on the glide down, the path holds the
// middle of everything on screen at that height and how wide the view must be to hold all of it, then
// smooths both so the camera eases sideways (and out, for a lean wider than the screen) instead of
// jumping. Pure numbers, no Phaser, so tests/pano-check.ts checks it in Node.

/** Something to keep in frame: world blocks, y up, with its margin already added. */
export interface PanoBox { x0: number; x1: number; y0: number; y1: number }

export interface PanoTrackOpts {
  /** Screen height over width: the view is `across * aspect` blocks tall. */
  aspect: number;
  /** The fewest blocks across: the camera never zooms in past this. */
  minAcross: number;
  /** The most blocks across: a lean wider than this keeps its middle in frame. */
  maxAcross: number;
  /** Where the camera looks when nothing at all is in view. */
  fallbackX: number;
  /** Camera heights between samples, blocks. */
  step?: number;
}

export interface PanoTrack {
  /** The lowest sampled camera height, and the spacing. */
  y0: number;
  step: number;
  /** Camera x and blocks across at each sample. */
  x: Float64Array;
  across: Float64Array;
}

const BAND = 0.25; // height bands for the tower's left and right edges, blocks

/**
 * The camera path for heights yLo..yHi. Sideways moves and zoom are smoothed over about half a screen
 * of the glide, and the zoom always fits the middle it settled on.
 */
export function panoTrack(boxes: readonly PanoBox[], yLo: number, yHi: number, o: PanoTrackOpts): PanoTrack {
  const step = o.step ?? 0.25;
  const n = Math.max(1, Math.floor((yHi - yLo) / step) + 2);
  const halfMax = (o.maxAcross * o.aspect) / 2;
  // The tower's left and right edges in each height band, over every height a view can see.
  const b0 = yLo - halfMax - 1, nb = Math.ceil((yHi + halfMax + 1 - b0) / BAND) + 1;
  const left = new Float64Array(nb).fill(Infinity), right = new Float64Array(nb).fill(-Infinity);
  for (const b of boxes) {
    const i0 = Math.max(0, Math.floor((b.y0 - b0) / BAND)), i1 = Math.min(nb - 1, Math.floor((b.y1 - b0) / BAND));
    for (let i = i0; i <= i1; i++) {
      if (b.x0 < left[i]) left[i] = b.x0;
      if (b.x1 > right[i]) right[i] = b.x1;
    }
  }
  const minT = sparse(left, Math.min), maxT = sparse(right, Math.max);
  const range = (lo: number, hi: number): [number, number] => {
    const i0 = Math.max(0, Math.floor((lo - b0) / BAND)), i1 = Math.min(nb - 1, Math.floor((hi - b0) / BAND));
    return i1 < i0 ? [Infinity, -Infinity] : [query(minT, i0, i1, Math.min), query(maxT, i0, i1, Math.max)];
  };

  // Raw: at each camera height, widen the view until everything it shows fits (a wider view is a
  // taller one, so it can take in more), and aim at the middle of that.
  const L = new Float64Array(n), R = new Float64Array(n), mid = new Float64Array(n), need = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const y = yLo + i * step;
    let a = o.minAcross, l = Infinity, r = -Infinity;
    for (let k = 0; k < 8; k++) {
      [l, r] = range(y - (a * o.aspect) / 2, y + (a * o.aspect) / 2);
      const want = l <= r ? clamp(r - l, o.minAcross, o.maxAcross) : o.minAcross;
      if (want <= a + 1e-6) break;
      a = want;
    }
    L[i] = l; R[i] = r; mid[i] = l <= r ? (l + r) / 2 : NaN; need[i] = a;
  }
  fillGaps(mid, o.fallbackX);

  // Smooth: the middle over about a quarter screen each way, twice (a soft triangle).
  const kx = Math.max(1, Math.round((o.minAcross * o.aspect) / 4 / step));
  const x = blur(blur(mid, kx), kx);
  // The width that holds everything around that smoothed middle, then smoothed itself over about the
  // same reach. Taking the most over the blurs' whole reach first means the blurred width never drops
  // below what a height needs. A wider view is a taller one that can take in more of a lean, so each
  // height is checked again with the view it ended up with, until every one fits.
  const ka = kx;
  const fit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const half = L[i] <= R[i] ? Math.max(x[i] - L[i], R[i] - x[i]) : 0;
    fit[i] = clamp(Math.max(need[i], 2 * half), o.minAcross, o.maxAcross);
  }
  const smooth = (): Float64Array => blur(blur(maxFilter(fit, 2 * ka), ka), ka);
  let across = smooth();
  for (let pass = 0; pass < 6; pass++) {
    let grew = false;
    for (let i = 0; i < n; i++) {
      const y = yLo + i * step, [l, r] = range(y - (across[i] * o.aspect) / 2, y + (across[i] * o.aspect) / 2);
      if (l > r) continue;
      const want = clamp(2 * Math.max(x[i] - l, r - x[i]), o.minAcross, o.maxAcross);
      if (want > fit[i] + 1e-6) { fit[i] = want; grew = true; }
    }
    if (!grew) break;
    across = smooth();
  }
  return { y0: yLo, step, x, across };
}

/** The camera at height y on the path (linear between samples, held at the ends). */
export function trackAt(t: PanoTrack, y: number): { x: number; across: number } {
  const n = t.x.length;
  const f = clamp((y - t.y0) / t.step, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  if (i < 0) return { x: t.x[0], across: t.across[0] };
  const u = f - i;
  return { x: t.x[i] + (t.x[i + 1] - t.x[i]) * u, across: t.across[i] + (t.across[i + 1] - t.across[i]) * u };
}

/**
 * Keep-in-frame boxes for a piece: each of its cells, turned with the piece. `cells` are cell centres
 * relative to the body's position (sim/shapes.ts geometry), `c`/`s` its rotation.
 */
export function pieceBoxes(out: PanoBox[], cells: readonly (readonly [number, number])[], x: number, y: number, c: number, s: number, margin: number): void {
  const h = (Math.abs(c) + Math.abs(s)) / 2; // a unit cell's half extent at this angle
  for (const [cx, cy] of cells) {
    const wx = x + c * cx - s * cy, wy = y + s * cx + c * cy;
    out.push({ x0: wx - h - margin, x1: wx + h + margin, y0: wy - h, y1: wy + h });
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Blanks (heights with nothing in view) take the nearest height's value. */
function fillGaps(v: Float64Array, fallback: number): void {
  let last = NaN;
  for (let i = 0; i < v.length; i++) { if (Number.isNaN(v[i])) v[i] = last; else last = v[i]; }
  last = NaN;
  for (let i = v.length - 1; i >= 0; i--) { if (Number.isNaN(v[i])) v[i] = last; else last = v[i]; }
  for (let i = 0; i < v.length; i++) if (Number.isNaN(v[i])) v[i] = fallback;
}

/** A moving average over i-k..i+k, over the samples that exist near the ends. */
function blur(v: Float64Array, k: number): Float64Array {
  const n = v.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
    out[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
  }
  return out;
}

/** The most over i-k..i+k. */
function maxFilter(v: Float64Array, k: number): Float64Array {
  const t = sparse(v, Math.max), out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = query(t, Math.max(0, i - k), Math.min(v.length - 1, i + k), Math.max);
  return out;
}

/** A sparse table: the min (or max) of any run of entries in two lookups. */
function sparse(v: Float64Array, f: (a: number, b: number) => number): Float64Array[] {
  const t = [v];
  for (let w = 1; 2 * w <= v.length; w *= 2) {
    const prev = t[t.length - 1], next = new Float64Array(v.length - 2 * w + 1);
    for (let i = 0; i < next.length; i++) next[i] = f(prev[i], prev[i + w]);
    t.push(next);
  }
  return t;
}

function query(t: Float64Array[], i0: number, i1: number, f: (a: number, b: number) => number): number {
  const lvl = Math.floor(Math.log2(i1 - i0 + 1));
  return f(t[lvl][i0], t[lvl][i1 - (1 << lvl) + 1]);
}
