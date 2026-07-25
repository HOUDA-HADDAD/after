import type {
  AssignmentDto,
  SessionPlayerDto,
  SessionStateDto,
  SessionThemeDto,
  TimelineDto,
  ViewerStateDto,
} from '@aftergame/shared';
import type { GameText, Theme } from '@prisma/client';
import type {
  AssignmentWithText,
  PlayerWithUser,
  SessionWithTheme,
} from './sessions.repository.js';

/**
 * Entity to DTO for a game.
 *
 * Author identity enters this file in exactly one place — `projectTimeline`, which decides who
 * may see it (docs/01-architecture.md §3). Everything else here deliberately deals in ids that
 * mean nothing outside the session.
 */

export const toThemeDto = (theme: Theme): SessionThemeDto => ({
  id: theme.id,
  slug: theme.slug,
  name: theme.name,
  description: theme.description,
  writePrompt: theme.writePrompt,
  writePlaceholder: theme.writePlaceholder,
  answerPrompt: theme.answerPrompt,
  icon: theme.icon,
  supportsComments: theme.supportsComments,
  supportsAuthorGuess: theme.supportsAuthorGuess,
});

export const toPlayerDto = (player: PlayerWithUser, viewerUserId: string): SessionPlayerDto => ({
  playerId: player.id,
  username: player.user.username,
  isYou: player.userId === viewerUserId,
  hasLeft: player.leftAt !== null,
  // The load is a rule of the game, not a secret: a lobby that silently hands one person three
  // cards would be inexplicable (D6).
  answerLoad: player.receiveQuota,
});

const toAssignmentDto = (assignment: AssignmentWithText): AssignmentDto => ({
  assignmentId: assignment.id,
  textBody: assignment.text.body,
  answerBody: assignment.answer?.body ?? '',
  submitted: assignment.answer?.status === 'SUBMITTED',
});

/* ------------------------------------------------------------------------------------------ */
/* Response schemas                                                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * Fastify serializes **only** what is declared here.
 *
 * That makes this the second, structural layer under the projection: if a service ever hands the
 * route an entity that still carries `authorPlayerId`, it does not reach the wire. `author` is
 * declared as an object-or-null, and there is deliberately no `authorPlayerId` anywhere in this
 * file (docs/02-tech-stack.md, Fastify).
 */
const playerRefJsonSchema = {
  type: ['object', 'null'],
  properties: { playerId: { type: 'string' }, username: { type: 'string' } },
  required: ['playerId', 'username'],
  additionalProperties: false,
} as const;

const timelineCommentJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    body: { type: 'string' },
    author: playerRefJsonSchema,
    createdAt: { type: 'string' },
  },
  required: ['id', 'body', 'author', 'createdAt'],
  additionalProperties: false,
} as const;

const timelineAnswerJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    body: { type: ['string', 'null'] },
    author: playerRefJsonSchema,
    skipped: { type: 'boolean' },
    comments: { type: 'array', items: timelineCommentJsonSchema },
  },
  required: ['id', 'body', 'author', 'skipped', 'comments'],
  additionalProperties: false,
} as const;

const timelineJsonSchema = {
  type: ['object', 'null'],
  properties: {
    authorsVisible: { type: 'boolean' },
    texts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          body: { type: 'string' },
          author: playerRefJsonSchema,
          answers: { type: 'array', items: timelineAnswerJsonSchema },
          yourGuess: playerRefJsonSchema,
          yourGuessCorrect: { type: ['boolean', 'null'] },
        },
        required: ['id', 'body', 'author', 'answers', 'yourGuess', 'yourGuessCorrect'],
        additionalProperties: false,
      },
    },
    guessScores: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          player: playerRefJsonSchema,
          correct: { type: 'integer' },
          total: { type: 'integer' },
        },
        required: ['player', 'correct', 'total'],
        additionalProperties: false,
      },
    },
  },
  required: ['authorsVisible', 'texts', 'guessScores'],
  additionalProperties: false,
} as const;

export const sessionStateJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    groupId: { type: 'string' },
    phase: { type: 'string' },
    theme: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        writePrompt: { type: 'string' },
        writePlaceholder: { type: 'string' },
        answerPrompt: { type: 'string' },
        icon: { type: 'string' },
        supportsComments: { type: 'boolean' },
        supportsAuthorGuess: { type: 'boolean' },
      },
      required: ['id', 'slug', 'name', 'supportsComments', 'supportsAuthorGuess'],
      additionalProperties: false,
    },
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          playerId: { type: 'string' },
          username: { type: 'string' },
          isYou: { type: 'boolean' },
          hasLeft: { type: 'boolean' },
          answerLoad: { type: 'integer' },
        },
        required: ['playerId', 'username', 'isYou', 'hasLeft', 'answerLoad'],
        additionalProperties: false,
      },
    },
    progress: {
      type: 'object',
      properties: { submitted: { type: 'integer' }, required: { type: 'integer' } },
      required: ['submitted', 'required'],
      additionalProperties: false,
    },
    you: {
      type: ['object', 'null'],
      properties: {
        playerId: { type: 'string' },
        isHost: { type: 'boolean' },
        draftText: { type: 'string' },
        textSubmitted: { type: 'boolean' },
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assignmentId: { type: 'string' },
              textBody: { type: 'string' },
              answerBody: { type: 'string' },
              submitted: { type: 'boolean' },
            },
            required: ['assignmentId', 'textBody', 'answerBody', 'submitted'],
            additionalProperties: false,
          },
        },
        revealVoteCast: { type: 'boolean' },
      },
      required: [
        'playerId',
        'isHost',
        'draftText',
        'textSubmitted',
        'assignments',
        'revealVoteCast',
      ],
      additionalProperties: false,
    },
    // Counts only. There is no property here that could carry the yes/no split (D8a).
    reveal: {
      type: ['object', 'null'],
      properties: {
        decided: { type: 'integer' },
        total: { type: 'integer' },
        closed: { type: 'boolean' },
        revealed: { type: 'boolean' },
      },
      required: ['decided', 'total', 'closed', 'revealed'],
      additionalProperties: false,
    },
    timeline: timelineJsonSchema,
    purgeAfter: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
  required: ['id', 'groupId', 'phase', 'theme', 'players', 'progress', 'you', 'reveal', 'timeline'],
  additionalProperties: false,
} as const;

export const liveSessionJsonSchema = {
  type: 'object',
  properties: { session: { ...sessionStateJsonSchema, type: ['object', 'null'] } },
  required: ['session'],
  additionalProperties: false,
} as const;

export interface StateSources {
  session: SessionWithTheme;
  players: PlayerWithUser[];
  viewerUserId: string;
  viewerPlayer: PlayerWithUser | null;
  isHost: boolean;
  draftText: GameText | null;
  assignments: AssignmentWithText[];
  progress: { submitted: number; required: number };
  revealVoteCast: boolean;
  reveal: { decided: number; total: number; closed: boolean; revealed: boolean } | null;
  timeline: TimelineDto | null;
}

export function toSessionStateDto(sources: StateSources): SessionStateDto {
  const viewer: ViewerStateDto | null =
    sources.viewerPlayer === null
      ? null
      : {
          playerId: sources.viewerPlayer.id,
          isHost: sources.isHost,
          // Only ever their own draft. Nobody else's unsubmitted writing is reachable at all.
          draftText: sources.draftText?.body ?? '',
          textSubmitted: sources.draftText?.status === 'SUBMITTED',
          assignments: sources.assignments.map(toAssignmentDto),
          revealVoteCast: sources.revealVoteCast,
        };

  return {
    id: sources.session.id,
    groupId: sources.session.groupId,
    phase: sources.session.status,
    theme: toThemeDto(sources.session.theme),
    players: sources.players.map((player) => toPlayerDto(player, sources.viewerUserId)),
    progress: sources.progress,
    you: viewer,
    reveal: sources.reveal,
    timeline: sources.timeline,
    purgeAfter: sources.session.purgeAfter?.toISOString() ?? null,
    createdAt: sources.session.createdAt.toISOString(),
  };
}
