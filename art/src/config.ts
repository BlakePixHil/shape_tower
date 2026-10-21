// Art tokens and juice timings (art-direction.md §3, §5, §7). The single source for every art number;
// art-config.json is generated from this file for tools that can't import TypeScript.

export const INK = '#22183A';
export const INK_SOFT = '#5B4F7A';
export const PAPER = '#FFF7E8';

/** UI fonts (§8.1). Load Fredoka and Nunito before baking anything with text, or the fallback is baked in. */
export const FONT_DISPLAY = '"Fredoka", "Nunito", ui-rounded, system-ui, sans-serif';
export const FONT_BODY = '"Nunito", ui-rounded, system-ui, sans-serif';

/** Signal colors always travel with a glyph (§3.3). */
export const SIGNAL = {
  gold: '#FFC23D',
  mint: '#3EE6A8',
  amber: '#FFAA2B',
  danger: '#FF4D6D',
  xp: '#7A5CFF',
} as const;

export type GuideState = 'stable' | 'risky' | 'tip' | 'miss';

/** Landing-guide tint per state (§5.2). Perfect fit adds a gold shimmer on top of the state tint. */
export const GUIDE_TINT: Record<GuideState, string> = {
  stable: '#FFFFFF',
  risky: SIGNAL.amber,
  tip: SIGNAL.danger,
  miss: SIGNAL.danger,
};

export const ART = {
  /** Drawn corner radius in blocks. Must equal the physics collider radius (§4.2, Gameplay tuning). */
  cornerRadius: 0.05,

  /** Piece construction, in fractions of a block (§4.1). */
  piece: {
    outline: 0.14,        // stroke width; half sits outside the cell edge
    lightLip: 0.09,       // bright band along top edges
    shadeLip: 0.13,       // dark band along bottom edges
    seamInset: 0.22,      // seams between cells stop this far from the cell corners
    shadow: { x: 0.03, y: 0.09, alpha: 0.2 },
    rimWidth: 0.11,       // space rim: extra stroke width, so about 2 pt shows outside the outline (§6.4)
    rimAlpha: 0.55,
    glassAlpha: 0.9,
    faceMinCellPx: 28,    // below this, faces drop cheeks, highlights and sweat (§2)
  },

  /** Stone look for claimed pieces and Solid Rows (§4.4). */
  stone: { desaturate: 0.78, warm: '#C4BAAC', warmAlpha: 0.5, grain: 'rgba(80,68,56,0.22)' },

  faces: {
    blinkEvery: [3, 6] as [number, number], // seconds, random per piece
    blinkLength: 0.13,
    impactHold: 0.15,                       // seconds the squeezed face stays after a hard landing
    tensionWorried: 0.3,
    tensionSweat: 0.6,
    tensionPanic: 0.85,
    liveRows: 10,                           // only pieces in the top ~10 blocks animate expressions
    pupilSpring: { stiffness: 260, damping: 14 },
  },

  guide: {
    beamFillTop: 0.2,
    beamFillBottom: 0.06,
    beamEdgeAlpha: 0.4,
    chevronSpacing: 0.69,   // blocks between chevrons (22 pt at 32 pt per block)
    chevronSpeed: 1.9,      // blocks per second, flowing down (60 pt/s)
    ghostFill: 0.22,
    pulseHz: 1.2,
    pulseMin: 0.55,
    pulseMax: 0.85,
    tipRockDeg: 3,
    tipRockHz: 1.1,
    fadeNear: 1.5,          // the ghost fades out when the piece is within this many blocks
    shimmerSeconds: 1.55,   // one gold sweep across a perfect-fit ghost
    tintHysteresisMs: 100,  // owned by Gameplay; listed so everyone uses the same number
  },

  juice: {
    spawnPop: { ms: 220, overshoot: 1.1 },
    rotateSnapMs: 80,
    dropStretch: { x: 0.92, y: 1.12 },
    landSquash: { max: 0.15, inMs: 60, recoverMs: 220 },
    rippleRowDelayMs: 30,
    perfectMs: 700,
    clutchSlowmo: 0.4,
    lostSlowmo: 0.35,
    hitstopMs: { solidRow: 50, checkpoint: 90 },
    shake: { maxOffsetPt: 8, maxRotDeg: 1, decayPerSec: 1.6 },
    breathe: { amount: 0.01, hz: 0.5 },
    solidCellMs: 20,        // Solid Row cells turn to stone left to right
    claimSlowmo: { scale: 0.5, ms: 300 },
    claimFlash: { alpha: 0.2, ms: 60 },
    particlesMax: 250,
  },
} as const;
