export const dynamic = "force-dynamic";

import { CheckCircle2, PieChart } from "lucide-react";
import { notFound } from "next/navigation";

import NavLink from "@/components/shared/NavLink";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { DocStatus, RetainedProfitMode } from "@/lib/generated/prisma";
import { formatPeriodLabel } from "@/lib/profit-distribution";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai, formatDateTimeThai } from "@/lib/th-date";

import CancelDistributionButton from "../CancelDistributionButton";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CARD_CLASS =
  "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900";

export default async function ProfitDistributionDetailPage({ params, searchParams }: PageProps) {
  await requirePermission("profit_distributions.view");

  const [{ id }, query, { session, role, permissions }] = await Promise.all([
    params,
    searchParams,
    getSessionPermissionContext(),
  ]);

  const canViewAll = hasPermissionAccess(role, permissions, "profit_distributions.view_all");
  const canCancel = hasPermissionAccess(role, permissions, "profit_distributions.cancel");

  const distribution = await db.profitDistribution.findUnique({
    where: { id },
    include: {
      cashBankAccount: { select: { code: true, name: true } },
      user: { select: { name: true } },
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          partnerUserId: true,
          partnerName: true,
          sharePercent: true,
          shareAmount: true,
          note: true,
        },
      },
    },
  });

  if (!distribution) notFound();

  const periodLabel = formatPeriodLabel(distribution.periodYear, distribution.periodMonth);
  const isCancelled = distribution.status === DocStatus.CANCELLED;
  const visibleItems = canViewAll
    ? distribution.items
    : distribution.items.filter((item) => item.partnerUserId === session.user.id);

  // A partner with no line on this document and no view_all has nothing to see.
  if (!canViewAll && visibleItems.length === 0) notFound();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2">
        <NavLink
          href="/admin/profit-distributions"
          className="text-sm text-gray-500 hover:underline dark:text-slate-400"
        >
          ← กลับหน้าแบ่งกำไรผู้ร่วมทุน
        </NavLink>
        <div className="flex flex-wrap items-center gap-3">
          <PieChart size={22} className="text-[#1e3a5f] dark:text-sky-300" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            {distribution.distributionNo}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isCancelled
                ? "bg-rose-100 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
            }`}
          >
            {isCancelled ? "ยกเลิกแล้ว" : "ใช้งานอยู่"}
          </span>
        </div>
      </div>

      {query.created === "1" && !isCancelled ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>
            ประกาศแบ่งกำไรงวด {periodLabel} สำเร็จ — เอกสารเลขที่{" "}
            <span className="font-mono font-semibold">{distribution.distributionNo}</span>
          </span>
        </div>
      ) : null}

      {isCancelled ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100">
          ยกเลิกเมื่อ {distribution.cancelledAt ? formatDateTimeThai(distribution.cancelledAt) : "-"}
          {distribution.cancelNote ? ` · เหตุผล: ${distribution.cancelNote}` : ""}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${CARD_CLASS} lg:col-span-1`}>
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            ข้อมูลเอกสาร
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">งวดที่แบ่ง</dt>
              <dd className="font-medium text-gray-900 dark:text-slate-100">{periodLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">วันที่โอนเงิน</dt>
              <dd className="text-gray-800 dark:text-slate-200">
                {formatDateThai(distribution.payDate)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">จ่ายจากบัญชี</dt>
              <dd className="text-right text-gray-800 dark:text-slate-200">
                {distribution.cashBankAccount.code} {distribution.cashBankAccount.name}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ประกาศโดย</dt>
              <dd className="text-gray-800 dark:text-slate-200">{distribution.user.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ประกาศเมื่อ</dt>
              <dd className="text-gray-800 dark:text-slate-200">
                {formatDateTimeThai(distribution.declaredAt)}
              </dd>
            </div>
            {distribution.note ? (
              <div className="border-t border-gray-100 pt-2 dark:border-white/10">
                <dt className="text-xs text-gray-500 dark:text-slate-400">หมายเหตุ</dt>
                <dd className="mt-1 text-gray-800 dark:text-slate-200">{distribution.note}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-500 dark:bg-white/5 dark:text-slate-400">
            เอกสารนี้ตัดเงินสดตามวันที่โอน แต่ไม่ถูกบันทึกเป็นค่าใช้จ่าย
            จึงไม่กระทบกำไรสุทธิของเดือนใดทั้งสิ้น
          </p>
        </section>

        <section className={`${CARD_CLASS} lg:col-span-2`}>
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            ที่มาของยอดที่แบ่ง
          </h2>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
            ตัวเลขทั้งหมดถูก snapshot ไว้ ณ วันที่ประกาศ และจะไม่เปลี่ยนอีก
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ยอดขาย</dt>
              <dd className="text-gray-800 dark:text-slate-200">
                ฿{money(Number(distribution.snapshotSalesAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ต้นทุนขาย</dt>
              <dd className="text-gray-800 dark:text-slate-200">
                ฿{money(Number(distribution.snapshotCostAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ค่าใช้จ่าย</dt>
              <dd className="text-gray-800 dark:text-slate-200">
                ฿{money(Number(distribution.snapshotExpenseAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 dark:border-white/10">
              <dt className="font-medium text-gray-700 dark:text-slate-200">กำไรสุทธิของงวด</dt>
              <dd className="font-semibold text-gray-900 dark:text-slate-100">
                ฿{money(Number(distribution.snapshotNetProfit))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ยกมาจากเดือนก่อน</dt>
              <dd
                className={
                  Number(distribution.carryForwardAmount) < 0
                    ? "text-rose-600 dark:text-rose-300"
                    : "text-gray-800 dark:text-slate-200"
                }
              >
                {Number(distribution.carryForwardAmount) > 0 ? "+" : ""}
                {money(Number(distribution.carryForwardAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 dark:border-white/10">
              <dt className="font-medium text-gray-700 dark:text-slate-200">ฐานที่แบ่งได้</dt>
              <dd className="font-semibold text-gray-900 dark:text-slate-100">
                ฿{money(Number(distribution.distributableBase))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">แบ่งจริง</dt>
              <dd className="text-lg font-bold text-emerald-600 dark:text-emerald-300">
                ฿{money(Number(distribution.distributedAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">กันไว้ในร้าน</dt>
              <dd className="font-semibold text-sky-600 dark:text-sky-300">
                ฿{money(Number(distribution.retainedAmount))}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 dark:text-slate-400">ปลายทางของยอดที่กันไว้</dt>
              <dd className="text-right text-gray-800 dark:text-slate-200">
                {distribution.retainedMode === RetainedProfitMode.CARRY_FORWARD
                  ? "ยกไปแบ่งเดือนหน้า"
                  : "กันเข้าร้านถาวร"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-500 dark:bg-white/5 dark:text-slate-400">
            {distribution.retainedMode === RetainedProfitMode.CARRY_FORWARD
              ? "ยอดที่กันไว้ถูกยกไปสมทบฐานที่แบ่งได้ของงวดถัดไป จึงยังเป็นเงินที่รอแบ่งอยู่"
              : "ยอดที่กันไว้ถูกเก็บเป็นทุนหมุนเวียนของร้านถาวร จะไม่กลับมาเป็นยอดที่แบ่งได้อีก"}
          </p>
        </section>
      </div>

      <section className={CARD_CLASS}>
        <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
          ส่วนแบ่งรายคน
          {!canViewAll ? (
            <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">
              (แสดงเฉพาะส่วนของคุณ)
            </span>
          ) : null}
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-3">ชื่อ</th>
                <th className="py-2 pr-3 text-right">สัดส่วน</th>
                <th className="py-2 pr-3 text-right">ยอดที่ได้</th>
                <th className="py-2">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td className="py-2.5 pr-3 font-medium text-gray-800 dark:text-slate-100">
                    {item.partnerName}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-600 dark:text-slate-300">
                    {Number(item.sharePercent)}%
                  </td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-gray-900 dark:text-slate-100">
                    ฿{money(Number(item.shareAmount))}
                  </td>
                  <td className="py-2.5 text-gray-500 dark:text-slate-400">{item.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canCancel && !isCancelled ? (
        <div className="flex justify-end">
          <CancelDistributionButton distributionId={distribution.id} />
        </div>
      ) : null}
    </div>
  );
}
