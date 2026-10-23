// Small shared helpers: math, color (sRGB <-> OKLab), and Canvas 2D primitives.

export type Ctx = CanvasRenderingContext2D;

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Deterministic 0..1 noise, so baked art is identical on every run. */
export const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---- color ----

export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgba(hex: string, a: number): string { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
/** '#RRGGBB' -> 0xRRGGBB, for Phaser tints. */
export const hexNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

const toLin = (c: number): number => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (c: number): number => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(clamp(c, 0, 1) * 255); };

export type Lab = [number, number, number];
export function oklab(hex: string): Lab {
  const [r, g, b] = rgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
export function labToHex([L, a, b]: Lab): string {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  const r = toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bb = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return '#' + [r, g, bb].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export const mixLab = (a: Lab, b: Lab, t: number): Lab => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** The angle a cosmetic's variant `v` turns its hues by: the golden angle, so neighbouring variants differ most. */
export const variantTurn = (v: number): number => v * 2.39996;

/** `hex` with its hue turned `rad` radians in OKLab (lightness and chroma kept). */
export function turnHex(hex: string, rad: number): string {
  if (!rad) return hex;
  const [L, a, b] = oklab(hex), co = Math.cos(rad), si = Math.sin(rad);
  return labToHex([L, a * co - b * si, a * si + b * co]);
}

const LIN = Array.from({ length: 256 }, (_, i) => toLin(i));
/**
 * Turn the hues of everything drawn on a canvas by `rad` radians (OKLab), for a cosmetic's later variants.
 * Ink, greys and whites stay put (too dark or too grey to have a hue worth turning). Read back from the
 * CPU: call it on canvases made inside cpuBaked.
 */
export function turnCanvas(cv: HTMLCanvasElement, rad: number): void {
  if (!rad) return;
  const c = ctx2d(cv), img = c.getImageData(0, 0, cv.width, cv.height), d = img.data, co = Math.cos(rad), si = Math.sin(rad);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = LIN[d[i]], g = LIN[d[i + 1]], b = LIN[d[i + 2]];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    if (L < 0.36 || A * A + B * B < 0.0022) continue;
    const a2 = A * co - B * si, b2 = A * si + B * co;
    const l3 = Math.pow(L + 0.3963377774 * a2 + 0.2158037573 * b2, 3), m3 = Math.pow(L - 0.1055613458 * a2 - 0.0638541728 * b2, 3), s3 = Math.pow(L - 0.0894841775 * a2 - 1.2914855480 * b2, 3);
    d[i] = toSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
    d[i + 1] = toSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
    d[i + 2] = toSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3);
  }
  c.putImageData(img, 0, 0);
}

/** 1 -> 'I', 14 -> 'XIV'. */
export function roman(n: number): string {
  const r: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, t] of r) while (n >= v) { s += t; n -= v; }
  return s;
}

// ---- canvas ----

/** A fresh canvas of at least 1x1 px. Phaser's addCanvas needs a real HTMLCanvasElement. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
export function ctx2d(c: HTMLCanvasElement): Ctx {
  const x = c.getContext('2d', cpuBaking ? { willReadFrequently: true } : undefined);
  if (!x) throw new Error('Canvas 2D is not available');
  return x;
}

let cpuBaking = 0;
/**
 * Runs `bake` with every canvas it makes kept in CPU memory (willReadFrequently). Reading such a canvas
 * back (toDataURL, toBlob, getImageData) is a copy; reading back a GPU canvas waits for the GPU, which
 * took 55 to 245 ms per small icon in the headless game. Small images drawn this way cost about the same.
 */
export function cpuBaked<T>(bake: () => T): T {
  cpuBaking++;
  try { return bake(); } finally { cpuBaking--; }
}

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
export function circ(c: Ctx | Path2D, x: number, y: number, r: number): void { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
export function star4(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath(); c.moveTo(x, y - r);
  c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
}
