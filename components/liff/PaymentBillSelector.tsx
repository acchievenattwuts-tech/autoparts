"use client";

import { useMemo, useState } from "react";

import PaymentQrButton from "@/components/liff/PaymentQrButton";

type BillOption = {
  id: string;
  saleNo: string;
  amountRemain: number;
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
      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-slate-900 dark:text-slate-100">ชำระบิล {bill.saleNo}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">มีบิลค้างชำระ 1 ใบ ระบบเลือกให้แล้ว</p>
          </div>
          <span className="shrink-0 text-sm font-bold text-amber-700 dark:text-amber-300">
            {formatMoney(bill.amountRemain)} บาท
          </span>
        </div>
        <PaymentQrButton mode="selected" saleIds={[bill.id]} />
        <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
          ยอดใน QR จะตรวจใหม่จาก server อีกครั้งก่อนสร้าง
        </p>
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
            className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 dark:bg-slate-900"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(bill.id)}
              onChange={() => toggleBill(bill.id)}
              className="h-4 w-4 rounded border-slate-300 accent-blue-700"
            />
            <span className="min-w-0 flex-1 font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              {bill.saleNo}
            </span>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
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
          <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
            ยอดใน QR จะตรวจใหม่จาก server อีกครั้งก่อนสร้าง
          </p>
        </div>
      ) : null}
    </div>
  );
}
