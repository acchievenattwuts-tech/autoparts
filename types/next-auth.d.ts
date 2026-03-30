import type { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      appRoleId?: string | null;
      permissions: string[];
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role?: string;
    appRoleId?: string | null;
    permissions?: string[];
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    appRoleId?: string | null;
    permissions?: string[];
    mustChangePassword?: boolean;
  }
}
