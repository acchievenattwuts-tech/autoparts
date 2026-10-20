"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";

import SearchableSelect from "@/components/shared/SearchableSelect";
import ShelfLocationBadges from "@/components/shared/ShelfLocationBadges";
import { MAX_SECONDARY_SHELF_LOCATIONS, SHELF_RULE_ERROR_MESSAGES } from "@/lib/shelf-location-rules";
import {
  buildShelfPrimaryOptions,
  formatShelfPrimaryValue,
  SHELF_KEEP_OLD_AS_SECONDARY_FIELD,
  SHELF_PRIMARY_FIELD,
  SHELF_PRIMARY_ORIGINAL_FIELD,
  type ShelfFormLocation,
  type ShelfRackOption,
} from "@/lib/shelf-product-form";

type ShelfPrimaryLocationFieldProps = {
  /** Active racks, in display order. */
  racks: readonly ShelfRackOption[];
  /** The product's current locations, home first then newest overflow (empty for a new product). */
  locations?: readonly ShelfFormLocation[];
  labelClassName: string;
  helpClassName: string;
  checkboxClassName: string;
};

const NO_LOCATIONS: readonly ShelfFormLocation[] = [];

const noticeCls =
  "mt-2 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs leading-relaxed " +
  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";

/**
 * "ที่เก็บประจำ" on the product form: picks the home rack + level and submits it as
 * `rackId:level` through hidden inputs (the save itself runs in the product Server Action).
 * Overflow locations are shown read-only; they are managed from the shelf map and badges.
 */
const ShelfPrimaryLocationField = ({
  racks,
  locations = NO_LOCATIONS,
  labelClassName,
  helpClassName,
  checkboxClassName,
}: ShelfPrimaryLocationFieldProps) => {
  const home = locations.find((location) => location.isPrimary) ?? null;
  const secondaries = locations.filter((location) => !location.isPrimary);
  const originalValue = home ? formatShelfPrimaryValue(home) : "";

  const [value, setValue] = useState(originalValue);
  const [keepOldAsSecondary, setKeepOldAsSecondary] = useState(false);
  const options = useMemo(() => buildShelfPrimaryOptions(racks, locations), [racks, locations]);

  const isMovingHome = home !== null && value !== "" && value !== originalValue;
  const isClearingHome = home !== null && value === "";
  const targetIsSecondary = secondaries.some((location) => formatShelfPrimaryValue(location) === value);
  const willExceedSecondaryLimit =
    isMovingHome && keepOldAsSecondary && !targetIsSecondary && secondaries.length >= MAX_SECONDARY_SHELF_LOCATIONS;

  return (
    <div>
      <label className={labelClassName}>ที่เก็บประจำ</label>
      <SearchableSelect
        options={options}
        value={value}
        onChange={setValue}
        placeholder="ยังไม่ระบุ"
        emptyTone="neutral"
      />
      <input type="hidden" name={SHELF_PRIMARY_FIELD} value={value} />
      <input type="hidden" name={SHELF_PRIMARY_ORIGINAL_FIELD} value={originalValue} />

      {isMovingHome && home && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input
            type="checkbox"
            name={SHELF_KEEP_OLD_AS_SECONDARY_FIELD}
            value="true"
            checked={keepOldAsSecondary}
            onChange={(event) => setKeepOldAsSecondary(event.target.checked)}
            className={`${checkboxClassName} mt-0.5 shrink-0`}
          />
          <span>
            ที่เดิม <span className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-200">{home.code}</span>{" "}
            ยังมีของเหลือ (เก็บไว้เป็นที่เก็บเพิ่ม)
          </span>
        </label>
      )}
      {willExceedSecondaryLimit && (
        <p className={noticeCls} role="alert">
          <Info size={14} className="mt-0.5 shrink-0" />
          {SHELF_RULE_ERROR_MESSAGES.SECONDARY_LIMIT}
        </p>
      )}
      {isClearingHome && secondaries.length > 0 && (
        <p className={noticeCls}>
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            เมื่อบันทึก ที่เก็บเพิ่มล่าสุด <span className="font-mono font-semibold">{secondaries[0].code}</span>{" "}
            จะกลายเป็นที่เก็บประจำแทน
          </span>
        </p>
      )}

      {secondaries.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
          <span>ที่เก็บเพิ่ม</span>
          <ShelfLocationBadges locations={secondaries} />
        </div>
      )}
      <p className={helpClassName}>
        {racks.length === 0
          ? "ยังไม่มีชั้นวางที่เปิดใช้งาน เพิ่มชั้นวางได้ที่เมนูผังชั้นวาง"
          : "ที่เก็บเพิ่ม (ของล้นจากที่ประจำ) เพิ่มหรือเอาออกได้ที่ผังชั้นวาง หรือกดป้ายตำแหน่งในหน้าค้นหาสินค้า"}
      </p>
    </div>
  );
};

export default ShelfPrimaryLocationField;
