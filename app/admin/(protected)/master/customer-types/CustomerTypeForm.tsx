"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { CustomerType } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";
import { createCustomerType, toggleCustomerType, updateCustomerType } from "./actions";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

type CustomerTypeRow = Pick<
  CustomerType,
  "id" | "name" | "priceTier" | "isActive" | "sortOrder" | "isSystem" | "createdAt"
>;

interface CustomerTypeFormProps {
  customerTypes: CustomerTypeRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

const inputClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

const PriceTierBadge = ({ priceTier }: { priceTier: CustomerType["priceTier"] }) => {
  if (priceTier === "WHOLESALE") return <AdminStatusBadge tone="info">ราคาขายส่ง</AdminStatusBadge>;
  if (priceTier === "MEMBER") return <AdminStatusBadge tone="success">ราคาสมาชิก</AdminStatusBadge>;
  return <AdminStatusBadge tone="muted">ราคาขายปลีก</AdminStatusBadge>;
};

const CustomerTypeRowEditor = ({
  item,
  canUpdate,
  canCancel,
  isBusy,
  onToggle,
}: {
  item: CustomerTypeRow;
  canUpdate: boolean;
  canCancel: boolean;
  isBusy: boolean;
  onToggle: (id: string, currentActive: boolean) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleUpdate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateCustomerType(item.id, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
      }
    });
  };

  const editable = canUpdate && !item.isSystem;

  if (isEditing && editable) {
    return (
      <tr className="border-b border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
        <td colSpan={5} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500 dark:text-red-300">{error}</p>}
          <form action={handleUpdate} className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <input
                type="text"
                name="name"
                defaultValue={item.name}
                placeholder="ชื่อประเภทลูกค้า"
                required
                className={inputClassName}
              />
            </div>
            <div className="sm:w-28">
              <input
                type="number"
                name="sortOrder"
                defaultValue={item.sortOrder}
                min={0}
                placeholder="ลำดับ"
                className={inputClassName}
              />
            </div>
            <div className="sm:w-40">
              <select
                name="priceTier"
                defaultValue={item.priceTier}
                className={inputClassName}
                aria-label="ระดับราคา"
              >
                <option value="RETAIL">ราคาขายปลีก</option>
                <option value="MEMBER">ราคาสมาชิก</option>
                <option value="WHOLESALE">ราคาขายส่ง</option>
              </select>
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
                className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
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
    <tr className={`border-b border-gray-50 transition-colors ${getAdminMasterRowClass(item.isActive)}`}>
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-100">
        {item.name}
        {item.isSystem && (
          <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">(ระบบ)</span>
        )}
      </td>
      <td className="px-4 py-3">
        <PriceTierBadge priceTier={item.priceTier} />
      </td>
      <td className="px-4 py-3">
        <AdminStatusBadge tone={getAdminActiveBadgeTone(item.isActive)}>
          {item.isActive ? "ใช้งาน" : "ยกเลิก"}
        </AdminStatusBadge>
      </td>
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{formatDateThai(item.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <AdminActionGroup align="end">
          {item.isSystem ? (
            <span className="text-xs text-gray-300 dark:text-slate-600">ล็อก</span>
          ) : (
            <>
              {canUpdate && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
                >
                  <Pencil size={12} />
                  แก้ไข
                </button>
              )}
              {canCancel ? (
                <button
                  type="button"
                  onClick={() => onToggle(item.id, item.isActive)}
                  disabled={isBusy}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                    item.isActive
                      ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500"
                      : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
                  }`}
                >
                  {isBusy ? "..." : item.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
                </button>
              ) : !canUpdate ? (
                <span className="text-xs text-gray-300 dark:text-slate-600">-</span>
              ) : null}
            </>
          )}
        </AdminActionGroup>
      </td>
    </tr>
  );
};

const CustomerTypeForm = ({ customerTypes, canCreate, canUpdate, canCancel }: CustomerTypeFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createCustomerType(formData);
      if (result.error) setError(result.error);
      else formRef.current?.reset();
    });
  };

  const handleToggle = (id: string, currentActive: boolean) => {
    setTogglingId(id);
    startTransition(async () => {
      await toggleCustomerType(id, !currentActive);
      setTogglingId(null);
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <AdminSectionCard title="เพิ่มประเภทลูกค้าใหม่">
          <form ref={formRef} action={handleCreate}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <input
                  type="text"
                  name="name"
                  placeholder="เช่น ขายส่ง, ตัวแทนจำหน่าย"
                  required
                  className={inputClassName}
                />
                {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
              </div>
              <div className="sm:w-28">
                <input
                  type="number"
                  name="sortOrder"
                  defaultValue={0}
                  min={0}
                  placeholder="ลำดับ"
                  className={inputClassName}
                />
              </div>
              <div className="sm:w-40">
                <select name="priceTier" defaultValue="RETAIL" className={inputClassName} aria-label="ระดับราคา">
                  <option value="RETAIL">ราคาขายปลีก</option>
                  <option value="MEMBER">ราคาสมาชิก</option>
                  <option value="WHOLESALE">ราคาขายส่ง</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
              >
                {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
              </button>
            </div>
          </form>
        </AdminSectionCard>
      )}

      <AdminTableSection title={`รายการประเภทลูกค้า (${customerTypes.length} รายการ)`}>
        {customerTypes.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">
            ยังไม่มีประเภทลูกค้า
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">
                  ชื่อประเภท
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">
                  ระดับราคา
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">
                  สถานะ
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">
                  วันที่เพิ่ม
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody>
              {customerTypes.map((item) => (
                <CustomerTypeRowEditor
                  key={item.id}
                  item={item}
                  canUpdate={canUpdate}
                  canCancel={canCancel}
                  isBusy={togglingId === item.id || isPending}
                  onToggle={handleToggle}
                />
              ))}
            </tbody>
          </table>
        )}
      </AdminTableSection>
    </div>
  );
};

export default CustomerTypeForm;
