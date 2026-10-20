// Shared types for the audio module. Event names and payloads follow the
// Gameplay section's JuiceBus contract (gameplay.md section 11.1).

export type Material = 'wood' | 'stone' | 'ice' | 'rubber' | 'jelly' | 'metal' | 'glass' | 'ground' | 'base';

export const MATERIALS: Material[] = ['wood', 'stone', 'ice', 'rubber', 'jelly', 'metal', 'glass', 'ground', 'base'];

export type BusName = 'music' | 'sfx' | 'ambience' | 'ui' | 'voices';

/** Voice-pool categories with their own caps (audio section 8.3). */
export type Category = 'impact' | 'note' | 'scrape' | 'creak' | 'ui' | 'stinger' | 'ambience' | 'misc';

/** 1 = never cut ... 5 = first to go (audio section 8.2). */
export type Priority = 1 | 2 | 3 | 4 | 5;

export type HapticsLevel = 'off' | 'light' | 'full';

/** Continuous values the game sends at 10 Hz as one `signals` event. */
export interface Signals {
  altitude: number;
  biome: number;
  checkpointProgress: number;
  tension: number;
  sway: number;
  difficultyTier: number;
  gravityScale: number;
  cameraY: number;
  /** horizontal centre of the view, in blocks */
  cameraX: number;
  /** centre of the current foundation slab, in blocks */
  foundationX: number;
  timeScale: number;
}

export const DEFAULT_SIGNALS: Signals = {
  altitude: 0,
  biome: 1,
  checkpointProgress: 0,
  tension: 0,
  sway: 0,
  difficultyTier: 0,
  gravityScale: 1,
  cameraY: 0,
  cameraX: 0,
  foundationX: 0,
  timeScale: 1,
};

/** Every JuiceBus event the director listens to. */
export const JUICE_EVENTS = [
  'signals',
  // input
  'piece_spawned', 'piece_moved', 'piece_rotated', 'soft_drop', 'hard_drop', 'hold_swap',
  // contacts
  'contact_hit', 'contact_slide',
  // placement
  'piece_landed', 'piece_settled', 'perfect', 'clutch', 'ghost_fit',
  // structure
  'bond_formed', 'bond_broken', 'row_solid', 'collapse_started',
  // losing
  'piece_lost', 'piece_gone', 'heart_lost', 'heart_restored', 'last_heart', 'budget_low', 'run_over',
  // progress
  'height_milestone', 'pb_crossed', 'checkpoint_near', 'checkpoint_hold', 'checkpoint_cancelled',
  'checkpoint_claimed', 'biome_entered', 'difficulty_tier_up',
  // hazards
  'hazard_warning', 'hazard_start', 'hazard_end',
  // feel
  'hitstop', 'slowmo',
  // run and meta
  'run_start', 'pause', 'resume', 'xp_tick', 'level_up', 'unlock',
] as const;

export type JuiceEventName = (typeof JUICE_EVENTS)[number];

/** Payloads are read defensively: unknown or missing fields fall back to defaults. */
export type Payload = Record<string, unknown> | undefined;

export function num(p: Payload, key: string, fallback = 0): number {
  const v = p?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(p: Payload, key: string, fallback = ''): string {
  const v = p?.[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

export function bool(p: Payload, key: string, fallback = false): boolean {
  const v = p?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function asMaterial(v: unknown, fallback: Material): Material {
  return typeof v === 'string' && (MATERIALS as string[]).includes(v) ? (v as Material) : fallback;
}

/** Minimal emitter shape: Phaser's EventEmitter, Node's, or Gameplay's JuiceBus all fit. */
export interface BusLike {
  on(name: string, fn: (payload?: any) => void): unknown;
  off?(name: string, fn: (payload?: any) => void): unknown;
}
