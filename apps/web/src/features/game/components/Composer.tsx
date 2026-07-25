import { useId, useRef, useState } from 'react';
import { Button, cn } from '@aftergame/ui';
import { Mic, MicOff } from 'lucide-react';
import { TEXT_MAX_LENGTH } from '@aftergame/shared';
import { useAutosave } from '../hooks/useAutosave.js';
import { useDictation } from '../hooks/useDictation.js';

/** The counter turns amber here, and red at the limit. Spec: "amber at 900, red at 1000". */
const WARN_AT = 900;

export interface ComposerProps {
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  pending?: boolean;
  onSaveDraft: (body: string) => void;
  onSubmit: (body: string) => void;
}

/**
 * Where every word in the game gets written — one text in `WRITING`, one answer per card in
 * `ANSWERING`. Identical rules in both places, because they are the same promise to the player.
 *
 * Four behaviours are the point:
 *
 *   - **Autosave.** Drafts persist without being asked for, so a closed tab loses nothing.
 *   - **A hard limit.** The textarea stops at 1000 characters rather than letting someone write
 *     1200 and discover on submit that the server disagrees.
 *   - **Empty submit is refused, out loud.** See the note on the submit button below.
 *   - **Dictation where it exists.** Feature-detected, so Firefox simply sees no microphone.
 */
export function Composer({
  label,
  placeholder,
  initialValue = '',
  submitLabel,
  pending = false,
  onSaveDraft,
  onSubmit,
}: ComposerProps) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [warning, setWarning] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  const isEmpty = value.trim() === '';

  useAutosave(value, onSaveDraft, { enabled: !pending });

  const dictation = useDictation((chunk) => {
    setValue((current) => {
      const next = current === '' ? chunk : `${current} ${chunk.trim()}`;

      return next.slice(0, TEXT_MAX_LENGTH);
    });
  });

  const submit = (): void => {
    if (isEmpty) {
      // Refusing silently would leave the player pressing a dead button and guessing why.
      setWarning('Write something first — it cannot be empty.');
      textarea.current?.focus();

      return;
    }

    setWarning(null);
    onSubmit(value.trim());
  };

  const remaining = value.length;
  const counterTone =
    remaining >= TEXT_MAX_LENGTH
      ? 'text-[var(--color-danger)]'
      : remaining >= WARN_AT
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-ink-muted)]';

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
      </label>

      <div className="relative">
        <textarea
          id={id}
          ref={textarea}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (warning !== null && event.target.value.trim() !== '') setWarning(null);
          }}
          placeholder={placeholder}
          // The limit is the same constant the server validates against and the database
          // constrains, so the three can never disagree about what "too long" means.
          maxLength={TEXT_MAX_LENGTH}
          rows={6}
          spellCheck
          aria-describedby={`${id}-counter${warning === null ? '' : ` ${id}-warning`}`}
          aria-invalid={warning !== null}
          className={cn(
            'w-full resize-y rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-3',
            'text-sm leading-relaxed outline-none transition-colors',
            'focus-visible:border-[var(--color-accent)]',
            warning === null ? 'border-[var(--color-border)]' : 'border-[var(--color-danger)]',
          )}
        />

        {dictation.supported && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-2 bottom-2"
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictation.listening}
            onClick={dictation.listening ? dictation.stop : dictation.start}
          >
            {dictation.listening ? (
              <MicOff size={16} aria-hidden="true" />
            ) : (
              <Mic size={16} aria-hidden="true" />
            )}
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p id={`${id}-counter`} className={cn('text-xs tabular-nums', counterTone)}>
          {remaining} / {TEXT_MAX_LENGTH}
        </p>

        {/*
          `aria-disabled`, not `disabled`.

          The flow doc asks for a disabled submit *and* an inline warning, which a truly disabled
          button cannot deliver: it is unclickable, skipped by some screen readers, and explains
          nothing. This looks disabled, is announced disabled, and still says why when pressed —
          which is what the requirement was for.
        */}
        <Button
          variant="primary"
          onClick={submit}
          pending={pending}
          aria-disabled={isEmpty}
          className={cn(isEmpty && 'cursor-not-allowed opacity-55')}
        >
          {submitLabel}
        </Button>
      </div>

      {warning !== null && (
        <p id={`${id}-warning`} role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          {warning}
        </p>
      )}

      {dictation.listening && (
        <p role="status" className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Listening… speak, then edit anything it got wrong.
        </p>
      )}
    </div>
  );
}
