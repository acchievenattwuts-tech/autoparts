"use client";

import { useRef, useState, useTransition } from "react";
import { createPartsBrand, deletePartsBrand } from "./actions";
import type { PartsBrand } from "@/lib/generated/prisma";

const PartsBrandForm = ({ brands }: { brands: PartsBrand[] }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createPartsBrand(formData);
      if (result.error) setError(result.error);
      else formRef.current?.reset();
    });
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    startTransition(async () => {
      await deletePartsBrand(id);
      setDeletingId(null);
    });
  };

  return (
    <div className="space-y-6">
      {/* Add Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">เพิ่มแบรนด์อะไหล่ใหม่</h2>
        <form ref={formRef} action={handleCreate}>
          <div className="flex gap-3">
            <div className="flex-1">
              <input
                type="text"
                name="name"
                placeholder="เช่น Denso, NRF, Bosch, Sanden"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
              {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">
          รายการแบรนด์อะไหล่ ({brands.length} รายการ)
        </h2>
        {brands.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">ยังไม่มีแบรนด์อะไหล่</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อแบรนด์</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่เพิ่ม</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-gray-800 font-medium">{brand.name}</td>
                    <td className="py-3 px-4 text-gray-500">
                      {new Date(brand.createdAt).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDelete(brand.id)}
                        disabled={deletingId === brand.id || isPending}
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                      >
                        {deletingId === brand.id ? "กำลังลบ..." : "ลบ"}
                      </button>
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
