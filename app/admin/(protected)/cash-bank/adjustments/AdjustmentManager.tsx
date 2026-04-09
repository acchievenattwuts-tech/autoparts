"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelCashBankAdjustment,
  createCashBankAdjustment,
  updateCashBankAdjustment,
} from "../actions";

type AccountOption = {
  id: string;
  code: string;
  name: string;
};

type AdjustmentRow = {
  id: string;
  adjustNo: string;
  adjustDate: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
  note: string | null;
  status: "ACTIVE" | "CANCELLED";
  cancelNote: string | null;
};

type Props = {
  accounts: AccountOption[];
  adjustments: AdjustmentRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function AdjustmentManager({ accounts, adjustments, canCreate, canUpdate, canCancel }: Props) {
  const router = useRouter();
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [adjustDate, setAdjustDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  const sortedAdjustments = useMemo(
    () =>
      [...adjustments].sort(
        (left, right) => right.adjustDate.localeCompare(left.adjustDate) || right.adjustNo.localeCompare(left.adjustNo),
      ),
    [adjustments],
  );

  const resetForm = () => {
    setAdjustmentId(null);
    setAdjustDate(new Date().toISOString().slice(0, 10));
    setAccountId("");
    setDirection("IN");
    setAmount("");
    setReason("");
    setNote("");
    setError("");
    setSuccess("");
  };

  const resetCancelState = () => {
    setCancelTarget(null);
    setCancelNote("");
  };

  const handleEdit = (adjustment: AdjustmentRow) => {
    setAdjustmentId(adjustment.id);
    setAdjustDate(adjustment.adjustDate);
    setAccountId(adjustment.accountId);
    setDirection(adjustment.direction);
    setAmount(String(adjustment.amount));
    setReason(adjustment.reason);
    setNote(adjustment.note ?? "");
    setError("");
    setSuccess("");
  };

  const handleSubmit = () => {
    setError("");
    setSuccess("");

    if (!adjustDate) {
      setError("กรุณาระบุวันที่ปรับยอด");
      return;
    }
    if (!accountId) {
      setError("กรุณาเลือกบัญชีที่ต้องการปรับยอด");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("กรุณาระบุจำนวนเงินให้มากกว่า 0");
      return;
    }
    if (!reason.trim()) {
      setError("กรุณาระบุเหตุผลของการปรับยอด");
      return;
    }

    const formData = new FormData();
    formData.set("adjustDate", adjustDate);
    formData.set("accountId", accountId);
    formData.set("direction", direction);
    formData.set("amount", amount);
    formData.set("reason", reason);
    formData.set("note", note);

    startTransition(async () => {
      const result = adjustmentId
        ? await updateCashBankAdjustment(adjustmentId, formData)
        : await createCashBankAdjustment(formData);

      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess(adjustmentId ? "แก้ไขการปรับยอดแล้ว" : "บันทึกการปรับยอดแล้ว");
      router.refresh();
      resetForm();
    });
  };

  const handleCancel = () => {
    if (!cancelTarget) return;
    if (!cancelNote.trim()) {
      setError("กรุณาระบุเหตุผลที่ยกเลิกรายการปรับยอด");
      return;
    }

    const formData = new FormData();
    formData.set("cancelNote", cancelNote.trim());

    startTransition(async () => {
      const result = await cancelCashBankAdjustment(cancelTarget, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSuccess("ยกเลิกรายการปรับยอดแล้ว");
      resetCancelState();
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {(canCreate || (adjustmentId && canUpdate)) && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-kanit text-lg font-semibold text-gray-900">
                {adjustmentId ? "แก้ไขการปรับยอด" : "บันทึกการปรับยอดเงิน"}
              </h2>
              <p className="text-sm text-gray-500">
                ใช้สำหรับรายการเงินเข้าออกที่ไม่เกิดจากเอกสารหลัก เช่น เงินสดขาดเกิน ค่าธรรมเนียมธนาคาร หรือการตั้งยอดเริ่มต้น
              </p>
            </div>
            {adjustmentId && (
              <button type="button" onClick={resetForm} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                ล้างฟอร์ม
              </button>
            )}
          </div>

          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">วันที่</label>
              <input type="date" className={inputCls} value={adjustDate} onChange={(e) => setAdjustDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">บัญชี</label>
              <select className={`${inputCls} bg-white`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">เลือกบัญชี</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">ทิศทาง</label>
              <select className={`${inputCls} bg-white`} value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}>
                <option value="IN">เงินเข้า</option>
                <option value="OUT">เงินออก</option>
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
              <label className="mb-1 block text-sm font-medium text-gray-700">เหตุผล</label>
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น เงินขาดเกิน / ค่าธรรมเนียม" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">หมายเหตุ</label>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : adjustmentId ? "บันทึกการแก้ไข" : "บันทึกการปรับยอด"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="font-kanit text-lg font-semibold text-gray-900">ประวัติการปรับยอดเงิน</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">บัญชี</th>
                <th className="px-3 py-2 text-left font-medium">ทิศทาง</th>
                <th className="px-3 py-2 text-right font-medium">จำนวนเงิน</th>
                <th className="px-3 py-2 text-left font-medium">เหตุผล</th>
                <th className="px-3 py-2 text-left font-medium">หมายเหตุ</th>
                <th className="px-3 py-2 text-center font-medium">สถานะ</th>
                <th className="px-3 py-2 text-right font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {sortedAdjustments.map((adjustment) => (
                <tr key={adjustment.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{adjustment.adjustNo}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(adjustment.adjustDate)}</td>
                  <td className="px-3 py-2 text-gray-900">
                    <p>{adjustment.accountName}</p>
                    <p className="text-xs text-gray-400">{adjustment.accountCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${adjustment.direction === "IN" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                      {adjustment.direction === "IN" ? "เงินเข้า" : "เงินออก"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(adjustment.amount)}</td>
                  <td className="px-3 py-2 text-gray-600">{adjustment.reason}</td>
                  <td className="px-3 py-2 text-gray-500">{adjustment.note || adjustment.cancelNote || "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${adjustment.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {adjustment.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {canUpdate && adjustment.status === "ACTIVE" && (
                        <button type="button" onClick={() => handleEdit(adjustment)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">
                          แก้ไข
                        </button>
                      )}
                      {canCancel && adjustment.status === "ACTIVE" && (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setSuccess("");
                            setCancelTarget(adjustment.id);
                            setCancelNote("");
                          }}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          ยกเลิก
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cancelTarget && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">ยืนยันการยกเลิกรายการปรับยอด</h2>
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
