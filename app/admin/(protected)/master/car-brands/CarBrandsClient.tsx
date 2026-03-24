"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { createCarBrand, deleteCarBrand, createCarModel, deleteCarModel } from "./actions";
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
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [deletingBrand, setDeletingBrand] = useState(false);

  const handleDeleteBrand = () => {
    if (!confirm(`ต้องการลบยี่ห้อ "${brand.name}" และรุ่นรถทั้งหมดใช่หรือไม่?`)) return;
    setDeletingBrand(true);
    startTransition(async () => {
      await deleteCarBrand(brand.id);
      setDeletingBrand(false);
    });
  };

  const handleDeleteModel = (modelId: string) => {
    setDeletingModelId(modelId);
    startTransition(async () => {
      await deleteCarModel(modelId);
      setDeletingModelId(null);
    });
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-gray-50 hover:bg-gray-100 transition-colors">
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
        </button>
        <button
          onClick={handleDeleteBrand}
          disabled={deletingBrand || isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          <Trash2 size={13} />
          {deletingBrand ? "กำลังลบ..." : "ลบยี่ห้อ"}
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
                  className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-1.5"
                >
                  <span className="text-sm text-gray-700">{model.name}</span>
                  <button
                    onClick={() => handleDeleteModel(model.id)}
                    disabled={deletingModelId === model.id || isPending}
                    className="text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    title="ลบรุ่นรถ"
                  >
                    <Trash2 size={13} />
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
