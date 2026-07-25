import { useQuery } from '@tanstack/react-query';
import { Badge, Skeleton } from '@aftergame/ui';
import type { GroupMemberDto } from '@aftergame/shared';
import { getGroup } from '../../features/groups/groups.api.js';
import { queryKeys } from '../api/queries.js';
import { useGroupSubscription } from '../realtime/SocketProvider.js';

const ROLE_LABEL: Record<GroupMemberDto['role'], string> = {
  OWNER: 'Owner',
  COHOST: 'Co-host',
  MEMBER: 'Member',
};

/**
 * The group sidebar: who is here, and where they stand.
 *
 * Punishment levels are shown to everyone in the group deliberately. They decide how many texts
 * a player answers, so a lobby that silently dealt one person three cards would be inexplicable —
 * and the counter is per-group, so it says nothing about them anywhere else (D6, D7).
 */
export function GroupSidebar({ groupId }: { groupId: string | undefined }) {
  useGroupSubscription(groupId);

  const group = useQuery({
    queryKey: queryKeys.group(groupId ?? ''),
    queryFn: () => getGroup(groupId ?? ''),
    enabled: groupId !== undefined,
  });

  if (groupId === undefined) {
    return (
      <div className="hidden w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:block">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Pick a group from the rail, or create one.
        </p>
      </div>
    );
  }

  return (
    <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] p-4">
        {group.isPending ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <h2 className="truncate font-semibold" title={group.data?.name}>
            {group.data?.name}
          </h2>
        )}
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {group.data === undefined
            ? ' '
            : `${String(group.data.memberCount)} ${group.data.memberCount === 1 ? 'member' : 'members'}`}
        </p>
      </div>

      <section className="p-4" aria-labelledby="members-heading">
        <h3
          id="members-heading"
          className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
        >
          Members
        </h3>

        {group.isPending && (
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        )}

        {group.isError && (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Could not load members.</p>
        )}

        <ul className="mt-2">
          {group.data?.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 py-1.5 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate">{member.username}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {ROLE_LABEL[member.role]}
                  {member.consecutivePunishments > 0 &&
                    member.status === 'ACTIVE' &&
                    ` · ${String(member.consecutivePunishments)} punishment${member.consecutivePunishments === 1 ? '' : 's'}`}
                </span>
              </span>

              {member.status === 'GAME_BLOCKED' && <Badge tone="danger">Blocked</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
