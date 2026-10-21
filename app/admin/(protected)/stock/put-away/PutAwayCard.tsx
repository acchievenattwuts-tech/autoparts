"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, MapPinned, Sparkles } from "lucide-react";

import {
  changeShelfLocationAction,
  type ShelfLocationActionInput,
} from "@/app/admin/(protected)/stock/shelf-map/location-actions";
import ShelfLocationBadges from "@/components/shared/ShelfLocationBadges";
import type { PutAwayItem, PutAwayTab } from "@/lib/shelf-put-away";
import { cn } from "@/lib/utils";
import RackLevelPicker, { type PutAwayRack, type PutAwayTarget } from "./RackLevelPicker";

type PutAwayCardProps = {
  item: PutAwayItem;
  tab: PutAwayTab;
  racks: readonly PutAwayRack[];
  recent: readonly PutAwayTarget[];
  selected: boolean;
  onToggleSelected: (productId: string) => void;
  onSaved: (target: PutAwayTarget | null) => void;
};

type ElsewhereMode = "addSecondary" | "movePrimary";

const primaryButtonCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500";
const outlineButtonCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[#1e3a5f]/40 bg-white px-4 text-sm font-medium text-[#1e3a5f] transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-sky-400/40 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-white/5";
const ghostButtonCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-white/10";
const chipCls =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-60";

const sameTarget = (a: PutAwayTarget | null, b: Pick<PutAwayTarget, "rackId" | "level">): boolean =>
  a !== null && a.rackId === b.rackId && a.level === b.level;

type QuickChoicesProps = {
  item: PutAwayItem;
  recent: readonly PutAwayTarget[];
  racks: readonly PutAwayRack[];
  target: PutAwayTarget | null;
  onPick: (target: PutAwayTarget) => void;
  disabled: boolean;
};

/** The suggested location and the last places used on this device, one tap each. */
const QuickChoices = ({ item, recent, racks, target, onPick, disabled }: QuickChoicesProps) => {
  const activeRackIds = new Set(racks.map((rack) => rack.id));
  const suggestion = item.suggestion && activeRackIds.has(item.suggestion.rackId) ? item.suggestion : null;
  const recentChoices = recent.filter(
    (choice) => activeRackIds.has(choice.rackId) && !(suggestion && sameTarget(choice, suggestion)),
  );
  if (!suggestion && recentChoices.length === 0) return null;
  const chipState = (choice: Pick<PutAwayTarget, "rackId" | "level">): string =>
    sameTarget(target, choice)
      ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-sky-400/60 dark:bg-sky-500/25 dark:text-sky-100"
      : "border-gray-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {suggestion ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick({ rackId: suggestion.rackId, level: suggestion.level, code: suggestion.code })}
          className={cn(chipCls, chipState(suggestion))}
          title={`แนะนำจากสินค้าที่คล้ายกัน: ${suggestion.reason}`}
        >
          <Sparkles size={13} className="shrink-0 text-amber-500 dark:text-amber-300" />
          <span className="font-mono font-semibold">{suggestion.code}</span>
          <span className="max-w-[14rem] truncate opacity-80">{suggestion.reason}</span>
        </button>
      ) : null}
      {recentChoices.map((choice) => (
        <button
          key={`${choice.rackId}:${choice.level}`}
          type="button"
          disabled={disabled}
          onClick={() => onPick(choice)}
          className={cn(chipCls, chipState(choice))}
          title="ใช้ล่าสุดในเครื่องนี้"
        >
          <History size={13} className="shrink-0 opacity-70" />
          <span className="font-mono font-semibold">{choice.code}</span>
        </button>
      ))}
    </div>
  );
};

/** One product waiting to be put away, with the actions of its tab. */
const PutAwayCard = ({ item, tab, racks, recent, selected, onToggleSelected, onSaved }: PutAwayCardProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<PutAwayTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(tab === "unlocated" && !item.suggestion && recent.length === 0);
  const [elsewhere, setElsewhere] = useState(false);
  const [mode, setMode] = useState<ElsewhereMode>("addSecondary");
  const [keepOld, setKeepOld] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const home = item.locations.find((location) => location.isPrimary) ?? null;
  const overflow = item.locations.filter((location) => !location.isPrimary);
  const busy = isPending || done !== "";

  const save = (change: ShelfLocationActionInput["change"], savedTarget: PutAwayTarget | null) => {
    setError("");
    startTransition(async () => {
      const result = await changeShelfLocationAction({ productId: item.id, change, source: "put_away" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(result.message);
      onSaved(savedTarget);
      router.refresh();
    });
  };

  const saveTarget = () => {
    if (!target) {
      setError("เลือกชั้นวางและชั้นก่อน");
      return;
    }
    const where = { rackId: target.rackId, level: target.level };
    if (tab === "unlocated" || !home) {
      save({ kind: "place", target: where }, target);
    } else if (mode === "movePrimary") {
      save({ kind: "movePrimary", target: where, keepOldAsSecondary: keepOld }, target);
    } else {
      save({ kind: "addSecondary", target: where }, target);
    }
  };

  const pick = (next: PutAwayTarget) => {
    setError("");
    setTarget(next);
  };

  const showChooser = tab === "unlocated" || elsewhere;

  return (
    <li
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm transition-colors dark:bg-slate-950/80",
        selected ? "border-[#1e3a5f]/50 ring-1 ring-[#1e3a5f]/30 dark:border-sky-400/50 dark:ring-sky-400/30" : "border-gray-200 dark:border-white/10",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={busy}
          onChange={() => onToggleSelected(item.id)}
          aria-label={`เลือก ${item.code}`}
          className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 accent-[#1e3a5f] dark:border-slate-500 dark:accent-sky-400"
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">{item.code}</p>
          <p className="break-words font-medium leading-6 text-slate-900 dark:text-slate-100">{item.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {[item.brandName, item.categoryName].filter(Boolean).join(" · ")}
          </p>
          {item.fitmentLines.length > 0 ? (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {item.fitmentLines.join(" · ")}
              {item.fitmentHidden > 0 ? ` +${item.fitmentHidden} รุ่น` : ""}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm">
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {item.stock.toLocaleString("th-TH")}
            </span>{" "}
            <span className="text-xs text-slate-400 dark:text-slate-500">{item.unitName}</span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {item.receivedOn ? `รับเข้า ${item.receivedOn}` : "ยังไม่เคยรับเข้า"}
          </p>
        </div>
      </div>

      {tab === "received" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-white/10">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">ที่เก็บตอนนี้</span>
          <ShelfLocationBadges locations={item.locations} size="md" />
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {tab === "received" && home ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => save({ kind: "confirm", locationId: home.id }, null)} className={primaryButtonCls}>
              <CheckCircle2 size={16} />
              เก็บที่เดิม <span className="font-mono">{home.code}</span>
            </button>
            {overflow.map((location) => (
              <button
                key={location.id}
                type="button"
                disabled={busy}
                onClick={() => save({ kind: "confirm", locationId: location.id }, null)}
                className={outlineButtonCls}
              >
                เก็บที่ <span className="font-mono">{location.code}</span>
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setElsewhere((open) => !open)}
              aria-expanded={elsewhere}
              className={ghostButtonCls}
            >
              <MapPinned size={16} />
              ที่อื่น…
            </button>
          </div>
        ) : null}

        {showChooser ? (
          <div className={cn("space-y-3", tab === "received" && "rounded-lg bg-slate-50 p-3 dark:bg-white/5")}>
            {tab === "received" && home ? (
              <div className="space-y-2">
                <div role="radiogroup" aria-label="วางที่อื่นแบบไหน" className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "addSecondary", label: "เพิ่มเป็นที่เก็บเพิ่ม (ของล้น)" },
                      { value: "movePrimary", label: "ย้ายที่เก็บประจำ" },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm",
                        mode === option.value
                          ? "border-[#1e3a5f] text-[#1e3a5f] dark:border-sky-400/60 dark:text-sky-200"
                          : "border-gray-200 text-slate-600 dark:border-white/10 dark:text-slate-300",
                      )}
                    >
                      <input
                        type="radio"
                        name={`put-away-mode-${item.id}`}
                        checked={mode === option.value}
                        onChange={() => setMode(option.value)}
                        className="accent-[#1e3a5f] dark:accent-sky-400"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {mode === "movePrimary" ? (
                  <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={keepOld}
                      onChange={(event) => setKeepOld(event.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#1e3a5f] dark:accent-sky-400"
                    />
                    <span>
                      ที่เดิม <span className="font-mono font-semibold">{home.code}</span> ยังมีของเหลือ (เก็บไว้เป็นที่เก็บเพิ่ม)
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}

            <QuickChoices item={item} recent={recent} racks={racks} target={target} onPick={pick} disabled={busy} />

            {pickerOpen ? (
              <RackLevelPicker racks={racks} value={target} onChange={pick} disabled={busy} idPrefix={`put-away-${item.id}`} />
            ) : (
              <button type="button" disabled={busy} onClick={() => setPickerOpen(true)} className={ghostButtonCls}>
                <MapPinned size={16} />
                เลือกชั้นวางและชั้นเอง
              </button>
            )}

            <button type="button" disabled={busy || !target} onClick={saveTarget} className={cn(primaryButtonCls, "w-full sm:w-auto")}>
              {target ? (
                <>
                  บันทึกที่ <span className="font-mono">{target.code}</span>
                </>
              ) : (
                "เลือกที่เก็บก่อนบันทึก"
              )}
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
            {error}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
            {done}
          </p>
        ) : null}
      </div>
    </li>
  );
};

export default PutAwayCard;
