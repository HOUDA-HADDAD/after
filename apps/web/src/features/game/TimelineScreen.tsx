import { Badge, Button, Card, EmptyState } from '@aftergame/ui';
import { EyeOff, MessagesSquare, Trophy } from 'lucide-react';
import type { SessionStateDto, TimelineTextDto } from '@aftergame/shared';
import { CommentThread } from './components/CommentThread.js';
import { GuessWidget } from './components/GuessWidget.js';
import { endSession, postComment, submitGuess } from './game.api.js';
import { useGameAction, useGameEffect } from './useGame.js';

/**
 * The timeline — every text, every answer, and the conversation about them.
 *
 * Three properties are load-bearing rather than decorative:
 *
 *   - **Order comes from the server**, shuffled by the game's display seed. Rendering in
 *     submission order would identify the fastest typist for free (A7).
 *   - **A text can carry two answers.** That is the punishment mechanic showing its face (D1),
 *     and it is one of the better moments in the game, so it is laid out as a thread rather than
 *     flattened.
 *   - **Names appear only where the server put them.** `authorsVisible` is the server's answer,
 *     not a local toggle; this component has no branch that could show a name the payload does
 *     not contain, because the payload does not contain one.
 */
export function TimelineScreen({ state }: { state: SessionStateDto }) {
  const timeline = state.timeline;
  const viewer = state.you;
  const isReview = state.phase === 'REVIEW';

  const end = useGameAction(state.id, () => endSession(state.id));

  const comment = useGameEffect(
    state.id,
    ({ answerId, body, isAnonymous }: { answerId: string; body: string; isAnonymous: boolean }) =>
      postComment(state.id, answerId, body, isAnonymous),
  );

  const guess = useGameEffect(
    state.id,
    ({ textId, playerId }: { textId: string; playerId: string }) =>
      submitGuess(state.id, textId, playerId),
  );

  if (timeline === null || viewer === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={<MessagesSquare size={28} aria-hidden="true" />}
          title="Nothing to read here"
          description="This timeline belongs to the people who played the game."
        />
      </div>
    );
  }

  const yourName = state.players.find((player) => player.isYou)?.username ?? 'you';

  return (
    <div className="mx-auto max-w-[72ch] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {timeline.texts.length} {timeline.texts.length === 1 ? 'text' : 'texts'}
        </h2>

        {timeline.authorsVisible ? (
          <Badge tone="accent">Authors revealed</Badge>
        ) : (
          <Badge>
            <EyeOff size={12} aria-hidden="true" className="mr-1" />
            Anonymous
          </Badge>
        )}
      </div>

      <ol className="mt-4 flex flex-col gap-6">
        {timeline.texts.map((text, index) => (
          <li
            key={text.id}
            // A gentle stagger so the table reads down the page rather than being hit with
            // everything at once. Disabled outright for anyone who asked for less motion.
            className="motion-safe:animate-[fade-in-up_400ms_ease-out_backwards]"
            style={{ animationDelay: `${String(Math.min(index, 8) * 60)}ms` }}
          >
            <TimelineCard
              text={text}
              state={state}
              isReview={isReview}
              yourName={yourName}
              commentPending={comment.isPending}
              guessPending={guess.isPending}
              onComment={(answerId, body, isAnonymous) => {
                comment.mutate({ answerId, body, isAnonymous });
              }}
              onGuess={(playerId) => {
                guess.mutate({ textId: text.id, playerId });
              }}
            />
          </li>
        ))}
      </ol>

      {timeline.guessScores !== null && (
        <Card className="mt-8 p-5">
          <h3 className="flex items-center gap-2 font-medium">
            <Trophy size={16} aria-hidden="true" />
            Who read the room
          </h3>

          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {timeline.guessScores.map((score) => (
              <li key={score.player.playerId} className="flex justify-between gap-3">
                <span>{score.player.username}</span>
                <span className="text-[var(--color-ink-muted)] tabular-nums">
                  {score.correct} / {score.total}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {viewer.isHost && isReview && (
        <div className="mt-8">
          {/*
            One control, because the server offers one transition out of `REVIEW`: it opens the
            vote. There is no "end without revealing" to offer — that outcome is the group's to
            decide by voting, not the host's to impose (D8).
          */}
          <Button
            variant="primary"
            pending={end.isPending}
            onClick={() => {
              end.mutate();
            }}
          >
            Move to the reveal vote
          </Button>

          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Everyone votes privately on whether to put names to the texts.
          </p>
        </div>
      )}
    </div>
  );
}

function TimelineCard({
  text,
  state,
  isReview,
  yourName,
  commentPending,
  guessPending,
  onComment,
  onGuess,
}: {
  text: TimelineTextDto;
  state: SessionStateDto;
  isReview: boolean;
  yourName: string;
  commentPending: boolean;
  guessPending: boolean;
  onComment: (answerId: string, body: string, isAnonymous: boolean) => void;
  onGuess: (playerId: string) => void;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{text.body}</p>

      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        {text.author === null ? 'Written anonymously' : `Written by ${text.author.username}`}
      </p>

      <div className="mt-4 flex flex-col gap-4 border-l border-[var(--color-border)] pl-4">
        {text.answers.length === 0 && (
          <p className="text-sm text-[var(--color-ink-muted)] italic">Nobody answered this one.</p>
        )}

        {text.answers.map((answer) => (
          <div key={answer.id}>
            {answer.skipped ? (
              <p className="text-sm text-[var(--color-ink-muted)] italic">
                No answer — this player ran out of time.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.body}</p>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {answer.author === null ? 'Anonymous player' : answer.author.username}
                </p>
              </>
            )}

            {state.theme.supportsComments && (
              <CommentThread
                comments={answer.comments}
                yourName={yourName}
                canComment={isReview && !answer.skipped}
                pending={commentPending}
                onPost={(body, isAnonymous) => {
                  onComment(answer.id, body, isAnonymous);
                }}
              />
            )}
          </div>
        ))}
      </div>

      {state.theme.supportsAuthorGuess && (
        <GuessWidget
          text={text}
          players={state.players}
          open={isReview}
          pending={guessPending}
          onGuess={onGuess}
        />
      )}
    </Card>
  );
}
