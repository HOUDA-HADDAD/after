import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setViewportWidth } from './helpers/viewport.js';
import { resetSockets } from './helpers/socket.js';

afterEach(() => {
  cleanup();
  resetSockets();
  // Every test starts narrow, so a test that cares about the desktop layout has to say so.
  setViewportWidth(390);
  document.documentElement.classList.remove('dark');
  // The theme is persisted deliberately; leaking it into the next test is not.
  localStorage.clear();
});

setViewportWidth(390);

/**
 * No real transport in unit tests — but a double the test can drive, not a stub that ignores it.
 * A socket that never connects would make the reconnect contract untestable, which is the one
 * part of the realtime layer that is ours rather than Socket.IO's.
 */
vi.mock('socket.io-client', async () => {
  const { createFakeSocket } = await import('./helpers/socket.js');

  return { io: () => createFakeSocket() };
});
