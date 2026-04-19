"use client";

import { useRef, useState, useTransition } from "react";
import { createPartsBrand, togglePartsBrand } from "./actions";
import type { PartsBrand } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";

interface PartsBrandFormProps {
  brands: PartsBrand[];
  canCreate: boolean;
  canCancel: boolean;
}

const PartsBrandForm = ({ brands, canCreate, canCancel }: PartsBrandFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createPartsBrand(formData);
      if (result.error) setError(result.error);
      else formRef.current?.reset();
    });
  };

  const handleToggle = (id: string, currentActive: boolean) => {
    setTogglingId(id);
    startTransition(async () => {
      await togglePartsBrand(id, !currentActive);
      setTogglingId(null);
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">เพิ่มแบรนด์อะไหล่ใหม่</h2>
          <form ref={formRef} action={handleCreate}>
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  name="name"
                  placeholder="เช่น Denso, NRF, Bosch, Sanden"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">
          รายการแบรนด์อะไหล่ ({brands.length} รายการ)
        </h2>
        {brands.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">ยังไม่มีแบรนด์อะไหล่</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ชื่อแบรนด์</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">สถานะ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">วันที่เพิ่ม</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr
                    key={brand.id}
                    className={`border-b border-gray-50 transition-colors ${
                      brand.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{brand.name}</td>
                    <td className="px-4 py-3">
                      {brand.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          ใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
                          ยกเลิก
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                        {formatDateThai(brand.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel ? (
                        <button
                          onClick={() => handleToggle(brand.id, brand.isActive)}
                          disabled={togglingId === brand.id || isPending}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                            brand.isActive
                              ? "bg-red-500 hover:bg-red-600"
                              : "bg-green-600 hover:bg-green-700"
                          }`}
                        >
                          {togglingId === brand.id
                            ? "..."
                            : brand.isActive
                              ? "ยกเลิก"
                              : "เปิดใช้งาน"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PartsBrandForm;
