"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import NavLink from "@/components/shared/NavLink";

type Option = { id: string; name: string };
type CarBrandOption = Option & { models: Option[] };

type Props = {
  search?: string;
  categoryId?: string;
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
};

export default function ProductFilterForm(props: Props) {
  const syncKey = [
    props.categoryId ?? "",
    props.brandId ?? "",
    props.carBrandId ?? "",
    props.carModelId ?? "",
    props.yearMin ?? "",
    props.yearMax ?? "",
    props.stockStatus ?? "",
    props.statusFilter ?? "",
    props.trackingFilter ?? "",
  ].join("\u0000");

  return <ProductFilterFormContent key={syncKey} {...props} />;
}

function ProductFilterFormContent({
  search,
  categoryId,
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
}: Props) {
  const [categoryValue, setCategoryValue] = useState(categoryId ?? "");
  const [brandValue, setBrandValue] = useState(brandId ?? "");
  const [carBrandValue, setCarBrandValue] = useState(carBrandId ?? "");
  const [selectedCarBrandId, setSelectedCarBrandId] = useState(carBrandId ?? "");
  const [yearMinValue, setYearMinValue] = useState(yearMin ?? "");
  const [yearMaxValue, setYearMaxValue] = useState(yearMax ?? "");
  const [stockStatusValue, setStockStatusValue] = useState(stockStatus ?? "");
  const [statusFilterValue, setStatusFilterValue] = useState(statusFilter ?? "");
  const [trackingFilterValue, setTrackingFilterValue] = useState(trackingFilter ?? "");

  const hasAdvancedFilter = Boolean(
    carBrandId || carModelId || yearMin || yearMax || stockStatus || statusFilter || trackingFilter,
  );
  const [showMore, setShowMore] = useState(hasAdvancedFilter);

  const models = useMemo(
    () => carBrands.find((b) => b.id === selectedCarBrandId)?.models ?? [],
    [carBrands, selectedCarBrandId],
  );

  const hasFilters = Boolean(
    search || categoryId || brandId || carBrandId || carModelId ||
    yearMin || yearMax || stockStatus || statusFilter || trackingFilter,
  );

  const advancedActiveCount = [
    carBrandId,
    carModelId,
    yearMin || yearMax,
    stockStatus,
    statusFilter,
    trackingFilter,
  ].filter(Boolean).length;

  return (
    <AdminFilterToolbar className="mb-0">
      <AdminSearchForm method="GET" className="space-y-2">
        {/* Row 1: Search + Category + Brand + Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search box — grows to fill remaining space */}
          <div className="min-w-[200px] flex-1">
            <ProductAutocomplete
              initialValue={search ?? ""}
              placeholder="ค้นหาจากชื่อสินค้า รหัส หรือคำค้นอื่น ๆ"
              mode="admin"
              inputName="search"
            />
          </div>

          {/* Category */}
          <div className="w-[160px] shrink-0">
            <input type="hidden" name="categoryId" value={categoryValue} />
            <SearchableSelect
              options={categories.map((c): SelectOption => ({ id: c.id, label: c.name }))}
              value={categoryValue}
              onChange={setCategoryValue}
              placeholder="ทุกหมวดหมู่"
            />
          </div>

          {/* Parts Brand */}
          <div className="w-[160px] shrink-0">
            <input type="hidden" name="brandId" value={brandValue} />
            <SearchableSelect
              options={partsBrands.map((b): SelectOption => ({ id: b.id, label: b.name }))}
              value={brandValue}
              onChange={setBrandValue}
              placeholder="ทุกแบรนด์อะไหล่"
            />
          </div>

          <AdminSearchSubmitButton className="shrink-0 inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]">
            ค้นหา
          </AdminSearchSubmitButton>

          {hasFilters && (
            <NavLink
              href="/admin/products"
              className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              ล้าง
            </NavLink>
          )}

          {/* More toggle */}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              showMore
                ? "border-[#1e3a5f] bg-[#1e3a5f]/10 text-[#1e3a5f] dark:border-sky-400 dark:bg-sky-500/10 dark:text-sky-300"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
            }`}
          >
            <SlidersHorizontal size={14} />
            เพิ่มเติม
            {advancedActiveCount > 0 && (
              <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[#1e3a5f] px-1 text-[10px] font-bold text-white dark:bg-sky-500">
                {advancedActiveCount}
              </span>
            )}
            <ChevronDown
              size={12}
              className={`transition-transform ${showMore ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {/* Advanced Filters Panel */}
        {showMore && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
              {/* Car Brand */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">ยี่ห้อรถ</p>
                <input type="hidden" name="carBrandId" value={carBrandValue} />
                <SearchableSelect
                  options={carBrands.map((b): SelectOption => ({ id: b.id, label: b.name }))}
                  value={carBrandValue}
                  onChange={(id) => {
                    setCarBrandValue(id);
                    setSelectedCarBrandId(id);
                  }}
                  placeholder="ทุกยี่ห้อรถ"
                />
              </div>

              {/* Car Model — dependent on car brand */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">รุ่นรถ</p>
                <select
                  key={selectedCarBrandId}
                  name="carModelId"
                  defaultValue={selectedCarBrandId === carBrandId ? (carModelId ?? "") : ""}
                  disabled={!selectedCarBrandId}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                >
                  <option value="">ทุกรุ่นรถ</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Year Range */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">ช่วงปีรถ (ค.ศ.)</p>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    name="yearMin"
                    value={yearMinValue}
                    onChange={(e) => setYearMinValue(e.target.value)}
                    placeholder="ปีเริ่ม"
                    min={1900}
                    max={2200}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <span className="shrink-0 text-xs text-gray-400">–</span>
                  <input
                    type="number"
                    name="yearMax"
                    value={yearMaxValue}
                    onChange={(e) => setYearMaxValue(e.target.value)}
                    placeholder="ปีสิ้นสุด"
                    min={1900}
                    max={2200}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Stock Status */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">สต็อก</p>
                <select
                  name="stockStatus"
                  value={stockStatusValue}
                  onChange={(e) => setStockStatusValue(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="in_stock">มีสต็อก</option>
                  <option value="low_stock">สต็อกต่ำ</option>
                  <option value="out_of_stock">หมดสต็อก</option>
                </select>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">สถานะ</p>
                <select
                  name="statusFilter"
                  value={statusFilterValue}
                  onChange={(e) => setStatusFilterValue(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="active">ใช้งาน</option>
                  <option value="inactive">ปิดใช้งาน</option>
                </select>
              </div>

              {/* Inventory Tracking */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">การคำนวณสต็อก</p>
                <select
                  name="trackingFilter"
                  value={trackingFilterValue}
                  onChange={(e) => setTrackingFilterValue(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="tracked">คำนวณสต็อก</option>
                  <option value="non_tracked">ไม่คำนวณ</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </AdminSearchForm>
    </AdminFilterToolbar>
  );
}
