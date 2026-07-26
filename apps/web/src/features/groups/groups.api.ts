import type {
  GroupDetailDto,
  GroupMemberDto,
  GroupSummaryDto,
  GroupThemeDto,
  GroupThemeInput,
  InvitationDto,
} from '@aftergame/shared';
import { apiFetch, apiPost, apiPut } from '../../shared/api/client.js';

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

/* ---- group-written themes (D19) --------------------------------------------------------------- */

export const listCustomThemes = async (groupId: string): Promise<GroupThemeDto[]> =>
  (await apiFetch<{ themes: GroupThemeDto[] }>(`/groups/${groupId}/themes/custom`)).themes;

export const createCustomTheme = (
  groupId: string,
  input: GroupThemeInput,
): Promise<GroupThemeDto> => apiPost<GroupThemeDto>(`/groups/${groupId}/themes`, input);

export const updateCustomTheme = (
  groupId: string,
  themeId: string,
  input: GroupThemeInput,
): Promise<GroupThemeDto> => apiPut<GroupThemeDto>(`/groups/${groupId}/themes/${themeId}`, input);

export const deleteCustomTheme = (groupId: string, themeId: string): Promise<void> =>
  apiFetch<void>(`/groups/${groupId}/themes/${themeId}`, { method: 'DELETE' });
