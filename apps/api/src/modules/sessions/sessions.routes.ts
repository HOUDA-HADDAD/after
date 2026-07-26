import {
  createCommentSchema,
  createSessionSchema,
  reactionSchema,
  revealVoteSchema,
  saveDraftSchema,
  submitContentSchema,
  submitGuessSchema,
} from '@aftergame/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOrThrow } from '../../lib/validate.js';
import { liveSessionJsonSchema, sessionStateJsonSchema } from './sessions.mapper.js';

interface SessionParams {
  sessionId: string;
}

interface AssignmentParams extends SessionParams {
  assignmentId: string;
}

interface AnswerParams extends SessionParams {
  answerId: string;
}

interface TextParams extends SessionParams {
  textId: string;
}

const userId = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('route reached without authentication');
  return request.user.id;
};

const stateResponse = { response: { 200: sessionStateJsonSchema } } as const;

/**
 * Session routes.
 *
 * Group membership is checked inside the service rather than by the route, because a session id
 * does not name its group — and the answer is the same either way: a 404 that never confirms the
 * game exists.
 */
const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: SessionParams }>(
    '/:sessionId',
    { config: { policy: 'session:read' }, schema: stateResponse },
    async (request) => app.sessions.getState(request.params.sessionId, userId(request)),
  );

  /* ---- lobby ---------------------------------------------------------------------------- */

  app.post<{ Params: SessionParams }>(
    '/:sessionId/join',
    { config: { policy: 'session:join' }, schema: stateResponse },
    async (request) => app.sessions.join(request.params.sessionId, userId(request)),
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/leave',
    { config: { policy: 'session:leave' } },
    async (request, reply) => {
      await app.sessions.leave(request.params.sessionId, userId(request));

      return reply.status(204).send();
    },
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/start',
    { config: { policy: 'session:host' }, schema: stateResponse },
    async (request) => app.sessions.start(request.params.sessionId, userId(request)),
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/cancel',
    { config: { policy: 'session:host' } },
    async (request, reply) => {
      await app.sessions.cancel(request.params.sessionId, userId(request));

      return reply.status(204).send();
    },
  );

  /* ---- host controls -------------------------------------------------------------------- */

  app.post<{ Params: SessionParams }>(
    '/:sessionId/advance',
    { config: { policy: 'session:host' }, schema: stateResponse },
    async (request) => app.sessions.forceAdvance(request.params.sessionId, userId(request)),
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/end',
    { config: { policy: 'session:host' }, schema: stateResponse },
    async (request) => app.sessions.endGame(request.params.sessionId, userId(request)),
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/close-voting',
    { config: { policy: 'session:host' }, schema: stateResponse },
    async (request) => app.sessions.closeVoting(request.params.sessionId, userId(request)),
  );

  /* ---- writing -------------------------------------------------------------------------- */

  app.put<{ Params: SessionParams }>(
    '/:sessionId/text',
    { config: { policy: 'session:play' }, schema: stateResponse },
    async (request) => {
      // Drafts autosave, so a closed laptop loses nothing.
      const { body } = parseOrThrow(saveDraftSchema, request.body);

      return app.gameplay.writeText(request.params.sessionId, userId(request), body, false);
    },
  );

  app.post<{ Params: SessionParams }>(
    '/:sessionId/text/submit',
    { config: { policy: 'session:play' }, schema: stateResponse },
    async (request) => {
      // Submitting is final; the empty check lives in the schema, the service and a CHECK
      // constraint, so an empty text cannot get through any of them.
      const { body } = parseOrThrow(submitContentSchema, request.body);

      return app.gameplay.writeText(request.params.sessionId, userId(request), body, true);
    },
  );

  /* ---- answering ------------------------------------------------------------------------ */

  app.put<{ Params: AssignmentParams }>(
    '/:sessionId/assignments/:assignmentId/answer',
    { config: { policy: 'session:play' }, schema: stateResponse },
    async (request) => {
      const { body } = parseOrThrow(saveDraftSchema, request.body);

      return app.gameplay.writeAnswer(
        request.params.sessionId,
        userId(request),
        request.params.assignmentId,
        body,
        false,
      );
    },
  );

  app.post<{ Params: AssignmentParams }>(
    '/:sessionId/assignments/:assignmentId/answer/submit',
    { config: { policy: 'session:play' }, schema: stateResponse },
    async (request) => {
      const { body } = parseOrThrow(submitContentSchema, request.body);

      return app.gameplay.writeAnswer(
        request.params.sessionId,
        userId(request),
        request.params.assignmentId,
        body,
        true,
      );
    },
  );

  /* ---- discussion ----------------------------------------------------------------------- */

  app.post<{ Params: AnswerParams }>(
    '/:sessionId/answers/:answerId/comments',
    { config: { policy: 'session:play' } },
    async (request, reply) => {
      const { body, isAnonymous } = parseOrThrow(createCommentSchema, request.body);

      await app.gameplay.comment(
        request.params.sessionId,
        userId(request),
        request.params.answerId,
        body,
        isAnonymous,
      );

      return reply.status(204).send();
    },
  );

  app.put<{ Params: AnswerParams }>(
    '/:sessionId/answers/:answerId/reactions',
    { config: { policy: 'session:play' } },
    async (request, reply) => {
      const { emoji } = parseOrThrow(reactionSchema, request.body);

      await app.gameplay.react(
        request.params.sessionId,
        userId(request),
        request.params.answerId,
        emoji,
        true,
      );

      return reply.status(204).send();
    },
  );

  app.delete<{ Params: AnswerParams }>(
    '/:sessionId/answers/:answerId/reactions',
    { config: { policy: 'session:play' } },
    async (request, reply) => {
      // The emoji rides in the body rather than the path: it is a character, and putting one in
      // a URL means percent-encoding four bytes and hoping every proxy agrees about them.
      const { emoji } = parseOrThrow(reactionSchema, request.body);

      await app.gameplay.react(
        request.params.sessionId,
        userId(request),
        request.params.answerId,
        emoji,
        false,
      );

      return reply.status(204).send();
    },
  );

  app.put<{ Params: TextParams }>(
    '/:sessionId/texts/:textId/guess',
    { config: { policy: 'session:play' } },
    async (request, reply) => {
      const { guessedPlayerId } = parseOrThrow(submitGuessSchema, request.body);

      await app.gameplay.guess(
        request.params.sessionId,
        userId(request),
        request.params.textId,
        guessedPlayerId,
      );

      return reply.status(204).send();
    },
  );

  /* ---- the reveal ----------------------------------------------------------------------- */

  app.post<{ Params: SessionParams }>(
    '/:sessionId/reveal-vote',
    { config: { policy: 'session:play' }, schema: stateResponse },
    async (request) => {
      const { choice } = parseOrThrow(revealVoteSchema, request.body);

      // Nothing about the choice comes back — the response carries `decided / total` and no more.
      return app.gameplay.castRevealVote(request.params.sessionId, userId(request), choice);
    },
  );
};

/** Creating a game and finding a group's live one are group-scoped, so they live under /groups. */
export const groupSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { groupId: string } }>(
    '/:groupId/sessions',
    { config: { policy: 'session:create' }, schema: { response: { 201: sessionStateJsonSchema } } },
    async (request, reply) => {
      const { themeId } = parseOrThrow(createSessionSchema, request.body);

      return reply
        .status(201)
        .send(await app.sessions.create(request.params.groupId, userId(request), themeId));
    },
  );

  app.get<{ Params: { groupId: string } }>(
    '/:groupId/session',
    { config: { policy: 'session:read' }, schema: { response: { 200: liveSessionJsonSchema } } },
    async (request) => ({
      session: await app.sessions.liveForGroup(request.params.groupId, userId(request)),
    }),
  );
};

export default sessionRoutes;
