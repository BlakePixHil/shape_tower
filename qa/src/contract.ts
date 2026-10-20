// The test hook contract agreed with the Gameplay thread on 2026-10-20.
// Wobble Lab exports `createSim` from src/sim/testApi.ts with these names; the
// reference sim in src/adapters/reference implements the same interface so the
// harness can be self-tested before the real sim lands.
//
// Conventions (shared with Gameplay):
// - Units are blocks (1 block = 1 m). y points up. Gravity pulls towards -y.
// - rot is in quarter turns, counterclockwise, 0..3.
// - A piece's (x, y) is the centre of its cell bounding box in its current rotation.
// - The Meadow foundation is 8 blocks wide, centred on x = 0, with its top at y = 0.
// - Ids are integers.

export type EngineId = 'box2d' | 'rapier' | 'reference';

export interface Pose {
  x: number;
  y: number;
  rot: number;
}

export type PieceLifecycle =
  | 'controlled'
  | 'landing'
  | 'settling'
  | 'settled'
  | 'bonded'
  | 'stone'
  | 'lost';

export interface PieceState {
  id: number;
  shape: string;
  state: PieceLifecycle;
  x: number;
  y: number;
  /** Radians, counterclockwise. */
  angle: number;
  vx: number;
  vy: number;
  /** Angular velocity, radians per second. */
  w: number;
}

export type Tint = 'ok' | 'amber' | 'red' | 'none';

export interface Ghost {
  x: number;
  y: number;
  rot: number;
  contacts: { x: number; y: number }[];
  supportIds: number[];
  tint: Tint;
}

export type Intent =
  | { type: 'moveTo'; x: number }
  | { type: 'rotate'; dir: 1 | -1 }
  | { type: 'softDrop'; on: boolean }
  | { type: 'hardDrop' }
  | { type: 'hold' };

export interface SimEvent {
  type: string;
  [key: string]: unknown;
}

export interface PieceLandedEvent extends SimEvent {
  type: 'piece_landed';
  id?: number;
  /** The landed body's id when it differs from the controlled shape's id (the game's sim). */
  pieceId?: number;
  shape: string;
  pose: Pose;
  touchedIds: number[];
}

export interface PlacePieceOptions {
  shape: string;
  x: number;
  y: number;
  rot: number;
  as: 'dynamic' | 'stone';
}

export interface Sim {
  readonly stepIndex: number;
  /** Advances the simulation by n fixed 1/60 s steps. */
  step(n?: number): void;
  /** Places a piece directly, for building test towers. Returns its id. */
  placePiece(p: PlacePieceOptions): number;
  /** Puts a controlled shape at spawn height. Returns its id. */
  spawnControlled(p: { shape: string; x: number; rot: number }): number;
  intent(i: Intent): void;
  ghost(): Ghost | null;
  pieces(): PieceState[];
  drainEvents(): SimEvent[];
  height(): { committed: number; provisional: number };
  /** Hash of the state rounded to 1e-4 blocks. */
  hash(): string;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
  dispose(): void;
  hearts?: number;
  budget?: number;
  checkpoint?: unknown;
}

export interface CreateSimOptions {
  engine: EngineId;
  seed: number;
  tuning?: Record<string, unknown>;
}

export type CreateSim = (options: CreateSimOptions) => Sim | Promise<Sim>;
