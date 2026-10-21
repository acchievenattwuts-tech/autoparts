"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

import type { PutAwayItem, PutAwayTab } from "@/lib/shelf-put-away";
import { cn } from "@/lib/utils";
import { putAwayProductsAction } from "./actions";
import PutAwayCard from "./PutAwayCard";
import RackLevelPicker, { type PutAwayRack, type PutAwayTarget } from "./RackLevelPicker";

type PutAwayListProps = {
  items: readonly PutAwayItem[];
  tab: PutAwayTab;
  racks: readonly PutAwayRack[];
};

const RECENT_STORAGE_KEY = "autoparts.putAway.recentTargets";
const RECENT_LIMIT = 3;

const isTarget = (value: unknown): value is PutAwayTarget =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PutAwayTarget).rackId === "string" &&
  typeof (value as PutAwayTarget).level === "number" &&
  typeof (value as PutAwayTarget).code === "string";

const RECENT_CHANGED_EVENT = "autoparts:put-away-recent";

/** The stored JSON string is the snapshot: a primitive, so React can compare it between renders. */
const readRecentSnapshot = (): string => {
  try {
    return window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};

const subscribeRecent = (onChange: () => void): (() => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECENT_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RECENT_CHANGED_EVENT, onChange);
  };
};

const parseRecent = (snapshot: string): PutAwayTarget[] => {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return Array.isArray(parsed) ? parsed.filter(isTarget).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
};

const writeRecent = (targets: readonly PutAwayTarget[]): void => {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(targets));
    window.dispatchEvent(new Event(RECENT_CHANGED_EVENT));
  } catch {
    // Storage blocked (private mode): the shortcut list simply is not remembered.
  }
};

type Feedback = { tone: "success" | "error"; text: string; failed: { code: string; error: string }[] };

const primaryButtonCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500";

/** The cards of one tab, plus the bulk bar for several products going to the same place. */
const PutAwayList = ({ items, tab, racks }: PutAwayListProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checkedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<PutAwayTarget | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const recentSnapshot = useSyncExternalStore(subscribeRecent, readRecentSnapshot, () => "[]");
  const recent = useMemo(() => parseRecent(recentSnapshot), [recentSnapshot]);

  // Rows leave the list after a save; only selections still on the page count.
  const selectedIds = useMemo(() => {
    const visible = new Set(items.map((item) => item.id));
    return new Set([...checkedIds].filter((id) => visible.has(id)));
  }, [checkedIds, items]);

  const remember = (target: PutAwayTarget | null) => {
    if (!target) return;
    const rest = parseRecent(readRecentSnapshot()).filter(
      (item) => !(item.rackId === target.rackId && item.level === target.level),
    );
    writeRecent([target, ...rest].slice(0, RECENT_LIMIT));
  };

  const toggle = (productId: string) =>
    setSelectedIds(() => {
      const next = new Set(selectedIds);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const selectedCount = selectedIds.size;

  const runBulk = () => {
    if (tab === "unlocated" && !bulkTarget) {
      setFeedback({ tone: "error", text: "เลือกชั้นวางและชั้นก่อน", failed: [] });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const result = await putAwayProductsAction({
        productIds: [...selectedIds],
        action:
          tab === "unlocated" && bulkTarget
            ? { kind: "place", target: { rackId: bulkTarget.rackId, level: bulkTarget.level } }
            : { kind: "keepHome" },
      });
      if (!result.ok) {
        setFeedback({ tone: "error", text: result.error, failed: [] });
        return;
      }
      if (tab === "unlocated") remember(bulkTarget);
      setSelectedIds(new Set());
      setFeedback({
        tone: result.failed.length > 0 ? "error" : "success",
        text: `บันทึกแล้ว ${result.saved.toLocaleString("th-TH")} รายการ${
          result.failed.length > 0 ? ` · ไม่สำเร็จ ${result.failed.length.toLocaleString("th-TH")} รายการ` : ""
        }`,
        failed: result.failed,
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
            className="h-5 w-5 rounded border-gray-300 accent-[#1e3a5f] dark:border-slate-500 dark:accent-sky-400"
          />
          เลือกทั้งหน้า ({items.length.toLocaleString("th-TH")} รายการ)
        </label>
        {feedback ? (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
            )}
          >
            <div>
              <p>{feedback.text}</p>
              {feedback.failed.slice(0, 5).map((item) => (
                <p key={`${item.code}-${item.error}`} className="text-xs">
                  <span className="font-mono">{item.code}</span> — {item.error}
                </p>
              ))}
            </div>
            <button type="button" onClick={() => setFeedback(null)} aria-label="ปิดข้อความ" className="shrink-0 opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="sticky top-2 z-20 space-y-3 rounded-xl border border-[#1e3a5f]/30 bg-white p-4 shadow-lg dark:border-sky-400/30 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            เลือกไว้ {selectedCount.toLocaleString("th-TH")} รายการ
          </p>
          {tab === "unlocated" ? (
            <>
              <RackLevelPicker racks={racks} value={bulkTarget} onChange={setBulkTarget} disabled={isPending} idPrefix="put-away-bulk" />
              <button type="button" disabled={isPending || !bulkTarget} onClick={runBulk} className={cn(primaryButtonCls, "w-full sm:w-auto")}>
                {bulkTarget ? (
                  <>
                    ตั้งที่เก็บ <span className="font-mono">{bulkTarget.code}</span> ให้ {selectedCount.toLocaleString("th-TH")} รายการ
                  </>
                ) : (
                  "เลือกชั้นวางและชั้นก่อน"
                )}
              </button>
            </>
          ) : (
            <button type="button" disabled={isPending} onClick={runBulk} className={cn(primaryButtonCls, "w-full sm:w-auto")}>
              <CheckCircle2 size={16} />
              เก็บที่เดิมทั้งหมด {selectedCount.toLocaleString("th-TH")} รายการ
            </button>
          )}
        </div>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <PutAwayCard
            key={item.id}
            item={item}
            tab={tab}
            racks={racks}
            recent={recent}
            selected={selectedIds.has(item.id)}
            onToggleSelected={toggle}
            onSaved={remember}
          />
        ))}
      </ul>
    </div>
  );
};

export default PutAwayList;
