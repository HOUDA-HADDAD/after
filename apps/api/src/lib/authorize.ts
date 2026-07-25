import { ERROR_CODES, ForbiddenError } from '@aftergame/shared';

export type GroupRole = 'OWNER' | 'COHOST' | 'MEMBER';
export type MembershipStatus = 'ACTIVE' | 'GAME_BLOCKED';

/**
 * Every privileged thing a member can attempt, as a closed union.
 *
 * Closed on purpose: adding an action forces a decision here rather than letting a new route
 * quietly inherit whatever check happened to be nearby.
 */
export const GROUP_ACTIONS = [
  'group:read',
  'group:rename',
  'group:delete',
  'member:list',
  'member:remove',
  'member:promote',
  'member:demote',
  'member:leave',
  'ownership:transfer',
  'invitation:create',
  'invitation:list',
  'invitation:revoke',
  'punishment:punish',
  'punishment:forgive',
  'punishment:list',
  'session:read',
  'session:create',
  'session:join',
  'session:leave',
  'session:play',
  'session:host',
] as const;

export type GroupAction = (typeof GROUP_ACTIONS)[number];

/**
 * What a route requires.
 *
 * `public` — no session needed. `authenticated` — a session, but no group involved (creating a
 * group, listing your own). Anything else is a group action checked against membership.
 */
export type RoutePolicy = 'public' | 'authenticated' | GroupAction;

export interface Actor {
  userId: string;
  role: GroupRole;
  status: MembershipStatus;
}

/** The member being acted upon, for actions that target someone. */
export type Target = Pick<Actor, 'userId' | 'role'>;

const isHost = (role: GroupRole): boolean => role === 'OWNER' || role === 'COHOST';

/**
 * Can `actor` perform `action`, optionally against `target`?
 *
 * Pure, exhaustive, and the single source of truth for the role rules in
 * docs/00-spec-decisions.md D16. The two rules worth stating out loud:
 *
 *   • **Co-hosts have host powers but cannot act on each other or on the owner.** Without that
 *     asymmetry two co-hosts can demote and remove each other, and a co-host can eject the owner
 *     from their own group.
 *   • **Nobody can act on themselves.** Self-removal has its own action (`member:leave`), which
 *     carries its own rule: the owner cannot leave without transferring first, or the group is
 *     left with no one able to run it.
 */
export function can(action: GroupAction, actor: Actor, target?: Target): boolean {
  switch (action) {
    // Anyone in the group may look at it.
    case 'group:read':
    case 'member:list':
      return true;

    // The punishment history is visible to every member on purpose: it is accountability for
    // hosts, not a private list kept about people.
    case 'punishment:list':
      return true;

    /**
     * Any member may watch a game, join one, leave one, and take part in the one they joined.
     *
     * Whether they may join *this* game is a matter of their status and the phase, not their
     * role: a player at three consecutive punishments is `GAME_BLOCKED` (D7) and the roster locks
     * once the game starts (D13). Both are checked by the session service, which is where the
     * game state lives.
     */
    case 'session:read':
    case 'session:join':
    case 'session:leave':
    case 'session:play':
      return true;

    // Creating a game and running it are host powers, exactly as the brief specifies.
    case 'session:create':
    case 'session:host':
      return isHost(actor.role);

    /**
     * Punishing and forgiving carry the same target asymmetry as removal — a co-host must not be
     * able to punish the owner or another co-host — and nobody may punish themselves.
     */
    case 'punishment:punish':
    case 'punishment:forgive': {
      if (target === undefined) return false;
      if (target.userId === actor.userId) return false;
      if (actor.role === 'OWNER') return true;
      return actor.role === 'COHOST' && target.role === 'MEMBER';
    }

    case 'group:rename':
    case 'invitation:create':
    case 'invitation:list':
    case 'invitation:revoke':
      return isHost(actor.role);

    // Destroying the group, handing it over, and changing who the hosts are stay with the owner.
    case 'group:delete':
    case 'ownership:transfer':
    case 'member:promote':
    case 'member:demote':
      return actor.role === 'OWNER';

    case 'member:remove': {
      if (target === undefined) return false;
      if (target.userId === actor.userId) return false;
      if (actor.role === 'OWNER') return true;
      // A co-host may remove ordinary members only.
      return actor.role === 'COHOST' && target.role === 'MEMBER';
    }

    case 'member:leave':
      // The owner must transfer ownership first; see OWNER_CANNOT_LEAVE.
      return actor.role !== 'OWNER';

    default: {
      // Exhaustiveness: adding an action to the union without handling it fails to compile.
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/** `can`, but raising the error the route should return. */
export function assertCan(action: GroupAction, actor: Actor, target?: Target): void {
  if (can(action, actor, target)) return;

  if (action === 'member:leave' && actor.role === 'OWNER') {
    throw new ForbiddenError(
      ERROR_CODES.OWNER_CANNOT_LEAVE,
      'Transfer ownership to someone else before you leave.',
    );
  }

  if (target !== undefined && target.userId === actor.userId) {
    throw new ForbiddenError(ERROR_CODES.CANNOT_ACT_ON_SELF, 'You cannot do that to yourself.');
  }

  throw new ForbiddenError(ERROR_CODES.FORBIDDEN, 'Only a host can do that.');
}
