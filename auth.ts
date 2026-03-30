import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  clearFailedLogins,
  getLoginThrottleKeys,
  isLoginBlocked,
  recordFailedLogin,
} from "@/lib/login-rate-limit";
import { authConfig } from "./auth.config";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const username = parsed.data.username.trim().toLowerCase();
        const { password } = parsed.data;
        const throttleKeys = getLoginThrottleKeys(username, request);

        if (await isLoginBlocked(throttleKeys)) return null;

        const user = await db.user.findUnique({ where: { email: username } });
        if (!user || !user.isActive) {
          await recordFailedLogin(throttleKeys);
          return null;
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          await recordFailedLogin(throttleKeys);
          return null;
        }

        await clearFailedLogins(throttleKeys);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
});
