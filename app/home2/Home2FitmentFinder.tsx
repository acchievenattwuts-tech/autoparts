"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleMore, RotateCcw, Search, Wrench } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/shared/MultiSelectFilter";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";

/**
 * home2's fitment finder.
 *
 * Search behaviour is intentionally identical to the storefront's
 * <HeroFitmentFinder/> — same dependent brand→model reset, same "at least one
 * field" rule, and the same query params (carBrand / model / yearMin /
 * repeated categories) so /products highlights the customer's picks in its left
 * sidebar exactly as it does from "/". Only the presentation is re-skinned to
 * the white + blue palette; orange stays reserved for prices.
 */

export interface Home2FinderBrand {
  name: string;
  models: string[];
}

interface Props {
  brands: Home2FinderBrand[];
  categories: string[];
  lineUrl?: string;
}

const OLDEST_FITMENT_YEAR = 1990;

/**
 * Year dropdown from the current year down to a sensible floor. ProductFitment
 * stores a yearStart/yearEnd range, so a single-year pick is matched against
 * that range server-side.
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

const Home2FitmentFinder = ({ brands, categories, lineUrl = "" }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  // หมวดอะไหล่เลือกได้มากกว่า 1 — /products รองรับ `categories` ซ้ำหลายค่าอยู่แล้ว
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const brandOptions = useMemo(() => toOptions(brands.map((item) => item.name)), [brands]);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const categoryOptions = useMemo<MultiSelectOption[]>(
    () => categories.map((name) => ({ id: name, label: name })),
    [categories],
  );

  const modelOptions = useMemo(() => {
    const selected = brands.find((item) => item.name === brand);
    return toOptions(selected?.models ?? []);
  }, [brands, brand]);

  const hasAnyFilter = Boolean(brand || model || year || selectedCategories.length > 0);

  const handleBrandChange = (nextBrand: string) => {
    setBrand(nextBrand);
    setModel(""); // reset dependent model when brand changes
  };

  const handleReset = () => {
    setBrand("");
    setModel("");
    setYear("");
    setSelectedCategories([]);
  };

  const handleSearch = () => {
    if (!hasAnyFilter) return;

    const params = new URLSearchParams();
    if (brand) params.set("carBrand", brand);
    if (model) params.set("model", model);
    if (year) params.set("yearMin", year);
    for (const name of selectedCategories) params.append("categories", name);

    startTransition(() => {
      router.push(`/products?${params.toString()}`);
    });
  };

  return (
    <div className="rounded-2xl border border-[#dbe6f5] bg-white p-4 shadow-[0_1px_3px_rgba(30,58,95,0.08)] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-kanit text-base font-semibold text-[#1e3a5f]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#1e3a5f] text-white">
            <Wrench className="h-4 w-4" />
          </span>
          ค้นหาอะไหล่ตามรถของคุณ
        </p>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex min-h-[28px] items-center gap-1 rounded-full px-2 text-xs font-medium text-slate-400 transition hover:bg-[#eff5fc] hover:text-[#2563eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            ล้างค่า
          </button>
        )}
      </div>

      {/*
        SearchableSelect / MultiSelectFilter hardcode an orange "nothing picked
        yet" state (border-orange-300 / bg-orange-50/30 / text-orange-400) and
        expose no prop to change it. They are shared with "/" and the whole
        admin, so instead of editing them we repaint that state to blue here,
        scoped to this card. `:has(.text-orange-400)` matches only the closed +
        empty trigger, leaving the focused and filled states untouched.
      */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 [&_.text-orange-400]:!text-[#5c7fb3] [&_[role=combobox]:has(.text-orange-400)]:!border-[#cddff2] [&_[role=combobox]:has(.text-orange-400)]:!bg-[#f7fafe] [&_[role=combobox]:has(.text-orange-400):hover]:!border-[#93b4dd]">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">ยี่ห้อรถ</label>
          <SearchableSelect
            options={brandOptions}
            value={brand}
            onChange={handleBrandChange}
            placeholder="เลือกยี่ห้อ"
            autoFocusSearch={false}
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
            autoFocusSearch={false}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">ปีรถ</label>
          <SearchableSelect
            options={yearOptions}
            value={year}
            onChange={setYear}
            placeholder="เลือกปี (ถ้ามี)"
            autoFocusSearch={false}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#4d6fba]">
            หมวดอะไหล่ <span className="font-normal text-slate-400">(เลือกได้หลายหมวด)</span>
          </label>
          <MultiSelectFilter
            options={categoryOptions}
            values={selectedCategories}
            onChange={setSelectedCategories}
            placeholder="เลือกหมวด"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={handleSearch}
          disabled={!hasAnyFilter || isPending}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#1e3a5f] px-6 py-3 font-kanit font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#163055] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/45 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <Search className="h-4 w-4" />
          {isPending ? "กำลังค้นหา..." : "ค้นหาอะไหล่ที่ตรงรุ่น"}
        </button>
        {lineUrl && (
          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${STOREFRONT_LINE_PRIMARY_BUTTON_CLASS} flex-1 px-6 py-3`}
          >
            <MessageCircleMore className="h-4 w-4" />
            ไม่รู้รุ่น? ส่งรูปทาง LINE
          </a>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-slate-400 sm:text-left">
        เลือกอย่างน้อย 1 ช่องเพื่อค้นหา — ยิ่งระบุครบ ยิ่งกรองให้ตรงรุ่นมากขึ้น
      </p>
    </div>
  );
};

export default Home2FitmentFinder;
