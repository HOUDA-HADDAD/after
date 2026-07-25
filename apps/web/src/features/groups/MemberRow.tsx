import type { GroupMemberDto } from '@aftergame/shared';
import { demandFor, isBlocked, isPlayable } from '@aftergame/game-core';

const ROLE_LABEL: Record<GroupMemberDto['role'], string> = {
  OWNER: 'Owner',
  COHOST: 'Co-host',
  MEMBER: 'Member',
};

/** Can the viewer punish or forgive this person? Mirrors the server rule exactly (D16). */
export function canModerate(
  viewerRole: GroupMemberDto['role'],
  viewerUserId: string,
  member: GroupMemberDto,
): boolean {
  if (member.userId === viewerUserId) return false;
  if (viewerRole === 'OWNER') return true;

  return viewerRole === 'COHOST' && member.role === 'MEMBER';
}

/**
 * One member of the roster.
 *
 * The punishment level is shown to everyone in the group on purpose: it decides how many texts
 * that player answers, and a lobby that silently hands one person three cards would be
 * inexplicable. It is per-group, so it says nothing about them anywhere else.
 */
export function MemberRow({
  member,
  playerCount,
  moderatable,
  busy,
  onPunish,
  onForgive,
}: {
  member: GroupMemberDto;
  playerCount: number;
  moderatable: boolean;
  busy: boolean;
  onPunish: () => void;
  onForgive: () => void;
}) {
  const blocked = isBlocked(member.consecutivePunishments as 0 | 1 | 2 | 3);
  const level = member.consecutivePunishments as 0 | 1 | 2 | 3;

  const load = isPlayable(level) ? demandFor(level, Math.max(playerCount, 1)) : 0;

  return (
    <li className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{member.username}</p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {ROLE_LABEL[member.role]}
          {blocked ? (
            <span className="text-red-500"> · cannot join games</span>
          ) : (
            level > 0 && (
              <>
                {' '}
                · {level} punishment{level === 1 ? '' : 's'} · answers {load}
              </>
            )
          )}
        </p>
      </div>

      {moderatable && (
        <div className="flex shrink-0 gap-1">
          {level > 0 && (
            <button
              type="button"
              onClick={onForgive}
              disabled={busy}
              title="Clear their punishments"
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Forgive
            </button>
          )}

          {!blocked && (
            <button
              type="button"
              onClick={onPunish}
              disabled={busy}
              title="They answer one more text next game"
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs transition-colors hover:border-red-500 hover:text-red-500 disabled:opacity-50"
            >
              Punish
            </button>
          )}
        </div>
      )}
    </li>
  );
}
