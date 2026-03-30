import { auth } from "@/auth";
import { getAllPermissionKeys, getUserPermissionKeys, type PermissionKey } from "@/lib/access-control";
import { db } from "@/lib/db";
import type { Session } from "next-auth";

export type UserRole = "ADMIN" | "STAFF";

function hasRole(session: Session | null, role: UserRole): session is Session {
  return !!session?.user && session.user.role === role;
}

export const getRequiredSession = async (): Promise<Session> => {
  const session = await auth();
  if (!session?.user) {
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
  const permissions =
    role === "ADMIN"
      ? getAllPermissionKeys()
      : ((session.user.permissions ?? []) as PermissionKey[]);

  return { session, role, permissions };
};

export const requirePermission = async (permission: PermissionKey): Promise<Session> => {
  const session = await getRequiredSession();

  if (session.user.role === "ADMIN") {
    return session;
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true },
  });

  if (!user?.isActive) {
    throw new Error("FORBIDDEN");
  }

  const permissionKeys = await getUserPermissionKeys(session.user.id);
  if (!permissionKeys.includes(permission)) {
    throw new Error("FORBIDDEN");
  }

  return session;
};

export const requireAnyPermission = async (permissions: PermissionKey[]): Promise<Session> => {
  const session = await getRequiredSession();

  if (session.user.role === "ADMIN") {
    return session;
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true },
  });

  if (!user?.isActive) {
    throw new Error("FORBIDDEN");
  }

  const permissionKeys = await getUserPermissionKeys(session.user.id);
  if (!permissions.some((permission) => permissionKeys.includes(permission))) {
    throw new Error("FORBIDDEN");
  }

  return session;
};
