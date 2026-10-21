// The logo (art-direction.md §8.5): "SHAPE" stacked on "TOWER" in chunky letter tiles, each tile a
// Blockling cell in a shape color tilted a few degrees as if stacked, with a Blockling peeking out from
// behind the O. logoElement() builds it for the DOM, where the letters drop in one by one with a squash;
// bakeLogo() draws it still into a canvas (splash, share card). The letters are vector outlines, not text,
// so the logo never waits on a font and looks the same in every browser.

import { INK } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { part, rrPath } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';

interface Tile { ch: string; key: string; deg: number }

/** Letters, their shape colors and tilts, row by row. The O of TOWER has the peeking Blockling. */
export const LOGO_ROWS: Tile[][] = [
  [{ ch: 'S', key: 'S', deg: -4 }, { ch: 'H', key: 'I', deg: 3 }, { ch: 'A', key: 'O', deg: -2 }, { ch: 'P', key: 'T', deg: 4 }, { ch: 'E', key: 'L', deg: -3 }],
  [{ ch: 'T', key: 'Z', deg: 3 }, { ch: 'O', key: 'J', deg: -3 }, { ch: 'W', key: 'Domino', deg: 2 }, { ch: 'E', key: 'S', deg: -4 }, { ch: 'R', key: 'I', deg: 3 }],
];

/**
 * The letters as outlines from Fredoka Bold (SIL Open Font License 1.1), in thousandths of an em with y down
 * and the origin at the middle of the capital. Drawn as paths so no tile can bake with a fallback font or a
 * missing glyph: the W went missing on Blake's Android phone (2026-10-21) when it was drawn as text.
 */
const GLYPHS: Record<string, string> = {
  S: 'M0 369Q-61 369 -104 354Q-146 339 -173 318Q-200 298 -214 281Q-228 264 -231 260Q-251 235 -256 215Q-260 195 -250 175Q-239 155 -214 131Q-191 109 -169 106Q-147 104 -126 116Q-104 128 -84 151Q-60 178 -43 188Q-26 197 -4 197Q23 197 40 190Q57 184 65 170Q73 157 73 136Q73 119 56 110Q39 100 12 93Q-16 86 -50 78Q-84 69 -117 55Q-137 47 -156 35Q-175 23 -192 8Q-208 -8 -220 -30Q-232 -51 -238 -78Q-245 -105 -245 -139Q-245 -200 -214 -248Q-184 -296 -130 -324Q-77 -352 -9 -352Q40 -352 75 -344Q110 -336 132 -325Q155 -314 167 -304Q179 -295 182 -292Q215 -262 218 -240Q221 -219 194 -179Q164 -136 135 -130Q106 -125 68 -149Q60 -155 52 -162Q44 -170 30 -176Q17 -181 -10 -181Q-20 -181 -30 -178Q-40 -174 -47 -168Q-54 -163 -58 -155Q-63 -147 -63 -138Q-63 -117 -47 -106Q-31 -94 -4 -88Q22 -82 54 -76Q86 -70 119 -60Q146 -51 171 -37Q196 -23 215 -1Q234 21 246 54Q257 86 257 133Q257 198 232 244Q207 289 168 316Q128 344 84 356Q39 369 0 369Z',
  H: 'M205 358Q160 358 141 344Q122 331 118 310Q114 288 114 266V-250Q114 -272 118 -293Q122 -314 141 -328Q160 -341 206 -341Q252 -341 270 -328Q289 -314 293 -293Q297 -272 297 -249V267Q297 289 293 310Q289 331 270 344Q251 358 205 358ZM-206 358Q-251 358 -270 344Q-289 331 -293 310Q-297 288 -297 266V-250Q-297 -272 -293 -293Q-289 -314 -270 -328Q-251 -341 -205 -341Q-159 -341 -140 -328Q-122 -314 -118 -293Q-114 -272 -114 -249V267Q-114 289 -118 310Q-122 331 -141 344Q-160 358 -206 358ZM-130 87V-69H130V87Z',
  A: 'M334 232Q350 262 350 283Q352 304 338 320Q324 336 292 352Q244 375 218 366Q192 358 170 309L0 -39L-168 310Q-192 357 -218 366Q-244 374 -292 351Q-322 336 -337 320Q-352 304 -350 283Q-350 262 -334 232L-84 -288Q-72 -312 -48 -326Q-24 -341 0 -341Q18 -341 34 -334Q50 -328 62 -316Q76 -304 84 -287ZM-158 214 -82 58H82L158 214Z',
  P: 'M-172 358Q-216 358 -236 344Q-254 331 -258 310Q-262 288 -262 266V-250Q-262 -272 -258 -293Q-254 -314 -236 -328Q-216 -341 -170 -341H28Q66 -341 110 -326Q154 -310 194 -278Q234 -246 258 -198Q284 -150 284 -84Q284 -19 258 29Q234 77 194 108Q154 140 110 156Q66 171 28 171H-80V267Q-80 289 -84 310Q-88 331 -106 344Q-126 358 -172 358ZM-80 -12H28Q42 -12 58 -18Q76 -25 88 -41Q102 -57 102 -85Q102 -106 92 -122Q82 -139 65 -148Q48 -158 28 -158H-80Z',
  E: 'M-172 359Q-218 359 -236 346Q-256 332 -260 310Q-264 289 -264 267V-250Q-264 -302 -243 -322Q-222 -341 -170 -341H196Q220 -341 240 -337Q260 -333 274 -314Q288 -295 288 -249Q288 -204 274 -185Q260 -166 240 -162Q218 -158 196 -158H-80V-69H104Q128 -69 146 -66Q164 -62 174 -46Q186 -30 186 10Q186 48 174 64Q164 81 144 84Q126 87 102 87H-80V176H196Q220 176 240 180Q260 184 274 203Q288 222 288 268Q288 313 274 332Q260 351 240 355Q218 359 196 359Z',
  T: 'M229 -342Q248 -342 265 -339Q282 -336 294 -320Q305 -304 305 -265Q305 -227 294 -210Q282 -194 264 -191Q247 -188 228 -188H90V270Q90 292 86 312Q82 333 64 346Q45 359 -1 359Q-45 359 -64 346Q-83 332 -86 312Q-90 291 -90 269V-188H-229Q-247 -188 -264 -192Q-282 -195 -294 -211Q-305 -227 -305 -266Q-305 -304 -294 -320Q-282 -336 -264 -339Q-246 -342 -228 -342Z',
  O: 'M4 370Q-68 370 -132 342Q-196 315 -244 266Q-292 217 -319 152Q-346 88 -346 15Q-346 -61 -320 -127Q-294 -193 -246 -243Q-200 -293 -137 -321Q-74 -349 -4 -349Q70 -349 133 -322Q196 -294 244 -245Q292 -196 320 -130Q346 -65 346 11Q346 85 320 150Q294 215 246 264Q198 314 137 342Q76 370 4 370ZM0 187Q34 187 64 174Q94 160 116 136Q138 113 151 80Q164 48 164 11Q164 -26 150 -58Q138 -90 115 -114Q92 -139 63 -152Q34 -166 0 -166Q-34 -166 -63 -152Q-92 -139 -115 -114Q-138 -90 -150 -58Q-164 -26 -164 11Q-164 47 -150 79Q-138 111 -115 136Q-92 160 -63 174Q-34 187 0 187Z',
  W: 'M-184 358Q-216 358 -234 345Q-252 332 -260 316Q-268 301 -270 296L-450 -220Q-464 -270 -454 -294Q-444 -319 -392 -336Q-358 -347 -336 -346Q-316 -345 -302 -329Q-288 -313 -276 -279L-172 25L-90 -274Q-88 -284 -80 -300Q-72 -316 -54 -328Q-36 -341 -2 -341Q36 -341 54 -327Q72 -313 80 -297Q86 -281 90 -273L172 27L276 -279Q286 -312 300 -328Q314 -345 336 -347Q358 -349 392 -337Q428 -324 442 -310Q458 -295 458 -274Q458 -253 448 -220L270 296Q268 302 260 317Q252 332 234 345Q216 358 182 358Q148 358 130 342Q110 327 102 310Q94 294 94 291L0 -17L-94 290Q-96 295 -104 312Q-112 328 -130 343Q-148 358 -184 358Z',
  R: 'M-176 358Q-221 358 -240 344Q-259 331 -263 310Q-267 288 -267 266V-250Q-267 -272 -263 -293Q-259 -314 -240 -328Q-221 -341 -175 -341H26Q64 -341 108 -326Q152 -310 191 -278Q230 -246 255 -198Q280 -150 280 -84Q280 -38 266 2Q253 42 226 74Q200 107 162 132Q125 156 77 170H-84V267Q-84 289 -88 310Q-92 331 -111 344Q-130 358 -176 358ZM243 334Q198 368 172 362Q146 355 116 315L-68 65L140 39L264 206Q284 235 290 255Q295 275 284 293Q273 311 243 334ZM-84 -12H26Q35 -12 48 -16Q60 -19 71 -28Q82 -36 90 -50Q97 -64 97 -85Q97 -106 87 -122Q77 -139 60 -148Q44 -158 24 -158H-84Z',
};
let glyphPaths: Map<string, Path2D> | undefined;
function glyph(ch: string): Path2D {
  glyphPaths ??= new Map(Object.entries(GLYPHS).map(([k, d]) => [k, new Path2D(d)]));
  return glyphPaths.get(ch)!;
}

/** One letter tile, u px wide, centred at the origin, unrotated. */
function drawTile(c: Ctx, t: Tile, u: number): void {
  const s = ART_SHAPES[t.key];
  c.save(); c.scale(u, u);
  part(c, rrPath(-0.46, -0.46, 0.92, 0.92, 0.2), s.base, s.light, s.shade, 0.08);
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill(rrPath(-0.33, -0.33, 0.24, 0.1, 0.05));
  c.restore();
  // 0.7 tiles to the em, the capital centred a touch below the middle, as the text used to sit.
  const k = (0.7 * u) / 1000, p = glyph(t.ch);
  c.save(); c.translate(0, 0.018 * u); c.scale(k, k);
  c.lineJoin = 'round'; c.lineWidth = (0.12 * u) / k; c.strokeStyle = INK; c.stroke(p);
  c.fillStyle = '#FFFFFF'; c.fill(p);
  c.restore();
}

/** The Blockling that peeks out from behind the O: a Butterblock head looking left, u px wide. */
function drawPeeker(c: Ctx, u: number): void {
  const s = ART_SHAPES.O;
  c.save(); c.scale(u, u);
  part(c, rrPath(-0.4, -0.4, 0.8, 0.8, 0.2), s.base, s.light, s.shade, 0.08);
  c.fillStyle = INK;
  for (const ex of [-0.2, 0.06]) { c.beginPath(); c.ellipse(ex, -0.14, 0.07, 0.09, 0, 0, TAU); c.fill(); }
  c.fillStyle = '#FFFFFF';
  for (const ex of [-0.2, 0.06]) { c.beginPath(); c.arc(ex - 0.03, -0.18, 0.028, 0, TAU); c.fill(); }
  c.restore();
}

function bake(w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const cv = makeCanvas(w, h); draw(ctx2d(cv)); return cv;
}

const cached = (key: string, make: () => HTMLCanvasElement): string => canvasUrl(`logo:${key}`, make);

/** A letter tile as a PNG URL, `cssPx` square. Row r, column i of LOGO_ROWS. */
export function logoTileUrl(r: number, i: number, cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr), t = LOGO_ROWS[r][i];
  return cached(`${r}${i}:${px}`, () => bake(px, px, c => { c.translate(px / 2, px / 2); drawTile(c, t, px); }));
}

export function logoPeekerUrl(cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr);
  return cached(`peek:${px}`, () => bake(px, px, c => { c.translate(px / 2, px / 2); drawPeeker(c, px); }));
}

/**
 * The logo as DOM: two rows of letter tiles that drop in one by one with a squash, then the Blockling
 * peeks out. `tile` is the tile size in CSS px (default 58). `still` skips the animation (Reduce Motion).
 * Needs uiCss() on the page.
 */
export function logoElement(o: { tile?: number; still?: boolean } = {}): HTMLElement {
  const tile = o.tile ?? 58, root = document.createElement('div');
  root.className = `ui ui-logo${o.still ? ' ui-still' : ''}`;
  root.style.setProperty('--tile', `${tile}px`);
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Shape Tower');
  let n = 0;
  LOGO_ROWS.forEach((row, r) => {
    const div = document.createElement('div');
    div.className = 'ui-logo-row';
    row.forEach((t, i) => {
      const img = document.createElement('img');
      img.className = 'ui-logo-tile'; img.alt = ''; img.src = logoTileUrl(r, i, tile);
      img.style.setProperty('--i', String(n++)); img.style.setProperty('--r', `${t.deg}deg`);
      if (t.ch === 'O') {
        const wrap = document.createElement('span');
        wrap.className = 'ui-logo-o';
        const peek = document.createElement('img');
        peek.className = 'ui-logo-peek'; peek.alt = ''; peek.src = logoPeekerUrl(tile * 0.62);
        wrap.append(peek, img); div.appendChild(wrap);
      } else div.appendChild(img);
    });
    root.appendChild(div);
  });
  return root;
}

/** The whole logo drawn still into a canvas `width` px wide (splash, share card). */
export function bakeLogo(width: number): HTMLCanvasElement {
  const u = width / 5.9, gap = u * 0.04, w = width, h = u * 2.5;
  return bake(w, h, c => {
    LOGO_ROWS.forEach((row, r) => {
      const x0 = (w - (row.length * (u + gap) - gap)) / 2 + (r ? u * 0.28 : -u * 0.08), y = u * 0.75 + r * (u + gap);
      row.forEach((t, i) => {
        const x = x0 + i * (u + gap) + u / 2;
        if (t.ch === 'O') { c.save(); c.translate(x + u * 0.3, y - u * 0.42); c.rotate(0.18); drawPeeker(c, u * 0.62); c.restore(); }
        c.save(); c.translate(x, y); c.rotate((t.deg * Math.PI) / 180); drawTile(c, t, u); c.restore();
      });
    });
  });
}
