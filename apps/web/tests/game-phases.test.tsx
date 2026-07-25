import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ANECDOTES,
  installApiStub,
  makeGroup,
  makeSession,
  makeTimeline,
  viewer,
} from './helpers/game-fixtures.js';
import { renderGame } from './helpers/render-game.js';
import { findAccessibilityViolations, describeViolations } from './helpers/render.js';
import { setViewportWidth, VIEWPORTS } from './helpers/viewport.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Wait for the pinned theme banner, which every phase renders once its payload has landed. */
const gameLoaded = () => screen.findByRole('heading', { name: 'Anecdotes' });

describe('the lobby', () => {
  it('shows the roster and what each punishment level costs', async () => {
    installApiStub({ session: makeSession('LOBBY') });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/sarah answers 1 text/i)).toBeInTheDocument();

    // ahmed is on two punishments, so he answers three texts — computed with `demandFor`, the
    // same function the distributor uses, rather than a second copy of the rule.
    expect(screen.getByText(/ahmed answers 3 texts · 2 punishments/i)).toBeInTheDocument();
  });

  it('explains a capped penalty rather than silently shrinking it', async () => {
    // Two players cannot supply three texts, so the load clamps (D3). Saying nothing here would
    // make a punished player think the penalty quietly went away.
    installApiStub({
      session: makeSession('LOBBY', {
        players: [
          { playerId: 'p1', username: 'sarah', isYou: true, hasLeft: false, answerLoad: 1 },
          { playerId: 'p2', username: 'ahmed', isYou: false, hasLeft: false, answerLoad: 2 },
        ],
      }),
    });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/not enough texts to hand out the full penalty/i)).toBeVisible();
  });

  it('will not let a host start a game with one player', async () => {
    installApiStub({
      session: makeSession('LOBBY', {
        you: viewer({ isHost: true }),
        players: [
          { playerId: 'p1', username: 'sarah', isYou: true, hasLeft: false, answerLoad: 1 },
        ],
      }),
    });
    renderGame();
    await gameLoaded();

    expect(await screen.findByRole('button', { name: /start the game/i })).toBeDisabled();
    expect(screen.getByText(/at least 2 players/i)).toBeInTheDocument();
  });

  it('replaces join with an explanation for a blocked member', async () => {
    const group = makeGroup();
    group.members[0]!.status = 'GAME_BLOCKED';

    installApiStub({ session: makeSession('LOBBY', { you: null }), group });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/until a host forgives you/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join the game/i })).not.toBeInTheDocument();
  });

  it('starts the game and lands on the writing screen', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({
      session: makeSession('LOBBY', { you: viewer({ isHost: true }) }),
    });
    renderGame();
    await gameLoaded();

    // The server's response is the new phase; the client renders what it is told.
    stub.setSession(makeSession('WRITING', { you: viewer({ isHost: true }) }));
    await user.click(screen.getByRole('button', { name: /start the game/i }));

    expect(await screen.findByRole('textbox', { name: 'Write your anecdote' })).toBeInTheDocument();
  });
});

describe('the writing phase', () => {
  const writing = (overrides = {}) =>
    makeSession('WRITING', { progress: { submitted: 1, required: 3 }, ...overrides });

  it('keeps the theme pinned and counts texts without naming anyone', async () => {
    installApiStub({ session: writing() });
    renderGame();
    await gameLoaded();

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('1 / 3 texts in')).toBeInTheDocument();

    // "Waiting for ahmed" plus a text arriving a second later is an attribution. The counter is
    // the only signal this phase can safely give.
    expect(screen.queryByText(/waiting for/i)).not.toBeInTheDocument();
    expect(screen.queryByText('ahmed')).not.toBeInTheDocument();
  });

  it('restores the draft the server is holding', async () => {
    installApiStub({ session: writing({ you: viewer({ draftText: 'half a story' }) }) });
    renderGame();
    await gameLoaded();

    // F9: a reconnecting player lands exactly where the game is, with what they had typed.
    expect(await screen.findByRole('textbox', { name: 'Write your anecdote' })).toHaveValue(
      'half a story',
    );
  });

  it('submits the text and says what happens next, not who is late', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({ session: writing() });
    renderGame();
    await gameLoaded();

    await user.type(
      await screen.findByRole('textbox', { name: 'Write your anecdote' }),
      'a real story',
    );

    stub.setSession(writing({ you: viewer({ textSubmitted: true }) }));
    await user.click(screen.getByRole('button', { name: /submit my text/i }));

    expect(await screen.findByText(/your text is in/i)).toBeInTheDocument();
    expect(stub.lastCall('/text/submit')?.body).toEqual({ body: 'a real story' });
    expect(screen.getByText(/never back to whoever wrote them/i)).toBeInTheDocument();
  });
});

describe('the answering phase', () => {
  const answering = (
    assignments: {
      assignmentId: string;
      textBody: string;
      answerBody: string;
      submitted: boolean;
    }[],
  ) =>
    makeSession('ANSWERING', {
      progress: { submitted: 0, required: 5 },
      you: viewer({ assignments }),
    });

  it('deals a queue of cards, one per assignment', async () => {
    installApiStub({
      session: answering([
        { assignmentId: 'as1', textBody: 'A toaster cake.', answerBody: '', submitted: false },
        { assignmentId: 'as2', textBody: 'Lost in a shop.', answerBody: '', submitted: false },
        { assignmentId: 'as3', textBody: 'A dared haircut.', answerBody: '', submitted: false },
      ]),
    });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText('Text 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('A toaster cake.')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'What do you say to this?' })).toHaveLength(3);
    expect(screen.getByText(/that is your punishment load/i)).toBeInTheDocument();
  });

  it('says nothing about who wrote a text or how many cards anyone else holds', async () => {
    installApiStub({
      session: answering([
        { assignmentId: 'as1', textBody: 'A toaster cake.', answerBody: '', submitted: false },
      ]),
    });
    renderGame();
    await gameLoaded();

    // Knowing that one player holds three cards, in a game whose lobby showed who was punished,
    // attaches a name to whichever answers appear in triplicate.
    for (const name of ['ahmed', 'lina']) {
      expect(screen.queryByText(new RegExp(name, 'i'))).not.toBeInTheDocument();
    }
  });

  it('submits one card and leaves the others alone', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({
      session: answering([
        { assignmentId: 'as1', textBody: 'A toaster cake.', answerBody: '', submitted: false },
        { assignmentId: 'as2', textBody: 'Lost in a shop.', answerBody: '', submitted: false },
      ]),
    });
    renderGame();
    await gameLoaded();

    const composers = await screen.findAllByRole('textbox', { name: 'What do you say to this?' });
    await user.type(composers[0]!, 'Respect for the ambition.');

    stub.setSession(
      answering([
        {
          assignmentId: 'as1',
          textBody: 'A toaster cake.',
          answerBody: 'Respect for the ambition.',
          submitted: true,
        },
        { assignmentId: 'as2', textBody: 'Lost in a shop.', answerBody: '', submitted: false },
      ]),
    );
    await user.click(screen.getAllByRole('button', { name: /submit answer/i })[0]!);

    expect(stub.lastCall('/assignments/as1/answer/submit')?.body).toEqual({
      body: 'Respect for the ambition.',
    });
    expect(await screen.findByText('Answered')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'What do you say to this?' })).toHaveLength(1);
  });
});

describe('the timeline', () => {
  const review = (timeline = makeTimeline()) => makeSession('REVIEW', { timeline });

  it('renders texts in the order the server sent them', async () => {
    installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    const items = await screen.findAllByRole('listitem');
    const texts = items.filter((item) => item.textContent?.includes('toaster') === true);

    // Order comes from the game's display seed. Sorting locally by anything — time, id, length —
    // would leak submission order, which identifies the fastest typist (A7).
    expect(texts[0]).toBeDefined();
    expect(
      screen.getByText(/toaster/).compareDocumentPosition(screen.getByText(/supermarket/)),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows both answers to a text that two players were dealt', async () => {
    installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    // The punishment mechanic showing its face (D1) — and one of the better moments in the game.
    expect(await screen.findByText('Respect for the ambition.')).toBeInTheDocument();
    expect(screen.getByText('My cousin dared me to do the same.')).toBeInTheDocument();
  });

  it('marks an unanswered text as unanswered rather than hiding it', async () => {
    installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/no answer/i)).toBeInTheDocument();
  });

  it('posts a comment anonymously by default, and signed when asked', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    const boxes = await screen.findAllByRole('textbox', { name: 'Add a comment' });
    await user.type(boxes[0]!, 'That is hilarious.');
    await user.click(screen.getAllByRole('button', { name: 'Post' })[0]!);

    expect(stub.lastCall('/comments')?.body).toEqual({
      body: 'That is hilarious.',
      isAnonymous: true,
    });

    // The choice is per comment and made at post time (D17), so it lives next to the box.
    await user.click(screen.getAllByRole('radio', { name: 'sarah' })[0]!);
    await user.type(screen.getAllByRole('textbox', { name: 'Add a comment' })[0]!, 'It was me.');
    await user.click(screen.getAllByRole('button', { name: 'Post' })[0]!);

    expect(stub.lastCall('/comments')?.body).toEqual({ body: 'It was me.', isAnonymous: false });
  });

  it('shows an anonymous comment as anonymous and a signed one by name', async () => {
    installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    const anonymous = (await screen.findByText(/That is hilarious/)).closest('li');
    expect(anonymous).toHaveTextContent('Anonymous — That is hilarious.');

    const signed = screen.getByText(/I think I know who wrote this/).closest('li');
    expect(signed).toHaveTextContent('sarah — I think I know who wrote this.');
  });

  it('takes a guess and says nothing about whether it was right', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    const groups = await screen.findAllByRole('group', { name: 'Guess the author' });
    await user.click(within(groups[0]!).getByRole('button', { name: 'ahmed' }));

    expect(stub.lastCall('/guess')?.body).toEqual({ guessedPlayerId: 'p2' });

    // Correctness is gated behind the same reveal wall as the names themselves (D9): "your guess
    // of ahmed was right" is the author's name in a different sentence.
    expect(screen.queryByText(/correct/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/that was right/i)).not.toBeInTheDocument();
  });

  it('offers no leaderboard until the group has revealed', async () => {
    installApiStub({ session: review() });
    renderGame();
    await gameLoaded();

    expect(screen.queryByText(/who read the room/i)).not.toBeInTheDocument();
  });
});

describe('the reveal', () => {
  const reveal = (overrides = {}) =>
    makeSession('REVEAL', {
      timeline: makeTimeline(),
      reveal: { decided: 2, total: 3, closed: false, revealed: false },
      ...overrides,
    });

  it('states the rule and the privacy before asking for a vote', async () => {
    installApiStub({ session: reveal() });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/your choice is private/i)).toBeInTheDocument();
    expect(screen.getByText(/one person saying no keeps the whole game anonymous/i)).toBeVisible();
    expect(screen.getByText(/not voting counts as no/i)).toBeInTheDocument();
  });

  it('shows how many have decided and never how they voted', async () => {
    installApiStub({ session: reveal() });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText('2 of 3 have decided.')).toBeInTheDocument();

    // D8a: in a small group the split identifies whoever refused, so it is never sent and never
    // shown. These are the shapes a leak would take.
    expect(screen.queryByText(/\byes\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 against|2 for|voted no|voted yes/i)).not.toBeInTheDocument();
  });

  it('warns a small game that a refusal is inferable, before the vote', async () => {
    installApiStub({
      session: reveal({
        players: [
          { playerId: 'p1', username: 'sarah', isYou: true, hasLeft: false, answerLoad: 1 },
          { playerId: 'p2', username: 'ahmed', isYou: false, hasLeft: false, answerLoad: 1 },
        ],
      }),
    });
    renderGame();
    await gameLoaded();

    // The inference follows from the rule itself, so the honest move is to say so while it can
    // still change what someone chooses.
    expect(await screen.findByText(/identifies them outright/i)).toBeInTheDocument();
  });

  it('does not warn a game large enough for the vote to stay private', async () => {
    installApiStub({
      session: reveal({
        players: [
          { playerId: 'p1', username: 'sarah', isYou: true, hasLeft: false, answerLoad: 1 },
          { playerId: 'p2', username: 'ahmed', isYou: false, hasLeft: false, answerLoad: 1 },
          { playerId: 'p3', username: 'lina', isYou: false, hasLeft: false, answerLoad: 1 },
          { playerId: 'p4', username: 'omar', isYou: false, hasLeft: false, answerLoad: 1 },
        ],
      }),
    });
    renderGame();
    await gameLoaded();

    expect(screen.queryByText(/narrows down who refused/i)).not.toBeInTheDocument();
  });

  it('casts a vote and then keeps quiet about it', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({ session: reveal() });
    renderGame();
    await gameLoaded();

    stub.setSession(reveal({ you: viewer({ revealVoteCast: true }) }));
    await user.click(await screen.findByRole('button', { name: /reveal the authors/i }));

    expect(stub.lastCall('/reveal-vote')?.body).toEqual({ choice: 'YES' });
    expect(await screen.findByText(/your vote is in/i)).toBeInTheDocument();
    // The screen must not become a record of which button this player pressed.
    expect(screen.queryByRole('button', { name: /reveal the authors/i })).not.toBeInTheDocument();
  });

  it('announces a failed reveal as a group outcome, with no hint of who refused', async () => {
    installApiStub({
      session: makeSession('COMPLETED', {
        timeline: makeTimeline(),
        reveal: { decided: 3, total: 3, closed: true, revealed: false },
      }),
    });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/the group chose to stay anonymous/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody is told who wanted what/i)).toBeInTheDocument();
    expect(screen.queryByText(/refused|blocked it|vetoed/i)).not.toBeInTheDocument();
  });

  it('shows names and scores when everyone agreed', async () => {
    const timeline = makeTimeline({ authorsVisible: true });
    timeline.texts[0]!.author = { playerId: 'p2', username: 'ahmed' };
    timeline.texts[0]!.yourGuess = { playerId: 'p2', username: 'ahmed' };
    timeline.texts[0]!.yourGuessCorrect = true;
    timeline.guessScores = [
      { player: { playerId: 'p1', username: 'sarah' }, correct: 1, total: 2 },
      { player: { playerId: 'p2', username: 'ahmed' }, correct: 0, total: 2 },
    ];

    installApiStub({
      session: makeSession('COMPLETED', {
        timeline,
        reveal: { decided: 3, total: 3, closed: true, revealed: true },
        purgeAfter: new Date(Date.now() + 23.5 * 3_600_000).toISOString(),
      }),
    });
    renderGame();
    await gameLoaded();

    expect(await screen.findByText(/everyone agreed/i)).toBeInTheDocument();
    expect(screen.getByText('Written by ahmed')).toBeInTheDocument();
    expect(screen.getByText(/who read the room/i)).toBeInTheDocument();
    expect(screen.getByText(/that was right/i)).toBeInTheDocument();
    // D11: the game is deleted after the grace window, and saying so is the difference between a
    // promise kept and data mysteriously vanishing.
    expect(screen.getByText(/disappears in 23 hours/i)).toBeInTheDocument();
  });
});

describe('a game that is gone', () => {
  it('reads as an ending rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith('/auth/me')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { id: 'u1', username: 'sarah', email: 's@x.com', createdAt: '' },
              }),
              { status: 200 },
            ),
          );
        }

        if (url.includes('/sessions/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                type: 'about:blank',
                title: 'Gone',
                status: 404,
                code: 'SESSION_GONE',
              }),
              { status: 404 },
            ),
          );
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }),
    );

    renderGame();

    expect(
      await screen.findByRole('heading', { name: /ended and been deleted/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/that was the deal when you played it/i)).toBeInTheDocument();
  });
});

describe('the game on a phone', () => {
  it('renders the whole flow at 320px', async () => {
    setViewportWidth(VIEWPORTS.phone);
    installApiStub({ session: makeSession('REVIEW', { timeline: makeTimeline() }) });
    renderGame();
    await gameLoaded();

    // The main panel takes the full width below `md`; the game is the screen.
    expect(await screen.findByText(/toaster/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Groups' })).not.toBeInTheDocument();
  });
});

/** Kept honest by the fixtures: an anonymous author is `null` on the wire, not a hidden field. */
describe('what the screen never says', () => {
  const phases = [
    ['writing', makeSession('WRITING')],
    [
      'answering',
      makeSession('ANSWERING', {
        you: viewer({
          assignments: [
            { assignmentId: 'as1', textBody: 'A toaster cake.', answerBody: '', submitted: false },
          ],
        }),
      }),
    ],
    ['the timeline', makeSession('REVIEW', { timeline: makeTimeline() })],
    [
      'the reveal',
      makeSession('REVEAL', {
        timeline: makeTimeline(),
        reveal: { decided: 1, total: 3, closed: false, revealed: false },
      }),
    ],
  ] as const;

  it.each(phases)('attaches no author to any text in %s', async (_label, session) => {
    installApiStub({ session });
    renderGame();
    await gameLoaded();

    // Anchored deliberately. A looser probe would match the guess widget's own "Who wrote this?"
    // and pass for the wrong reason — the assertion is about attribution, not about the word.
    await waitFor(() => {
      expect(screen.queryByText(/^Written by /)).not.toBeInTheDocument();
    });

    expect(screen.queryByText(/^by (sarah|ahmed|lina)$/i)).not.toBeInTheDocument();
  });

  it('says every text is anonymous rather than leaving attribution blank', async () => {
    installApiStub({ session: makeSession('REVIEW', { timeline: makeTimeline() }) });
    renderGame();
    await gameLoaded();

    // Absence of a name is ambiguous; "Written anonymously" is a statement. Two texts, two
    // statements — no card quietly missing its attribution line.
    expect(await screen.findAllByText('Written anonymously')).toHaveLength(2);
  });
});

describe('host controls', () => {
  it('offers the one transition the server actually has out of the discussion', async () => {
    const user = userEvent.setup();
    const stub = installApiStub({
      session: makeSession('REVIEW', { timeline: makeTimeline(), you: viewer({ isHost: true }) }),
    });
    renderGame();
    await gameLoaded();

    // `advance` is rejected from REVIEW — the phase machine's only edge out is `endGame`, which
    // opens the vote. Offering a second button labelled "end without revealing" would promise the
    // host a power the rules deliberately withhold (D8).
    stub.setSession(
      makeSession('REVEAL', {
        timeline: makeTimeline(),
        you: viewer({ isHost: true }),
        reveal: { decided: 0, total: 3, closed: false, revealed: false },
      }),
    );

    await user.click(await screen.findByRole('button', { name: /move to the reveal vote/i }));

    expect(stub.lastCall('/end')?.method).toBe('POST');
    expect(await screen.findByText(/your choice is private/i)).toBeInTheDocument();
  });

  it('shows no host controls to a player who is not the host', async () => {
    installApiStub({ session: makeSession('REVIEW', { timeline: makeTimeline() }) });
    renderGame();
    await gameLoaded();

    await screen.findByText(/toaster/);
    expect(
      screen.queryByRole('button', { name: /move to the reveal vote/i }),
    ).not.toBeInTheDocument();
  });
});

describe('accessibility', () => {
  const phases: [string, ReturnType<typeof makeSession>][] = [
    ['the lobby', makeSession('LOBBY', { you: viewer({ isHost: true }) })],
    ['writing', makeSession('WRITING', { progress: { submitted: 1, required: 3 } })],
    [
      'answering',
      makeSession('ANSWERING', {
        you: viewer({
          assignments: [
            { assignmentId: 'as1', textBody: 'A toaster cake.', answerBody: '', submitted: false },
            { assignmentId: 'as2', textBody: 'Lost in a shop.', answerBody: '', submitted: false },
          ],
        }),
      }),
    ],
    [
      'the timeline',
      makeSession('REVIEW', { timeline: makeTimeline(), you: viewer({ isHost: true }) }),
    ],
    [
      'the reveal',
      makeSession('REVEAL', {
        timeline: makeTimeline(),
        reveal: { decided: 1, total: 3, closed: false, revealed: false },
      }),
    ],
    [
      'the finished game',
      makeSession('COMPLETED', {
        timeline: makeTimeline({ authorsVisible: true }),
        reveal: { decided: 3, total: 3, closed: true, revealed: true },
        purgeAfter: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      }),
    ],
  ];

  it.each(phases)('has no axe violations in %s', async (_label, session) => {
    installApiStub({ session });
    const { container } = renderGame();
    await gameLoaded();

    const violations = await findAccessibilityViolations(container);

    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('has no axe violations in dark mode', async () => {
    document.documentElement.classList.add('dark');
    installApiStub({ session: makeSession('REVIEW', { timeline: makeTimeline() }) });

    const { container } = renderGame();
    await gameLoaded();

    const violations = await findAccessibilityViolations(container);

    expect(violations, describeViolations(violations)).toEqual([]);
    document.documentElement.classList.remove('dark');
  });

  it('labels the theme banner icon as decoration, not content', async () => {
    installApiStub({ session: makeSession('WRITING') });
    renderGame();
    await gameLoaded();

    // A screen reader announcing "speech balloon heart Anecdotes" every phase would be noise.
    expect(screen.getByText(ANECDOTES.icon)).toHaveAttribute('aria-hidden', 'true');
  });
});
