"use client";

import { useEffect, useState } from "react";
import { ReceiptText } from "lucide-react";
import { formatDateThai } from "@/lib/th-date";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type ReceiptItem = {
  id: string;
  paidAmount: number;
  receipt: {
    id: string;
    receiptNo: string;
    receiptDate: string;
    paymentMethod: string;
    status: string;
    cancelNote: string | null;
  };
};

interface PaymentHistoryProps {
  saleId: string;
  initialReceipts?: ReceiptItem[];
}

export default function PaymentHistory({ saleId, initialReceipts = [] }: PaymentHistoryProps) {
  const [receipts, setReceipts] = useState<ReceiptItem[]>(initialReceipts);
  const [loading, setLoading] = useState(initialReceipts.length === 0);

  useEffect(() => {
    if (initialReceipts.length > 0) return;

    const fetchReceipts = async () => {
      try {
        const res = await fetch(`/api/liff/orders/${saleId}/receipts`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setReceipts(data);
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    };

    fetchReceipts();
  }, [initialReceipts.length, saleId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <ReceiptText className="h-5 w-5 text-blue-700" />
          <h2 className="font-kanit text-lg font-bold text-slate-950">ประวัติการชำระเงิน</h2>
        </div>
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ReceiptText className="h-5 w-5 text-blue-700" />
        <h2 className="font-kanit text-lg font-bold text-slate-950">ประวัติการชำระเงิน</h2>
      </div>
      {receipts.length === 0 ? (
        <p className="text-sm text-slate-500">ยังไม่มีใบเสร็จรับชำระสำหรับบิลนี้</p>
      ) : (
        <div className="space-y-2">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-xl bg-blue-50/60 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold text-slate-900">{receipt.receipt.receiptNo}</p>
                  <p className="text-xs text-slate-500">{formatDateThai(receipt.receipt.receiptDate)}</p>
                </div>
                <p className="font-bold text-slate-950">{money(receipt.paidAmount)}</p>
              </div>
              {receipt.receipt.status === "CANCELLED" ? (
                <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                  ยกเลิก{receipt.receipt.cancelNote ? `: ${receipt.receipt.cancelNote}` : ""}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
