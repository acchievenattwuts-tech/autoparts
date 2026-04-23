"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { createCategory, toggleCategory, updateCategory } from "./actions";
import { Category } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";

interface CategoryFormProps {
  categories: Category[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

const EditableRow = ({
  category,
  canUpdate,
  canCancel,
}: {
  category: Category;
  canUpdate: boolean;
  canCancel: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleUpdate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateCategory(category.id, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
      }
    });
  };

  const handleToggle = () => {
    startTransition(async () => {
      await toggleCategory(category.id, !category.isActive);
    });
  };

  if (isEditing && canUpdate) {
    return (
      <tr className="border-b border-gray-100 bg-blue-50">
        <td colSpan={4} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <form action={handleUpdate} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <input
                type="text"
                name="name"
                defaultValue={category.name}
                placeholder="ชื่อหมวดหมู่"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
              <p className="mt-1 text-xs text-gray-500">
                แก้เฉพาะชื่อหมวดหมู่ โดยคง slug เดิมไว้เพื่อไม่ให้ลิงก์หน้าร้านเปลี่ยน
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                <Check size={15} />
                {isPending ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60"
              >
                <X size={15} />
                ยกเลิก
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr
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
                        {formatDateThai(category.createdAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {canUpdate && (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
            >
              <Pencil size={12} />
              แก้ไข
            </button>
          )}
          {canCancel ? (
            <button
              onClick={handleToggle}
              disabled={isPending}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                category.isActive ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {category.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
            </button>
          ) : !canUpdate ? (
            <span className="text-xs text-gray-300">-</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
};

const CategoryForm = ({ categories, canCreate, canUpdate, canCancel }: CategoryFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

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
                  <EditableRow
                    key={category.id}
                    category={category}
                    canUpdate={canUpdate}
                    canCancel={canCancel}
                  />
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
