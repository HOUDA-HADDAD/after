import fp from 'fastify-plugin';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@aftergame/config';
import {
  AppError,
  ERROR_CODES,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  type ProblemDetails,
} from '@aftergame/shared';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const send = (reply: FastifyReply, problem: ProblemDetails): FastifyReply =>
  reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);

/** Turn Fastify's schema validation output into field-keyed messages the client can render. */
const toFieldErrors = (error: FastifyError): Record<string, string[]> => {
  const fields: Record<string, string[]> = {};

  for (const issue of error.validation ?? []) {
    // instancePath looks like "/body/text"; fall back to the whole request.
    const field = issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'request';
    const message = issue.message ?? 'is invalid';
    fields[field] = [...(fields[field] ?? []), message];
  }

  return fields;
};

/**
 * One error handler for the whole API.
 *
 * Deliberate errors become RFC 9457 problem documents with a stable `code`. Anything else is a
 * bug: it is logged with the request id and returned as a generic 500, so internal messages and
 * stack traces never reach a client (docs/01-architecture.md §8).
 */
const errorHandlerPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const servesSpa = env.NODE_ENV === 'production';

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (AppError.isAppError(error)) {
      if (error.status >= 500) {
        request.log.error({ err: error, code: error.code }, 'request failed');
      } else {
        request.log.info({ code: error.code, status: error.status }, 'request rejected');
      }
      return send(reply, error.toProblem(request.id));
    }

    if (error.validation) {
      return send(reply, new ValidationError(toFieldErrors(error)).toProblem(request.id));
    }

    if (error.statusCode === 429) {
      return send(
        reply,
        new RateLimitedError('Slow down for a moment, then try again.').toProblem(request.id),
      );
    }

    // Malformed JSON and similar client mistakes arrive as 4xx without `validation`.
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return send(reply, new ValidationError({ request: [error.message] }).toProblem(request.id));
    }

    request.log.error({ err: error }, 'unhandled error');
    return send(reply, new InternalError(error).toProblem(request.id));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const isApiRoute = request.url.startsWith('/api') || request.url.startsWith('/socket.io');

    // In production the API also serves the SPA, so any non-API path is a client-side route.
    if (servesSpa && !isApiRoute && request.method === 'GET') {
      return reply.sendFile('index.html');
    }

    return send(
      reply,
      new NotFoundError(
        ERROR_CODES.NOT_FOUND,
        `No route for ${request.method} ${request.url}`,
      ).toProblem(request.id),
    );
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
