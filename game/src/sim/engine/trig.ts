// Sine and cosine from basic arithmetic only, so every device gets the same bits (gameplay.md
// §13.4: phone JavaScript engines can disagree in the last digits of Math.sin and Math.cos).
// fdlibm's kernels with a Cody-Waite reduction; accurate to about 1 ulp for |x| up to a few
// thousand radians, which covers any body angle. The Rapier adapter needs it because this
// Rapier build reports rotations as angles, not as a cosine and sine pair.

const PIO2_HI = 1.57079632673412561417e+00; // the first 33 bits of π/2
const PIO2_LO = 6.07710050650619224932e-11; // π/2 − PIO2_HI
const INV_PIO2 = 6.36619772367581382433e-01;

function kSin(x: number): number {
  const z = x * x, v = z * x;
  const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
  return x + v * (-1.66666666666666324348e-01 + z * r);
}

function kCos(x: number): number {
  const z = x * x;
  const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
  return 1 - (0.5 * z - z * r);
}

/** cos(x) and sin(x) together. */
export function cosSin(x: number): { c: number; s: number } {
  const n = Math.round(x * INV_PIO2);
  const y = (x - n * PIO2_HI) - n * PIO2_LO;
  const c = kCos(y), s = kSin(y);
  switch (n & 3) {
    case 0: return { c, s };
    case 1: return { c: -s, s: c };
    case 2: return { c: -c, s: -s };
    default: return { c: s, s: -c };
  }
}
