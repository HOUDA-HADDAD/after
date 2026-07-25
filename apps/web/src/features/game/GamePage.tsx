import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Skeleton } from '@aftergame/ui';
import { Ghost } from 'lucide-react';
import { ApiError } from '../../shared/api/client.js';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { getGroup } from '../groups/groups.api.js';
import { ThemeBanner } from './components/ThemeBanner.js';
import { PurgeNotice } from './components/PurgeNotice.js';
import { LobbyScreen } from './LobbyScreen.js';
import { WritingScreen } from './WritingScreen.js';
import { AnsweringScreen } from './AnsweringScreen.js';
import { TimelineScreen } from './TimelineScreen.js';
import { RevealOutcome, RevealScreen } from './RevealScreen.js';
import { useGame } from './useGame.js';

/**
 * One route for the whole game, switching on the phase the server reports.
 *
 * The client never decides what phase it is in — it renders the one it was told about. A phase
 * change is therefore just another payload, which is what makes a reconnecting player land
 * exactly where the game already is rather than where their tab last remembered (F9).
 */
export default function GamePage() {
  const { groupId = '', sessionId = '' } = useParams();
  const navigate = useNavigate();

  const game = useGame(sessionId);

  // The lobby's load preview needs punishment levels, which live on the group rather than the
  // game. Nothing else on this page depends on it, so it never blocks a render.
  const group = useQuery({
    queryKey: queryKeys.group(groupId),
    queryFn: () => getGroup(groupId),
    enabled: groupId !== '',
  });

  if (game.isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    );
  }

  // A purged game is not an error the player did anything to cause, so it does not read like one.
  if (game.isError && game.error instanceof ApiError && game.error.code === 'SESSION_GONE') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center sm:px-6">
        <Ghost size={32} aria-hidden="true" className="mx-auto text-[var(--color-ink-subtle)]" />
        <h1 className="mt-3 text-lg font-semibold">This game has ended and been deleted</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Finished games do not stick around — that was the deal when you played it.
        </p>
        <Button className="mt-4" onClick={() => void navigate(`/groups/${groupId}`)}>
          Back to the group
        </Button>
      </div>
    );
  }

  if (game.isError || game.data === undefined) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Card className="p-6">
          <p className="text-sm">{messageFor(game.error)}</p>
          <Button className="mt-3" size="sm" onClick={() => void navigate(`/groups/${groupId}`)}>
            Back to the group
          </Button>
        </Card>
      </div>
    );
  }

  const state = game.data;

  return (
    <div>
      <ThemeBanner theme={state.theme} phase={state.phase} />

      {state.phase === 'LOBBY' && (
        <LobbyScreen state={state} group={group.data} groupId={groupId} />
      )}

      {state.phase === 'WRITING' && <WritingScreen state={state} />}
      {state.phase === 'ANSWERING' && <AnsweringScreen state={state} />}
      {state.phase === 'REVIEW' && <TimelineScreen state={state} />}
      {state.phase === 'REVEAL' && <RevealScreen state={state} />}

      {state.phase === 'COMPLETED' && (
        <>
          <RevealOutcome state={state} />
          <TimelineScreen state={state} />
          <PurgeNotice purgeAfter={state.purgeAfter} />
        </>
      )}

      {(state.phase === 'CANCELLED' || state.phase === 'ABANDONED') && (
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <Card className="p-6">
            <p className="font-medium">
              {state.phase === 'CANCELLED'
                ? 'The host called this game off.'
                : 'This game was left alone for too long and expired.'}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
              Nothing counts against anyone — an unplayed game is not a game played.
            </p>
            <Button className="mt-4" size="sm" onClick={() => void navigate(`/groups/${groupId}`)}>
              Back to the group
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
