export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { getAllPermissionKeys, hasPermissionAccess } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import CustomerTypeForm from "./CustomerTypeForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const CustomerTypesPage = async () => {
  await requirePermission("master.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const [customerTypes, priceLists] = await Promise.all([
    db.customerType.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        priceListId: true,
        priceList: { select: { code: true, name: true, channel: true } },
        isActive: true,
        sortOrder: true,
        isSystem: true,
        createdAt: true,
      },
    }),
    db.priceList.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, channel: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการประเภทลูกค้า"
        description="กำหนดกลุ่มลูกค้าและ Price List ที่ใช้เติมราคาในหน้าขายและช่องทางที่เกี่ยวข้อง"
      />
      <CustomerTypeForm
        customerTypes={customerTypes}
        priceLists={priceLists}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default CustomerTypesPage;
