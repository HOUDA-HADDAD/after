/**
 * The authenticated user, as the client sees them.
 *
 * Deliberately minimal: the brief specifies no public profile system, and a user is only ever
 * visible to people who share a group with them. Nothing here is a secret, which is what makes
 * it safe to hold in client memory.
 */
export interface UserDto {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

/** Response shape for the auth endpoints that return the signed-in user. */
export interface SessionDto {
  user: UserDto;
}
