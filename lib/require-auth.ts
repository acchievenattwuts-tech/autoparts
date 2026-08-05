import { getSession } from "@/lib/auth-session";
import type { PermissionKey } from "@/lib/access-control";
import type { Session } from "next-auth";

export type UserRole = "ADMIN" | "STAFF";

function hasRole(session: Session | null, role: UserRole): session is Session {
  return !!session?.user && session.user.role === role;
}

export const getRequiredSession = async (): Promise<Session> => {
  const session = await getSession();
  if (!session?.user || session.user.sessionInvalid) {
    throw new Error("UNAUTHORIZED");
  }

  return session;
};

/**
 * Backward-compatible helper for admin-only mutations.
 * Use getRequiredSession() for authenticated-only flows and requireRole()
 * when you need explicit role checks.
 */
export const requireAuth = async (): Promise<void> => {
  await requireRole("ADMIN");
};

export const requireRole = async (role: UserRole): Promise<Session> => {
  const session = await getRequiredSession();
  if (!hasRole(session, role)) {
    throw new Error("FORBIDDEN");
  }

  return session;
};

export const requireAdmin = async (): Promise<Session> => {
  return requireRole("ADMIN");
};

export const getSessionPermissionContext = async (): Promise<{
  session: Session;
  role: string;
  permissions: PermissionKey[];
}> => {
  const session = await getRequiredSession();
  const role = session.user.role;
  const permissions = (session.user.permissions ?? []) as PermissionKey[];

  return { session, role, permissions };
};

/**
 * Permission keys carried by the session.
 *
 * The jwt() callback in auth.config.ts re-reads appRole + direct grants from the
 * DB on every `auth()` call and rewrites `token.permissions` before the session
 * is handed back, so these keys are exactly as fresh as a separate
 * `getUserPermissionKeys()` query would be — without the extra round-trip.
 * Keys that are no longer in the catalog can never match a `PermissionKey`
 * argument, so no filtering is needed for the membership check.
 */
const getSessionPermissionKeys = (session: Session): string[] =>
  session.user.permissions ?? [];

export const requirePermission = async (permission: PermissionKey): Promise<Session> => {
  const session = await getRequiredSession();

  if (!getSessionPermissionKeys(session).includes(permission)) {
    throw new Error("FORBIDDEN");
  }

  return session;
};

export const requireAnyPermission = async (permissions: PermissionKey[]): Promise<Session> => {
  const session = await getRequiredSession();

  const permissionKeys = getSessionPermissionKeys(session);
  if (!permissions.some((permission) => permissionKeys.includes(permission))) {
    throw new Error("FORBIDDEN");
  }

  return session;
};
