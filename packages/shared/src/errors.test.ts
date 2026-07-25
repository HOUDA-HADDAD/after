import { describe, it, expect } from 'vitest';
import {
  AppError,
  ConflictError,
  ERROR_CODES,
  ForbiddenError,
  NotFoundError,
  PROBLEM_TYPE_BASE,
  ValidationError,
} from './index.js';

describe('AppError', () => {
  it('serializes to an RFC 9457 problem document', () => {
    const error = new ConflictError(
      ERROR_CODES.SESSION_ALREADY_ACTIVE,
      'A game is already running',
      'End the current game before starting another.',
    );

    expect(error.toProblem('req_123')).toEqual({
      type: `${PROBLEM_TYPE_BASE}session-already-active`,
      title: 'A game is already running',
      status: 409,
      code: 'SESSION_ALREADY_ACTIVE',
      detail: 'End the current game before starting another.',
      instance: 'req_123',
    });
  });

  it('omits optional members rather than emitting undefined', () => {
    const problem = new NotFoundError().toProblem();

    expect(problem).not.toHaveProperty('detail');
    expect(problem).not.toHaveProperty('instance');
    expect(problem).not.toHaveProperty('errors');
  });

  it('carries field errors for validation failures', () => {
    const problem = new ValidationError({ body: ['Write something first'] }).toProblem();

    expect(problem.status).toBe(400);
    expect(problem.errors).toEqual({ body: ['Write something first'] });
  });

  it('reports 404 for game-blocked-style membership misses so existence never leaks', () => {
    expect(new NotFoundError().status).toBe(404);
    expect(new ForbiddenError(ERROR_CODES.MEMBER_GAME_BLOCKED).status).toBe(403);
  });

  it('recognises its own instances', () => {
    expect(AppError.isAppError(new NotFoundError())).toBe(true);
    expect(AppError.isAppError(new Error('nope'))).toBe(false);
  });

  it('preserves the cause chain', () => {
    const cause = new Error('socket hang up');
    const error = new ConflictError(ERROR_CODES.CONFLICT, 'Conflicting state');

    expect(error.cause).toBeUndefined();
    expect(new AppError(ERROR_CODES.INTERNAL, 500, 'boom', { cause }).cause).toBe(cause);
  });
});
