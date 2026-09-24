import type { NextAuthConfig } from "next-auth";
import { db, withDbRetry } from "@/lib/db";
import { buildAdminForbiddenResponse } from "@/lib/admin-forbidden-response";
import { decideAdminRouteAccess } from "@/lib/admin-route-access";
import { isSessionRevoked, type UserAuthState } from "@/lib/auth-revocation-cache";

/**
 * Staff sessions end after 7 idle days (Auth.js default: 30). With the JWT
 * strategy every auth() call re-issues the cookie with a fresh 7-day expiry, so
 * this is a sliding window; `session.updateAge` only throttles database-backed
 * sessions and has no effect here.
 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const loadUserAuthState = (userId: string): Promise<UserAuthState | null> =>
  withDbRetry(() =>
    db.user.findUnique({
      where: { id: userId },
      select: {
        authVersion: true,
        isActive: true,
      },
    }),
  );

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
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
      // A Response, not `false`: when auth() wraps a handler (proxy.ts), Auth.js
      // ignores a boolean false and runs the handler anyway.
      if (decision.type === "deny") {
        return buildAdminForbiddenResponse(request);
      }
      return true;
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
        // Memoized per user for up to 30s; see lib/auth-revocation-cache.ts.
        token.sessionInvalid = await isSessionRevoked({
          userId: token.id,
          tokenVersion: token.authVersion,
          load: loadUserAuthState,
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
