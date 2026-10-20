// The bake worker: renders sounds off the main thread so baking never drops a
// frame. In the game: `import BakeWorker from '@audio/bake/worker?worker'` and
// pass `worker: () => new BakeWorker()` to createAudioDirector.

import { runJob, type BakeRequest, type BakeResponse } from './jobs';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage(msg: BakeResponse, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, jobs } = e.data;
  try {
    const out = jobs.map(runJob);
    scope.postMessage({ id, out }, out.flat().map((x) => x.buffer as ArrayBuffer));
  } catch (err) {
    scope.postMessage({ id, error: String(err) }, []);
  }
};
