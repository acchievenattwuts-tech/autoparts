"use client";

import { AlertTriangle } from "lucide-react";
import type { SaleRoundingRow } from "../sale-rounding";

const RAW_FRACTION_DIGITS = 6;
const MONEY_FRACTION_DIGITS = 2;

const formatRaw = (value: number): string =>
  value.toLocaleString("th-TH", { maximumFractionDigits: RAW_FRACTION_DIGITS });
const formatMoney = (value: number): string =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: MONEY_FRACTION_DIGITS,
    maximumFractionDigits: MONEY_FRACTION_DIGITS,
  });

type SaleRoundingConfirmProps = {
  rows: SaleRoundingRow[];
  /** Product total that will be saved (Σ rounded line amounts). */
  savedTotal: number;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** In-page confirmation (not window.confirm) before saving amounts with more than 2 decimals. */
const SaleRoundingConfirm = ({ rows, savedTotal, disabled, onConfirm, onCancel }: SaleRoundingConfirmProps) => (
  <div
    role="alertdialog"
    aria-labelledby="sale-rounding-confirm-title"
    className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100"
  >
    <div className="flex items-start gap-2">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
      <div className="min-w-0 flex-1 space-y-2">
        <p id="sale-rounding-confirm-title" className="font-semibold">
          ยืนยันการปัดเศษก่อนบันทึก
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          ระบบเก็บราคาต่อหน่วยและจำนวนเงินเป็นทศนิยม 2 ตำแหน่ง รายการต่อไปนี้จะถูกบันทึกเป็นยอดที่ปัดแล้ว
        </p>
        <ul className="space-y-1 text-xs">
          {rows.map((row) => (
            <li
              key={row.lineNo}
              className="rounded-md border border-amber-200 bg-white px-2 py-1.5 dark:border-amber-300/20 dark:bg-slate-900/60"
            >
              <span className="font-medium">แถวที่ {row.lineNo}</span> — {row.productName}
              <div className="mt-0.5 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <span>
                  ราคาต่อหน่วย {formatRaw(row.unitPrice)} → <strong>{formatMoney(row.savedUnitPrice)}</strong>
                </span>
                <span>
                  จำนวนเงิน {formatRaw(row.lineAmount)} → <strong>{formatMoney(row.savedLineAmount)}</strong>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs">
          ยอดรวมสินค้าที่จะบันทึก <strong>{formatMoney(savedTotal)}</strong> บาท
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
          >
            ยืนยันบันทึกด้วยยอดที่ปัดแล้ว
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/30 dark:bg-slate-900 dark:text-amber-100 dark:hover:bg-slate-800"
          >
            กลับไปแก้ไข
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default SaleRoundingConfirm;
