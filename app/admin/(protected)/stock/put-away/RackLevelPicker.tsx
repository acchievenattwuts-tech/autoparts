"use client";

import { formatShelfLocationCode } from "@/lib/shelf-location-rules";
import { cn } from "@/lib/utils";

export type PutAwayRack = { id: string; code: string; name: string | null; levels: number };
export type PutAwayTarget = { rackId: string; level: number; code: string };

type RackLevelPickerProps = {
  racks: readonly PutAwayRack[];
  value: PutAwayTarget | null;
  onChange: (target: PutAwayTarget) => void;
  disabled?: boolean;
  idPrefix: string;
};

const choiceCls =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-60";
const idleCls =
  "border-gray-200 bg-white text-slate-700 hover:border-[#1e3a5f]/40 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5";
const activeCls =
  "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-sky-400/60 dark:bg-sky-500/25 dark:text-sky-100";

export const toPutAwayTarget = (rack: PutAwayRack, level: number): PutAwayTarget => ({
  rackId: rack.id,
  level,
  code: formatShelfLocationCode(rack.code, level),
});

/**
 * Two rows of large buttons, made for a phone held in front of the shelf: tap the rack,
 * then the level. Levels run from 1 (the bottom shelf) upwards, as written on the rack.
 */
const RackLevelPicker = ({ racks, value, onChange, disabled = false, idPrefix }: RackLevelPickerProps) => {
  const selectedRack = racks.find((rack) => rack.id === value?.rackId) ?? null;
  const pickRack = (rack: PutAwayRack) => {
    // Keep the chosen level when the new rack has it, so switching racks is one tap.
    const level = value && value.level <= rack.levels ? value.level : 1;
    onChange(toPutAwayTarget(rack, level));
  };

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-labelledby={`${idPrefix}-rack-label`} className="flex flex-wrap items-center gap-1.5">
        <span id={`${idPrefix}-rack-label`} className="w-14 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
          ชั้นวาง
        </span>
        {racks.map((rack) => {
          const active = rack.id === selectedRack?.id;
          return (
            <button
              key={rack.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={rack.name ?? undefined}
              disabled={disabled}
              onClick={() => pickRack(rack)}
              className={cn(choiceCls, "font-mono", active ? activeCls : idleCls)}
            >
              {rack.code}
            </button>
          );
        })}
      </div>
      {selectedRack ? (
        <div role="radiogroup" aria-labelledby={`${idPrefix}-level-label`} className="flex flex-wrap items-center gap-1.5">
          <span id={`${idPrefix}-level-label`} className="w-14 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
            ชั้น
          </span>
          {Array.from({ length: selectedRack.levels }, (_, index) => index + 1).map((level) => {
            const active = value?.level === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`ชั้น ${level}${level === 1 ? " (ล่างสุด)" : ""}`}
                disabled={disabled}
                onClick={() => onChange(toPutAwayTarget(selectedRack, level))}
                className={cn(choiceCls, "tabular-nums", active ? activeCls : idleCls)}
              >
                {level}
              </button>
            );
          })}
          <span className="text-xs text-slate-400 dark:text-slate-500">1 = ล่างสุด</span>
        </div>
      ) : (
        <p className="pl-[3.875rem] text-xs text-slate-400 dark:text-slate-500">เลือกชั้นวางก่อน แล้วจึงเลือกชั้น</p>
      )}
    </div>
  );
};

export default RackLevelPicker;
