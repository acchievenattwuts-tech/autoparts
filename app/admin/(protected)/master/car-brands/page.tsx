export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import CarBrandsClient from "./CarBrandsClient";

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
    },
  });

  return (
    <div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">จัดการยี่ห้อและรุ่นรถ</h1>
      <CarBrandsClient
        carBrands={carBrands}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default CarBrandsPage;
