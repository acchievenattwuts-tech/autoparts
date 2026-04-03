"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, SlidersHorizontal, X } from "lucide-react";

type CarModel = { id: string; name: string };
type CarBrand = { id: string; name: string; carModels: CarModel[] };
type Category = { id: string; name: string };

interface Props {
  brands: CarBrand[];
  categories: Category[];
}

const MOBILE_BRAND_PREVIEW_COUNT = 6;
const MOBILE_CATEGORY_PREVIEW_COUNT = 6;

const ProductFilterBar = ({ brands, categories }: Props) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const brand = searchParams.get("brand") ?? "";
  const model = searchParams.get("model") ?? "";
  const category = searchParams.get("category") ?? "";
  const page = searchParams.get("page") ?? "";

  const hasCarFilter = Boolean(brand || model);
  const hasAnyFilter = Boolean(hasCarFilter || category);

  const [isDesktop, setIsDesktop] = useState(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(hasAnyFilter);
  const [showBrandOptions, setShowBrandOptions] = useState<boolean>(hasCarFilter);
  const [showCategoryOptions, setShowCategoryOptions] = useState<boolean>(Boolean(category));

  const selectedBrand = brands.find((item) => item.name === brand);
  const mobileBrandPreview = brands.slice(0, MOBILE_BRAND_PREVIEW_COUNT);
  const mobileCategoryPreview = categories.slice(0, MOBILE_CATEGORY_PREVIEW_COUNT);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncState = () => {
      const nextDesktop = mediaQuery.matches;
      setIsDesktop(nextDesktop);
      setIsExpanded(Boolean(nextDesktop || hasAnyFilter));
      setShowBrandOptions(Boolean(nextDesktop || hasCarFilter));
      setShowCategoryOptions(Boolean(nextDesktop || category));
    };

    syncState();
    mediaQuery.addEventListener("change", syncState);

    return () => {
      mediaQuery.removeEventListener("change", syncState);
    };
  }, [category, hasAnyFilter, hasCarFilter]);

  const navigate = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
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

  return (
    <div className={`space-y-3 transition-opacity ${isPending ? "pointer-events-none opacity-60" : ""}`}>
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[#1e3a5f]/10 p-2 text-[#1e3a5f]">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-800">ตัวกรองสินค้า</p>
              <p className="text-xs text-gray-400">
                {hasAnyFilter
                  ? "เลือกตัวกรองแล้ว สามารถเปิดเพื่อแก้ไขได้"
                  : "เปิดเพื่อเลือกยี่ห้อรถ รุ่นรถ และหมวดสินค้า"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasAnyFilter && (
              <span className="rounded-full bg-[#1e3a5f] px-2 py-0.5 text-xs text-white">
                {model || brand || category}
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-gray-100 px-5 py-4">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-50 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">รถ</span>
                  <span className="text-sm font-semibold text-gray-800">เลือกตามยี่ห้อรถ</span>
                  {hasCarFilter && (
                    <span className="rounded-full bg-[#1e3a5f] px-2 py-0.5 text-xs text-white">
                      {model || brand}
                    </span>
                  )}
                </div>
                {hasCarFilter && (
                  <button
                    type="button"
                    onClick={() => navigate({ brand: "", model: "" })}
                    className="flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-red-500"
                  >
                    <X size={12} /> ล้าง
                  </button>
                )}
              </div>

              <div className="px-5 py-4">
                {!isDesktop && !showBrandOptions ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {mobileBrandPreview.map((item) => (
                        <span
                          key={item.id}
                          className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500"
                        >
                          {item.name}
                        </span>
                      ))}
                      {brands.length === 0 && (
                        <p className="text-sm text-gray-400">ยังไม่มีข้อมูลยี่ห้อรถ</p>
                      )}
                    </div>
                    {brands.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowBrandOptions(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-[#1e3a5f]/15 bg-[#1e3a5f]/5 px-4 py-2 text-sm font-medium text-[#1e3a5f]"
                      >
                        เปิดเลือกยี่ห้อรถ
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(isDesktop ? brands : brands).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          navigate({
                            brand: brand === item.name ? "" : item.name,
                            model: "",
                          })
                        }
                        className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
                          brand === item.name
                            ? "border-[#1e3a5f] bg-[#1e3a5f] text-white shadow-sm"
                            : "border-gray-200 bg-gray-50 text-gray-600 hover:border-[#1e3a5f] hover:bg-white hover:text-[#1e3a5f]"
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                    {!isDesktop && showBrandOptions && (
                      <button
                        type="button"
                        onClick={() => setShowBrandOptions(false)}
                        className="rounded-full border border-dashed border-gray-300 px-3.5 py-1.5 text-sm text-gray-500"
                      >
                        ย่อรายการ
                      </button>
                    )}
                    {brands.length === 0 && (
                      <p className="text-sm text-gray-400">ยังไม่มีข้อมูลยี่ห้อรถ</p>
                    )}
                  </div>
                )}

                {showBrandOptions && selectedBrand && selectedBrand.carModels.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="mb-2.5 flex items-center gap-1.5">
                      <ChevronRight size={13} className="text-[#1e3a5f]" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#1e3a5f]">
                        รุ่น {selectedBrand.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedBrand.carModels.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => navigate({ model: model === item.name ? "" : item.name })}
                          className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                            model === item.name
                              ? "border-[#f97316] bg-[#f97316] text-white shadow-sm"
                              : "border-gray-200 bg-gray-50 text-gray-600 hover:border-[#f97316] hover:bg-white hover:text-[#f97316]"
                          }`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  หมวดหมู่สินค้า
                </p>
                {!isDesktop && !showCategoryOptions && categories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCategoryOptions(true)}
                    className="text-xs font-medium text-[#1e3a5f]"
                  >
                    เปิดทั้งหมด
                  </button>
                )}
              </div>

              {!isDesktop && !showCategoryOptions ? (
                <div className="flex flex-wrap gap-2">
                  {mobileCategoryPreview.map((item) => (
                    <span
                      key={item.id}
                      className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500"
                    >
                      {item.name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => navigate({ category: "" })}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                      !category
                        ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-[#1e3a5f] hover:bg-white hover:text-[#1e3a5f]"
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  {(isDesktop ? categories : categories).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate({ category: category === item.name ? "" : item.name })}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                        category === item.name
                          ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                          : "border-gray-200 bg-gray-50 text-gray-600 hover:border-[#1e3a5f] hover:bg-white hover:text-[#1e3a5f]"
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                  {!isDesktop && showCategoryOptions && (
                    <button
                      type="button"
                      onClick={() => setShowCategoryOptions(false)}
                      className="rounded-full border border-dashed border-gray-300 px-4 py-1.5 text-sm text-gray-500"
                    >
                      ย่อรายการ
                    </button>
                  )}
                </div>
              )}
            </div>

            {hasAnyFilter && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">ตัวกรองที่เลือก:</span>
                {brand && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#1e3a5f]/10 px-3 py-1 text-xs font-medium text-[#1e3a5f]">
                    รถ {brand}
                    <button
                      type="button"
                      onClick={() => navigate({ brand: "", model: "" })}
                      className="ml-0.5 hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  </span>
                )}
                {model && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f97316]/10 px-3 py-1 text-xs font-medium text-[#f97316]">
                    {model}
                    <button
                      type="button"
                      onClick={() => navigate({ model: "" })}
                      className="ml-0.5 hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  </span>
                )}
                {category && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#1e3a5f]/10 px-3 py-1 text-xs font-medium text-[#1e3a5f]">
                    {category}
                    <button
                      type="button"
                      onClick={() => navigate({ category: "" })}
                      className="ml-0.5 hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-red-400 underline transition-colors hover:text-red-600"
                >
                  ล้างทั้งหมด
                </button>
              </div>
            )}

            {page && (
              <p className="mt-3 text-xs text-gray-400">
                การเปลี่ยนตัวกรองจะกลับไปเริ่มที่หน้า 1 อัตโนมัติ
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductFilterBar;
