export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";

import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { DocStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, formatDateThai, formatDateTimeThai } from "@/lib/th-date";

import { cancelDeliveryCommissionRun } from "../actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function DeliveryCommissionRunDetailPage({ params }: PageProps) {
  await requirePermission("delivery_commissions.view");
  const { id } = await params;

  const cancelRunAction = async (formData: FormData) => {
    "use server";
    await cancelDeliveryCommissionRun(formData);
  };

  const { role, permissions } = await getSessionPermissionContext();
  const canCancel = hasPermissionAccess(role, permissions, "delivery_commissions.cancel");

  const run = await db.deliveryCommissionRun.findUnique({
    where: { id },
    include: {
      deliveryStaff: { select: { name: true, email: true } },
      cashBankAccount: { select: { code: true, name: true } },
      expenseCode: { select: { code: true, name: true } },
      expense: { select: { id: true, expenseNo: true, status: true } },
      user: { select: { name: true } },
      items: {
        orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
        include: {
          sale: { select: { id: true } },
        },
      },
    },
  });

  if (!run) notFound();

  const isActive = run.status === DocStatus.ACTIVE;
  const shippingFeeTotal = Number(run.shippingFeeTotal);
  const commissionTotal = Number(run.commissionTotal);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/delivery-commissions?tab=payouts"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <ArrowLeft size={14} /> กลับ
          </Link>
          <div className="flex items-center gap-2">
            <Truck size={22} className="text-[#1e3a5f] dark:text-sky-300" />
            <div>
              <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
                รายละเอียดการทำจ่าย {run.runNo}
              </h1>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                สร้างเมื่อ {formatDateTimeThai(run.createdAt)} โดย {run.user.name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isActive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400"
            }`}
          >
            {isActive ? "ใช้งาน" : "ยกเลิก"}
          </span>
          {canCancel && isActive ? (
            <form action={cancelRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="cancelNote" value="ยกเลิกจากหน้ารายละเอียดทำจ่าย" />
              <button
                type="submit"
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-400/10"
              >
                ยกเลิกเอกสาร
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="วันที่จ่าย" value={formatDateOnlyForInput(run.payDate)} />
        <InfoCard label="พนักงานส่ง" value={`${run.deliveryStaff.name}`} sub={run.deliveryStaff.email} />
        <InfoCard label="% ที่ใช้" value={`${Number(run.commissionPercent)}%`} />
        <InfoCard
          label="ช่วงบิล"
          value={`${formatDateThai(run.fromDate)} - ${formatDateThai(run.toDate)}`}
        />
        <InfoCard
          label="บัญชีจ่าย"
          value={`${run.cashBankAccount.code} ${run.cashBankAccount.name}`}
        />
        <InfoCard
          label="รหัสค่าใช้จ่าย"
          value={`${run.expenseCode.code} ${run.expenseCode.name}`}
        />
        <InfoCard
          label="เอกสารค่าใช้จ่าย"
          valueNode={
            run.expense ? (
              <Link
                href={`/admin/expenses/${run.expense.id}`}
                className="font-mono text-[#1e3a5f] hover:underline dark:text-sky-300"
              >
                {run.expense.expenseNo}
              </Link>
            ) : (
              <span className="text-gray-400">-</span>
            )
          }
        />
        <InfoCard label="หมายเหตุ" value={run.note || "-"} />
      </div>

      {!isActive && run.cancelNote ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
          <p className="font-medium">เหตุผลยกเลิก</p>
          <p className="mt-1">{run.cancelNote}</p>
          {run.cancelledAt ? (
            <p className="mt-1 text-xs opacity-70">เมื่อ {formatDateTimeThai(run.cancelledAt)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-white/10">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
            รายการบิลที่อยู่ในเอกสารทำจ่าย ({run.items.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">วันที่ขาย</th>
                <th className="px-4 py-3">เลขที่บิล</th>
                <th className="px-4 py-3">ลูกค้า</th>
                <th className="px-4 py-3 text-right">ค่าส่ง</th>
                <th className="px-4 py-3 text-right">% ที่ใช้</th>
                <th className="px-4 py-3 text-right">ยอดทำจ่าย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {run.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">
                    ไม่มีรายการ
                  </td>
                </tr>
              ) : (
                run.items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-slate-300">
                      {formatDateThai(item.saleDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                      <Link href={`/admin/sales/${item.saleId}`} className="hover:underline">
                        {item.saleNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{item.customerName || "-"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-gray-700 dark:text-slate-200">
                      ฿{money(Number(item.shippingFee))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600 dark:text-slate-300">
                      {Number(item.commissionPercent)}%
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-orange-600 dark:text-orange-300">
                      ฿{money(Number(item.commissionAmount))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-slate-950/40">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-slate-300">
                  รวม
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold text-gray-900 dark:text-slate-100">
                  ฿{money(shippingFeeTotal)}
                </td>
                <td></td>
                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-bold text-orange-600 dark:text-orange-300">
                  ฿{money(commissionTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

interface InfoCardProps {
  label: string;
  value?: string;
  sub?: string | null;
  valueNode?: React.ReactNode;
}

function InfoCard({ label, value, sub, valueNode }: InfoCardProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <p className="text-xs text-gray-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">
        {valueNode ?? value ?? "-"}
      </div>
      {sub ? <p className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">{sub}</p> : null}
    </div>
  );
}
