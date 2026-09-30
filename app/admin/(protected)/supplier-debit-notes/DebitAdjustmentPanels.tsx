import Link from "next/link";
import type { JSX } from "react";
import { ArrowDownRight, Banknote, SlidersHorizontal } from "lucide-react";
import { formatDateThai } from "@/lib/th-date";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

/** "ปรับยอด DN" panels of the DN detail page (R5-D / ก3): the parent's adjustment list and a reduction's settlement. */

export type DebitAdjustmentRow = {
  id: string; debitNo: string; status: string; postingDate: Date; netAmount: number; amountRemain: number;
};

const money = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedMoney = (value: number): string => `${value < 0 ? "-" : "+"}${money(Math.abs(value))}`;
const cardCls = "rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]";
const headingCls = "font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300";

/** The parent DN's adjustments and its amount after the ACTIVE ones. Hidden until the DN has one. */
export const DebitAdjustmentList = ({ netAmount, adjustments }: { netAmount: number; adjustments: DebitAdjustmentRow[] }): JSX.Element | null => {
  if (adjustments.length === 0) return null;
  const adjustedNet = adjustments.filter((row) => row.status === "ACTIVE").reduce((sum, row) => sum + row.netAmount, netAmount);
  return (
    <section className={cardCls}>
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={`${headingCls} flex items-center gap-2`}><SlidersHorizontal size={18} /> เอกสารปรับยอด DN</h2>
        <p className="text-sm text-gray-600 dark:text-slate-400">ยอด DN หลังปรับ <span className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">{money(adjustedNet)}</span> บาท</p>
      </div>
      <div className="space-y-2">
        {adjustments.map((row) => (
          <Link key={row.id} href={`/admin/supplier-debit-notes/${row.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3 text-sm transition-colors hover:border-[#1e3a5f]/30 hover:bg-gray-50 dark:border-white/10 dark:hover:border-sky-400/30 dark:hover:bg-white/5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{row.debitNo}</span>
              <span className="text-gray-500 dark:text-slate-400">{formatDateThai(row.postingDate)}</span>
              {row.status === "ACTIVE" ? <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge> : <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>}
            </span>
            <span className={`font-medium tabular-nums ${row.status !== "ACTIVE" ? "text-gray-400 line-through dark:text-slate-500"
              : row.netAmount < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-300"}`}>{signedMoney(row.netAmount)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
};

type SettlementProps = {
  parentDebitNo: string; netAmount: number; active: boolean; creditRemain: number; consumed: number; refunded: number;
  settlementType: "SUPPLIER_CREDIT" | "CASH_REFUND" | null; accountName: string | null;
};

/**
 * Where a reduction went: first the parent's outstanding balance, then the excess as supplier credit or a cash
 * refund. The split is derived from the stored balances (lib/supplier-debit-balance.ts).
 */
export const DebitAdjustmentSettlement = ({ parentDebitNo, netAmount, active, creditRemain, consumed, refunded,
  settlementType, accountName }: SettlementProps): JSX.Element => {
  const boxCls = "mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-400/30 dark:bg-teal-500/10 dark:text-teal-200";
  if (!active) {
    return <p className={boxCls}>ยกเลิกแล้ว: คืนยอดค้างให้ DN {parentDebitNo} และกลับรายการรับเงินคืน (ถ้ามี) เรียบร้อย</p>;
  }
  const excess = creditRemain + consumed + refunded;
  const applied = Math.max(0, Math.abs(netAmount) - excess);
  return (
    <div className={`${boxCls} space-y-1`}>
      <p className="flex items-start gap-2"><ArrowDownRight size={16} className="mt-0.5 shrink-0" />
        ลดยอดค้างจ่ายของ DN {parentDebitNo} <span className="font-semibold tabular-nums">{money(applied)}</span> บาท</p>
      {excess > 0 && settlementType === "SUPPLIER_CREDIT" ? (
        <p className="flex items-start gap-2"><Banknote size={16} className="mt-0.5 shrink-0" />
          ส่วนที่ลดเกินยอดค้าง {money(excess)} บาท เก็บเป็นเครดิตซัพพลายเออร์ · ใช้แล้ว {money(consumed)} · คงเหลือ {money(creditRemain)} บาท</p>
      ) : null}
      {excess > 0 && settlementType === "CASH_REFUND" ? (
        <p className="flex items-start gap-2"><Banknote size={16} className="mt-0.5 shrink-0" />
          ส่วนที่ลดเกินยอดค้าง {money(refunded)} บาท ซัพพลายเออร์คืนเงินเข้าบัญชี {accountName ?? "-"}</p>
      ) : null}
    </div>
  );
};
