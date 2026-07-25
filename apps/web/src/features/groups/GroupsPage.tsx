import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { createGroupSchema, joinByCodeSchema, type GroupSummaryDto } from '@aftergame/shared';
import { AppHeader } from '../../shared/components/AppHeader.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { createGroup, joinGroup, listGroups } from './groups.api.js';

type LoadState = 'loading' | 'ready' | 'failed';

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupSummaryDto[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setGroups(await listGroups());
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);

    const parsed = createGroupSchema.safeParse({ name });
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? 'Check the name');
      return;
    }

    setBusy(true);
    try {
      await createGroup(parsed.data.name);
      setName('');
      await refresh();
    } catch (error) {
      setCreateError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    setJoinError(null);

    const parsed = joinByCodeSchema.safeParse({ code });
    if (!parsed.success) {
      setJoinError(parsed.error.issues[0]?.message ?? 'Check the code');
      return;
    }

    setBusy(true);
    try {
      await joinGroup(parsed.data.code);
      setCode('');
      await refresh();
    } catch (error) {
      setJoinError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <section>
          <h1 className="text-xl font-semibold">Your groups</h1>

          {load === 'loading' && (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]" role="status">
              Loading…
            </p>
          )}

          {load === 'failed' && (
            <p className="mt-3 text-sm text-red-500">
              Could not load your groups. Refresh to try again.
            </p>
          )}

          {load === 'ready' && groups.length === 0 && (
            <div className="mt-3 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-6 text-center">
              <p className="font-medium">No groups yet</p>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Create one and share the room code, or join a friend&rsquo;s with theirs.
              </p>
            </div>
          )}

          {load === 'ready' && groups.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    to={`/groups/${group.id}`}
                    className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 transition-colors hover:border-[var(--color-accent)]"
                  >
                    <span className="font-medium">{group.name}</span>
                    <span className="text-sm text-[var(--color-ink-muted)]">
                      {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                      {group.viewerRole !== 'MEMBER' && ` · ${group.viewerRole.toLowerCase()}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
            <h2 className="font-medium">Create a group</h2>
            <form onSubmit={(event) => void handleCreate(event)} noValidate className="mt-3">
              <label htmlFor="group-name" className="sr-only">
                Group name
              </label>
              <input
                id="group-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Friday Night"
                disabled={busy}
                aria-invalid={createError !== null}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
              />
              <div aria-live="polite" className="min-h-5">
                {createError !== null && <p className="mt-1 text-xs text-red-500">{createError}</p>}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-2 w-full rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] disabled:opacity-60"
              >
                Create
              </button>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
            <h2 className="font-medium">Join with a code</h2>
            <form onSubmit={(event) => void handleJoin(event)} noValidate className="mt-3">
              <label htmlFor="room-code" className="sr-only">
                Room code
              </label>
              <input
                id="room-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
                placeholder="ABCD2345"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={busy}
                aria-invalid={joinError !== null}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm tracking-widest uppercase outline-none focus-visible:border-[var(--color-accent)]"
              />
              <div aria-live="polite" className="min-h-5">
                {joinError !== null && <p className="mt-1 text-xs text-red-500">{joinError}</p>}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-2 w-full rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--color-accent)] disabled:opacity-60"
              >
                Join
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
