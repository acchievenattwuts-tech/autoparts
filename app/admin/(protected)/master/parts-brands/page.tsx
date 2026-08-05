export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import PartsBrandForm from "./PartsBrandForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const PartsBrandsPage = async () => {
  await requirePermission("master.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const brands = await db.partsBrand.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการแบรนด์อะไหล่"
        description="เพิ่ม แก้ไข และควบคุมสถานะแบรนด์อะไหล่"
      />
      <PartsBrandForm
        brands={brands}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default PartsBrandsPage;
