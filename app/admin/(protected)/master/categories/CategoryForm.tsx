"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Check, ImageOff, Pencil, Upload, X } from "lucide-react";
import CropImageDialog from "@/components/shared/CropImageDialog";
import type { Category } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";
import {
  createCategory,
  createCategoryAlias,
  toggleCategory,
  toggleCategoryAlias,
  updateCategory,
  updateCategoryAlias,
  uploadCategoryImage,
} from "./actions";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

type CategoryRow = Pick<
  Category,
  "id" | "name" | "slug" | "isActive" | "createdAt" | "imageUrl"
>;

type CategoryAliasRow = {
  id: string;
  alias: string;
  kind: "MATCH" | "SKIP_CATEGORY";
  matchMode: "EXACT" | "CONTAINS" | "TOKEN";
  priority: number;
  isActive: boolean;
  notes: string | null;
};

export type CategoryWithAliases = CategoryRow & {
  aliases: CategoryAliasRow[];
};

export interface CategoryFormProps {
  categories: CategoryWithAliases[];
  aliasCoverageGaps: Array<{ id: string; name: string }>;
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

const selectClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";
const inputClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

const KIND_LABELS: Record<CategoryAliasRow["kind"], string> = {
  MATCH: "จับคู่หมวด",
  SKIP_CATEGORY: "ข้ามหมวด",
};

const MATCH_MODE_LABELS: Record<CategoryAliasRow["matchMode"], string> = {
  EXACT: "ตรงทั้งคำ",
  CONTAINS: "มีคำนี้",
  TOKEN: "ตรง token",
};

/** Fixed square preview so the admin sees exactly the storefront tile crop. */
const IMAGE_PREVIEW_SIZE_PX = 72;

/** The colour behind the storefront tile — the crop is flattened onto it. */
const CATEGORY_TILE_BACKGROUND = "#f7fafe";

/**
 * Category thumbnail picker. The picked file goes through the shared circular
 * crop dialog first, then uploads to Blob; the resulting URL rides in a hidden
 * input so the enclosing form still submits as plain FormData. An empty value
 * means "no image" — the storefront then falls back to the category's
 * best-selling product photo, then to a name-inferred icon.
 */
const CategoryImageField = ({
  categoryId = "",
  defaultImageUrl = null,
}: {
  categoryId?: string;
  defaultImageUrl?: string | null;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string>(defaultImageUrl ?? "");
  const [error, setError] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const resetFileInput = () => {
    // Let the same file be re-picked after a cancel or an error.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setPendingFile(file);
  };

  const handleCropCancel = () => {
    setPendingFile(null);
    resetFileInput();
  };

  const handleCropConfirm = async (croppedFile: File) => {
    setPendingFile(null);
    setError("");
    setIsUploading(true);
    try {
      const uploadData = new FormData();
      uploadData.set("file", croppedFile);
      const result = await uploadCategoryImage(categoryId, uploadData);
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        setImageUrl(result.url);
      }
    } catch {
      setError("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsUploading(false);
      resetFileInput();
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
      <input type="hidden" name="imageUrl" value={imageUrl} />

      <div className="flex items-start gap-3">
        {/* Mirrors the storefront tile exactly (circle filled edge to edge) so the
            framing the admin approved in the crop dialog is what customers see. */}
        <span className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-[#f7fafe] dark:border-white/10 dark:bg-slate-950">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt="พรีวิวรูปหมวดหมู่"
              width={IMAGE_PREVIEW_SIZE_PX}
              height={IMAGE_PREVIEW_SIZE_PX}
              sizes="72px"
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageOff className="h-6 w-6 text-gray-300 dark:text-slate-600" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              รูปหมวดหมู่บนหน้าร้าน
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              แนบได้ JPG, PNG, WebP ไม่เกิน 2MB — เลือกไฟล์แล้วจะให้ครอปเป็นวงกลมก่อน
              สิ่งที่อยู่ในวงกลมคือสิ่งที่ลูกค้าเห็น ถ้าไม่แนบระบบจะใช้รูปสินค้าขายดีในหมวดนั้นให้อัตโนมัติ
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <Upload size={12} />
              {isUploading ? "กำลังอัปโหลด..." : imageUrl ? "เปลี่ยนรูป" : "แนบรูป"}
            </button>

            {imageUrl && (
              <button
                type="button"
                onClick={() => {
                  setImageUrl("");
                  setError("");
                }}
                disabled={isUploading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
              >
                <X size={12} />
                ลบรูป
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-300">{error}</p>}
        </div>
      </div>

      <CropImageDialog
        file={pendingFile}
        index={0}
        total={1}
        subtitle="ครอปรูปหมวดหมู่"
        circular
        backgroundColor={CATEGORY_TILE_BACKGROUND}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
    </div>
  );
};

const AliasManager = ({
  category,
  canUpdate,
}: {
  category: CategoryWithAliases;
  canUpdate: boolean;
}) => {
  const [error, setError] = useState<string>("");
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreateAlias = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCategoryAlias(category.id, formData);
      if (result.error) setError(result.error);
    });
  };

  const handleUpdateAlias = (aliasId: string, formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateCategoryAlias(aliasId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setEditingAliasId(null);
      }
    });
  };

  const handleToggleAlias = (aliasId: string, nextActive: boolean) => {
    setError("");
    startTransition(async () => {
      const result = await toggleCategoryAlias(aliasId, nextActive);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap gap-2">
        {category.aliases.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-slate-500">ยังไม่มี alias สำหรับ LINE/search</span>
        ) : (
          category.aliases.map((alias) => (
            <span
              key={alias.id}
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                editingAliasId === alias.id
                  ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200"
                  : alias.isActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200"
                  : "border-gray-200 bg-white text-gray-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-500"
              }`}
              title={alias.notes ?? undefined}
            >
              <span className="font-medium">{alias.alias}</span>
              <span>{KIND_LABELS[alias.kind]}</span>
              <span>{MATCH_MODE_LABELS[alias.matchMode]}</span>
              <span>p{alias.priority}</span>
              {canUpdate && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingAliasId((current) => (current === alias.id ? null : alias.id))
                    }
                    disabled={isPending}
                    className="rounded-full px-1.5 py-0.5 text-[11px] font-medium text-[#1e3a5f] hover:bg-white disabled:opacity-60 dark:text-sky-200 dark:hover:bg-white/10"
                  >
                    {editingAliasId === alias.id ? "ปิดแก้ไข" : "แก้ไข"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleAlias(alias.id, !alias.isActive)}
                    disabled={isPending}
                    className="rounded-full px-1.5 py-0.5 text-[11px] font-medium text-[#1e3a5f] hover:bg-white disabled:opacity-60 dark:text-sky-200 dark:hover:bg-white/10"
                  >
                    {alias.isActive ? "ปิด" : "เปิด"}
                  </button>
                </>
              )}
            </span>
          ))
        )}
      </div>

      {canUpdate &&
        editingAliasId &&
        (() => {
          const editing = category.aliases.find((alias) => alias.id === editingAliasId);
          if (!editing) return null;
          return (
            <form
              key={editing.id}
              action={(formData) => handleUpdateAlias(editing.id, formData)}
              className="grid gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-2 md:grid-cols-[minmax(160px,1fr)_140px_130px_90px_minmax(160px,1fr)_auto_auto] dark:border-sky-400/20 dark:bg-sky-400/5"
            >
              <input
                type="text"
                name="alias"
                defaultValue={editing.alias}
                placeholder="alias เช่น radiator hose"
                required
                className={inputClassName}
              />
              <select name="kind" defaultValue={editing.kind} className={selectClassName}>
                <option value="MATCH">จับคู่หมวด</option>
                <option value="SKIP_CATEGORY">ข้ามหมวด</option>
              </select>
              <select name="matchMode" defaultValue={editing.matchMode} className={selectClassName}>
                <option value="CONTAINS">มีคำนี้</option>
                <option value="EXACT">ตรงทั้งคำ</option>
                <option value="TOKEN">ตรง token</option>
              </select>
              <input
                type="number"
                name="priority"
                defaultValue={editing.priority}
                min={0}
                max={1000}
                className={inputClassName}
              />
              <input
                type="text"
                name="notes"
                defaultValue={editing.notes ?? ""}
                placeholder="หมายเหตุ"
                className={inputClassName}
              />
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-[#1e3a5f] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                บันทึก
              </button>
              <button
                type="button"
                onClick={() => setEditingAliasId(null)}
                disabled={isPending}
                className="rounded-lg bg-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
              >
                ยกเลิก
              </button>
            </form>
          );
        })()}

      {canUpdate && !editingAliasId && (
        <form action={handleCreateAlias} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_140px_130px_90px_minmax(160px,1fr)_auto]">
          <input
            type="text"
            name="alias"
            placeholder="alias เช่น radiator hose"
            required
            className={inputClassName}
          />
          <select name="kind" defaultValue="MATCH" className={selectClassName}>
            <option value="MATCH">จับคู่หมวด</option>
            <option value="SKIP_CATEGORY">ข้ามหมวด</option>
          </select>
          <select name="matchMode" defaultValue="CONTAINS" className={selectClassName}>
            <option value="CONTAINS">มีคำนี้</option>
            <option value="EXACT">ตรงทั้งคำ</option>
            <option value="TOKEN">ตรง token</option>
          </select>
          <input
            type="number"
            name="priority"
            defaultValue={0}
            min={0}
            max={1000}
            className={inputClassName}
          />
          <input type="text" name="notes" placeholder="หมายเหตุ" className={inputClassName} />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[#1e3a5f] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
          >
            เพิ่ม alias
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-500 dark:text-red-300">{error}</p>}
    </div>
  );
};

const EditableRow = ({
  category,
  canUpdate,
  canCancel,
}: {
  category: CategoryWithAliases;
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
      <tr className="border-b border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
        <td colSpan={5} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500 dark:text-red-300">{error}</p>}
          <form action={handleUpdate} className="space-y-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.2fr)_auto] xl:items-start">
              <div>
                <input
                  type="text"
                  name="name"
                  defaultValue={category.name}
                  placeholder="ชื่อหมวดหมู่"
                  required
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  แก้เฉพาะชื่อหมวดหมู่ โดยคง slug เดิมไว้เพื่อไม่ให้ลิงก์หน้าร้านเปลี่ยน
                </p>
              </div>

              <CategoryImageField
                categoryId={category.id}
                defaultImageUrl={category.imageUrl}
              />

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
                  className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
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
    <>
    <tr
      className={`border-b border-gray-50 transition-colors ${
        getAdminMasterRowClass(category.isActive)
      }`}
    >
      <td className="px-4 py-3 text-gray-800 dark:text-slate-100">{category.name}</td>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-2">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-[#f7fafe] dark:border-white/10 dark:bg-slate-950">
            {category.imageUrl ? (
              <Image
                src={category.imageUrl}
                alt={`รูปหมวด ${category.name}`}
                width={40}
                height={40}
                sizes="40px"
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff className="h-4 w-4 text-gray-300 dark:text-slate-600" aria-hidden="true" />
            )}
          </span>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {category.imageUrl ? "แนบรูปแล้ว" : "ใช้รูปสินค้าขายดีอัตโนมัติ"}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        {category.isActive ? (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(category.isActive)}>ใช้งาน</AdminStatusBadge>
        ) : (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(category.isActive)}>ยกเลิก</AdminStatusBadge>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{formatDateThai(category.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <AdminActionGroup align="end">
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
                category.isActive ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500" : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
              }`}
            >
              {category.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
            </button>
          ) : !canUpdate ? (
            <span className="text-xs text-gray-300 dark:text-slate-600">-</span>
          ) : null}
        </AdminActionGroup>
      </td>
    </tr>
    <tr className="border-b border-gray-100 dark:border-white/10">
      <td colSpan={5} className="px-4 py-3">
        <AliasManager category={category} canUpdate={canUpdate} />
      </td>
    </tr>
    </>
  );
};

const CategoryForm = ({ categories, aliasCoverageGaps, canCreate, canUpdate, canCancel }: CategoryFormProps) => {
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
      {aliasCoverageGaps.length > 0 && (
        <AdminSectionCard title="หมวดที่ยังไม่มี alias สำหรับ LINE/search">
          <div className="flex flex-wrap gap-2">
            {aliasCoverageGaps.map((category) => (
              <span
                key={category.id}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
              >
                {category.name}
              </span>
            ))}
          </div>
        </AdminSectionCard>
      )}

      {canCreate && (
        <AdminSectionCard title="เพิ่มหมวดหมู่ใหม่">
          <form ref={formRef} action={handleCreate} className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(460px,1.2fr)]">
              <div>
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อหมวดหมู่"
                  required
                  className={inputClassName}
                />
                {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
              </div>
              <CategoryImageField key={formResetKey} />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
            </button>
          </form>
        </AdminSectionCard>
      )}

      <AdminTableSection title={`รายการหมวดหมู่ (${categories.length} รายการ)`}>
        {categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ยังไม่มีหมวดหมู่</p>
        ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อหมวดหมู่</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รูปหน้าร้าน</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่เพิ่ม</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
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
        )}
      </AdminTableSection>
    </div>
  );
};

export default CategoryForm;
