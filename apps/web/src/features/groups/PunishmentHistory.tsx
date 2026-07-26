import { useT } from '../../shared/i18n/LocaleProvider.js';
import type { PunishmentEventDto } from './groups.api.js';

const describe = (event: PunishmentEventDto): string => {
  const actor = event.actorUsername ?? 'A former host';

  switch (event.action) {
    case 'PUNISH':
      return `${actor} punished ${event.targetUsername} — level ${String(event.resultingLevel)}`;
    case 'FORGIVE':
      return `${actor} forgave ${event.targetUsername}`;
    case 'AUTO_RESET':
      return `${event.targetUsername}'s counter reset after a clean game`;
  }
};

/**
 * The group's punishment history.
 *
 * Visible to every member, not just hosts. Punishment changes how many texts you answer, so the
 * record of who applied it is accountability for hosts rather than a private file kept on people.
 */
export function PunishmentHistory({ events }: { events: PunishmentEventDto[] }) {
  const t = useT();

  if (events.length === 0) {
    return <p className="text-sm text-[var(--color-ink-muted)]">{t('history.empty')}</p>;
  }

  return (
    <ol className="mt-2 flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="text-sm">
          <p>{describe(event)}</p>
          {event.reason !== null && (
            <p className="text-xs text-[var(--color-ink-muted)]">“{event.reason}”</p>
          )}
          <time dateTime={event.createdAt} className="text-xs text-[var(--color-ink-muted)]">
            {new Date(event.createdAt).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
