export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import { PaymentMethod } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { getSessionPermissionContext, requirePermission,
} from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import SupplierAdvanceCancelButton from "../SupplierAdvanceCancelButton";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const SupplierAdvanceDetailPage = async ({ params,
}: { params: Promise<{ id: string }>;
}) => {
  await requirePermission("supplier_advances.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "supplier_advances.update",
  );
  const canCancel = hasPermissionAccess(role, permissions, "supplier_advances.cancel",
  );
  const { id } = await params;

  const advance = await db.supplierAdvance.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      user: { select: { name: true } },
      cashBankAccount: { select: { id: true, name: true, code: true } },
      supplierPayments: {
        include: {
          payment: {
            select: {
              id: true,
              paymentNo: true,
              paymentDate: true,
              status: true,
            },
          },
        },
        orderBy: [{ payment: { paymentDate: "desc" } }],
      },
      refunds: { orderBy: { refundDate: "desc" } },
  },
  });

  if (!advance) notFound();
  const [activityEvents, advancePayments] = await Promise.all([
    getDocumentActivityTimeline("SupplierAdvance", advance.id),
    db.documentPayment.findMany({
      where: { docType: "SUPPLIER_ADVANCE", docId: advance.id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: {
        amount: true,
        cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true },
        },
      },
    }),
  ]);
  const activeRefunds = advance.refunds.filter(
    (refund) => refund.status === "ACTIVE",
  );
  const usedAmount = advance.supplierPayments
    .filter((item) => item.payment.status === "ACTIVE")
    .reduce((sum, item) => sum + Number(item.paidAmount), 0);
  const refundedAmount = activeRefunds.reduce(
    (sum, refund) => sum + Number(refund.refundAmount),
    0,
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/supplier-advances"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> เงินมัดจำซัพพลายเออร์
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{advance.advanceNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">รายละเอียดเงินมัดจำซัพพลายเออร์</h1>
            {advance.status === "CANCELLED" ? (
              <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                ใช้งาน
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {advance.status === "ACTIVE" && canUpdate ? (
              <Link
                href={`/admin/supplier-advances/${advance.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
              >
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {advance.status === "ACTIVE" && canCancel ? (
              <SupplierAdvanceCancelButton advanceId={advance.id} docNo={advance.advanceNo}
                disabledReason={
                  activeRefunds.length
                    ? `ถูกอ้างอิงใน ${activeRefunds.map((refund) => refund.refundNo).join(", ")}`
                    : null
                }
              />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">เลขที่เอกสาร</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{advance.advanceNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">วันที่เอกสาร</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {formatDateThai(advance.advanceDate)}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ซัพพลายเออร์</p>
            <Link
              href={`/admin/suppliers/${advance.supplier.id}`}
              className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300 dark:hover:text-sky-200"
            >
              {advance.supplier.name}
            </Link>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ช่องทางจ่าย</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{paymentMethodLabel[advance.paymentMethod]}</p>
          </div>
          {advancePayments.length > 1 ? (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">บัญชีจ่ายเงิน ({advancePayments.length} ช่องทาง)</p>
              <div className="space-y-1">
                {advancePayments.map((row, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5 dark:border-white/10"
                  >
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      {row.cashBankAccount.name}
                      <span className="ml-1 text-xs font-normal text-gray-500 dark:text-slate-400">
                        {row.cashBankAccount.type === "BANK" ? (row.cashBankAccount.bankName ?? "ธนาคาร")
                          : "เงินสด"}
                        {row.cashBankAccount.accountNo ? ` | ${row.cashBankAccount.accountNo}` : ""}
                      </span>
                    </span>
                    <span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                      {Number(row.amount).toLocaleString("th-TH", { minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">บัญชีจ่ายเงิน</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">
                {advance.cashBankAccount ? `${advance.cashBankAccount.code} - ${advance.cashBankAccount.name}` : "-"}
              </p>
            </div>
          )}
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{advance.user?.name ?? "-"}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ยอดมัดจำ</p>
            <p className="font-kanit text-lg font-bold text-[#1e3a5f] dark:text-sky-300">
              {Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2,
              })}{" "}
              บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ยอดคงเหลือ</p>
            <p className="font-kanit text-lg font-bold text-amber-700 dark:text-amber-400">
              {Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2,
              })}{" "}
              บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">
              ใช้จ่ายชำระแล้ว
            </p>
            <p className="font-kanit text-lg font-bold text-sky-700 dark:text-sky-300">
              {usedAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}{" "}
              บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">
              รับคืนแล้ว
            </p>
            <p className="font-kanit text-lg font-bold text-emerald-700 dark:text-emerald-300">
              {refundedAmount.toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })}{" "}
              บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">
              จำนวนเอกสารที่อ้างอิง</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{advance.supplierPayments.length} รายการ</p>
          </div>
          {advance.note ? (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="text-gray-700 dark:text-slate-300">{advance.note}</p>
            </div>
          ) : null}
          {advance.status === "CANCELLED" && advance.cancelNote ? (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">เหตุผลยกเลิก</p>
              <p className="text-red-600 dark:text-rose-400">{advance.cancelNote}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          CN รับคืนเงินมัดจำ
        </h2>
        {advance.refunds.length ? (
          <div className="space-y-2">
            {advance.refunds.map((refund) => (
              <div
                key={refund.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm dark:border-white/10"
              >
                <Link
                  href={`/admin/supplier-advance-refunds/${refund.id}`}
                  className="font-mono text-[#1e3a5f] dark:text-sky-300"
                >
                  {refund.refundNo}
                </Link>
                <span className="dark:text-slate-300">
                  {formatDateThai(refund.refundDate)}
                </span>
                <span className="font-medium dark:text-slate-100">
                  {Number(refund.refundAmount).toLocaleString("th-TH", {
                    minimumFractionDigits: 2,
                  })}
                </span>
                <AdminStatusBadge
                  tone={refund.status === "ACTIVE" ? "success" : "danger"}
                >
                  {refund.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}
                </AdminStatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">
            ยังไม่มี CN รับคืนเงินมัดจำ
          </p>
        )}
      </div>

      <DocumentActivityTimeline events={activityEvents} />

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          เอกสารจ่ายชำระที่หักเงินมัดจำนี้
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่เอกสารจ่าย</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">ยอดที่หัก</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {advance.supplierPayments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-gray-400 dark:text-slate-500">
                    ยังไม่มีเอกสารจ่ายชำระที่อ้างอิงเงินมัดจำนี้
                  </td>
                </tr>
              ) : (
                advance.supplierPayments.map((item) => (
                  <tr key={item.id} className="border-t border-gray-50 dark:border-white/5">
                    <td className="px-3 py-2 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                      <Link href={`/admin/supplier-payments/${item.payment.id}`} className="hover:underline">
                        {item.payment.paymentNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">
                      {formatDateThai(item.payment.paymentDate)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">
                      {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {item.payment.status === "CANCELLED" ? (
                        <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
                      ) : (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          ใช้งาน
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SupplierAdvanceDetailPage;
