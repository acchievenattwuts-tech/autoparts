import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import {
  clearFailedLogins,
  getLoginThrottleKeys,
  isLoginBlocked,
  recordFailedLogin,
} from "@/lib/login-rate-limit";
import { getAllPermissionKeys } from "@/lib/access-control";
import { authConfig } from "./auth.config";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { auth, signIn, signOut, handlers, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const username = parsed.data.username.trim().toLowerCase();
        const { password } = parsed.data;
        const throttleKeys = getLoginThrottleKeys(username, request);
        const requestContext = getRequestContextFromHeaders(request.headers);

        if (await isLoginBlocked(throttleKeys)) {
          await safeWriteAuditLog({
            ...requestContext,
            action: AuditAction.LOGIN_FAILED,
            entityType: "Auth",
            entityRef: username,
            meta: { reason: "LOGIN_BLOCKED" },
          });
          return null;
        }

        const user = await db.user.findFirst({
          where: {
            OR: [{ username }, { email: username }],
          },
          include: {
            appRole: {
              include: {
                permissions: {
                  include: {
                    permission: {
                      select: { key: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (!user || !user.isActive) {
          await recordFailedLogin(throttleKeys);
          await safeWriteAuditLog({
            ...requestContext,
            action: AuditAction.LOGIN_FAILED,
            entityType: "Auth",
            entityId: user?.id ?? null,
            entityRef: username,
            userId: user?.id ?? null,
            userName: user?.name ?? user?.email ?? null,
            userRole: user?.role ?? null,
            meta: { reason: user ? "USER_INACTIVE" : "USER_NOT_FOUND" },
          });
          return null;
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          await recordFailedLogin(throttleKeys);
          await safeWriteAuditLog({
            ...requestContext,
            action: AuditAction.LOGIN_FAILED,
            entityType: "Auth",
            entityId: user.id,
            entityRef: user.username ?? user.email,
            userId: user.id,
            userName: user.name ?? user.email,
            userRole: user.role,
            meta: { reason: "INVALID_PASSWORD" },
          });
          return null;
        }

        const permissions =
          user.role === "ADMIN"
            ? getAllPermissionKeys()
            : user.appRole?.permissions.map((item) => item.permission.key) ?? [];

        await clearFailedLogins(throttleKeys);
        await safeWriteAuditLog({
          ...requestContext,
          action: AuditAction.LOGIN,
          entityType: "Auth",
          entityId: user.id,
          entityRef: user.username ?? user.email,
          userId: user.id,
          userName: user.name ?? user.email,
          userRole: user.role,
          meta: { method: "credentials" },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          appRoleId: user.appRoleId,
          permissions,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const sessionValue = "session" in message ? message.session : undefined;
      const sessionUser =
        sessionValue && typeof sessionValue === "object" && "user" in sessionValue
          ? (sessionValue as { user?: { id?: string | null; name?: string | null; role?: string | null } }).user
          : undefined;
      const token = "token" in message ? message.token : undefined;

      await safeWriteAuditLog({
        action: AuditAction.LOGOUT,
        entityType: "Auth",
        entityId:
          sessionUser?.id ??
          (typeof token?.id === "string" ? token.id : null),
        entityRef:
          sessionUser?.name ??
          (typeof token?.name === "string" ? token.name : null),
        userId:
          sessionUser?.id ??
          (typeof token?.id === "string" ? token.id : null),
        userName:
          sessionUser?.name ??
          (typeof token?.name === "string" ? token.name : null),
        userRole:
          sessionUser?.role ??
          (typeof token?.role === "string" ? token.role : null),
      });
    },
  },
});
