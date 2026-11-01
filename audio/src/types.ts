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
  'run_start', 'pause', 'resume', 'xp_tick', 'level_up', 'unlock', 'achievement',
  // power-ups and Second Wind
  'bubble_spawned', 'bubble_expired', 'power_collected', 'power_granted', 'power_used', 'power_refused',
  'power_ended', 'pieces_swept', 'second_wind_ready', 'second_wind',
] as const;

export type JuiceEventName = (typeof JUICE_EVENTS)[number];

/**
 * Blockling Pop's events (Pop plan §10), sent by the Pop view through handle() once setMode('pop') is on.
 * Biome ids are 1-based, like the tower's; pop_pickup's shape is a key ('Pip', 'L') or its index.
 */
export const POP_EVENTS = [
  'pop_run_start', // {biome, cp, fill 0-1, puzzle?}
  'pop_pickup', 'pop_ghost', 'pop_would_pop', 'pop_drop_back', // {shape}, {lines}, {count, 0 = stop}
  'pop_place', 'pop_lines', 'pop_combo', 'pop_combo_end', 'pop_all_clear', // {shape, cells, combo}, {count, combo, lines, hitstop ms}, {combo}
  'pop_checkpoint', 'biome_entered', 'pop_tray', 'pop_bag', 'pop_cant_fit', 'pop_fill', // {n}, {id}, {n}, -, {slot}, {fill}
  'pop_no_room', 'pop_run_over', // {waiting?}, {cause}
  // milestone 3: bubbles, powers and Second Wind
  'pop_bubble', 'pop_bubble_got', 'pop_bubble_gone', 'pop_power_got', // {kind, why}, {kind}, -, {kind, why}
  'pop_power', 'pop_meteor_hit', 'pop_power_refused', // {kind: undo|spin|sweep|meteor|fresh, cells? (a count)}, {cells}, -
  'pop_aim', 'pop_aim_move', 'pop_aim_cancel', 'pop_spin', // {kind}, -, -, -
  'pop_wind_ready', 'pop_wind_armed', 'pop_second_wind', // {why}, -, {cells (a count)}
  // rules 3: split pieces left touching merge into whole shapes; the view stamps them `delay` ms later
  'pop_merge', // {count (merges this move), cells (total), delay ms}
  'pause', 'resume', 'xp_tick', 'level_up', 'unlock', 'achievement',
] as const;

export type PopEventName = (typeof POP_EVENTS)[number];

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
