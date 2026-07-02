export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getAllPermissionKeys, hasPermissionAccess } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import CustomerTypeForm from "./CustomerTypeForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const CustomerTypesPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const customerTypes = await db.customerType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      showPrice: true,
      isActive: true,
      sortOrder: true,
      isSystem: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการประเภทลูกค้า"
        description="กำหนดกลุ่มลูกค้าและคุมการแสดงราคาบน LINE (ติ๊ก 'แสดงราคา' = กลุ่มนั้นเห็นราคาจริง เช่น อู่ซ่อมรถ)"
      />
      <CustomerTypeForm
        customerTypes={customerTypes}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default CustomerTypesPage;
