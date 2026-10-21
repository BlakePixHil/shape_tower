// Player audio settings, saved between sessions (audio sections 7.4 and 8.7).

import type { HapticsLevel } from './types';

export interface AudioSettings {
  music: number;
  sfx: number;
  voices: number;
  haptics: HapticsLevel;
  mono: boolean;
  /** softer stingers, no heartbeat sub, gentler tension layer */
  calm: boolean;
  /** landing-guide perfect-fit chime (assist setting, on by default) */
  lockOnChime: boolean;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  music: 0.7,
  sfx: 1,
  voices: 0.8,
  haptics: 'full',
  mono: false,
  calm: false,
  lockOnChime: true,
};

const KEY = 'shapeTower.audio.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as any).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null = defaultStorage(), defaults: Partial<AudioSettings> = {}): AudioSettings {
  const base = { ...DEFAULT_SETTINGS, ...defaults };
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const out = { ...base };
    for (const k of Object.keys(base) as (keyof AudioSettings)[]) {
      if (parsed[k] !== undefined && typeof parsed[k] === typeof base[k]) (out as any)[k] = parsed[k];
    }
    for (const k of ['music', 'sfx', 'voices'] as const) out[k] = Math.max(0, Math.min(1, out[k]));
    if (!['off', 'light', 'full'].includes(out.haptics)) out.haptics = base.haptics;
    return out;
  } catch {
    return base;
  }
}

export function saveSettings(s: AudioSettings, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or full storage: settings just won't persist */
  }
}
