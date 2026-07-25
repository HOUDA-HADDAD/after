import { useId, useState } from 'react';
import { Button, cn } from '@aftergame/ui';
import { MessageCircle } from 'lucide-react';
import { COMMENT_MAX_LENGTH, type TimelineCommentDto } from '@aftergame/shared';

/**
 * Comments under one answer.
 *
 * The anonymous/named choice is made **per comment, at post time, and is never reversible**
 * (D17). That is why it is a radio group next to the box rather than a profile setting: the
 * decision belongs to the sentence you are about to write, not to you.
 *
 * An anonymous comment carries `author: null` from the server — not a hidden name the client is
 * trusted to omit. There is nothing here that could leak, because there is nothing here to leak.
 */
export function CommentThread({
  comments,
  yourName,
  canComment,
  pending,
  onPost,
}: {
  comments: TimelineCommentDto[];
  yourName: string;
  canComment: boolean;
  pending: boolean;
  onPost: (body: string, isAnonymous: boolean) => void;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(true);

  const post = (): void => {
    if (body.trim() === '') return;

    onPost(body.trim(), anonymous);
    setBody('');
  };

  return (
    <div className="mt-3">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2 text-sm">
              <MessageCircle
                size={14}
                aria-hidden="true"
                className="mt-1 shrink-0 text-[var(--color-ink-subtle)]"
              />
              <p className="min-w-0">
                <span
                  className={cn(
                    'font-medium',
                    comment.author === null && 'text-[var(--color-ink-muted)] italic',
                  )}
                >
                  {comment.author?.username ?? 'Anonymous'}
                </span>{' '}
                <span className="text-[var(--color-ink-muted)]">— {comment.body}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="mt-3">
          <label htmlFor={`${id}-body`} className="sr-only">
            Add a comment
          </label>

          <div className="flex gap-2">
            <input
              id={`${id}-body`}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') post();
              }}
              maxLength={COMMENT_MAX_LENGTH}
              placeholder="Say something…"
              className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            />

            <Button variant="primary" pending={pending} onClick={post}>
              Post
            </Button>
          </div>

          <fieldset className="mt-2">
            <legend className="sr-only">Post this comment as</legend>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-xs text-[var(--color-ink-muted)]">Comment as</span>

              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`${id}-identity`}
                  checked={anonymous}
                  onChange={() => {
                    setAnonymous(true);
                  }}
                />
                Anonymous
              </label>

              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`${id}-identity`}
                  checked={!anonymous}
                  onChange={() => {
                    setAnonymous(false);
                  }}
                />
                {yourName}
              </label>
            </div>

            {anonymous && (
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Anonymous is permanent — this one stays unsigned even if the group reveals authors
                at the end.
              </p>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
