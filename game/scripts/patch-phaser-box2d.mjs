// Fixes bugs in phaser-box2d 1.1.0 (runs on npm install). Each fix is applied once; reruns skip it.
// When the port moves a body or joint between solver sets it copies the sim with Object.assign,
// so both slots share their nested transform and joint objects. The old slot is recycled later
// and zeroed, which teleports the moved body to (0, 0). That hit every piece turned to stone.
// The port's own deep copy (copyTo) is used instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../node_modules/phaser-box2d/dist/PhaserBox2D.js', import.meta.url));
const fixes = [
  // b2AddJointToGraph
  ['  const jointDst = b2CreateJointInGraph(world, joint);\n  Object.assign(jointDst, jointSim);',
   '  const jointDst = b2CreateJointInGraph(world, joint);\n  jointSim.copyTo(jointDst);'],
  // b2TransferBody
  ['  const targetSim = b2AddBodySim(targetSet.sims);\n  Object.assign(targetSim, sourceSim);',
   '  const targetSim = b2AddBodySim(targetSet.sims);\n  sourceSim.copyTo(targetSim);'],
  // b2TransferJoint
  ['    const targetSim = b2AddJoint(targetSet.joints);\n    Object.assign(targetSim, sourceSim);',
   '    const targetSim = b2AddJoint(targetSet.joints);\n    sourceSim.copyTo(targetSim);'],
  // b2DestroyWorld only reassigned a local, so the slot stayed in use and only 32 worlds could
  // ever be made. Put a fresh world back in the slot.
  ['  world = new b2World();\n  world.worldId = B2_NULL_INDEX;\n  world.revision = revision + 1;\n}',
   '  const slot = world.worldId;\n  world = new b2World();\n  world.worldId = B2_NULL_INDEX;\n  world.revision = revision + 1;\n  world.inUse = false;\n  b2_worlds[slot] = world;\n}'],
  // b2PrepareWeldJoint skips the b2UnwindAngle that upstream Box2D (and the port's revolute joint)
  // has, so an upside-down weld whose angle wobbles across ±π sees a 360° error and launches the
  // piece (QA-002).
  ['  joint.deltaAngle = b2RelativeAngle(qB, qA) - joint.referenceAngle;\n  const ka = iA + iB;',
   '  joint.deltaAngle = b2RelativeAngle(qB, qA) - joint.referenceAngle;\n  joint.deltaAngle = b2UnwindAngle(joint.deltaAngle);\n  const ka = iA + iB;'],
  // b2UpdateBodyMassData doesn't reset localCenter as upstream does, so a T, J or L turned to
  // stone keeps its old centre-of-mass offset while its centre moves to its origin. Contacts and
  // bonds on it then act about a point a quarter block away, and a bond to it kicks the piece
  // as soon as it is solved (QA-003).
  ['  bodySim.invInertia = 0;\n  bodySim.minExtent = B2_HUGE;',
   '  bodySim.invInertia = 0;\n  bodySim.localCenter = new b2Vec2();\n  bodySim.minExtent = B2_HUGE;'],
  // Math.atan2 may differ in its last bits between JavaScript engines, and bonds call it in every
  // step, so an Android phone and Node drifted apart (QA-004). Box2D v3.1's b2Atan2 uses only
  // + - * / abs min max, which every engine computes the same; upstream added it for this.
  ['function b2Rot_GetAngle(q3) {\n  return Math.atan2(q3.s, q3.c);\n}',
   `function b2Atan2(y, x) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const mx = Math.max(ay, ax);
  const mn = Math.min(ay, ax);
  const a = mn / (mx + 1.1754943508222875e-38);
  const s = a * a;
  const c = s * a;
  const q = s * s;
  let r = 0.024840285 * q + 0.18681418;
  const t = -0.094097948 * q - 0.33213072;
  r = r * s + t;
  r = r * c + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  if (y < 0) r = -r;
  return r;
}
function b2Rot_GetAngle(q3) {
  return b2Atan2(q3.s, q3.c);
}`],
  ['  const c2 = b.c * a.c + b.s * a.s;\n  return Math.atan2(s, c2);',
   '  const c2 = b.c * a.c + b.s * a.s;\n  return b2Atan2(s, c2);'],
];

let src = readFileSync(file, 'utf8');
let applied = 0;
for (const [from, to] of fixes) {
  if (src.includes(to)) continue;
  if (!src.includes(from)) throw new Error(`patch-phaser-box2d: expected code not found, check the phaser-box2d version:\n${from}`);
  src = src.replace(from, to);
  applied++;
}
if (applied) writeFileSync(file, src);
console.log(`patch-phaser-box2d: ${applied} of ${fixes.length} fixes applied (${fixes.length - applied} already in place)`);
