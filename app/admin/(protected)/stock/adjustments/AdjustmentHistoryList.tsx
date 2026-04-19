"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelAdjustment } from "./actions";
import { formatDateThai } from "@/lib/th-date";

interface AdjItem {
  id:        string;
  qtyAdjust: number;
  reason:    string | null;
  product:   { code: string; name: string };
}

interface AdjDoc {
  id:          string;
  adjustNo:    string;
  adjustDate:  string;
  note:        string | null;
  status:      string;
  cancelledAt: string | null;
  cancelNote:  string | null;
  user:        { name: string };
  items:       AdjItem[];
}

const AdjustmentHistoryList = ({
  adjustments,
  canCancel,
}: {
  adjustments: AdjDoc[];
  canCancel: boolean;
}) => {
  const router = useRouter();

  if (adjustments.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
        ยังไม่มีประวัติการปรับสต็อก
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {adjustments.map((adj) => (
        <div
          key={adj.id}
          className={`bg-white rounded-xl shadow-sm border overflow-hidden ${
            adj.status === "CANCELLED" ? "border-red-200 opacity-60" : "border-gray-100"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm font-semibold text-[#1e3a5f]">{adj.adjustNo}</span>
              <span className="text-sm text-gray-500">
                {formatDateThai(adj.adjustDate)}
              </span>
              {adj.status === "CANCELLED" ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  ยกเลิกแล้ว{adj.cancelNote ? ` — ${adj.cancelNote}` : ""}
                </span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  ใช้งาน
                </span>
              )}
              {adj.note && <span className="text-sm text-gray-400">— {adj.note}</span>}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-400">โดย {adj.user.name}</span>
              {adj.status === "ACTIVE" && canCancel && (
                <CancelDocButton
                  docId={adj.id}
                  docNo={adj.adjustNo}
                  idFieldName="adjustmentId"
                  cancelAction={cancelAdjustment}
                  onSuccess={() => router.refresh()}
                />
              )}
            </div>
          </div>

          {/* Items */}
          <div className="divide-y divide-gray-50">
            {adj.items.map((item) => {
              const isIn = item.qtyAdjust > 0;
              return (
                <div key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">[{item.product.code}]</span>
                    <span className="text-gray-700">{item.product.name}</span>
                    {item.reason && (
                      <span className="text-gray-400 text-xs">— {item.reason}</span>
                    )}
                  </div>
                  <span className={`font-medium ${isIn ? "text-green-600" : "text-red-500"}`}>
                    {isIn ? "+" : ""}
                    {item.qtyAdjust.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} หน่วยหลัก
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AdjustmentHistoryList;
