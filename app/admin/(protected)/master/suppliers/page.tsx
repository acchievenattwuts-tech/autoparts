export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import SuppliersClient from "./SuppliersClient";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const SuppliersPage = async () => {
  await requirePermission("master.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      contactName: true,
      phone: true,
      address: true,
      taxId: true,
      creditTerm: true,
      isActive: true,
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการผู้จำหน่าย"
        description="จัดการข้อมูลผู้จำหน่าย เครดิตเทอม และสถานะการใช้งาน"
      />
      <SuppliersClient
        suppliers={suppliers}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default SuppliersPage;
