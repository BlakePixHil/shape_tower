// Headless checks of the touch gestures (view/input.ts) with synthetic pointer events.
// Run: npm run gesture:check

export {};

(globalThis as unknown as { window: unknown }).window = { innerHeight: 800, innerWidth: 390, addEventListener() {}, removeEventListener() {} };
const { Gestures } = await import('../src/view/input.ts');

type P = [x: number, y: number, t: number];
let failures = 0;

/** Plays a one-finger path; returns the moves sent, the hard drop's locked x, and the shape's x. */
function play(path: P[]): { moves: number[]; lock: number | undefined | null; x: number } {
  const on: Record<string, (e: unknown) => void> = {};
  const el = { addEventListener: (n: string, f: (e: unknown) => void) => { on[n] = f; }, removeEventListener() {}, setPointerCapture() {} };
  let x = 0, lock: number | undefined | null = null;
  const moves: number[] = [];
  new Gestures(el as unknown as HTMLElement, {
    ctrlX: () => x, blockPx: () => 32.5, sensitivity: () => 1,
    moveTo: nx => { x = nx; moves.push(nx); }, rotate() {}, soft() {}, hard: lx => { lock = lx; if (lx !== undefined) x = lx; },
    hold() {}, peek() {}, splitTap: () => false,
  });
  const ev = ([cx, cy, t]: P) => ({ pointerId: 1, clientX: cx, clientY: cy, timeStamp: t, preventDefault() {} });
  on.pointerdown(ev(path[0]));
  for (const p of path.slice(1, -1)) on.pointermove(ev(p));
  on.pointerup(ev(path[path.length - 1]));
  return { moves, lock, x };
}

const line = (a: P, b: P, n: number): P[] => Array.from({ length: n }, (_, i) => [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * (i + 1) / n) as P);

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
  if (!ok) failures++;
}

// Blake's report: a flick that isn't straight down nudged the shape sideways.
for (const [deg, ms] of [[15, 180], [24, 150], [32, 150]]) {
  const dx = 200 * Math.tan((deg * Math.PI) / 180);
  const r = play([[200, 300, 0], [200, 300, 100], ...line([200, 300, 100], [200 + dx, 500, 100 + ms], 15)]);
  check(`${deg}° flick drops where the shape was`, r.lock === 0 && r.moves.length === 0, `lock ${r.lock}, moves [${r.moves}]`);
}
{
  const r = play([[200, 300, 0], [200, 300, 100], ...line([200, 300, 100], [273, 500, 400], 30)]);
  check('A long 20° swipe never steers', r.moves.length === 0, `moves [${r.moves}]`);
}
{
  const r = play([[200, 300, 0], ...line([200, 300, 0], [265, 300, 300], 20), ...line([265, 300, 300], [319, 500, 480], 18)]);
  check('Steer 2 blocks then flick at once: drops at +2', r.lock === 2 && r.x === 2, `lock ${r.lock}, moves [${r.moves}]`);
}
{
  const r = play([[200, 300, 0], ...line([200, 300, 0], [300, 400, 1000], 60)]);
  check('A slow diagonal drag still steers', r.x === 3 && r.lock === null, `x ${r.x}, moves [${r.moves}]`);
}
{
  const r = play([[200, 300, 0], ...line([200, 300, 0], [297, 302, 500], 30)]);
  check('A sideways drag steers in half blocks', r.x === 2.5, `x ${r.x}, moves [${r.moves}]`);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
if (failures) process.exit(1);
