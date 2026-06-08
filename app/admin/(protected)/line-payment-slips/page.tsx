export const dynamic = "force-dynamic";

import Link from "next/link";
import { ReceiptText } from "lucide-react";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import LineAdminTabNav from "@/components/shared/LineAdminTabNav";
import { hasPermissionAccess } from "@/lib/access-control";
import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import {
  formatPaymentSlipBaht,
  paymentSlipStatusBadgeClass,
  paymentSlipStatusLabel,
} from "@/lib/line-payment-slip-display";
import { listPaymentSlips } from "@/lib/line-payment-slip-repository";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

const statusOptions = Object.values(PaymentSlipVerificationStatus);

export default async function LinePaymentSlipsPage({ searchParams }: PageProps) {
  const session = await requirePermission("line_payment_slips.view");
  const params = await searchParams;
  const status = statusOptions.includes(params.status as PaymentSlipVerificationStatus)
    ? (params.status as PaymentSlipVerificationStatus)
    : null;
  const slips = await listPaymentSlips({ status, take: 80 });
  const canViewConversations = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_conversations.view",
  );

  return (
    <div className="space-y-4">
      <LineAdminTabNav canViewConversations={canViewConversations} canViewPaymentSlips />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
            <ReceiptText size={21} />
          </div>
          <div>
            <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
              สลิปการชำระเงิน (LINE)
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {slips.length.toLocaleString("th-TH")} รายการ — ข้อมูล OCR เป็นตัวช่วยตรวจสอบ ไม่ยืนยันการชำระอัตโนมัติ
            </p>
          </div>
        </div>

        <AdminSearchForm action="/admin/line-payment-slips" className="flex flex-wrap items-end gap-2 space-y-0">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
            สถานะ
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">ทั้งหมด</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {paymentSlipStatusLabel[option]}
                </option>
              ))}
            </select>
          </label>
          <AdminSearchSubmitButton className="h-10 rounded-md">กรอง</AdminSearchSubmitButton>
          <Link
            href="/admin/line-payment-slips"
            className="inline-flex h-10 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
          >
            ล้าง
          </Link>
        </AdminSearchForm>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        {slips.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">
            ไม่พบสลิป
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {slips.map((slip) => (
              <Link
                key={slip.id}
                href={`/admin/line-payment-slips/${slip.id}`}
                className="block px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-gray-900 dark:text-slate-100">
                        {slip.conversation?.customer?.name ?? slip.conversation?.displayName ?? slip.lineUserId}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentSlipStatusBadgeClass[slip.verificationStatus]}`}
                      >
                        {paymentSlipStatusLabel[slip.verificationStatus]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                      {slip.detectedBank ?? "ไม่ทราบธนาคาร"}
                      {slip.detectedSenderName ? ` · ${slip.detectedSenderName}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-left md:text-right">
                    <p className="font-kanit text-lg font-bold text-gray-900 dark:text-slate-100">
                      {formatPaymentSlipBaht(slip.detectedAmount)} ฿
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      {formatDateTimeThai(slip.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
