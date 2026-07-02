"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HIDE_STOREFRONT_PRICE } from "@/lib/storefront-pricing";

export type CarModel = { id: string; name: string };
export type CarBrand = { id: string; name: string; carModels: CarModel[] };
export type Category = { id: string; name: string };
export type PartsBrand = { id: string; name: string };

export type AppliedFilters = {
  categories: string[];
  partsBrands: string[];
  carBrands: string[];
  models: string[];
  yearMin: number | null;
  yearMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
};

export type DraftFilters = AppliedFilters;

export type ProductFilterData = {
  categories: Category[];
  carBrands: CarBrand[];
  partsBrands: PartsBrand[];
};

const CHEVRON_DOWN_ICON = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
  </svg>
);

const PREVIEW_COUNT = 6;

const sectionTitleClass = "font-kanit text-base font-semibold text-[#10213d]";

export const toggleValue = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export const filtersEqual = (a: AppliedFilters, b: AppliedFilters): boolean => {
  const arrEq = <T,>(x: T[], y: T[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    arrEq([...a.categories].sort(), [...b.categories].sort()) &&
    arrEq([...a.partsBrands].sort(), [...b.partsBrands].sort()) &&
    arrEq([...a.carBrands].sort(), [...b.carBrands].sort()) &&
    arrEq([...a.models].sort(), [...b.models].sort()) &&
    a.yearMin === b.yearMin &&
    a.yearMax === b.yearMax &&
    a.priceMin === b.priceMin &&
    a.priceMax === b.priceMax
  );
};

export const EMPTY_FILTERS: AppliedFilters = {
  categories: [],
  partsBrands: [],
  carBrands: [],
  models: [],
  yearMin: null,
  yearMax: null,
  priceMin: null,
  priceMax: null,
};

const numberToInputValue = (value: number | null): string =>
  value === null ? "" : String(value);

const inputValueToPrice = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const inputValueToYear = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2200) return null;
  return n;
};

type CheckboxListItem = { value: string; label: string };

type CheckboxListProps = {
  title: string;
  items: CheckboxListItem[];
  selected: string[];
  onToggle: (value: string) => void;
};

const CheckboxList = ({ title, items, selected, onToggle }: CheckboxListProps) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT);

  return (
    <section className="space-y-2">
      <h3 className={sectionTitleClass}>{title}</h3>
      <div className="space-y-1">
        {visible.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-400">ยังไม่มีข้อมูล</p>
        ) : (
          visible.map((item) => {
            const isChecked = selected.includes(item.value);
            return (
              <label
                key={item.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm leading-5 text-slate-700 transition hover:bg-slate-50 hover:text-[#10213d]"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(item.value)}
                  className="h-4 w-4 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316]"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </label>
            );
          })
        )}
      </div>
      {items.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:text-[#10213d]"
        >
          <span>{showAll ? "ย่อ" : "เพิ่มเติม"}</span>
          <span className={`transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden="true">
            {CHEVRON_DOWN_ICON}
          </span>
        </button>
      )}
    </section>
  );
};

type YearRangeProps = {
  yearMin: number | null;
  yearMax: number | null;
  onChange: (next: { yearMin: number | null; yearMax: number | null }) => void;
};

const YearRange = ({ yearMin, yearMax, onChange }: YearRangeProps) => {
  const [minRaw, setMinRaw] = useState(numberToInputValue(yearMin));
  const [maxRaw, setMaxRaw] = useState(numberToInputValue(yearMax));

  useEffect(() => {
    setMinRaw(numberToInputValue(yearMin));
  }, [yearMin]);
  useEffect(() => {
    setMaxRaw(numberToInputValue(yearMax));
  }, [yearMax]);

  const commit = (nextMinRaw: string, nextMaxRaw: string) => {
    onChange({
      yearMin: inputValueToYear(nextMinRaw),
      yearMax: inputValueToYear(nextMaxRaw),
    });
  };

  return (
    <section className="space-y-2">
      <h3 className={sectionTitleClass}>ปีรถ</h3>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1900}
          max={2200}
          step={1}
          placeholder="ปีต่ำสุด"
          value={minRaw}
          onChange={(e) => setMinRaw(e.target.value)}
          onBlur={() => commit(minRaw, maxRaw)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
        <span className="text-slate-400">—</span>
        <input
          type="number"
          inputMode="numeric"
          min={1900}
          max={2200}
          step={1}
          placeholder="ปีสูงสุด"
          value={maxRaw}
          onChange={(e) => setMaxRaw(e.target.value)}
          onBlur={() => commit(minRaw, maxRaw)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
      </div>
    </section>
  );
};

type PriceRangeProps = {
  priceMin: number | null;
  priceMax: number | null;
  onChange: (next: { priceMin: number | null; priceMax: number | null }) => void;
};

const PriceRange = ({ priceMin, priceMax, onChange }: PriceRangeProps) => {
  const [minRaw, setMinRaw] = useState(numberToInputValue(priceMin));
  const [maxRaw, setMaxRaw] = useState(numberToInputValue(priceMax));

  useEffect(() => {
    setMinRaw(numberToInputValue(priceMin));
  }, [priceMin]);
  useEffect(() => {
    setMaxRaw(numberToInputValue(priceMax));
  }, [priceMax]);

  const commit = (nextMinRaw: string, nextMaxRaw: string) => {
    onChange({
      priceMin: inputValueToPrice(nextMinRaw),
      priceMax: inputValueToPrice(nextMaxRaw),
    });
  };

  return (
    <section className="space-y-2">
      <h3 className={sectionTitleClass}>ช่วงราคา</h3>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step="any"
          placeholder="ราคาต่ำสุด"
          value={minRaw}
          onChange={(e) => setMinRaw(e.target.value)}
          onBlur={() => commit(minRaw, maxRaw)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
        <span className="text-slate-400">—</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step="any"
          placeholder="ราคาสูงสุด"
          value={maxRaw}
          onChange={(e) => setMaxRaw(e.target.value)}
          onBlur={() => commit(minRaw, maxRaw)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
      </div>
    </section>
  );
};

// ─── Accordion: car brand expands to show its models ────────────────────────

type ModelSubListProps = {
  brandName: string;
  models: CarModel[];
  selectedModels: string[];
  onToggle: (brandName: string, modelName: string) => void;
};

const ModelSubList = ({ brandName, models, selectedModels, onToggle }: ModelSubListProps) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? models : models.slice(0, PREVIEW_COUNT);

  if (models.length === 0) {
    return <p className="px-2 py-1 text-xs text-slate-400">ยังไม่มีรุ่นรถ</p>;
  }

  return (
    <div className="space-y-0.5">
      {visible.map((model) => {
        const isChecked = selectedModels.includes(model.name);
        return (
          <label
            key={model.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[13px] leading-5 text-slate-600 transition hover:bg-slate-50 hover:text-[#10213d]"
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(brandName, model.name)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316]"
            />
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
          </label>
        );
      })}
      {models.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-slate-500 transition hover:text-[#10213d]"
        >
          <span>{showAll ? "ย่อ" : `ดูทั้งหมด (${models.length})`}</span>
          <span className={`transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden="true">
            {CHEVRON_DOWN_ICON}
          </span>
        </button>
      )}
    </div>
  );
};

type CarBrandModelAccordionProps = {
  carBrands: CarBrand[];
  selectedBrands: string[];
  selectedModels: string[];
  onToggleBrand: (name: string) => void;
  onToggleModel: (brandName: string, modelName: string) => void;
};

const CarBrandModelAccordion = ({
  carBrands,
  selectedBrands,
  selectedModels,
  onToggleBrand,
  onToggleModel,
}: CarBrandModelAccordionProps) => {
  const [showAllBrands, setShowAllBrands] = useState(false);

  // Auto-expand brands that already have selections — done once on mount.
  const [expanded, setExpanded] = useState<string[]>(() => {
    const initial = new Set<string>();
    for (const brand of carBrands) {
      if (selectedBrands.includes(brand.name)) {
        initial.add(brand.name);
        continue;
      }
      if (brand.carModels.some((m) => selectedModels.includes(m.name))) {
        initial.add(brand.name);
      }
    }
    return Array.from(initial);
  });

  const visibleBrands = showAllBrands ? carBrands : carBrands.slice(0, PREVIEW_COUNT);

  const toggleExpand = (name: string) => {
    setExpanded((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <section className="space-y-2">
      <h3 className={sectionTitleClass}>ยี่ห้อรถ / รุ่นรถ</h3>
      <p className="text-xs text-slate-400">
        คลิกที่ยี่ห้อเพื่อดูรุ่นรถ — เลือกได้ทั้งระดับยี่ห้อและรุ่น
      </p>
      <div className="space-y-0.5">
        {visibleBrands.length === 0 ? (
          <p className="px-2 py-1 text-sm text-slate-400">ยังไม่มีข้อมูลยี่ห้อรถ</p>
        ) : (
          visibleBrands.map((brand) => {
            const isExpanded = expanded.includes(brand.name);
            const isBrandSelected = selectedBrands.includes(brand.name);
            const selectedModelCount = brand.carModels.filter((m) =>
              selectedModels.includes(m.name),
            ).length;

            return (
              <div
                key={brand.id}
                className={`overflow-hidden rounded-xl border transition ${
                  isExpanded
                    ? "border-[#1e3a5f]/15 bg-slate-50/60"
                    : "border-transparent"
                }`}
              >
                <div
                  className={`flex items-center gap-2 px-2 py-2 text-sm leading-5 ${
                    isBrandSelected ? "font-semibold text-[#10213d]" : "text-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isBrandSelected}
                    onChange={() => onToggleBrand(brand.name)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isBrandSelected && selectedModelCount > 0}
                    className="h-4 w-4 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316] disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`เลือก ${brand.name}`}
                    title={
                      isBrandSelected && selectedModelCount > 0
                        ? "ยกเลิกการเลือกรุ่นรถใต้ยี่ห้อนี้ก่อน"
                        : undefined
                    }
                  />
                  <button
                    type="button"
                    onClick={() => toggleExpand(brand.name)}
                    className="flex flex-1 items-center justify-between gap-2 text-left transition hover:text-[#10213d]"
                    aria-expanded={isExpanded}
                  >
                    <span className="min-w-0 flex-1 truncate">{brand.name}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {selectedModelCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1.5 text-[10px] font-semibold text-white">
                          {selectedModelCount}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {brand.carModels.length} รุ่น
                      </span>
                      <span
                        className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      >
                        {CHEVRON_DOWN_ICON}
                      </span>
                    </span>
                  </button>
                </div>
                {isExpanded && (
                  <div className="ml-6 border-l border-slate-200 pb-2 pl-3 pr-2">
                    <ModelSubList
                      brandName={brand.name}
                      models={brand.carModels}
                      selectedModels={selectedModels}
                      onToggle={onToggleModel}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {carBrands.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setShowAllBrands((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:text-[#10213d]"
        >
          <span>{showAllBrands ? "ย่อ" : `เพิ่มเติม (${carBrands.length - PREVIEW_COUNT})`}</span>
          <span className={`transition-transform ${showAllBrands ? "rotate-180" : ""}`} aria-hidden="true">
            {CHEVRON_DOWN_ICON}
          </span>
        </button>
      )}
    </section>
  );
};

type FilterBodyProps = {
  draft: DraftFilters;
  setDraft: (updater: (prev: DraftFilters) => DraftFilters) => void;
  filterData: ProductFilterData;
};

export const ProductFilterBody = ({ draft, setDraft, filterData }: FilterBodyProps) => {
  const { categories, partsBrands, carBrands } = filterData;

  return (
    <div className="space-y-5">
      <CheckboxList
        title="หมวดหมู่สินค้า"
        items={categories.map((c) => ({ value: c.name, label: c.name }))}
        selected={draft.categories}
        onToggle={(name) =>
          setDraft((prev) => ({ ...prev, categories: toggleValue(prev.categories, name) }))
        }
      />

      <div className="border-t border-slate-200 pt-4">
        <CheckboxList
          title="แบรนด์อะไหล่"
          items={partsBrands.map((b) => ({ value: b.id, label: b.name }))}
          selected={draft.partsBrands}
          onToggle={(id) =>
            setDraft((prev) => ({
              ...prev,
              partsBrands: toggleValue(prev.partsBrands, id),
            }))
          }
        />
      </div>

      <div className="border-t border-slate-200 pt-4">
        <CarBrandModelAccordion
          carBrands={carBrands}
          selectedBrands={draft.carBrands}
          selectedModels={draft.models}
          onToggleBrand={(name) => {
            setDraft((prev) => {
              const isSelected = prev.carBrands.includes(name);
              if (isSelected) {
                // Trying to deselect — block if any model under this brand is still selected.
                // User must first uncheck the models below.
                const brand = carBrands.find((b) => b.name === name);
                const hasSelectedModels =
                  brand?.carModels.some((m) => prev.models.includes(m.name)) ?? false;
                if (hasSelectedModels) return prev;
              }
              return { ...prev, carBrands: toggleValue(prev.carBrands, name) };
            });
          }}
          onToggleModel={(brandName, modelName) => {
            setDraft((prev) => {
              const wasSelected = prev.models.includes(modelName);
              const nextModels = toggleValue(prev.models, modelName);
              // When adding a model, also auto-select its parent brand if not already.
              if (!wasSelected && !prev.carBrands.includes(brandName)) {
                return {
                  ...prev,
                  models: nextModels,
                  carBrands: [...prev.carBrands, brandName],
                };
              }
              return { ...prev, models: nextModels };
            });
          }}
        />
      </div>

      <div className="border-t border-slate-200 pt-4">
        <YearRange
          yearMin={draft.yearMin}
          yearMax={draft.yearMax}
          onChange={({ yearMin, yearMax }) =>
            setDraft((prev) => ({ ...prev, yearMin, yearMax }))
          }
        />
      </div>

      {!HIDE_STOREFRONT_PRICE && (
        <div className="border-t border-slate-200 pt-4">
          <PriceRange
            priceMin={draft.priceMin}
            priceMax={draft.priceMax}
            onChange={({ priceMin, priceMax }) =>
              setDraft((prev) => ({ ...prev, priceMin, priceMax }))
            }
          />
        </div>
      )}
    </div>
  );
};

// ─── Bottom-sheet drawer that wraps ProductFilterBody + Apply/Clear actions ──

const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
  </svg>
);

type FilterDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  initialFilters: AppliedFilters;
  filterData: ProductFilterData;
  onApply: (draft: DraftFilters) => void;
  onClear: () => void;
};

export const ProductFilterDrawer = ({
  isOpen,
  onClose,
  initialFilters,
  filterData,
  onApply,
  onClear,
}: FilterDrawerProps) => {
  if (!isOpen || typeof document === "undefined") return null;

  const drawerKey = JSON.stringify(initialFilters);

  return (
    <ProductFilterDrawerContent
      key={drawerKey}
      onClose={onClose}
      initialFilters={initialFilters}
      filterData={filterData}
      onApply={onApply}
      onClear={onClear}
    />
  );
};

const ProductFilterDrawerContent = ({
  onClose,
  initialFilters,
  filterData,
  onApply,
  onClear,
}: Omit<FilterDrawerProps, "isOpen">) => {
  const [draft, setDraft] = useState<DraftFilters>(initialFilters);

  // Lock body scroll while open
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Render via portal at document.body to escape any ancestor containing block
  // (e.g. StorefrontNavbar uses backdrop-blur which scopes fixed-position children).
  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col rounded-t-3xl bg-white shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-kanit text-lg font-semibold text-[#10213d]">ตัวกรอง</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="ปิด"
          >
            {CLOSE_ICON}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ProductFilterBody draft={draft} setDraft={setDraft} filterData={filterData} />
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              onClear();
            }}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-red-300 hover:text-red-600"
          >
            ล้าง
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="flex-1 rounded-xl bg-[#f97316] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#ea660b]"
          >
            ตกลง
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
