"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

type Option = { id: string; name: string };
type CarBrandOption = Option & { models: Option[] };

type Props = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  categories: Option[];
  partsBrands: Option[];
  carBrands: CarBrandOption[];
};

export default function ProductFilterForm({
  search,
  categoryId,
  brandId,
  carBrandId,
  carModelId,
  categories,
  partsBrands,
  carBrands,
}: Props) {
  const [selectedCarBrandId, setSelectedCarBrandId] = useState(carBrandId ?? "");
  const models = useMemo(
    () => carBrands.find((brand) => brand.id === selectedCarBrandId)?.models ?? [],
    [carBrands, selectedCarBrandId],
  );
  const hasFilters = Boolean(search || categoryId || brandId || carBrandId || carModelId);

  return (
    <AdminFilterToolbar className="mb-0">
      <AdminSearchForm method="GET" className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))_auto_auto]">
        <ProductAutocomplete
          initialValue={search ?? ""}
          placeholder="ค้นหาจากชื่อสินค้า รหัส หรือคำค้นอื่น ๆ"
          mode="admin"
          inputName="search"
        />

        <select
          name="categoryId"
          defaultValue={categoryId ?? ""}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          name="brandId"
          defaultValue={brandId ?? ""}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">ทุกแบรนด์อะไหล่</option>
          {partsBrands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>

        <select
          name="carBrandId"
          value={selectedCarBrandId}
          onChange={(event) => setSelectedCarBrandId(event.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">ทุกยี่ห้อรถ</option>
          {carBrands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>

        <select
          key={selectedCarBrandId}
          name="carModelId"
          defaultValue={selectedCarBrandId === carBrandId ? carModelId ?? "" : ""}
          disabled={!selectedCarBrandId}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        >
          <option value="">ทุกรุ่นรถ</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>

        <AdminSearchSubmitButton className="inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]">
          ค้นหา
        </AdminSearchSubmitButton>
        {hasFilters ? (
          <Link
            href="/admin/products"
            className="inline-flex justify-center rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
          >
            ล้าง
          </Link>
        ) : null}
      </AdminSearchForm>
    </AdminFilterToolbar>
  );
}
