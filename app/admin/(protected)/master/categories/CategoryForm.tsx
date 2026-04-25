"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { CategoryVisualIcon } from "@/components/shared/CategoryVisualIcon";
import {
  CATEGORY_ICON_OPTIONS,
  CATEGORY_MOTION_OPTIONS,
  CATEGORY_TONE_OPTIONS,
  DEFAULT_CATEGORY_VISUAL,
  type CategoryIconKey,
  type CategoryMotionKey,
  type CategoryToneKey,
  type CategoryVisualSetting,
} from "@/lib/category-visual-config";
import type { Category } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";
import { createCategory, toggleCategory, updateCategory } from "./actions";

type CategoryRow = Pick<Category, "id" | "name" | "slug" | "isActive" | "createdAt">;

type CategoryWithVisual = CategoryRow & {
  visual: CategoryVisualSetting;
};

interface CategoryFormProps {
  categories: CategoryWithVisual[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

const getOptionLabel = <Key extends string>(
  options: readonly { key: Key; label: string }[],
  key: Key,
) => options.find((option) => option.key === key)?.label ?? key;

const selectClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

const VisualFields = ({
  defaultVisual = DEFAULT_CATEGORY_VISUAL,
}: {
  defaultVisual?: CategoryVisualSetting;
}) => {
  const [iconKey, setIconKey] = useState<CategoryIconKey>(defaultVisual.iconKey);
  const [toneKey, setToneKey] = useState<CategoryToneKey>(defaultVisual.toneKey);
  const [motionKey, setMotionKey] = useState<CategoryMotionKey>(defaultVisual.motionKey);
  const previewVisual: CategoryVisualSetting = { iconKey, toneKey, motionKey };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="group mb-3 flex items-center gap-3">
        <CategoryVisualIcon
          visual={previewVisual}
          className="h-11 w-11 rounded-xl"
          iconClassName="h-5 w-5"
        />
        <div>
          <p className="text-xs font-semibold text-gray-700">พรีวิวไอคอนหน้าร้าน</p>
          <p className="text-xs text-gray-500">เลือกไอคอน สี และโมชั่น hover ได้จากตรงนี้</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-gray-600">
          <span>ไอคอน</span>
          <select
            name="iconKey"
            value={iconKey}
            onChange={(event) => setIconKey(event.target.value as CategoryIconKey)}
            className={selectClassName}
          >
            {CATEGORY_ICON_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium text-gray-600">
          <span>โทนสี</span>
          <select
            name="toneKey"
            value={toneKey}
            onChange={(event) => setToneKey(event.target.value as CategoryToneKey)}
            className={selectClassName}
          >
            {CATEGORY_TONE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium text-gray-600">
          <span>โมชั่น</span>
          <select
            name="motionKey"
            value={motionKey}
            onChange={(event) => setMotionKey(event.target.value as CategoryMotionKey)}
            className={selectClassName}
          >
            {CATEGORY_MOTION_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};

const EditableRow = ({
  category,
  canUpdate,
  canCancel,
}: {
  category: CategoryWithVisual;
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
        <td colSpan={5} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <form action={handleUpdate} className="space-y-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.2fr)_auto] xl:items-start">
              <div>
                <input
                  type="text"
                  name="name"
                  defaultValue={category.name}
                  placeholder="ชื่อหมวดหมู่"
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                <p className="mt-1 text-xs text-gray-500">
                  แก้เฉพาะชื่อหมวดหมู่ โดยคง slug เดิมไว้เพื่อไม่ให้ลิงก์หน้าร้านเปลี่ยน
                </p>
              </div>

              <VisualFields defaultVisual={category.visual} />

              <div className="flex gap-2 xl:justify-end">
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
        <div className="group inline-flex items-center gap-2">
          <CategoryVisualIcon
            visual={category.visual}
            className="h-10 w-10 rounded-xl"
            iconClassName="h-5 w-5"
          />
          <div className="min-w-[120px] text-xs text-gray-500">
            <p className="font-medium text-gray-700">
              {getOptionLabel(CATEGORY_ICON_OPTIONS, category.visual.iconKey)}
            </p>
            <p>
              {getOptionLabel(CATEGORY_TONE_OPTIONS, category.visual.toneKey)} ·{" "}
              {getOptionLabel(CATEGORY_MOTION_OPTIONS, category.visual.motionKey)}
            </p>
          </div>
        </div>
      </td>
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
      <td className="px-4 py-3 text-gray-500">{formatDateThai(category.createdAt)}</td>
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
  const [formResetKey, setFormResetKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCategory(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        setFormResetKey((current) => current + 1);
      }
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">
            เพิ่มหมวดหมู่ใหม่
          </h2>
          <form ref={formRef} action={handleCreate} className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(460px,1.2fr)]">
              <div>
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อหมวดหมู่"
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
              </div>
              <VisualFields key={formResetKey} />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
            </button>
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
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ไอคอนหน้าร้าน</th>
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
