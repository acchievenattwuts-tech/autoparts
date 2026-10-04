"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";

import type { PurchaseBudgetLedgerDayRow, PurchaseBudgetLedgerDoc } from "@/lib/purchase-budget-ledger";

import { loadPurchaseBudgetLedgerDay, loadPurchaseBudgetLedgerPage } from "../purchase-budget-ledger-actions";
import {
  BUDGET_PANEL_CLASS,
  BUDGET_PANEL_TITLE_CLASS,
  budgetAmountTone,
  formatBaht,
  formatSignedBaht,
} from "@/components/shared/purchase-budget-ui";

/**
 * The entries that moved the purchase budget, hidden until asked for: "แสดงรายการ" loads the days
 * (newest first) at that moment, a day loads its documents when opened, and a document number opens
 * that document. Nothing here is loaded with the dashboard.
 */

type DayState =
  | { status: "loading" }
  | { status: "ready"; documents: PurchaseBudgetLedgerDoc[] }
  | { status: "error"; message: string };

const LIST_ERROR = "โหลดรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const DAY_ERROR = "โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

const buttonCls =
  "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/5";
const mutedTextCls = "text-sm text-slate-500 dark:text-slate-400";
const alertCls =
  "flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300";

const Loading = ({ text }: { text: string }) => (
  <p className={`flex items-center gap-2 py-2 ${mutedTextCls}`}>
    <Loader2 size={14} className="animate-spin" aria-hidden /> {text}
  </p>
);

const DocRow = ({ doc }: { doc: PurchaseBudgetLedgerDoc }) => (
  <li className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-b-0 dark:border-white/10">
    <span className="min-w-0">
      <span
        className={`mr-1.5 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${doc.kind === "budget"
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"}`}
      >
        {doc.typeLabel}
      </span>
      {doc.kind === "budget" ? (
        <span className="text-slate-600 dark:text-slate-300">
          โดย {doc.partner ?? "-"}
          {doc.note && doc.note !== "-" ? ` · เหตุผล: ${doc.note}` : ""}
        </span>
      ) : (
        <>
          {doc.href ? (
            <Link href={doc.href} prefetch={false} className="font-semibold text-[#1e3a5f] hover:underline dark:text-sky-300">
              {doc.docNo}
            </Link>
          ) : (
            <span className="font-semibold text-slate-900 dark:text-slate-100">{doc.docNo}</span>
          )}
          {doc.partner ? <span className="text-slate-500 dark:text-slate-400"> · {doc.partner}</span> : null}
        </>
      )}
    </span>
    <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${budgetAmountTone(doc.amount)}`}>
      {formatSignedBaht(doc.amount)}
    </span>
  </li>
);

const DayDocuments = ({ id, state, entryCount, onRetry }: { id: string; state: DayState | undefined; entryCount: number; onRetry: () => void }) => {
  if (!state || state.status === "loading") {
    return <div id={id} className="pb-2 pl-6"><Loading text="กำลังโหลดเอกสาร…" /></div>;
  }
  if (state.status === "error") {
    return (
      <div id={id} className="pb-2 pl-6">
        <div role="alert" className={alertCls}>
          {state.message}
          <button type="button" onClick={onRetry} className="font-semibold underline">ลองใหม่</button>
        </div>
      </div>
    );
  }
  if (state.documents.length === 0) {
    return <p id={id} className={`pb-2 pl-6 ${mutedTextCls}`}>ไม่มีเอกสารในวันนี้</p>;
  }
  return (
    <div id={id} className="pb-2 pl-6">
      <ul className="rounded-lg bg-slate-50 px-3 py-1 dark:bg-white/5">
        {state.documents.map((doc) => <DocRow key={doc.key} doc={doc} />)}
      </ul>
      {state.documents.length < entryCount ? (
        <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">แสดง {state.documents.length} จาก {entryCount} รายการ</p>
      ) : null}
    </div>
  );
};

const DaySummary = ({ day, isOpen }: { day: PurchaseBudgetLedgerDayRow; isOpen: boolean }) => (
  <>
    <span className="flex w-full items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        {isOpen ? <ChevronDown size={16} className="shrink-0" aria-hidden /> : <ChevronRight size={16} className="shrink-0" aria-hidden />}
        <span className="font-semibold text-slate-900 dark:text-slate-100">{day.label}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{day.entryCount} รายการ</span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-900 dark:text-slate-100">
        <span className="text-xs text-slate-500 dark:text-slate-400">คงเหลือสิ้นวัน </span>
        {formatBaht(day.endBalance)}
      </span>
    </span>
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-xs tabular-nums">
      {day.budgetChange !== 0 ? (
        <span className="text-indigo-700 dark:text-indigo-300">ตั้ง/ปรับงบ {formatSignedBaht(day.budgetChange)}</span>
      ) : null}
      {day.plus !== 0 ? <span className={budgetAmountTone(day.plus)}>บวกงบ {formatSignedBaht(day.plus)}</span> : null}
      {day.minus !== 0 ? <span className={budgetAmountTone(day.minus)}>หักงบ {formatSignedBaht(day.minus)}</span> : null}
      <span className="text-slate-500 dark:text-slate-400">สุทธิ {formatSignedBaht(day.net)}</span>
    </span>
  </>
);

const PurchaseBudgetLedger = () => {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<PurchaseBudgetLedgerDayRow[] | null>(null);
  const [startedOnLabel, setStartedOnLabel] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [listError, setListError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dayStates, setDayStates] = useState<Record<string, DayState>>({});
  const [listPending, startListTransition] = useTransition();
  const [, startDayTransition] = useTransition();

  const loadPage = (offset: number) => {
    setListError("");
    startListTransition(async () => {
      try {
        const result = await loadPurchaseBudgetLedgerPage(offset);
        if (result.error) { setListError(result.error); return; }
        const page = result.page;
        if (!page) { setDays([]); setNextOffset(null); return; }
        setStartedOnLabel(page.startedOnLabel);
        setDays((current) => (offset === 0 || !current ? page.days : [...current, ...page.days]));
        setNextOffset(page.hasMore ? page.nextOffset : null);
      } catch {
        setListError(LIST_ERROR);
      }
    });
  };

  /** Every "แสดงรายการ" (and "โหลดใหม่") queries again, so the list is as of that click. */
  const show = () => {
    setOpen(true);
    setDays(null);
    setNextOffset(null);
    setExpanded({});
    setDayStates({});
    loadPage(0);
  };

  const loadDay = (dateKey: string) => {
    setDayStates((current) => ({ ...current, [dateKey]: { status: "loading" } }));
    startDayTransition(async () => {
      let next: DayState;
      try {
        const result = await loadPurchaseBudgetLedgerDay(dateKey);
        next = result.error ? { status: "error", message: result.error } : { status: "ready", documents: result.documents ?? [] };
      } catch {
        next = { status: "error", message: DAY_ERROR };
      }
      setDayStates((current) => ({ ...current, [dateKey]: next }));
    });
  };

  const toggleDay = (dateKey: string) => {
    const willOpen = !expanded[dateKey];
    setExpanded((current) => ({ ...current, [dateKey]: willOpen }));
    const status = dayStates[dateKey]?.status;
    if (willOpen && status !== "ready" && status !== "loading") loadDay(dateKey);
  };

  const retryList = () => loadPage(days && days.length > 0 && nextOffset !== null ? nextOffset : 0);

  return (
    <div className={`flex flex-col gap-3 ${BUDGET_PANEL_CLASS}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={BUDGET_PANEL_TITLE_CLASS}>รายการที่หักและเพิ่มงบ</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {open && startedOnLabel ? `ตั้งแต่ ${startedOnLabel} · ` : ""}แยกตามวันที่ กดวันที่เพื่อดูเอกสาร กดเลขที่เอกสารเพื่อเปิดเอกสาร
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button type="button" onClick={show} disabled={listPending} className={buttonCls}>
              <RefreshCw size={15} aria-hidden /> โหลดใหม่
            </button>
          ) : null}
          <button type="button" onClick={open ? () => setOpen(false) : show} aria-expanded={open} className={buttonCls}>
            {open ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            {open ? "ซ่อนรายการ" : "แสดงรายการ"}
          </button>
        </div>
      </div>

      {open ? (
        <div aria-busy={listPending}>
          {days === null ? (
            listError ? null : <Loading text="กำลังโหลดรายการ…" />
          ) : days.length === 0 ? (
            <p className={`py-2 ${mutedTextCls}`}>ยังไม่มีรายการตั้งแต่วันเริ่มนับ</p>
          ) : (
            <ul>
              {days.map((day) => {
                const isOpen = Boolean(expanded[day.dateKey]);
                const panelId = `purchase-budget-day-${day.dateKey}`;
                return (
                  <li key={day.dateKey} className="border-b border-slate-100 last:border-b-0 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleDay(day.dateKey)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      className="flex w-full flex-col gap-1 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <DaySummary day={day} isOpen={isOpen} />
                    </button>
                    {isOpen ? (
                      <DayDocuments id={panelId} state={dayStates[day.dateKey]} entryCount={day.entryCount} onRetry={() => loadDay(day.dateKey)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {listError ? (
            <div role="alert" className={`mt-2 ${alertCls}`}>
              {listError}
              <button type="button" onClick={retryList} disabled={listPending} className="font-semibold underline">ลองใหม่</button>
            </div>
          ) : null}
          {days !== null && listPending ? <Loading text="กำลังโหลดรายการ…" /> : null}
          {days !== null && nextOffset !== null && !listPending ? (
            <button type="button" onClick={() => loadPage(nextOffset)} className={`mt-2 ${buttonCls}`}>
              โหลดวันที่เก่ากว่า
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default PurchaseBudgetLedger;
