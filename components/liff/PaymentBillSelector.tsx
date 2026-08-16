"use client";

import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";

import PaymentQrButton from "@/components/liff/PaymentQrButton";

type BillOption = {
  id: string;
  saleNo: string;
  amountRemain: number;
  overdue: boolean;
  dueDateLabel: string;
};

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PaymentBillSelector({ bills }: { bills: BillOption[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTotal = bills.reduce(
    (sum, bill) => sum + (selectedSet.has(bill.id) ? bill.amountRemain : 0),
    0,
  );
  const allSelected = bills.length > 0 && selectedIds.length === bills.length;

  function toggleBill(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  if (bills.length === 1) {
    const bill = bills[0];
    return (
      <div
        className={
          bill.overdue
            ? "rounded-2xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/40"
            : "rounded-2xl border border-blue-100 bg-blue-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
        }
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
              {bill.overdue ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400" />
              ) : null}
              ชำระบิล {bill.saleNo}
            </p>
            <p
              className={
                bill.overdue
                  ? "text-xs font-bold text-rose-700 dark:text-rose-400"
                  : "text-xs text-slate-500 dark:text-slate-400"
              }
            >
              {bill.overdue
                ? `เลยกำหนดชำระ ${bill.dueDateLabel}`
                : `ครบกำหนด ${bill.dueDateLabel} · ระบบเลือกให้แล้ว`}
            </p>
          </div>
          <span
            className={
              bill.overdue
                ? "shrink-0 text-sm font-bold text-rose-700 dark:text-rose-400"
                : "shrink-0 text-sm font-bold text-amber-700 dark:text-amber-300"
            }
          >
            {formatMoney(bill.amountRemain)} บาท
          </span>
        </div>
        <PaymentQrButton mode="selected" saleIds={[bill.id]} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900 dark:text-slate-100">เลือกเฉพาะบิลที่ต้องการชำระ</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">เลือกได้มากกว่าหนึ่งบิล ระบบจะรวมยอดให้</p>
        </div>
        <button
          type="button"
          onClick={() => setSelectedIds(allSelected ? [] : bills.map((bill) => bill.id))}
          className="shrink-0 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-800 dark:border-slate-600 dark:bg-slate-900 dark:text-sky-300"
        >
          {allSelected ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
        </button>
      </div>

      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {bills.map((bill) => (
          <label
            key={bill.id}
            className={
              bill.overdue
                ? "flex cursor-pointer items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-800 dark:bg-rose-950/40"
                : "flex cursor-pointer items-center gap-3 rounded-xl border border-transparent bg-white px-3 py-2 dark:bg-slate-900"
            }
          >
            <input
              type="checkbox"
              checked={selectedSet.has(bill.id)}
              onChange={() => toggleBill(bill.id)}
              className={`h-4 w-4 rounded border-slate-300 ${bill.overdue ? "accent-rose-700" : "accent-blue-700"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {bill.overdue ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-400" />
                ) : null}
                <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">{bill.saleNo}</span>
              </span>
              <span
                className={
                  bill.overdue
                    ? "mt-0.5 block text-[11px] font-bold text-rose-700 dark:text-rose-400"
                    : "mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400"
                }
              >
                {bill.overdue ? `เลยกำหนด ${bill.dueDateLabel}` : `ครบกำหนด ${bill.dueDateLabel}`}
              </span>
            </span>
            <span
              className={
                bill.overdue
                  ? "shrink-0 text-xs font-bold text-rose-700 dark:text-rose-400"
                  : "shrink-0 text-xs font-bold text-amber-700 dark:text-amber-300"
              }
            >
              {formatMoney(bill.amountRemain)} บาท
            </span>
          </label>
        ))}
      </div>

      {selectedIds.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-600 dark:text-slate-300">เลือก {selectedIds.length} บิล</span>
            <span className="font-bold text-slate-950 dark:text-slate-100">{formatMoney(selectedTotal)} บาท</span>
          </div>
          {allSelected ? (
            <PaymentQrButton mode="total" />
          ) : (
            <PaymentQrButton mode="selected" saleIds={selectedIds} />
          )}
        </div>
      ) : null}
    </div>
  );
}
