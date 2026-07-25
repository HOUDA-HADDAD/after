import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useSession } from './SessionProvider.js';

/**
 * Route guard.
 *
 * This is a redirect for the user's benefit, not a security control — the API authorises every
 * request independently, so a determined visitor who bypasses this reaches nothing but 401s.
 * While the session is being resolved we render a placeholder rather than redirecting, otherwise
 * a signed-in user reloading the page would be bounced to the login screen for a frame.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center text-sm text-[var(--color-ink-muted)]"
      >
        Loading…
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
