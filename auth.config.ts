import type { NextAuthConfig } from "next-auth";
import { getRoutePermission } from "@/lib/access-control";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAdmin = auth?.user?.role === "ADMIN";
      const permissions = auth?.user?.permissions ?? [];
      const hasAppRole = !!auth?.user?.appRoleId;
      const isAdminRoute = nextUrl.pathname.startsWith("/admin");
      const isLoginPage = nextUrl.pathname === "/admin/login";
      const requiredPermission = getRoutePermission(nextUrl.pathname);

      if (isLoginPage) {
        if (isAdmin || hasAppRole) return Response.redirect(new URL("/admin", nextUrl));
        return true;
      }

      if (isAdminRoute) {
        if (!isLoggedIn) return false;
        if (isAdmin) return true;
        if (!hasAppRole) return false;
        if (!requiredPermission) return true;
        return permissions.includes(requiredPermission);
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.appRoleId = user.appRoleId ?? null;
        token.permissions = user.permissions ?? [];
        token.mustChangePassword = user.mustChangePassword ?? false;
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
      }
      return session;
    },
  },
  providers: [],
};
