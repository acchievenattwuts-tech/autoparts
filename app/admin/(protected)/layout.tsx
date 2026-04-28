import type { ReactNode } from "react";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminShell from "@/components/shared/AdminShell";
import { getAdminThemeCookieName, parseAdminTheme } from "@/lib/admin-theme";
import { getAllPermissionKeys } from "@/lib/access-control";

const AdminLayout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();
  if (!session?.user) {
    redirect("/admin/login");
  }

  const permissions =
    session.user.role === "ADMIN"
      ? getAllPermissionKeys()
      : (session.user.permissions ?? []);
  const initialTheme = parseAdminTheme(
    (await cookies()).get(getAdminThemeCookieName(session.user.id))?.value,
  );
  const mustChangePassword = session.user.mustChangePassword ?? false;
  const username = session.user.name ?? session.user.email ?? "";

  return (
    <AdminShell
      initialTheme={initialTheme}
      mustChangePassword={mustChangePassword}
      permissions={permissions}
      userId={session.user.id}
      username={username}
      role={session.user.role}
    >
      {children}
    </AdminShell>
  );
};

export default AdminLayout;
