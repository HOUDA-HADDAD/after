import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { queryKeys } from '../api/queries.js';

export type ConnectionState = 'connecting' | 'live' | 'offline';

interface SocketContextValue {
  connection: ConnectionState;
  /** Watch a group for roster and live-game changes. Returns an unsubscribe. */
  subscribeToGroup: (groupId: string) => () => void;
  subscribeToSession: (sessionId: string) => () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * The live connection.
 *
 * Events are **notifications, not payloads** — they carry ids and counts, never game content. The
 * client reacts by invalidating the affected query, so the refetch goes through the same
 * projection and authorization as any other read (docs/01-architecture.md §7). One consequence
 * worth stating: there is no code path here that could render stale-but-privileged data, because
 * nothing privileged ever arrives on this channel.
 *
 * Reconnection is Socket.IO's, and the resync is ours: on every reconnect the subscriptions are
 * replayed and the cache invalidated, which is what turns a dropped socket into a brief pause
 * rather than a stale screen.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const socketRef = useRef<Socket | null>(null);
  /** Rooms we want to be in, kept so they can be re-joined after a reconnect. */
  const groupRooms = useRef(new Set<string>());
  const sessionRooms = useRef(new Set<string>());

  useEffect(() => {
    const socket = io({ path: '/socket.io', withCredentials: true });
    socketRef.current = socket;

    const resubscribe = (): void => {
      for (const groupId of groupRooms.current) socket.emit('subscribe:group', groupId);
      for (const sessionId of sessionRooms.current) socket.emit('subscribe:session', sessionId);
    };

    socket.on('connect', () => {
      setConnection('live');
      resubscribe();

      // Anything could have changed while we were away, and we have no way to know what — so
      // everything is refetched rather than guessed at.
      void queryClient.invalidateQueries();
    });

    socket.on('disconnect', () => {
      setConnection('offline');
    });
    socket.on('connect_error', () => {
      setConnection('offline');
    });

    socket.on('group:changed', ({ groupId }: { groupId: string }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    });

    socket.on('session:changed', ({ sessionId }: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    });

    socket.on('session:progress', ({ sessionId }: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    });

    socket.on('session:reveal-progress', ({ sessionId }: { sessionId: string }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [queryClient]);

  /**
   * The subscribe functions are stable for the provider's whole life, and that matters.
   *
   * They only touch refs, so there is nothing to close over — but if their identity changed with
   * `connection`, every subscriber's effect would tear down and re-run on each connection blip,
   * and rooms would be re-joined as a side effect of that churn. It would look like it worked,
   * while the reconnect handler below was doing nothing. Keeping them stable leaves exactly one
   * mechanism responsible for rejoining rooms, which is the one that can be tested.
   */
  const subscribeToGroup = useCallback((groupId: string) => {
    groupRooms.current.add(groupId);
    socketRef.current?.emit('subscribe:group', groupId);

    return () => {
      groupRooms.current.delete(groupId);
    };
  }, []);

  const subscribeToSession = useCallback((sessionId: string) => {
    sessionRooms.current.add(sessionId);
    socketRef.current?.emit('subscribe:session', sessionId);

    return () => {
      sessionRooms.current.delete(sessionId);
      socketRef.current?.emit('unsubscribe:session', sessionId);
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({ connection, subscribeToGroup, subscribeToSession }),
    [connection, subscribeToGroup, subscribeToSession],
  );

  return <SocketContext value={value}>{children}</SocketContext>;
}

export function useSocket(): SocketContextValue {
  const context = use(SocketContext);

  if (context === null) throw new Error('useSocket must be used inside a SocketProvider');

  return context;
}

/** Keep a group's data live for as long as the component is mounted. */
export function useGroupSubscription(groupId: string | undefined): void {
  const { subscribeToGroup } = useSocket();

  useEffect(() => {
    if (groupId === undefined) return;

    return subscribeToGroup(groupId);
  }, [groupId, subscribeToGroup]);
}

export function useSessionSubscription(sessionId: string | undefined): void {
  const { subscribeToSession } = useSocket();

  useEffect(() => {
    if (sessionId === undefined) return;

    return subscribeToSession(sessionId);
  }, [sessionId, subscribeToSession]);
}
