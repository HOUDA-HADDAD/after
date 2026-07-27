import { Button, Card } from '@aftergame/ui';
import { Check, FastForward } from 'lucide-react';
import type { SessionStateDto } from '@aftergame/shared';
import { useT } from '../../shared/i18n/LocaleProvider.js';
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
  const t = useT();
  const viewer = state.you;

  const save = useGameAction(state.id, (body: string) => saveText(state.id, body));
  const submit = useGameAction(state.id, (body: string) => submitText(state.id, body));
  const advance = useGameAction(state.id, () => advanceSession(state.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PhaseProgress progress={state.progress} counting="texts" />

      {viewer === null && (
        <Card className="mt-6 p-5">
          <p className="text-sm">{t('game.watchingLocked')}</p>
        </Card>
      )}

      {viewer !== null && !viewer.textSubmitted && (
        <div className="mt-6">
          <Composer
            label={state.theme.writePrompt}
            placeholder={state.theme.writePlaceholder}
            initialValue={viewer.draftText}
            submitLabel={t('writing.submit')}
            pending={submit.isPending}
            onSaveDraft={(body) => {
              save.mutate(body);
            }}
            onSubmit={(body) => {
              submit.mutate(body);
            }}
          />

          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t('writing.anonymousNote')}</p>
        </div>
      )}

      {viewer?.textSubmitted === true && (
        <Card className="mt-6 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Check size={18} aria-hidden="true" className="text-[var(--color-success)]" />
            {t('writing.done')}
          </p>

          {/* What happens next, rather than who is holding it up. */}
          <ol className="mt-3 flex list-inside list-decimal flex-col gap-1 text-sm text-[var(--color-ink-muted)]">
            <li>{t('writing.next1')}</li>
            <li>{t('writing.next2')}</li>
            <li>{t('writing.next3')}</li>
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
            {t('writing.deal')}
          </Button>

          {/* D14: the host can always move the game forward, so one absent player cannot end it. */}
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('writing.dealNote')}</p>
        </div>
      )}
    </div>
  );
}
