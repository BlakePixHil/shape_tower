// A small, test-only Rapier sim that implements the Wobble Lab test contract.
// It exists so the harness can be checked before the real sim lands, and to get an
// early read on how Rapier's deterministic build stacks Shape Tower's pieces.
// It is not game code: no Mortar, Solid Rows, checkpoints, hearts or hazards.
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type {
  CreateSimOptions,
  Ghost,
  Intent,
  PieceLifecycle,
  PieceState,
  PlacePieceOptions,
  Sim,
  SimEvent,
} from '../../contract';
import { QUARTER, localCentreOfMass, localRects, normRot, rotatedSize, type LocalRect } from '../../shapes';

let ready: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export interface ReferenceTuning {
  gravity: number;
  friction: number;
  foundationFriction: number;
  linearDamping: number;
  angularDamping: number;
  inset: number;
  cornerRadius: number;
  solverIterations: number;
  fallSpeed: number;
  softDropMultiplier: number;
  impactCap: number;
  hardDropSpeed: number;
  spawnHeight: number;
  foundationWidth: number;
  settleSpeed: number;
  settleSpin: number;
  settleSteps: number;
  landingSteps: number;
  supportBand: number;
  /** Deliberate faults, used only to prove the harness catches them. */
  faults: { ghostBiasX?: number; ghostBiasY?: number; nudgeAtStep?: number };
}

export const DEFAULT_TUNING: ReferenceTuning = {
  gravity: 20,
  friction: 0.9,
  foundationFriction: 1.0,
  linearDamping: 0.1,
  angularDamping: 0.8,
  inset: 0.02,
  cornerRadius: 0.05,
  solverIterations: 4,
  fallSpeed: 1.5,
  softDropMultiplier: 3,
  impactCap: 2.5,
  hardDropSpeed: 2,
  spawnHeight: 7,
  foundationWidth: 8,
  settleSpeed: 0.05,
  settleSpin: (3 * Math.PI) / 180,
  settleSteps: 24,
  landingSteps: 36,
  supportBand: 0.05,
  faults: {},
};

const DT = 1 / 60;
const LOST_LINE = -1;
const GROUND_ID = 0;

interface PieceRec {
  id: number;
  shape: string;
  rects: LocalRect[];
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  state: PieceLifecycle;
  rot: number;
  quietSteps: number;
  landingSteps: number;
  softDrop: boolean;
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class ReferenceSim implements Sim {
  stepIndex = 0;
  private world: RAPIER.World;
  private pieceMap = new Map<number, PieceRec>();
  private byBody = new Map<number, number>();
  private events: SimEvent[] = [];
  private nextId = 1;
  private controlledId: number | null = null;
  private t: ReferenceTuning;

  constructor(options: CreateSimOptions) {
    this.t = { ...DEFAULT_TUNING, ...(options.tuning as Partial<ReferenceTuning>) };
    this.world = this.buildWorld();
  }

  private buildWorld(): RAPIER.World {
    const world = new RAPIER.World({ x: 0, y: -this.t.gravity });
    world.timestep = DT;
    world.numSolverIterations = this.t.solverIterations;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(this.t.foundationWidth / 2, 0.5).setFriction(this.t.foundationFriction),
      ground,
    );
    // Scene queries only see colliders after a step, so the ghost works before the first real step.
    world.step();
    return world;
  }

  // ---------- pieces ----------

  private makePiece(shape: string, x: number, y: number, rot: number, type: 'dynamic' | 'fixed' | 'kinematic', state: PieceLifecycle): PieceRec {
    const r = normRot(rot);
    const desc =
      type === 'dynamic'
        ? RAPIER.RigidBodyDesc.dynamic()
        : type === 'fixed'
          ? RAPIER.RigidBodyDesc.fixed()
          : RAPIER.RigidBodyDesc.kinematicPositionBased();
    desc
      .setTranslation(x, y)
      .setRotation((r * Math.PI) / 2)
      .setLinearDamping(this.t.linearDamping)
      .setAngularDamping(this.t.angularDamping)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const rects = localRects(shape);
    const colliders = rects.map((lr) => {
      const hx = lr.w / 2 - this.t.inset - this.t.cornerRadius;
      const hy = lr.h / 2 - this.t.inset - this.t.cornerRadius;
      return this.world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(hx, hy, this.t.cornerRadius)
          .setTranslation(lr.cx, lr.cy)
          .setFriction(this.t.friction)
          .setRestitution(0)
          .setDensity(1),
        body,
      );
    });
    const id = this.nextId++;
    const rec: PieceRec = { id, shape, rects, body, colliders, state, rot: r, quietSteps: 0, landingSteps: 0, softDrop: false };
    this.pieceMap.set(id, rec);
    this.byBody.set(body.handle, id);
    return rec;
  }

  placePiece(p: PlacePieceOptions): number {
    const rec = this.makePiece(p.shape, p.x, p.y, p.rot, p.as === 'stone' ? 'fixed' : 'dynamic', p.as === 'stone' ? 'stone' : 'settling');
    return rec.id;
  }

  spawnControlled(p: { shape: string; x: number; rot: number }): number {
    if (this.controlledId !== null) throw new Error('A controlled shape already exists');
    const size = rotatedSize(p.shape, p.rot);
    const y = this.towerTop() + this.t.spawnHeight + size.h / 2;
    const rec = this.makePiece(p.shape, Math.round(p.x * 2) / 2, y, p.rot, 'kinematic', 'controlled');
    this.controlledId = rec.id;
    this.events.push({ type: 'piece_spawned', id: rec.id, shape: p.shape });
    return rec.id;
  }

  private towerTop(): number {
    let top = 0;
    for (const p of this.pieceMap.values()) {
      if (p.state === 'controlled' || p.state === 'lost') continue;
      top = Math.max(top, this.aabbTop(p));
    }
    return top;
  }

  private aabbTop(p: PieceRec): number {
    const pos = p.body.translation();
    const a = p.body.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    let top = -Infinity;
    for (const r of p.rects) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = r.cx + (dx * r.w) / 2;
        const ly = r.cy + (dy * r.h) / 2;
        top = Math.max(top, pos.y + s * lx + c * ly);
      }
    }
    return top;
  }

  // ---------- queries on a hypothetical pose ----------

  /** World centre and angle of each rect of a piece at an exact quarter-turn pose. */
  private rectPoses(p: PieceRec, x: number, y: number, rot: number): { x: number; y: number; angle: number }[] {
    const [c, s] = QUARTER[normRot(rot)];
    return p.rects.map((r) => ({ x: x + c * r.cx - s * r.cy, y: y + s * r.cx + c * r.cy, angle: (normRot(rot) * Math.PI) / 2 }));
  }

  /** Collider shapes in their own frame; the angle passed alongside handles rotation. */
  private shapesFor(p: PieceRec): RAPIER.Shape[] {
    return p.colliders.map((c) => c.shape);
  }

  private overlapsAt(p: PieceRec, x: number, y: number, rot: number): boolean {
    const poses = this.rectPoses(p, x, y, rot);
    const shapes = this.shapesFor(p);
    let hit = false;
    poses.forEach((pose, i) => {
      if (hit) return;
      this.world.intersectionsWithShape(
        { x: pose.x, y: pose.y },
        pose.angle,
        shapes[i],
        () => {
          hit = true;
          return false;
        },
        undefined,
        undefined,
        undefined,
        p.body,
      );
    });
    return hit;
  }

  /** Bodies within `band` below the piece at a pose (the ghost's support set). */
  private supportAt(p: PieceRec, x: number, y: number, rot: number): number[] {
    const ids = new Set<number>();
    const poses = this.rectPoses(p, x, y - this.t.supportBand, rot);
    const shapes = this.shapesFor(p);
    poses.forEach((pose, i) => {
      this.world.intersectionsWithShape(
        { x: pose.x, y: pose.y },
        pose.angle,
        shapes[i],
        (col) => {
          const parent = col.parent();
          const id = parent ? this.byBody.get(parent.handle) : undefined;
          ids.add(id ?? GROUND_ID);
          return true;
        },
        undefined,
        undefined,
        undefined,
        p.body,
      );
    });
    return [...ids].sort((a, b) => a - b);
  }

  /** Straight-down cast. Returns the drop distance, or null when nothing is below. */
  private castDown(p: PieceRec, x: number, y: number, rot: number, maxDist: number): number | null {
    const poses = this.rectPoses(p, x, y, rot);
    const shapes = this.shapesFor(p);
    let best = Infinity;
    poses.forEach((pose, i) => {
      const hit = this.world.castShape({ x: pose.x, y: pose.y }, pose.angle, { x: 0, y: -1 }, shapes[i], 0, maxDist, true, undefined, undefined, undefined, p.body);
      if (hit) best = Math.min(best, hit.time_of_impact);
    });
    return Number.isFinite(best) ? best : null;
  }

  /** Contact points under a pose: short rays down from each rect's bottom edge, every 0.05 blocks. */
  private contactsAt(p: PieceRec, x: number, y: number, rot: number): { x: number; y: number }[] {
    const odd = normRot(rot) % 2 === 1;
    const out: { x: number; y: number }[] = [];
    const poses = this.rectPoses(p, x, y, rot);
    p.rects.forEach((r, i) => {
      const hw = (odd ? r.h : r.w) / 2 - this.t.inset;
      const hh = (odd ? r.w : r.h) / 2 - this.t.inset;
      const bottom = poses[i].y - hh;
      const n = Math.max(1, Math.round((2 * hw) / 0.05));
      for (let k = 0; k <= n; k++) {
        const rx = poses[i].x - hw + (2 * hw * k) / n;
        const ray = new RAPIER.Ray({ x: rx, y: bottom + 0.001 }, { x: 0, y: -1 });
        const hit = this.world.castRay(ray, this.t.supportBand + this.t.cornerRadius, true, undefined, undefined, undefined, p.body);
        if (hit) out.push({ x: rx, y: bottom + 0.001 - hit.timeOfImpact });
      }
    });
    return out;
  }

  // ---------- contract ----------

  ghost(): Ghost | null {
    const p = this.controlled();
    if (!p) return null;
    const pos = p.body.translation();
    const dist = this.castDown(p, pos.x, pos.y, p.rot, 500);
    if (dist === null) return null;
    const gx = pos.x + (this.t.faults.ghostBiasX ?? 0);
    const gy = pos.y - dist + (this.t.faults.ghostBiasY ?? 0);
    const supportIds = this.supportAt(p, pos.x, pos.y - dist, p.rot);
    const contacts = this.contactsAt(p, pos.x, pos.y - dist, p.rot);
    return { x: gx, y: gy, rot: p.rot, contacts, supportIds, tint: this.tint(p, pos.x, contacts) };
  }

  private tint(p: PieceRec, x: number, contacts: { x: number; y: number }[]): Ghost['tint'] {
    if (contacts.length === 0) return 'none';
    const com = localCentreOfMass(p.shape);
    const [c, s] = QUARTER[p.rot];
    const comX = x + c * com.x - s * com.y;
    const lo = Math.min(...contacts.map((k) => k.x));
    const hi = Math.max(...contacts.map((k) => k.x));
    if (comX < lo - 1e-6 || comX > hi + 1e-6) return 'red';
    const edge = Math.min(comX - lo, hi - comX);
    return edge < 0.15 * Math.max(hi - lo, 1e-6) ? 'amber' : 'ok';
  }

  intent(i: Intent): void {
    const p = this.controlled();
    if (!p) return;
    const pos = p.body.translation();
    switch (i.type) {
      case 'moveTo': {
        const target = Math.round(i.x * 2) / 2;
        let x = pos.x;
        const dir = Math.sign(target - x);
        while (x !== target) {
          const next = x + dir * 0.5;
          if (this.overlapsAt(p, next, pos.y, p.rot)) break;
          x = next;
        }
        p.body.setTranslation({ x, y: pos.y }, true);
        break;
      }
      case 'rotate': {
        const rot = normRot(p.rot + i.dir);
        const kicks: [number, number][] = [[0, 0], [0.5, 0], [-0.5, 0], [1, 0], [-1, 0], [0, 0.5]];
        for (const [kx, ky] of kicks) {
          if (!this.overlapsAt(p, pos.x + kx, pos.y + ky, rot)) {
            p.rot = rot;
            p.body.setTranslation({ x: pos.x + kx, y: pos.y + ky }, true);
            p.body.setRotation((rot * Math.PI) / 2, true);
            break;
          }
        }
        break;
      }
      case 'softDrop':
        p.softDrop = i.on;
        break;
      case 'hardDrop': {
        const dist = this.castDown(p, pos.x, pos.y, p.rot, 500);
        if (dist === null) {
          // Nothing below: it just falls and is lost.
          this.release(p, -this.t.hardDropSpeed);
          p.state = 'settling';
          break;
        }
        p.body.setTranslation({ x: pos.x, y: pos.y - dist }, true);
        this.land(p, -this.t.hardDropSpeed);
        break;
      }
      case 'hold':
        break;
    }
  }

  private controlled(): PieceRec | null {
    return this.controlledId === null ? null : (this.pieceMap.get(this.controlledId) ?? null);
  }

  private release(p: PieceRec, vy: number) {
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setLinvel({ x: 0, y: vy }, true);
    p.body.setAngvel(0, true);
    this.controlledId = null;
  }

  private land(p: PieceRec, vy: number) {
    const pos = p.body.translation();
    const touchedIds = this.supportAt(p, pos.x, pos.y, p.rot);
    this.release(p, Math.max(vy, -this.t.impactCap));
    p.state = 'landing';
    p.landingSteps = 0;
    this.events.push({ type: 'piece_landed', id: p.id, shape: p.shape, pose: { x: pos.x, y: pos.y, rot: p.rot }, touchedIds });
  }

  step(n = 1): void {
    for (let k = 0; k < n; k++) this.stepOnce();
  }

  private stepOnce() {
    const p = this.controlled();
    if (p) {
      const pos = p.body.translation();
      const speed = this.t.fallSpeed * (p.softDrop ? this.t.softDropMultiplier : 1);
      const d = speed * DT;
      const dist = this.castDown(p, pos.x, pos.y, p.rot, d);
      if (dist !== null && dist <= d) {
        p.body.setTranslation({ x: pos.x, y: pos.y - dist }, true);
        this.land(p, -speed);
      } else if (pos.y < LOST_LINE) {
        p.state = 'lost';
        this.controlledId = null;
        this.world.removeRigidBody(p.body);
        this.events.push({ type: 'piece_lost', id: p.id, shape: p.shape });
      } else {
        p.body.setNextKinematicTranslation({ x: pos.x, y: pos.y - d });
      }
    }
    this.world.step();
    this.stepIndex++;
    if (this.stepIndex === this.t.faults.nudgeAtStep) {
      // A 0.01 m/s push on the first loose piece: the kind of tiny difference determinism checks must catch.
      const loose = [...this.pieceMap.values()].find((q) => q.state !== 'controlled' && q.state !== 'stone' && q.state !== 'lost');
      loose?.body.setLinvel({ x: loose.body.linvel().x + 0.01, y: loose.body.linvel().y }, true);
    }
    this.afterStep();
  }

  private afterStep() {
    const c = this.controlled();
    if (c) {
      // A toppling piece that touches the controlled shape makes it dynamic (gameplay.md §2).
      // Counts as first contact too, so it also emits piece_landed (with via: 'knock').
      let knocked = false;
      for (const col of c.colliders) {
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (m) => {
            for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) <= 1e-3) knocked = true;
          });
        });
      }
      if (knocked) {
        const pos = c.body.translation();
        const touchedIds = this.supportAt(c, pos.x, pos.y, c.rot);
        this.release(c, c.body.linvel().y);
        c.state = 'landing';
        c.landingSteps = 0;
        this.events.push({ type: 'piece_landed', id: c.id, shape: c.shape, pose: { x: pos.x, y: pos.y, rot: c.rot }, touchedIds, via: 'knock' });
      }
    }
    for (const p of this.pieceMap.values()) {
      if (p.state === 'controlled' || p.state === 'stone' || p.state === 'lost') continue;
      const pos = p.body.translation();
      if (pos.y < LOST_LINE) {
        p.state = 'lost';
        this.world.removeRigidBody(p.body);
        this.events.push({ type: 'piece_lost', id: p.id, shape: p.shape });
        continue;
      }
      const v = p.body.linvel();
      const quiet = Math.hypot(v.x, v.y) < this.t.settleSpeed && Math.abs(p.body.angvel()) < this.t.settleSpin;
      p.quietSteps = quiet ? p.quietSteps + 1 : 0;
      if (p.state === 'landing') {
        p.landingSteps++;
        if (p.landingSteps >= this.t.landingSteps) p.state = 'settling';
      } else if (p.state === 'settling' && p.quietSteps >= this.t.settleSteps) {
        p.state = 'settled';
        this.events.push({ type: 'piece_settled', id: p.id, shape: p.shape });
      } else if (p.state === 'settled' && !quiet) {
        p.state = 'settling';
      }
    }
  }

  pieces(): PieceState[] {
    const out: PieceState[] = [];
    for (const p of this.pieceMap.values()) {
      if (p.state === 'lost') continue;
      const pos = p.body.translation();
      const v = p.body.linvel();
      out.push({ id: p.id, shape: p.shape, state: p.state, x: pos.x, y: pos.y, angle: p.body.rotation(), vx: v.x, vy: v.y, w: p.body.angvel() });
    }
    return out.sort((a, b) => a.id - b.id);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  height(): { committed: number; provisional: number } {
    let committed = 0;
    let provisional = 0;
    for (const p of this.pieceMap.values()) {
      if (p.state === 'controlled' || p.state === 'lost') continue;
      const top = this.aabbTop(p);
      provisional = Math.max(provisional, top);
      if (p.state === 'settled' || p.state === 'stone') committed = Math.max(committed, top);
    }
    return { committed, provisional };
  }

  hash(): string {
    const q = (v: number) => Math.round(v * 1e4);
    const parts = this.pieces().map((p) => [p.id, p.state, q(p.x), q(p.y), q(p.angle), q(p.vx), q(p.vy), q(p.w)].join(','));
    return fnv1a(`${this.stepIndex}|${parts.join(';')}`);
  }

  isSleeping(id: number): boolean {
    const p = this.pieceMap.get(id);
    return !p || p.state === 'stone' || p.body.isSleeping();
  }

  snapshot(): unknown {
    return {
      world: this.world.takeSnapshot(),
      stepIndex: this.stepIndex,
      nextId: this.nextId,
      controlledId: this.controlledId,
      pieces: [...this.pieceMap.values()].map((p) => ({
        id: p.id,
        shape: p.shape,
        state: p.state,
        rot: p.rot,
        quietSteps: p.quietSteps,
        landingSteps: p.landingSteps,
        softDrop: p.softDrop,
        body: p.state === 'lost' ? -1 : p.body.handle,
        colliders: p.state === 'lost' ? [] : p.colliders.map((c) => c.handle),
      })),
    };
  }

  restore(snapshot: unknown): void {
    const s = snapshot as ReturnType<ReferenceSim['snapshot']> & {
      world: Uint8Array;
      stepIndex: number;
      nextId: number;
      controlledId: number | null;
      pieces: { id: number; shape: string; state: PieceLifecycle; rot: number; quietSteps: number; landingSteps: number; softDrop: boolean; body: number; colliders: number[] }[];
    };
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(s.world);
    this.stepIndex = s.stepIndex;
    this.nextId = s.nextId;
    this.controlledId = s.controlledId;
    this.events = [];
    this.pieceMap.clear();
    this.byBody.clear();
    for (const r of s.pieces) {
      if (r.state === 'lost') continue;
      const body = this.world.getRigidBody(r.body);
      const colliders = r.colliders.map((h) => this.world.getCollider(h));
      this.pieceMap.set(r.id, { ...r, rects: localRects(r.shape), body, colliders });
      this.byBody.set(r.body, r.id);
    }
  }

  dispose(): void {
    this.world.free();
  }
}

export async function createReferenceSim(options: CreateSimOptions): Promise<ReferenceSim> {
  await initRapier();
  return new ReferenceSim(options);
}
