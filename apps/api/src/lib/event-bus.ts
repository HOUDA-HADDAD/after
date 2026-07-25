/**
 * The in-process event bus.
 *
 * Services publish; the WebSocket gateway subscribes. That indirection is what keeps the write
 * path single: clients never mutate over the socket, so every change goes through one HTTP
 * handler, one authorization pass and one transaction, and the socket is purely delivery
 * (docs/01-architecture.md §7).
 *
 * It is also the seam where a multi-instance adapter plugs in. Until then, one process means one
 * bus, and that is genuinely all the deployment needs.
 */

export interface SessionEventMap {
  /** The phase moved. Carries no identity, so it can be broadcast to the whole room. */
  'session.phase_changed': { sessionId: string; groupId: string; phase: string };
  /** Aggregate counts only — never "Sarah submitted", which would defeat the anonymity. */
  'session.progress': { sessionId: string; submitted: number; required: number };
  'session.roster_changed': { sessionId: string; groupId: string };
  /** A new comment; subscribers refetch the timeline rather than trusting a pushed payload. */
  'timeline.comment_added': { sessionId: string; answerId: string };
  /** How many have decided. Never how they voted (D8a). */
  'session.reveal_progress': { sessionId: string; decided: number; total: number };
  /** A group's live game appeared or disappeared. */
  'group.session_changed': { groupId: string };
}

export type SessionEventName = keyof SessionEventMap;

type Listener<TName extends SessionEventName> = (payload: SessionEventMap[TName]) => void;

export interface EventBus {
  emit<TName extends SessionEventName>(name: TName, payload: SessionEventMap[TName]): void;
  on<TName extends SessionEventName>(name: TName, listener: Listener<TName>): () => void;
}

export function createEventBus(onError: (error: unknown) => void): EventBus {
  const listeners = new Map<SessionEventName, Set<Listener<SessionEventName>>>();

  return {
    emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        try {
          (listener as Listener<typeof name>)(payload);
        } catch (error) {
          // A broken subscriber must never fail the request that published the event — the write
          // has already committed, and delivery is best-effort by design.
          onError(error);
        }
      }
    },

    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set();

      bucket.add(listener as Listener<SessionEventName>);
      listeners.set(name, bucket);

      return () => {
        bucket.delete(listener as Listener<SessionEventName>);
      };
    },
  };
}
