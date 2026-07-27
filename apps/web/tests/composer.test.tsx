import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEXT_MAX_LENGTH } from '@aftergame/shared';
import { Composer } from '../src/features/game/components/Composer.js';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider.js';

const noop = (): void => undefined;

/** The composer reads its own copy now, so it needs the locale its host would have given it. */
function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  return render(
    <LocaleProvider>
      <Composer
        label="Write your anecdote"
        submitLabel="Submit my text"
        onSaveDraft={noop}
        onSubmit={noop}
        {...props}
      />
    </LocaleProvider>,
  );
}

describe('the composer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels the textarea and shows the counter from the start', () => {
    renderComposer();

    expect(screen.getByRole('textbox', { name: 'Write your anecdote' })).toBeInTheDocument();
    expect(screen.getByText(`0 / ${String(TEXT_MAX_LENGTH)}`)).toBeInTheDocument();
  });

  it('stops at the limit rather than letting the server refuse it later', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByRole('textbox', { name: 'Write your anecdote' });

    // The attribute is the enforcement; typing past it is a browser behaviour, not ours.
    expect(textarea).toHaveAttribute('maxlength', String(TEXT_MAX_LENGTH));

    await user.type(textarea, 'hello');
    expect(screen.getByText(`5 / ${String(TEXT_MAX_LENGTH)}`)).toBeInTheDocument();
  });

  describe('the empty submit guard', () => {
    it('refuses, explains and puts the cursor back', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderComposer({ onSubmit });

      await user.click(screen.getByRole('button', { name: 'Submit my text' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent('cannot be empty');
      // Stranding someone next to a dead button is the failure this prevents.
      expect(screen.getByRole('textbox', { name: 'Write your anecdote' })).toHaveFocus();
    });

    it('treats whitespace as empty, the way the server and the database do', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderComposer({ onSubmit });

      await user.type(screen.getByRole('textbox', { name: 'Write your anecdote' }), '   \t  ');
      await user.click(screen.getByRole('button', { name: 'Submit my text' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('announces the button as disabled while it is refusing', () => {
      renderComposer();

      expect(screen.getByRole('button', { name: 'Submit my text' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('clears the warning as soon as there is something to submit', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderComposer({ onSubmit });

      await user.click(screen.getByRole('button', { name: 'Submit my text' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.type(screen.getByRole('textbox', { name: 'Write your anecdote' }), 'a real story');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit my text' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    });

    it('submits trimmed content once there is some', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderComposer({ onSubmit });

      await user.type(screen.getByRole('textbox', { name: 'Write your anecdote' }), '  a story  ');
      await user.click(screen.getByRole('button', { name: 'Submit my text' }));

      expect(onSubmit).toHaveBeenCalledWith('a story');
    });
  });

  describe('autosave', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // `fireEvent`, not `userEvent`, in this block only: userEvent schedules its own timers, and
    // coordinating two clocks would make these tests about the test harness rather than about
    // the debounce they exist to pin down.
    const typeInto = (value: string): void => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Write your anecdote' }), {
        target: { value },
      });
    };

    it('saves once after the typing stops, not once per keystroke', () => {
      const onSaveDraft = vi.fn();
      renderComposer({ onSaveDraft });

      typeInto('a');
      typeInto('a d');
      typeInto('a draft');

      expect(onSaveDraft).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(900);
      });

      // Three keystrokes, one request. A save per character would be a denial of service we
      // wrote ourselves.
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(onSaveDraft).toHaveBeenCalledWith('a draft');
    });

    it('does not re-save text it has already saved', () => {
      const onSaveDraft = vi.fn();
      const { rerender } = renderComposer({ onSaveDraft });

      typeInto('a draft');
      act(() => {
        vi.advanceTimersByTime(900);
      });

      // An unrelated re-render — a socket event, a sibling update — must not fire a second save.
      rerender(
        <LocaleProvider>
          <Composer
            label="Write your anecdote"
            submitLabel="Submit my text"
            onSaveDraft={onSaveDraft}
            onSubmit={noop}
          />
        </LocaleProvider>,
      );
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it('flushes an unsaved draft when the screen goes away', () => {
      const onSaveDraft = vi.fn();
      const { unmount } = renderComposer({ onSaveDraft });

      typeInto('half a story');

      // Leaving mid-sentence, before the debounce fires, is exactly when losing a draft hurts.
      unmount();

      expect(onSaveDraft).toHaveBeenCalledWith('half a story');
    });
  });

  describe('dictation', () => {
    it('shows no microphone where the browser has no speech API', () => {
      // Firefox, and every browser that has not shipped it. A button that does nothing would be
      // worse than no button.
      renderComposer();

      expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
    });

    it('offers a microphone where the API exists, and starts listening', async () => {
      const start = vi.fn();
      const instance = {
        lang: '',
        continuous: false,
        interimResults: false,
        start,
        stop: vi.fn(),
        abort: vi.fn(),
        onresult: null,
        onerror: null,
        onend: null,
      };

      vi.stubGlobal(
        'SpeechRecognition',
        vi.fn(() => instance),
      );

      const user = userEvent.setup();
      renderComposer();

      const mic = screen.getByRole('button', { name: 'Dictate' });
      expect(mic).toHaveAttribute('aria-pressed', 'false');

      await user.click(mic);

      expect(start).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      });
      expect(screen.getByRole('status')).toHaveTextContent('Listening');
    });

    it('appends what it heard to the text already there, leaving it editable', async () => {
      const instance: Record<string, unknown> = {
        lang: '',
        continuous: false,
        interimResults: false,
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        onresult: null,
        onerror: null,
        onend: null,
      };

      vi.stubGlobal(
        'webkitSpeechRecognition',
        vi.fn(() => instance),
      );

      const user = userEvent.setup();
      renderComposer();

      const textarea = screen.getByRole('textbox', { name: 'Write your anecdote' });
      await user.type(textarea, 'I once');
      await user.click(screen.getByRole('button', { name: 'Dictate' }));

      // The browser reports a final result.
      act(() => {
        (instance.onresult as (event: unknown) => void)({
          resultIndex: 0,
          results: {
            length: 1,
            0: { length: 1, isFinal: true, 0: { transcript: 'tried to bake a cake' } },
          },
        });
      });

      // Dictation produces a draft, not a commitment — the textarea stays the source of truth.
      expect(textarea).toHaveValue('I once tried to bake a cake');
      await user.type(textarea, ' in a toaster');
      expect(textarea).toHaveValue('I once tried to bake a cake in a toaster');
    });
  });
});
