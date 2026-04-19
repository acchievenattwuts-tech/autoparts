"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCashBankTransfer, createCashBankTransfer } from "../actions";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";

type AccountOption = {
  id: string;
  code: string;
  name: string;
};

type TransferRow = {
  id: string;
  transferNo: string;
  transferDate: string;
  fromAccountCode: string;
  fromAccountName: string;
  toAccountCode: string;
  toAccountName: string;
  amount: number;
  note: string | null;
  status: "ACTIVE" | "CANCELLED";
  cancelNote: string | null;
};

type Props = {
  accounts: AccountOption[];
  transfers: TransferRow[];
  canCreate: boolean;
  canCancel: boolean;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string): string {
  return formatDateThai(value);
}

export default function TransferManager({ accounts, transfers, canCreate, canCancel }: Props) {
  const router = useRouter();
  const [transferDate, setTransferDate] = useState(getThailandDateKey());
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  const resetCancelState = () => {
    setCancelTarget(null);
    setCancelNote("");
  };

  const handleCreate = () => {
    setError("");
    setSuccess("");

    if (!transferDate) {
      setError("กรุณาระบุวันที่โอน");
      return;
    }
    if (!fromAccountId) {
      setError("กรุณาเลือกบัญชีต้นทาง");
      return;
    }
    if (!toAccountId) {
      setError("กรุณาเลือกบัญชีปลายทาง");
      return;
    }
    if (fromAccountId === toAccountId) {
      setError("บัญชีต้นทางและปลายทางต้องไม่ซ้ำกัน");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("กรุณาระบุจำนวนเงินโอนให้มากกว่า 0");
      return;
    }

    const formData = new FormData();
    formData.set("transferDate", transferDate);
    formData.set("fromAccountId", fromAccountId);
    formData.set("toAccountId", toAccountId);
    formData.set("amount", amount);
    formData.set("note", note);

    startTransition(async () => {
      const result = await createCashBankTransfer(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess("บันทึกการโอนเงินแล้ว");
      setFromAccountId("");
      setToAccountId("");
      setAmount("");
      setNote("");
      router.refresh();
    });
  };

  const handleCancel = () => {
    if (!cancelTarget) return;
    if (!cancelNote.trim()) {
      setError("กรุณาระบุเหตุผลที่ยกเลิกรายการโอนเงิน");
      return;
    }

    const formData = new FormData();
    formData.set("cancelNote", cancelNote.trim());

    startTransition(async () => {
      const result = await cancelCashBankTransfer(cancelTarget, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSuccess("ยกเลิกรายการโอนเงินแล้ว");
      resetCancelState();
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {canCreate && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">บันทึกโอนเงินระหว่างบัญชี</h2>
          <p className="text-sm text-gray-500">
            ระบบจะสร้าง movement ออกจากบัญชีต้นทางและ movement เข้าบัญชีปลายทางให้อัตโนมัติ
          </p>

          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">วันที่โอน</label>
              <input type="date" className={inputCls} value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">บัญชีต้นทาง</label>
              <select className={`${inputCls} bg-white`} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                <option value="">เลือกบัญชีต้นทาง</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">บัญชีปลายทาง</label>
              <select className={`${inputCls} bg-white`} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                <option value="">เลือกบัญชีปลายทาง</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">จำนวนเงิน</label>
              <input
                type="number"
                step={0.01}
                className={inputCls}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={(e) => {
                  if (e.target.value.trim() === "") {
                    setAmount("0");
                  }
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">หมายเหตุ</label>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ฝากเงินสดเข้าธนาคาร" />
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : "บันทึกการโอนเงิน"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="font-kanit text-lg font-semibold text-gray-900">ประวัติการโอนเงิน</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">จากบัญชี</th>
                <th className="px-3 py-2 text-left font-medium">ไปบัญชี</th>
                <th className="px-3 py-2 text-right font-medium">จำนวนเงิน</th>
                <th className="px-3 py-2 text-left font-medium">หมายเหตุ</th>
                <th className="px-3 py-2 text-center font-medium">สถานะ</th>
                <th className="px-3 py-2 text-right font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{transfer.transferNo}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(transfer.transferDate)}</td>
                  <td className="px-3 py-2 text-gray-900">
                    <p>{transfer.fromAccountName}</p>
                    <p className="text-xs text-gray-400">{transfer.fromAccountCode}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    <p>{transfer.toAccountName}</p>
                    <p className="text-xs text-gray-400">{transfer.toAccountCode}</p>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(transfer.amount)}</td>
                  <td className="px-3 py-2 text-gray-500">{transfer.note || transfer.cancelNote || "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${transfer.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {transfer.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canCancel && transfer.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          setSuccess("");
                          setCancelTarget(transfer.id);
                          setCancelNote("");
                        }}
                        className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        ยกเลิก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cancelTarget && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">ยืนยันการยกเลิกรายการโอนเงิน</h2>
          <p className="text-sm text-gray-600">ระบุเหตุผลเพื่อเก็บไว้ในประวัติการยกเลิก</p>
          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <input
              className={inputCls}
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              placeholder="เหตุผลที่ยกเลิก"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                ยืนยันยกเลิก
              </button>
              <button
                type="button"
                onClick={resetCancelState}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
