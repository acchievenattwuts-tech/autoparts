export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import AdminPaymentSlipReviewActions from "@/components/shared/AdminPaymentSlipReviewActions";
import LineAdminTabNav from "@/components/shared/LineAdminTabNav";
import { hasPermissionAccess } from "@/lib/access-control";
import {
  formatPaymentSlipBaht,
  paymentSlipStatusBadgeClass,
  paymentSlipStatusLabel,
} from "@/lib/line-payment-slip-display";
import { getPaymentSlipById } from "@/lib/line-payment-slip-repository";
import { createPaymentSlipSignedUrl } from "@/lib/line-payment-slip-storage";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LinePaymentSlipDetailPage({ params }: PageProps) {
  const session = await requirePermission("line_payment_slips.view");
  const { id } = await params;
  const slip = await getPaymentSlipById(id);

  if (!slip) notFound();

  const canManage = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_payment_slips.manage",
  );
  const canViewConversations = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_conversations.view",
  );

  const slipImageUrl = slip.imageUrl ? await createPaymentSlipSignedUrl(slip.imageUrl) : null;

  const fields: Array<{ label: string; value: string }> = [
    { label: "จำนวนเงิน", value: `${formatPaymentSlipBaht(slip.detectedAmount)} ฿` },
    {
      label: "วันเวลาโอน",
      value: slip.detectedTransferDatetime
        ? formatDateTimeThai(slip.detectedTransferDatetime, { dateStyle: "medium", timeStyle: "short" })
        : "-",
    },
    { label: "ธนาคาร", value: slip.detectedBank ?? "-" },
    { label: "ผู้โอน", value: slip.detectedSenderName ?? "-" },
    { label: "ผู้รับ", value: slip.detectedReceiverName ?? "-" },
    { label: "เลขอ้างอิง", value: slip.detectedReferenceNo ?? "-" },
  ];

  return (
    <div className="space-y-4">
      <LineAdminTabNav canViewConversations={canViewConversations} canViewPaymentSlips />

      <div>
        <Link
          href="/admin/line-payment-slips"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <ArrowLeft size={16} />
          กลับ
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            สลิปจาก {slip.conversation?.customer?.name ?? slip.conversation?.displayName ?? slip.lineUserId}
          </h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentSlipStatusBadgeClass[slip.verificationStatus]}`}
          >
            {paymentSlipStatusLabel[slip.verificationStatus]}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          ส่งเมื่อ {formatDateTimeThai(slip.createdAt, { dateStyle: "medium", timeStyle: "short" })}
          {slip.reviewedBy
            ? ` · ตรวจโดย ${slip.reviewedBy.name}${
                slip.reviewedAt
                  ? " " + formatDateTimeThai(slip.reviewedAt, { dateStyle: "short", timeStyle: "short" })
                  : ""
              }`
            : ""}
        </p>
      </div>

      {slipImageUrl ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
          <h2 className="mb-3 font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            รูปสลิป
          </h2>
          {/* Private, short-lived signed URL — native img avoids caching sensitive content. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slipImageUrl}
            alt="สลิปการโอนเงิน"
            width={400}
            height={600}
            loading="lazy"
            className="h-auto max-h-[70vh] max-w-full rounded-md border border-gray-100 object-contain dark:border-white/10"
          />
        </div>
      ) : slip.imageUrl ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          ไม่สามารถโหลดรูปสลิปได้ในขณะนี้
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
        <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
          ข้อมูลที่อ่านได้ (OCR — เพื่อช่วยตรวจสอบเท่านั้น)
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="flex justify-between gap-4 border-b border-gray-50 pb-2 dark:border-white/5">
              <dt className="text-sm text-gray-500 dark:text-slate-400">{field.label}</dt>
              <dd className="text-right text-sm font-medium text-gray-900 dark:text-slate-100">{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {slip.conversation ? (
        <Link
          href={`/admin/line-conversations/${slip.conversation.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
        >
          ดูบทสนทนา LINE ที่เกี่ยวข้อง →
        </Link>
      ) : null}

      {canManage ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
          <h2 className="mb-3 font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            ผลการตรวจสอบ
          </h2>
          <AdminPaymentSlipReviewActions slipId={slip.id} />
        </div>
      ) : null}
    </div>
  );
}
