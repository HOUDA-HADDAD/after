import { useNavigate } from 'react-router';
import { Badge, Button, Card, EmptyState } from '@aftergame/ui';
import { LogIn, Play, Users, X } from 'lucide-react';
import type { GroupDetailDto, SessionStateDto } from '@aftergame/shared';
import { MIN_PLAYERS_PER_SESSION } from '@aftergame/shared';
import {
  demandFor,
  isDemandClamped,
  isPlayable,
  isPunishmentLevel,
  type PlayablePunishmentLevel,
} from '@aftergame/game-core';
import { useSession } from '../auth/SessionProvider.js';
import { cancelSession, joinSession, leaveSession, startSession } from './game.api.js';
import { useGameAction } from './useGame.js';

/**
 * What one member's punishment level means for this game, worked out with the same functions the
 * server uses.
 *
 * Importing `demandFor` rather than writing `1 + level` here is the whole point of `game-core`
 * being a package: a lobby that previews a different load from the one the distributor produces
 * is worse than a lobby with no preview.
 */
interface LoadPreview {
  username: string;
  blocked: boolean;
  level: number;
  answers: number;
  clamped: boolean;
}

function previewLoads(members: GroupDetailDto['members'], playerCount: number): LoadPreview[] {
  return members.map((member) => {
    const level = isPunishmentLevel(member.consecutivePunishments)
      ? member.consecutivePunishments
      : 0;
    const playable: PlayablePunishmentLevel = isPlayable(level) ? level : 0;

    return {
      username: member.username,
      blocked: member.status === 'GAME_BLOCKED',
      level: member.consecutivePunishments,
      answers: demandFor(playable, playerCount),
      clamped: isDemandClamped(playable, playerCount),
    };
  });
}

export function LobbyScreen({
  state,
  group,
  groupId,
}: {
  state: SessionStateDto;
  group: GroupDetailDto | undefined;
  groupId: string;
}) {
  const navigate = useNavigate();
  const { state: session } = useSession();
  const viewerId = session.status === 'authenticated' ? session.user.id : '';

  const join = useGameAction(state.id, () => joinSession(state.id));
  const start = useGameAction(state.id, () => startSession(state.id));

  const leave = useGameAction(state.id, async () => {
    await leaveSession(state.id);

    return state;
  });

  const cancel = useGameAction(state.id, async () => {
    await cancelSession(state.id);

    return state;
  });

  const youArePlaying = state.you !== null;
  const playerCount = state.players.filter((player) => !player.hasLeft).length;
  const enoughPlayers = playerCount >= MIN_PLAYERS_PER_SESSION;

  const loads = previewLoads(group?.members ?? [], playerCount);
  const anyClamped = loads.some((load) => load.clamped && !load.blocked);

  // Asked of the group roster rather than the game's: a blocked member is precisely someone who
  // is not on the game's roster and cannot get onto it.
  const youAreBlocked =
    group?.members.some(
      (member) => member.userId === viewerId && member.status === 'GAME_BLOCKED',
    ) === true;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <section aria-labelledby="lobby-roster">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="lobby-roster" className="text-lg font-semibold tracking-tight">
            Who is playing
          </h2>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {playerCount} joined · {MIN_PLAYERS_PER_SESSION} needed to start
          </p>
        </div>

        {state.players.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Users size={28} aria-hidden="true" />}
              title="Nobody has joined yet"
              description="Share the room code — everyone in the group can see this game and join it."
            />
          </div>
        ) : (
          <Card className="mt-3 px-4">
            <ul>
              {state.players.map((player) => (
                <li
                  key={player.playerId}
                  className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-3 text-sm last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {player.username}
                      {player.isYou && (
                        <span className="ml-1.5 text-[var(--color-ink-muted)]">(you)</span>
                      )}
                    </span>

                    <LoadLine
                      username={player.username}
                      load={loads.find((entry) => entry.username === player.username)}
                    />
                  </span>

                  {player.hasLeft && <Badge>Left</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/*
        The punishment load is shown before the game starts, to everyone, on purpose. It is a rule
        of the game rather than a private fact (D6) — and a lobby that silently dealt one person
        three cards would be inexplicable rather than discreet.
      */}
      {anyClamped && (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          With {playerCount} players there are not enough texts to hand out the full penalty, so it
          is capped at {playerCount}. More players means a heavier penalty.
        </p>
      )}

      {group !== undefined && loads.some((load) => load.blocked) && (
        <Card className="mt-4 p-4">
          <h3 className="text-sm font-medium">Sitting this one out</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {loads
              .filter((load) => load.blocked)
              .map((load) => (
                <li key={load.username} className="text-sm text-[var(--color-ink-muted)]">
                  {load.username} — blocked from games until a host forgives them
                </li>
              ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {!youArePlaying && !youAreBlocked && (
          <Button
            variant="primary"
            pending={join.isPending}
            onClick={() => {
              join.mutate();
            }}
          >
            <LogIn size={16} aria-hidden="true" />
            Join the game
          </Button>
        )}

        {state.you?.isHost === true && (
          <>
            <Button
              variant="primary"
              pending={start.isPending}
              disabled={!enoughPlayers}
              onClick={() => {
                start.mutate();
              }}
            >
              <Play size={16} aria-hidden="true" />
              Start the game
            </Button>

            <Button
              variant="danger"
              pending={cancel.isPending}
              onClick={() => {
                cancel.mutate(undefined, {
                  onSuccess: () => void navigate(`/groups/${groupId}`, { replace: true }),
                });
              }}
            >
              <X size={16} aria-hidden="true" />
              Cancel game
            </Button>
          </>
        )}

        {youArePlaying && state.you?.isHost !== true && (
          <Button
            pending={leave.isPending}
            onClick={() => {
              leave.mutate(undefined, {
                onSuccess: () => void navigate(`/groups/${groupId}`, { replace: true }),
              });
            }}
          >
            Leave the game
          </Button>
        )}
      </div>

      {state.you?.isHost === true && !enoughPlayers && (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          You need at least {MIN_PLAYERS_PER_SESSION} players to start.
        </p>
      )}

      {youAreBlocked && (
        <Card className="mt-4 p-4">
          <p className="text-sm">
            You cannot join games in this group until a host forgives you. Everything else in the
            group still works.
          </p>
        </Card>
      )}
    </div>
  );
}

/** "Answers 2 texts · 1 punishment" — the rule, spelled out rather than implied. */
function LoadLine({ username, load }: { username: string; load: LoadPreview | undefined }) {
  if (load === undefined) return null;

  return (
    <span className="text-xs text-[var(--color-ink-muted)]">
      {username} answers {load.answers} {load.answers === 1 ? 'text' : 'texts'}
      {load.level > 0 && ` · ${String(load.level)} punishment${load.level === 1 ? '' : 's'}`}
    </span>
  );
}
