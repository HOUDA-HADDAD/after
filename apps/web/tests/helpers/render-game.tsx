import type { RenderResult } from '@testing-library/react';
import { renderWithProviders } from './render.js';
import { SessionProvider } from '../../src/features/auth/SessionProvider.js';
import GamePage from '../../src/features/game/GamePage.js';

/**
 * Render the game the way the app does: through the phase router, at a real route.
 *
 * Screens are deliberately not rendered in isolation. The interesting failures live in the seams
 * — a phase that routes to the wrong screen, a payload whose `you` is null, a viewer who is not a
 * player — and a test that hands a screen a hand-built prop object cannot see any of them.
 */
export function renderGame(sessionId = 's1', groupId = 'g1'): RenderResult {
  return renderWithProviders(
    <SessionProvider>
      <GamePage />
    </SessionProvider>,
    { route: `/groups/${groupId}/games/${sessionId}`, path: '/groups/:groupId/games/:sessionId' },
  );
}
