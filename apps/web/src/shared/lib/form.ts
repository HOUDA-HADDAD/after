/**
 * Shared form behaviour.
 *
 * Small enough to inline in a page and duplicated the moment there are two of them, which is the
 * usual way a second form ends up behaving subtly differently from the first.
 */

/**
 * Send focus to the first field the schema or the server rejected.
 *
 * Without this, a failed submit leaves focus on the button: a sighted user scans back up the form
 * hunting for red text, and a screen-reader user is told an error exists somewhere above them and
 * has to go looking for it. Focusing the field puts the caret exactly where the fix has to happen
 * and reads the message aloud on arrival, because `Field` wires the message to the input with
 * `aria-describedby`.
 *
 * `order` is the visual order of the fields, so "first invalid" means first on screen rather than
 * whichever key the validator happened to report first.
 */
export function focusFirstInvalid(order: readonly string[], errors: Record<string, string>): void {
  const field = order.find((name) => errors[name] !== undefined);

  if (field !== undefined) document.getElementById(field)?.focus();
}
