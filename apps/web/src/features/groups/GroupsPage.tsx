import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { Button, Card, EmptyState, Field, Skeleton } from '@aftergame/ui';
import { createGroupSchema, joinByCodeSchema } from '@aftergame/shared';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { createGroup, joinGroup, listGroups } from './groups.api.js';

export default function GroupsPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: queryKeys.groups, queryFn: listGroups });

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);

  const refreshGroups = () => queryClient.invalidateQueries({ queryKey: queryKeys.groups });

  const create = useMutation({
    mutationFn: createGroup,
    onSuccess: async (group) => {
      setName('');
      toast.success(`Created ${group.name}`);
      await refreshGroups();
    },
    onError: (error: unknown) => {
      setNameError(messageFor(error));
    },
  });

  const join = useMutation({
    mutationFn: joinGroup,
    onSuccess: async (group) => {
      setCode('');
      toast.success(`Joined ${group.name}`);
      await refreshGroups();
    },
    onError: (error: unknown) => {
      setCodeError(messageFor(error));
    },
  });

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    setNameError(undefined);

    // The same schema the API validates with, so the client cannot build a request the server
    // would reject on shape.
    const parsed = createGroupSchema.safeParse({ name });

    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Check the name');
      return;
    }

    create.mutate(parsed.data.name);
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    setCodeError(undefined);

    const parsed = joinByCodeSchema.safeParse({ code });

    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message ?? 'Check the code');
      return;
    }

    join.mutate(parsed.data.code);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Your groups</h1>

      <section className="mt-4" aria-busy={groups.isPending}>
        {groups.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {groups.isError && (
          <Card className="p-5">
            <p className="text-sm text-[var(--color-ink-muted)]">{messageFor(groups.error)}</p>
            <Button className="mt-3" size="sm" onClick={() => void groups.refetch()}>
              Try again
            </Button>
          </Card>
        )}

        {groups.data?.length === 0 && (
          <EmptyState
            icon={<Users size={28} aria-hidden="true" />}
            title="No groups yet"
            description="Create one and share the room code, or join a friend's with theirs."
          />
        )}

        {groups.data !== undefined && groups.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {groups.data.map((group) => (
              <li key={group.id}>
                <Link
                  to={`/groups/${group.id}`}
                  className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{group.name}</span>
                    <span className="text-sm text-[var(--color-ink-muted)]">
                      {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                      {group.viewerRole !== 'MEMBER' && ` · ${group.viewerRole.toLowerCase()}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-medium">Create a group</h2>
          <form onSubmit={submitCreate} noValidate className="mt-3">
            <Field
              id="group-name"
              label="Group name"
              labelHidden
              placeholder="Friday Night"
              value={name}
              error={nameError}
              disabled={create.isPending}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Button type="submit" variant="primary" pending={create.isPending} className="w-full">
              Create
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="font-medium">Join with a code</h2>
          <form onSubmit={submitJoin} noValidate className="mt-3">
            <Field
              id="room-code"
              label="Room code"
              labelHidden
              placeholder="ABCD2345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono tracking-widest uppercase"
              value={code}
              error={codeError}
              disabled={join.isPending}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
            <Button type="submit" pending={join.isPending} className="w-full">
              Join
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
