import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { SocketProvider } from '../../src/shared/realtime/SocketProvider.js';

/** A client that never retries and never caches, so tests are deterministic. */
const testQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });

export interface RenderOptions {
  /** Initial URL, so a route with params can be exercised. */
  route?: string;
  /** The path pattern the element is mounted at. */
  path?: string;
}

export function renderWithProviders(
  ui: ReactNode,
  { route = '/', path = '/' }: RenderOptions = {},
): RenderResult {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <SocketProvider>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </SocketProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Run axe over a rendered container and return the violations.
 *
 * Configured to WCAG 2.1 A and AA, which is the bar the design commits to. `color-contrast` is
 * excluded here and only here: happy-dom does not compute styles, so axe cannot measure contrast
 * and would report false failures. Contrast is checked against a real browser in the Playwright
 * pass (Phase 9); leaving the rule on in a DOM that cannot answer it would train everyone to
 * ignore the result.
 */
export async function findAccessibilityViolations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });

  return results.violations;
}

/** A readable failure message: which rule, on which element. */
export const describeViolations = (violations: axe.Result[]): string =>
  violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n  ${violation.nodes.map((node) => node.html).join('\n  ')}`,
    )
    .join('\n');
