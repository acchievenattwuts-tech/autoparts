import type { ReactNode } from "react";
import { auth } from "@/auth";
import AdminShell from "@/components/shared/AdminShell";
import { getAllPermissionKeys } from "@/lib/access-control";

const AdminLayout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();
  const permissions =
    session?.user?.role === "ADMIN"
      ? getAllPermissionKeys()
      : (session?.user?.permissions ?? []);
  const mustChangePassword = session?.user?.mustChangePassword ?? false;
  const username = session?.user?.name ?? session?.user?.email ?? "";

  return (
    <AdminShell permissions={permissions} mustChangePassword={mustChangePassword} username={username}>
      {children}
    </AdminShell>
  );
};

export default AdminLayout;
