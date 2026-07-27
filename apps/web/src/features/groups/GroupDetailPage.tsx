import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Settings2 } from 'lucide-react';
import { Button, Card, Skeleton, cn } from '@aftergame/ui';
import { queryKeys } from '../../shared/api/queries.js';
import { useErrorMessage } from '../../shared/lib/error-copy.js';
import { useT } from '../../shared/i18n/LocaleProvider.js';
import { useGroupSubscription } from '../../shared/realtime/SocketProvider.js';
import { useSession } from '../auth/SessionProvider.js';
import { LobbyPanel } from './lobby/LobbyPanel.js';
import { RoomHeader } from './lobby/RoomHeader.js';
import { ThemeManager } from './ThemeManager.js';
import { PunishmentHistory } from './PunishmentHistory.js';
import {
  createInvitation,
  forgiveMember,
  getGroup,
  leaveGroup,
  listInvitations,
  listPunishments,
  punishMember,
} from './groups.api.js';

/**
 * A room.
 *
 * The page is a header and one lobby, with everything administrative folded away behind a
 * disclosure. That ordering is the whole redesign: what a room is *for* is the game, and the
 * things you touch once a month — custom themes, the punishment log, leaving — previously carried
 * the same visual weight as the thing you came here to do.
 *
 * The data layer is untouched: same queries, same keys, same mutations, same subscription.
 */
export default function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useSession();
  const t = useT();
  const messageFor = useErrorMessage();

  const [settingsOpen, setSettingsOpen] = useState(false);

  useGroupSubscription(groupId);

  const group = useQuery({ queryKey: queryKeys.group(groupId), queryFn: () => getGroup(groupId) });
  const isHost = group.data !== undefined && group.data.viewerRole !== 'MEMBER';
  const viewerId = state.status === 'authenticated' ? state.user.id : '';

  const punishments = useQuery({
    queryKey: queryKeys.punishments(groupId),
    queryFn: () => listPunishments(groupId),
  });

  const invitations = useQuery({
    queryKey: queryKeys.invitations(groupId),
    queryFn: () => listInvitations(groupId),
    enabled: isHost,
  });

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.punishments(groupId) }),
    ]);
  };

  const moderate = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: 'punish' | 'forgive' }) =>
      (action === 'punish' ? punishMember : forgiveMember)(groupId, userId),
    onSuccess: refresh,
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  const newCode = useMutation({
    mutationFn: () => createInvitation(groupId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(groupId) });
    },
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  const leave = useMutation({
    mutationFn: () => leaveGroup(groupId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      await navigate('/', { replace: true });
    },
    onError: (error: unknown) => {
      toast.error(messageFor(error));
    },
  });

  if (group.isPending) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    );
  }

  if (group.isError || group.data === undefined) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Card className="p-6">
          <p className="text-sm">{messageFor(group.error)}</p>
          <Button className="mt-3" size="sm" onClick={() => void navigate('/')}>
            {t('room.back')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        group={group.data}
        code={invitations.data?.[0]?.code}
        canRegenerate={isHost}
        regenerating={newCode.isPending}
        onRegenerate={() => {
          newCode.mutate();
        }}
      />

      <LobbyPanel
        groupId={groupId}
        members={group.data.members}
        viewerRole={group.data.viewerRole}
        viewerUserId={viewerId}
        canHost={isHost}
        moderating={moderate.isPending}
        onPunish={(userId) => {
          moderate.mutate({ userId, action: 'punish' });
        }}
        onForgive={(userId) => {
          moderate.mutate({ userId, action: 'forgive' });
        }}
      />

      {/*
        Everything below is room administration, collapsed by default.
        A `<details>` rather than state plus a conditional render: it is findable by the browser's
        own in-page search even while closed, keyboard-operable with no JavaScript, and correct
        for assistive technology without a single ARIA attribute. The chevron is all this adds.
      */}
      <details
        open={settingsOpen}
        onToggle={(event) => {
          setSettingsOpen(event.currentTarget.open);
        }}
        className={cn(
          'group rounded-[var(--radius-card)] border border-[var(--color-border)]',
          'bg-[var(--color-surface)]',
        )}
      >
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-5 py-4',
            'text-sm font-medium transition-colors hover:bg-[var(--color-surface-sunken)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          <Settings2 size={16} aria-hidden="true" className="text-[var(--color-ink-muted)]" />
          {t('settings.title')}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="ml-auto text-[var(--color-ink-muted)] transition-transform duration-[var(--duration-base)] group-open:rotate-180"
          />
        </summary>

        <div className="flex flex-col gap-8 border-t border-[var(--color-border)] px-5 py-6">
          <section aria-labelledby="themes-heading">
            <h2
              id="themes-heading"
              className="mb-3 text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
            >
              {t('settings.customThemes')}
            </h2>

            <ThemeManager groupId={groupId} canManage={isHost} />
          </section>

          <section aria-labelledby="history-heading">
            <h2
              id="history-heading"
              className="mb-3 text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
            >
              {t('settings.history')}
            </h2>

            {punishments.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <PunishmentHistory events={punishments.data ?? []} />
            )}
          </section>

          {group.data.viewerRole !== 'OWNER' && (
            <div>
              <Button
                variant="danger"
                size="sm"
                pending={leave.isPending}
                onClick={() => {
                  leave.mutate();
                }}
              >
                {t('room.leave')}
              </Button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
