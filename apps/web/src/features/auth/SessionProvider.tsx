import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginInput, RegisterInput, SessionDto, UserDto } from '@aftergame/shared';
import { ApiError, apiFetch, apiPost } from '../../shared/api/client.js';

export type SessionState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: UserDto };

interface SessionContextValue {
  state: SessionState;
  register: (input: RegisterInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Session bootstrap.
 *
 * On load the app asks the API who it is talking to; a 401 simply means "nobody", which is a
 * normal answer rather than an error. The session itself lives in an httpOnly cookie the client
 * cannot read — this state is a cache of what the server already knows, never the source of
 * truth, which is why every protected action is still authorised server-side.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    apiFetch<SessionDto>('/auth/me')
      .then((session) => {
        if (!cancelled) setState({ status: 'authenticated', user: session.user });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 401 is the expected answer for a signed-out visitor, not a failure.
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'anonymous' });
          return;
        }
        setState({ status: 'anonymous' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const session = await apiPost<SessionDto>('/auth/register', input);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const session = await apiPost<SessionDto>('/auth/login', input);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<void>('/auth/logout');
    } finally {
      // Whatever the server said, this browser is signed out — logging out must never fail.
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo(
    () => ({ state, register, login, logout }),
    [state, register, login, logout],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const context = use(SessionContext);

  if (context === null) {
    throw new Error('useSession must be used inside a SessionProvider');
  }

  return context;
}
