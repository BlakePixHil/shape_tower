// Bakers run bake jobs in the background: in a worker when the game provides
// one, otherwise on the main thread one job per task so frames keep flowing.

import { runJob, type BakeJob, type BakeRequest, type BakeResponse } from './jobs';

export interface Baker {
  readonly name: string;
  bake(jobs: BakeJob[]): Promise<Float32Array[][]>;
  dispose?(): void;
}

export class ThreadBaker implements Baker {
  readonly name = 'main thread';
  /**
   * Runs `perTask` jobs per event-loop task, so a frame is never blocked by more
   * than that. 0 runs every job in one go right after the caller returns (offline tests).
   */
  constructor(private perTask = 1) {}

  async bake(jobs: BakeJob[]): Promise<Float32Array[][]> {
    const out: Float32Array[][] = [];
    // never render inside the caller's own task (a game event handler, say)
    if (this.perTask === 0) await Promise.resolve();
    for (let i = 0; i < jobs.length; i++) {
      if (this.perTask > 0 && i % this.perTask === 0) await idle();
      out.push(runJob(jobs[i]));
    }
    return out;
  }
}

export class WorkerBaker implements Baker {
  readonly name = 'worker';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Float32Array[][]) => void; reject: (e: Error) => void }>();
  private broken = false;

  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<BakeResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if ('error' in e.data) p.reject(new Error(e.data.error));
      else p.resolve(e.data.out);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      this.fail(new Error(`bake worker failed: ${e.message ?? 'unknown error'}`));
    };
  }

  bake(jobs: BakeJob[]): Promise<Float32Array[][]> {
    if (this.broken) return Promise.reject(new Error('bake worker unavailable'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, jobs } satisfies BakeRequest);
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  dispose(): void {
    this.fail(new Error('disposed'));
    this.worker.terminate();
  }

  private fail(e: Error): void {
    this.broken = true;
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
}

/** Uses the worker, and quietly falls back to the main thread if it ever fails. */
export class FallbackBaker implements Baker {
  private usingFallback = false;
  constructor(private primary: Baker, private fallback: Baker) {}

  get name(): string {
    return this.usingFallback ? this.fallback.name : this.primary.name;
  }

  async bake(jobs: BakeJob[]): Promise<Float32Array[][]> {
    if (!this.usingFallback) {
      try {
        return await this.primary.bake(jobs);
      } catch {
        this.usingFallback = true;
      }
    }
    return this.fallback.bake(jobs);
  }

  dispose(): void {
    this.primary.dispose?.();
  }
}

export const idle = () => new Promise<void>((r) => setTimeout(r, 0));
