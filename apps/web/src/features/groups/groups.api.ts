import type {
  GroupDetailDto,
  GroupMemberDto,
  GroupSummaryDto,
  InvitationDto,
} from '@aftergame/shared';
import { apiFetch, apiPost } from '../../shared/api/client.js';

export const listGroups = async (): Promise<GroupSummaryDto[]> =>
  (await apiFetch<{ groups: GroupSummaryDto[] }>('/groups')).groups;

export const createGroup = (name: string): Promise<GroupSummaryDto> =>
  apiPost<GroupSummaryDto>('/groups', { name });

export const joinGroup = (code: string): Promise<GroupSummaryDto> =>
  apiPost<GroupSummaryDto>('/join', { code });

export const getGroup = (groupId: string): Promise<GroupDetailDto> =>
  apiFetch<GroupDetailDto>(`/groups/${groupId}`);

export const leaveGroup = (groupId: string): Promise<void> =>
  apiPost<void>(`/groups/${groupId}/leave`);

export const listInvitations = async (groupId: string): Promise<InvitationDto[]> =>
  (await apiFetch<{ invitations: InvitationDto[] }>(`/groups/${groupId}/invitations`)).invitations;

export const createInvitation = (groupId: string): Promise<InvitationDto> =>
  apiPost<InvitationDto>(`/groups/${groupId}/invitations`, { expiresInHours: null, maxUses: null });

export interface PunishmentEventDto {
  id: string;
  action: 'PUNISH' | 'FORGIVE' | 'AUTO_RESET';
  targetUserId: string;
  targetUsername: string;
  actorUsername: string | null;
  resultingLevel: number;
  reason: string | null;
  createdAt: string;
}

export const punishMember = (groupId: string, userId: string): Promise<GroupMemberDto> =>
  apiPost<GroupMemberDto>(`/groups/${groupId}/members/${userId}/punish`, {});

export const forgiveMember = (groupId: string, userId: string): Promise<GroupMemberDto> =>
  apiPost<GroupMemberDto>(`/groups/${groupId}/members/${userId}/forgive`, {});

export const listPunishments = async (groupId: string): Promise<PunishmentEventDto[]> =>
  (await apiFetch<{ events: PunishmentEventDto[] }>(`/groups/${groupId}/punishments`)).events;
