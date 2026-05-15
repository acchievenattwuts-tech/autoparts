export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { notFound } from "next/navigation";
import CustomerForm from "../../CustomerForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const EditCustomerPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("customers.update");

  const { id } = await params;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

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
        title="แก้ไขข้อมูลลูกค้า"
        description={customer.name}
      />
      <CustomerForm customer={customer} />
    </div>
  );
};

export default EditCustomerPage;
