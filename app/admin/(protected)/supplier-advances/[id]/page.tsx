export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { PaymentMethod } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import SupplierAdvanceCancelButton from "../SupplierAdvanceCancelButton";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const SupplierAdvanceDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("supplier_advances.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "supplier_advances.update");
  const canCancel = hasPermissionAccess(role, permissions, "supplier_advances.cancel");
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
    },
  });

  if (!advance) notFound();

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
        <span className="text-sm font-medium text-gray-700">{advance.advanceNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">รายละเอียดเงินมัดจำซัพพลายเออร์</h1>
            {advance.status === "CANCELLED" ? (
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                ยกเลิกแล้ว
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                ใช้งาน
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {advance.status === "ACTIVE" && canUpdate ? (
              <Link
                href={`/admin/supplier-advances/${advance.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
              >
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {advance.status === "ACTIVE" && canCancel ? (
              <SupplierAdvanceCancelButton advanceId={advance.id} docNo={advance.advanceNo} />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500">เลขที่เอกสาร</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{advance.advanceNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">วันที่เอกสาร</p>
            <p className="font-medium text-gray-900">
              {new Date(advance.advanceDate).toLocaleDateString("th-TH-u-ca-gregory", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ซัพพลายเออร์</p>
            <Link href={`/admin/suppliers/${advance.supplier.id}`} className="font-medium text-[#1e3a5f] hover:underline">
              {advance.supplier.name}
            </Link>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ช่องทางจ่าย</p>
            <p className="font-medium text-gray-900">{paymentMethodLabel[advance.paymentMethod]}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">บัญชีจ่ายเงิน</p>
            <p className="font-medium text-gray-900">
              {advance.cashBankAccount ? `${advance.cashBankAccount.code} - ${advance.cashBankAccount.name}` : "-"}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{advance.user?.name ?? "-"}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ยอดมัดจำ</p>
            <p className="font-kanit text-lg font-bold text-[#1e3a5f]">
              {Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ยอดคงเหลือ</p>
            <p className="font-kanit text-lg font-bold text-amber-700">
              {Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">จำนวนเอกสารที่อ้างอิง</p>
            <p className="font-medium text-gray-900">{advance.supplierPayments.length} รายการ</p>
          </div>
          {advance.note ? (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500">หมายเหตุ</p>
              <p className="text-gray-700">{advance.note}</p>
            </div>
          ) : null}
          {advance.status === "CANCELLED" && advance.cancelNote ? (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500">เหตุผลยกเลิก</p>
              <p className="text-red-600">{advance.cancelNote}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f]">
          เอกสารจ่ายชำระที่หักเงินมัดจำนี้
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">เลขที่เอกสารจ่าย</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">วันที่</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">ยอดที่หัก</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {advance.supplierPayments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-gray-400">
                    ยังไม่มีเอกสารจ่ายชำระที่อ้างอิงเงินมัดจำนี้
                  </td>
                </tr>
              ) : (
                advance.supplierPayments.map((item) => (
                  <tr key={item.id} className="border-t border-gray-50">
                    <td className="px-3 py-2 font-mono font-medium text-[#1e3a5f]">
                      <Link href={`/admin/supplier-payments/${item.payment.id}`} className="hover:underline">
                        {item.payment.paymentNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(item.payment.paymentDate).toLocaleDateString("th-TH-u-ca-gregory", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2">
                      {item.payment.status === "CANCELLED" ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          ยกเลิกแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
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
