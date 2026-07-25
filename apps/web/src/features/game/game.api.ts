import type { SessionStateDto, SessionSummaryDto, SessionThemeDto } from '@aftergame/shared';
import { apiFetch, apiPost, apiPut } from '../../shared/api/client.js';

/**
 * Every call a game makes.
 *
 * Most of them return the whole `SessionStateDto`, which is deliberate: the server decides what
 * the viewer may see, and a response that replaces the entire local view leaves no room for the
 * client to keep a stale fragment of a previous phase on screen. The few that return 204 are the
 * ones whose result is only visible through someone else's projection — a comment, a guess.
 */

const base = (sessionId: string): string => `/sessions/${sessionId}`;

export const listThemes = async (): Promise<SessionThemeDto[]> =>
  (await apiFetch<{ themes: SessionThemeDto[] }>('/themes')).themes;

export const getLiveSession = async (groupId: string): Promise<SessionSummaryDto | null> =>
  (await apiFetch<{ session: SessionSummaryDto | null }>(`/groups/${groupId}/session`)).session;

export const createSession = (groupId: string, themeId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`/groups/${groupId}/sessions`, { themeId });

export const getSession = (sessionId: string): Promise<SessionStateDto> =>
  apiFetch<SessionStateDto>(base(sessionId));

/* ---- lobby --------------------------------------------------------------------------------- */

export const joinSession = (sessionId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/join`);

export const leaveSession = (sessionId: string): Promise<void> =>
  apiPost<void>(`${base(sessionId)}/leave`);

export const startSession = (sessionId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/start`);

export const cancelSession = (sessionId: string): Promise<void> =>
  apiPost<void>(`${base(sessionId)}/cancel`);

/* ---- host controls ------------------------------------------------------------------------- */

export const advanceSession = (sessionId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/advance`);

export const endSession = (sessionId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/end`);

export const closeVoting = (sessionId: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/close-voting`);

/* ---- writing ------------------------------------------------------------------------------- */

export const saveText = (sessionId: string, body: string): Promise<SessionStateDto> =>
  apiPut<SessionStateDto>(`${base(sessionId)}/text`, { body });

export const submitText = (sessionId: string, body: string): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/text/submit`, { body });

/* ---- answering ----------------------------------------------------------------------------- */

export const saveAnswer = (
  sessionId: string,
  assignmentId: string,
  body: string,
): Promise<SessionStateDto> =>
  apiPut<SessionStateDto>(`${base(sessionId)}/assignments/${assignmentId}/answer`, { body });

export const submitAnswer = (
  sessionId: string,
  assignmentId: string,
  body: string,
): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/assignments/${assignmentId}/answer/submit`, {
    body,
  });

/* ---- discussion ---------------------------------------------------------------------------- */

export const postComment = (
  sessionId: string,
  answerId: string,
  body: string,
  isAnonymous: boolean,
): Promise<void> =>
  apiPost<void>(`${base(sessionId)}/answers/${answerId}/comments`, { body, isAnonymous });

export const submitGuess = (
  sessionId: string,
  textId: string,
  guessedPlayerId: string,
): Promise<void> => apiPut<void>(`${base(sessionId)}/texts/${textId}/guess`, { guessedPlayerId });

/* ---- the reveal ---------------------------------------------------------------------------- */

/** Nothing about the choice comes back — the response carries `decided / total` and no more. */
export const castRevealVote = (sessionId: string, choice: 'YES' | 'NO'): Promise<SessionStateDto> =>
  apiPost<SessionStateDto>(`${base(sessionId)}/reveal-vote`, { choice });
