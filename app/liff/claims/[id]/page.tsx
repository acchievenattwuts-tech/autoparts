import Link from "next/link";
import { CheckCircle2, ChevronLeft, Circle } from "lucide-react";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";
import {
  CLAIM_TYPE_LABEL,
  getCustomerClaimStatusBadgeClass,
  getCustomerClaimStatusLabel,
  getClaimOutcomeLabel,
} from "@/lib/warranty-claim-i18n";

export default async function LiffClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, customer] = await Promise.all([params, requireLiffCustomer()]);
  const claim = await db.warrantyClaim.findFirst({
    where: {
      id,
      status: { not: "CANCELLED" },
      warranty: {
        sale: {
          customerId: customer.id,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      claimNo: true,
      claimDate: true,
      claimType: true,
      status: true,
      outcome: true,
      symptom: true,
      note: true,
      sentAt: true,
      resolvedAt: true,
      returnedAt: true,
      warranty: {
        select: {
          id: true,
          lotNo: true,
          product: { select: { code: true, name: true } },
          sale: { select: { saleNo: true } },
        },
      },
    },
  });

  if (!claim) notFound();

  const isSupplierRejectedClaim = claim.status === "CLOSED" && claim.outcome === "NO_RESOLUTION";
  const timeline =
    claim.claimType === "REPLACE_NOW"
      ? [
          { label: "แจ้งเคลม", date: claim.claimDate, done: true },
          { label: "เปลี่ยนสินค้าแล้ว", date: claim.resolvedAt ?? claim.claimDate, done: true },
        ]
      : isSupplierRejectedClaim
        ? [
            { label: "แจ้งเคลม", date: claim.claimDate, done: true },
            { label: "ส่งซัพพลายเออร์", date: claim.sentAt, done: Boolean(claim.sentAt) },
            { label: "ซัพพลายเออร์ไม่รับเคลม", date: claim.resolvedAt, done: true },
          ]
        : [
            { label: "แจ้งเคลม", date: claim.claimDate, done: true },
            { label: "ส่งซัพพลายเออร์", date: claim.sentAt, done: Boolean(claim.sentAt) },
            { label: "จบเคลม", date: claim.resolvedAt, done: Boolean(claim.resolvedAt) || ["CLOSED", "RETURNED_TO_CUSTOMER"].includes(claim.status) },
            { label: "ส่งคืนลูกค้า", date: claim.returnedAt, done: Boolean(claim.returnedAt) || claim.status === "RETURNED_TO_CUSTOMER" },
          ];

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <Link href="/liff/claims" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 dark:text-sky-400">
          <ChevronLeft size={16} />
          กลับไปประวัติเคลม
        </Link>
        <p className="font-mono text-sm text-slate-500 dark:text-slate-400">{claim.claimNo}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">รายละเอียดเคลม</h1>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-950 dark:text-slate-100">{claim.warranty.product.name}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Warranty: {claim.warranty.product.code} · บิล {claim.warranty.sale.saleNo}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${getCustomerClaimStatusBadgeClass({
                claimType: claim.claimType,
                outcome: claim.outcome,
                status: claim.status,
              })}`}
            >
              {getCustomerClaimStatusLabel({
                claimType: claim.claimType,
                outcome: claim.outcome,
                status: claim.status,
              })}
            </span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">ประเภทเคลม</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{CLAIM_TYPE_LABEL[claim.claimType]}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">อาการ</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{claim.symptom ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">ผลการเคลม</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{getClaimOutcomeLabel(claim.outcome)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">ไทม์ไลน์สถานะ</h2>
          <ol className="mt-4 space-y-4">
            {timeline.map((step) => (
              <li key={step.label} className="flex gap-3">
                <div className="pt-0.5">
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-blue-700 dark:text-sky-400" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600" />
                  )}
                </div>
                <div>
                  <p className={step.done ? "font-semibold text-slate-950 dark:text-slate-100" : "font-semibold text-slate-400 dark:text-slate-600"}>
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {step.date ? formatDateThai(step.date) : "-"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
