import type { NextAuthConfig } from "next-auth";
import { getAllPermissionKeys, getRoutePermission, isKnowledgePermission } from "@/lib/access-control";
import { db, withDbRetry } from "@/lib/db";
import { isSessionRevisionInvalid } from "@/lib/auth-session-revocation";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAdmin = auth?.user?.role === "ADMIN";
      const mustChangePassword = Boolean(auth?.user?.mustChangePassword);
      const sessionInvalid = Boolean(auth?.user?.sessionInvalid);
      const permissions = auth?.user?.permissions ?? [];
      const hasAppRole = !!auth?.user?.appRoleId;
      const isAdminRoute = nextUrl.pathname.startsWith("/admin");
      const isLoginPage = nextUrl.pathname === "/admin/login";
      const isChangePasswordPage = nextUrl.pathname === "/admin/profile/change-password";
      const requiredPermission = getRoutePermission(nextUrl.pathname);

      if (isLoginPage) {
        if (!sessionInvalid && (isAdmin || hasAppRole)) {
          const destination = mustChangePassword ? "/admin/profile/change-password" : "/admin";
          return Response.redirect(new URL(destination, nextUrl));
        }
        return true;
      }

      if (isAdminRoute) {
        if (!isLoggedIn || sessionInvalid) {
          return Response.redirect(new URL("/admin/login", nextUrl));
        }
        if (mustChangePassword && !isChangePasswordPage) {
          return Response.redirect(new URL("/admin/profile/change-password", nextUrl));
        }
        if (isAdmin && !(requiredPermission && isKnowledgePermission(requiredPermission))) return true;
        if (!hasAppRole && !isAdmin) return false;
        if (typeof requiredPermission === "undefined") return false;
        if (requiredPermission === null) return true;
        return permissions.includes(requiredPermission);
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
        const current = await withDbRetry(() =>
          db.user.findUnique({
            where: { id: token.id as string },
            select: {
              authVersion: true,
              isActive: true,
              role: true,
              appRole: {
                select: {
                  permissions: { select: { permission: { select: { key: true } } } },
                },
              },
              directPermissionGrants: {
                select: { permission: { select: { key: true } } },
              },
            },
          }),
        );
        token.sessionInvalid = isSessionRevisionInvalid({
          tokenVersion: token.authVersion,
          currentVersion: current?.authVersion,
          isActive: current?.isActive,
        });
        if (current && !token.sessionInvalid) {
          const direct = current.directPermissionGrants.map((item) => item.permission.key);
          token.permissions = current.role === "ADMIN"
            ? getAllPermissionKeys().filter((permission) => !isKnowledgePermission(permission) || direct.includes(permission))
            : [...new Set([...(current.appRole?.permissions.map((item) => item.permission.key) ?? []), ...direct])];
        }
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
