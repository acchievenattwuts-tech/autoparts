"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton, PeriodLockNotice } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelBF } from "./actions";
import { formatDateThai } from "@/lib/th-date";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";

interface BfDoc {
  id:              string;
  docNo:           string;
  docDate:         string;
  unitName:        string;
  qtyInBase:       number;
  costPerBaseUnit: number;
  note:            string | null;
  status:          string;
  cancelledAt:     string | null;
  cancelNote:      string | null;
  product:         { code: string; name: string };
  disabledReason?: string | null;
  blockReferences?: Array<{ href: string; label: string }>;
  /** The BF's month was already distributed (lib/period-lock.ts). */
  periodLock?: PeriodLockView | null;
}

const BfHistoryTable = ({
  docs,
  canCancel,
}: {
  docs: BfDoc[];
  canCancel: boolean;
}) => {
  const router = useRouter();

  return (
    <div className="bg-white dark:bg-[#101b2e] rounded-xl shadow-sm border border-gray-100 dark:border-white/10 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">เลขที่เอกสาร</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">วันที่</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">สินค้า</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600 dark:text-slate-300">จำนวน (base)</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ราคาทุน/หน่วย</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">หมายเหตุ</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-gray-400 dark:text-slate-400">
                  ยังไม่มีประวัติการบันทึกยอดยกมา
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr
                  key={d.id}
                  id={`document-${d.id}`}
                  className={`border-t border-gray-50 dark:border-white/5 transition-colors ${
                    d.status === "CANCELLED" ? "opacity-50 bg-red-50 dark:bg-red-950/20" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-3 px-4 font-mono text-[#1e3a5f] dark:text-sky-200 font-medium">{d.docNo}</td>
                  <td className="py-3 px-4 text-gray-600 dark:text-slate-300">
                {formatDateThai(d.docDate)}
                  </td>
                  <td className="py-3 px-4 text-gray-700 dark:text-slate-300">
                    <span className="font-mono text-xs text-gray-400 dark:text-slate-400">[{d.product.code}]</span>{" "}
                    {d.product.name}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-gray-900 dark:text-slate-100">
                    {d.qtyInBase.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-700 dark:text-slate-300">
                    {d.costPerBaseUnit.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-3 px-4">
                    {d.status === "CANCELLED" ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                        ยกเลิกแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300">
                        ใช้งาน
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500 dark:text-slate-400 text-xs">
                    {d.status === "CANCELLED" && d.cancelNote
                      ? <span className="text-red-500 dark:text-red-400">ยกเลิก: {d.cancelNote}</span>
                      : (d.note ?? "-")}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {d.status === "ACTIVE" && canCancel && (
                      <PeriodLockCancelButton
                        periodLock={d.periodLock}
                        disabledReason={d.disabledReason ?? undefined}
                        docId={d.id}
                        docNo={d.docNo}
                        idFieldName="bfId"
                        cancelAction={cancelBF}
                        onSuccess={() => router.refresh()}
                      />
                    )}
                    {d.disabledReason && <DocumentMutationBlockedNotice compact message={d.disabledReason} references={d.blockReferences} />}
                    {d.status === "ACTIVE" && <PeriodLockNotice compact lock={d.periodLock} />}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BfHistoryTable;
