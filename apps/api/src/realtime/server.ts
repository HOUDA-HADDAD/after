import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_NAME_INSECURE } from '@aftergame/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

const groupRoom = (groupId: string): string => `group:${groupId}`;
const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

/** Read the session cookie out of a raw handshake header. */
function cookieFromHandshake(header: string | undefined, name: string): string {
  if (header === undefined) return '';

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }

  return '';
}

/**
 * Real-time delivery.
 *
 * Two properties define this layer, and both are deliberate.
 *
 * **Clients never write over the socket.** Every mutation is an HTTP request, so there is one
 * authorization pass and one transaction boundary; the socket exists purely to say "something
 * changed" (docs/01-architecture.md §7).
 *
 * **No game content travels over the socket at all.** Events carry ids, phases and counts —
 * never a text, an answer, or a name. Clients react by refetching `GET /sessions/:id`, which goes
 * through the same projection and the same authorization as any other read. That is stronger than
 * projecting per socket: a channel that never carries identity cannot leak it, and there is no
 * second code path to keep in step with the first.
 */
const realtimePlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const cookieName =
    env.NODE_ENV === 'production' ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;

  const io = new Server(app.server, {
    path: '/socket.io',
    // Same origin in every environment, so there is no CORS to configure.
    serveClient: false,
  });

  /**
   * Authenticate at the handshake, not later.
   *
   * An unauthenticated socket is rejected before it can join anything, rather than being allowed
   * to connect and then policed on every message.
   */
  /** Socket.IO types `socket.data` as `any`; narrowing it once keeps every use honest. */
  interface SocketState {
    userId?: string;
  }

  const stateOf = (socket: Socket): SocketState => socket.data as SocketState;

  io.use((socket, next) => {
    const token = cookieFromHandshake(socket.handshake.headers.cookie, cookieName);

    app.auth
      .resolve(token)
      .then((resolved) => {
        if (resolved === null) {
          next(new Error('unauthorized'));
          return;
        }

        stateOf(socket).userId = resolved.user.id;
        next();
      })
      .catch((error: unknown) => {
        app.log.warn({ err: error }, 'socket handshake failed');
        next(new Error('unauthorized'));
      });
  });

  const currentUser = (socket: Socket): string => stateOf(socket).userId ?? '';

  io.on('connection', (socket) => {
    /**
     * Room membership is authorized on every join, never trusted from the client.
     *
     * The check is the same one the HTTP routes use, so a socket cannot reach a group the
     * requester could not already read.
     */
    socket.on('subscribe:group', (groupId: unknown) => {
      if (typeof groupId !== 'string') return;

      app.groups
        .detail(groupId, currentUser(socket))
        .then(() => socket.join(groupRoom(groupId)))
        .catch(() => {
          // Not a member: silently ignore rather than confirm the group exists.
        });
    });

    socket.on('subscribe:session', (sessionId: unknown) => {
      if (typeof sessionId !== 'string') return;

      app.sessions
        .getState(sessionId, currentUser(socket))
        .then(() => socket.join(sessionRoom(sessionId)))
        .catch(() => {
          // Not entitled: same silence.
        });
    });

    socket.on('unsubscribe:session', (sessionId: unknown) => {
      if (typeof sessionId === 'string') void socket.leave(sessionRoom(sessionId));
    });
  });

  /* ---- bus → rooms ---------------------------------------------------------------------- */

  app.events.on('session.phase_changed', (payload) => {
    io.to(sessionRoom(payload.sessionId)).emit('session:changed', { sessionId: payload.sessionId });
    io.to(groupRoom(payload.groupId)).emit('group:changed', { groupId: payload.groupId });
  });

  app.events.on('session.progress', (payload) => {
    // Counts only. "6 of 8", never "Sarah submitted" — the aggregate is the whole point.
    io.to(sessionRoom(payload.sessionId)).emit('session:progress', {
      sessionId: payload.sessionId,
      submitted: payload.submitted,
      required: payload.required,
    });
  });

  app.events.on('session.roster_changed', (payload) => {
    io.to(sessionRoom(payload.sessionId)).emit('session:changed', { sessionId: payload.sessionId });
    io.to(groupRoom(payload.groupId)).emit('group:changed', { groupId: payload.groupId });
  });

  app.events.on('timeline.comment_added', (payload) => {
    // The comment itself is not sent; clients refetch the timeline through the projection.
    io.to(sessionRoom(payload.sessionId)).emit('session:changed', { sessionId: payload.sessionId });
  });

  app.events.on('session.reveal_progress', (payload) => {
    // `decided / total` and nothing else. The split is never computed, so it cannot be sent (D8a).
    io.to(sessionRoom(payload.sessionId)).emit('session:reveal-progress', {
      sessionId: payload.sessionId,
      decided: payload.decided,
      total: payload.total,
    });
  });

  app.events.on('group.session_changed', (payload) => {
    io.to(groupRoom(payload.groupId)).emit('group:changed', { groupId: payload.groupId });
  });

  app.decorate('io', io);

  app.addHook('onClose', async () => {
    await io.close();
  });
};

export default fp(realtimePlugin, { name: 'realtime', dependencies: ['auth', 'services'] });
