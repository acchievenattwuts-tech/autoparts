"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelCashBankAdjustment,
  createCashBankAdjustment,
  updateCashBankAdjustment,
} from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";

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
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-500/40";

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string): string {
  return formatDateThai(value);
}

export default function AdjustmentManager({ accounts, adjustments, canCreate, canUpdate, canCancel }: Props) {
  const router = useRouter();
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [adjustDate, setAdjustDate] = useState(getThailandDateKey());
  const accountOptions: SelectOption[] = useMemo(
    () =>
      accounts.map((account) => ({
        id: account.id,
        label: `${account.code} - ${account.name}`,
      })),
    [accounts],
  );
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
    setAdjustDate(getThailandDateKey());
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
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
                {adjustmentId ? "แก้ไขการปรับยอด" : "บันทึกการปรับยอดเงิน"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                ใช้สำหรับรายการเงินเข้าออกที่ไม่เกิดจากเอกสารหลัก เช่น เงินสดขาดเกิน ค่าธรรมเนียมธนาคาร หรือการตั้งยอดเริ่มต้น
              </p>
            </div>
            {adjustmentId && (
              <button type="button" onClick={resetForm} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
                ล้างฟอร์ม
              </button>
            )}
          </div>

          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</div>}
          {success && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">{success}</div>}

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">วันที่</label>
              <input type="date" className={inputCls} value={adjustDate} onChange={(e) => setAdjustDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">บัญชี</label>
              <SearchableSelect
                options={accountOptions}
                value={accountId}
                onChange={setAccountId}
                placeholder="เลือกบัญชี"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">ทิศทาง</label>
              <select className={`${inputCls} bg-white`} value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}>
                <option value="IN">เงินเข้า</option>
                <option value="OUT">เงินออก</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">จำนวนเงิน</label>
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
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">เหตุผล</label>
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น เงินขาดเกิน / ค่าธรรมเนียม" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">หมายเหตุ</label>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              {isPending ? "กำลังบันทึก..." : adjustmentId ? "บันทึกการแก้ไข" : "บันทึกการปรับยอด"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ประวัติการปรับยอดเงิน</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 dark:bg-white/5 dark:text-slate-300">
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
                <tr key={adjustment.id} className="border-t border-gray-100 dark:border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-300">{adjustment.adjustNo}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-slate-300">{formatDate(adjustment.adjustDate)}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-slate-100">
                    <p>{adjustment.accountName}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{adjustment.accountCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${adjustment.direction === "IN" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300"}`}>
                      {adjustment.direction === "IN" ? "เงินเข้า" : "เงินออก"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">{formatCurrency(adjustment.amount)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{adjustment.reason}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{adjustment.note || adjustment.cancelNote || "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${adjustment.status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400"}`}>
                      {adjustment.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {canUpdate && adjustment.status === "ACTIVE" && (
                        <button type="button" onClick={() => handleEdit(adjustment)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
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
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15"
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
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm dark:border-red-400/30 dark:bg-red-400/10">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-red-100">ยืนยันการยกเลิกรายการปรับยอด</h2>
          <p className="text-sm text-gray-600 dark:text-red-200/80">ระบุเหตุผลเพื่อเก็บไว้ในประวัติการยกเลิก</p>
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
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
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
