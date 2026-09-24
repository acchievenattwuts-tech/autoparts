"use client";

import { Lock } from "lucide-react";
import type { LotSubRow } from "@/lib/lot-control-client";
import { formatDateThai } from "@/lib/th-date";

type SaleLockedLineRowProps = {
  index: number;
  productLabel: string;
  supplierLabel: string | null;
  moreDetail: string;
  unitName: string;
  qty: number;
  unitListPrice: number;
  salePrice: number;
  warrantyDays: number;
  lotItems: LotSubRow[];
  isLotControl: boolean;
  claimNos: string[];
  reason: string;
};

const LOCKED_COLUMN_COUNT = 10;

const money = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Read-only rendering of a sale line held by a warranty claim. The line is sent
 * back to the server unchanged; updateSale refuses any change to it anyway.
 */
const SaleLockedLineRow = ({
  index,
  productLabel,
  supplierLabel,
  moreDetail,
  unitName,
  qty,
  unitListPrice,
  salePrice,
  warrantyDays,
  lotItems,
  isLotControl,
  claimNos,
  reason,
}: SaleLockedLineRowProps) => {
  const discountPerUnit = round2(Math.max(0, unitListPrice - salePrice));
  const cellCls = "py-2 px-2 text-sm text-gray-700 dark:text-slate-200";

  return (
    <>
      <tr className="border-b border-gray-50 bg-slate-50 dark:border-white/5 dark:bg-slate-800/40" title={reason}>
        <td className="py-2 px-2 text-center text-sm text-gray-500 dark:text-slate-400">{index + 1}</td>
        <td className="py-2 px-2">
          <p className="font-medium text-gray-900 dark:text-slate-100">{productLabel}</p>
          {supplierLabel ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">ซัพพลายเออร์: {supplierLabel}</p>
          ) : null}
          {moreDetail ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{moreDetail}</p>
          ) : null}
          <p className="mt-1 inline-flex flex-wrap items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-200">
            <Lock size={11} aria-hidden="true" />
            ล็อกตามใบเคลม {claimNos.join(", ")}
          </p>
        </td>
        <td className={cellCls}>{unitName}</td>
        <td className={cellCls}>{qty.toLocaleString("th-TH", { maximumFractionDigits: 4 })}</td>
        <td className={cellCls}>{money(unitListPrice)}</td>
        <td className={`${cellCls} ${discountPerUnit > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{money(discountPerUnit)}</td>
        <td className={`${cellCls} font-medium`}>{money(salePrice)}</td>
        <td className={cellCls}>{warrantyDays}</td>
        <td className="py-2 px-2 text-right font-medium text-gray-700 dark:text-slate-200">{money(qty * salePrice)}</td>
        <td className="py-2 px-2 text-center text-amber-600 dark:text-amber-300">
          <Lock size={15} aria-label={reason} />
        </td>
      </tr>
      {isLotControl ? (
        <tr className="bg-amber-50/60 dark:bg-amber-500/10">
          <td colSpan={LOCKED_COLUMN_COUNT} className="px-4 pb-3 pt-1">
            <div className="flex flex-wrap gap-2">
              {lotItems.length === 0 ? (
                <span className="text-xs italic text-gray-400 dark:text-slate-500">ไม่มีข้อมูล Lot</span>
              ) : (
                lotItems.map((lot) => (
                  <span
                    key={lot.lotNo}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs dark:border-amber-400/30 dark:bg-slate-800"
                  >
                    <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">{lot.lotNo}</span>
                    <span className="text-gray-500 dark:text-slate-400">จำนวน</span>
                    <span className="font-medium text-gray-700 dark:text-slate-200">{lot.qty}</span>
                    {lot.expDate ? (
                      <span className="text-gray-500 dark:text-slate-400">EXP {formatDateThai(lot.expDate)}</span>
                    ) : null}
                  </span>
                ))
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

export default SaleLockedLineRow;
