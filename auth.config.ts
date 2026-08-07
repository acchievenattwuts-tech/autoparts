import type { NextAuthConfig } from "next-auth";
import { db, withDbRetry } from "@/lib/db";
import { isSessionRevisionInvalid } from "@/lib/auth-session-revocation";
import { decideAdminRouteAccess } from "@/lib/admin-route-access";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      // The decision itself lives in lib/admin-route-access.ts so it can be
      // tested without a request; this callback only carries it out.
      const decision = decideAdminRouteAccess({
        pathname: nextUrl.pathname,
        isLoggedIn: !!auth?.user,
        isAdmin: auth?.user?.role === "ADMIN",
        hasAppRole: !!auth?.user?.appRoleId,
        mustChangePassword: Boolean(auth?.user?.mustChangePassword),
        sessionInvalid: Boolean(auth?.user?.sessionInvalid),
        permissions: auth?.user?.permissions ?? [],
      });

      if (decision.type === "redirect") {
        return Response.redirect(new URL(decision.to, nextUrl));
      }
      return decision.type === "allow";
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.appRoleId = user.appRoleId ?? null;
        token.permissions = user.permissions ?? [];
        token.mustChangePassword = user.mustChangePassword ?? false;
        token.authVersion = user.authVersion ?? 0;
        token.sessionInvalid = false;
        return token;
      }

      if (typeof token.id !== "string" || !token.id) {
        token.sessionInvalid = true;
        return token;
      }

      try {
        const current = await withDbRetry(() =>
          db.user.findUnique({
            where: { id: token.id as string },
            select: {
              authVersion: true,
              isActive: true,
            },
          }),
        );
        token.sessionInvalid = isSessionRevisionInvalid({
          tokenVersion: token.authVersion,
          currentVersion: current?.authVersion,
          isActive: current?.isActive,
        });
      } catch (error) {
        // Authorization must fail closed when the revocation check cannot run.
        console.error("[auth] session revocation check failed", error);
        token.sessionInvalid = true;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.appRoleId = (token.appRoleId as string | null | undefined) ?? null;
        session.user.permissions = Array.isArray(token.permissions)
          ? token.permissions.map((permission) => String(permission))
          : [];
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
        session.user.sessionInvalid = Boolean(token.sessionInvalid);
      }
      return session;
    },
  },
  providers: [],
};
