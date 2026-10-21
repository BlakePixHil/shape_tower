// Connects Gameplay's JuiceBus (or any emitter with on/off) to the director.
// One line in the game: `const unhook = connectJuiceBus(juiceBus, audio)`.

import { JUICE_EVENTS, type BusLike, type Payload } from './types';

export interface EventSink {
  handle(name: string, payload?: Payload): void;
  /** told when a new bus connects, so a run left going on the old one can close */
  attach?(): void;
}

/**
 * Subscribes `sink` to every JuiceBus event. Returns a function that unsubscribes them all.
 * Connect each new run's bus (a new sim) the same way: a run still going on the old bus closes quietly.
 */
export function connectJuiceBus(bus: BusLike, sink: EventSink, events: readonly string[] = JUICE_EVENTS): () => void {
  sink.attach?.();
  const handlers = events.map((name) => {
    const fn = (payload?: unknown) => sink.handle(name, toPayload(payload));
    bus.on(name, fn);
    return [name, fn] as const;
  });
  return () => {
    for (const [name, fn] of handlers) bus.off?.(name, fn);
  };
}

function toPayload(p: unknown): Payload {
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : undefined;
}
