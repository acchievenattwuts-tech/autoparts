"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/shared/MultiSelectFilter";
import NavLink from "@/components/shared/NavLink";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { ShelfLocationStatusFilter } from "@/lib/shelf-map-filters";

type Option = { id: string; name: string };

export type ShelfMapFilterValues = {
  q: string;
  categoryIds: string[];
  brandId: string;
  carBrandId: string;
  location: ShelfLocationStatusFilter;
  primaryOnly: boolean;
  inStockOnly: boolean;
};

type ShelfMapFilterFormProps = {
  values: ShelfMapFilterValues;
  categories: Option[];
  partsBrands: Option[];
  carBrands: Option[];
  hasActiveFilters: boolean;
  summary?: string;
};

const SHELF_MAP_PATH = "/admin/stock/shelf-map";

// Input / label tokens shared with app/admin/(protected)/sales/new/SaleForm.tsx.
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const checkboxLabelCls =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5";
const checkboxCls = "h-4 w-4 rounded border-gray-300 accent-[#1e3a5f] dark:border-slate-500 dark:accent-sky-400";

const LOCATION_OPTIONS: { value: ShelfLocationStatusFilter; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "located", label: "มีที่เก็บ" },
  { value: "unlocated", label: "ยังไม่มีที่เก็บ" },
];

const isLocationFilter = (value: string): value is ShelfLocationStatusFilter =>
  LOCATION_OPTIONS.some((option) => option.value === value);

const toSelectOptions = (options: Option[]): SelectOption[] =>
  options.map((option): SelectOption => ({ id: option.id, label: option.name }));

/** Remounts when the URL filters change so every field shows what is applied. */
const ShelfMapFilterForm = (props: ShelfMapFilterFormProps) => {
  const { values } = props;
  const syncKey = [
    values.q,
    values.categoryIds.join(","),
    values.brandId,
    values.carBrandId,
    values.location,
    values.primaryOnly ? "1" : "0",
    values.inStockOnly ? "1" : "0",
  ].join("\u0000");
  return <ShelfMapFilterFormContent key={syncKey} {...props} />;
};

const ShelfMapFilterFormContent = ({
  values,
  categories,
  partsBrands,
  carBrands,
  hasActiveFilters,
  summary,
}: ShelfMapFilterFormProps) => {
  const [query, setQuery] = useState(values.q);
  const [categoryIds, setCategoryIds] = useState<string[]>(values.categoryIds);
  const [brandId, setBrandId] = useState(values.brandId);
  const [carBrandId, setCarBrandId] = useState(values.carBrandId);
  const [location, setLocation] = useState<ShelfLocationStatusFilter>(values.location);
  const [inStockOnly, setInStockOnly] = useState(values.inStockOnly);

  return (
    <AdminFilterToolbar className="mb-0" summary={summary}>
      <AdminSearchForm method="GET" action={SHELF_MAP_PATH} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="shelf-map-q" className={labelCls}>
              ค้นหาสินค้า
            </label>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
              />
              <input
                id="shelf-map-q"
                type="search"
                name={query.trim() ? "q" : undefined}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="รหัส ชื่อ หรือรุ่นรถ เช่น คอยล์เย็น vigo"
                autoComplete="off"
                enterKeyHint="search"
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <AdminSearchSubmitButton className="flex-1 sm:flex-none">ค้นหา</AdminSearchSubmitButton>
            {hasActiveFilters && (
              <NavLink
                href={SHELF_MAP_PATH}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15 sm:flex-none"
              >
                ล้าง
              </NavLink>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <p id="shelf-map-category-label" className={labelCls}>
              หมวดหมู่
            </p>
            {categoryIds.map((id) => (
              <input key={id} type="hidden" name="categoryId" value={id} />
            ))}
            <MultiSelectFilter
              options={categories.map((category): MultiSelectOption => ({ id: category.id, label: category.name }))}
              values={categoryIds}
              onChange={setCategoryIds}
              placeholder="ทุกหมวดหมู่"
              ariaLabelledBy="shelf-map-category-label"
            />
          </div>
          <div className="min-w-0">
            <p className={labelCls}>แบรนด์อะไหล่</p>
            {brandId && <input type="hidden" name="brandId" value={brandId} />}
            <SearchableSelect
              options={toSelectOptions(partsBrands)}
              value={brandId}
              onChange={setBrandId}
              placeholder="ทุกแบรนด์อะไหล่"
              emptyTone="neutral"
            />
          </div>
          <div className="min-w-0">
            <p className={labelCls}>ยี่ห้อรถ</p>
            {carBrandId && <input type="hidden" name="carBrandId" value={carBrandId} />}
            <SearchableSelect
              options={toSelectOptions(carBrands)}
              value={carBrandId}
              onChange={setCarBrandId}
              placeholder="ทุกยี่ห้อรถ"
              emptyTone="neutral"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="shelf-map-location" className={labelCls}>
              สถานะที่เก็บ
            </label>
            <select
              id="shelf-map-location"
              name={location === "all" ? undefined : "location"}
              value={location}
              onChange={(event) => {
                if (isLocationFilter(event.target.value)) setLocation(event.target.value);
              }}
              className={inputCls}
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" name="primaryOnly" value="1" defaultChecked={values.primaryOnly} className={checkboxCls} />
            เฉพาะที่เก็บประจำ
          </label>
          <label className={checkboxLabelCls}>
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(event) => setInStockOnly(event.target.checked)}
              className={checkboxCls}
            />
            เฉพาะคงเหลือ &gt; 0
          </label>
          {/* "เฉพาะคงเหลือ > 0" is on by default, so only switching it off goes into the URL. */}
          {!inStockOnly && <input type="hidden" name="inStock" value="0" />}
        </div>
      </AdminSearchForm>
    </AdminFilterToolbar>
  );
};

export default ShelfMapFilterForm;
