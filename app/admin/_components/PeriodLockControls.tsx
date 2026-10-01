"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import CancelDocButton from "@/components/shared/CancelDocButton";
import {
  isPeriodLockReasonLongEnough,
  isPeriodLockRejection,
  PERIOD_LOCK_REASON_FIELD,
  PERIOD_LOCK_REASON_LABEL,
  PERIOD_LOCK_REASON_MIN_LENGTH,
  PERIOD_LOCK_REASON_REQUIRED_MESSAGE,
  type PeriodLockView,
} from "@/lib/period-lock-view";

/**
 * UI for the profit-distribution month lock (lib/period-lock.ts). The message is the one the
 * server returns on rejection (buildPeriodLockMessage), so page and action never drift apart.
 * The server stays the source of truth: these controls only explain and collect the reason.
 */

type PeriodLockNoticeProps = {
  lock: PeriodLockView | null | undefined;
  compact?: boolean;
  /** What may still be edited without unlocking (owner decision ก2), per document type. */
  hint?: string;
};

export const PeriodLockNotice = ({ lock, compact = false, hint }: PeriodLockNoticeProps) => {
  if (!lock) return null;
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100 ${
        compact ? "px-3 py-2 text-xs" : "p-4 text-sm"
      }`}
    >
      <div className="flex items-start gap-2">
        <LockKeyhole size={compact ? 14 : 18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-200" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{lock.message}</p>
          {hint && (
            <p className={compact ? "text-[11px] text-amber-700 dark:text-amber-200/80" : "text-xs text-amber-700 dark:text-amber-200/80"}>
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

type PeriodLockReasonFieldProps = {
  lock: PeriodLockView | null | undefined;
  /**
   * Controlled mode (cancel dialogs, reopen, settlement cancel): the caller checks the reason and
   * sends it. Omit both to render a named, required field that the edit form's FormData picks up.
   */
  value?: string;
  onChange?: (value: string) => void;
  /** Keep false inside a <p> (the cancel dialog description) so the markup stays phrasing content. */
  asBlock?: boolean;
};

export const PeriodLockReasonField = ({ lock, value, onChange, asBlock = true }: PeriodLockReasonFieldProps) => {
  const fieldId = useId();
  if (!lock?.canOverride) return null;
  const Wrapper = asBlock ? "div" : "span";
  const controlled = value !== undefined && onChange !== undefined;
  return (
    <Wrapper className="block">
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
        {PERIOD_LOCK_REASON_LABEL} <span className="text-red-500 dark:text-rose-400">*</span>
      </label>
      <textarea
        id={fieldId}
        rows={2}
        minLength={PERIOD_LOCK_REASON_MIN_LENGTH}
        maxLength={500}
        aria-required
        {...(controlled
          ? { value, onChange: (event) => onChange(event.target.value) }
          : { name: PERIOD_LOCK_REASON_FIELD, required: true })}
        placeholder="เช่น ลูกค้าแจ้งราคาผิด ต้องแก้ให้ตรงกับใบกำกับ"
        className="block w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-amber-300/30 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-amber-400/40"
      />
      <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
        ระบบจะบันทึกเหตุผลใน Audit Log และแจ้งเตือนเจ้าของร้านทาง Telegram
      </span>
    </Wrapper>
  );
};

/**
 * Owner decision P3, client-side hint only: does the edit form's current state differ from the
 * loaded document in a field that counts as financial in a locked month? `financialSnapshot`
 * holds only such fields (never notes or line remarks) and is compared, as JSON, with its value on
 * the first render. The server re-decides on submit: once it rejects for the lock (`serverError`),
 * the reason is asked for until the next successful save, so a missed field never leaves the admin
 * without the reason box. `markSaved` moves the baseline after a save that keeps the form open.
 * Only tracked for a viewer who may override.
 */
export const usePeriodLockFinancialChange = (
  lock: PeriodLockView | null | undefined,
  financialSnapshot: unknown,
  serverError?: string | null,
): { financialChange: boolean; markSaved: () => void } => {
  const tracked = Boolean(lock?.canOverride);
  const snapshotKey = tracked ? JSON.stringify(financialSnapshot) : "";
  const [baselineKey, setBaselineKey] = useState(snapshotKey);
  const [serverAskedReason, setServerAskedReason] = useState(false);
  const rejectedForLock = tracked && isPeriodLockRejection(serverError, lock);
  // Remembered across the next submit, which clears the form's error while it is pending.
  if (rejectedForLock && !serverAskedReason) setServerAskedReason(true);
  return {
    financialChange: tracked && (rejectedForLock || serverAskedReason || snapshotKey !== baselineKey),
    markSaved: () => {
      setBaselineKey(snapshotKey);
      setServerAskedReason(false);
    },
  };
};

type PeriodLockFormSectionProps = {
  lock: PeriodLockView | null | undefined;
  hint?: string;
  /**
   * From usePeriodLockFinancialChange(). false = only non-financial fields changed, so the reason
   * field is left out (P3); omitted = always ask, as before.
   */
  financialChange?: boolean;
  /** Shown to every viewer instead of the default line while no reason is asked — e.g. a check the save runs first. */
  note?: string;
};

/** Notice + reason field for edit forms that submit `new FormData(form)`. */
export const PeriodLockFormSection = ({ lock, hint, financialChange, note }: PeriodLockFormSectionProps) => {
  if (!lock) return null;
  const asksReason = financialChange !== false;
  return (
    <div className="space-y-3">
      <PeriodLockNotice lock={lock} hint={hint} />
      {asksReason ? (
        <PeriodLockReasonField lock={lock} />
      ) : note ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">{note}</p>
      ) : lock.canOverride ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">
          ตอนนี้แก้เฉพาะข้อมูลที่ไม่กระทบตัวเลข บันทึกได้เลยโดยไม่ต้องระบุเหตุผล — ถ้าแก้วันที่ ยอดเงิน หรือรายการ ช่องเหตุผลจะแสดงขึ้นเอง
        </p>
      ) : null}
    </div>
  );
};

type CancelDocButtonProps = ComponentProps<typeof CancelDocButton>;

const DefaultCancelDescription = ({ docNo }: { docNo: string }) => (
  <>
    เอกสาร <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{docNo}</span> จะถูกยกเลิก
    ระบบจะคำนวณสต็อก MAVG ใหม่ทันที และไม่สามารถกู้คืนได้
  </>
);

/**
 * CancelDocButton for a document that may sit in a locked month: disabled with the lock message,
 * or — for an admin holding the override permission — asks for the reason inside the dialog.
 */
export const PeriodLockCancelButton = ({
  periodLock,
  cancelAction,
  description,
  disabledReason,
  ...props
}: CancelDocButtonProps & { periodLock?: PeriodLockView | null }) => {
  const [reason, setReason] = useState("");

  if (!periodLock) {
    return <CancelDocButton {...props} cancelAction={cancelAction} description={description} disabledReason={disabledReason} />;
  }

  if (!periodLock.canOverride) {
    return <CancelDocButton {...props} cancelAction={cancelAction} description={description} disabledReason={disabledReason ?? periodLock.message} />;
  }

  const lockedDescription: ReactNode = (
    <>
      {description ?? <DefaultCancelDescription docNo={props.docNo} />}
      <span className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">
        {periodLock.message}
      </span>
      <span className="mt-3 block">
        <PeriodLockReasonField lock={periodLock} value={reason} onChange={setReason} asBlock={false} />
      </span>
    </>
  );

  const cancelWithReason = async (formData: FormData): Promise<{ success?: boolean; error?: string }> => {
    if (!isPeriodLockReasonLongEnough(reason)) return { error: PERIOD_LOCK_REASON_REQUIRED_MESSAGE };
    formData.set(PERIOD_LOCK_REASON_FIELD, reason.trim());
    return cancelAction(formData);
  };

  return (
    <CancelDocButton
      {...props}
      cancelAction={cancelWithReason}
      description={lockedDescription}
      disabledReason={disabledReason}
    />
  );
};
