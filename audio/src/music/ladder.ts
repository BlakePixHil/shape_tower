// The landing-note ladder ("the tower is an instrument", audio section 5).
// Pure state machine: every clean or perfect settle climbs one pentatonic step,
// a messy settle resets to the root, and every 8th step in a row blooms.

import { harmonyAbove, scaleNote, type Key } from './theory';

export type Grade = 'perfect' | 'clean' | 'messy';

export const LADDER_STEPS = 8;

export interface LadderResult {
  kind: 'note' | 'clonk';
  /** notes to play together (melody note first, harmony after) */
  notes: number[];
  /** 0-based step that was played; -1 for a clonk */
  step: number;
  /** consecutive clean-or-perfect placements including this one */
  streak: number;
  /** streak hit 4 (sparkle) */
  sparkle: boolean;
  /** streak hit a multiple of 8 (chord bloom, melody unlock) */
  bloom: boolean;
}

export class LandingLadder {
  private streak = 0;
  /** stays true for the rest of the biome once the ladder has been topped */
  melodyUnlocked = false;

  reset(): void {
    this.streak = 0;
  }

  /** Call on biome change: the ladder keeps climbing, but the melody unlock is per biome. */
  newBiome(): void {
    this.melodyUnlocked = false;
  }

  get currentStreak(): number {
    return this.streak;
  }

  settle(key: Key, grade: Grade): LadderResult {
    if (grade === 'messy') {
      this.streak = 0;
      return { kind: 'clonk', notes: [key.root - 12], step: -1, streak: 0, sparkle: false, bloom: false };
    }
    const step = this.streak % LADDER_STEPS;
    this.streak += 1;
    const notes = [scaleNote(key, step)];
    if (grade === 'perfect') notes.push(harmonyAbove(key, step));
    const bloom = this.streak % LADDER_STEPS === 0;
    if (bloom) this.melodyUnlocked = true;
    return { kind: 'note', notes, step, streak: this.streak, sparkle: this.streak % LADDER_STEPS === 4, bloom };
  }
}
