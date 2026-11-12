import { z } from "zod";

/**
 * Longest login identifier accepted. Matches the username limit of the user
 * form (`app/admin/(protected)/users/actions.ts`), and a user's email is stored
 * as the same value, so no existing account is longer than this.
 */
export const LOGIN_USERNAME_MAX_LENGTH = 100;

/**
 * Passwords are set with a 100-character limit (user form and change-password);
 * 200 leaves headroom while still bounding what an unauthenticated request can
 * push into the throttle keys and the audit log. bcrypt reads only 72 bytes.
 */
export const LOGIN_PASSWORD_MAX_LENGTH = 200;

/**
 * Credentials payload of the admin login. Both fields are bounded because the
 * login runs before authentication: an unbounded username was written whole
 * into `LoginThrottle` keys and `AuditLog.entityRef` on every attempt.
 */
export const loginCredentialsSchema = z.object({
  username: z.string().min(1).max(LOGIN_USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH),
});
