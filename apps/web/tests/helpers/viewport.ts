import { act } from '@testing-library/react';

type Listener = () => void;

const listeners = new Set<Listener>();
let currentWidth = 1440;

/**
 * A `matchMedia` that actually responds to a width.
 *
 * happy-dom does not implement it, and a stub that always answers `false` would make every
 * breakpoint test vacuously pass. This one parses `(min-width: Npx)` and `(max-width: Npx)` —
 * the only forms the app uses — and notifies subscribers when the width changes, which is what
 * lets a test assert that the layout actually reflows rather than that it rendered once.
 */
function install(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const evaluate = (): boolean => {
        const min = /\(min-width:\s*(\d+)px\)/.exec(query);
        if (min?.[1] !== undefined) return currentWidth >= Number(min[1]);

        const max = /\(max-width:\s*(\d+)px\)/.exec(query);
        if (max?.[1] !== undefined) return currentWidth <= Number(max[1]);

        return false;
      };

      return {
        get matches() {
          return evaluate();
        },
        media: query,
        onchange: null,
        addEventListener: (_event: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_event: string, listener: Listener) => {
          listeners.delete(listener);
        },
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => {
          listeners.delete(listener);
        },
        dispatchEvent: () => true,
      } as unknown as MediaQueryList;
    },
  });
}

install();

/**
 * Set the simulated viewport width and notify anything watching a media query.
 *
 * The notification is wrapped in `act` because `useMediaQuery` subscribes through
 * `useSyncExternalStore`: a resize is a React state update in disguise, and letting it escape
 * `act` means assertions can run against a layout React has not finished re-rendering.
 */
export function setViewportWidth(width: number): void {
  currentWidth = width;
  window.innerWidth = width;

  act(() => {
    for (const listener of listeners) listener();
  });
}

/** The three widths the design commits to supporting. */
export const VIEWPORTS = {
  phone: 320,
  tablet: 768,
  desktop: 1440,
} as const;
