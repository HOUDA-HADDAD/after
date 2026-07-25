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
 * Configured to WCAG 2.1 A and AA, which is the bar the design commits to.
 *
 * Two rules are disabled **in this layer only**, both because happy-dom cannot answer them —
 * not because the app fails them:
 *
 *   - `color-contrast` needs computed styles, and happy-dom computes none.
 *   - `aria-hidden-focus` needs real focusability. A modal marks the background `aria-hidden`
 *     and `inert`; a browser then reports its contents as unfocusable, but happy-dom does not
 *     implement `inert`, so axe sees an aria-hidden subtree full of focusable links. Radix's own
 *     focus-guard sentinels (`[data-radix-focus-guard]`, deliberately `tabindex="0"` and
 *     `aria-hidden`) trip the same rule.
 *
 * Both are covered against a real browser in the Playwright pass (Phase 9). Leaving a rule on in
 * an environment that cannot evaluate it produces failures nobody can act on, and teaches the
 * team to ignore the report — which costs more than the rule is worth.
 *
 * The behaviour those rules protect is asserted directly instead: the drawer traps focus, closes
 * on Escape, restores focus to its trigger, and marks the background inert.
 */
export async function findAccessibilityViolations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: {
      'color-contrast': { enabled: false },
      'aria-hidden-focus': { enabled: false },
    },
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
