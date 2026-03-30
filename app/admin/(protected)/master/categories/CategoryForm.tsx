"use client";

import { useRef, useState, useTransition } from "react";
import { createCategory, toggleCategory } from "./actions";
import { Category } from "@/lib/generated/prisma";

interface CategoryFormProps {
  categories: Category[];
  canCreate: boolean;
  canCancel: boolean;
}

const CategoryForm = ({ categories, canCreate, canCancel }: CategoryFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCategory(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  };

  const handleToggle = (id: string, currentActive: boolean) => {
    setTogglingId(id);
    startTransition(async () => {
      await toggleCategory(id, !currentActive);
      setTogglingId(null);
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">เพิ่มหมวดหมู่ใหม่</h2>
          <form ref={formRef} action={handleCreate}>
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อหมวดหมู่"
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
          รายการหมวดหมู่ ({categories.length} รายการ)
        </h2>
        {categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">ยังไม่มีหมวดหมู่</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ชื่อหมวดหมู่</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">สถานะ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">วันที่เพิ่ม</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr
                    key={category.id}
                    className={`border-b border-gray-50 transition-colors ${
                      category.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-800">{category.name}</td>
                    <td className="px-4 py-3">
                      {category.isActive ? (
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
                      {new Date(category.createdAt).toLocaleDateString("th-TH-u-ca-gregory", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel ? (
                        <button
                          onClick={() => handleToggle(category.id, category.isActive)}
                          disabled={togglingId === category.id || isPending}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                            category.isActive
                              ? "bg-red-500 hover:bg-red-600"
                              : "bg-green-600 hover:bg-green-700"
                          }`}
                        >
                          {togglingId === category.id
                            ? "..."
                            : category.isActive
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

export default CategoryForm;
