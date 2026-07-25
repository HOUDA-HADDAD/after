import { z } from 'zod';

/**
 * The placeholder shipped in `.env.example`. Refusing to boot on this value in production is
 * the difference between "we documented the variable" and "nobody deployed with the example
 * secret" (docs/07-security.md, Secrets & configuration).
 */
export const EXAMPLE_SESSION_SECRET = 'replace-me-with-32-plus-random-bytes-base64';

/** Env vars arrive as strings; these helpers keep the coercions honest and readable. */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')
    .default(defaultValue ? 'true' : 'false');

const intFromEnv = (defaultValue: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromEnv(3000, 1, 65535),
    HOST: z.string().min(1).default('0.0.0.0'),

    /** Origin allowlist for the CSRF Origin check, and the canonical public URL. */
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),

    /* ---- Database ------------------------------------------------------------------ */
    /** Pooled connection used by the application. */
    DATABASE_URL: z.string().url().startsWith('postgres'),
    /** Unpooled connection used only by `prisma migrate deploy`. */
    DIRECT_DATABASE_URL: z.string().url().startsWith('postgres').optional(),

    /* ---- Sessions ------------------------------------------------------------------ */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_DAYS: intFromEnv(30, 1, 365),

    /* ---- Game lifecycle (docs/00-spec-decisions.md D11, D14) ----------------------- */
    /** How long a finished timeline stays readable before it is hard-deleted. */
    SESSION_GRACE_HOURS: intFromEnv(24, 1, 168),
    /** Inactivity before a live game is abandoned. */
    SESSION_IDLE_TTL_MINUTES: intFromEnv(180, 5, 1440),

    /* ---- Password hashing (OWASP minimums; raise without a code change) ------------ */
    ARGON2_MEMORY_KIB: intFromEnv(19456, 8192, 1048576),
    ARGON2_TIME_COST: intFromEnv(2, 1, 10),
    ARGON2_PARALLELISM: intFromEnv(1, 1, 16),

    /* ---- Limits -------------------------------------------------------------------- */
    MAX_GROUP_MEMBERS: intFromEnv(50, 2, 500),
    MAX_SESSION_PLAYERS: intFromEnv(30, 2, 100),

    /* ---- Operations ---------------------------------------------------------------- */
    RATE_LIMIT_ENABLED: booleanFromEnv(true),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Where the built SPA lives, relative to the API process. Production only. */
    WEB_DIST_PATH: z.string().default('../web/dist'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.SESSION_SECRET === EXAMPLE_SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message:
          'SESSION_SECRET is still the example value from .env.example. Generate a real one.',
      });
    }

    if (env.APP_ORIGIN.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must use https in production — secure cookies require it.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Thrown at boot when configuration is missing or malformed. Never caught — we want the exit. */
export class EnvValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  • ${issue}`).join('\n')}\n` +
        `See .env.example and docs/09-deployment.md for the full variable reference.`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Parse and validate configuration.
 *
 * Deliberately throws rather than falling back to defaults: a service that boots with a missing
 * secret is worse than a service that does not boot.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  return result.data;
}
