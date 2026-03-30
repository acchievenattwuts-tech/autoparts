export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import SuppliersClient from "./SuppliersClient";

const SuppliersPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">จัดการผู้จำหน่าย</h1>
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
