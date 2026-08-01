"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";

import {
  buildAdminProductFilterQueryString,
  type AdminProductFilterParams,
} from "@/lib/admin-product-filter-params";
import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

type Option = { id: string; name: string };
type CarBrandOption = Option & { models: Option[] };
type FilterDraft = {
  /** หมวดหมู่เลือกได้หลายค่า — ค่าอื่นยังคงเลือกได้ค่าเดียว */
  categoryIds: string[];
  brandId: string;
  carBrandId: string;
  carModelId: string;
  yearMin: string;
  yearMax: string;
  stockStatus: string;
  statusFilter: string;
  trackingFilter: string;
};
type PendingAction = "search" | "clear";

type Props = {
  search?: string;
  categoryIds?: string[];
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  yearMin?: string;
  yearMax?: string;
  stockStatus?: string;
  statusFilter?: string;
  trackingFilter?: string;
  categories: Option[];
  partsBrands: Option[];
  carBrands: CarBrandOption[];
  resultCount: number;
  currentSearchHref: string;
};

const PREVIEW_COUNT = 6;

const EMPTY_FILTERS: FilterDraft = {
  categoryIds: [],
  brandId: "",
  carBrandId: "",
  carModelId: "",
  yearMin: "",
  yearMax: "",
  stockStatus: "",
  statusFilter: "",
  trackingFilter: "",
};

const stockOptions = [
  { id: "in_stock", name: "มีสต็อก" },
  { id: "low_stock", name: "สต็อกต่ำ" },
  { id: "out_of_stock", name: "หมดสต็อก" },
];

const statusOptions = [
  { id: "active", name: "ใช้งาน" },
  { id: "inactive", name: "ปิดใช้งาน" },
];

const trackingOptions = [
  { id: "tracked", name: "คำนวณสต็อก" },
  { id: "non_tracked", name: "ไม่คำนวณสต็อก" },
];

const buildUrl = (params: AdminProductFilterParams & { search?: string }) => {
  const query = buildAdminProductFilterQueryString(params);
  return `/admin/products/search${query ? `?${query}` : ""}`;
};

/**
 * ช่วงปีนับเป็นตัวกรองเดียว ไม่ใช่สองตัว เพื่อให้ตัวเลขบน badge ตรงกับที่ผู้ใช้เห็น
 * หมวดหมู่นับตามจำนวนหมวดที่เลือกจริง
 */
const countFilters = (filters: FilterDraft): number =>
  filters.categoryIds.length +
  [
    filters.brandId,
    filters.carBrandId,
    filters.carModelId,
    filters.yearMin || filters.yearMax,
    filters.stockStatus,
    filters.statusFilter,
    filters.trackingFilter,
  ].filter(Boolean).length;

const sameStringSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((value, index) => value === sortedB[index]);
};

const filtersAreEqual = (a: FilterDraft, b: FilterDraft): boolean =>
  sameStringSet(a.categoryIds, b.categoryIds) &&
  (Object.keys(EMPTY_FILTERS) as (keyof FilterDraft)[])
    .filter((key): key is Exclude<keyof FilterDraft, "categoryIds"> => key !== "categoryIds")
    .every((key) => a[key] === b[key]);

export default function MobileProductSearchForm({
  search,
  categoryIds,
  brandId,
  carBrandId,
  carModelId,
  yearMin,
  yearMax,
  stockStatus,
  statusFilter,
  trackingFilter,
  categories,
  partsBrands,
  carBrands,
  resultCount,
  currentSearchHref,
}: Props) {
  const router = useRouter();
  const [isRoutePending, startRouteTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(search ?? "");

  // join เป็นสตริงก่อน เพื่อให้ dependency ของ useMemo เทียบด้วยค่า ไม่ใช่ reference ของ array
  const categoryIdsKey = (categoryIds ?? []).join(",");

  // ชั้นที่ 3 — ตัวกรองที่ "ใช้จริง" อยู่ใน URL และตรงกับผลลัพธ์ที่แสดงอยู่
  const urlFilters = useMemo<FilterDraft>(
    () => ({
      categoryIds: categoryIdsKey ? categoryIdsKey.split(",") : [],
      brandId: brandId ?? "",
      carBrandId: carBrandId ?? "",
      carModelId: carModelId ?? "",
      yearMin: yearMin ?? "",
      yearMax: yearMax ?? "",
      stockStatus: stockStatus ?? "",
      statusFilter: statusFilter ?? "",
      trackingFilter: trackingFilter ?? "",
    }),
    [categoryIdsKey, brandId, carBrandId, carModelId, yearMin, yearMax, stockStatus, statusFilter, trackingFilter],
  );

  // ชั้นที่ 2 — ตัวกรองที่ "จำไว้" หลังกดตกลง ยังไม่ถูกใช้จนกว่าจะกดปุ่มค้นหา
  const [confirmedFilters, setConfirmedFilters] = useState<FilterDraft>(urlFilters);
  // ชั้นที่ 1 — ตัวกรองที่กำลังติ๊กอยู่ในชีต ถูก seed ใหม่ทุกครั้งที่เปิดชีต
  const [draft, setDraft] = useState<FilterDraft>(urlFilters);

  // URL เปลี่ยน (ค้นหาเสร็จ / กด back-forward / ล้างทั้งหมด) → sync ชั้นที่ 2 ให้ตรงเสมอ
  // ไม่มี effect นี้ ตัวกรองในชีตจะค้างค่าเก่าไม่ตรงกับผลลัพธ์ที่เห็น
  useEffect(() => {
    setConfirmedFilters(urlFilters);
  }, [urlFilters]);

  useEffect(() => {
    setSearchText(search ?? "");
  }, [search]);

  // ผูก pending กับ useTransition โดยตรง — transition จบเมื่อไหร่ป้ายโหลดหายเมื่อนั้น
  // จึงไม่มีทางค้างแม้ผู้ใช้กด back ระหว่างที่ยังโหลดไม่เสร็จ
  useEffect(() => {
    if (!isRoutePending) setPendingAction(null);
  }, [isRoutePending]);

  const selectedCarBrand = useMemo(
    () => carBrands.find((brand) => brand.id === draft.carBrandId),
    [carBrands, draft.carBrandId],
  );

  const confirmedFilterCount = countFilters(confirmedFilters);
  const isSubmitting = isRoutePending;
  const hasAppliedQuery = Boolean(search) || countFilters(urlFilters) > 0;
  const hasUnappliedChanges =
    !filtersAreEqual(confirmedFilters, urlFilters) || searchText.trim() !== (search ?? "");

  const navigateWithFeedback = (href: string, action: PendingAction) => {
    if (href === currentSearchHref) return;

    setPendingAction(action);
    startRouteTransition(() => {
      router.push(href);
    });
  };

  /** ปุ่ม "ค้นหา" และการกด Enter — จุดเดียวที่ยิงตัวกรองที่จำไว้ออกไปจริง */
  const runSearch = (query: string) => {
    navigateWithFeedback(buildUrl({ search: query.trim(), ...confirmedFilters }), "search");
  };

  const clearEverything = () => {
    setSearchText("");
    setDraft(EMPTY_FILTERS);
    setConfirmedFilters(EMPTY_FILTERS);
    navigateWithFeedback("/admin/products/search", "clear");
  };

  const openFilterSheet = () => {
    // seed ใหม่จากค่าที่ยืนยันล่าสุดเสมอ = ปิดชีตด้วย X/แตะพื้นหลังแล้วค่าที่เพิ่งติ๊กถูกทิ้ง
    setDraft(confirmedFilters);
    setFilterOpen(true);
  };

  const closeFilterSheet = useCallback(() => setFilterOpen(false), []);

  /** ตกลง = จำไว้เฉย ๆ ปิดชีต แต่ยังไม่ค้นหา */
  const confirmFilters = () => {
    setConfirmedFilters(draft);
    setFilterOpen(false);
  };

  /** ล้าง = เคลียร์เฉพาะสิ่งที่ติ๊กอยู่ในชีต ไม่ปิดชีต ไม่ค้นหา */
  const clearDraft = () => setDraft(EMPTY_FILTERS);

  type SingleFilterKey = Exclude<keyof FilterDraft, "categoryIds">;

  const setSingle = (key: SingleFilterKey, value: string) => {
    setDraft((prev) => {
      const nextValue = prev[key] === value ? "" : value;
      if (key === "carBrandId") {
        return { ...prev, carBrandId: nextValue, carModelId: "" };
      }
      return { ...prev, [key]: nextValue };
    });
  };

  /** หมวดหมู่เลือกได้หลายค่า — ติ๊กซ้ำคือเอาออก */
  const toggleCategory = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((value) => value !== id)
        : [...prev.categoryIds, id],
    }));
  };

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-gray-200/80 bg-white/95 px-4 pb-3 pt-2 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)] backdrop-blur supports-[backdrop-filter]:bg-white/90 dark:border-white/10 dark:bg-slate-950/95 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:rounded-[28px] lg:border lg:p-4 lg:shadow-[0_18px_50px_-34px_rgba(15,23,42,0.55)]">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ProductAutocomplete
            mode="admin"
            initialValue={search ?? ""}
            placeholder="ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ..."
            enhanced="mobile"
            onSubmit={runSearch}
            onValueChange={setSearchText}
            adminReturnTo={currentSearchHref}
            inputClassName={`h-12 rounded-xl border-gray-300 bg-white text-[15px] shadow-sm dark:border-white/10 dark:bg-slate-900 ${isSubmitting ? "opacity-75" : ""}`}
          />
        </div>
        <button
          type="button"
          onClick={openFilterSheet}
          disabled={isSubmitting}
          className="relative flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-[#1e3a5f] shadow-sm transition active:scale-95 disabled:cursor-wait disabled:opacity-70 dark:border-white/10 dark:bg-slate-900 dark:text-sky-300"
          aria-label="เปิดตัวกรอง"
        >
          <SlidersHorizontal size={19} />
          <span className="hidden text-sm font-semibold sm:inline">ตัวกรอง</span>
          {confirmedFilterCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1 text-[11px] font-bold text-white">
              {confirmedFilterCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => runSearch(searchText)}
          disabled={isSubmitting}
          className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#df7a32] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#cb6a25] active:scale-95 disabled:cursor-wait disabled:opacity-85"
        >
          {pendingAction === "search" ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Search size={18} />
          )}
          <span className="hidden sm:inline">ค้นหา</span>
        </button>
      </div>

      {isSubmitting ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 shadow-sm dark:border-orange-400/30 dark:bg-orange-500/15 dark:text-orange-100">
          <Loader2 size={14} className="animate-spin" />
          <span>{pendingAction === "clear" ? "กำลังล้างตัวกรอง..." : "กำลังค้นหาสินค้า..."}</span>
        </div>
      ) : hasUnappliedChanges ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 shadow-sm dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-100">
          <Search size={14} />
          <span>ตัวกรองที่เลือกไว้ยังไม่ถูกใช้ — กดปุ่ม &ldquo;ค้นหา&rdquo; เพื่อแสดงผลลัพธ์</span>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Search size={13} />
          พบ {resultCount.toLocaleString("th-TH")} รายการ
        </span>
        {hasAppliedQuery ? (
          <button
            type="button"
            onClick={clearEverything}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 font-medium text-gray-600 transition hover:text-red-600 disabled:cursor-wait disabled:opacity-70 dark:bg-white/10 dark:text-slate-300"
          >
            {pendingAction === "clear" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            ล้างทั้งหมด
          </button>
        ) : null}
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={closeFilterSheet}
        draft={draft}
        setDraft={setDraft}
        categories={categories}
        partsBrands={partsBrands}
        carBrands={carBrands}
        selectedCarBrand={selectedCarBrand}
        setSingle={setSingle}
        toggleCategory={toggleCategory}
        clearDraft={clearDraft}
        confirmFilters={confirmFilters}
      />
    </div>
  );
}

type FilterSheetProps = {
  open: boolean;
  onClose: () => void;
  draft: FilterDraft;
  setDraft: Dispatch<SetStateAction<FilterDraft>>;
  categories: Option[];
  partsBrands: Option[];
  carBrands: CarBrandOption[];
  selectedCarBrand?: CarBrandOption;
  setSingle: (key: Exclude<keyof FilterDraft, "categoryIds">, value: string) => void;
  toggleCategory: (id: string) => void;
  clearDraft: () => void;
  confirmFilters: () => void;
};

function FilterSheet(props: FilterSheetProps) {
  if (!props.open || typeof document === "undefined") return null;

  return createPortal(<FilterSheetContent {...props} />, document.body);
}

function FilterSheetContent({
  onClose,
  draft,
  setDraft,
  categories,
  partsBrands,
  carBrands,
  selectedCarBrand,
  setSingle,
  toggleCategory,
  clearDraft,
  confirmFilters,
}: FilterSheetProps) {
  // ฝั่งแอดมิน class `dark` อยู่ที่ `.admin-theme-root` (AdminShell) ไม่ใช่ <html>/<body>
  // ชีตนี้ถูก portal ไป document.body = อยู่นอก root นั้น → ต้องติด class เองจาก context
  // (แพตเทิร์นเดียวกับ SearchableSelect / ProductSearchSelect — context ไหลผ่าน portal ได้)
  const adminTheme = useOptionalAdminTheme();
  const isDark = adminTheme?.isDark ?? false;
  const draftCount = countFilters(draft);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={`${isDark ? "dark" : ""} fixed inset-0 z-[120]`} role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        aria-label="ปิดตัวกรอง"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 top-10 z-10 flex flex-col overflow-hidden rounded-t-[26px] border border-gray-200 bg-white text-slate-900 shadow-2xl dark:border-slate-600 dark:bg-[#111827] dark:text-white sm:mx-auto sm:max-w-md">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-600 dark:bg-[#111827]">
          <h2 className="font-kanit text-lg font-semibold text-slate-950 dark:text-white">ตัวกรอง</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-100 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 dark:bg-[#111827]">
          <div className="space-y-6">
            <CheckboxList
              title="หมวดหมู่สินค้า"
              subtitle="เลือกได้มากกว่า 1 หมวด"
              items={categories}
              selected={draft.categoryIds}
              onSelect={toggleCategory}
            />
            <Divider />
            <CheckboxList
              title="แบรนด์อะไหล่"
              items={partsBrands}
              selected={draft.brandId}
              onSelect={(id) => setSingle("brandId", id)}
            />
            <Divider />
            <CheckboxList
              title="ยี่ห้อรถ"
              items={carBrands}
              selected={draft.carBrandId}
              onSelect={(id) => setSingle("carBrandId", id)}
            />
            {selectedCarBrand ? (
              <>
                <Divider />
                <CheckboxList
                  title={`รุ่นรถ ${selectedCarBrand.name}`}
                  items={selectedCarBrand.models}
                  selected={draft.carModelId}
                  onSelect={(id) => setSingle("carModelId", id)}
                />
              </>
            ) : null}
            <Divider />
            <YearRange
              yearMin={draft.yearMin}
              yearMax={draft.yearMax}
              onChange={(next) => setDraft((prev) => ({ ...prev, ...next }))}
            />
            <Divider />
            <CheckboxList
              title="สต็อก"
              items={stockOptions}
              selected={draft.stockStatus}
              onSelect={(id) => setSingle("stockStatus", id)}
            />
            <Divider />
            <CheckboxList
              title="สถานะสินค้า"
              items={statusOptions}
              selected={draft.statusFilter}
              onSelect={(id) => setSingle("statusFilter", id)}
            />
            <Divider />
            <CheckboxList
              title="การคำนวณสต็อก"
              items={trackingOptions}
              selected={draft.trackingFilter}
              onSelect={(id) => setSingle("trackingFilter", id)}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] dark:border-slate-600 dark:bg-[#111827]">
          <button
            type="button"
            onClick={clearDraft}
            disabled={draftCount === 0}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:hover:border-red-300 dark:hover:text-red-200"
          >
            <RotateCcw size={15} />
            ล้าง
          </button>
          <button
            type="button"
            onClick={confirmFilters}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#df7a32] text-sm font-semibold text-white transition hover:bg-[#cb6a25]"
          >
            <Check size={16} />
            ตกลง
          </button>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-200 dark:bg-slate-600" />;
}

function CheckboxList({
  title,
  subtitle,
  items,
  selected,
  onSelect,
}: {
  title: string;
  subtitle?: string;
  items: Option[];
  /** string = เลือกได้ค่าเดียว, string[] = เลือกได้หลายค่า */
  selected: string | string[];
  onSelect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT);
  const isChecked = (id: string) =>
    Array.isArray(selected) ? selected.includes(id) : selected === id;

  return (
    <section>
      <h3 className="mb-1 font-kanit text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
      {subtitle ? (
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-300">{subtitle}</p>
      ) : null}
      <div className="mt-2 space-y-2">
        {visible.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-300">ยังไม่มีข้อมูล</p>
        ) : (
          visible.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg py-1 text-sm leading-6 text-slate-600 transition hover:text-slate-950 dark:font-medium dark:text-white dark:hover:text-white"
            >
              <input
                type="checkbox"
                checked={isChecked(item.id)}
                onChange={() => onSelect(item.id)}
                className="h-4 w-4 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316] dark:border-slate-400 dark:bg-slate-800 dark:checked:border-[#f97316]"
              />
              <span className="min-w-0 flex-1">{item.name}</span>
            </label>
          ))
        )}
      </div>
      {items.length > PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg py-1 text-xs text-slate-500 transition hover:text-slate-950 dark:font-medium dark:text-white dark:hover:text-white"
        >
          {showAll ? "ย่อ" : "เพิ่มเติม"}
          <ChevronDown size={13} className={`transition-transform ${showAll ? "rotate-180" : ""}`} />
        </button>
      ) : null}
    </section>
  );
}

function YearRange({
  yearMin,
  yearMax,
  onChange,
}: {
  yearMin: string;
  yearMax: string;
  onChange: (next: { yearMin: string; yearMax: string }) => void;
}) {
  const isInvalidRange = Boolean(yearMin && yearMax && Number(yearMin) > Number(yearMax));

  return (
    <section>
      <h3 className="mb-3 font-kanit text-base font-semibold text-slate-950 dark:text-white">ช่วงปีรถ</h3>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          type="number"
          value={yearMin}
          min={1900}
          max={2200}
          placeholder="ปีเริ่ม"
          onChange={(event) => onChange({ yearMin: event.target.value, yearMax })}
          className="h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
        />
        <span className="text-slate-400">-</span>
        <input
          type="number"
          value={yearMax}
          min={1900}
          max={2200}
          placeholder="ปีสิ้นสุด"
          onChange={(event) => onChange({ yearMin, yearMax: event.target.value })}
          className="h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
        />
      </div>
      {isInvalidRange ? (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">
          ปีเริ่มต้องไม่มากกว่าปีสิ้นสุด
        </p>
      ) : null}
    </section>
  );
}
