import { Button, cn } from '@aftergame/ui';
import { Target } from 'lucide-react';
import { useT } from '../../../shared/i18n/LocaleProvider.js';
import type { SessionPlayerDto, TimelineTextDto } from '@aftergame/shared';

/**
 * "Who wrote this?"
 *
 * Guessing is open while the discussion runs, one guess per text, changeable until the phase
 * closes. **No correctness feedback appears here** — not a tick, not a colour, nothing. Whether
 * you were right is gated behind the same unanimous reveal as the names themselves (D9), because
 * "your guess of Sarah was correct" is simply the author's name in a different sentence.
 */
export function GuessWidget({
  text,
  players,
  open,
  pending,
  onGuess,
}: {
  text: TimelineTextDto;
  players: SessionPlayerDto[];
  open: boolean;
  pending: boolean;
  onGuess: (playerId: string) => void;
}) {
  const t = useT();
  const candidates = players.filter((player) => !player.isYou);
  const guessedId = text.yourGuess?.playerId ?? null;

  if (!open) {
    return guessedId === null ? null : (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        {t('guess.youGuessed', { name: text.yourGuess?.username ?? '' })}{' '}
        {text.yourGuessCorrect === null
          ? t('guess.pending')
          : text.yourGuessCorrect
            ? t('guess.right')
            : t('guess.wrong')}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Target size={14} aria-hidden="true" />
        {t('guess.who')}
      </p>

      <div role="group" aria-label={t('guess.label')} className="mt-2 flex flex-wrap gap-2">
        {candidates.map((player) => {
          const chosen = player.playerId === guessedId;

          return (
            <Button
              key={player.playerId}
              size="sm"
              pending={pending}
              aria-pressed={chosen}
              className={cn(
                chosen && 'border-[var(--color-accent)] text-[var(--color-accent)]',
                'min-h-11 sm:min-h-0',
              )}
              onClick={() => {
                onGuess(player.playerId);
              }}
            >
              {player.username}
            </Button>
          );
        })}
      </div>

      <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
        {guessedId === null ? t('guess.canChange') : t('guess.saved')}
      </p>
    </div>
  );
}
