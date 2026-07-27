import { Avatar, Button, cn } from '@aftergame/ui';
import { demandFor, isBlocked, isPlayable } from '@aftergame/game-core';
import type { GroupMemberDto } from '@aftergame/shared';
import { usePlural, useT } from '../../../shared/i18n/LocaleProvider.js';

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
 * Who is in the room.
 *
 * The punishment level is shown to everyone on purpose: it decides how many texts that player
 * answers, and a lobby that silently hands one person three cards would be inexplicable. It is
 * per-group, so it says nothing about them anywhere else (D6, D7).
 */
export function PlayerList({
  members,
  viewerRole,
  viewerUserId,
  busy,
  onPunish,
  onForgive,
}: {
  members: GroupMemberDto[];
  viewerRole: GroupMemberDto['role'];
  viewerUserId: string;
  busy: boolean;
  onPunish: (userId: string) => void;
  onForgive: (userId: string) => void;
}) {
  const t = useT();

  return (
    <ul className="flex flex-col gap-1.5">
      {members.map((member, index) => (
        <li
          key={member.userId}
          // Staggered so the roster assembles rather than appears — the one place in the lobby
          // where a little theatre is worth it, because it is the thing people watch fill up.
          className="motion-safe:animate-[fade-in-up_300ms_ease-out_backwards]"
          style={{ animationDelay: `${String(Math.min(index, 8) * 40)}ms` }}
        >
          <PlayerCard
            member={member}
            playerCount={members.length}
            isYou={member.userId === viewerUserId}
            moderatable={canModerate(viewerRole, viewerUserId, member)}
            busy={busy}
            onPunish={() => {
              onPunish(member.userId);
            }}
            onForgive={() => {
              onForgive(member.userId);
            }}
          />
        </li>
      ))}

      {members.length === 0 && (
        <li className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
          {t('room.noCode')}
        </li>
      )}
    </ul>
  );
}

function PlayerCard({
  member,
  playerCount,
  isYou,
  moderatable,
  busy,
  onPunish,
  onForgive,
}: {
  member: GroupMemberDto;
  playerCount: number;
  isYou: boolean;
  moderatable: boolean;
  busy: boolean;
  onPunish: () => void;
  onForgive: () => void;
}) {
  const t = useT();
  const plural = usePlural();

  const level = member.consecutivePunishments as 0 | 1 | 2 | 3;
  const blocked = isBlocked(level);
  const load = isPlayable(level) ? demandFor(level, Math.max(playerCount, 1)) : 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5',
        'transition-colors duration-[var(--duration-base)] hover:bg-[var(--color-surface-sunken)]',
        isYou && 'bg-[var(--color-surface-sunken)]',
      )}
    >
      <Avatar name={member.username} online={!blocked} />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{member.username}</span>
          {isYou && (
            <span className="text-xs text-[var(--color-ink-muted)]">({t('players.you')})</span>
          )}
          <RoleBadge role={member.role} />
          {!blocked && <span className="sr-only">{t('players.online')}</span>}
          {blocked && (
            <span className="rounded-full bg-[var(--color-danger-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-danger)]">
              {t('players.blocked')}
            </span>
          )}
        </p>

        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {blocked
            ? t('players.punishments', { count: level })
            : level > 0
              ? `${plural('players.punishmentsOne', 'players.punishments', level)} · ${t('players.answers', { count: load })}`
              : t('players.answers', { count: load })}
        </p>
      </div>

      {moderatable && (
        <div className="flex shrink-0 gap-1">
          {level > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title={t('players.forgiveHint')}
              onClick={onForgive}
            >
              {t('players.forgive')}
            </Button>
          )}

          {!blocked && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title={t('players.punishHint')}
              onClick={onPunish}
              className="hover:text-[var(--color-danger)]"
            >
              {t('players.punish')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The owner reads differently from everyone else, which is the point: in a room where one person
 * can end the game, who that is should be obvious without reading a legend.
 */
function RoleBadge({ role }: { role: GroupMemberDto['role'] }) {
  const t = useT();

  if (role === 'MEMBER') {
    return (
      <span className="text-xs text-[var(--color-ink-muted)]">{t('players.role.MEMBER')}</span>
    );
  }

  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
        role === 'OWNER'
          ? 'bg-[image:var(--gradient-accent)] text-[var(--color-accent-ink)]'
          : 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]',
      )}
    >
      {t(`players.role.${role}`)}
    </span>
  );
}
