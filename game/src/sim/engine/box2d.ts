// Box2D v3 (Phaser Box2D JS port) behind the PhysicsEngine interface.
// Notes from the spike: overlap queries are exact, but this port's shape casts return wrong
// fractions, so the sim never uses them. Weld forces can only be read while a body is awake.

import * as B from 'phaser-box2d/dist/PhaserBox2D.js';
import type { ColliderBox, Rot } from '../shapes.ts';
import type { BodySpec, ContactInfo, HitInfo, PhysicsEngine, Transform, Velocity, WorldSettings } from './types.ts';

export const CAT_TOWER = 0x1;
export const CAT_STATIC = 0x2;
export const CAT_LOST = 0x4;
export const CAT_HAZARD = 0x8;
export const CAT_QUERY = 0x10;

let worldArrayReady = false;

interface Entry { body: any; shapes: any[]; polys: any[] }

export class Box2DEngine implements PhysicsEngine {
  readonly name = 'box2d' as const;
  private world: any;
  private bodies = new Map<number, Entry>();
  private joints = new Map<number, any>();
  private nextJoint = 1;
  private contactBuf: any[] = [];
  private queryFilter: any;
  private probeCache = new Map<number, any>();

  constructor(settings: WorldSettings) {
    if (!worldArrayReady) { B.b2CreateWorldArray(); worldArrayReady = true; }
    const wd = B.b2DefaultWorldDef();
    wd.gravity = new B.b2Vec2(0, -settings.gravity);
    wd.contactPushoutVelocity = settings.pushoutVelocity;
    wd.hitEventThreshold = settings.hitThreshold;
    wd.restitutionThreshold = 1000; // nothing bounces
    wd.enableSleep = true;
    wd.enableContinuous = true;
    // A fresh world every time: a reused one keeps its id pools and array order, which would
    // change the solver order and break replays. (b2DestroyWorld is patched to free its slot.)
    this.world = B.b2CreateWorld(wd);
    if (!this.world.index1) throw new Error('Box2D: no free world slot (is the install patch applied?)');
    this.queryFilter = B.b2DefaultQueryFilter();
    this.queryFilter.categoryBits = CAT_QUERY;
    this.queryFilter.maskBits = CAT_TOWER | CAT_STATIC;
    for (let i = 0; i < 32; i++) this.contactBuf.push(new B.b2ContactData());
  }

  private makePoly(b: ColliderBox): any {
    const p = B.b2MakeOffsetBox(Math.max(b.hw, 0.001), Math.max(b.hh, 0.001), new B.b2Vec2(b.cx, b.cy), 0);
    p.radius = b.radius;
    return p;
  }

  setGravity(gx: number, gy: number): void {
    B.b2World_SetGravity(this.world, new B.b2Vec2(gx, gy));
  }

  addBody(spec: BodySpec): void {
    const bd = B.b2DefaultBodyDef();
    bd.type = spec.dynamic ? B.b2BodyType.b2_dynamicBody : B.b2BodyType.b2_staticBody;
    bd.position = new B.b2Vec2(spec.x, spec.y);
    bd.rotation = new B.b2Rot(spec.rot.c, spec.rot.s);
    bd.linearVelocity = new B.b2Vec2(spec.vx, spec.vy);
    bd.linearDamping = spec.linearDamping;
    bd.angularDamping = spec.angularDamping;
    bd.userData = spec.id;
    const body = B.b2CreateBody(this.world, bd);
    const shapes: any[] = [];
    const polys: any[] = [];
    for (const box of spec.boxes) {
      const sd = B.b2DefaultShapeDef();
      sd.friction = spec.friction;
      sd.restitution = 0;
      sd.density = spec.density;
      sd.enableHitEvents = spec.dynamic;
      sd.enableContactEvents = false;
      sd.filter.categoryBits = spec.dynamic ? CAT_TOWER : CAT_STATIC;
      sd.filter.maskBits = CAT_TOWER | CAT_STATIC | CAT_HAZARD | CAT_QUERY;
      const poly = this.makePoly(box);
      polys.push(poly);
      shapes.push(B.b2CreatePolygonShape(body, sd, poly));
    }
    this.bodies.set(spec.id, { body, shapes, polys });
  }

  removeBody(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    B.b2DestroyBody(e.body);
    this.bodies.delete(id);
    for (const [jid, j] of this.joints) if (!B.b2Joint_IsValid(j)) this.joints.delete(jid);
  }

  hasBody(id: number): boolean { return this.bodies.has(id); }

  setStatic(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    B.b2Body_SetType(e.body, B.b2BodyType.b2_staticBody);
  }

  setLost(id: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    for (const s of e.shapes) {
      const f = B.b2DefaultFilter();
      f.categoryBits = CAT_LOST;
      f.maskBits = 0;
      B.b2Shape_SetFilter(s, f);
    }
    B.b2Body_SetAwake(e.body, true);
  }

  transform(id: number): Transform {
    const e = this.bodies.get(id)!;
    const t = B.b2Body_GetTransform(e.body);
    return { x: t.p.x, y: t.p.y, c: t.q.c, s: t.q.s };
  }

  velocity(id: number): Velocity {
    const e = this.bodies.get(id)!;
    const v = B.b2Body_GetLinearVelocity(e.body);
    return { vx: v.x, vy: v.y, w: B.b2Body_GetAngularVelocity(e.body) };
  }

  setVelocity(id: number, v: Velocity): void {
    const e = this.bodies.get(id);
    if (!e) return;
    B.b2Body_SetLinearVelocity(e.body, new B.b2Vec2(v.vx, v.vy));
    B.b2Body_SetAngularVelocity(e.body, v.w);
  }

  setBullet(id: number, on: boolean): void {
    const e = this.bodies.get(id);
    if (e) B.b2Body_SetBullet(e.body, on);
  }

  isAwake(id: number): boolean {
    const e = this.bodies.get(id);
    return !!e && B.b2Body_IsAwake(e.body);
  }

  mass(id: number): number {
    const e = this.bodies.get(id);
    return e ? B.b2Body_GetMass(e.body) : 0;
  }

  applyForce(id: number, fx: number, fy: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    B.b2Body_ApplyForceToCenter(e.body, new B.b2Vec2(fx, fy), true);
  }

  applyImpulse(id: number, jx: number, jy: number, px: number, py: number): void {
    const e = this.bodies.get(id);
    if (!e) return;
    B.b2Body_ApplyLinearImpulse(e.body, new B.b2Vec2(jx, jy), new B.b2Vec2(px, py), true);
  }

  overlapBoxes(boxes: ColliderBox[], x: number, y: number, rot: Rot): number[] {
    const out = new Set<number>();
    const xf = new B.b2Transform(new B.b2Vec2(x, y), new B.b2Rot(rot.c, rot.s));
    for (const box of boxes) {
      const poly = this.makePoly(box);
      B.b2World_OverlapPolygon(this.world, poly, xf, this.queryFilter, (shapeId: any) => {
        out.add(B.b2Body_GetUserData(B.b2Shape_GetBody(shapeId)));
        return true;
      }, null);
    }
    return [...out];
  }

  overlapPoint(x: number, y: number, half = 0.02): number[] {
    let poly = this.probeCache.get(half);
    if (!poly) { poly = B.b2MakeBox(half, half); this.probeCache.set(half, poly); }
    const out: number[] = [];
    const xf = new B.b2Transform(new B.b2Vec2(x, y), new B.b2Rot(1, 0));
    B.b2World_OverlapPolygon(this.world, poly, xf, this.queryFilter, (shapeId: any) => {
      out.push(B.b2Body_GetUserData(B.b2Shape_GetBody(shapeId)));
      return true;
    }, null);
    return out;
  }

  contacts(id: number): ContactInfo[] {
    const e = this.bodies.get(id);
    if (!e) return [];
    const n = B.b2Body_GetContactData(e.body, this.contactBuf, this.contactBuf.length);
    const out: ContactInfo[] = [];
    for (let i = 0; i < n; i++) {
      const cd = this.contactBuf[i];
      const ba = B.b2Body_GetUserData(B.b2Shape_GetBody(cd.shapeIdA));
      const bb = B.b2Body_GetUserData(B.b2Shape_GetBody(cd.shapeIdB));
      const other = ba === id ? bb : ba;
      const m = cd.manifold;
      const points: [number, number][] = [];
      for (let k = 0; k < m.pointCount; k++) points.push([m.points[k].pointX, m.points[k].pointY]);
      out.push({ other, points });
    }
    return out;
  }

  addWeld(a: number, b: number, ax: number, ay: number, hertz: number, damping: number): number {
    const ea = this.bodies.get(a), eb = this.bodies.get(b);
    if (!ea || !eb) return 0;
    const jd = B.b2DefaultWeldJointDef();
    jd.bodyIdA = ea.body;
    jd.bodyIdB = eb.body;
    const anchor = new B.b2Vec2(ax, ay);
    jd.localAnchorA = B.b2Body_GetLocalPoint(ea.body, anchor);
    jd.localAnchorB = B.b2Body_GetLocalPoint(eb.body, anchor);
    const qa = B.b2Body_GetRotation(ea.body), qb = B.b2Body_GetRotation(eb.body);
    // Relative rotation of B in A's frame, through the port's portable atan2 (QA-004), so every
    // device computes the same angle.
    const rc = qa.c * qb.c + qa.s * qb.s, rs = qa.c * qb.s - qa.s * qb.c;
    jd.referenceAngle = B.b2Rot_GetAngle(new B.b2Rot(rc, rs));
    jd.linearHertz = hertz;
    jd.angularHertz = hertz;
    jd.linearDampingRatio = damping;
    jd.angularDampingRatio = damping;
    jd.collideConnected = true;
    const j = B.b2CreateWeldJoint(this.world, jd);
    const jid = this.nextJoint++;
    this.joints.set(jid, j);
    return jid;
  }

  weldLoad(joint: number): { force: number; torque: number } | null {
    const j = this.joints.get(joint);
    if (!j || !B.b2Joint_IsValid(j)) return null;
    const ba = B.b2Joint_GetBodyA(j), bb = B.b2Joint_GetBodyB(j);
    if (!B.b2Body_IsAwake(ba) && !B.b2Body_IsAwake(bb)) return null;
    try {
      const f = B.b2Joint_GetConstraintForce(j);
      const t = B.b2Joint_GetConstraintTorque(j);
      return { force: Math.sqrt(f.x * f.x + f.y * f.y), torque: Math.abs(t) };
    } catch {
      return null;
    }
  }

  removeWeld(joint: number): void {
    const j = this.joints.get(joint);
    this.joints.delete(joint);
    if (!j || !B.b2Joint_IsValid(j)) return;
    try { B.b2DestroyJoint(j); } catch (err) { console.warn('weld destroy failed', err); }
  }

  step(dt: number, subSteps: number): void {
    B.b2World_Step(this.world, dt, subSteps);
  }

  hits(): HitInfo[] {
    const ev = B.b2World_GetContactEvents(this.world);
    const out: HitInfo[] = [];
    for (let i = 0; i < ev.hitCount; i++) {
      const h = ev.hitEvents[i];
      const a = B.b2Body_GetUserData(B.b2Shape_GetBody(h.shapeIdA));
      const b = B.b2Body_GetUserData(B.b2Shape_GetBody(h.shapeIdB));
      out.push({ a, b, speed: h.approachSpeed, x: h.pointX, y: h.pointY });
    }
    return out;
  }

  dispose(): void {
    this.bodies.clear();
    this.joints.clear();
    B.b2DestroyWorld(this.world);
  }
}
