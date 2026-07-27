import { Button, Card } from '@aftergame/ui';
import { Eye, EyeOff, Lock } from 'lucide-react';
import type { SessionStateDto } from '@aftergame/shared';
import { useT } from '../../shared/i18n/LocaleProvider.js';
import { castRevealVote, closeVoting } from './game.api.js';
import { useGameAction } from './useGame.js';

/**
 * The reveal vote.
 *
 * Collective and unanimous (D8): authors appear only if every remaining participant says yes, and
 * one refusal — or one abstention — keeps the whole table anonymous. The outcome is announced as
 * a group fact with no hint of how many refused.
 *
 * Two things this screen deliberately never shows:
 *
 *   - **the yes/no split**, in any form, at any point (D8a). Only `decided / total`, which is a
 *     progress bar rather than a tally.
 *   - **an implied privacy it cannot deliver.** In a 2- or 3-player game a failed reveal narrows
 *     down who refused, and at two players it names them. That follows from the rule itself and
 *     no implementation can remove it, so the warning appears *before* the vote, where it can
 *     still change what someone chooses.
 */
export function RevealScreen({ state }: { state: SessionStateDto }) {
  const t = useT();
  const viewer = state.you;
  const reveal = state.reveal;

  const vote = useGameAction(state.id, (choice: 'YES' | 'NO') => castRevealVote(state.id, choice));
  const close = useGameAction(state.id, () => closeVoting(state.id));

  const participants = state.players.filter((player) => !player.hasLeft).length;
  const smallGame = participants <= 3;
  const alreadyVoted = viewer?.revealVoteCast === true;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">{t('reveal.question')}</h2>

        <ul className="mt-4 flex flex-col gap-2 text-sm text-[var(--color-ink-muted)]">
          <li className="flex gap-2">
            <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t('reveal.private')}
          </li>
          <li className="flex gap-2">
            <EyeOff size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t('reveal.unanimous')}
          </li>
        </ul>

        {smallGame && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-warning-subtle)] p-3 text-sm">
            {participants === 2 ? t('reveal.twoPlayers') : t('reveal.smallGame')}
          </p>
        )}

        {viewer === null ? (
          <p className="mt-6 text-sm">{t('reveal.onlyPlayers')}</p>
        ) : alreadyVoted ? (
          <p className="mt-6 text-sm font-medium">{t('reveal.voted')}</p>
        ) : (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="primary"
              pending={vote.isPending}
              onClick={() => {
                vote.mutate('YES');
              }}
            >
              <Eye size={16} aria-hidden="true" />
              {t('reveal.yes')}
            </Button>

            <Button
              pending={vote.isPending}
              onClick={() => {
                vote.mutate('NO');
              }}
            >
              <EyeOff size={16} aria-hidden="true" />
              {t('reveal.no')}
            </Button>
          </div>
        )}

        {reveal !== null && (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            {/* `decided / total`, and never the split — see D8a. */}
            <p className="text-sm text-[var(--color-ink-muted)] tabular-nums">
              {t('reveal.decided', { decided: reveal.decided, total: reveal.total })}
            </p>
          </div>
        )}

        {viewer?.isHost === true && (
          <div className="mt-4">
            <Button
              size="sm"
              pending={close.isPending}
              onClick={() => {
                close.mutate();
              }}
            >
              {t('reveal.close')}
            </Button>
            <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">{t('reveal.closeNote')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * The result, said once, as a fact about the group.
 *
 * Not "3 of 5 wanted to reveal" — that is the split by another name. Either the table agreed or
 * it did not, and both sentences are written to sound like an outcome rather than a verdict on
 * whoever refused.
 */
export function RevealOutcome({ state }: { state: SessionStateDto }) {
  const t = useT();

  if (state.reveal === null || !state.reveal.closed) return null;

  return (
    <Card className="mx-auto mt-6 max-w-[72ch] p-5">
      {state.reveal.revealed ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          <Eye size={16} aria-hidden="true" />
          {t('reveal.agreed')}
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <EyeOff size={16} aria-hidden="true" />
            {t('reveal.stayed')}
          </p>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{t('reveal.stayedNote')}</p>
        </>
      )}
    </Card>
  );
}
