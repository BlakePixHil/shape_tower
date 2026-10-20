// Connects Gameplay's JuiceBus (or any emitter with on/off) to the director.
// One line in the game: `const unhook = connectJuiceBus(juiceBus, audio)`.

import { JUICE_EVENTS, type BusLike, type Payload } from './types';

export interface EventSink {
  handle(name: string, payload?: Payload): void;
}

/** Subscribes `sink` to every JuiceBus event. Returns a function that unsubscribes them all. */
export function connectJuiceBus(bus: BusLike, sink: EventSink, events: readonly string[] = JUICE_EVENTS): () => void {
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
