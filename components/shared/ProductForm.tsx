"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plus, X, Upload, Loader2, Trash2 } from "lucide-react";
import type { Product, ProductAlias, ProductUnit } from "@/lib/generated/prisma";
import { createProduct, updateProduct, uploadProductImage } from "@/app/admin/(protected)/products/actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarModelOption { id: string; name: string }
interface CarBrandOption { id: string; name: string; carModels: CarModelOption[] }
interface CategoryOption { id: string; name: string }
interface PartsBrandOption { id: string; name: string }

interface UnitRow {
  name: string;
  scale: number;
  isBase: boolean;
}

interface ProductFormProps {
  categories: CategoryOption[];
  carBrands: CarBrandOption[];
  partsBrands: PartsBrandOption[];
  product?: Product & {
    aliases: ProductAlias[];
    carModels: { carModelId: string }[];
    units: ProductUnit[];
  };
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";
const sectionCls = "bg-white rounded-xl shadow-sm border border-gray-100 p-6";

// ─── Component ────────────────────────────────────────────────────────────────

const ProductForm = ({ categories, carBrands, partsBrands, product }: ProductFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Image
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Aliases
  const [aliases, setAliases] = useState<string[]>(
    product?.aliases.map((a) => a.alias) ?? []
  );
  const [aliasInput, setAliasInput] = useState("");

  // Car models
  const [selectedCarModelIds, setSelectedCarModelIds] = useState<Set<string>>(
    new Set(product?.carModels.map((cm) => cm.carModelId) ?? [])
  );
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());

  // ── Units ──────────────────────────────────────────────────────────────────
  const initUnits = (): UnitRow[] => {
    if (product?.units && product.units.length > 0) {
      return product.units
        .slice()
        .sort((a, b) => (b.isBase ? 1 : 0) - (a.isBase ? 1 : 0)) // base first
        .map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase }));
    }
    return [{ name: "ชิ้น", scale: 1, isBase: true }];
  };

  const [units, setUnits] = useState<UnitRow[]>(initUnits);
  const baseUnit = units.find((u) => u.isBase) ?? units[0];

  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [brandId, setBrandId]       = useState(product?.brandId ?? "");

  const [saleUnitName, setSaleUnitName] = useState(
    product?.saleUnitName ?? baseUnit.name
  );
  const [purchaseUnitName, setPurchaseUnitName] = useState(
    product?.purchaseUnitName ?? baseUnit.name
  );
  const [reportUnitName, setReportUnitName] = useState(
    product?.reportUnitName ?? baseUnit.name
  );

  const handleUnitNameChange = (index: number, name: string) => {
    const old = units[index].name;
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, name } : u)));
    if (saleUnitName === old) setSaleUnitName(name);
    if (purchaseUnitName === old) setPurchaseUnitName(name);
    if (reportUnitName === old) setReportUnitName(name);
  };

  const handleUnitScaleChange = (index: number, val: number) => {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, scale: val } : u)));
  };

  const addUnit = () => {
    setUnits((prev) => [...prev, { name: "", scale: 1, isBase: false }]);
  };

  const removeUnit = (index: number) => {
    const removed = units[index].name;
    const baseName = units.find((u) => u.isBase)?.name ?? "ชิ้น";
    setUnits((prev) => prev.filter((_, i) => i !== index));
    if (saleUnitName === removed) setSaleUnitName(baseName);
    if (purchaseUnitName === removed) setPurchaseUnitName(baseName);
    if (reportUnitName === removed) setReportUnitName(baseName);
  };

  // ── Car models ─────────────────────────────────────────────────────────────

  const toggleCarModel = (id: string) =>
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleBrand = (id: string) =>
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllModels = (brand: CarBrandOption) =>
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      brand.carModels.forEach((m) => next.add(m.id));
      return next;
    });

  const deselectAllModels = (brand: CarBrandOption) =>
    setSelectedCarModelIds((prev) => {
      const next = new Set(prev);
      brand.carModels.forEach((m) => next.delete(m.id));
      return next;
    });

  // ── Image upload ───────────────────────────────────────────────────────────

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setIsUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadProductImage(fd);
    setIsUploading(false);
    if (result.error) setUploadError(result.error);
    else if (result.url) setImageUrl(result.url);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Aliases ────────────────────────────────────────────────────────────────

  const addAlias = () => {
    const v = aliasInput.trim();
    if (!v || aliases.includes(v)) return;
    setAliases((prev) => [...prev, v]);
    setAliasInput("");
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    // Client-side unit validation
    for (const u of units) {
      if (!u.name.trim()) {
        setError("ชื่อหน่วยนับต้องไม่ว่าง");
        return;
      }
    }
    const unitNames = units.map((u) => u.name.trim());
    if (new Set(unitNames).size !== unitNames.length) {
      setError("ชื่อหน่วยนับต้องไม่ซ้ำกัน");
      return;
    }

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);
    formData.set("categoryId", categoryId);
    formData.set("brandId", brandId);
    formData.set("imageUrl", imageUrl);
    formData.set("aliases", JSON.stringify(aliases));
    formData.set("carModelIds", JSON.stringify(Array.from(selectedCarModelIds)));
    formData.set("units", JSON.stringify(units));
    formData.set("saleUnitName", saleUnitName);
    formData.set("purchaseUnitName", purchaseUnitName);
    formData.set("reportUnitName", reportUnitName);

    startTransition(async () => {
      const result = product
        ? await updateProduct(product.id, formData)
        : await createProduct(formData);

      if (result.error) setError(result.error);
      else router.push("/admin/products");
    });
  };

  const unitNameOptions = units.map((u) => u.name).filter((n) => n.trim() !== "");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── ข้อมูลพื้นฐาน ─────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลพื้นฐาน
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {product && (
            <div>
              <label className={labelCls}>รหัสสินค้า</label>
              <div className="inline-flex items-center px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-[#1e3a5f] font-medium">
                {product.code}
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>ชื่อสินค้า <span className="text-red-500">*</span></label>
            <input type="text" name="name" defaultValue={product?.name ?? ""} required
              placeholder="เช่น คอมเพรสเซอร์แอร์ Toyota" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>หมวดหมู่ <span className="text-red-500">*</span></label>
            <SearchableSelect
              options={categories.map((c): SelectOption => ({ id: c.id, label: c.name }))}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="โปรดระบุหมวดหมู่"
            />
          </div>
          <div>
            <label className={labelCls}>แบรนด์อะไหล่</label>
            <SearchableSelect
              options={[
                { id: "", label: "-- ไม่ระบุแบรนด์ --" },
                ...partsBrands.map((b): SelectOption => ({ id: b.id, label: b.name })),
              ]}
              value={brandId}
              onChange={setBrandId}
              placeholder="-- ไม่ระบุแบรนด์ --"
            />
          </div>
          <div>
            <label className={labelCls}>ตำแหน่ง Shelf</label>
            <input type="text" name="shelfLocation" defaultValue={product?.shelfLocation ?? ""}
              placeholder="เช่น A-01" className={inputCls} />
          </div>
        </div>
        <div className="mt-5">
          <label className={labelCls}>คำอธิบาย</label>
          <textarea name="description" defaultValue={product?.description ?? ""} rows={3}
            placeholder="คำอธิบายสินค้าเพิ่มเติม..."
            className={`${inputCls} resize-none`} />
        </div>
      </div>

      {/* ── ราคา ───────────────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ราคา
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div>
            <label className={labelCls}>ราคาทุน (บาท)</label>
            <input type="number" name="costPrice"
              defaultValue={product ? Number(product.costPrice) : 0}
              min={0} step={0.01} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ราคาขาย (บาท)</label>
            <input type="number" name="salePrice"
              defaultValue={product ? Number(product.salePrice) : 0}
              min={0} step={0.01} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Stock ขั้นต่ำ</label>
            <input type="number" name="minStock"
              defaultValue={product?.minStock ?? 1}
              min={0} step={1} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ระยะเวลาประกัน (วัน)</label>
            <input type="number" name="warrantyDays"
              defaultValue={(product as { warrantyDays?: number })?.warrantyDays ?? 0}
              min={0} step={1} className={inputCls}
              placeholder="0 = ไม่มีประกัน" />
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          * จำนวน Stock เริ่มต้นกำหนดได้ที่ระบบ BF (ยอดยกมา) ใน Phase 3
        </p>
      </div>

      {/* ── หน่วยนับ ───────────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-1 pb-0">
          หน่วยนับสินค้า
        </h2>
        <p className="text-xs text-gray-400 mb-5 pb-3 border-b border-gray-100">
          หน่วยหลัก (isBase) ต้องมี Scale = 1 เสมอ · Scale ของหน่วยอื่น = จำนวนหน่วยย่อยต่อ 1 หน่วยนั้น
        </p>

        {/* Units table */}
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-4 text-gray-500 font-medium w-10">#</th>
                <th className="text-left py-2 pr-4 text-gray-500 font-medium">ชื่อหน่วย</th>
                <th className="text-left py-2 pr-4 text-gray-500 font-medium w-32">Scale</th>
                <th className="text-left py-2 pr-4 text-gray-500 font-medium w-24">ประเภท</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {units.map((unit, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 pr-4 text-gray-400">{i + 1}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      value={unit.name}
                      onChange={(e) => handleUnitNameChange(i, e.target.value)}
                      placeholder="เช่น ชิ้น, โหล, กล่อง"
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-sm"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    {unit.isBase ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={1}
                          disabled
                          className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-400"
                        />
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={unit.scale}
                        onChange={(e) => handleUnitScaleChange(i, Number(e.target.value))}
                        min={0.001}
                        step={0.001}
                        className="w-24 px-2.5 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-sm"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {unit.isBase ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e3a5f]/10 text-[#1e3a5f]">
                        หน่วยหลัก
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        หน่วยเพิ่มเติม
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!unit.isBase && (
                      <button
                        type="button"
                        onClick={() => removeUnit(i)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="ลบหน่วยนี้"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={addUnit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors"
        >
          <Plus size={14} />
          เพิ่มหน่วยนับ
        </button>

        {/* Unit selects */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
          <div>
            <label className={labelCls}>หน่วยขาย <span className="text-red-500">*</span></label>
            <select
              value={saleUnitName}
              onChange={(e) => setSaleUnitName(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {unitNameOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>หน่วยซื้อ <span className="text-red-500">*</span></label>
            <select
              value={purchaseUnitName}
              onChange={(e) => setPurchaseUnitName(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {unitNameOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>หน่วยรายงาน <span className="text-red-500">*</span></label>
            <select
              value={reportUnitName}
              onChange={(e) => setReportUnitName(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {unitNameOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── รูปภาพ ─────────────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          รูปภาพสินค้า
        </h2>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="flex-shrink-0">
            {imageUrl ? (
              <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200">
                <Image src={imageUrl} alt="preview" fill className="object-cover" sizes="128px" />
                <button type="button" onClick={() => setImageUrl("")}
                  className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50">
                <p className="text-xs text-gray-400 text-center px-2">ยังไม่มีรูปภาพ</p>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={handleImageChange} className="hidden" id="imageUpload" />
            <label htmlFor="imageUpload"
              className={`inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium cursor-pointer transition-colors ${isUploading ? "opacity-60 cursor-not-allowed bg-gray-50" : "hover:bg-gray-50 bg-white"}`}>
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {isUploading ? "กำลังอัปโหลด..." : "อัปโหลดรูปภาพ"}
            </label>
            <p className="text-xs text-gray-400">รองรับ JPG, PNG, WebP ขนาดไม่เกิน 5MB</p>
            {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
          </div>
        </div>
      </div>

      {/* ── ชื่อเรียกอื่น ───────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ชื่อเรียกอื่น / รหัสอื่น
        </h2>
        <div className="flex gap-3 mb-4">
          <input type="text" value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
            placeholder="กรอกชื่อเรียกอื่น แล้วกด Enter หรือ เพิ่ม"
            className={`flex-1 ${inputCls}`} />
          <button type="button" onClick={addAlias}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors">
            <Plus size={14} />เพิ่ม
          </button>
        </div>
        {aliases.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {aliases.map((alias) => (
              <span key={alias}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100">
                {alias}
                <button type="button" onClick={() => setAliases((p) => p.filter((a) => a !== alias))}
                  className="text-blue-400 hover:text-blue-700 transition-colors">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">ยังไม่มีชื่อเรียกอื่น</p>
        )}
      </div>

      {/* ── รุ่นรถที่ใช้ได้ ────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">รุ่นรถที่ใช้ได้</h2>
          <span className="text-sm text-gray-500">เลือกแล้ว {selectedCarModelIds.size} รุ่น</span>
        </div>
        {carBrands.length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีข้อมูลรุ่นรถ</p>
        ) : (
          <div className="space-y-3">
            {carBrands.map((brand) => {
              const isExpanded = expandedBrands.has(brand.id);
              const selectedCount = brand.carModels.filter((m) => selectedCarModelIds.has(m.id)).length;
              return (
                <div key={brand.id} className="border border-gray-100 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <button type="button" onClick={() => toggleBrand(brand.id)}
                      className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-[#1e3a5f] transition-colors">
                      <span className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                      {brand.name}
                      {selectedCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e3a5f] text-white">
                          {selectedCount}
                        </span>
                      )}
                    </button>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => selectAllModels(brand)}
                        className="text-xs text-[#1e3a5f] hover:underline">เลือกทั้งหมด</button>
                      <span className="text-gray-300">|</span>
                      <button type="button" onClick={() => deselectAllModels(brand)}
                        className="text-xs text-red-500 hover:underline">ยกเลิก</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {brand.carModels.map((model) => (
                        <label key={model.id} className="flex items-center gap-2 cursor-pointer group">
                          <input type="checkbox" checked={selectedCarModelIds.has(model.id)}
                            onChange={() => toggleCarModel(model.id)}
                            className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f] cursor-pointer" />
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
        <button type="button" onClick={() => router.push("/admin/products")}
          className="px-5 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">
          ยกเลิก
        </button>
        <button type="submit" disabled={isPending || isUploading}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" />กำลังบันทึก...</>
          ) : product ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
        </button>
      </div>
    </form>
  );
};

export default ProductForm;
