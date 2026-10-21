// The player's settings in the game (design doc "Settings"; the slice's subset). Saved per device.
// The Wobble Lab keeps its own view settings in the tuning panel.

import type { AudioDirector, HapticsLevel } from '@audio';
import type { Tuning } from '../sim/tuning.ts';
import type { ViewSettings } from './panel.ts';

export interface PlayerSettings {
  splitTap: boolean;        // tap the left half to rotate left, the right half to rotate right
  sensitivity: number;      // drag sensitivity, 0.75 to 1.5
  guideOpacity: number;     // 0.5 to 1.5
  shake: 'off' | 'low' | 'full';
  reduceMotion: boolean;
  faces: boolean;
  music: number;            // 0 to 1
  sfx: number;
  voices: number;
  haptics: HapticsLevel;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  splitTap: false, sensitivity: 1, guideOpacity: 1, shake: 'full', reduceMotion: false, faces: true,
  music: 0.7, sfx: 1, voices: 0.8, haptics: 'full',
};

const KEY = 'shape-tower-settings-v1';

export function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlayerSettings>) };
  } catch { /* storage unavailable */ }
  const s = { ...DEFAULT_SETTINGS };
  // Follow the phone's own Reduce Motion setting until the player picks.
  try { s.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* none */ }
  return s;
}

export function saveSettings(s: PlayerSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* fine without it */ }
}

/** What the play scene reads. */
export function viewFor(s: PlayerSettings, juice = true): ViewSettings {
  return {
    reducedMotion: s.reduceMotion, shake: s.shake === 'off' ? 0 : s.shake === 'low' ? 0.5 : 1, faces: s.faces,
    splitTap: s.splitTap, ghostTint: true, guideOpacity: s.guideOpacity, juice,
  };
}

/** The tuning fields settings change. */
export function tuningFor(s: PlayerSettings): Partial<Tuning> {
  return { sensitivity: s.sensitivity };
}

export function applyAudio(s: PlayerSettings, audio: AudioDirector | null): void {
  if (!audio) return;
  audio.setVolume('music', s.music);
  audio.setVolume('sfx', s.sfx);
  audio.setVolume('voices', s.voices);
  audio.setHapticsLevel(s.haptics);
}
