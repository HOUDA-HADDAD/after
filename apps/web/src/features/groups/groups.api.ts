import type { GroupDetailDto, GroupSummaryDto, InvitationDto } from '@aftergame/shared';
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
