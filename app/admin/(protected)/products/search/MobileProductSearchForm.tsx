"use client";

import { useEffect, useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";

import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

type Option = { id: string; name: string };
type CarBrandOption = Option & { models: Option[] };
type FilterDraft = {
  categoryId: string;
  brandId: string;
  carBrandId: string;
  carModelId: string;
  priceMin: string;
  priceMax: string;
  stockStatus: string;
  statusFilter: string;
  trackingFilter: string;
};
type PendingAction = "search" | "filter" | "clear";
type PendingFeedback = { action: PendingAction; href: string };

type Props = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  priceMin?: string;
  priceMax?: string;
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

const buildUrl = (params: Record<string, string | undefined>) => {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return `/admin/products/search${query ? `?${query}` : ""}`;
};

export default function MobileProductSearchForm({
  search,
  categoryId,
  brandId,
  carBrandId,
  carModelId,
  priceMin,
  priceMax,
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
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>({
    categoryId: categoryId ?? "",
    brandId: brandId ?? "",
    carBrandId: carBrandId ?? "",
    carModelId: carModelId ?? "",
    priceMin: priceMin ?? "",
    priceMax: priceMax ?? "",
    stockStatus: stockStatus ?? "",
    statusFilter: statusFilter ?? "",
    trackingFilter: trackingFilter ?? "",
  });

  const selectedCarBrand = useMemo(
    () => carBrands.find((brand) => brand.id === draft.carBrandId),
    [carBrands, draft.carBrandId],
  );

  const activeFilterCount = [
    search,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    priceMin || priceMax,
    stockStatus,
    statusFilter,
    trackingFilter,
  ].filter(Boolean).length;
  const pendingAction = pendingFeedback?.href === currentSearchHref ? null : (pendingFeedback?.action ?? null);
  const isSubmitting = isRoutePending || pendingAction !== null;

  const navigateWithFeedback = (href: string, action: PendingAction) => {
    if (href === currentSearchHref) {
      setPendingFeedback(null);
      return;
    }

    setPendingFeedback({ action, href });
    startRouteTransition(() => {
      router.push(href);
    });
  };

  const searchWithCurrentFilters = (query: string) => {
    navigateWithFeedback(
      buildUrl({
        search: query.trim(),
        categoryId,
        brandId,
        carBrandId,
        carModelId,
        priceMin,
        priceMax,
        stockStatus,
        statusFilter,
        trackingFilter,
      }),
      "search",
    );
  };

  const applyFilters = () => {
    setFilterOpen(false);
    navigateWithFeedback(buildUrl({ search, ...draft }), "filter");
  };

  const clearFilters = () => {
    setFilterOpen(false);
    navigateWithFeedback(buildUrl({ search }), "clear");
  };

  const setSingle = (key: keyof FilterDraft, value: string) => {
    setDraft((prev) => {
      const nextValue = prev[key] === value ? "" : value;
      if (key === "carBrandId") {
        return { ...prev, carBrandId: nextValue, carModelId: "" };
      }
      return { ...prev, [key]: nextValue };
    });
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
            onSubmit={searchWithCurrentFilters}
            adminReturnTo={currentSearchHref}
            inputClassName={`h-12 rounded-xl border-gray-300 bg-white text-[15px] shadow-sm dark:border-white/10 dark:bg-slate-900 ${isSubmitting ? "opacity-75" : ""}`}
          />
        </div>
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          disabled={isSubmitting}
          className="relative flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-[#1e3a5f] shadow-sm transition active:scale-95 dark:border-white/10 dark:bg-slate-900 dark:text-sky-300"
          aria-label="เปิดตัวกรอง"
        >
          {pendingAction === "filter" ? <Loader2 size={19} className="animate-spin" /> : <SlidersHorizontal size={19} />}
          <span className="hidden text-sm font-semibold sm:inline">ตัวกรอง</span>
          {activeFilterCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1 text-[11px] font-bold text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
      </div>

      {isSubmitting ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 shadow-sm dark:border-orange-400/30 dark:bg-orange-500/15 dark:text-orange-100">
          <Loader2 size={14} className="animate-spin" />
          <span>{pendingAction === "filter" ? "กำลังกรองสินค้า..." : pendingAction === "clear" ? "กำลังล้างตัวกรอง..." : "กำลังค้นหาสินค้า..."}</span>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Search size={13} />
          พบ {resultCount.toLocaleString("th-TH")} รายการ
        </span>
        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={() => navigateWithFeedback("/admin/products/search", "clear")}
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
        onClose={() => setFilterOpen(false)}
        draft={draft}
        setDraft={setDraft}
        categories={categories}
        partsBrands={partsBrands}
        carBrands={carBrands}
        selectedCarBrand={selectedCarBrand}
        setSingle={setSingle}
        clearFilters={clearFilters}
        applyFilters={applyFilters}
        isSubmitting={isSubmitting}
        pendingAction={pendingAction}
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
  setSingle: (key: keyof FilterDraft, value: string) => void;
  clearFilters: () => void;
  applyFilters: () => void;
  isSubmitting: boolean;
  pendingAction: PendingAction | null;
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
  clearFilters,
  applyFilters,
  isSubmitting,
  pendingAction,
}: FilterSheetProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const resolveDarkMode = () => {
      setIsDarkMode(
        document.documentElement.classList.contains("dark") ||
          document.body.classList.contains("dark") ||
          Boolean(document.querySelector(".dark")),
      );
    };

    resolveDarkMode();

    const observer = new MutationObserver(resolveDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return (
    <div className={`${isDarkMode ? "dark" : ""} fixed inset-0 z-[120]`} role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        aria-label="ปิดตัวกรอง"
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 bottom-0 top-10 z-10 flex flex-col overflow-hidden rounded-t-[26px] border border-gray-200 bg-white text-slate-900 shadow-2xl dark:border-slate-600 dark:bg-[#111827] dark:text-white sm:mx-auto sm:max-w-md"
        aria-busy={isSubmitting}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-600 dark:bg-[#111827]">
          <h2 className="font-kanit text-lg font-semibold text-slate-950 dark:text-white">ตัวกรอง</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-100 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex-1 overflow-y-auto bg-white px-5 py-4 dark:bg-[#111827]">
          <div className="space-y-6">
            <CheckboxList
              title="หมวดหมู่สินค้า"
              items={categories}
              selected={draft.categoryId}
              onSelect={(id) => setSingle("categoryId", id)}
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
            <PriceRange
              priceMin={draft.priceMin}
              priceMax={draft.priceMax}
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
          {isSubmitting ? <FilterPendingOverlay pendingAction={pendingAction} /> : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] dark:border-slate-600 dark:bg-[#111827]">
          <button
            type="button"
            onClick={clearFilters}
            disabled={isSubmitting}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:border-red-300 hover:text-red-600 disabled:cursor-wait disabled:opacity-75 dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:hover:border-red-300 dark:hover:text-red-200"
          >
            {pendingAction === "clear" ? <Loader2 size={15} className="animate-spin" /> : null}
            ล้าง
          </button>
          <button
            type="button"
            onClick={applyFilters}
            disabled={isSubmitting}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#df7a32] text-sm font-semibold text-white transition hover:bg-[#cb6a25] disabled:cursor-wait disabled:opacity-85"
          >
            {pendingAction === "filter" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            ตกลง
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterPendingOverlay({ pendingAction }: { pendingAction: PendingAction | null }) {
  const label =
    pendingAction === "clear"
      ? "กำลังล้างตัวกรอง..."
      : pendingAction === "filter"
        ? "กำลังกรองสินค้า..."
        : "กำลังค้นหาสินค้า...";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 px-6 backdrop-blur-sm dark:bg-[#111827]/82">
      <div className="flex min-w-48 flex-col items-center gap-3 rounded-2xl border border-orange-200 bg-white px-5 py-4 text-center text-sm font-semibold text-slate-900 shadow-xl dark:border-orange-300/40 dark:bg-slate-900 dark:text-white">
        <Loader2 size={24} className="animate-spin text-[#df7a32]" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-200 dark:bg-slate-600" />;
}

function CheckboxList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: Option[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT);

  return (
    <section>
      <h3 className="mb-3 font-kanit text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
      <div className="space-y-2">
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
                checked={selected === item.id}
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

function PriceRange({
  priceMin,
  priceMax,
  onChange,
}: {
  priceMin: string;
  priceMax: string;
  onChange: (next: { priceMin: string; priceMax: string }) => void;
}) {
  return (
    <section>
      <h3 className="mb-3 font-kanit text-base font-semibold text-slate-950 dark:text-white">ช่วงราคา</h3>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          type="number"
          value={priceMin}
          min={0}
          placeholder="ต่ำสุด"
          onChange={(event) => onChange({ priceMin: event.target.value, priceMax })}
          className="h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
        />
        <span className="text-slate-400">-</span>
        <input
          type="number"
          value={priceMax}
          min={0}
          placeholder="สูงสุด"
          onChange={(event) => onChange({ priceMin, priceMax: event.target.value })}
          className="h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
        />
      </div>
    </section>
  );
}
