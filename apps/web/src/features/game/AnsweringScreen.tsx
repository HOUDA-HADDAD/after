import { Button, Card } from '@aftergame/ui';
import { Check, FastForward } from 'lucide-react';
import type { AssignmentDto, SessionStateDto } from '@aftergame/shared';
import { useT } from '../../shared/i18n/LocaleProvider.js';
import { Composer } from './components/Composer.js';
import { PhaseProgress } from './components/PhaseProgress.js';
import { advanceSession, saveAnswer, submitAnswer } from './game.api.js';
import { useGameAction } from './useGame.js';

/**
 * The answering queue.
 *
 * One card per assignment: unpunished players get one, punished players two or three (D1). The
 * queue says nothing about who wrote a text and nothing about how many cards anyone else has —
 * the second matters more than it looks. Knowing that one player holds three cards, in a game
 * where the lobby showed who was punished, would attach a name to whichever answers appear in
 * triplicate.
 */
export function AnsweringScreen({ state }: { state: SessionStateDto }) {
  const t = useT();
  const viewer = state.you;
  const assignments = viewer?.assignments ?? [];
  const outstanding = assignments.filter((assignment) => !assignment.submitted).length;

  const advance = useGameAction(state.id, () => advanceSession(state.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PhaseProgress progress={state.progress} counting="answers" />

      {viewer === null && (
        <Card className="mt-6 p-5">
          <p className="text-sm">{t('game.watching')}</p>
        </Card>
      )}

      {assignments.length > 1 && (
        <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
          {t('answering.load', { count: assignments.length })}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {assignments.map((assignment, index) => (
          <AssignmentCard
            key={assignment.assignmentId}
            sessionId={state.id}
            assignment={assignment}
            index={index}
            total={assignments.length}
            prompt={state.theme.answerPrompt}
          />
        ))}
      </div>

      {viewer !== null && outstanding === 0 && assignments.length > 0 && (
        <Card className="mt-6 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Check size={18} aria-hidden="true" className="text-[var(--color-success)]" />
            {t('answering.done')}
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('answering.doneBody')}</p>
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
            {t('answering.moveOn')}
          </Button>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('answering.moveOnNote')}</p>
        </div>
      )}
    </div>
  );
}

function AssignmentCard({
  sessionId,
  assignment,
  index,
  total,
  prompt,
}: {
  sessionId: string;
  assignment: AssignmentDto;
  index: number;
  total: number;
  prompt: string;
}) {
  const t = useT();
  const save = useGameAction(sessionId, (body: string) =>
    saveAnswer(sessionId, assignment.assignmentId, body),
  );
  const submit = useGameAction(sessionId, (body: string) =>
    submitAnswer(sessionId, assignment.assignmentId, body),
  );

  return (
    <Card className="p-5">
      <p className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {total === 1 ? t('answering.yourText') : t('answering.textOf', { index: index + 1, total })}
      </p>

      {/* Somebody wrote this. Which somebody is not on this screen and never was. */}
      <blockquote className="mt-2 border-l-2 border-[var(--color-accent)] pl-3 text-sm leading-relaxed whitespace-pre-wrap">
        {assignment.textBody}
      </blockquote>

      <div className="mt-4">
        {assignment.submitted ? (
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check size={16} aria-hidden="true" className="text-[var(--color-success)]" />
              {t('answering.answered')}
            </p>
            <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-ink-muted)]">
              {assignment.answerBody}
            </p>
          </div>
        ) : (
          <Composer
            label={prompt}
            initialValue={assignment.answerBody}
            submitLabel={t('answering.submit')}
            pending={submit.isPending}
            onSaveDraft={(body) => {
              save.mutate(body);
            }}
            onSubmit={(body) => {
              submit.mutate(body);
            }}
          />
        )}
      </div>
    </Card>
  );
}
