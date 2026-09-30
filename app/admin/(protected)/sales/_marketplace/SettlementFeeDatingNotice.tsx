import type { ReactElement } from "react";
import { CalendarClock } from "lucide-react";
import type { SettlementFeeDatingView } from "@/lib/marketplace/settlement-fee-dating";

/** Sale numbers listed per month before collapsing the rest into a count. */
const MAX_DOC_NOS_SHOWN = 8;

const money = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "ค่าธรรมเนียม ฿120.00 · รายรับพิเศษ ฿10.00" — zero parts are left out. */
const describeAmounts = (feeAmount: number, incomeAmount: number): string =>
  [
    feeAmount > 0 ? `ค่าธรรมเนียม ฿${money(feeAmount)}` : null,
    incomeAmount > 0 ? `รายรับพิเศษ ฿${money(incomeAmount)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

const describeDocNos = (docNos: string[]): string =>
  docNos.length > MAX_DOC_NOS_SHOWN
    ? `${docNos.slice(0, MAX_DOC_NOS_SHOWN).join(", ")} และอีก ${docNos.length - MAX_DOC_NOS_SHOWN} ใบ`
    : docNos.join(", ");

type SettlementFeeDatingNoticeProps = {
  dating: SettlementFeeDatingView | null | undefined;
  compact?: boolean;
};

/**
 * Owner decision P2 = B: which fee / income shares of a settlement were booked on the settlement
 * date instead of their sale date, and why. No hooks, so both the client history table and a
 * server detail page can render it.
 */
const SettlementFeeDatingNotice = ({
  dating,
  compact = false,
}: SettlementFeeDatingNoticeProps): ReactElement | null => {
  if (!dating || dating.months.length === 0) return null;
  return (
    <div
      role="note"
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100 ${
        compact ? "px-3 py-2 text-xs" : "p-4 text-sm"
      }`}
    >
      <div className="flex items-start gap-2">
        <CalendarClock
          size={compact ? 14 : 18}
          aria-hidden
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-200"
        />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            ลงวันที่รับเงิน {dating.settlementDateLabel} แทนวันที่ขาย:{" "}
            {describeAmounts(dating.feeAmount, dating.incomeAmount)}
          </p>
          <ul className="space-y-0.5">
            {dating.months.map((month) => (
              <li key={month.periodKey} className="break-words">
                ขายเดือน{month.periodLabel} (ประกาศปันผลแล้ว {month.distributionNo}) — ใบขาย{" "}
                {describeDocNos(month.docNos)} · {describeAmounts(month.feeAmount, month.incomeAmount)}
              </li>
            ))}
          </ul>
          <p className="text-amber-700 dark:text-amber-200/80">
            เดือนที่ขายประกาศปันผลแล้วก่อนบันทึกรอบรับเงินนี้ ระบบจึงลงยอดเหล่านี้ที่วันที่รับเงิน
            เพื่อไม่ให้กำไรของเดือนที่ปันผลแล้วเปลี่ยน
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettlementFeeDatingNotice;
