"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { LoaderCircle, Plus, X } from "lucide-react";
import { MarketplaceFeeKind } from "@/lib/generated/prisma";
import {
  MARKETPLACE_ADJUSTMENT_OPTIONS,
  MARKETPLACE_FEE_OPTIONS,
  findMarketplaceLineOption,
} from "@/lib/marketplace/config";
import { calculateMarketplaceSettlement } from "@/lib/marketplace/settlement-math";
import { cancelMarketplaceSettlement, createMarketplaceSettlement } from "./actions";

type SaleRow = { id: string; saleNo: string; orderNo: string; date: string; amount: number };
type CreditNoteRow = { id: string; cnNo: string; saleNo: string; date: string; amount: number };
type Account = { id: string; label: string };
type HistoryRow = {
  id: string;
  no: string;
  ref: string;
  date: string;
  sales: number;
  returns: number;
  fees: number;
  income: number;
  payout: number;
  status: string;
};
type LineRow = { code: string; label: string; kind: MarketplaceFeeKind; amount: number };

const money = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";

const emptyFeeRow = (): LineRow => ({
  code: MARKETPLACE_FEE_OPTIONS[0].code,
  label: MARKETPLACE_FEE_OPTIONS[0].label,
  kind: MarketplaceFeeKind.FEE,
  amount: 0,
});

export default function SettlementManager({
  channel,
  channelLabel,
  orderRefLabel,
  sales,
  creditNotes,
  accounts,
  history,
  today,
  canCancel,
}: {
  channel: string;
  channelLabel: string;
  orderRefLabel: string;
  sales: SaleRow[];
  creditNotes: CreditNoteRow[];
  accounts: Account[];
  history: HistoryRow[];
  today: string;
  canCancel: boolean;
}) {
  const [selectedSales, setSelectedSales] = useState<string[]>([]);
  const [selectedCreditNotes, setSelectedCreditNotes] = useState<string[]>([]);
  const [lines, setLines] = useState<LineRow[]>([emptyFeeRow()]);
  const [payout, setPayout] = useState(0);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"create" | string | null>(null);

  const activeLines = useMemo(
    () => lines.filter((line) => Math.abs(line.amount) >= 0.01),
    [lines],
  );
  const calculation = useMemo(
    () =>
      calculateMarketplaceSettlement({
        saleAmounts: sales
          .filter((sale) => selectedSales.includes(sale.id))
          .map((sale) => sale.amount),
        returnAmounts: creditNotes
          .filter((creditNote) => selectedCreditNotes.includes(creditNote.id))
          .map((creditNote) => creditNote.amount),
        feeLines: activeLines,
        payoutAmount: payout,
      }),
    [sales, creditNotes, selectedSales, selectedCreditNotes, activeLines, payout],
  );

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const updateLine = (index: number, patch: Partial<LineRow>) =>
    setLines((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const nothingSelected = selectedSales.length === 0 && selectedCreditNotes.length === 0;

  return (
    <div className="space-y-6">
      <form
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#101b2e]"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setPendingAction("create");
          startTransition(async () => {
            try {
              const result = await createMarketplaceSettlement({
                channel,
                settlementDate: data.get("settlementDate"),
                payoutRef: data.get("payoutRef"),
                destinationAccountId: data.get("destinationAccountId"),
                payoutAmount: payout,
                saleIds: selectedSales,
                creditNoteIds: selectedCreditNotes,
                lines: activeLines,
                note: data.get("note") || undefined,
              });
              setIsError(Boolean(result.error));
              setMessage(result.error ?? `บันทึกสำเร็จ เลขที่รอบ ${result.settlementNo}`);
              if (result.success) {
                setSelectedSales([]);
                setSelectedCreditNotes([]);
                setLines([emptyFeeRow()]);
                setPayout(0);
              }
            } finally {
              setPendingAction(null);
            }
          });
        }}
      >
        <div>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
            สร้างรอบรับเงิน
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            เลือกใบขายและใบลดหนี้ตามรายละเอียดการโอนเงินของ {channelLabel} แล้วคีย์ค่าธรรมเนียมกับรายการปรับปรุงให้ครบ
            ยอดต้องตรงกับเงินที่เข้าบัญชีจริงก่อนจึงจะบันทึกได้
          </p>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">
            ใบขายที่รอรับเงิน ({sales.length})
          </h3>
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  <th className="p-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกใบขายทั้งหมด"
                      checked={sales.length > 0 && selectedSales.length === sales.length}
                      onChange={(event) =>
                        setSelectedSales(event.target.checked ? sales.map((sale) => sale.id) : [])
                      }
                    />
                  </th>
                  <th className="p-3 text-left">ใบขาย</th>
                  <th className="p-3 text-left">{orderRefLabel}</th>
                  <th className="p-3 text-left">วันที่ขาย</th>
                  <th className="p-3 text-right">ยอดขาย</th>
                </tr>
              </thead>
              <tbody>
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      ไม่มีใบขายที่รอกระทบยอด
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => (
                    <tr key={sale.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`เลือกใบขาย ${sale.saleNo}`}
                          checked={selectedSales.includes(sale.id)}
                          onChange={() => setSelectedSales((current) => toggle(current, sale.id))}
                        />
                      </td>
                      <td className="p-3 font-mono text-sky-700 dark:text-sky-300">{sale.saleNo}</td>
                      <td className="p-3">{sale.orderNo}</td>
                      <td className="p-3">{sale.date}</td>
                      <td className="p-3 text-right tabular-nums">{money(sale.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">
            ใบลดหนี้ที่รอหักออก ({creditNotes.length})
          </h3>
          <div className="max-h-56 overflow-auto rounded-lg border border-rose-200 dark:border-rose-400/20">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="sticky top-0 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
                <tr>
                  <th className="p-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกใบลดหนี้ทั้งหมด"
                      checked={
                        creditNotes.length > 0 && selectedCreditNotes.length === creditNotes.length
                      }
                      onChange={(event) =>
                        setSelectedCreditNotes(
                          event.target.checked ? creditNotes.map((row) => row.id) : [],
                        )
                      }
                    />
                  </th>
                  <th className="p-3 text-left">ใบลดหนี้</th>
                  <th className="p-3 text-left">อ้างอิงใบขาย</th>
                  <th className="p-3 text-left">วันที่คืน</th>
                  <th className="p-3 text-right">ยอดคืน</th>
                </tr>
              </thead>
              <tbody>
                {creditNotes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      ไม่มีใบลดหนี้ที่รอหักออกจากรอบ
                    </td>
                  </tr>
                ) : (
                  creditNotes.map((creditNote) => (
                    <tr key={creditNote.id} className="border-t border-rose-100 dark:border-white/5">
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`เลือกใบลดหนี้ ${creditNote.cnNo}`}
                          checked={selectedCreditNotes.includes(creditNote.id)}
                          onChange={() =>
                            setSelectedCreditNotes((current) => toggle(current, creditNote.id))
                          }
                        />
                      </td>
                      <td className="p-3 font-mono text-rose-700 dark:text-rose-300">
                        {creditNote.cnNo}
                      </td>
                      <td className="p-3 font-mono">{creditNote.saleNo}</td>
                      <td className="p-3">{creditNote.date}</td>
                      <td className="p-3 text-right tabular-nums text-rose-600 dark:text-rose-300">
                        -{money(creditNote.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">
              ค่าธรรมเนียมและรายการปรับปรุง
            </h3>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setLines((rows) => [...rows, emptyFeeRow()])}
                className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-300"
              >
                <Plus size={14} /> เพิ่มค่าธรรมเนียม
              </button>
              <button
                type="button"
                onClick={() =>
                  setLines((rows) => [
                    ...rows,
                    {
                      code: MARKETPLACE_ADJUSTMENT_OPTIONS[0].code,
                      label: MARKETPLACE_ADJUSTMENT_OPTIONS[0].label,
                      kind: MarketplaceFeeKind.ADJUSTMENT,
                      amount: 0,
                    },
                  ])
                }
                className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-300"
              >
                <Plus size={14} /> เพิ่มรายการปรับปรุง
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ค่าธรรมเนียมให้กรอกยอดติดลบ (เช่น -120.50) ส่วนรายการปรับปรุงกรอกได้ทั้งบวกและลบ —
            ยอดบวกคือเงินที่แพลตฟอร์มจ่ายเพิ่มให้ร้าน
          </p>
          {lines.map((line, index) => {
            const options =
              line.kind === MarketplaceFeeKind.FEE
                ? MARKETPLACE_FEE_OPTIONS
                : MARKETPLACE_ADJUSTMENT_OPTIONS;
            return (
              <div key={index} className="grid gap-2 md:grid-cols-[240px_1fr_160px_44px]">
                <select
                  value={line.code}
                  aria-label="ประเภทรายการ"
                  onChange={(event) => {
                    const option = findMarketplaceLineOption(event.target.value);
                    if (!option) return;
                    updateLine(index, { code: option.code, label: option.label, kind: option.kind });
                  }}
                  className={`${inputCls} bg-white`}
                >
                  {options.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={line.label}
                  aria-label="รายละเอียดรายการ"
                  maxLength={100}
                  onChange={(event) => updateLine(index, { label: event.target.value })}
                  className={inputCls}
                />
                <input
                  type="number"
                  step="0.01"
                  value={line.amount || ""}
                  aria-label="ยอดเงิน"
                  placeholder="0.00"
                  onChange={(event) => updateLine(index, { amount: Number(event.target.value) })}
                  className={`${inputCls} text-right tabular-nums`}
                />
                <button
                  type="button"
                  aria-label="ลบรายการ"
                  onClick={() => setLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg text-slate-400 hover:text-red-600"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm text-slate-700 dark:text-slate-300">
            วันที่เงินเข้า
            <input
              type="date"
              name="settlementDate"
              required
              defaultValue={today}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">
            เลขอ้างอิงการรับเงิน
            <input name="payoutRef" required maxLength={100} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">
            บัญชีธนาคารปลายทาง
            <select
              name="destinationAccountId"
              required
              className={`${inputCls} mt-1 bg-white`}
            >
              <option value="">เลือกบัญชี</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm text-slate-700 dark:text-slate-300">
          ยอดเงินเข้าจริง
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={payout || ""}
            onChange={(event) => setPayout(Number(event.target.value))}
            className={`${inputCls} mt-1 text-right text-lg font-semibold tabular-nums`}
          />
        </label>

        <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">ยอดขาย</dt>
            <dd className="font-semibold tabular-nums">{money(calculation.salesAmount)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">หักยอดคืน</dt>
            <dd className="font-semibold tabular-nums text-rose-600 dark:text-rose-300">
              -{money(calculation.returnAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">ค่าธรรมเนียม</dt>
            <dd className="font-semibold tabular-nums text-rose-600 dark:text-rose-300">
              -{money(calculation.feeAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">รายรับพิเศษ</dt>
            <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">
              +{money(calculation.incomeAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">ยอดที่ควรได้รับ</dt>
            <dd className="font-semibold tabular-nums">{money(calculation.expectedPayout)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">ผลต่าง</dt>
            <dd
              className={`font-semibold tabular-nums ${calculation.isBalanced ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}
            >
              {money(calculation.difference)}
            </dd>
          </div>
        </dl>

        <input
          name="note"
          maxLength={500}
          placeholder="หมายเหตุ (ถ้ามี)"
          className={inputCls}
        />
        {message ? (
          <p
            className={`text-sm ${isError ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}
          >
            {message}
          </p>
        ) : null}
        <button
          disabled={pending || nothingSelected || !calculation.isBalanced}
          aria-busy={pending && pendingAction === "create"}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && pendingAction === "create" ? (
            <>
              <LoaderCircle size={15} className="animate-spin" />
              กำลังบันทึก...
            </>
          ) : (
            "ยืนยันรับเงินและบันทึกค่าธรรมเนียม"
          )}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
          ประวัติรอบรับเงิน
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-slate-500 dark:text-slate-300">
              <tr>
                <th className="p-2 text-left">เลขที่</th>
                <th className="p-2 text-left">อ้างอิง</th>
                <th className="p-2 text-left">วันที่</th>
                <th className="p-2 text-right">ยอดขาย</th>
                <th className="p-2 text-right">ยอดคืน</th>
                <th className="p-2 text-right">ค่าธรรมเนียม</th>
                <th className="p-2 text-right">รับเพิ่ม</th>
                <th className="p-2 text-right">รับจริง</th>
                <th className="p-2 text-left">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    ยังไม่มีรอบรับเงิน
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-2 font-mono">
                      <Link
                        href={`/admin/marketplace/settlements/${row.id}`}
                        className="text-sky-700 hover:underline dark:text-sky-300"
                      >
                        {row.no}
                      </Link>
                    </td>
                    <td className="p-2">{row.ref}</td>
                    <td className="p-2">{row.date}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.sales)}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.returns)}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.fees)}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.income)}</td>
                    <td className="p-2 text-right font-medium tabular-nums">{money(row.payout)}</td>
                    <td className="p-2">{row.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</td>
                    <td className="p-2 text-right">
                      {canCancel && row.status === "ACTIVE" ? (
                        <button
                          type="button"
                          disabled={pending}
                          aria-busy={pending && pendingAction === row.id}
                          className="inline-flex items-center gap-1.5 text-red-600 disabled:cursor-wait disabled:opacity-60"
                          onClick={() => {
                            const reason = window.prompt("เหตุผลที่ยกเลิกรอบรับเงิน");
                            if (!reason) return;
                            setPendingAction(row.id);
                            startTransition(async () => {
                              try {
                                const result = await cancelMarketplaceSettlement(row.id, reason);
                                setIsError(Boolean(result.error));
                                setMessage(result.error ?? "ยกเลิกรอบรับเงินแล้ว");
                              } finally {
                                setPendingAction(null);
                              }
                            });
                          }}
                        >
                          {pending && pendingAction === row.id ? (
                            <>
                              <LoaderCircle size={14} className="animate-spin" />
                              กำลังยกเลิก...
                            </>
                          ) : (
                            "ยกเลิก"
                          )}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
