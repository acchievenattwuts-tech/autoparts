import type { ReactNode } from "react";
import { getSession } from "@/lib/auth-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminShell from "@/components/shared/AdminShell";
import { getAdminThemeCookieName, parseAdminTheme } from "@/lib/admin-theme";
import { getFavoriteMenuHrefs } from "@/lib/user-favorite-menu";

const AdminLayout = async ({ children }: { children: ReactNode }) => {
  const session = await getSession();
  if (!session?.user) {
    redirect("/admin/login");
  }

  const permissions = session.user.permissions ?? [];
  const [cookieStore, favoriteHrefs] = await Promise.all([
    cookies(),
    getFavoriteMenuHrefs(session.user.id).catch(() => [] as string[]),
  ]);
  const initialTheme = parseAdminTheme(
    cookieStore.get(getAdminThemeCookieName(session.user.id))?.value,
  );
  const mustChangePassword = session.user.mustChangePassword ?? false;
  const username = session.user.name ?? session.user.email ?? "";

  return (
    <AdminShell
      initialTheme={initialTheme}
      initialFavoriteHrefs={favoriteHrefs}
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
