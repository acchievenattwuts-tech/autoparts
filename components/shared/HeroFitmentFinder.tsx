"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleMore, RotateCcw, Search, Wrench } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";

export interface FinderBrand {
  name: string;
  models: string[];
}

interface HeroFitmentFinderProps {
  brands: FinderBrand[];
  categories: string[];
  lineUrl?: string;
}

const OLDEST_FITMENT_YEAR = 1990;

/**
 * Builds the year dropdown from the current year down to a sensible floor.
 * ProductFitment stores year as a yearStart/yearEnd range, so a single-year
 * pick on /products is matched against that range server-side.
 */
const buildYearOptions = (): SelectOption[] => {
  const currentYear = new Date().getFullYear();
  const years: SelectOption[] = [];
  for (let year = currentYear; year >= OLDEST_FITMENT_YEAR; year -= 1) {
    years.push({ id: String(year), label: String(year) });
  }
  return years;
};

const toOptions = (values: string[]): SelectOption[] =>
  values.map((value) => ({ id: value, label: value }));

const HeroFitmentFinder = ({ brands, categories, lineUrl = "" }: HeroFitmentFinderProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [category, setCategory] = useState("");

  const brandOptions = useMemo(() => toOptions(brands.map((b) => b.name)), [brands]);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const categoryOptions = useMemo(() => toOptions(categories), [categories]);

  const modelOptions = useMemo(() => {
    const selected = brands.find((b) => b.name === brand);
    return toOptions(selected?.models ?? []);
  }, [brands, brand]);

  const hasAnyFilter = Boolean(brand || model || year || category);

  const handleBrandChange = (nextBrand: string) => {
    setBrand(nextBrand);
    setModel(""); // reset dependent model when brand changes
  };

  const handleReset = () => {
    setBrand("");
    setModel("");
    setYear("");
    setCategory("");
  };

  const handleSearch = () => {
    if (!hasAnyFilter) return;

    // Emit the same param names the /products left sidebar (ProductFilterBody)
    // reads, so the customer's homepage picks stay reflected as selected filters:
    //   carBrand → ยี่ห้อ checkbox · model → รุ่น accordion · categories → หมวด
    //   yearMin  → ปี (ช่อง "จาก" ของ YearRange; ปีเดียวจึงตั้งเฉพาะ yearMin)
    const params = new URLSearchParams();
    if (brand) params.set("carBrand", brand);
    if (model) params.set("model", model);
    if (year) params.set("yearMin", year);
    if (category) params.set("categories", category);

    startTransition(() => {
      router.push(`/products?${params.toString()}`);
    });
  };

  return (
    <div className="rounded-3xl border border-[#3d5f92]/12 bg-white p-5 shadow-lg sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-kanit text-base font-semibold text-[#16345d]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f97316] text-white">
            <Wrench className="h-4 w-4" />
          </span>
          ค้นหาอะไหล่ตามรถของคุณ
        </p>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-400 transition hover:text-[#f97316] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            ล้างค่า
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">ยี่ห้อรถ</label>
          <SearchableSelect
            options={brandOptions}
            value={brand}
            onChange={handleBrandChange}
            placeholder="เลือกยี่ห้อ"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">รุ่นรถ</label>
          <SearchableSelect
            options={modelOptions}
            value={model}
            onChange={setModel}
            placeholder={brand ? "เลือกรุ่น" : "เลือกยี่ห้อก่อน"}
            disabled={!brand}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">ปีรถ</label>
          <SearchableSelect
            options={yearOptions}
            value={year}
            onChange={setYear}
            placeholder="เลือกปี (ถ้ามี)"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">หมวดอะไหล่</label>
          <SearchableSelect
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            placeholder="เลือกหมวด"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={handleSearch}
          disabled={!hasAnyFilter || isPending}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f97316] px-6 py-3 font-kanit font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#ea6a0c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/45 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <Search className="h-4 w-4" />
          {isPending ? "กำลังค้นหา..." : "ค้นหาอะไหล่ที่ตรงรุ่น"}
        </button>
        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${STOREFRONT_LINE_PRIMARY_BUTTON_CLASS} flex-1 px-6 py-3`}
        >
          <MessageCircleMore className="h-4 w-4" />
          ไม่รู้รุ่น? ส่งรูปทาง LINE
        </a>
      </div>

      <p className="mt-3 text-center text-xs text-slate-400 sm:text-left">
        เลือกอย่างน้อย 1 ช่องเพื่อค้นหา — ยิ่งระบุครบ ยิ่งกรองให้ตรงรุ่นมากขึ้น
      </p>
    </div>
  );
};

export default HeroFitmentFinder;
