export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { notFound } from "next/navigation";
import CustomerForm from "../../CustomerForm";

const EditCustomerPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("customers.update");

  const { id } = await params;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการลูกค้า
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไขลูกค้า</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขข้อมูลลูกค้า</h1>
      <CustomerForm customer={customer} />
    </div>
  );
};

export default EditCustomerPage;
