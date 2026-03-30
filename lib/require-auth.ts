import { auth } from "@/auth";
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
