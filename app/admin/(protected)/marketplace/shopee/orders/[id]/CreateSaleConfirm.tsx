"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ReceiptText } from "lucide-react";

import { autoAllocateLots, type LotAvailableJSON, type LotSubRow } from "@/lib/lot-control-client";

import { createSaleFromOrderAction } from "../actions";

const EPS = 0.0001;

export type LotLine = {
  key: string; // `${itemId}::${modelId}`
  productName: string;
  qty: number; // in display unit
  unitName: string;
  unitScale: number;
  available: LotAvailableJSON[];
};

type QtyMap = Record<string, Record<string, string>>; // lineKey -> lotNo -> qty(string)

const CreateSaleConfirm = ({
  orderImportId,
  lotLines,
}: {
  orderImportId: string;
  lotLines: LotLine[];
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialQty = useMemo<QtyMap>(() => {
    const map: QtyMap = {};
    for (const line of lotLines) {
      const auto = autoAllocateLots(line.available, line.qty, line.unitScale);
      const row: Record<string, string> = {};
      for (const lot of auto) row[lot.lotNo] = String(lot.qty);
      map[line.key] = row;
    }
    return map;
  }, [lotLines]);

  const [qtyMap, setQtyMap] = useState<QtyMap>(initialQty);

  const setQty = (lineKey: string, lotNo: string, value: string) =>
    setQtyMap((prev) => ({ ...prev, [lineKey]: { ...prev[lineKey], [lotNo]: value } }));

  const lineSelectedTotal = (lineKey: string): number =>
    Object.values(qtyMap[lineKey] ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const allValid = lotLines.every((line) => Math.abs(lineSelectedTotal(line.key) - line.qty) < EPS);

  const buildSelections = (): Record<string, LotSubRow[]> => {
    const out: Record<string, LotSubRow[]> = {};
    for (const line of lotLines) {
      const rows: LotSubRow[] = [];
      for (const lot of line.available) {
        const qty = Number(qtyMap[line.key]?.[lot.lotNo] ?? 0);
        if (qty > 0) {
          rows.push({
            lotNo: lot.lotNo,
            qty,
            unitCost: lot.unitCost,
            mfgDate: lot.mfgDate ?? "",
            expDate: lot.expDate ?? "",
          });
        }
      }
      out[line.key] = rows;
    }
    return out;
  };

  const handleConfirm = () => {
    setError(null);
    if (lotLines.length > 0 && !allValid) {
      setError("กรุณาเลือก lot ให้ครบตามจำนวนของแต่ละรายการ");
      return;
    }
    const lotSelections = lotLines.length > 0 ? buildSelections() : undefined;
    startTransition(async () => {
      const res = await createSaleFromOrderAction(orderImportId, lotSelections);
      if (res.ok) {
        router.push(`/admin/sales/${res.saleId}`);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {lotLines.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
          <h3 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">เลือก Lot (สินค้าคุม lot)</h3>
          <div className="mt-3 space-y-4">
            {lotLines.map((line) => {
              const selected = lineSelectedTotal(line.key);
              const ok = Math.abs(selected - line.qty) < EPS;
              return (
                <div key={line.key} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{line.productName}</p>
                    <p className={`text-xs font-medium ${ok ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
                      ต้องการ {line.qty} {line.unitName} · เลือกแล้ว {selected}
                    </p>
                  </div>
                  {line.available.length === 0 ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">ไม่มี lot คงเหลือสำหรับสินค้านี้</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {line.available.map((lot) => (
                        <div key={lot.lotNo} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 text-slate-600 dark:text-slate-300">
                            {lot.lotNo}
                            <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                              (คงเหลือ {(lot.qtyOnHand / line.unitScale).toLocaleString("th-TH")} {line.unitName}
                              {lot.expDate ? `, EXP ${lot.expDate}` : ""})
                            </span>
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={qtyMap[line.key]?.[lot.lotNo] ?? ""}
                            onChange={(e) => setQty(line.key, lot.lotNo, e.target.value)}
                            className="h-8 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right text-sm text-slate-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isPending || (lotLines.length > 0 && !allValid)}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
        ยืนยันสร้างบิลขาย
      </button>
      {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
};

export default CreateSaleConfirm;
