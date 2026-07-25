import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, Card, EmptyState, Skeleton, cn } from '@aftergame/ui';
import { Gamepad2 } from 'lucide-react';
import type { SessionThemeDto } from '@aftergame/shared';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { PHASE_LABEL } from './components/ThemeBanner.js';
import { createSession, getLiveSession, listThemes } from './game.api.js';

/**
 * The group's game slot: either the live game or the way to start one.
 *
 * A group has at most one game at a time — enforced by a partial unique index, so even a race
 * cannot produce two (F9). This panel reflects that rather than re-implementing it: when a game
 * is live it links to it instead of offering to start another.
 */
export function NewGamePanel({ groupId, canHost }: { groupId: string; canHost: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [themeId, setThemeId] = useState<string | null>(null);

  const live = useQuery({
    queryKey: queryKeys.groupSession(groupId),
    queryFn: () => getLiveSession(groupId),
  });

  const themes = useQuery({
    queryKey: queryKeys.themes,
    queryFn: listThemes,
    enabled: picking,
    // Themes are the same for everyone and change when someone deploys, not while you play.
    staleTime: 60 * 60 * 1000,
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

  if (live.isPending) return <Skeleton className="h-28 w-full" />;

  const session = live.data ?? null;

  if (session !== null) {
    return (
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{session.themeName} is running</p>
            <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
              {PHASE_LABEL[session.phase]} · {session.playerCount}{' '}
              {session.playerCount === 1 ? 'player' : 'players'}
            </p>
          </div>

          <Button
            variant="primary"
            onClick={() => void navigate(`/groups/${groupId}/games/${session.id}`)}
          >
            {session.youArePlaying ? 'Back to the game' : 'Join the game'}
          </Button>
        </div>
      </Card>
    );
  }

  if (!picking) {
    return (
      <EmptyState
        icon={<Gamepad2 size={28} aria-hidden="true" />}
        title="No game running"
        description={
          canHost
            ? 'Pick a theme, everyone writes one anonymous text, and the rest takes care of itself.'
            : 'A host can start one. You will see it here the moment they do.'
        }
        action={
          canHost ? (
            <Button
              variant="primary"
              onClick={() => {
                setPicking(true);
              }}
            >
              New game
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card className="p-5">
      <h2 className="font-medium">Pick a theme</h2>

      {themes.isPending && <Skeleton className="mt-3 h-24 w-full" />}
      {themes.isError && (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{messageFor(themes.error)}</p>
      )}

      <div role="radiogroup" aria-label="Theme" className="mt-3 flex flex-col gap-2">
        {themes.data?.map((theme) => (
          <ThemeOption
            key={theme.id}
            theme={theme}
            selected={theme.id === themeId}
            onSelect={() => {
              setThemeId(theme.id);
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={themeId === null}
          pending={create.isPending}
          onClick={() => {
            if (themeId !== null) create.mutate(themeId);
          }}
        >
          Open the lobby
        </Button>

        <Button
          variant="ghost"
          onClick={() => {
            setPicking(false);
          }}
        >
          Never mind
        </Button>
      </div>
    </Card>
  );
}

function ThemeOption({
  theme,
  selected,
  onSelect,
}: {
  theme: SessionThemeDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-[var(--radius-card)] border p-3 text-left transition-colors',
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
      )}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {theme.icon}
      </span>

      <span className="min-w-0">
        <span className="block text-sm font-medium">{theme.name}</span>
        <span className="block text-sm text-[var(--color-ink-muted)]">{theme.description}</span>
      </span>
    </button>
  );
}
