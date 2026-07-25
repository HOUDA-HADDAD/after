import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { SessionStateDto } from '@aftergame/shared';
import { toast } from 'sonner';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { useSessionSubscription } from '../../shared/realtime/SocketProvider.js';
import { getSession } from './game.api.js';

/**
 * The live game.
 *
 * One query, subscribed to the session room, and every mutation writes the server's response
 * straight into that cache. There is no local model of a game anywhere in the client — the phase,
 * the roster, what the viewer may see, all of it comes from a payload the server projected for
 * this viewer. That is what makes "the client accidentally shows a name it should not" a bug that
 * cannot be written here (docs/01-architecture.md §3).
 */
export function useGame(sessionId: string): UseQueryResult<SessionStateDto> {
  useSessionSubscription(sessionId);

  return useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => getSession(sessionId),
    enabled: sessionId !== '',
    // The socket announces every change, so a fresh payload is never more than one event away.
    staleTime: 5_000,
  });
}

/**
 * A game action whose response is the new state of the game.
 *
 * The response replaces the cache rather than invalidating it, so the phase change is on screen
 * in the same frame as the click — no spinner between pressing "Start" and the writing screen.
 */
export function useGameAction<TArgs = void>(
  sessionId: string,
  action: (args: TArgs) => Promise<SessionStateDto>,
  { onSuccess }: { onSuccess?: (state: SessionStateDto) => void } = {},
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: action,
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.session(sessionId), state);
      onSuccess?.(state);
    },
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });
}

/** An action with no useful response — a comment, a guess. Refetch is the only way to see it. */
export function useGameEffect<TArgs = void>(
  sessionId: string,
  action: (args: TArgs) => Promise<void>,
  { onSuccess }: { onSuccess?: () => void } = {},
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      onSuccess?.();
    },
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });
}
