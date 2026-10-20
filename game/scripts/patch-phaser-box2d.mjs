// Fixes bugs in phaser-box2d 1.1.0 (runs on npm install).
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
