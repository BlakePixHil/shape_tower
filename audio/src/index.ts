// Public entry point of the audio module. The game imports from '@audio':
//
//   import { createAudioDirector, connectJuiceBus } from '@audio';
//   const audio = createAudioDirector({ context: (this.sound as Phaser.Sound.WebAudioSoundManager).context, haptics: Haptics });
//   connectJuiceBus(juiceBus, audio);

import { AudioDirector, type DirectorOptions } from './director';

/** Creates the director right away; sounds bake in the background and `audio.ready` resolves when done. */
export function createAudioDirector(opts: DirectorOptions = {}): AudioDirector {
  return new AudioDirector(opts);
}

export { AudioDirector, TUNING, type DirectorOptions, type PlayOptions } from './director';
export { connectJuiceBus, type EventSink } from './juicebus';
export { Haptics, PATTERNS, type CapacitorHapticsLike, type PatternName } from './haptics';
export { DEFAULT_SETTINGS, type AudioSettings } from './settings';
export { BIOMES, biome, biomeKey } from './biomes';
export { JUICE_EVENTS, DEFAULT_SIGNALS, type Signals, type Material, type HapticsLevel, type JuiceEventName } from './types';
