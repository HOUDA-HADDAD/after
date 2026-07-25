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
      // Deliberately visible to everyone: accountability for hosts, not a private list.
      { action: 'punishment:list', owner: true, cohost: true, member: true },
      // Any member may watch a game, join one, leave one and play in it. Whether they may join
      // *this* game is a matter of status and phase, checked by the session service (D7, D13).
      { action: 'session:read', owner: true, cohost: true, member: true },
      { action: 'session:join', owner: true, cohost: true, member: true },
      { action: 'session:leave', owner: true, cohost: true, member: true },
      { action: 'session:play', owner: true, cohost: true, member: true },
      // Creating a game and running it are host powers, exactly as the brief specifies.
      { action: 'session:create', owner: true, cohost: true, member: false },
      { action: 'session:host', owner: true, cohost: true, member: false },
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

    /** Actions whose answer depends on the target; each has its own block below. */
    const TARGET_DEPENDENT = new Set<GroupAction>([
      'member:remove',
      'punishment:punish',
      'punishment:forgive',
    ]);

    it('covers every action in the union', () => {
      // This is the test that fails when someone adds an action and forgets to decide who may
      // perform it — which is exactly what happened when punishments were introduced.
      const covered = new Set(matrix.map((row) => row.action));
      const uncovered = GROUP_ACTIONS.filter(
        (action) => !covered.has(action) && !TARGET_DEPENDENT.has(action),
      );

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

  describe('punishing and forgiving carry the same asymmetry as removal', () => {
    const actions = ['punishment:punish', 'punishment:forgive'] as const;

    it.each(actions)('%s — the owner may act on co-hosts and members', (action) => {
      expect(can(action, actor('OWNER'), target('COHOST'))).toBe(true);
      expect(can(action, actor('OWNER'), target('MEMBER'))).toBe(true);
    });

    it.each(actions)('%s — a co-host may act on ordinary members only', (action) => {
      expect(can(action, actor('COHOST'), target('MEMBER'))).toBe(true);
      // Otherwise two co-hosts can punish each other to a standstill, or gang up on the owner.
      expect(can(action, actor('COHOST'), target('COHOST'))).toBe(false);
      expect(can(action, actor('COHOST'), target('OWNER'))).toBe(false);
    });

    it.each(actions)('%s — an ordinary member may not', (action) => {
      expect(can(action, actor('MEMBER'), target('MEMBER', 'someone'))).toBe(false);
    });

    it.each(actions)('%s — nobody may act on themselves', (action) => {
      expect(can(action, actor('OWNER', 'same'), target('OWNER', 'same'))).toBe(false);
      expect(can(action, actor('COHOST', 'same'), target('COHOST', 'same'))).toBe(false);
    });

    it.each(actions)('%s — refuses without a target', (action) => {
      expect(can(action, actor('OWNER'))).toBe(false);
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
