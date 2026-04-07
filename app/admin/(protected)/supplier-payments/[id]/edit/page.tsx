export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getOutstandingSupplierDocuments } from "../../actions";
import SupplierPaymentForm from "../../SupplierPaymentForm";

const EditSupplierPaymentPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  await requirePermission("supplier_payments.update");
  const { id } = await params;

  const payment = await db.supplierPayment.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          purchase: { select: { purchaseNo: true, amountRemain: true } },
          purchaseReturn: { select: { returnNo: true, amountRemain: true } },
          advance: { select: { advanceNo: true, amountRemain: true } },
        },
      },
    },
  });

  if (!payment) {
    return <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">ไม่พบเอกสาร</div>;
  }

  const [suppliers, cashBankAccounts, initialDocuments] = await Promise.all([
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
    getOutstandingSupplierDocuments(payment.supplierId, payment.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/admin/supplier-payments/${payment.id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ArrowLeft size={16} /> กลับไปดูรายละเอียดเอกสาร
        </Link>
      </div>

      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">แก้ไขจ่ายชำระซัพพลายเออร์</h1>
        <p className="mt-1 text-sm text-gray-500">
          ปรับรายการใบซื้อเชื่อ เครดิต CN ซื้อ เงินมัดจำ และบัญชีจ่ายเงินของเอกสารนี้
        </p>
      </div>

      <SupplierPaymentForm
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        initialDocuments={initialDocuments}
        initialData={{
          id: payment.id,
          supplierId: payment.supplierId,
          paymentDate: payment.paymentDate.toISOString().slice(0, 10),
          cashBankAccountId: payment.cashBankAccountId ?? "",
          note: payment.note ?? "",
          items: payment.items.map((item) => ({
            kind: item.purchaseId
              ? "PURCHASE"
              : item.purchaseReturnId
                ? "SUPPLIER_CREDIT"
                : "ADVANCE",
            refId: item.purchaseId ?? item.purchaseReturnId ?? item.advanceId ?? "",
            docNo:
              item.purchase?.purchaseNo ??
              item.purchaseReturn?.returnNo ??
              item.advance?.advanceNo ??
              "-",
            outstanding:
              item.purchaseId
                ? Number(item.purchase?.amountRemain ?? 0) + Number(item.paidAmount)
                : item.purchaseReturnId
                  ? Number(item.purchaseReturn?.amountRemain ?? 0) + Number(item.paidAmount)
                  : Number(item.advance?.amountRemain ?? 0) + Number(item.paidAmount),
            paidAmount: Number(item.paidAmount),
          })),
        }}
      />
    </div>
  );
};

export default EditSupplierPaymentPage;
