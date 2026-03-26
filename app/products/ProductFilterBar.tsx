"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useTransition } from "react";
import { X, ChevronRight } from "lucide-react";

type CarModel = { id: string; name: string };
type CarBrand = { id: string; name: string; carModels: CarModel[] };
type Category = { id: string; name: string };

interface Props {
  brands: CarBrand[];
  categories: Category[];
}

const ProductFilterBar = ({ brands, categories }: Props) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const q        = searchParams.get("q") ?? "";
  const brand    = searchParams.get("brand") ?? "";
  const model    = searchParams.get("model") ?? "";
  const category = searchParams.get("category") ?? "";

  const selectedBrand = brands.find((b) => b.name === brand);
  const hasCarFilter  = brand || model;
  const hasAnyFilter  = hasCarFilter || category;

  const navigate = (updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    startTransition(() => router.push(`/products?${p.toString()}`));
  };

  const clearAll = () => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    startTransition(() => router.push(`/products?${p.toString()}`));
  };

  return (
    <div className={`space-y-3 transition-opacity ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
      {/* ── Car Brand / Model ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚗</span>
            <span className="font-semibold text-gray-800 text-sm">เลือกตามยี่ห้อรถ</span>
            {hasCarFilter && (
              <span className="bg-[#1e3a5f] text-white text-xs px-2 py-0.5 rounded-full">
                {model ? model : brand}
              </span>
            )}
          </div>
          {hasCarFilter && (
            <button
              onClick={() => navigate({ brand: "", model: "" })}
              className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <X size={12} /> ล้าง
            </button>
          )}
        </div>

        {/* Brands */}
        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() =>
                  navigate({
                    brand: brand === b.name ? "" : b.name,
                    model: "",
                  })
                }
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  brand === b.name
                    ? "bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-sm"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f] hover:bg-white"
                }`}
              >
                {b.name}
              </button>
            ))}
            {brands.length === 0 && (
              <p className="text-sm text-gray-400">ยังไม่มีข้อมูลยี่ห้อรถ</p>
            )}
          </div>

          {/* Models — show only when brand selected */}
          {selectedBrand && selectedBrand.carModels.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-1.5 mb-2.5">
                <ChevronRight size={13} className="text-[#1e3a5f]" />
                <span className="text-xs font-semibold text-[#1e3a5f] uppercase tracking-wide">
                  รุ่น {selectedBrand.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedBrand.carModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      navigate({ model: model === m.name ? "" : m.name })
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                      model === m.name
                        ? "bg-[#f97316] text-white border-[#f97316] shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:border-[#f97316] hover:text-[#f97316] hover:bg-white"
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Category ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">หมวดหมู่สินค้า</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate({ category: "" })}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
              !category
                ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                : "bg-gray-50 text-gray-600 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f] hover:bg-white"
            }`}
          >
            ทั้งหมด
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                navigate({ category: category === cat.name ? "" : cat.name })
              }
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                category === cat.name
                  ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f] hover:bg-white"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active filter chips ───────────────────────────────── */}
      {hasAnyFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">ตัวกรองที่เลือก:</span>
          {brand && (
            <span className="inline-flex items-center gap-1 bg-[#1e3a5f]/10 text-[#1e3a5f] text-xs px-3 py-1 rounded-full font-medium">
              🚗 {brand}
              <button onClick={() => navigate({ brand: "", model: "" })} className="hover:text-red-500 ml-0.5">
                <X size={10} />
              </button>
            </span>
          )}
          {model && (
            <span className="inline-flex items-center gap-1 bg-[#f97316]/10 text-[#f97316] text-xs px-3 py-1 rounded-full font-medium">
              {model}
              <button onClick={() => navigate({ model: "" })} className="hover:text-red-500 ml-0.5">
                <X size={10} />
              </button>
            </span>
          )}
          {category && (
            <span className="inline-flex items-center gap-1 bg-[#1e3a5f]/10 text-[#1e3a5f] text-xs px-3 py-1 rounded-full font-medium">
              {category}
              <button onClick={() => navigate({ category: "" })} className="hover:text-red-500 ml-0.5">
                <X size={10} />
              </button>
            </span>
          )}
          <button
            onClick={clearAll}
            className="text-xs text-red-400 hover:text-red-600 underline transition-colors"
          >
            ล้างทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductFilterBar;
