"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  createCarBrand,
  toggleCarBrand,
  createCarModel,
  toggleCarModel,
  createCarBrandAlias,
  toggleCarBrandAlias,
} from "./actions";
import { CarBrand, CarBrandAlias, CarModel } from "@/lib/generated/prisma";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

type CarBrandWithModels = CarBrand & { carModels: CarModel[]; aliases: CarBrandAlias[] };

interface CarBrandsClientProps {
  carBrands: CarBrandWithModels[];
  canCreate: boolean;
  canCancel: boolean;
  canUpdate: boolean;
}

const inputClassName =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

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
          className={inputClassName}
        />
        {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#f97316] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
      >
        <Plus size={14} />
        {isPending ? "กำลังเพิ่ม..." : "เพิ่มรุ่น"}
      </button>
    </form>
  );
};

const AddAliasForm = ({ brandId }: { brandId: string }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCarBrandAlias(brandId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  };

  return (
    <form ref={formRef} action={handleCreate} className="mt-3 flex gap-2">
      <div className="flex-1">
        <input
          type="text"
          name="alias"
          placeholder="ชื่อยี่ห้อภาษาไทย/สะกดอื่น เช่น โตโยต้า, มิตซู"
          required
          className={inputClassName}
        />
        {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#162c47] disabled:opacity-60"
      >
        <Plus size={14} />
        {isPending ? "กำลังเพิ่ม..." : "เพิ่ม alias"}
      </button>
    </form>
  );
};

const BrandAccordion = ({
  brand,
  canCreate,
  canCancel,
  canUpdate,
}: {
  brand: CarBrandWithModels;
  canCreate: boolean;
  canCancel: boolean;
  canUpdate: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [togglingModelId, setTogglingModelId] = useState<string | null>(null);
  const [togglingBrand, setTogglingBrand] = useState(false);
  const [togglingAliasId, setTogglingAliasId] = useState<string | null>(null);

  const handleToggleAlias = (aliasId: string, currentActive: boolean) => {
    setTogglingAliasId(aliasId);
    startTransition(async () => {
      await toggleCarBrandAlias(aliasId, !currentActive);
      setTogglingAliasId(null);
    });
  };

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
    <div className={`overflow-hidden rounded-xl border border-gray-200 dark:border-white/10 ${getAdminMasterRowClass(brand.isActive)}`}>
      <div className={`flex items-center justify-between px-5 py-4 transition-colors ${brand.isActive ? "bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10" : "bg-transparent"}`}>
        <button type="button" className="flex flex-1 items-center gap-3 text-left" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? (
            <ChevronDown size={18} className="shrink-0 text-gray-500 dark:text-slate-400" />
          ) : (
            <ChevronRight size={18} className="shrink-0 text-gray-500 dark:text-slate-400" />
          )}
          <span className="font-kanit font-semibold text-gray-800 dark:text-slate-100">{brand.name}</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500 dark:border-white/10 dark:bg-slate-950 dark:text-slate-400">
            {brand.carModels.length} รุ่น
          </span>
          {!brand.isActive && (
            <AdminStatusBadge tone="danger">ยกเลิก</AdminStatusBadge>
          )}
        </button>
        {canCancel && (
          <button
            onClick={handleToggleBrand}
            disabled={togglingBrand || isPending}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
              brand.isActive ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500" : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
            }`}
          >
            {togglingBrand ? "..." : brand.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
          </button>
        )}
      </div>

      {isOpen && (
        <div className="bg-white px-5 py-4 dark:bg-slate-950/80">
          {brand.carModels.length === 0 ? (
            <p className="mb-3 text-sm text-gray-500 dark:text-slate-400">ยังไม่มีรุ่นรถในยี่ห้อนี้</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {brand.carModels.map((model) => (
                <div
                  key={model.id}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
                    model.isActive ? "bg-gray-100 dark:bg-white/10" : getAdminMasterRowClass(model.isActive)
                  }`}
                >
                  <span className="text-sm text-gray-700 dark:text-slate-200">{model.name}</span>
                  {!model.isActive && <AdminStatusBadge tone={getAdminActiveBadgeTone(model.isActive)}>ยกเลิก</AdminStatusBadge>}
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

          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-white/10">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
              ชื่อเรียกอื่น (alias) — ไทย/อังกฤษ ใช้จับคู่ยี่ห้อจากข้อความลูกค้าใน LINE
            </p>
            {brand.aliases.length === 0 ? (
              <p className="mb-2 text-sm text-gray-500 dark:text-slate-400">ยังไม่มี alias (ใช้ชื่อยี่ห้อภาษาอังกฤษเป็นค่าตั้งต้น)</p>
            ) : (
              <div className="mb-2 flex flex-wrap gap-2">
                {brand.aliases.map((alias) => (
                  <div
                    key={alias.id}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
                      alias.isActive ? "bg-gray-100 dark:bg-white/10" : getAdminMasterRowClass(alias.isActive)
                    }`}
                  >
                    <span className="text-sm text-gray-700 dark:text-slate-200">{alias.alias}</span>
                    {!alias.isActive && (
                      <AdminStatusBadge tone={getAdminActiveBadgeTone(alias.isActive)}>ปิด</AdminStatusBadge>
                    )}
                    {canUpdate && (
                      <button
                        onClick={() => handleToggleAlias(alias.id, alias.isActive)}
                        disabled={togglingAliasId === alias.id || isPending}
                        className={`rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                          alias.isActive
                            ? "text-red-400 hover:text-red-600"
                            : "text-green-500 hover:text-green-700"
                        }`}
                        title={alias.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                      >
                        {togglingAliasId === alias.id ? "..." : alias.isActive ? "ปิด" : "เปิด"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canUpdate && <AddAliasForm brandId={brand.id} />}
          </div>
        </div>
      )}
    </div>
  );
};

const CarBrandsClient = ({ carBrands, canCreate, canCancel, canUpdate }: CarBrandsClientProps) => {
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
        <AdminSectionCard title="เพิ่มยี่ห้อรถใหม่">
          <form ref={formRef} action={handleCreateBrand}>
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อยี่ห้อรถ เช่น Toyota, Honda"
                  required
                  className={inputClassName}
                />
                {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
              >
                <Plus size={16} />
                {isPending ? "กำลังบันทึก..." : "เพิ่มยี่ห้อ"}
              </button>
            </div>
          </form>
        </AdminSectionCard>
      )}

      <AdminSectionCard title={`รายการยี่ห้อรถ (${carBrands.length} ยี่ห้อ)`}>
        {carBrands.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ยังไม่มียี่ห้อรถ</p>
        ) : (
          <div className="space-y-3">
            {carBrands.map((brand) => (
              <BrandAccordion
                key={brand.id}
                brand={brand}
                canCreate={canCreate}
                canCancel={canCancel}
                canUpdate={canUpdate}
              />
            ))}
          </div>
        )}
      </AdminSectionCard>
    </div>
  );
};

export default CarBrandsClient;
