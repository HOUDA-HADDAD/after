import type { ErrorCode, ProblemDetails } from '@aftergame/shared';

/**
 * A failed request, carrying the server's stable error code.
 *
 * The client never matches on English prose — it maps `code` to copy, so wording can change (or
 * be translated) on either side without breaking the other.
 */
export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly fieldErrors: Record<string, string[]>;

  constructor(problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
    this.code = problem.code;
    this.status = problem.status;
    this.fieldErrors = problem.errors ?? {};
  }
}

/** Thrown when the network failed outright — no response, so no code to map. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the server', { cause });
    this.name = 'NetworkError';
  }
}

const isProblem = (value: unknown): value is ProblemDetails =>
  typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string';

/**
 * Same-origin fetch with cookies attached.
 *
 * `credentials: 'same-origin'` is what carries the session cookie. It works because the API and
 * the client share one origin in both development and production — see docs/01-architecture.md.
 */
export async function apiFetch<TResponse>(
  path: string,
  init: RequestInit = {},
): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  if (response.status === 204) return undefined as TResponse;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isProblem(body)) throw new ApiError(body);

    throw new ApiError({
      type: 'about:blank',
      title: 'Something went wrong',
      status: response.status,
      code: 'INTERNAL',
    });
  }

  return body as TResponse;
}

export const apiPost = <TResponse>(path: string, payload?: unknown): Promise<TResponse> =>
  apiFetch<TResponse>(path, {
    method: 'POST',
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
