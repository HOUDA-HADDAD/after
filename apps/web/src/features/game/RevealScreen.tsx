import { Button, Card } from '@aftergame/ui';
import { Eye, EyeOff, Lock } from 'lucide-react';
import type { SessionStateDto } from '@aftergame/shared';
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
        <h2 className="text-lg font-semibold tracking-tight">Should we reveal who wrote what?</h2>

        <ul className="mt-4 flex flex-col gap-2 text-sm text-[var(--color-ink-muted)]">
          <li className="flex gap-2">
            <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            Your choice is private. Nobody — including the host — is ever told how you voted.
          </li>
          <li className="flex gap-2">
            <EyeOff size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            Authors are revealed only if <strong className="font-medium">everyone</strong> agrees.
            One person saying no keeps the whole game anonymous, and not voting counts as no.
          </li>
        </ul>

        {smallGame && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-warning-subtle)] p-3 text-sm">
            Worth knowing before you choose: in a game this small, a failed reveal narrows down who
            refused
            {participants === 2 ? ' — with two players, it identifies them outright' : ''}. That
            follows from the rule itself, so we would rather say it than pretend otherwise.
          </p>
        )}

        {viewer === null ? (
          <p className="mt-6 text-sm">Only the players of this game get a vote.</p>
        ) : alreadyVoted ? (
          <p className="mt-6 text-sm font-medium">
            Your vote is in. What you chose stays between you and the database.
          </p>
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
              Reveal the authors
            </Button>

            <Button
              pending={vote.isPending}
              onClick={() => {
                vote.mutate('NO');
              }}
            >
              <EyeOff size={16} aria-hidden="true" />
              Keep us anonymous
            </Button>
          </div>
        )}

        {reveal !== null && (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            {/* `decided / total`, and never the split — see D8a. */}
            <p className="text-sm text-[var(--color-ink-muted)] tabular-nums">
              {reveal.decided} of {reveal.total} have decided.
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
              Close the vote now
            </Button>
            <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
              Anyone who has not voted counts as a no.
            </p>
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
  if (state.reveal === null || !state.reveal.closed) return null;

  return (
    <Card className="mx-auto mt-6 max-w-[72ch] p-5">
      {state.reveal.revealed ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          <Eye size={16} aria-hidden="true" />
          Everyone agreed — the names are on the texts below.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <EyeOff size={16} aria-hidden="true" />
            The group chose to stay anonymous.
          </p>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Nobody is told who wanted what. The stories stay exactly as you read them.
          </p>
        </>
      )}
    </Card>
  );
}
