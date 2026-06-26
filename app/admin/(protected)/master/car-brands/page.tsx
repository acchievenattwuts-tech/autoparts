export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import CarBrandsClient from "./CarBrandsClient";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const CarBrandsPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const carBrands = await db.carBrand.findMany({
    orderBy: { name: "asc" },
    include: {
      carModels: {
        orderBy: { name: "asc" },
      },
      aliases: {
        orderBy: { alias: "asc" },
      },
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการยี่ห้อและรุ่นรถ"
        description="จัดการยี่ห้อรถ รุ่นรถ และสถานะการใช้งาน"
      />
      <CarBrandsClient
        carBrands={carBrands}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
      />
    </div>
  );
};

export default CarBrandsPage;
