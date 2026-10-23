import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import {
  PAYMENT_SLIP_RECEIVER_CHECK_LABEL,
  type PaymentSlipReceiverCheck,
} from "@/lib/line-payment-slip-check-rules";
import type { PaymentSlipCheckResult, PaymentSlipDuplicateMatch } from "@/lib/line-payment-slip-checks";
import {
  formatPaymentSlipBaht,
  paymentSlipStatusBadgeClass,
  paymentSlipStatusLabel,
} from "@/lib/line-payment-slip-display";
import { formatDateTimeThai } from "@/lib/th-date";

type Props = {
  /** null = the checks could not run (DB error); the admin checks by eye. */
  result: PaymentSlipCheckResult | null;
};

const OK_TEXT = "text-emerald-700 dark:text-emerald-300";
const BAD_TEXT = "font-semibold text-red-700 dark:text-red-300";
const NEUTRAL_TEXT = "text-gray-500 dark:text-slate-400";

const RECEIVER_TEXT_CLASS: Record<PaymentSlipReceiverCheck, string> = {
  MATCH: OK_TEXT,
  MISMATCH: BAD_TEXT,
  UNREADABLE: NEUTRAL_TEXT,
  NO_ACCOUNTS: NEUTRAL_TEXT,
};

const DUPLICATE_KIND_LABEL: Record<PaymentSlipDuplicateMatch["kind"], string> = {
  REFERENCE: "เลขอ้างอิงตรงกัน",
  AMOUNT_TIME: "ยอดเงินและเวลาโอนตรงกัน",
};

const DuplicateSummary = ({ result }: { result: PaymentSlipCheckResult }) => {
  const duplicateWarnings = result.warnings.filter((warning) => warning.code !== "RECEIVER_MISMATCH");
  if (duplicateWarnings.length > 0) {
    return (
      <div className="space-y-0.5">
        {duplicateWarnings.map((warning) => (
          <p key={warning.code} className={BAD_TEXT}>
            {warning.message}
          </p>
        ))}
      </div>
    );
  }
  if (!result.referenceReadable) {
    return <p className={NEUTRAL_TEXT}>อ่านเลขอ้างอิงไม่ได้ — เช็กได้เฉพาะยอดเงินกับเวลาโอน (ไม่พบที่ตรงกัน)</p>;
  }
  return <p className={OK_TEXT}>ไม่พบสลิปซ้ำ</p>;
};

const DuplicateList = ({ duplicates }: { duplicates: PaymentSlipDuplicateMatch[] }) => (
  <ul className="mt-3 space-y-2">
    {duplicates.map((match) => (
      <li key={match.id}>
        <Link
          href={`/admin/line-payment-slips/${match.id}`}
          className="flex flex-col gap-1 rounded-md border border-red-200 bg-white px-3 py-2 text-sm hover:bg-red-50 sm:flex-row sm:items-center sm:justify-between dark:border-red-400/30 dark:bg-slate-950 dark:hover:bg-red-500/10"
        >
          <span className="min-w-0 text-gray-800 dark:text-slate-200">
            <span className="font-medium">{DUPLICATE_KIND_LABEL[match.kind]}</span>
            {" · ส่งเมื่อ "}
            {formatDateTimeThai(match.createdAt, { dateStyle: "medium", timeStyle: "short" })}
            {` · ${match.channelLabel}`}
            {match.customerLabel ? ` · ${match.customerLabel}` : ""}
            {` · ${formatPaymentSlipBaht(match.amount)} ฿`}
          </span>
          <span
            className={`w-fit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentSlipStatusBadgeClass[match.verificationStatus]}`}
          >
            {paymentSlipStatusLabel[match.verificationStatus]}
          </span>
        </Link>
      </li>
    ))}
  </ul>
);

/** Automatic duplicate / receiver check results on the slip review page. */
const PaymentSlipCheckPanel = ({ result }: Props) => {
  const hasWarnings = (result?.warnings.length ?? 0) > 0;
  const containerClass = hasWarnings
    ? "border-red-300 bg-red-50 dark:border-red-400/40 dark:bg-red-500/10"
    : "border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70";

  return (
    <div className={`rounded-lg border p-4 ${containerClass}`}>
      <h2 className="flex items-center gap-2 font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
        {hasWarnings ? (
          <AlertTriangle size={18} className="shrink-0 text-red-600 dark:text-red-300" />
        ) : (
          <ShieldCheck size={18} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
        )}
        ผลเช็กอัตโนมัติ (ช่วยตรวจเท่านั้น)
      </h2>

      {result ? (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-gray-500 dark:text-slate-400">สลิปซ้ำ</dt>
            <dd>
              <DuplicateSummary result={result} />
            </dd>
            <dt className="text-gray-500 dark:text-slate-400">ชื่อผู้รับ</dt>
            <dd className={RECEIVER_TEXT_CLASS[result.receiver]}>
              {PAYMENT_SLIP_RECEIVER_CHECK_LABEL[result.receiver]}
            </dd>
          </dl>
          {result.duplicates.length > 0 ? <DuplicateList duplicates={result.duplicates} /> : null}
          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
            เช็กจากข้อมูลที่ AI อ่านจากรูป จับสลิปปลอมที่ทำขึ้นใหม่ไม่ได้ — ยังต้องดูยอดเงินเข้าในแอปธนาคารก่อนยืนยัน
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">
          เช็กอัตโนมัติไม่สำเร็จในขณะนี้ — ตรวจเองจากรูปสลิป
        </p>
      )}
    </div>
  );
};

export default PaymentSlipCheckPanel;
