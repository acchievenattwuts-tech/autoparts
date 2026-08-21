export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import AdvanceRefundForm from "@/components/admin/AdvanceRefundForm";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

export default async function NewCustomerAdvanceRefundPage() {
  await requirePermission("customer_advance_refunds.create");
  const [advances, accounts] = await Promise.all([
    db.customerAdvance.findMany({
      where: { status: "ACTIVE", amountRemain: { gt: 0 } },
      orderBy: [{ advanceDate: "desc" }, { advanceNo: "desc" }],
      include: { customer: { select: { name: true } } },
    }),
    getActiveCashBankAccountOptions(),
  ]);
  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/customer-advance-refunds"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> คืนเงินมัดจำลูกค้า
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm text-gray-700 dark:text-slate-300">
          สร้างเอกสารใหม่
        </span>
      </div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
        บันทึกคืนเงินมัดจำลูกค้า
      </h1>
      <AdvanceRefundForm
        side="CUSTOMER"
        advances={advances.map((row) => ({
          id: row.id,
          advanceNo: row.advanceNo,
          partyName: row.customer.name,
          amountRemain: Number(row.amountRemain),
        }))}
        cashBankAccounts={accounts}
      />
    </div>
  );
}
