import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Skeleton, cn } from '@aftergame/ui';
import { listGroups } from '../../features/groups/groups.api.js';
import { queryKeys } from '../api/queries.js';

/** Two letters is enough to recognise a group you are already in, and fits the rail. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

/**
 * The group rail.
 *
 * Dark in both themes, because it is chrome rather than content — the same reason Slack's is.
 * Each tile is a link with an accessible name, so the rail is navigable without seeing it.
 */
export function GroupRail({
  activeGroupId,
  onNavigate,
}: {
  activeGroupId: string | undefined;
  onNavigate: () => void;
}) {
  const groups = useQuery({ queryKey: queryKeys.groups, queryFn: listGroups });

  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-2 bg-[var(--color-rail)] py-3">
      {groups.isPending && (
        <>
          <Skeleton className="h-11 w-11 rounded-[var(--radius-card)]" />
          <Skeleton className="h-11 w-11 rounded-[var(--radius-card)]" />
        </>
      )}

      {groups.data?.map((group) => (
        <NavLink
          key={group.id}
          to={`/groups/${group.id}`}
          onClick={onNavigate}
          title={group.name}
          aria-current={group.id === activeGroupId ? 'page' : undefined}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] text-sm font-semibold',
            'text-[var(--color-rail-ink)] transition-colors hover:bg-[var(--color-rail-active)]',
            group.id === activeGroupId && 'bg-[var(--color-rail-active)]',
          )}
        >
          <span aria-hidden="true">{initials(group.name)}</span>
          <span className="sr-only">{group.name}</span>
        </NavLink>
      ))}

      <NavLink
        to="/"
        onClick={onNavigate}
        title="Your groups"
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] text-[var(--color-rail-ink)] transition-colors hover:bg-[var(--color-rail-active)]"
      >
        <Plus size={18} aria-hidden="true" />
        <span className="sr-only">All groups, create or join</span>
      </NavLink>
    </div>
  );
}
