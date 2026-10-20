// JuiceBus (gameplay.md §11.1): a tiny emitter with no Phaser dependency, so the sim runs headless.
// Every event is also kept in a log that tests drain with `drain()`.

export interface BusEvent { name: string; step: number; payload: Record<string, unknown> }

type Handler = (payload: any) => void;

export class JuiceBus {
  private handlers = new Map<string, Set<Handler>>();
  private log: BusEvent[] = [];
  keepLog = true;
  step = 0;

  on(name: string, fn: Handler): this {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return this;
  }

  off(name: string, fn: Handler): this {
    this.handlers.get(name)?.delete(fn);
    return this;
  }

  emit(name: string, payload: Record<string, unknown> = {}): void {
    if (this.keepLog) {
      this.log.push({ name, step: this.step, payload });
      if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
    }
    this.handlers.get(name)?.forEach(fn => fn(payload));
    this.handlers.get('*')?.forEach(fn => fn({ name, ...payload }));
  }

  drain(): BusEvent[] {
    const out = this.log;
    this.log = [];
    return out;
  }
}
