import { act } from '@testing-library/react';

type Handler = (payload?: unknown) => void;

/**
 * A Socket.IO client double the test drives from the server side.
 *
 * The point is the resync contract, which is ours rather than Socket.IO's: on reconnect the
 * provider replays its room subscriptions and invalidates the cache. A stub that only records
 * calls cannot show that, because the interesting behaviour is what happens when the *server*
 * says `connect` for the second time. This double lets a test say exactly that, and inspect the
 * traffic the provider produced in response.
 */
export class FakeSocket {
  readonly emitted: { event: string; args: unknown[] }[] = [];
  connected = false;
  closed = false;

  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    let set = this.handlers.get(event);

    if (set === undefined) {
      set = new Set();
      this.handlers.set(event, set);
    }

    set.add(handler);

    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);

    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });

    return this;
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    this.handlers.clear();
  }

  /* ---- the server side, for tests ---------------------------------------------------------- */

  /** Deliver a server event. Wrapped in `act` because every handler ends in a React update. */
  deliver(event: string, payload?: unknown): void {
    act(() => {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
    });
  }

  serverConnect(): void {
    this.connected = true;
    this.deliver('connect');
  }

  serverDisconnect(reason = 'transport close'): void {
    this.connected = false;
    this.deliver('disconnect', reason);
  }

  /** Events emitted by the client since the last call, oldest first. */
  emittedSince(mark: number): { event: string; args: unknown[] }[] {
    return this.emitted.slice(mark);
  }
}

const sockets: FakeSocket[] = [];

/** Stands in for `io()`. */
export function createFakeSocket(): FakeSocket {
  const socket = new FakeSocket();

  sockets.push(socket);

  return socket;
}

/** The socket the component under test is holding. Fails loudly rather than returning undefined. */
export function currentSocket(): FakeSocket {
  const socket = sockets.at(-1);

  if (socket === undefined) throw new Error('no socket was opened');

  return socket;
}

export function resetSockets(): void {
  sockets.length = 0;
}
