"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface Props {
  initialFromDate: string;
  initialToDate: string;
  initialCustomerId: string;
  initialDeliveryStaffId: string;
  initialUnpaidOnly: boolean;
  customerOptions: SelectOption[];
  staffOptions: SelectOption[];
}

const DeliveryCommissionsReportFilter = ({
  initialFromDate,
  initialToDate,
  initialCustomerId,
  initialDeliveryStaffId,
  initialUnpaidOnly,
  customerOptions,
  staffOptions,
}: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(initialToDate);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [deliveryStaffId, setDeliveryStaffId] = useState(initialDeliveryStaffId);
  const [unpaidOnly, setUnpaidOnly] = useState(initialUnpaidOnly);

  const apply = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "report");
    params.delete("page");

    if (fromDate) params.set("rFrom", fromDate);
    else params.delete("rFrom");
    if (toDate) params.set("rTo", toDate);
    else params.delete("rTo");
    if (customerId) params.set("customerId", customerId);
    else params.delete("customerId");
    if (deliveryStaffId) params.set("rStaffId", deliveryStaffId);
    else params.delete("rStaffId");
    if (unpaidOnly) params.set("unpaidOnly", "1");
    else params.delete("unpaidOnly");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const reset = () => {
    setFromDate("");
    setToDate("");
    setCustomerId("");
    setDeliveryStaffId("");
    setUnpaidOnly(false);
    startTransition(() => {
      router.push(`${pathname}?tab=report`);
    });
  };

  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-opacity dark:border-white/10 dark:bg-slate-900 ${isPending ? "opacity-60" : ""}`}>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-slate-300">จากวันที่ขาย</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-slate-300">ถึงวันที่ขาย</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-slate-300">ลูกค้า</span>
          <SearchableSelect
            options={customerOptions}
            value={customerId}
            onChange={setCustomerId}
            placeholder="ทุกลูกค้า"
          />
        </div>
        <div className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-slate-300">พนักงานส่ง</span>
          <SearchableSelect
            options={staffOptions}
            value={deliveryStaffId}
            onChange={setDeliveryStaffId}
            placeholder="ทุกพนักงานส่ง"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => setUnpaidOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          แสดงเฉพาะบิลที่ยังไม่ชำระ (เครดิตคงค้าง)
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            ล้างตัวกรอง
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#162d4a] disabled:opacity-50"
          >
            {isPending ? <LoaderCircle size={16} className="animate-spin" /> : null}
            แสดงรายงาน
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryCommissionsReportFilter;
