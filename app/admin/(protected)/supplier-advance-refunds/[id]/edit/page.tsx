export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import AdvanceRefundForm from "@/components/admin/AdvanceRefundForm";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { db } from "@/lib/db";
import { DocumentPaymentDocType } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput } from "@/lib/th-date";

export default async function EditSupplierAdvanceRefundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("supplier_advance_refunds.update");
  const { id } = await params;
  const [refund, accounts, payments] = await Promise.all([
    db.supplierAdvanceRefund.findUnique({
      where: { id },
      include: {
        supplierAdvance: { include: { supplier: { select: { name: true } } } },
      },
    }),
    getActiveCashBankAccountOptions(),
    db.documentPayment.findMany({
      where: {
        docType: DocumentPaymentDocType.SUPPLIER_ADVANCE_REFUND,
        docId: id,
      },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    }),
  ]);
  if (!refund) notFound();
  if (refund.status === "CANCELLED")
    redirect(`/admin/supplier-advance-refunds/${id}`);
  const source = refund.supplierAdvance;
  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href={`/admin/supplier-advance-refunds/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> {refund.refundNo}
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
        แก้ไขรับคืนเงินมัดจำซัพพลายเออร์
      </h1>
      <AdvanceRefundForm
        side="SUPPLIER"
        advances={[
          {
            id: source.id,
            advanceNo: source.advanceNo,
            partyName: source.supplier.name,
            amountRemain: Number(source.amountRemain),
          },
        ]}
        cashBankAccounts={accounts}
        initialData={{
          id,
          sourceAdvanceId: source.id,
          refundDate: formatDateOnlyForInput(refund.refundDate),
          refundAmount: Number(refund.refundAmount),
          sourceAmountRemain: Number(source.amountRemain),
          payments: payments.map((row) => ({
            cashBankAccountId: row.cashBankAccountId,
            amount: Number(row.amount),
          })),
          note: refund.note ?? "",
        }}
      />
    </div>
  );
}
