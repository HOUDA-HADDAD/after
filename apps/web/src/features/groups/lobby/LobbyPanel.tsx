import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, Skeleton, cn } from '@aftergame/ui';
import { Gamepad2, Play, Users } from 'lucide-react';
import type { GroupMemberDto } from '@aftergame/shared';
import { queryKeys } from '../../../shared/api/queries.js';
import { useErrorMessage } from '../../../shared/lib/error-copy.js';
import { usePlural, useT } from '../../../shared/i18n/LocaleProvider.js';
import { createSession, getLiveSession, listThemes } from '../../game/game.api.js';
import { PlayerList } from './PlayerList.js';
import { ThemeGrid } from './ThemeGrid.js';

/**
 * The lobby: one surface, three regions.
 *
 * This replaces four separate cards — game state, theme picker, roster, room code — that between
 * them made a party game look like an admin console. The regions still exist as landmarks for
 * anyone navigating by them; what changed is that they now share a background, a rhythm and a
 * single obvious next action.
 *
 * The theme picker also lost a step. It used to be *New game* → a radio list → *Open the lobby*;
 * the themes are now simply on screen, and choosing one arms the button that starts the game.
 * Three clicks became two, and the screen answers "what are we playing?" without being asked.
 */
export function LobbyPanel({
  groupId,
  members,
  viewerRole,
  viewerUserId,
  canHost,
  moderating,
  onPunish,
  onForgive,
}: {
  groupId: string;
  members: GroupMemberDto[];
  viewerRole: GroupMemberDto['role'];
  viewerUserId: string;
  canHost: boolean;
  moderating: boolean;
  onPunish: (userId: string) => void;
  onForgive: (userId: string) => void;
}) {
  const t = useT();
  const messageFor = useErrorMessage();
  const plural = usePlural();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [themeId, setThemeId] = useState<string | null>(null);

  const live = useQuery({
    queryKey: queryKeys.groupSession(groupId),
    queryFn: () => getLiveSession(groupId),
  });

  const themes = useQuery({
    queryKey: queryKeys.groupThemes(groupId),
    queryFn: () => listThemes(groupId),
    staleTime: 5 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: (id: string) => createSession(groupId, id),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.groupSession(groupId) });
      await navigate(`/groups/${groupId}/games/${session.id}`);
    },
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  const session = live.data ?? null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-panel)] border',
        'border-[var(--color-border)] bg-[var(--color-surface)]',
        'shadow-[var(--shadow-panel)]',
      )}
    >
      {/* The room's light. Decorative, behind everything, and never under text it could dim. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[image:var(--gradient-lobby)]"
      />

      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
        <div className="min-w-0">
          {live.isPending ? (
            <Skeleton className="h-28 w-full" />
          ) : session !== null ? (
            <section aria-labelledby="lobby-live" className="mb-6">
              <h2 id="lobby-live" className="sr-only">
                {t('lobby.title')}
              </h2>

              <div
                className={cn(
                  'flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)]',
                  'border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] p-5',
                )}
              >
                <div>
                  <p className="text-lg font-semibold">
                    {t('lobby.liveTitle', { theme: session.themeName })}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                    {plural('lobby.livePlayersOne', 'lobby.livePlayers', session.playerCount)}
                  </p>
                </div>

                <Button
                  variant="primary"
                  onClick={() => void navigate(`/groups/${groupId}/games/${session.id}`)}
                >
                  <Play size={16} aria-hidden="true" />
                  {session.youArePlaying ? t('lobby.rejoin') : t('lobby.join')}
                </Button>
              </div>
            </section>
          ) : (
            <NoGame canHost={canHost} />
          )}

          {session === null && (
            <section aria-labelledby="lobby-themes">
              <div className="mb-3">
                <h2 id="lobby-themes" className="text-lg font-semibold tracking-tight">
                  {t('themes.title')}
                </h2>
                <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                  {t('themes.subtitle')}
                </p>
              </div>

              {themes.isPending && <Skeleton className="h-40 w-full" />}
              {themes.isError && (
                <p className="text-sm text-[var(--color-danger)]">{t('themes.loadFailed')}</p>
              )}

              {themes.data !== undefined && (
                <ThemeGrid
                  themes={themes.data}
                  selectedId={themeId}
                  disabled={!canHost || create.isPending}
                  onSelect={setThemeId}
                />
              )}

              {canHost && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    disabled={themeId === null}
                    pending={create.isPending}
                    onClick={() => {
                      if (themeId !== null) create.mutate(themeId);
                    }}
                    className="min-w-44"
                  >
                    <Play size={16} aria-hidden="true" />
                    {create.isPending ? t('lobby.starting') : t('lobby.startGame')}
                  </Button>

                  {themeId === null && (
                    <p className="text-sm text-[var(--color-ink-muted)]">
                      {t('lobby.pickThemeFirst')}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <section
          // Labelled directly rather than by the heading: the heading carries a count, and a
          // landmark whose name changes from "Players 3" to "Players 4" as people arrive is a
          // landmark nobody can navigate to reliably.
          aria-label={t('players.title')}
          className={cn(
            'min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border)]',
            'bg-[var(--color-surface-raised)]/70 p-4 backdrop-blur-sm',
            'lg:sticky lg:top-4 lg:self-start',
          )}
        >
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Users size={15} aria-hidden="true" className="text-[var(--color-ink-muted)]" />
            {t('players.title')}
            <span className="ml-auto text-xs font-normal text-[var(--color-ink-muted)] tabular-nums">
              {members.length}
            </span>
          </h2>

          <PlayerList
            members={members}
            viewerRole={viewerRole}
            viewerUserId={viewerUserId}
            busy={moderating}
            onPunish={onPunish}
            onForgive={onForgive}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * The empty state, which is the state a room spends most of its life in.
 *
 * It used to be a dashed box saying "No game running", which is true and says nothing. It now
 * says what to do next, and the themes below it are the doing.
 */
function NoGame({ canHost }: { canHost: boolean }) {
  const t = useT();

  return (
    <div className="mb-7 flex flex-col items-center gap-3 py-6 text-center sm:py-8">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)]',
          'bg-[image:var(--gradient-accent)] text-[var(--color-accent-ink)]',
          'shadow-[var(--shadow-lift)] motion-safe:animate-[fade-in-up_400ms_ease-out]',
        )}
      >
        <Gamepad2 size={30} />
      </span>

      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('lobby.noGame')}</h2>

      <p className="max-w-sm text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {canHost ? t('lobby.noGameHost') : t('lobby.noGameMember')}
      </p>
    </div>
  );
}
