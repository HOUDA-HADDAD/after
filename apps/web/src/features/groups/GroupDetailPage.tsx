import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { Badge, Button, Card, Skeleton } from '@aftergame/ui';
import { queryKeys } from '../../shared/api/queries.js';
import { messageFor } from '../../shared/lib/error-copy.js';
import { useGroupSubscription } from '../../shared/realtime/SocketProvider.js';
import { useSession } from '../auth/SessionProvider.js';
import { NewGamePanel } from '../game/NewGamePanel.js';
import { ThemeManager } from './ThemeManager.js';
import { canModerate, MemberRow } from './MemberRow.js';
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

export default function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useSession();

  const [copied, setCopied] = useState(false);

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
      toast.success('New room code ready');
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

  const copyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard permission can be denied; the code is on screen to read either way.
    }
  };

  if (group.isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  if (group.isError || group.data === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Card className="p-6">
          <p className="text-sm">{messageFor(group.error)}</p>
          <Button className="mt-3" size="sm" onClick={() => void navigate('/')}>
            Back to your groups
          </Button>
        </Card>
      </div>
    );
  }

  const currentCode = invitations.data?.[0]?.code;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{group.data.name}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            {group.data.memberCount} {group.data.memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>

        {group.data.viewerRole !== 'MEMBER' && (
          <Badge tone="accent">{group.data.viewerRole.toLowerCase()}</Badge>
        )}
      </header>

      <section className="mt-6" aria-labelledby="game-heading">
        <h2 id="game-heading" className="sr-only">
          Game
        </h2>
        <NewGamePanel groupId={groupId} canHost={isHost} />
      </section>

      {isHost && (
        <Card className="mt-6 p-5">
          <h2 className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            Room code
          </h2>

          {invitations.isPending && <Skeleton className="mt-2 h-11 w-40" />}

          {currentCode !== undefined && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void copyCode(currentCode)}
                className="font-mono text-lg tracking-widest"
                aria-label={`Copy room code ${currentCode.split('').join(' ')}`}
              >
                {currentCode}
                <Copy size={14} aria-hidden="true" />
              </Button>

              <span aria-live="polite" className="text-xs text-[var(--color-ink-muted)]">
                {copied ? 'Copied' : ''}
              </span>
            </div>
          )}

          {invitations.data?.length === 0 && (
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">No active code.</p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            pending={newCode.isPending}
            onClick={() => {
              newCode.mutate();
            }}
          >
            Generate a new code
          </Button>
        </Card>
      )}

      <section className="mt-6" aria-labelledby="roster-heading">
        <h2
          id="roster-heading"
          className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
        >
          Members
        </h2>

        <Card className="mt-2 px-4">
          <ul>
            {group.data.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                playerCount={group.data.memberCount}
                moderatable={isHost && canModerate(group.data.viewerRole, viewerId, member)}
                busy={moderate.isPending}
                onPunish={() => {
                  moderate.mutate({ userId: member.userId, action: 'punish' });
                }}
                onForgive={() => {
                  moderate.mutate({ userId: member.userId, action: 'forgive' });
                }}
              />
            ))}
          </ul>
        </Card>
      </section>

      <section className="mt-8" aria-labelledby="themes-heading">
        <h2
          id="themes-heading"
          className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
        >
          Your themes
        </h2>

        <div className="mt-2">
          <ThemeManager groupId={groupId} canManage={isHost} />
        </div>
      </section>

      <section className="mt-8" aria-labelledby="history-heading">
        <h2
          id="history-heading"
          className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
        >
          Punishment history
        </h2>
        {punishments.isPending ? (
          <Skeleton className="mt-2 h-16 w-full" />
        ) : (
          <PunishmentHistory events={punishments.data ?? []} />
        )}
      </section>

      {group.data.viewerRole !== 'OWNER' && (
        <Button
          variant="danger"
          size="sm"
          className="mt-8"
          pending={leave.isPending}
          onClick={() => {
            leave.mutate();
          }}
        >
          Leave group
        </Button>
      )}
    </div>
  );
}
