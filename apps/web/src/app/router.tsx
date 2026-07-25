import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SessionProvider } from '../features/auth/SessionProvider.js';
import { RequireAuth } from '../features/auth/RequireAuth.js';
import LoginPage from '../features/auth/LoginPage.js';
import RegisterPage from '../features/auth/RegisterPage.js';
import HomePage from '../features/home/HomePage.js';

/**
 * Application routes.
 *
 * Everything except the two auth screens sits behind `RequireAuth`. Code splitting arrives with
 * the app shell in Phase 7 — at three screens it would cost more than it saves.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
