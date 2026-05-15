"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { formatDateThai } from "@/lib/th-date";
import { cancelDeliveryCommissionRun, createDeliveryCommissionRun } from "./actions";

const MAX_PAYOUT_SALES = 200;

type PreviewRow = {
  id: string;
  saleNo: string;
  saleDate: string;
  customerName: string | null;
  netAmount: number;
  shippingFee: number;
  commissionAmount: number;
};

type RecentRun = {
  id: string;
  runNo: string;
  payDate: string;
  deliveryStaffName: string;
  expenseId: string | null;
  expenseNo: string | null;
  itemCount: number;
  commissionTotal: number;
  status: "ACTIVE" | "CANCELLED";
};

type Props = {
  staffOptions: SelectOption[];
  accountOptions: SelectOption[];
  deliveryStaffId: string;
  fromDate: string;
  toDate: string;
  today: string;
  highlightId: string;
  percent: number;
  shippingFeeTotal: number;
  commissionTotal: number;
  previewRows: PreviewRow[];
  totalEligibleSales: number;
  expenseCodeLabel: string | null;
  canCreate: boolean;
  canCancel: boolean;
  recentRuns: RecentRun[];
};

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PayoutPanel = ({
  staffOptions,
  accountOptions,
  deliveryStaffId,
  fromDate,
  toDate,
  today,
  highlightId,
  percent,
  shippingFeeTotal,
  commissionTotal,
  previewRows,
  totalEligibleSales,
  expenseCodeLabel,
  canCreate,
  canCancel,
  recentRuns,
}: Props) => {
  const router = useRouter();
  const [selectedStaffId, setSelectedStaffId] = useState(deliveryStaffId);
  const [payDate, setPayDate] = useState(today);
  const [cashBankAccountId, setCashBankAccountId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCreating, startCreate] = useTransition();
  const [isCancelling, startCancel] = useTransition();

  const selectedAccount = useMemo(
    () => accountOptions.find((option) => option.id === cashBankAccountId) ?? null,
    [accountOptions, cashBankAccountId],
  );

  const overBatchLimit = totalEligibleSales > previewRows.length;

  const handleCreate = () => {
    if (!canCreate || !selectedStaffId || !cashBankAccountId) return;
    setError("");
    setSuccess("");
    startCreate(async () => {
      const formData = new FormData();
      formData.set("deliveryStaffId", selectedStaffId);
      formData.set("fromDate", fromDate);
      formData.set("toDate", toDate);
      formData.set("payDate", payDate);
      formData.set("cashBankAccountId", cashBankAccountId);
      formData.set("note", note);
      for (const row of previewRows) {
        formData.append("saleIds", row.id);
      }

      const result = await createDeliveryCommissionRun(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess(`สร้างเอกสารทำจ่าย ${result?.runNo ?? ""} เรียบร้อย`);
      const params = new URLSearchParams({
        tab: "payouts",
        deliveryStaffId: selectedStaffId,
        fromDate,
        toDate,
      });
      if (result?.runId) {
        params.set("highlight", result.runId);
      }
      router.push(`/admin/delivery-commissions?${params.toString()}`);
      router.refresh();
    });
  };

  const handleCancel = (runId: string) => {
    if (!canCancel) return;
    setError("");
    setSuccess("");
    startCancel(async () => {
      const formData = new FormData();
      formData.set("runId", runId);
      formData.set("cancelNote", "ยกเลิกจากหน้าทำจ่ายค่าส่งพนักงาน");
      const result = await cancelDeliveryCommissionRun(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSuccess("ยกเลิกเอกสารทำจ่ายเรียบร้อย");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
          {success}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <AdminSearchForm method="GET" className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto]">
          <input type="hidden" name="tab" value="payouts" />
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">พนักงานส่ง</span>
            <SearchableSelect
              options={staffOptions}
              value={selectedStaffId}
              onChange={setSelectedStaffId}
              placeholder="เลือกพนักงานส่ง"
            />
            <input type="hidden" name="deliveryStaffId" value={selectedStaffId} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">จากวันที่</span>
            <input
              type="date"
              name="fromDate"
              defaultValue={fromDate}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">ถึงวันที่</span>
            <input
              type="date"
              name="toDate"
              defaultValue={toDate}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <div className="flex items-end">
            <AdminSearchSubmitButton className="inline-flex w-full justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600">
              แสดงรายการ
            </AdminSearchSubmitButton>
          </div>
        </AdminSearchForm>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">เปอร์เซ็นต์ทำจ่าย</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">{percent}%</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยอดค่าส่งรวม</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">฿{money(shippingFeeTotal)}</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10">
          <p className="text-xs text-orange-700 dark:text-orange-200">ยอดทำจ่ายพนักงาน</p>
          <p className="mt-1 text-2xl font-semibold text-orange-700 dark:text-orange-100">฿{money(commissionTotal)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">เอกสารที่พร้อมทำจ่าย</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              รหัสค่าใช้จ่าย: {expenseCodeLabel ?? "ยังไม่ได้ตั้งค่า"}
            </p>
            {overBatchLimit ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                พบบิลทั้งหมด {totalEligibleSales.toLocaleString("th-TH")} รายการ ระบบให้ทำจ่ายได้ครั้งละไม่เกิน {MAX_PAYOUT_SALES.toLocaleString("th-TH")} รายการ กรุณากรองช่วงวันที่เพิ่ม
              </p>
            ) : null}
          </div>

          {canCreate && previewRows.length > 0 && expenseCodeLabel ? (
            <div className="flex flex-col gap-2 md:min-w-[360px]">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="date"
                  value={payDate}
                  onChange={(event) => setPayDate(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
                <div>
                  <SearchableSelect
                    options={accountOptions}
                    value={cashBankAccountId}
                    onChange={setCashBankAccountId}
                    selectedOption={selectedAccount}
                    placeholder="บัญชีที่จ่ายออก"
                  />
                </div>
              </div>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="หมายเหตุ"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || !cashBankAccountId || overBatchLimit}
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-orange-300 dark:bg-orange-600 dark:hover:bg-orange-500 dark:disabled:bg-orange-900/50"
              >
                {isCreating ? "กำลังสร้าง..." : `สร้างทำจ่าย ฿${money(commissionTotal)}`}
              </button>
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">เลขที่บิล</th>
                <th className="px-4 py-3">ลูกค้า</th>
                <th className="px-4 py-3 text-right">ยอดบิล</th>
                <th className="px-4 py-3 text-right">ค่าส่ง</th>
                <th className="px-4 py-3 text-right">ยอดพนักงานได้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">
                    {selectedStaffId ? "ไม่พบเอกสารที่พร้อมทำจ่าย" : "เลือกพนักงานส่งเพื่อแสดงรายการ"}
                  </td>
                </tr>
              ) : (
                previewRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDateThai(row.saleDate)}</td>
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                      <Link href={`/admin/sales/${row.id}`} className="hover:underline">{row.saleNo}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{row.customerName || "-"}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">฿{money(row.netAmount)}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">฿{money(row.shippingFee)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-orange-600 dark:text-orange-300">฿{money(row.commissionAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="border-b border-gray-100 p-4 dark:border-white/10">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ประวัติทำจ่ายล่าสุด</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">วันที่จ่าย</th>
                <th className="px-4 py-3">เลขที่</th>
                <th className="px-4 py-3">พนักงานส่ง</th>
                <th className="px-4 py-3">เอกสารค่าใช้จ่าย</th>
                <th className="px-4 py-3 text-right">จำนวนบิล</th>
                <th className="px-4 py-3 text-right">ยอดจ่าย</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {recentRuns.map((run) => {
                const isHighlight = highlightId === run.id;
                return (
                  <tr
                    key={run.id}
                    id={`run-${run.id}`}
                    className={
                      isHighlight
                        ? "bg-yellow-50 ring-2 ring-yellow-300 dark:bg-yellow-400/10 dark:ring-yellow-400/40"
                        : ""
                    }
                  >
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{run.payDate}</td>
                    <td className="px-4 py-3 font-mono text-[#1e3a5f] dark:text-sky-300">
                      <Link href={`/admin/delivery-commissions/${run.id}`} className="hover:underline">
                        {run.runNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{run.deliveryStaffName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {run.expenseId && run.expenseNo ? (
                        <Link href={`/admin/expenses/${run.expenseId}`} className="font-mono text-[#1e3a5f] hover:underline dark:text-sky-300">
                          {run.expenseNo}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{run.itemCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-slate-100">฿{money(run.commissionTotal)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        run.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                          : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400"
                      }`}>
                        {run.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel && run.status === "ACTIVE" ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(run.id)}
                          disabled={isCancelling}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-400/10"
                        >
                          ยกเลิก
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PayoutPanel;
