"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ProductFilterBody,
  ProductFilterDrawer,
  EMPTY_FILTERS,
  filtersEqual,
  type AppliedFilters,
  type DraftFilters,
  type CarBrand,
  type Category,
  type PartsBrand,
} from "@/components/shared/ProductFilterPanel";
import { OPEN_PRODUCT_FILTER_EVENT } from "@/components/shared/StorefrontFilterTrigger";

interface Props {
  carBrands: CarBrand[];
  categories: Category[];
  partsBrands: PartsBrand[];
  appliedFilters: AppliedFilters;
  onApply: (draft: DraftFilters) => void;
  onClearAll: () => void;
  isPending?: boolean;
}

const FILTER_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

const ProductFilterBar = ({
  carBrands,
  categories,
  partsBrands,
  appliedFilters,
  onApply,
  onClearAll,
  isPending,
}: Props) => {
  const [desktopDraft, setDesktopDraft] = useState<DraftFilters>(appliedFilters);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Sync desktop draft when applied filters change
  useEffect(() => {
    setDesktopDraft(appliedFilters);
  }, [appliedFilters]);

  const isDesktopDirty = !filtersEqual(desktopDraft, appliedFilters);

  // Listen for navbar trigger event to open drawer
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener(OPEN_PRODUCT_FILTER_EVENT, handler);
    return () => window.removeEventListener(OPEN_PRODUCT_FILTER_EVENT, handler);
  }, []);

  const filterData = { categories, carBrands, partsBrands };

  const handleDesktopApply = useCallback(() => {
    onApply(desktopDraft);
  }, [desktopDraft, onApply]);

  const handleDesktopClear = useCallback(() => {
    setDesktopDraft(EMPTY_FILTERS);
    onClearAll();
  }, [onClearAll]);

  const handleMobileApply = useCallback(
    (draft: DraftFilters) => {
      onApply(draft);
      setMobileOpen(false);
    },
    [onApply],
  );

  const handleMobileClear = useCallback(() => {
    onClearAll();
    setMobileOpen(false);
  }, [onClearAll]);

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={`hidden lg:block ${isPending ? "pointer-events-none opacity-60" : ""} transition-opacity`}
      >
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_40px_-24px_rgba(15,23,42,0.28)]">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <span className="rounded-2xl bg-[#1e3a5f]/8 p-2.5 text-[#1e3a5f]">{FILTER_ICON}</span>
            <div>
              <p className="font-kanit text-base font-semibold text-[#10213d]">ค้นหาแบบละเอียด</p>
              <p className="text-xs text-slate-400">
                เลือกหลายข้อแล้วกด &ldquo;ตกลง&rdquo; เพื่อกรอง
              </p>
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            <ProductFilterBody
              draft={desktopDraft}
              setDraft={setDesktopDraft}
              filterData={filterData}
            />
          </div>

          <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
            <button
              type="button"
              onClick={handleDesktopClear}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-red-300 hover:text-red-600"
            >
              ล้าง
            </button>
            <button
              type="button"
              onClick={handleDesktopApply}
              disabled={!isDesktopDirty}
              className="flex-1 rounded-xl bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ea660b] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              ตกลง
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer (opened by navbar trigger via OPEN_PRODUCT_FILTER_EVENT) */}
      <ProductFilterDrawer
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        initialFilters={appliedFilters}
        filterData={filterData}
        onApply={handleMobileApply}
        onClear={handleMobileClear}
      />
    </>
  );
};

export default ProductFilterBar;
