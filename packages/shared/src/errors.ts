/**
 * The error contract shared by the API and the client.
 *
 * The client maps `code` to human copy, so error messages can be reworded (or translated) without
 * anyone string-matching English. Wire format is RFC 9457 `application/problem+json`.
 * See docs/01-architecture.md §8.
 */

export const ERROR_CODES = {
  // 400 — the request itself is wrong
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EMPTY_CONTENT: 'EMPTY_CONTENT',

  // 401 / 403 — who you are, and what you may do
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  MEMBER_GAME_BLOCKED: 'MEMBER_GAME_BLOCKED',

  // 404 — also returned for resources you are not a member of, so existence never leaks
  NOT_FOUND: 'NOT_FOUND',
  SESSION_GONE: 'SESSION_GONE',

  // 409 — the request is valid but the world is not in the right state
  CONFLICT: 'CONFLICT',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',
  SESSION_PHASE_INVALID: 'SESSION_PHASE_INVALID',
  SESSION_TOO_FEW_PLAYERS: 'SESSION_TOO_FEW_PLAYERS',
  SESSION_ROSTER_LOCKED: 'SESSION_ROSTER_LOCKED',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  INVITE_UNUSABLE: 'INVITE_UNUSABLE',

  // 429 / 500
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** RFC 9457 problem document. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  /** Field-level messages, present only for validation failures. */
  errors?: Record<string, string[]>;
}

export const PROBLEM_TYPE_BASE = 'https://aftergame.app/errors/';

const toProblemType = (code: ErrorCode): string =>
  `${PROBLEM_TYPE_BASE}${code.toLowerCase().replaceAll('_', '-')}`;

export interface AppErrorOptions {
  detail?: string;
  errors?: Record<string, string[]>;
  cause?: unknown;
}

/**
 * Base class for every error we raise deliberately.
 *
 * Anything that is *not* an AppError is a bug: the error handler logs it with a request id and
 * returns a generic 500, so internal messages never reach a client.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly detail: string | undefined;
  public readonly errors: Record<string, string[]> | undefined;

  constructor(code: ErrorCode, status: number, title: string, options: AppErrorOptions = {}) {
    super(title, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.detail = options.detail;
    this.errors = options.errors;
  }

  /** Serialize for the wire. `instance` is the request id, so a user can quote it in a report. */
  public toProblem(instance?: string): ProblemDetails {
    return {
      type: toProblemType(this.code),
      title: this.message,
      status: this.status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(instance === undefined ? {} : { instance }),
      ...(this.errors === undefined ? {} : { errors: this.errors }),
    };
  }

  public static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}

export class ValidationError extends AppError {
  constructor(errors: Record<string, string[]>, detail?: string) {
    super(ERROR_CODES.VALIDATION_FAILED, 400, 'Request validation failed', {
      errors,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(detail?: string) {
    super(ERROR_CODES.UNAUTHENTICATED, 401, 'Authentication required', {
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.FORBIDDEN, detail?: string) {
    super(code, 403, 'You are not allowed to do that', {
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

/**
 * Also the correct response for a resource you are simply not a member of — 403 would confirm
 * that the group or session exists (docs/07-security.md, Authorization).
 */
export class NotFoundError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.NOT_FOUND, detail?: string) {
    super(code, 404, 'Not found', { ...(detail === undefined ? {} : { detail }) });
  }
}

export class ConflictError extends AppError {
  constructor(
    code: ErrorCode = ERROR_CODES.CONFLICT,
    title = 'Conflicting state',
    detail?: string,
  ) {
    super(code, 409, title, { ...(detail === undefined ? {} : { detail }) });
  }
}

export class RateLimitedError extends AppError {
  constructor(detail?: string) {
    super(ERROR_CODES.RATE_LIMITED, 429, 'Too many requests', {
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super(ERROR_CODES.INTERNAL, 500, 'Something went wrong', {
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
