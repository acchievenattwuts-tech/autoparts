export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import SupplierPaymentCancelButton from "../SupplierPaymentCancelButton";

const paymentMethodLabel = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "ตัดยอด",
} as const;

const SupplierPaymentDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  await requirePermission("supplier_payments.view");
  const { id } = await params;
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "supplier_payments.update");
  const canCancel = hasPermissionAccess(role, permissions, "supplier_payments.cancel");

  const payment = await db.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true, code: true, phone: true } },
      cashBankAccount: { select: { name: true, code: true } },
      user: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
          purchase: { select: { id: true, purchaseNo: true, purchaseDate: true } },
          purchaseReturn: { select: { id: true, returnNo: true, returnDate: true } },
          advance: { select: { id: true, advanceNo: true, advanceDate: true } },
        },
      },
    },
  });

  if (!payment) {
    return <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">ไม่พบเอกสาร</div>;
  }

  const purchaseItems = payment.items.filter((item) => !!item.purchaseId);
  const creditItems = payment.items.filter((item) => !!item.purchaseReturnId);
  const advanceItems = payment.items.filter((item) => !!item.advanceId);
  const creditTotal = creditItems.reduce((sum, item) => sum + Number(item.paidAmount), 0);
  const advanceTotal = advanceItems.reduce((sum, item) => sum + Number(item.paidAmount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/supplier-payments"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ArrowLeft size={16} /> กลับไปรายการจ่ายชำระซัพพลายเออร์
        </Link>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-kanit text-2xl font-bold text-gray-900">{payment.paymentNo}</h1>
              <p className="mt-1 text-sm text-gray-500">รายละเอียดเอกสารจ่ายชำระซัพพลายเออร์</p>
            </div>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                payment.status === "CANCELLED"
                  ? "bg-red-100 text-red-700"
                  : "bg-green-100 text-green-700"
              }`}
            >
              {payment.status === "CANCELLED" ? "ยกเลิกแล้ว" : "ใช้งาน"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {payment.status === "ACTIVE" && canUpdate ? (
              <Link
                href={`/admin/supplier-payments/${payment.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
              >
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {payment.status === "ACTIVE" && canCancel ? (
              <SupplierPaymentCancelButton paymentId={payment.id} docNo={payment.paymentNo} />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">ซัพพลายเออร์</p>
            <p className="mt-1 font-medium text-gray-900">{payment.supplier.name}</p>
            <p className="mt-1 text-sm text-gray-500">
              {[payment.supplier.code, payment.supplier.phone].filter(Boolean).join(" | ") || "-"}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">วันที่เอกสาร</p>
            <p className="mt-1 font-medium text-gray-900">
              {formatDateThai(payment.paymentDate)}
            </p>
            <p className="mt-1 text-sm text-gray-500">ผู้บันทึก: {payment.user.name ?? "-"}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">ช่องทาง / บัญชีจ่ายเงิน</p>
            <p className="mt-1 font-medium text-gray-900">{paymentMethodLabel[payment.paymentMethod]}</p>
            <p className="mt-1 text-sm text-gray-500">
              {payment.cashBankAccount
                ? `${payment.cashBankAccount.name} (${payment.cashBankAccount.code})`
                : "ไม่มีการจ่ายเงินจริง"}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-gray-100 bg-white p-4">
            <p className="text-sm text-gray-500">ยอดซื้อเชื่อที่ชำระ</p>
            <p className="mt-2 font-kanit text-2xl font-bold text-[#1e3a5f]">
              {purchaseItems
                .reduce((sum, item) => sum + Number(item.paidAmount), 0)
                .toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-700">ใช้เครดิต CN ซื้อ</p>
            <p className="mt-2 font-kanit text-2xl font-bold text-emerald-700">
              {creditTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
            <p className="text-sm text-amber-700">ใช้เงินมัดจำ</p>
            <p className="mt-2 font-kanit text-2xl font-bold text-amber-700">
              {advanceTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="text-sm text-blue-700">ยอดจ่ายเงินจริง</p>
            <p className="mt-2 font-kanit text-2xl font-bold text-blue-700">
              {Number(payment.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {payment.note ? (
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">หมายเหตุ</p>
            <p className="mt-1 text-sm text-gray-600">{payment.note}</p>
          </div>
        ) : null}

        {payment.status === "CANCELLED" && payment.cancelNote ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">เหตุผลที่ยกเลิก</p>
            <p className="mt-1 text-sm text-red-600">{payment.cancelNote}</p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">ใบซื้อเชื่อที่ชำระ</h2>
          {purchaseItems.length === 0 ? (
            <p className="text-sm text-gray-400">ไม่มีรายการ</p>
          ) : (
            <div className="space-y-3">
              {purchaseItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/purchases/${item.purchase?.id}`}
                  className="block rounded-lg border border-gray-100 p-4 transition-colors hover:border-[#1e3a5f]/30 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono font-medium text-[#1e3a5f]">{item.purchase?.purchaseNo ?? "-"}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {item.purchase?.purchaseDate
                          ? formatDateThai(item.purchase.purchaseDate)
                          : "-"}
                      </p>
                    </div>
                    <p className="font-medium text-gray-900">
                      {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-emerald-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-emerald-800">เครดิต CN ซื้อที่ใช้</h2>
          {creditItems.length === 0 ? (
            <p className="text-sm text-gray-400">ไม่มีรายการ</p>
          ) : (
            <div className="space-y-3">
              {creditItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/purchase-returns/${item.purchaseReturn?.id}`}
                  className="block rounded-lg border border-emerald-100 p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono font-medium text-emerald-700">{item.purchaseReturn?.returnNo ?? "-"}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {item.purchaseReturn?.returnDate
                          ? formatDateThai(item.purchaseReturn.returnDate)
                          : "-"}
                      </p>
                    </div>
                    <p className="font-medium text-emerald-700">
                      {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-amber-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-amber-800">เงินมัดจำที่ใช้</h2>
          {advanceItems.length === 0 ? (
            <p className="text-sm text-gray-400">ไม่มีรายการ</p>
          ) : (
            <div className="space-y-3">
              {advanceItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/supplier-advances/${item.advance?.id}`}
                  className="block rounded-lg border border-amber-100 p-4 transition-colors hover:border-amber-300 hover:bg-amber-50/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono font-medium text-amber-700">{item.advance?.advanceNo ?? "-"}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {item.advance?.advanceDate
                          ? formatDateThai(item.advance.advanceDate)
                          : "-"}
                      </p>
                    </div>
                    <p className="font-medium text-amber-700">
                      {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierPaymentDetailPage;
