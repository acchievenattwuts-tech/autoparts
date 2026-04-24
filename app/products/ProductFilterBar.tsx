"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type CarModel = { id: string; name: string };
type CarBrand = { id: string; name: string; carModels: CarModel[] };
type Category = { id: string; name: string };

interface Props {
  brands: CarBrand[];
  categories: Category[];
}

const FILTER_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

const CHEVRON_DOWN_ICON = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
  </svg>
);

const CHEVRON_RIGHT_ICON = (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
  </svg>
);

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 7" />
  </svg>
);

const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
  </svg>
);

const BRAND_PREVIEW_COUNT = 6;
const CATEGORY_PREVIEW_COUNT = 7;
const MODEL_PREVIEW_COUNT = 6;

const sectionTitleClass = "font-kanit text-base font-semibold text-[#10213d]";
const sectionLabelClass = "text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400";
const listRowClass =
  "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm leading-5 transition";

const ProductFilterBar = ({ brands, categories }: Props) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const brand = searchParams.get("brand") ?? "";
  const selectedModels = searchParams.getAll("model").filter(Boolean);
  const category = searchParams.get("category") ?? "";
  const page = searchParams.get("page") ?? "";

  const hasCarFilter = Boolean(brand || selectedModels.length > 0);
  const hasAnyFilter = Boolean(hasCarFilter || category);

  const [isDesktop, setIsDesktop] = useState(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(hasAnyFilter);
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);

  const selectedBrand = brands.find((item) => item.name === brand);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncState = () => {
      const nextDesktop = mediaQuery.matches;
      setIsDesktop(nextDesktop);
      setIsExpanded(Boolean(nextDesktop || hasAnyFilter));
    };

    syncState();
    mediaQuery.addEventListener("change", syncState);

    return () => {
      mediaQuery.removeEventListener("change", syncState);
    };
  }, [hasAnyFilter]);

  const navigate = (updates: Record<string, string | string[]>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      params.delete(key);

      if (Array.isArray(value)) {
        value.filter(Boolean).forEach((item) => params.append(key, item));
      } else if (value) {
        params.set(key, value);
      }
    }

    params.delete("page");
    const query = params.toString();
    startTransition(() => router.push(query ? `/products/search?${query}` : "/products"));
  };

  const clearAll = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const query = params.toString();
    startTransition(() => router.push(query ? `/products/search?${query}` : "/products"));
  };

  const visibleBrands = showAllBrands ? brands : brands.slice(0, BRAND_PREVIEW_COUNT);
  const visibleCategories = showAllCategories
    ? categories
    : categories.slice(0, CATEGORY_PREVIEW_COUNT);
  const visibleModels =
    selectedBrand == null
      ? []
      : showAllModels
        ? selectedBrand.carModels
        : selectedBrand.carModels.slice(0, MODEL_PREVIEW_COUNT);

  const toggleModel = (modelName: string) => {
    const nextModels = selectedModels.includes(modelName)
      ? selectedModels.filter((item) => item !== modelName)
      : [...selectedModels, modelName];

    navigate({ model: nextModels });
  };

  const renderListAction = ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`${listRowClass} ${
        active
          ? "bg-orange-50 font-semibold text-[#f97316]"
          : "text-slate-700 hover:bg-slate-50 hover:text-[#10213d]"
      }`}
    >
      <span
        className={`shrink-0 transition ${
          active ? "text-[#f97316]" : "text-slate-300 group-hover:text-slate-500"
        }`}
        aria-hidden="true"
      >
        {active ? CHECK_ICON : CHEVRON_RIGHT_ICON}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  const renderMoreButton = ({
    expanded,
    onClick,
  }: {
    expanded: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:text-[#10213d]"
    >
      <span>เพิ่มเติม</span>
      <span
        className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        aria-hidden="true"
      >
        {CHEVRON_DOWN_ICON}
      </span>
    </button>
  );

  return (
    <div className={`transition-opacity ${isPending ? "pointer-events-none opacity-60" : ""}`}>
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_40px_-24px_rgba(15,23,42,0.28)]">
        <button
          type="button"
          onClick={() => {
            if (!isDesktop) {
              setIsExpanded((value) => !value);
            }
          }}
          className="flex w-full items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 text-left lg:cursor-default"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-[#1e3a5f]/8 p-2.5 text-[#1e3a5f]">{FILTER_ICON}</span>
            <div>
              <p className="font-kanit text-base font-semibold text-[#10213d]">ตัวกรองสินค้า</p>
              <p className="text-xs text-slate-400">
                เลือกยี่ห้อรถ รุ่นรถ และหมวดหมู่แบบอ่านง่าย
              </p>
            </div>
          </div>

          {!isDesktop && (
            <span
              className={`text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              {CHEVRON_DOWN_ICON}
            </span>
          )}
        </button>

        {isExpanded && (
          <div className="space-y-4 px-5 py-4">
            <section className="space-y-2">
              <h3 className={sectionTitleClass}>เลือกตามยี่ห้อรถ</h3>

              <div className="space-y-0.5">
                {visibleBrands.map((item) => {
                  const isSelectedBrand = brand === item.name;

                  return (
                    <div key={item.id}>
                      {renderListAction({
                        label: item.name,
                        active: isSelectedBrand,
                        onClick: () => {
                          setShowAllModels(false);
                          navigate({
                            brand: isSelectedBrand ? "" : item.name,
                            model: [],
                          });
                        },
                      })}

                      {isSelectedBrand && item.carModels.length > 0 && (
                        <div className="ml-6 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                          {visibleModels.map((modelItem) => (
                            <label
                              key={modelItem.id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[13px] leading-5 text-slate-600 transition hover:bg-slate-50 hover:text-[#10213d]"
                            >
                              <input
                                type="checkbox"
                                checked={selectedModels.includes(modelItem.name)}
                                onChange={() => toggleModel(modelItem.name)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316]"
                              />
                              <span className="min-w-0 flex-1 truncate">{modelItem.name}</span>
                            </label>
                          ))}

                          {item.carModels.length > MODEL_PREVIEW_COUNT &&
                            renderMoreButton({
                              expanded: showAllModels,
                              onClick: () => setShowAllModels((value) => !value),
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {brands.length === 0 && (
                  <p className="px-2 py-1 text-sm text-slate-400">ยังไม่มีข้อมูลยี่ห้อรถ</p>
                )}
              </div>

              {brands.length > BRAND_PREVIEW_COUNT &&
                renderMoreButton({
                  expanded: showAllBrands,
                  onClick: () => setShowAllBrands((value) => !value),
                })}
            </section>

            <section className="border-t border-slate-200 pt-4">
              <div className="space-y-1">
                <p className={sectionLabelClass}>หมวดหมู่สินค้า</p>
                <h3 className={sectionTitleClass}>ค้นหาตามประเภทสินค้า</h3>
              </div>

              <div className="mt-2 space-y-0.5">
                {renderListAction({
                  label: "ทั้งหมด",
                  active: !category,
                  onClick: () => navigate({ category: "" }),
                })}

                {visibleCategories.map((item) => (
                  <div key={item.id}>
                    {renderListAction({
                      label: item.name,
                      active: category === item.name,
                      onClick: () =>
                        navigate({ category: category === item.name ? "" : item.name }),
                    })}
                  </div>
                ))}
              </div>

              {categories.length > CATEGORY_PREVIEW_COUNT &&
                renderMoreButton({
                  expanded: showAllCategories,
                  onClick: () => setShowAllCategories((value) => !value),
                })}
            </section>

            {hasAnyFilter && (
              <section className="border-t border-slate-200 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  {brand && (
                    <button
                      type="button"
                      onClick={() => navigate({ brand: "", model: [] })}
                      className="inline-flex items-center gap-1 rounded-full bg-[#1e3a5f]/8 px-3 py-1 text-xs font-medium text-[#1e3a5f] transition hover:bg-[#1e3a5f]/12"
                    >
                      {brand}
                      <span aria-hidden="true">{CLOSE_ICON}</span>
                    </button>
                  )}

                  {selectedModels.map((modelName) => (
                    <button
                      key={modelName}
                      type="button"
                      onClick={() =>
                        navigate({
                          model: selectedModels.filter((item) => item !== modelName),
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-[#f97316] transition hover:bg-orange-100"
                    >
                      {modelName}
                      <span aria-hidden="true">{CLOSE_ICON}</span>
                    </button>
                  ))}

                  {category && (
                    <button
                      type="button"
                      onClick={() => navigate({ category: "" })}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      {category}
                      <span aria-hidden="true">{CLOSE_ICON}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-xs font-medium text-red-500 transition hover:text-red-600"
                  >
                    ล้างทั้งหมด
                  </button>
                </div>
              </section>
            )}

            {page && (
              <p className="border-t border-slate-200 pt-3 text-xs leading-5 text-slate-400">
                เมื่อเปลี่ยนตัวกรอง ระบบจะกลับไปเริ่มที่หน้า 1 อัตโนมัติ
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductFilterBar;
