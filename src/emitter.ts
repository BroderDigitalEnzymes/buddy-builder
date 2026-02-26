// ─── Tiny typed event emitter ───────────────────────────────────
// Zero dependencies. Factory function, not a class.

type Listener<T> = (data: T) => void;

export type Emitter<EventMap extends Record<string, unknown>> = {
  on<K extends keyof EventMap & string>(event: K, fn: Listener<EventMap[K]>): () => void;
  once<K extends keyof EventMap & string>(event: K, fn: Listener<EventMap[K]>): () => void;
  off<K extends keyof EventMap & string>(event: K, fn: Listener<EventMap[K]>): void;
  emit<K extends keyof EventMap & string>(event: K, data: EventMap[K]): void;
};

export function createEmitter<
  EventMap extends Record<string, unknown>,
>(): Emitter<EventMap> {
  const listeners = new Map<string, Set<Listener<any>>>();

  const bucket = (event: string): Set<Listener<any>> => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  };

  return {
    on(event, fn) {
      bucket(event).add(fn);
      return () => bucket(event).delete(fn);
    },

    once(event, fn) {
      const wrapper: Listener<any> = (data) => {
        bucket(event).delete(wrapper);
        fn(data);
      };
      bucket(event).add(wrapper);
      return () => bucket(event).delete(wrapper);
    },

    off(event, fn) {
      bucket(event).delete(fn);
    },

    emit(event, data) {
      for (const fn of [...bucket(event)]) {
        try {
          fn(data);
        } catch (err) {
          console.error(`[emitter] listener error on "${event}":`, err);
        }
      }
    },
  };
}
