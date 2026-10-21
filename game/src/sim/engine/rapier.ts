// Rapier 2D (the cross-platform deterministic build) behind the PhysicsEngine interface, for the
// Gate 0 bake-off against Box2D (gameplay.md §15). Call `await initRapier()` once before making one.
// Notes:
// - Mortar bonds are our own soft welds: a linear and an angular spring at the anchor, applied as
//   impulses every substep. The load is the spring's stretch times its stiffness (§15: "With Rapier,
//   Mortar breaks on joint stretch"). Stiffness comes from bondHertz and the pair's effective mass,
//   the same recipe as Box2D's soft weld.
// - This Rapier build reports rotations as angles, so cosines and sines come from trig.ts, which
//   uses basic arithmetic only. Body angles going in are exact quarter turns.
// - Scene queries see colliders made since the last step only after it, so queries also test those
//   new colliders one by one.

import type * as R from '@dimforge/rapier2d-deterministic-compat';
import type { ColliderBox, Rot } from '../shapes.ts';
import type { BodySpec, ContactInfo, HitInfo, PhysicsEngine, Transform, Velocity, WorldSettings } from './types.ts';
import { cosSin } from './trig.ts';

const CAT_TOWER = 0x1;
const CAT_STATIC = 0x2;
const CAT_LOST = 0x4;
const CAT_HAZARD = 0x8;
const CAT_QUERY = 0x10;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
const SOLID = CAT_TOWER | CAT_STATIC | CAT_HAZARD | CAT_QUERY;
const QUERY = groups(CAT_QUERY, CAT_TOWER | CAT_STATIC);

let RAPIER: typeof R | null = null;
let loading: Promise<void> | null = null;

/** Loads Rapier's WebAssembly (inlined in the compat build). Safe to call more than once. */
export function initRapier(): Promise<void> {
  loading ??= import('@dimforge/rapier2d-deterministic-compat').then(async m => {
    const lib = ((m as unknown as { default?: typeof R }).default ?? m) as typeof R;
    await lib.init();
    RAPIER = lib;
  });
  return loading;
}

export function rapierReady(): boolean { return RAPIER !== null; }

/** Exact angles for the quarter turns the sim uses; anything else through the portable path is never needed. */
function angleOf(r: Rot): number {
  if (r.s === 0) return r.c > 0 ? 0 : Math.PI;
  if (r.c === 0) return r.s > 0 ? Math.PI / 2 : -Math.PI / 2;
  throw new Error(`Rapier adapter: body rotations must be quarter turns, got (${r.c}, ${r.s})`);
}

interface Entry { body: R.RigidBody; colliders: R.Collider[]; boxes: ColliderBox[] }

interface Weld {
  a: number; b: number;
  la: [number, number]; lb: [number, number];   // anchors in each body's frame
  rc: number; rs: number;                         // B's rotation relative to A at creation
  hertz: number; damping: number;
  force: number; torque: number;                  // spring load after the last substep
}

export class RapierEngine implements PhysicsEngine {
  readonly name = 'rapier' as const;
  private R: typeof R;
  private world: R.World;
  private events: R.EventQueue;
  private bodies = new Map<number, Entry>();
  private byCollider = new Map<number, number>();
  private fresh = new Set<R.Collider>();          // made since the last step: not in the query tree yet
  private welds = new Map<number, Weld>();
  private nextWeld = 1;
  private forces = new Map<number, [number, number]>();
  private hitList: HitInfo[] = [];
  private hitThreshold: number;
  private queryShapes = new Map<string, R.Shape>();

  constructor(settings: WorldSettings) {
    if (!RAPIER) throw new Error('Rapier is not loaded yet: await initRapier() first');
    this.R = RAPIER;
    this.world = new this.R.World({ x: 0, y: -settings.gravity });
    this.world.numSolverIterations = 1; // we substep ourselves, like Box2D's soft step
    this.events = new this.R.EventQueue(true);
    this.hitThreshold = settings.hitThreshold;
  }

  setGravity(gx: number, gy: number): void {
    this.world.gravity = { x: gx, y: gy };
  }

  addBody(spec: BodySpec): void {
    const R = this.R;
    const desc = (spec.dynamic ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed())
      .setTranslation(spec.x, spec.y)
      .setRotation(angleOf(spec.rot))
      .setLinvel(spec.vx, spec.vy)
      .setLinearDamping(spec.linearDamping)
      .setAngularDamping(spec.angularDamping)
      .setUserData({ id: spec.id });
    const body = this.world.createRigidBody(desc);
    const colliders = spec.boxes.map(b => {
      const cd = R.ColliderDesc.roundCuboid(Math.max(b.hw, 0.001), Math.max(b.hh, 0.001), b.radius)
        .setTranslation(b.cx, b.cy)
        .setFriction(spec.friction)
        .setRestitution(0)
        .setDensity(spec.density)
        .setCollisionGroups(groups(spec.dynamic ? CAT_TOWER : CAT_STATIC, SOLID))
        .setActiveEvents(spec.dynamic ? R.ActiveEvents.COLLISION_EVENTS : R.ActiveEvents.NONE);
      const c = this.world.createCollider(cd, body);
      this.byCollider.set(c.handle, spec.id);
      this.fresh.add(c);
      return c;
    });
    this.bodies.set(spec.id, { body, colliders, boxes: spec.boxes });
  }

  removeBody(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    for (const c of e.colliders) { this.byCollider.delete(c.handle); this.fresh.delete(c); }
    this.world.removeRigidBody(e.body);
    this.bodies.delete(id);
    this.forces.delete(id);
    for (const [jid, w] of this.welds) if (w.a === id || w.b === id) this.welds.delete(jid);
  }

  hasBody(id: number): boolean { return this.bodies.has(id); }

  setStatic(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    e.body.setBodyType(this.R.RigidBodyType.Fixed, true);
    for (const c of e.colliders) c.setCollisionGroups(groups(CAT_STATIC, SOLID));
  }

  setLost(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    for (const c of e.colliders) c.setCollisionGroups(groups(CAT_LOST, 0));
    e.body.wakeUp();
  }

  transform(id: number): Transform {
    const b = this.bodies.get(id)!.body;
    const p = b.translation();
    const { c, s } = cosSin(b.rotation());
    return { x: p.x, y: p.y, c, s };
  }

  velocity(id: number): Velocity {
    const b = this.bodies.get(id)!.body;
    const v = b.linvel();
    return { vx: v.x, vy: v.y, w: b.angvel() };
  }

  setVelocity(id: number, v: Velocity): void {
    const e = this.bodies.get(id);
    if (!e) return;
    e.body.setLinvel({ x: v.vx, y: v.vy }, true);
    e.body.setAngvel(v.w, true);
  }

  setBullet(id: number, on: boolean): void {
    this.bodies.get(id)?.body.enableCcd(on);
  }

  isAwake(id: number): boolean {
    const e = this.bodies.get(id);
    return !!e && !e.body.isSleeping();
  }

  /** Mass of a moving body; 0 for fixed ones, as Box2D reports them. */
  mass(id: number): number {
    const e = this.bodies.get(id);
    return e && e.body.isDynamic() ? e.body.mass() : 0;
  }

  applyForce(id: number, fx: number, fy: number): void {
    if (!this.bodies.has(id)) return;
    const f = this.forces.get(id);
    if (f) { f[0] += fx; f[1] += fy; } else this.forces.set(id, [fx, fy]);
  }

  // ------------------------------------------------------------------ queries

  private queryShape(b: ColliderBox): R.Shape {
    const k = `${b.hw}|${b.hh}|${b.radius}`;
    let s = this.queryShapes.get(k);
    if (!s) { s = new this.R.RoundCuboid(Math.max(b.hw, 0.001), Math.max(b.hh, 0.001), b.radius); this.queryShapes.set(k, s); }
    return s;
  }

  /** Bodies whose tower or stone colliders overlap the shape at (x, y, angle), fresh ones included. */
  private overlap(shape: R.Shape, x: number, y: number, angle: number, out: Set<number>): void {
    this.world.intersectionsWithShape({ x, y }, angle, shape, c => {
      const id = this.byCollider.get(c.handle);
      if (id !== undefined) out.add(id);
      return true;
    }, undefined, QUERY);
    for (const c of this.fresh) {
      const g = c.collisionGroups();
      if (!((g >>> 16) & (CAT_TOWER | CAT_STATIC))) continue;
      if (c.intersectsShape(shape, { x, y }, angle)) {
        const id = this.byCollider.get(c.handle);
        if (id !== undefined) out.add(id);
      }
    }
  }

  overlapBoxes(boxes: ColliderBox[], x: number, y: number, rot: Rot): number[] {
    const out = new Set<number>();
    const angle = angleOf(rot);
    for (const b of boxes) this.overlap(this.queryShape(b), x + rot.c * b.cx - rot.s * b.cy, y + rot.s * b.cx + rot.c * b.cy, angle, out);
    return [...out];
  }

  overlapPoint(x: number, y: number, half = 0.02): number[] {
    const out = new Set<number>();
    this.overlap(this.queryShape({ cx: 0, cy: 0, hw: half, hh: half, radius: 0 }), x, y, 0, out);
    return [...out];
  }

  contacts(id: number): ContactInfo[] {
    const e = this.bodies.get(id);
    if (!e) return [];
    const out: ContactInfo[] = [];
    for (const c of e.colliders) {
      this.world.contactPairsWith(c, other => {
        const oid = this.byCollider.get(other.handle);
        if (oid === undefined || oid === id) return;
        const points: [number, number][] = [];
        this.world.contactPair(c, other, m => {
          for (let i = 0; i < m.numSolverContacts(); i++) {
            const p = m.solverContactPoint(i);
            if (p) points.push([p.x, p.y]);
          }
        });
        if (points.length) out.push({ other: oid, points });
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ bonds

  addWeld(a: number, b: number, ax: number, ay: number, hertz: number, damping: number): number {
    if (!this.bodies.has(a) || !this.bodies.has(b)) return 0;
    const ta = this.transform(a), tb = this.transform(b);
    const local = (t: Transform): [number, number] => {
      const dx = ax - t.x, dy = ay - t.y;
      return [t.c * dx + t.s * dy, -t.s * dx + t.c * dy];
    };
    const jid = this.nextWeld++;
    this.welds.set(jid, {
      a, b, la: local(ta), lb: local(tb),
      rc: ta.c * tb.c + ta.s * tb.s, rs: ta.c * tb.s - ta.s * tb.c,
      hertz, damping, force: 0, torque: 0,
    });
    return jid;
  }

  weldLoad(joint: number): { force: number; torque: number } | null {
    const w = this.welds.get(joint);
    if (!w) return null;
    const ea = this.bodies.get(w.a), eb = this.bodies.get(w.b);
    if (!ea || !eb || (ea.body.isSleeping() && eb.body.isSleeping())) return null;
    return { force: w.force, torque: w.torque };
  }

  removeWeld(joint: number): void { this.welds.delete(joint); }

  /** One substep of every weld's springs, as impulses over h. */
  private springs(h: number): void {
    const TWO_PI = 6.283185307179586;
    for (const w of this.welds.values()) {
      const ea = this.bodies.get(w.a), eb = this.bodies.get(w.b);
      if (!ea || !eb) continue;
      const A = ea.body, B = eb.body;
      const dynA = A.isDynamic(), dynB = B.isDynamic();
      if (!dynA && !dynB) continue;
      const sleepA = A.isSleeping(), sleepB = B.isSleeping();
      if ((sleepA || !dynA) && (sleepB || !dynB)) { w.force = 0; w.torque = 0; continue; }
      const ta = this.transform(w.a), tb = this.transform(w.b);
      const rax = ta.c * w.la[0] - ta.s * w.la[1], ray = ta.s * w.la[0] + ta.c * w.la[1];
      const rbx = tb.c * w.lb[0] - tb.s * w.lb[1], rby = tb.s * w.lb[0] + tb.c * w.lb[1];
      const dx = tb.x + rbx - (ta.x + rax), dy = tb.y + rby - (ta.y + ray);
      const va = A.linvel(), vb = B.linvel(), wa = A.angvel(), wb = B.angvel();
      const rvx = (vb.x - wb * rby) - (va.x - wa * ray), rvy = (vb.y + wb * rbx) - (va.y + wa * rax);
      // B's rotation relative to A now, against the rest pose: the sine of the angle error.
      const qc = ta.c * tb.c + ta.s * tb.s, qs = ta.c * tb.s - ta.s * tb.c;
      const err = qs * w.rc - qc * w.rs;
      const imA = dynA ? A.invMass() : 0, imB = dynB ? B.invMass() : 0;
      const iiA = dynA ? A.invPrincipalInertia() : 0, iiB = dynB ? B.invPrincipalInertia() : 0;
      const om = TWO_PI * w.hertz;
      const m = 1 / (imA + imB), I = iiA + iiB > 0 ? 1 / (iiA + iiB) : 0;
      const kL = m * om * om, cL = 2 * w.damping * m * om;
      const kA = I * om * om, cA = 2 * w.damping * I * om;
      const fx = kL * dx + cL * rvx, fy = kL * dy + cL * rvy;
      const tq = kA * err + cA * (wb - wa);
      w.force = kL * Math.sqrt(dx * dx + dy * dy);
      w.torque = kA * Math.abs(err);
      // A sleeping side stays asleep while the spring is slack, the way a resting island would.
      const slack = Math.abs(dx) + Math.abs(dy) < 0.002 && Math.abs(err) < 0.002;
      if (dynA && !(sleepA && slack)) {
        A.applyImpulseAtPoint({ x: fx * h, y: fy * h }, { x: ta.x + rax, y: ta.y + ray }, true);
        A.applyTorqueImpulse(tq * h, true);
      }
      if (dynB && !(sleepB && slack)) {
        B.applyImpulseAtPoint({ x: -fx * h, y: -fy * h }, { x: tb.x + rbx, y: tb.y + rby }, true);
        B.applyTorqueImpulse(-tq * h, true);
      }
    }
  }

  // ------------------------------------------------------------------ stepping

  step(dt: number, subSteps: number): void {
    const n = Math.max(1, subSteps), h = dt / n;
    this.world.timestep = h;
    this.hitList.length = 0;
    for (const [id, [fx, fy]] of this.forces) this.bodies.get(id)?.body.addForce({ x: fx, y: fy }, true);
    for (let k = 0; k < n; k++) {
      const before = new Map<number, { x: number; y: number; w: number }>();
      for (const [id, e] of this.bodies) if (e.body.isDynamic() && !e.body.isSleeping()) {
        const v = e.body.linvel();
        before.set(id, { x: v.x, y: v.y, w: e.body.angvel() });
      }
      this.springs(h);
      this.world.step(this.events);
      this.fresh.clear();
      this.events.drainCollisionEvents((h1, h2, started) => { if (started) this.hit(h1, h2, before); });
    }
    for (const id of this.forces.keys()) this.bodies.get(id)?.body.resetForces(false);
    this.forces.clear();
  }

  /** A begin-touch, reported like Box2D's hit events: approach speed along the normal before the substep. */
  private hit(h1: number, h2: number, before: Map<number, { x: number; y: number; w: number }>): void {
    const a = this.byCollider.get(h1), b = this.byCollider.get(h2);
    if (a === undefined || b === undefined) return;
    const c1 = this.world.getCollider(h1), c2 = this.world.getCollider(h2);
    let nx = 0, ny = 0, px = 0, py = 0, found = false;
    this.world.contactPair(c1, c2, (m, flipped) => {
      if (found || !m.numSolverContacts()) return;
      const n = m.normal(), p = m.solverContactPoint(0)!;
      nx = flipped ? -n.x : n.x; ny = flipped ? -n.y : n.y; px = p.x; py = p.y; found = true;
    });
    if (!found) return;
    const vel = (id: number) => {
      const v = before.get(id);
      if (!v) return { x: 0, y: 0 };
      const t = this.transform(id);
      return { x: v.x - v.w * (py - t.y), y: v.y + v.w * (px - t.x) };
    };
    const va = vel(a), vb = vel(b);
    const speed = Math.abs((va.x - vb.x) * nx + (va.y - vb.y) * ny);
    if (speed > this.hitThreshold) this.hitList.push({ a, b, speed, x: px, y: py });
  }

  hits(): HitInfo[] { return this.hitList.slice(); }

  dispose(): void {
    this.bodies.clear();
    this.welds.clear();
    this.byCollider.clear();
    this.fresh.clear();
    this.world.free();
    this.events.free();
  }
}
