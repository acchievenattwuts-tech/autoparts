export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import SupplierAdvanceForm from "../SupplierAdvanceForm";

const NewSupplierAdvancePage = async () => {
  await requirePermission("supplier_advances.create");

  const [suppliers, cashBankAccounts] = await Promise.all([
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

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/supplier-advances"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ChevronLeft size={16} /> เงินมัดจำซัพพลายเออร์
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้างเอกสารใหม่</span>
      </div>

      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">บันทึกเงินมัดจำซัพพลายเออร์</h1>

      <SupplierAdvanceForm suppliers={suppliers} cashBankAccounts={cashBankAccounts} />
    </div>
  );
};

export default NewSupplierAdvancePage;
