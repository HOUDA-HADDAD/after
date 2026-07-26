import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REACTIONS } from '@aftergame/shared';
import { installApiStub, makeSession, makeTimeline, viewer } from './helpers/game-fixtures.js';
import { renderGame } from './helpers/render-game.js';
import { findAccessibilityViolations, describeViolations } from './helpers/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const gameLoaded = () => screen.findByRole('heading', { name: 'Anecdotes' });

/** A timeline whose first answer already carries a tally. */
function withReactions(
  reactions: { emoji: string; count: number; youReacted: boolean }[],
  phase: 'REVIEW' | 'COMPLETED' = 'REVIEW',
) {
  const timeline = makeTimeline();

  timeline.texts[0]!.answers[0]!.reactions = reactions;

  return makeSession(phase, {
    timeline,
    ...(phase === 'COMPLETED'
      ? { reveal: { decided: 3, total: 3, closed: true, revealed: false } }
      : {}),
  });
}

describe('reactions', () => {
  it('offers the whole palette while the discussion is open', async () => {
    installApiStub({ session: withReactions([]) });
    renderGame();
    await gameLoaded();

    // Six is few enough to show; hiding them behind a "+" makes a feature nobody finds.
    for (const emoji of REACTIONS) {
      expect(
        await screen.findAllByRole('button', { name: new RegExp(`React with ${emoji}`) }),
      ).not.toHaveLength(0);
    }
  });

  it('shows a count and marks the viewer’s own', async () => {
    installApiStub({
      session: withReactions([
        { emoji: '😂', count: 3, youReacted: true },
        { emoji: '👏', count: 1, youReacted: false },
      ]),
    });
    renderGame();
    await gameLoaded();

    const mine = await screen.findByRole('button', { name: /Remove your 😂 reaction/ });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    expect(within(mine).getByText('3')).toBeInTheDocument();

    const theirs = screen.getByRole('button', { name: /React with 👏, 1 so far/ });
    expect(theirs).toHaveAttribute('aria-pressed', 'false');
  });

  it('says nothing about who reacted', async () => {
    installApiStub({
      session: withReactions([{ emoji: '😂', count: 3, youReacted: false }]),
    });
    renderGame();
    await gameLoaded();

    await screen.findByRole('button', { name: /React with 😂, 3 so far/ });

    // The payload has no field for it (D20), so there is nothing to render — this pins that the
    // screen does not go looking for one elsewhere, such as the player list.
    for (const name of ['sarah', 'ahmed', 'lina']) {
      expect(screen.queryByText(new RegExp(`${name} reacted`, 'i'))).not.toBeInTheDocument();
    }
  });

  it('adds a reaction the viewer has not given', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({ session: withReactions([]) });
    renderGame();
    await gameLoaded();

    await user.click((await screen.findAllByRole('button', { name: /React with ❤️/ }))[0]!);

    const call = stub.lastCall('/reactions');
    expect(call?.method).toBe('PUT');
    expect(call?.body).toEqual({ emoji: '❤️' });
  });

  it('takes back one the viewer already gave', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({
      session: withReactions([{ emoji: '🤔', count: 1, youReacted: true }]),
    });
    renderGame();
    await gameLoaded();

    await user.click(await screen.findByRole('button', { name: /Remove your 🤔 reaction/ }));

    // A toggle, because that is what the button does — and it makes a double tap harmless.
    const call = stub.lastCall('/reactions');
    expect(call?.method).toBe('DELETE');
    expect(call?.body).toEqual({ emoji: '🤔' });
  });

  it('keeps the tally readable after the discussion closes, without the buttons', async () => {
    installApiStub({
      session: withReactions([{ emoji: '😮', count: 2, youReacted: false }], 'COMPLETED'),
    });
    renderGame();
    await gameLoaded();

    const button = await screen.findByRole('button', { name: /React with 😮, 2 so far/ });

    expect(button).toBeDisabled();
    // Untouched emoji disappear once nobody can act on them — a row of dead buttons is noise.
    expect(screen.queryByRole('button', { name: /React with 👏/ })).not.toBeInTheDocument();
  });

  it('offers nothing on a skipped answer', async () => {
    const timeline = makeTimeline();

    installApiStub({ session: makeSession('REVIEW', { timeline }) });
    renderGame();
    await gameLoaded();

    // The second text's only answer was never written. There is nothing there to react to.
    const skipped = (await screen.findByText(/no answer/i)).closest('div');
    expect(within(skipped!).queryByRole('button', { name: /React with/ })).not.toBeInTheDocument();
  });

  it('is absent for a theme without a discussion', async () => {
    const timeline = makeTimeline();
    const session = makeSession('REVIEW', { timeline, you: viewer() });

    session.theme = { ...session.theme, supportsComments: false };
    installApiStub({ session });
    renderGame();
    await gameLoaded();

    // Capability flags decide, not the slug (D15).
    await screen.findByText(/toaster/);
    expect(screen.queryByRole('button', { name: /React with/ })).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    installApiStub({
      session: withReactions([{ emoji: '😂', count: 3, youReacted: true }]),
    });

    const { container } = renderGame();
    await gameLoaded();

    const violations = await findAccessibilityViolations(container);

    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
