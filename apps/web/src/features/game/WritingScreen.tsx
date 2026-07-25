import { Button, Card } from '@aftergame/ui';
import { Check, FastForward } from 'lucide-react';
import type { SessionStateDto } from '@aftergame/shared';
import { Composer } from './components/Composer.js';
import { PhaseProgress } from './components/PhaseProgress.js';
import { advanceSession, saveText, submitText } from './game.api.js';
import { useGameAction } from './useGame.js';

/**
 * Everyone writes one text.
 *
 * The screen shows how many texts are in and nothing about whose. That is not a simplification:
 * "waiting for Sarah" plus a text arriving a moment later is enough to attribute it, so the
 * counter is both what the brief asks for and the most the anonymity model can safely say.
 */
export function WritingScreen({ state }: { state: SessionStateDto }) {
  const viewer = state.you;

  const save = useGameAction(state.id, (body: string) => saveText(state.id, body));
  const submit = useGameAction(state.id, (body: string) => submitText(state.id, body));
  const advance = useGameAction(state.id, () => advanceSession(state.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PhaseProgress progress={state.progress} noun="texts" />

      {viewer === null && (
        <Card className="mt-6 p-5">
          <p className="text-sm">
            You are watching this game rather than playing it — the roster locked when it started.
          </p>
        </Card>
      )}

      {viewer !== null && !viewer.textSubmitted && (
        <div className="mt-6">
          <Composer
            label={state.theme.writePrompt}
            placeholder={state.theme.writePlaceholder}
            initialValue={viewer.draftText}
            submitLabel="Submit my text"
            pending={submit.isPending}
            onSaveDraft={(body) => {
              save.mutate(body);
            }}
            onSubmit={(body) => {
              submit.mutate(body);
            }}
          />

          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            Nobody sees your name next to this — not the host, not now, not later unless the whole
            group agrees at the end.
          </p>
        </div>
      )}

      {viewer?.textSubmitted === true && (
        <Card className="mt-6 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Check size={18} aria-hidden="true" className="text-[var(--color-success)]" />
            Your text is in
          </p>

          {/* What happens next, rather than who is holding it up. */}
          <ol className="mt-3 flex list-inside list-decimal flex-col gap-1 text-sm text-[var(--color-ink-muted)]">
            <li>Everyone finishes writing.</li>
            <li>The texts are shuffled and dealt out — never back to whoever wrote them.</li>
            <li>You answer whatever you are dealt, still anonymously.</li>
          </ol>
        </Card>
      )}

      {viewer?.isHost === true && (
        <div className="mt-6">
          <Button
            pending={advance.isPending}
            onClick={() => {
              advance.mutate();
            }}
          >
            <FastForward size={16} aria-hidden="true" />
            Deal the texts now
          </Button>

          {/* D14: the host can always move the game forward, so one absent player cannot end it. */}
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Anyone who has not written by then simply has no text in the pile.
          </p>
        </div>
      )}
    </div>
  );
}
