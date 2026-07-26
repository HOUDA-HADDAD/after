import { Badge } from '@aftergame/ui';
import type { GroupDetailDto } from '@aftergame/shared';
import { usePlural, useT } from '../../../shared/i18n/LocaleProvider.js';
import { RoomCode } from './RoomCode.js';

/**
 * The room's identity: its name, its code, and how many people are in it.
 *
 * One line on a desktop, wrapping cleanly on a phone. The name is the page's `h1` and the code
 * sits immediately beside it, because those two facts are what somebody reads out when they are
 * getting friends into a game — and they used to be a heading and a card three sections apart.
 */
export function RoomHeader({
  group,
  code,
  canRegenerate,
  regenerating,
  onRegenerate,
}: {
  group: GroupDetailDto;
  code: string | undefined;
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const t = useT();
  const plural = usePlural();

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{group.name}</h1>

      {group.viewerRole !== 'MEMBER' && (
        <Badge tone="accent">{t(`players.role.${group.viewerRole}`)}</Badge>
      )}

      {/* Pushes the code to its own line on a narrow screen rather than squeezing the name. */}
      <span className="w-full sm:ml-auto sm:w-auto">
        <RoomCode
          code={code}
          canRegenerate={canRegenerate}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
        />
      </span>

      <p className="w-full text-sm text-[var(--color-ink-muted)]">
        {plural('room.membersOne', 'room.members', group.memberCount)}
      </p>
    </header>
  );
}
