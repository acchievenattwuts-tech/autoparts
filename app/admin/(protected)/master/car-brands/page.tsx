export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
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

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  // Selected rather than `include`d: the page renders name + active state only,
  // while the full rows carry timestamps on every brand, model and alias plus
  // CarBrandAlias.notes (free text). Those travel to the browser inside the RSC
  // payload for every row, so they were pure egress. Same rows, same order —
  // only the unused columns are gone.
  const carBrands = await db.carBrand.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      carModels: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      },
      aliases: {
        orderBy: { alias: "asc" },
        select: { id: true, alias: true, isActive: true },
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
