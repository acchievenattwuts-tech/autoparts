export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import SupplierAdvanceForm from "../../SupplierAdvanceForm";

const EditSupplierAdvancePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("supplier_advances.update");

  const { id } = await params;

  const [advance, suppliers, cashBankAccounts] = await Promise.all([
    db.supplierAdvance.findUnique({
      where: { id },
      select: {
        id: true,
        advanceNo: true,
        advanceDate: true,
        supplierId: true,
        totalAmount: true,
        cashBankAccountId: true,
        note: true,
        status: true,
      },
    }),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
      },
    }),
    getActiveCashBankAccountOptions(),
  ]);

  if (!advance) notFound();
  if (advance.status === "CANCELLED") redirect(`/admin/supplier-advances/${id}`);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href={`/admin/supplier-advances/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ChevronLeft size={16} /> {advance.advanceNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>

      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">แก้ไขเงินมัดจำซัพพลายเออร์</h1>

      <SupplierAdvanceForm
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        initialData={{
          id: advance.id,
          supplierId: advance.supplierId,
          advanceDate: advance.advanceDate.toISOString().slice(0, 10),
          totalAmount: Number(advance.totalAmount),
          cashBankAccountId: advance.cashBankAccountId ?? "",
          note: advance.note ?? "",
        }}
      />
    </div>
  );
};

export default EditSupplierAdvancePage;
