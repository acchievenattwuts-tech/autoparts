"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { createCarBrand, toggleCarBrand, createCarModel, toggleCarModel } from "./actions";
import { CarBrand, CarModel } from "@/lib/generated/prisma";

type CarBrandWithModels = CarBrand & { carModels: CarModel[] };

interface CarBrandsClientProps {
  carBrands: CarBrandWithModels[];
}

const AddModelForm = ({ brandId }: { brandId: string }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCarModel(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  };

  return (
    <form ref={formRef} action={handleCreate} className="flex gap-2 mt-3">
      <input type="hidden" name="carBrandId" value={brandId} />
      <div className="flex-1">
        <input
          type="text"
          name="name"
          placeholder="ชื่อรุ่นรถ เช่น Civic, Vios"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
        {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
      >
        <Plus size={14} />
        {isPending ? "กำลังเพิ่ม..." : "เพิ่มรุ่น"}
      </button>
    </form>
  );
};

const BrandAccordion = ({ brand }: { brand: CarBrandWithModels }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [togglingModelId, setTogglingModelId] = useState<string | null>(null);
  const [togglingBrand, setTogglingBrand] = useState(false);

  const handleToggleBrand = () => {
    const action = brand.isActive ? "ยกเลิก" : "เปิดใช้งาน";
    if (!confirm(`ต้องการ${action}ยี่ห้อ "${brand.name}" ใช่หรือไม่?`)) return;
    setTogglingBrand(true);
    startTransition(async () => {
      await toggleCarBrand(brand.id, !brand.isActive);
      setTogglingBrand(false);
    });
  };

  const handleToggleModel = (modelId: string, currentActive: boolean) => {
    setTogglingModelId(modelId);
    startTransition(async () => {
      await toggleCarModel(modelId, !currentActive);
      setTogglingModelId(null);
    });
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${brand.isActive ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
      {/* Brand Header */}
      <div className={`flex items-center justify-between px-5 py-4 transition-colors ${brand.isActive ? "bg-gray-50 hover:bg-gray-100" : "bg-gray-100"}`}>
        <button
          type="button"
          className="flex items-center gap-3 flex-1 text-left"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? (
            <ChevronDown size={18} className="text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronRight size={18} className="text-gray-500 flex-shrink-0" />
          )}
          <span className="font-kanit font-semibold text-gray-800">{brand.name}</span>
          <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
            {brand.carModels.length} รุ่น
          </span>
          {!brand.isActive && (
            <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">ยกเลิก</span>
          )}
        </button>
        <button
          onClick={handleToggleBrand}
          disabled={togglingBrand || isPending}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
            brand.isActive ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {togglingBrand ? "..." : brand.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
        </button>
      </div>

      {/* Models List */}
      {isOpen && (
        <div className="px-5 py-4 bg-white">
          {brand.carModels.length === 0 ? (
            <p className="text-sm text-gray-500 mb-3">ยังไม่มีรุ่นรถในยี่ห้อนี้</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-3">
              {brand.carModels.map((model) => (
                <div
                  key={model.id}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${model.isActive ? "bg-gray-100" : "bg-gray-50 opacity-60"}`}
                >
                  <span className="text-sm text-gray-700">{model.name}</span>
                  {!model.isActive && (
                    <span className="text-xs text-gray-400">(ยกเลิก)</span>
                  )}
                  <button
                    onClick={() => handleToggleModel(model.id, model.isActive)}
                    disabled={togglingModelId === model.id || isPending}
                    className={`text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                      model.isActive
                        ? "text-red-400 hover:text-red-600"
                        : "text-green-500 hover:text-green-700"
                    }`}
                    title={model.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
                  >
                    {togglingModelId === model.id ? "..." : model.isActive ? "✕" : "✓"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <AddModelForm brandId={brand.id} />
        </div>
      )}
    </div>
  );
};

const CarBrandsClient = ({ carBrands }: CarBrandsClientProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleCreateBrand = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCarBrand(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Add Brand Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">เพิ่มยี่ห้อรถใหม่</h2>
        <form ref={formRef} action={handleCreateBrand}>
          <div className="flex gap-3">
            <div className="flex-1">
              <input
                type="text"
                name="name"
                placeholder="ชื่อยี่ห้อรถ เช่น Toyota, Honda"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
              {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              <Plus size={16} />
              {isPending ? "กำลังบันทึก..." : "เพิ่มยี่ห้อ"}
            </button>
          </div>
        </form>
      </div>

      {/* Brands Accordion */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">
          รายการยี่ห้อรถ ({carBrands.length} ยี่ห้อ)
        </h2>
        {carBrands.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">ยังไม่มียี่ห้อรถ</p>
        ) : (
          <div className="space-y-3">
            {carBrands.map((brand) => (
              <BrandAccordion key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CarBrandsClient;
