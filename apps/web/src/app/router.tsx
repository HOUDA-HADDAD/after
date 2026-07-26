import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { SessionProvider } from '../features/auth/SessionProvider.js';
import { RequireAuth } from '../features/auth/RequireAuth.js';
import LoginPage from '../features/auth/LoginPage.js';
import RegisterPage from '../features/auth/RegisterPage.js';
import GroupsPage from '../features/groups/GroupsPage.js';
import GroupDetailPage from '../features/groups/GroupDetailPage.js';
import GamePage from '../features/game/GamePage.js';
import { AppShell } from '../shared/components/AppShell.js';
import { RouteErrorBoundary } from '../shared/components/RouteErrorBoundary.js';
import { SocketProvider } from '../shared/realtime/SocketProvider.js';
import { createQueryClient } from '../shared/api/queries.js';
import { useTheme } from '../shared/hooks/useTheme.js';
import { LocaleProvider } from '../shared/i18n/LocaleProvider.js';

/** Everything behind the login wall shares the shell, the socket and the error boundary. */
function Protected({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <SocketProvider>
        <AppShell>
          <RouteErrorBoundary>{children}</RouteErrorBoundary>
        </AppShell>
      </SocketProvider>
    </RequireAuth>
  );
}

/** Toasts follow the app's theme rather than guessing from the system. */
function ThemedToaster() {
  const { theme } = useTheme();

  return <Toaster theme={theme} position="bottom-right" closeButton richColors />;
}

export function AppRouter() {
  // Created once per app instance, not per render, so the cache survives navigation.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <BrowserRouter>
          <SessionProvider>
            <ThemedToaster />

            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route
                path="/"
                element={
                  <Protected>
                    <GroupsPage />
                  </Protected>
                }
              />

              <Route
                path="/groups/:groupId"
                element={
                  <Protected>
                    <GroupDetailPage />
                  </Protected>
                }
              />

              <Route
                path="/groups/:groupId/games/:sessionId"
                element={
                  <Protected>
                    <GamePage />
                  </Protected>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SessionProvider>
        </BrowserRouter>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
