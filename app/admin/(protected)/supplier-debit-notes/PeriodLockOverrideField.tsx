import { Lock } from "lucide-react";
import type { SupplierDebitLockedPeriod } from "@/lib/supplier-debit-note";

/** Minimum reason length; the server applies the same rule (normalizeOverrideReason in lib/period-lock.ts). */
export const PERIOD_LOCK_REASON_MIN_LENGTH = 5;
const PERIOD_LOCK_REASON_MAX_LENGTH = 1000;

export const isPeriodLockReasonValid = (reason: string): boolean => reason.trim().length >= PERIOD_LOCK_REASON_MIN_LENGTH;

const describePeriods = (periods: SupplierDebitLockedPeriod[]): string =>
  periods.map((period) => `${period.label} (${period.distributionNo})`).join(", ");

/**
 * Month-lock override (owner only): shown when the change touches a month whose profit is already
 * distributed. The reason is required; the server audits it and alerts the owner on Telegram.
 */
const PeriodLockOverrideField = ({ periods, value, onChange, disabled }: {
  periods: SupplierDebitLockedPeriod[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) => (
  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
    <p className="flex items-start gap-2 font-medium">
      <Lock size={16} className="mt-0.5 shrink-0" />
      <span>{periods.length > 0 ? `กระทบเดือนที่ประกาศปันผลแล้ว: ${describePeriods(periods)}` : "กระทบเดือนที่ประกาศปันผลแล้ว"}</span>
    </p>
    <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
      บันทึกได้เฉพาะผู้มีสิทธิ์ปลดล็อก · ระบบเก็บเหตุผลใน Audit log และแจ้งเตือนทาง Telegram · ส่วนต่างกำไรจะยกไปปรับในการปันผลครั้งถัดไป
    </p>
    <label className="mt-3 block">
      <span className="mb-1.5 block font-medium">เหตุผลที่แก้เอกสารในเดือนที่ปันผลแล้ว <span className="text-red-500">*</span></span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} required disabled={disabled}
        minLength={PERIOD_LOCK_REASON_MIN_LENGTH} maxLength={PERIOD_LOCK_REASON_MAX_LENGTH}
        placeholder={`อย่างน้อย ${PERIOD_LOCK_REASON_MIN_LENGTH} ตัวอักษร`}
        className="w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
    </label>
  </div>
);

export default PeriodLockOverrideField;
