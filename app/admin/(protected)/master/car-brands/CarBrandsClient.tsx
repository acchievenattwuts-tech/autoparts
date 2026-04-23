"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { createCarBrand, toggleCarBrand, createCarModel, toggleCarModel } from "./actions";
import { CarBrand, CarModel } from "@/lib/generated/prisma";

type CarBrandWithModels = CarBrand & { carModels: CarModel[] };

interface CarBrandsClientProps {
  carBrands: CarBrandWithModels[];
  canCreate: boolean;
  canCancel: boolean;
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
    <form ref={formRef} action={handleCreate} className="mt-3 flex gap-2">
      <input type="hidden" name="carBrandId" value={brandId} />
      <div className="flex-1">
        <input
          type="text"
          name="name"
          placeholder="ชื่อรุ่นรถ เช่น Civic, Vios"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
      >
        <Plus size={14} />
        {isPending ? "กำลังเพิ่ม..." : "เพิ่มรุ่น"}
      </button>
    </form>
  );
};

const BrandAccordion = ({
  brand,
  canCreate,
  canCancel,
}: {
  brand: CarBrandWithModels;
  canCreate: boolean;
  canCancel: boolean;
}) => {
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
    <div className={`overflow-hidden rounded-xl border ${brand.isActive ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
      <div className={`flex items-center justify-between px-5 py-4 transition-colors ${brand.isActive ? "bg-gray-50 hover:bg-gray-100" : "bg-gray-100"}`}>
        <button type="button" className="flex flex-1 items-center gap-3 text-left" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? (
            <ChevronDown size={18} className="shrink-0 text-gray-500" />
          ) : (
            <ChevronRight size={18} className="shrink-0 text-gray-500" />
          )}
          <span className="font-kanit font-semibold text-gray-800">{brand.name}</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500">
            {brand.carModels.length} รุ่น
          </span>
          {!brand.isActive && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">ยกเลิก</span>
          )}
        </button>
        {canCancel && (
          <button
            onClick={handleToggleBrand}
            disabled={togglingBrand || isPending}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
              brand.isActive ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {togglingBrand ? "..." : brand.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
          </button>
        )}
      </div>

      {isOpen && (
        <div className="bg-white px-5 py-4">
          {brand.carModels.length === 0 ? (
            <p className="mb-3 text-sm text-gray-500">ยังไม่มีรุ่นรถในยี่ห้อนี้</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {brand.carModels.map((model) => (
                <div
                  key={model.id}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
                    model.isActive ? "bg-gray-100" : "bg-gray-50 opacity-60"
                  }`}
                >
                  <span className="text-sm text-gray-700">{model.name}</span>
                  {!model.isActive && <span className="text-xs text-gray-400">(ยกเลิก)</span>}
                  {canCancel && (
                    <button
                      onClick={() => handleToggleModel(model.id, model.isActive)}
                      disabled={togglingModelId === model.id || isPending}
                      className={`rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                        model.isActive
                          ? "text-red-400 hover:text-red-600"
                          : "text-green-500 hover:text-green-700"
                      }`}
                      title={model.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
                    >
                      {togglingModelId === model.id ? "..." : model.isActive ? "ปิด" : "เปิด"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canCreate && <AddModelForm brandId={brand.id} />}
        </div>
      )}
    </div>
  );
};

const CarBrandsClient = ({ carBrands, canCreate, canCancel }: CarBrandsClientProps) => {
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
      {canCreate && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">เพิ่มยี่ห้อรถใหม่</h2>
          <form ref={formRef} action={handleCreateBrand}>
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อยี่ห้อรถ เช่น Toyota, Honda"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                <Plus size={16} />
                {isPending ? "กำลังบันทึก..." : "เพิ่มยี่ห้อ"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">
          รายการยี่ห้อรถ ({carBrands.length} ยี่ห้อ)
        </h2>
        {carBrands.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">ยังไม่มียี่ห้อรถ</p>
        ) : (
          <div className="space-y-3">
            {carBrands.map((brand) => (
              <BrandAccordion
                key={brand.id}
                brand={brand}
                canCreate={canCreate}
                canCancel={canCancel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CarBrandsClient;
