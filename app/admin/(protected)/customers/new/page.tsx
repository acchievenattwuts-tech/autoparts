export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import { getActiveCustomerTypeOptions } from "@/lib/admin-master-options";
import CustomerForm from "../CustomerForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const NewCustomerPage = async () => {
  await requirePermission("customers.create");

  const [customerTypeOptions, systemType] = await Promise.all([
    getActiveCustomerTypeOptions(),
    db.customerType.findFirst({ where: { isSystem: true, isActive: true }, select: { id: true } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการลูกค้า
        </Link>
      </div>
      <AdminPageHeader
        title="เพิ่มลูกค้าใหม่"
        description="บันทึกข้อมูลติดต่อ ที่อยู่ และข้อมูลภาษีของลูกค้า"
      />
      <CustomerForm
        customerTypeOptions={customerTypeOptions}
        defaultCustomerTypeId={systemType?.id ?? null}
      />
    </div>
  );
};

export default NewCustomerPage;
