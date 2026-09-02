"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

import { createProfitDistribution } from "./actions";

type PartnerRow = {
  partnerProfileId: string;
  name: string;
  bankLabel: string | null;
  defaultSharePercent: number;
};

type CarryForwardRow = {
  label: string;
  kind: "UNDECLARED" | "RESTATED" | "RETAINED";
  amount: number;
};

type RetainedMode = "KEEP_IN_SHOP" | "CARRY_FORWARD";

const CARRY_FORWARD_KIND_LABEL: Record<CarryForwardRow["kind"], string> = {
  UNDECLARED: "ยังไม่ได้ประกาศ",
  RESTATED: "กำไรถูกคำนวณใหม่ย้อนหลัง",
  RETAINED: "ยอดที่ยังไม่ถูกแบ่ง",
};

const RETAINED_MODE_OPTIONS: Array<{
  value: RetainedMode;
  label: string;
  hint: string;
}> = [
  {
    value: "CARRY_FORWARD",
    label: "ยกไปแบ่งเดือนหน้า",
    hint: "ยอดที่กันไว้จะไปสมทบฐานที่แบ่งได้ของงวดถัดไป ยังเป็นเงินที่รอแบ่งอยู่",
  },
  {
    value: "KEEP_IN_SHOP",
    label: "กันเข้าร้านถาวร",
    hint: "เก็บเป็นทุนหมุนเวียนของร้าน จะไม่กลับมาเป็นยอดที่แบ่งได้อีก",
  },
];

type Props = {
  periodOptions: Array<{
    periodKey: string;
    label: string;
    hasActiveDistribution: boolean;
    isBlockedByEarlierPeriod: boolean;
  }>;
  periodKey: string;
  periodLabel: string;
  accountOptions: SelectOption[];
  partners: PartnerRow[];
  today: string;
  minPayDate: string;
  netProfit: number;
  salesAmount: number;
  costAmount: number;
  expenseAmount: number;
  carryForwardAmount: number;
  carryForwardRows: CarryForwardRow[];
  distributableBase: number;
  cashBankBalance: number;
  arOutstanding: number;
  stockValue: number;
  hasActiveDistribution: boolean;
  blockingPeriods: Array<{ periodKey: string; label: string }>;
};

const PERCENT_TOLERANCE = 0.01;

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-sky-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const CARD_CLASS =
  "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-gray-600 dark:text-slate-300";

const DeclareForm = ({
  periodOptions,
  periodKey,
  periodLabel,
  accountOptions,
  partners,
  today,
  minPayDate,
  netProfit,
  salesAmount,
  costAmount,
  expenseAmount,
  carryForwardAmount,
  carryForwardRows,
  distributableBase,
  cashBankBalance,
  arOutstanding,
  stockValue,
  hasActiveDistribution,
  blockingPeriods,
}: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [payDate, setPayDate] = useState(today);
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "");
  const [note, setNote] = useState("");
  // Default to distributing the whole distributable base; the owner may lower it.
  const [distributedText, setDistributedText] = useState(
    distributableBase > 0 ? String(roundMoney(distributableBase)) : "0",
  );
  // A month with nothing to share must roll its balance on — a loss may never be
  // written off by accident, so the choice is locked for those periods.
  const [retainedMode, setRetainedMode] = useState<RetainedMode>("CARRY_FORWARD");
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      partners.map((partner) => [partner.partnerProfileId, String(partner.defaultSharePercent)]),
    ),
  );

  const distributedAmount = useMemo(() => {
    const parsed = Number(distributedText.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
  }, [distributedText]);

  const retainedAmount = roundMoney(distributableBase - distributedAmount);

  const percentTotal = useMemo(
    () =>
      roundMoney(
        partners.reduce((sum, partner) => {
          const parsed = Number(percents[partner.partnerProfileId]);
          return sum + (Number.isFinite(parsed) ? parsed : 0);
        }, 0),
      ),
    [partners, percents],
  );

  /**
   * Amounts follow the percentages, with the rounding remainder pushed onto the
   * last row so the lines always add up to the distributed total exactly.
   */
  const allocations = useMemo(() => {
    const rows = partners.map((partner) => {
      const parsed = Number(percents[partner.partnerProfileId]);
      const sharePercent = Number.isFinite(parsed) ? parsed : 0;
      return {
        partnerProfileId: partner.partnerProfileId,
        sharePercent,
        shareAmount: roundMoney((distributedAmount * sharePercent) / 100),
      };
    });

    if (rows.length > 0 && Math.abs(percentTotal - 100) <= PERCENT_TOLERANCE) {
      const allocated = roundMoney(rows.reduce((sum, row) => sum + row.shareAmount, 0));
      const remainder = roundMoney(distributedAmount - allocated);
      if (remainder !== 0) {
        const last = rows[rows.length - 1];
        rows[rows.length - 1] = {
          ...last,
          shareAmount: roundMoney(last.shareAmount + remainder),
        };
      }
    }

    return rows;
  }, [partners, percents, distributedAmount, percentTotal]);

  const cashAfter = roundMoney(cashBankBalance - distributedAmount);

  const hasDistributableProfit = distributableBase > 0;
  const effectiveMode: RetainedMode = hasDistributableProfit ? retainedMode : "CARRY_FORWARD";

  const percentValid = Math.abs(percentTotal - 100) <= PERCENT_TOLERANCE;
  const amountValid = hasDistributableProfit
    ? distributedAmount >= 0 && distributedAmount <= distributableBase + 0.05
    : distributedAmount === 0;
  const canSubmit =
    !hasActiveDistribution &&
    blockingPeriods.length === 0 &&
    partners.length > 0 &&
    percentValid &&
    amountValid &&
    accountId.length > 0 &&
    payDate.length > 0 &&
    !isPending;

  const handleSubmit = () => {
    setError("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("periodKey", periodKey);
      formData.set("payDate", payDate);
      formData.set("cashBankAccountId", accountId);
      formData.set("distributedAmount", String(distributedAmount));
      formData.set("retainedMode", effectiveMode);
      formData.set("note", note);
      formData.set("items", JSON.stringify(allocations));

      const result = await createProfitDistribution(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.distributionId) {
        router.push(`/admin/profit-distributions/${result.distributionId}?created=1`);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      {blockingPeriods.length > 0 ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-400/20 dark:bg-rose-500/10">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" />
            <div className="space-y-2 text-sm">
              <p className="font-medium text-rose-800 dark:text-rose-100">
                ต้องประกาศเดือนก่อนหน้าให้ครบก่อน จึงจะประกาศงวด {periodLabel} ได้
              </p>
              <p className="text-rose-700/90 dark:text-rose-200/90">
                ยอดของเดือนที่ยังไม่ประกาศจะถูกยกมาหักซ้ำทุกงวด
                ระบบจึงบังคับให้ประกาศเรียงตามปฏิทินโดยไม่ข้ามเดือน
                (เดือนที่ขาดทุนก็ประกาศได้ ยอดที่แบ่งเป็น 0 แล้วยกไปหักเดือนถัดไป)
              </p>
              <div className="flex flex-wrap gap-2">
                {blockingPeriods.map((period) => (
                  <button
                    key={period.periodKey}
                    type="button"
                    onClick={() => {
                      startTransition(() => {
                        router.push(`/admin/profit-distributions/new?period=${period.periodKey}`);
                      });
                    }}
                    className="inline-flex items-center rounded-full bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 dark:bg-rose-400 dark:text-slate-950 dark:hover:bg-rose-300"
                  >
                    ประกาศ {period.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={CARD_CLASS}>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <span className={LABEL_CLASS}>งวดที่แบ่ง</span>
            <SearchableSelect
              options={periodOptions.map((option): SelectOption => {
                const blockedLabel = option.hasActiveDistribution
                  ? "ประกาศไปแล้ว"
                  : option.isBlockedByEarlierPeriod
                    ? "รอเดือนก่อนหน้าประกาศก่อน"
                    : undefined;
                return {
                  id: option.periodKey,
                  label: option.label,
                  sublabel: blockedLabel,
                  disabled: option.hasActiveDistribution,
                };
              })}
              value={periodKey}
              onChange={(nextPeriod) => {
                startTransition(() => {
                  router.push(`/admin/profit-distributions/new?period=${nextPeriod}`);
                });
              }}
              placeholder="เลือกงวด"
            />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
              เลือกได้เฉพาะเดือนที่จบไปแล้ว และต้องประกาศเรียงตามลำดับปฏิทิน
            </p>
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="payDate">
              วันที่โอนเงินจริง
            </label>
            <input
              id="payDate"
              type="date"
              value={payDate}
              min={minPayDate}
              max={today}
              onChange={(event) => setPayDate(event.target.value)}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
              ตัดเงินสดตามวันนี้ — ไม่กระทบกำไรเดือนใด
            </p>
          </div>
          <div>
            <span className={LABEL_CLASS}>จ่ายจากบัญชี</span>
            <SearchableSelect
              options={accountOptions}
              value={accountId}
              onChange={setAccountId}
              placeholder="เลือกบัญชี"
            />
          </div>
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
          กำไรงวด {periodLabel}
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-slate-400">กำไรสุทธิจากระบบ</dt>
            <dd
              className={`font-semibold ${netProfit < 0 ? "text-rose-600 dark:text-rose-300" : "text-gray-900 dark:text-slate-100"}`}
            >
              ฿{money(netProfit)}
            </dd>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            ยอดขาย {money(salesAmount)} − ต้นทุน {money(costAmount)} − ค่าใช้จ่าย{" "}
            {money(expenseAmount)}
          </p>

          {carryForwardAmount !== 0 ? (
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-white/5">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-600 dark:text-slate-300">ยกมาจากเดือนก่อน</dt>
                <dd
                  className={`font-semibold ${carryForwardAmount < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}
                >
                  {carryForwardAmount > 0 ? "+" : ""}
                  {money(carryForwardAmount)}
                </dd>
              </div>
              <p className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
                ยอดคงค้างของแต่ละเดือน (กำไรที่ทำได้ − ที่แบ่งไปแล้ว − ที่กันเข้าร้านถาวร)
                บางเดือนอาจหักลบกันเองจนรวมเป็นยอดสุทธิด้านบน
              </p>
              <ul className="mt-2 space-y-1 text-[11px] text-gray-500 dark:text-slate-400">
                {carryForwardRows.map((row) => (
                  <li key={`${row.kind}-${row.label}`} className="flex justify-between gap-2">
                    <span>
                      {row.label} ({CARRY_FORWARD_KIND_LABEL[row.kind]})
                    </span>
                    <span>
                      {row.amount > 0 ? "+" : ""}
                      {money(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 dark:border-white/10">
            <dt className="font-medium text-gray-700 dark:text-slate-200">ฐานที่แบ่งได้</dt>
            <dd className="text-lg font-bold text-gray-900 dark:text-slate-100">
              ฿{money(distributableBase)}
            </dd>
          </div>
        </dl>

        {!hasDistributableProfit ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              งวดนี้ไม่มีกำไรให้แบ่ง — ยอดที่แบ่งถูกล็อกไว้ที่ ฿0.00 และยอด{" "}
              {money(distributableBase)} จะถูกยกไปหักในงวดถัดไป
              ยังต้องบันทึกเอกสารเพื่อไม่ให้ลำดับเดือนขาดช่วง
            </span>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="distributedAmount">
                ยอดที่จะแบ่ง (แก้ไขได้ · ใส่ 0 ได้ถ้าเดือนนี้ไม่แบ่ง)
              </label>
              <input
                id="distributedAmount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={distributableBase}
                value={distributedText}
                onChange={(event) => setDistributedText(event.target.value)}
                className={`${INPUT_CLASS} text-right text-lg font-semibold`}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>กันไว้ในร้าน</span>
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-right text-lg font-semibold text-sky-600 dark:bg-white/5 dark:text-sky-300">
                ฿{money(Math.max(retainedAmount, 0))}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-white/10">
          <span className={LABEL_CLASS}>
            ยอดที่กันไว้ ฿{money(hasDistributableProfit ? Math.max(retainedAmount, 0) : distributableBase)}{" "}
            จะเอาไปทำอะไร
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {RETAINED_MODE_OPTIONS.map((option) => {
              const isSelected = effectiveMode === option.value;
              const isLocked = !hasDistributableProfit && option.value === "KEEP_IN_SHOP";
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={isLocked}
                  aria-pressed={isSelected}
                  onClick={() => setRetainedMode(option.value)}
                  className={`rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-sky-400 bg-sky-50 dark:border-sky-400/60 dark:bg-sky-500/10"
                      : "border-gray-200 bg-white hover:border-gray-300 dark:border-white/10 dark:bg-slate-900 dark:hover:border-white/20"
                  } ${isLocked ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  <span
                    className={`block text-sm font-medium ${
                      isSelected
                        ? "text-sky-700 dark:text-sky-200"
                        : "text-gray-800 dark:text-slate-100"
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
          {!hasDistributableProfit ? (
            <p className="mt-2 text-[11px] text-gray-400 dark:text-slate-500">
              งวดที่ไม่มีกำไรต้องยกยอดไปเดือนถัดไปเสมอ — เลือกกันเข้าร้านถาวรไม่ได้
              เพราะเท่ากับตัดขาดทุนทิ้ง
            </p>
          ) : null}
        </div>
      </section>

      {partners.length > 0 ? (
        <section className={CARD_CLASS}>
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            แบ่งให้ผู้ร่วมทุน
          </h2>
          {!hasDistributableProfit ? (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
              งวดนี้ทุกคนได้ ฿0.00 — สัดส่วนยังต้องรวม 100% เพื่อบันทึกไว้เป็นหลักฐานของงวด
            </p>
          ) : null}
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3">ชื่อ</th>
                  <th className="py-2 pr-3 w-32 text-right">สัดส่วน %</th>
                  <th className="py-2 text-right">ยอดที่ได้</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {partners.map((partner, index) => (
                  <tr key={partner.partnerProfileId}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-gray-800 dark:text-slate-100">
                        {partner.name}
                      </p>
                      {partner.bankLabel ? (
                        <p className="text-[11px] text-gray-400 dark:text-slate-500">
                          {partner.bankLabel}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max="100"
                        aria-label={`สัดส่วนของ ${partner.name}`}
                        value={percents[partner.partnerProfileId] ?? "0"}
                        onChange={(event) =>
                          setPercents((previous) => ({
                            ...previous,
                            [partner.partnerProfileId]: event.target.value,
                          }))
                        }
                        className={`${INPUT_CLASS} text-right`}
                      />
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900 dark:text-slate-100">
                      ฿{money(allocations[index]?.shareAmount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-white/10">
                  <td className="py-2 pr-3 font-medium text-gray-700 dark:text-slate-200">รวม</td>
                  <td
                    className={`py-2 pr-3 text-right font-semibold ${percentValid ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}
                  >
                    {percentTotal}%
                  </td>
                  <td className="py-2 text-right font-semibold text-gray-900 dark:text-slate-100">
                    ฿{money(distributedAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!percentValid ? (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
              สัดส่วนรวมต้องเท่ากับ 100% จึงจะบันทึกได้
            </p>
          ) : null}

          <div className="mt-4">
            <label className={LABEL_CLASS} htmlFor="note">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <input
              id="note"
              type="text"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className={INPUT_CLASS}
              placeholder="เช่น เดือนนี้ปรับสัดส่วนเพราะ..."
            />
          </div>
        </section>
      ) : (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
          ยังไม่มีผู้ร่วมทุนที่ใช้งานอยู่ — ตั้งค่าผู้ร่วมทุนก่อนจึงจะประกาศแบ่งกำไรได้
        </p>
      )}

      {distributedAmount > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
          <div className="flex items-start gap-2">
            <Info size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="w-full space-y-2 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-100">ตรวจสอบก่อนยืนยัน</p>
              <dl className="space-y-1 text-amber-900/90 dark:text-amber-100/90">
                <div className="flex justify-between gap-3">
                  <dt>เงินสด + ธนาคารคงเหลือ</dt>
                  <dd>฿{money(cashBankBalance)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>หลังโอนออก ฿{money(distributedAmount)} จะเหลือ</dt>
                  <dd className={cashAfter < 0 ? "font-bold text-rose-600 dark:text-rose-300" : "font-semibold"}>
                    ฿{money(cashAfter)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-amber-200/70 pt-1 dark:border-amber-400/20">
                  <dt>กำไรที่จมอยู่ในสต็อก</dt>
                  <dd>฿{money(stockValue)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>ลูกหนี้ที่ยังเก็บเงินไม่ได้</dt>
                  <dd>฿{money(arOutstanding)}</dd>
                </div>
              </dl>
              {cashAfter < 0 ? (
                <p className="font-medium text-rose-700 dark:text-rose-300">
                  ยอดที่แบ่งมากกว่าเงินสดที่มีอยู่จริง
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {hasActiveDistribution ? (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
          งวด {periodLabel} มีเอกสารที่ยังใช้งานอยู่แล้ว หากต้องการแก้ไขให้ยกเลิกเอกสารเดิมก่อน
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/profit-distributions")}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1e3a5f] px-6 text-sm font-semibold text-white hover:bg-[#274b78] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
        >
          {isPending
            ? "กำลังบันทึก..."
            : distributedAmount > 0
              ? "ยืนยันและโอนเงิน"
              : "ยืนยันบันทึกงวด (ไม่แบ่ง)"}
        </button>
      </div>
    </div>
  );
};

export default DeclareForm;
