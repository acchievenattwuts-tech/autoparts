import Link from "next/link";

import type {
  PurchaseBudgetDepositRow,
  PurchaseBudgetHistoryRow,
  PurchaseBudgetMovementView,
} from "@/lib/purchase-budget-dashboard";

import { BUDGET_PANEL_CLASS, BUDGET_PANEL_TITLE_CLASS, BUDGET_ROW_CLASS, formatBaht, formatSignedBaht } from "@/components/shared/purchase-budget-ui";

const PANEL_CLASS = `min-w-0 grow basis-[300px] ${BUDGET_PANEL_CLASS}`;

const amountTone = (value: number): string =>
  value > 0
    ? "text-emerald-700 dark:text-emerald-300"
    : value < 0
      ? "text-rose-700 dark:text-rose-300"
      : "text-slate-900 dark:text-slate-100";

export const BudgetMovementsPanel = ({ movements, remaining }: { movements: PurchaseBudgetMovementView; remaining: number }) => (
  <div className={PANEL_CLASS}>
    <p className={BUDGET_PANEL_TITLE_CLASS}>งบขยับเดือนนี้</p>
    <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{movements.periodLabel}</p>
    <div className={BUDGET_ROW_CLASS}>
      <span className="text-slate-600 dark:text-slate-300">{movements.openingLabel}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-900 dark:text-slate-100">{formatBaht(movements.opening)}</span>
    </div>
    {movements.rows.length === 0 ? (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">ยังไม่มีเอกสารที่ทำให้งบขยับในช่วงนี้</p>
    ) : (
      movements.rows.map((row) => (
        <div key={row.key} className={BUDGET_ROW_CLASS}>
          <span className="min-w-0">
            <span className="text-slate-900 dark:text-slate-100">{row.label}</span>
            <span className="text-slate-500 dark:text-slate-400"> · {row.note}</span>
          </span>
          <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${amountTone(row.amount)}`}>{formatSignedBaht(row.amount)}</span>
        </div>
      ))
    )}
    <div className="flex items-baseline justify-between gap-3 pt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
      <span>งบตอนนี้</span>
      <span className="whitespace-nowrap tabular-nums">{formatBaht(remaining)}</span>
    </div>
  </div>
);

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
    <p className={BUDGET_PANEL_TITLE_CLASS}>มัดจำซัพพลายเออร์ที่รอรับของ</p>
    <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">หักงบไว้ก่อน แล้วคืนให้เองเมื่อตัดมัดจำตอนจ่ายชำระ หรือได้เงินมัดจำคืน</p>
    {deposits.length === 0 ? (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">ไม่มีมัดจำที่รอรับของ</p>
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
            <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatBaht(deposit.amount)}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">จ่ายมัดจำ {deposit.advanceDate}</p>
          {deposit.overlapPurchaseNo ? (
            <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              ซัพรายนี้มีใบซื้อค้างจ่าย {deposit.overlapPurchaseNo} ถ้าเป็นของจากมัดจำนี้ ให้ตัดมัดจำตอนจ่ายชำระ งบจะได้ไม่ถูกหักซ้ำ
            </p>
          ) : null}
        </div>
      ))
    )}
    {truncated ? <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">แสดงเฉพาะรายการแรก ดูทั้งหมดที่เมนูมัดจำซัพพลายเออร์</p> : null}
    <div className="flex items-baseline justify-between gap-3 pt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
      <span>รวม</span>
      <span className="whitespace-nowrap tabular-nums">{formatBaht(total)}</span>
    </div>
  </div>
);

export const BudgetHistoryPanel = ({ history, canViewAuditLog }: { history: PurchaseBudgetHistoryRow[]; canViewAuditLog: boolean }) => (
  <div className={PANEL_CLASS}>
    <p className={`mb-1.5 ${BUDGET_PANEL_TITLE_CLASS}`}>ประวัติการปรับเพดาน</p>
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
