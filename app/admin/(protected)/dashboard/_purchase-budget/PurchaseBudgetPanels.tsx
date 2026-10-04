import Link from "next/link";

import type { PurchaseBudgetDepositRow, PurchaseBudgetHistoryRow } from "@/lib/purchase-budget-dashboard";

import { BUDGET_PANEL_CLASS, BUDGET_PANEL_TITLE_CLASS, formatBaht } from "@/components/shared/purchase-budget-ui";

const PANEL_CLASS = `min-w-0 grow basis-[300px] ${BUDGET_PANEL_CLASS}`;

export const BudgetDepositsPanel = ({
  deposits,
  total,
  truncated,
}: {
  deposits: PurchaseBudgetDepositRow[];
  total: number;
  truncated: boolean;
}) => (
  <div className={PANEL_CLASS}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={BUDGET_PANEL_TITLE_CLASS}>มัดจำซัพพลายเออร์คงเหลือ</p>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">ไม่หักงบ</span>
    </div>
    <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">แสดงไว้ดูเท่านั้น งบหักตอนบันทึกใบซื้อรับสินค้า · ยอดคงเหลือลดลงเมื่อตัดมัดจำตอนจ่ายชำระหรือได้เงินคืน</p>
    {deposits.length === 0 ? (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">ไม่มีมัดจำคงเหลือ</p>
    ) : (
      deposits.map((deposit) => (
        <div key={deposit.id} className="border-b border-slate-100 py-2 last:border-b-0 dark:border-white/10">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0">
              <Link href={`/admin/supplier-advances/${deposit.id}`} className="font-semibold text-[#1e3a5f] hover:underline dark:text-sky-300">
                {deposit.advanceNo}
              </Link>
              <span className="text-slate-600 dark:text-slate-300"> · {deposit.supplierName}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatBaht(deposit.remaining)}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            จ่ายมัดจำ {deposit.advanceDate} · {formatBaht(deposit.total)} บาท
            {deposit.used > 0 ? ` · ตัดชำระ/คืนแล้ว ${formatBaht(deposit.used)} บาท` : ""}
          </p>
        </div>
      ))
    )}
    {truncated ? <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">แสดงเฉพาะรายการแรก ดูทั้งหมดที่เมนูมัดจำซัพพลายเออร์</p> : null}
    <div className="flex items-baseline justify-between gap-3 pt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
      <span>คงเหลือรวม</span>
      <span className="whitespace-nowrap tabular-nums">{formatBaht(total)}</span>
    </div>
  </div>
);

export const BudgetHistoryPanel = ({ history, canViewAuditLog }: { history: PurchaseBudgetHistoryRow[]; canViewAuditLog: boolean }) => (
  <div className={PANEL_CLASS}>
    <p className={`mb-1.5 ${BUDGET_PANEL_TITLE_CLASS}`}>ประวัติการปรับงบ</p>
    {history.length === 0 ? (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">ยังไม่มีประวัติ</p>
    ) : (
      history.map((entry) => (
        <div key={entry.id} className="border-b border-slate-100 py-2 last:border-b-0 dark:border-white/10">
          <div className="flex justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{entry.when}</span>
            <span className="truncate">{entry.who}</span>
          </div>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{entry.change}</p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">เหตุผล: {entry.reason}</p>
        </div>
      ))
    )}
    {canViewAuditLog ? (
      <Link href="/admin/audit-log?entityType=PurchaseBudget" className="mt-2 inline-block text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-300">
        ดูประวัติทั้งหมดใน Audit log
      </Link>
    ) : null}
  </div>
);
