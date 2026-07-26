import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Skeleton } from '@aftergame/ui';
import { Palette, Pencil, Trash2 } from 'lucide-react';
import {
  THEME_NAME_MAX_LENGTH,
  THEME_TEXT_MAX_LENGTH,
  type GroupThemeDto,
  type GroupThemeInput,
} from '@aftergame/shared';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor, fieldErrorsFor } from '../../shared/lib/error-copy.js';
import {
  createCustomTheme,
  deleteCustomTheme,
  listCustomThemes,
  updateCustomTheme,
} from './groups.api.js';

const BLANK: GroupThemeInput = {
  name: '',
  description: '',
  writePrompt: '',
  writePlaceholder: '',
  answerPrompt: '',
  icon: '🎲',
  supportsComments: true,
  supportsAuthorGuess: true,
};

/**
 * Themes a group writes for itself (D19).
 *
 * The seeded three are never listed here. They belong to nobody, which is what makes "Anecdotes"
 * mean the same thing in every group — and a screen that offered to edit them would be promising
 * something the API correctly refuses.
 *
 * A theme a game is using is frozen, and the card says so with the number rather than greying a
 * button out and leaving people to guess.
 */
export function ThemeManager({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<GroupThemeDto | 'new' | null>(null);

  const themes = useQuery({
    queryKey: queryKeys.customThemes(groupId),
    queryFn: () => listCustomThemes(groupId),
  });

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.customThemes(groupId) }),
      // The picker reads a different list; leaving it stale would hide a brand-new theme.
      queryClient.invalidateQueries({ queryKey: queryKeys.groupThemes(groupId) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: (themeId: string) => deleteCustomTheme(groupId, themeId),
    onSuccess: refresh,
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  if (themes.isPending) return <Skeleton className="h-24 w-full" />;

  const list = themes.data ?? [];

  return (
    <div>
      {editing !== null && (
        <ThemeForm
          groupId={groupId}
          existing={editing === 'new' ? null : editing}
          onDone={async () => {
            setEditing(null);
            await refresh();
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}

      {editing === null && list.length === 0 && (
        <EmptyState
          icon={<Palette size={28} aria-hidden="true" />}
          title="No themes of your own yet"
          description={
            canManage
              ? 'Write one, and it joins the three defaults in this group’s picker. Nobody outside the group ever sees it.'
              : 'A host can write themes for this group. They appear in the picker alongside the defaults.'
          }
          action={
            canManage ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing('new');
                }}
              >
                Write a theme
              </Button>
            ) : undefined
          }
        />
      )}

      {editing === null && list.length > 0 && (
        <>
          <Card className="px-4">
            <ul>
              {list.map((theme) => (
                <li
                  key={theme.id}
                  className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span aria-hidden="true">{theme.icon}</span>
                      {theme.name}
                      {theme.usedByGames > 0 && <Badge>in use</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                      {theme.description}
                    </p>
                    {theme.usedByGames > 0 && (
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {theme.usedByGames} {theme.usedByGames === 1 ? 'game uses' : 'games use'}{' '}
                        this theme, so it cannot change until they are deleted.
                      </p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        aria-label={`Edit ${theme.name}`}
                        disabled={theme.usedByGames > 0}
                        onClick={() => {
                          setEditing(theme);
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>

                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${theme.name}`}
                        disabled={theme.usedByGames > 0 || remove.isPending}
                        onClick={() => {
                          remove.mutate(theme.id);
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {canManage && (
            <Button
              className="mt-3"
              size="sm"
              onClick={() => {
                setEditing('new');
              }}
            >
              Write another
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ThemeForm({
  groupId,
  existing,
  onDone,
  onCancel,
}: {
  groupId: string;
  existing: GroupThemeDto | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<GroupThemeInput>(
    existing === null
      ? BLANK
      : {
          name: existing.name,
          description: existing.description,
          writePrompt: existing.writePrompt,
          writePlaceholder: existing.writePlaceholder,
          answerPrompt: existing.answerPrompt,
          icon: existing.icon,
          supportsComments: existing.supportsComments,
          supportsAuthorGuess: existing.supportsAuthorGuess,
        },
  );

  const save = useMutation({
    mutationFn: (input: GroupThemeInput) =>
      existing === null
        ? createCustomTheme(groupId, input)
        : updateCustomTheme(groupId, existing.id, input),
    onSuccess: onDone,
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  const errors = fieldErrorsFor(save.error);
  const set = (key: keyof GroupThemeInput) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
  };

  return (
    <Card className="p-5">
      <h3 className="font-medium">
        {existing === null ? 'Write a theme' : `Edit ${existing.name}`}
      </h3>
      <p className="mt-1 mb-4 text-sm text-[var(--color-ink-muted)]">
        The prompts are what players read. The write prompt is pinned above the composer; the answer
        prompt appears on every card they are dealt.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(values);
        }}
      >
        <Field
          id="theme-name"
          label="Name"
          value={values.name}
          onChange={set('name')}
          maxLength={THEME_NAME_MAX_LENGTH}
          error={errors.name}
          required
        />

        <Field
          id="theme-icon"
          label="Icon"
          value={values.icon}
          onChange={set('icon')}
          maxLength={8}
          hint="One emoji. It sits in the picker and in the banner all game."
          error={errors.icon}
          required
        />

        <Field
          id="theme-description"
          label="Description"
          value={values.description}
          onChange={set('description')}
          maxLength={THEME_TEXT_MAX_LENGTH}
          hint="One line, shown in the picker."
          error={errors.description}
          required
        />

        <Field
          id="theme-write-prompt"
          label="Write prompt"
          value={values.writePrompt}
          onChange={set('writePrompt')}
          maxLength={THEME_TEXT_MAX_LENGTH}
          hint="What each player is asked to write."
          error={errors.writePrompt}
          required
        />

        <Field
          id="theme-write-placeholder"
          label="Placeholder"
          value={values.writePlaceholder}
          onChange={set('writePlaceholder')}
          maxLength={THEME_TEXT_MAX_LENGTH}
          hint="Optional. Greyed-out example text in the composer."
          error={errors.writePlaceholder}
        />

        <Field
          id="theme-answer-prompt"
          label="Answer prompt"
          value={values.answerPrompt}
          onChange={set('answerPrompt')}
          maxLength={THEME_TEXT_MAX_LENGTH}
          hint="What a player is asked when they are dealt someone else’s text."
          error={errors.answerPrompt}
          required
        />

        <fieldset className="mb-4">
          <legend className="mb-1 block text-sm font-medium">During the discussion</legend>

          <label className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={values.supportsComments}
              onChange={(event) => {
                setValues((current) => ({ ...current, supportsComments: event.target.checked }));
              }}
            />
            Comments and reactions
          </label>

          <label className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={values.supportsAuthorGuess}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  supportsAuthorGuess: event.target.checked,
                }));
              }}
            />
            Guessing who wrote what
          </label>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" pending={save.isPending}>
            {existing === null ? 'Add it to the picker' : 'Save changes'}
          </Button>

          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
