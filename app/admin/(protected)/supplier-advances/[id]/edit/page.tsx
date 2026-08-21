export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { formatDateOnlyForInput } from "@/lib/th-date";
import {
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  checkDocumentMutation,
} from "@/lib/document-mutation-guard";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import SupplierAdvanceForm from "../../SupplierAdvanceForm";

const EditSupplierAdvancePage = async ({ params,
}: { params: Promise<{ id: string }>;
}) => {
  await requirePermission("supplier_advances.update");

  const { id } = await params;

  const [advance, suppliers, cashBankAccounts, activeRefundCount] = await Promise.all([
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
      db.supplierAdvanceRefund.count({
        where: { supplierAdvanceId: id, status: "ACTIVE" },
      }),
    ]);

  if (!advance) notFound();
  if (advance.status === "CANCELLED") redirect(`/admin/supplier-advances/${id}`);

  const advancePayments = await db.documentPayment.findMany({
    where: { docType: "SUPPLIER_ADVANCE", docId: id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: { cashBankAccountId: true, amount: true },
  });

  const mutationBlock = await checkDocumentMutation("SupplierAdvance", id, "update",
  );
  const mutationBlockMessage =
    activeRefundCount > 0 ? null : buildMutationBlockMessage(mutationBlock);
  const mutationBlockReferences = buildMutationBlockReferenceLinks(mutationBlock);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href={`/admin/supplier-advances/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> {advance.advanceNo}
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>

      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">แก้ไขเงินมัดจำซัพพลายเออร์</h1>

      {mutationBlockMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={mutationBlockMessage}
            references={mutationBlockReferences}
          />
        </div>
      )}

      <SupplierAdvanceForm
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        submitLocked={!!mutationBlockMessage}
        sourceFieldsLocked={activeRefundCount > 0}
        initialData={{
          id: advance.id,
          supplierId: advance.supplierId,
      advanceDate: formatDateOnlyForInput(advance.advanceDate),
          totalAmount: Number(advance.totalAmount),
          cashBankAccountId: advance.cashBankAccountId ?? "",
          payments: advancePayments.map((row) => ({
            cashBankAccountId: row.cashBankAccountId,
            amount: Number(row.amount),
          })),
          note: advance.note ?? "",
        }}
      />
    </div>
  );
};

export default EditSupplierAdvancePage;
