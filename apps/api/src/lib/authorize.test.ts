import { describe, it, expect } from 'vitest';
import { can, GROUP_ACTIONS, type Actor, type GroupAction, type Target } from './authorize.js';

const actor = (role: Actor['role'], userId = 'actor'): Actor => ({
  userId,
  role,
  status: 'ACTIVE',
});

const target = (role: Target['role'], userId = 'target'): Target => ({ userId, role });

/**
 * The complete role matrix from docs/00-spec-decisions.md D16.
 *
 * Table-driven on purpose: an action added to the union without a row here is immediately
 * visible, and the exhaustiveness check in `can` means it cannot compile without a decision.
 */
describe('group authorization', () => {
  describe('what each role may do', () => {
    const matrix: { action: GroupAction; owner: boolean; cohost: boolean; member: boolean }[] = [
      { action: 'group:read', owner: true, cohost: true, member: true },
      { action: 'member:list', owner: true, cohost: true, member: true },
      { action: 'group:rename', owner: true, cohost: true, member: false },
      { action: 'invitation:create', owner: true, cohost: true, member: false },
      { action: 'invitation:list', owner: true, cohost: true, member: false },
      { action: 'invitation:revoke', owner: true, cohost: true, member: false },
      { action: 'group:delete', owner: true, cohost: false, member: false },
      { action: 'ownership:transfer', owner: true, cohost: false, member: false },
      { action: 'member:promote', owner: true, cohost: false, member: false },
      { action: 'member:demote', owner: true, cohost: false, member: false },
      // The owner is the one role that cannot walk away — see OWNER_CANNOT_LEAVE.
      { action: 'member:leave', owner: false, cohost: true, member: true },
    ];

    it('covers every action in the union', () => {
      const covered = new Set(matrix.map((row) => row.action));
      const uncovered = GROUP_ACTIONS.filter(
        (action) => !covered.has(action) && action !== 'member:remove',
      );

      // `member:remove` depends on the target and is exercised in its own block below.
      expect(uncovered).toEqual([]);
    });

    it.each(matrix)('$action — owner:$owner cohost:$cohost member:$member', (row) => {
      expect(can(row.action, actor('OWNER'), target('MEMBER'))).toBe(row.owner);
      expect(can(row.action, actor('COHOST'), target('MEMBER'))).toBe(row.cohost);
      expect(can(row.action, actor('MEMBER'), target('MEMBER'))).toBe(row.member);
    });
  });

  describe('member:remove depends on who is being removed', () => {
    it('lets the owner remove co-hosts and members', () => {
      expect(can('member:remove', actor('OWNER'), target('COHOST'))).toBe(true);
      expect(can('member:remove', actor('OWNER'), target('MEMBER'))).toBe(true);
    });

    it('lets a co-host remove ordinary members only', () => {
      expect(can('member:remove', actor('COHOST'), target('MEMBER'))).toBe(true);
    });

    it('stops a co-host removing the owner', () => {
      // Otherwise a co-host could eject the owner from their own group.
      expect(can('member:remove', actor('COHOST'), target('OWNER'))).toBe(false);
    });

    it('stops a co-host removing another co-host', () => {
      // Without this, two co-hosts can race to remove each other.
      expect(can('member:remove', actor('COHOST'), target('COHOST'))).toBe(false);
    });

    it('stops a member removing anyone', () => {
      expect(can('member:remove', actor('MEMBER'), target('MEMBER', 'someone'))).toBe(false);
      expect(can('member:remove', actor('MEMBER'), target('COHOST'))).toBe(false);
    });

    it.each(['OWNER', 'COHOST', 'MEMBER'] as const)('stops %s removing themselves', (role) => {
      // Leaving is a separate action with a separate rule.
      expect(can('member:remove', actor(role, 'same'), target(role, 'same'))).toBe(false);
    });

    it('refuses when no target is supplied', () => {
      expect(can('member:remove', actor('OWNER'))).toBe(false);
    });
  });

  describe('the rules do not depend on identity beyond the self check', () => {
    it('treats two different owners of different groups identically', () => {
      expect(can('group:delete', actor('OWNER', 'alice'))).toBe(
        can('group:delete', actor('OWNER', 'bob')),
      );
    });
  });
});
