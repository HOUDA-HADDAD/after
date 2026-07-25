export type GroupRoleDto = 'OWNER' | 'COHOST' | 'MEMBER';
export type MembershipStatusDto = 'ACTIVE' | 'GAME_BLOCKED';

/** A group as it appears in the sidebar list. */
export interface GroupSummaryDto {
  id: string;
  name: string;
  memberCount: number;
  /** The viewer's own role — the client uses it to decide which controls to render. */
  viewerRole: GroupRoleDto;
  createdAt: string;
}

/**
 * A member of a group.
 *
 * The punishment counter is public *within the group*: it is a rule of the game, and hiding it
 * would make the lobby's answer-load preview inexplicable. It is never visible outside the group
 * — and it is per-group, so it says nothing about the person elsewhere.
 */
export interface GroupMemberDto {
  userId: string;
  username: string;
  role: GroupRoleDto;
  status: MembershipStatusDto;
  consecutivePunishments: number;
  joinedAt: string;
}

export interface GroupDetailDto extends GroupSummaryDto {
  members: GroupMemberDto[];
}

/**
 * An invitation.
 *
 * `code` is returned only to hosts, who are the only people entitled to create or share one.
 */
export interface InvitationDto {
  id: string;
  code: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
}
