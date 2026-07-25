import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { GroupDetailDto, GroupMemberDto, InvitationDto } from '@aftergame/shared';
import { AppHeader } from '../../shared/components/AppHeader.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { createInvitation, getGroup, leaveGroup, listInvitations } from './groups.api.js';

const ROLE_LABEL: Record<GroupMemberDto['role'], string> = {
  OWNER: 'Owner',
  COHOST: 'Co-host',
  MEMBER: 'Member',
};

/** A blocked player keeps full access to the group; they simply cannot be put on a roster (D7). */
function MemberRow({ member }: { member: GroupMemberDto }) {
  const blocked = member.status === 'GAME_BLOCKED';

  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{member.username}</p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {ROLE_LABEL[member.role]}
          {member.consecutivePunishments > 0 &&
            ` · ${String(member.consecutivePunishments)} punishment${member.consecutivePunishments === 1 ? '' : 's'}`}
        </p>
      </div>

      {blocked && (
        <span className="shrink-0 rounded-full border border-red-500/40 px-2 py-0.5 text-xs text-red-500">
          Cannot join games
        </span>
      )}
    </li>
  );
}

export default function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();

  const [group, setGroup] = useState<GroupDetailDto | null>(null);
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const isHost = group !== null && group.viewerRole !== 'MEMBER';

  const refresh = useCallback(async () => {
    try {
      const detail = await getGroup(groupId);
      setGroup(detail);

      if (detail.viewerRole !== 'MEMBER') {
        setInvitations(await listInvitations(groupId));
      }
    } catch (caught) {
      setError(messageFor(caught));
    }
  }, [groupId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleNewCode = async () => {
    setBusy(true);
    try {
      await createInvitation(groupId);
      await refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    setBusy(true);
    try {
      await leaveGroup(groupId);
      await navigate('/', { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard access can be denied; the code is on screen to read either way.
    }
  };

  if (error !== null && group === null) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <p className="text-sm text-red-500">{error}</p>
          <Link to="/" className="mt-3 inline-block text-sm text-[var(--color-accent)]">
            Back to your groups
          </Link>
        </main>
      </div>
    );
  }

  if (group === null) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-10" role="status">
          <p className="text-sm text-[var(--color-ink-muted)]">Loading…</p>
        </main>
      </div>
    );
  }

  const currentCode = invitations[0]?.code;

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="mx-auto grid max-w-4xl gap-8 px-6 py-10 md:grid-cols-[1fr_18rem]">
        <section className="order-2 md:order-1">
          <Link to="/" className="text-sm text-[var(--color-ink-muted)] hover:underline">
            ← Your groups
          </Link>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </p>

          <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-6 text-center">
            <p className="font-medium">No game running</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Starting a game arrives in Phase 6.
            </p>
          </div>

          <div aria-live="polite">
            {error !== null && <p className="mt-4 text-sm text-red-500">{error}</p>}
          </div>

          {group.viewerRole !== 'OWNER' && (
            <button
              type="button"
              onClick={() => void handleLeave()}
              disabled={busy}
              className="mt-6 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm transition-colors hover:border-red-500 hover:text-red-500 disabled:opacity-60"
            >
              Leave group
            </button>
          )}
        </section>

        <aside className="order-1 md:order-2">
          {isHost && (
            <div className="mb-6 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
              <h2 className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                Room code
              </h2>

              {currentCode === undefined ? (
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">No active code.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void copyCode(currentCode)}
                  className="mt-2 w-full rounded-md border border-[var(--color-border)] px-3 py-2 font-mono text-lg tracking-widest transition-colors hover:border-[var(--color-accent)]"
                >
                  {currentCode}
                </button>
              )}

              <div aria-live="polite" className="min-h-4">
                {copied && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Copied</p>}
              </div>

              <button
                type="button"
                onClick={() => void handleNewCode()}
                disabled={busy}
                className="mt-1 text-xs text-[var(--color-accent)] hover:underline disabled:opacity-60"
              >
                Generate a new code
              </button>
            </div>
          )}

          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
            <h2 className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
              Members
            </h2>
            <ul className="mt-2">
              {group.members.map((member) => (
                <MemberRow key={member.userId} member={member} />
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
