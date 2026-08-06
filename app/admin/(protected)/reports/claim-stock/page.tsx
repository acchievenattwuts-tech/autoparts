export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { ClaimStockMovementType, WarrantyClaimStatus } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import ClaimStockReportResults, {
  type ClaimStockReportCriteria,
} from "./ClaimStockReportResults";
import { CLAIM_STATUS_LABEL, MOVEMENT_LABEL } from "./report-labels";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};


export default async function ClaimStockReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const from = params.from?.trim() || "";
  const to = params.to?.trim() || "";
  const claimStatus = params.status?.trim() || "";
  const movementType = params.movementType?.trim() || "";
  const q = params.q?.trim() || "";
  const submitted = params.submitted === "1";
  const selectedClaimStatus = Object.values(WarrantyClaimStatus).includes(claimStatus as WarrantyClaimStatus)
    ? (claimStatus as WarrantyClaimStatus)
    : "";
  const selectedMovementType = Object.values(ClaimStockMovementType).includes(movementType as ClaimStockMovementType)
    ? (movementType as ClaimStockMovementType)
    : "";

  const criteria: ClaimStockReportCriteria = {
    from,
    to,
    claimStatus: selectedClaimStatus,
    movementType: selectedMovementType,
    q,
  };
  const resultsKey = [from, to, selectedClaimStatus, selectedMovementType, q].join("|");


  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
          รายงานสต็อกเคลม
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ตรวจสอบรายการเคลื่อนไหวของสินค้าเคลมหลายใบ พร้อมสถานะใบเคลมและต้นทุนที่บันทึกไว้
        </p>
      </div>

      <AdminSearchForm
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900"
      >
        <input type="hidden" name="submitted" value="1" />
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          สถานะใบเคลม
          <select
            name="status"
            defaultValue={selectedClaimStatus}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(CLAIM_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ประเภทรายการ
          <select
            name="movementType"
            defaultValue={selectedMovementType}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          >
            <option value="">ทุกรายการ</option>
            {Object.entries(MOVEMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ค้นหา
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="เลขที่เคลม / สินค้า / ซัพพลายเออร์"
            className="h-9 w-[18rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายงาน
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/claim-stock"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
      </AdminSearchForm>

      {submitted ? (
        <Suspense key={resultsKey} fallback={<ReportResultsSkeleton />}>
          <ClaimStockReportResults criteria={criteria} />
        </Suspense>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="font-medium text-gray-700 dark:text-slate-200">ยังไม่ได้แสดงรายงาน</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            เลือกเงื่อนไขแล้วกดแสดงรายงานเพื่อดูรายการเคลื่อนไหวของสต็อกเคลม
          </p>
        </div>
      )}
    </div>
  );
}
