export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import PartsBrandForm from "./PartsBrandForm";

const PartsBrandsPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const brands = await db.partsBrand.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">จัดการแบรนด์อะไหล่</h1>
      <PartsBrandForm
        brands={brands}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default PartsBrandsPage;
