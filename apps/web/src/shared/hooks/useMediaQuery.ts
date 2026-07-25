import { useSyncExternalStore } from 'react';

/**
 * Track a media query.
 *
 * The shell uses this to render **one** navigation tree rather than two hidden by CSS. That is
 * not a stylistic preference: a tree hidden with `display:none` is invisible to a browser but
 * fully present in the DOM, so anything that reasons about the DOM alone — assistive technology
 * with the modal open, an automated audit, a focus trap — sees two copies of every link. One tree
 * at a time removes the whole class of problem.
 *
 * `useSyncExternalStore` rather than state plus an effect, so the first render already has the
 * right answer and there is no flash of the wrong layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);

      list.addEventListener('change', onChange);

      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => window.matchMedia(query).matches,
    // Server snapshot. There is no SSR here, but the API requires it and defaulting to the
    // narrow layout is the safer guess.
    () => false,
  );
}

/** The `md` breakpoint, matching Tailwind's. Above it the rail and sidebar are always visible. */
export const DESKTOP_QUERY = '(min-width: 768px)';
