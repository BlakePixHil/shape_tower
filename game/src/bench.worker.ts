// Runs the silent benchmark off the main thread and posts the result back once.

import { runBench } from './sim/bench.ts';

const scope = self as unknown as { postMessage(msg: unknown): void };
try {
  scope.postMessage({ ok: true, result: runBench() });
} catch (e) {
  scope.postMessage({ ok: false, error: String(e) });
}
