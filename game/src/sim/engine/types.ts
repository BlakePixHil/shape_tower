// The physics adapter interface (gameplay.md §15). Box2D and Rapier both implement it,
// so the prototype can run the bake-off without touching game rules.
// Ids are the sim's own integer ids; the adapter maps them to engine handles.

import type { ColliderBox, Rot } from '../shapes.ts';

export interface BodySpec {
  id: number;
  boxes: ColliderBox[];
  x: number;
  y: number;
  rot: Rot;
  vx: number;
  vy: number;
  dynamic: boolean;
  friction: number;
  density: number;
  linearDamping: number;
  angularDamping: number;
}

export interface Transform { x: number; y: number; c: number; s: number }
export interface Velocity { vx: number; vy: number; w: number }
export interface ContactInfo { other: number; points: [number, number][] }
export interface HitInfo { a: number; b: number; speed: number; x: number; y: number }

export interface WorldSettings {
  gravity: number;
  pushoutVelocity: number;
  hitThreshold: number;
}

export interface PhysicsEngine {
  readonly name: 'box2d' | 'rapier';
  setGravity(gx: number, gy: number): void;
  addBody(spec: BodySpec): void;
  removeBody(id: number): void;
  /** Turn a body into immovable stone. */
  setStatic(id: number): void;
  /** Stop a body colliding with anything (a Lost piece). */
  setLost(id: number): void;
  hasBody(id: number): boolean;
  transform(id: number): Transform;
  velocity(id: number): Velocity;
  setVelocity(id: number, v: Velocity): void;
  isAwake(id: number): boolean;
  /** Continuous collision against other moving bodies too (fast falling pieces, QA-001). */
  setBullet(id: number, on: boolean): void;
  mass(id: number): number;
  applyForce(id: number, fx: number, fy: number): void;
  /** Ids of tower and stone bodies overlapping these boxes placed at (x, y, rot). */
  overlapBoxes(boxes: ColliderBox[], x: number, y: number, rot: Rot): number[];
  /** Ids of tower and stone bodies overlapping a tiny probe square centred at (x, y). */
  overlapPoint(x: number, y: number, half?: number): number[];
  contacts(id: number): ContactInfo[];
  /** Soft weld between two bodies at a world anchor point. Returns a joint id. */
  addWeld(a: number, b: number, ax: number, ay: number, hertz: number, damping: number): number;
  /** Current load on a weld, or null while its bodies sleep (nothing to break). */
  weldLoad(joint: number): { force: number; torque: number } | null;
  removeWeld(joint: number): void;
  step(dt: number, subSteps: number): void;
  /** Contact hits from the last step, above the hit threshold. Sleeping bodies never report. */
  hits(): HitInfo[];
  dispose(): void;
}
