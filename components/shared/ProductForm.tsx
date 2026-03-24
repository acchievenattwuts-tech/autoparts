"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plus, X, Upload, Loader2 } from "lucide-react";
import type { Product, ProductAlias } from "@/lib/generated/prisma";
import { createProduct, updateProduct, uploadProductImage } from "@/app/admin/products/actions";

interface CarModelOption {
  id: string;
  name: string;
}

interface CarBrandOption {
  id: string;
  name: string;
  carModels: CarModelOption[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ProductFormProps {
  categories: CategoryOption[];
  carBrands: CarBrandOption[];
  product?: Product & {
    aliases: ProductAlias[];
    carModels: { carModelId: string }[];
  };
}

const ProductForm = ({ categories, carBrands, product }: ProductFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");

  // Image state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string>(product?.imageUrl ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");

  // Aliases state
  const [aliases, setAliases] = useState<string[]>(
    product?.aliases.map((a) => a.alias) ?? []
  );
  const [aliasInput, setAliasInput] = useState("");

  // Car models state
  const [selectedCarModelIds, setSelectedCarModelIds] = useState<Set<string>>(
    new Set(product?.carModels.map((cm) => cm.carModelId) ?? [])
  );

  // Collapsed brand sections
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());

  // ── Image Upload ────────────────────────────────────────────────────────────

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setIsUploading(true);

    const fd = new FormData();
    fd.append("file", file);

    const result = await uploadProductImage(fd);
    setIsUploading(false);

    if (result.error) {
      setUploadError(result.error);
    } else if (result.url) {
      setImageUrl(result.url);
    }

    // reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Aliases ─────────────────────────────────────────────────────────────────

  const addAlias = () => {
    const trimmed = aliasInput.trim();
    if (!trimmed || aliases.includes(trimmed)) return;
    setAliases((prev) => [...prev, trimmed]);
    setAliasInput("");
  };

  const removeAlias = (alias: string) => {
    setAliases((prev) => prev.filter((a) => a !== alias));
  };

  // ── Car Models ───────────────────────────────────────────────────────────────

  const toggleCarModel = (carModelId: string) => {
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(carModelId)) {
        next.delete(carModelId);
      } else {
        next.add(carModelId);
      }
      return next;
    });
  };

  const toggleBrand = (brandId: string) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) {
        next.delete(brandId);
      } else {
        next.add(brandId);
      }
      return next;
    });
  };

  const selectAllModels = (brand: CarBrandOption) => {
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      brand.carModels.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const deselectAllModels = (brand: CarBrandOption) => {
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      brand.carModels.forEach((m) => next.delete(m.id));
      return next;
    });
  };

  // ── Form Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);

    // Inject computed values
    formData.set("imageUrl", imageUrl);
    formData.set("aliases", JSON.stringify(aliases));
    formData.set("carModelIds", JSON.stringify(Array.from(selectedCarModelIds)));

    startTransition(async () => {
      const result = product
        ? await updateProduct(product.id, formData)
        : await createProduct(formData);

      if (result.error) {
        setError(result.error);
      } else {
        router.push("/admin/products");
      }
    });
  };

  const isEdit = !!product;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Section: ข้อมูลพื้นฐาน ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลพื้นฐาน
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* รหัสสินค้า */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              รหัสสินค้า <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="code"
              defaultValue={product?.code ?? ""}
              required
              placeholder="เช่น DEN-001"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* ชื่อสินค้า */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ชื่อสินค้า <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              defaultValue={product?.name ?? ""}
              required
              placeholder="เช่น หัวเทียน Denso Iridium"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* หมวดหมู่ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              หมวดหมู่ <span className="text-red-500">*</span>
            </label>
            <select
              name="categoryId"
              defaultValue={product?.categoryId ?? ""}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
            >
              <option value="">-- เลือกหมวดหมู่ --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* แบรนด์อะไหล่ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              แบรนด์อะไหล่
            </label>
            <input
              type="text"
              name="brand"
              defaultValue={product?.brand ?? ""}
              placeholder="เช่น Denso, NRF, Bosch"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* ตำแหน่ง Shelf */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ตำแหน่ง Shelf
            </label>
            <input
              type="text"
              name="shelfLocation"
              defaultValue={product?.shelfLocation ?? ""}
              placeholder="เช่น A-01"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* หน่วย */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              หน่วย
            </label>
            <input
              type="text"
              name="unit"
              defaultValue={product?.unit ?? "ชิ้น"}
              placeholder="ชิ้น"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>
        </div>

        {/* คำอธิบาย */}
        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            คำอธิบาย
          </label>
          <textarea
            name="description"
            defaultValue={product?.description ?? ""}
            rows={3}
            placeholder="คำอธิบายสินค้าเพิ่มเติม..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm resize-none"
          />
        </div>
      </div>

      {/* ── Section: ราคาและ Stock ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ราคาและ Stock
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* ราคาทุน */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ราคาทุน (บาท)
            </label>
            <input
              type="number"
              name="costPrice"
              defaultValue={product ? Number(product.costPrice) : 0}
              min={0}
              step={0.01}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* ราคาขาย */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ราคาขาย (บาท)
            </label>
            <input
              type="number"
              name="salePrice"
              defaultValue={product ? Number(product.salePrice) : 0}
              min={0}
              step={0.01}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* Stock */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              จำนวน Stock
            </label>
            <input
              type="number"
              name="stock"
              defaultValue={product?.stock ?? 0}
              min={0}
              step={1}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>

          {/* Stock ขั้นต่ำ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Stock ขั้นต่ำ
            </label>
            <input
              type="number"
              name="minStock"
              defaultValue={product?.minStock ?? 1}
              min={0}
              step={1}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>
        </div>
      </div>

      {/* ── Section: รูปภาพสินค้า ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          รูปภาพสินค้า
        </h2>

        <div className="flex flex-col sm:flex-row items-start gap-5">
          {/* Preview */}
          <div className="flex-shrink-0">
            {imageUrl ? (
              <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200">
                <Image
                  src={imageUrl}
                  alt="preview"
                  fill
                  className="object-cover"
                  sizes="128px"
                />
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
                <p className="text-xs text-gray-400 text-center px-2">ยังไม่มีรูปภาพ</p>
              </div>
            )}
          </div>

          {/* Upload */}
          <div className="flex-1 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
              id="imageUpload"
            />
            <label
              htmlFor="imageUpload"
              className={`inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                isUploading
                  ? "opacity-60 cursor-not-allowed bg-gray-50"
                  : "hover:bg-gray-50 bg-white"
              }`}
            >
              {isUploading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              {isUploading ? "กำลังอัปโหลด..." : "อัปโหลดรูปภาพ"}
            </label>
            <p className="text-xs text-gray-400">
              รองรับไฟล์ JPG, PNG, WebP ขนาดไม่เกิน 5MB
            </p>
            {uploadError && (
              <p className="text-xs text-red-500">{uploadError}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Section: ชื่อเรียกอื่น (Aliases) ───────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ชื่อเรียกอื่น / รหัสอื่น
        </h2>

        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAlias();
              }
            }}
            placeholder="กรอกชื่อเรียกอื่น แล้วกด Enter หรือ เพิ่ม"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
          <button
            type="button"
            onClick={addAlias}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} />
            เพิ่ม
          </button>
        </div>

        {aliases.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {aliases.map((alias) => (
              <span
                key={alias}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100"
              >
                {alias}
                <button
                  type="button"
                  onClick={() => removeAlias(alias)}
                  className="text-blue-400 hover:text-blue-700 transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">ยังไม่มีชื่อเรียกอื่น</p>
        )}
      </div>

      {/* ── Section: รุ่นรถที่ใช้ได้ ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">
            รุ่นรถที่ใช้ได้
          </h2>
          <span className="text-sm text-gray-500">
            เลือกแล้ว {selectedCarModelIds.size} รุ่น
          </span>
        </div>

        {carBrands.length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีข้อมูลรุ่นรถ</p>
        ) : (
          <div className="space-y-3">
            {carBrands.map((brand) => {
              const isExpanded = expandedBrands.has(brand.id);
              const selectedCount = brand.carModels.filter((m) =>
                selectedCarModelIds.has(m.id)
              ).length;

              return (
                <div
                  key={brand.id}
                  className="border border-gray-100 rounded-lg overflow-hidden"
                >
                  {/* Brand header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <button
                      type="button"
                      onClick={() => toggleBrand(brand.id)}
                      className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-[#1e3a5f] transition-colors"
                    >
                      <span
                        className={`transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </span>
                      {brand.name}
                      {selectedCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e3a5f] text-white">
                          {selectedCount}
                        </span>
                      )}
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => selectAllModels(brand)}
                        className="text-xs text-[#1e3a5f] hover:underline"
                      >
                        เลือกทั้งหมด
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={() => deselectAllModels(brand)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>

                  {/* Models list */}
                  {isExpanded && (
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {brand.carModels.map((model) => (
                        <label
                          key={model.id}
                          className="flex items-center gap-2 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCarModelIds.has(model.id)}
                            onChange={() => toggleCarModel(model.id)}
                            className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f] cursor-pointer"
                          />
                          <span className="text-sm text-gray-700 group-hover:text-[#1e3a5f] transition-colors">
                            {model.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Error & Submit ─────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push("/admin/products")}
          className="px-5 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={isPending || isUploading}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              กำลังบันทึก...
            </>
          ) : isEdit ? (
            "บันทึกการแก้ไข"
          ) : (
            "เพิ่มสินค้า"
          )}
        </button>
      </div>
    </form>
  );
};

export default ProductForm;
