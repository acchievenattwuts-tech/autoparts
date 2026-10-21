"use client";

import { useState } from "react";
import { CalendarCheck, Search } from "lucide-react";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/shared/MultiSelectFilter";
import NavLink from "@/components/shared/NavLink";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { PutAwayTab } from "@/lib/shelf-put-away";

type Option = { id: string; name: string };

export type PutAwayFilterValues = {
  tab: PutAwayTab;
  q: string;
  categoryIds: string[];
  brandId: string;
  carBrandId: string;
  receivedFrom: string;
  receivedTo: string;
};

type PutAwayFilterFormProps = {
  values: PutAwayFilterValues;
  categories: Option[];
  partsBrands: Option[];
  carBrands: Option[];
  /** Today's Thailand date (YYYY-MM-DD) for the "วันนี้" shortcut. */
  todayKey: string;
  clearHref: string;
  hasActiveFilters: boolean;
};

const PUT_AWAY_PATH = "/admin/stock/put-away";

// Input / label tokens shared with app/admin/(protected)/sales/new/SaleForm.tsx.
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";

const toSelectOptions = (options: Option[]): SelectOption[] =>
  options.map((option): SelectOption => ({ id: option.id, label: option.name }));

/** Remounts when the URL filters change so every field shows what is applied. */
const PutAwayFilterForm = (props: PutAwayFilterFormProps) => {
  const { values } = props;
  const syncKey = [
    values.tab,
    values.q,
    values.categoryIds.join(","),
    values.brandId,
    values.carBrandId,
    values.receivedFrom,
    values.receivedTo,
  ].join("\u0000");
  return <PutAwayFilterFormContent key={syncKey} {...props} />;
};

const PutAwayFilterFormContent = ({
  values,
  categories,
  partsBrands,
  carBrands,
  todayKey,
  clearHref,
  hasActiveFilters,
}: PutAwayFilterFormProps) => {
  const [query, setQuery] = useState(values.q);
  const [categoryIds, setCategoryIds] = useState<string[]>(values.categoryIds);
  const [brandId, setBrandId] = useState(values.brandId);
  const [carBrandId, setCarBrandId] = useState(values.carBrandId);
  const [from, setFrom] = useState(values.receivedFrom);
  const [to, setTo] = useState(values.receivedTo);

  return (
    <AdminFilterToolbar className="mb-0">
      <AdminSearchForm method="GET" action={PUT_AWAY_PATH} className="space-y-3">
        {values.tab !== "unlocated" && <input type="hidden" name="tab" value={values.tab} />}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="put-away-q" className={labelCls}>
              ค้นหาสินค้า
            </label>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
              />
              <input
                id="put-away-q"
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
                href={clearHref}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15 sm:flex-none"
              >
                ล้าง
              </NavLink>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <p id="put-away-category-label" className={labelCls}>
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
              ariaLabelledBy="put-away-category-label"
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
            <p className={labelCls}>วันที่รับเข้าล่าสุด</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="รับเข้าตั้งแต่วันที่"
                name={from ? "from" : undefined}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={`${inputCls} min-w-0`}
              />
              <span className="text-xs text-slate-400 dark:text-slate-500">ถึง</span>
              <input
                type="date"
                aria-label="รับเข้าถึงวันที่"
                name={to ? "to" : undefined}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={`${inputCls} min-w-0`}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setFrom(todayKey);
                setTo(todayKey);
              }}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:bg-slate-100 dark:text-sky-300 dark:hover:bg-white/10"
            >
              <CalendarCheck size={13} />
              รับเข้าวันนี้
            </button>
          </div>
        </div>
      </AdminSearchForm>
    </AdminFilterToolbar>
  );
};

export default PutAwayFilterForm;
