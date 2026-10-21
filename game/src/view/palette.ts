// Signal colours and copy the view uses directly (art-direction.md §3). Pieces, guide, slabs and
// sky come from the art kit in ../art.

export const INK = '#22183A';
export const INK_SOFT = '#5B4F7A';
export const PAPER = '#FFF7E8';
export const GOLD = '#FFC23D';
export const MINT = '#3EE6A8';
export const AMBER = '#FFAA2B';
export const DANGER = '#FF4D6D';
export const XP_VIOLET = '#7A5CFF';
export const STONE = '#B9B1A6';

export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
export const num = (h: string): number => parseInt(h.slice(1), 16);

export const BIOME_TITLES = ['THE MEADOW', 'THE TREETOPS', 'THE CLOUDS', 'THE STORM BELT', 'THE STRATOSPHERE', 'ORBIT', 'THE MOON', 'THE RED PLANET', 'THE RINGED GIANT', 'DEEP COSMOS'];

/** Shape colours used for confetti. */
export const CONFETTI = [0x33c3f0, 0xffcc33, 0xa35cff, 0xff9a2e, 0x4a72ff, 0x5ed15a, 0xff4f64, 0xe84fd0];
