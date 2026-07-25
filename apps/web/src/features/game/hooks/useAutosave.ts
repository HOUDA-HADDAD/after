import { useEffect, useRef } from 'react';

/** The spec's debounce: long enough not to type-storm the server, short enough to feel safe. */
export const AUTOSAVE_DELAY_MS = 800;

/**
 * Save a draft after the typing stops.
 *
 * A closed laptop or a dropped connection should cost nothing, so what the player has typed is
 * pushed to the server without them asking. Three details make this behave rather than merely
 * work:
 *
 *   - the saved value is remembered, so idle re-renders do not re-send the same text;
 *   - the timer resets on every keystroke, so a fast typist produces one request, not thirty;
 *   - unmounting flushes, because leaving the screen is exactly when an unsaved draft hurts.
 *
 * `save` is held in a ref rather than listed as a dependency: a mutation function's identity
 * changes on every render, and depending on it would restart the timer forever and never fire.
 */
export function useAutosave(
  value: string,
  save: (value: string) => void,
  { enabled = true, delay = AUTOSAVE_DELAY_MS }: { enabled?: boolean; delay?: number } = {},
): void {
  const saveRef = useRef(save);
  const lastSaved = useRef(value);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!enabled || value === lastSaved.current) return;

    pending.current = value;

    const timer = setTimeout(() => {
      lastSaved.current = value;
      pending.current = null;
      saveRef.current(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, enabled, delay]);

  // Flush on unmount. Runs once, on the way out, with whatever the last timer never got to send.
  useEffect(
    () => () => {
      if (pending.current !== null && pending.current !== lastSaved.current) {
        saveRef.current(pending.current);
      }
    },
    [],
  );
}
