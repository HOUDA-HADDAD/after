/**
 * A fixed-window counter for credential attempts, keyed by account.
 *
 * `@fastify/rate-limit` covers the per-IP dimension and does it well, but it takes one key per
 * route — and the dimension it cannot express is the one that matters most here: an attacker
 * spreading guesses for *one* account across many addresses. That is what this limits.
 *
 * In-process by design. The deployment is a single instance (docs/01-architecture.md §11), and
 * with several instances each would enforce its own share — degraded, never broken. If the app
 * ever scales out, this is the seam where a shared store plugs in.
 */
export interface AttemptLimiterOptions {
  /** Attempts permitted per key within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Upper bound on tracked keys, so a flood of distinct keys cannot exhaust memory. */
  maxKeys?: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface AttemptLimiter {
  /** Record an attempt. Returns false when the caller has exhausted its budget. */
  consume(key: string, now?: number): boolean;
  /** Forget a key — called after a successful login, so one typo does not haunt the user. */
  reset(key: string): void;
  /** Tracked key count. Exposed for tests. */
  size(): number;
}

export function createAttemptLimiter({
  max,
  windowMs,
  maxKeys = 10_000,
}: AttemptLimiterOptions): AttemptLimiter {
  const windows = new Map<string, Window>();

  /** Drop expired entries; if that is not enough, evict oldest-first. */
  const evictIfNeeded = (now: number): void => {
    if (windows.size < maxKeys) return;

    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }

    // Map iterates in insertion order, so this drops the least recently created windows.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done === true) break;
      windows.delete(oldest.value);
    }
  };

  return {
    consume(key, now = Date.now()) {
      const existing = windows.get(key);

      if (existing === undefined || existing.resetAt <= now) {
        evictIfNeeded(now);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      if (existing.count >= max) return false;

      existing.count += 1;
      return true;
    },

    reset(key) {
      windows.delete(key);
    },

    size() {
      return windows.size;
    },
  };
}
