import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';

/**
 * Query keys, in one place.
 *
 * Centralised so the socket layer can invalidate precisely — `['session', id]` rather than
 * everything — without every component agreeing on a string by convention.
 */
export const queryKeys = {
  me: ['me'] as const,
  groups: ['groups'] as const,
  group: (groupId: string) => ['group', groupId] as const,
  groupSession: (groupId: string) => ['group', groupId, 'session'] as const,
  punishments: (groupId: string) => ['group', groupId, 'punishments'] as const,
  invitations: (groupId: string) => ['group', groupId, 'invitations'] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
  themes: ['themes'] as const,
};

/**
 * A 401 means the session ended, and a 403/404 means the answer will not change.
 *
 * Retrying either is wasted work that also delays the honest error the user needs to see.
 */
const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiError && error.status < 500) return false;

  return failureCount < 2;
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // The socket tells us when something changed, so polling would be noise. Refetching on
        // focus stays on as the belt to that braces — it is what recovers a client whose socket
        // was asleep with the laptop lid.
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
