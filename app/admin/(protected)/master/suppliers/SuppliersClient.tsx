"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Pencil, X, Check } from "lucide-react";
import { createSupplier, updateSupplier, toggleSupplier } from "./actions";
import { Supplier } from "@/lib/generated/prisma";
import TaxIdInput from "@/components/shared/TaxIdInput";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

interface SuppliersClientProps {
  suppliers: Supplier[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

interface SupplierFormFields {
  name: string;
  contactName: string;
  phone: string;
  address: string;
  taxId: string;
  creditTerm: string;
}

const emptyFields: SupplierFormFields = {
  name: "",
  contactName: "",
  phone: "",
  address: "",
  taxId: "",
  creditTerm: "",
};

const inputClassName =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";
const labelClassName = "mb-1 block text-xs font-medium text-gray-600 dark:text-slate-300";

const SupplierFormRow = ({
  onSubmit,
  onCancel,
  defaultValues = emptyFields,
  submitLabel,
  isPending,
}: {
  onSubmit: (formData: FormData) => void;
  onCancel?: () => void;
  defaultValues?: SupplierFormFields;
  submitLabel: string;
  isPending: boolean;
}) => (
  <form action={onSubmit}>
    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div>
        <label className={labelClassName}>
          ชื่อผู้จำหน่าย <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="name"
          defaultValue={defaultValues.name}
          placeholder="ชื่อบริษัท / ร้านค้า"
          required
          className={inputClassName}
        />
      </div>
      <div>
        <label className={labelClassName}>ชื่อผู้ติดต่อ</label>
        <input
          type="text"
          name="contactName"
          defaultValue={defaultValues.contactName}
          placeholder="ชื่อผู้ติดต่อ"
          className={inputClassName}
        />
      </div>
      <div>
        <label className={labelClassName}>เบอร์โทรศัพท์</label>
        <input
          type="tel"
          name="phone"
          defaultValue={defaultValues.phone}
          placeholder="0xx-xxx-xxxx"
          className={inputClassName}
        />
      </div>
      <div>
        <label className={labelClassName}>ที่อยู่</label>
        <input
          type="text"
          name="address"
          defaultValue={defaultValues.address}
          placeholder="ที่อยู่"
          className={inputClassName}
        />
      </div>
      <div>
        <label className={labelClassName}>เลขผู้เสียภาษี</label>
        <TaxIdInput
          name="taxId"
          defaultValue={defaultValues.taxId}
          placeholder="13 หลัก"
          className={inputClassName}
        />
      </div>
      <div>
        <label className={labelClassName}>เครดิตเทอม (วัน)</label>
        <input
          type="number"
          name="creditTerm"
          min={0}
          max={365}
          defaultValue={defaultValues.creditTerm}
          placeholder="เช่น 30"
          className={inputClassName}
        />
      </div>
    </div>
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
      >
        <Check size={15} />
        {isPending ? "กำลังบันทึก..." : submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          <X size={15} />
          ยกเลิก
        </button>
      )}
    </div>
  </form>
);

const EditableRow = ({
  supplier,
  canUpdate,
  canCancel,
}: {
  supplier: Supplier;
  canUpdate: boolean;
  canCancel: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [isToggling, setIsToggling] = useState(false);

  const handleUpdate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateSupplier(supplier.id, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
      }
    });
  };

  const handleToggle = () => {
    const action = supplier.isActive ? "ยกเลิก" : "เปิดใช้งาน";
    if (!confirm(`ต้องการ${action}ผู้จำหน่าย "${supplier.name}" ใช่หรือไม่?`)) return;
    setIsToggling(true);
    startTransition(async () => {
      try {
        await toggleSupplier(supplier.id, !supplier.isActive);
      } finally {
        setIsToggling(false);
      }
    });
  };

  if (isEditing && canUpdate) {
    return (
      <tr className="border-b border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
        <td colSpan={9} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500 dark:text-red-300">{error}</p>}
          <SupplierFormRow
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            defaultValues={{
              name: supplier.name,
              contactName: supplier.contactName ?? "",
              phone: supplier.phone ?? "",
              address: supplier.address ?? "",
              taxId: supplier.taxId ?? "",
              creditTerm: supplier.creditTerm != null ? String(supplier.creditTerm) : "",
            }}
            submitLabel="บันทึกการแก้ไข"
            isPending={isPending}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b border-gray-50 transition-colors ${
        getAdminMasterRowClass(supplier.isActive)
      }`}
    >
      <td className="px-4 py-3">
        {supplier.code ? (
          <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-medium text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-300">
            {supplier.code}
          </span>
        ) : (
          <span className="text-xs text-gray-400 dark:text-slate-500">-</span>
        )}
      </td>
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-100">{supplier.name}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{supplier.contactName ?? "-"}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{supplier.phone ?? "-"}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{supplier.taxId ?? "-"}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{supplier.creditTerm != null ? `${supplier.creditTerm} วัน` : "-"}</td>
      <td className="max-w-xs truncate px-4 py-3 text-gray-600 dark:text-slate-300">{supplier.address ?? "-"}</td>
      <td className="px-4 py-3">
        {supplier.isActive ? (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(supplier.isActive)}>ใช้งาน</AdminStatusBadge>
        ) : (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(supplier.isActive)}>ยกเลิก</AdminStatusBadge>
        )}
      </td>
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
          {canCancel && (
            <button
              onClick={handleToggle}
              disabled={isPending}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                supplier.isActive ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500" : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
              }`}
            >
              {isToggling ? "กำลังบันทึก..." : supplier.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
            </button>
          )}
        </AdminActionGroup>
      </td>
    </tr>
  );
};

const SuppliersClient = ({ suppliers, canCreate, canUpdate, canCancel }: SuppliersClientProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [createFormVersion, setCreateFormVersion] = useState(0);

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createSupplier(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        setCreateFormVersion((current) => current + 1);
      }
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <AdminSectionCard title="เพิ่มผู้จำหน่ายใหม่">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 dark:border-red-400/30 dark:bg-red-500/10">
              <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
            </div>
          )}
          <form key={createFormVersion} ref={formRef} action={handleCreate}>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  ชื่อผู้จำหน่าย <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="ชื่อบริษัท / ร้านค้า"
                  required
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">ชื่อผู้ติดต่อ</label>
                <input
                  type="text"
                  name="contactName"
                  placeholder="ชื่อผู้ติดต่อ"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="0xx-xxx-xxxx"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">ที่อยู่</label>
                <input
                  type="text"
                  name="address"
                  placeholder="ที่อยู่"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">เลขผู้เสียภาษี</label>
                <TaxIdInput
                  name="taxId"
                  placeholder="13 หลัก"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">เครดิตเทอม (วัน)</label>
                <input
                  type="number"
                  name="creditTerm"
                  min={0}
                  max={365}
                  placeholder="เช่น 30"
                  className={inputClassName}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
            >
              <Plus size={16} />
              {isPending ? "กำลังบันทึก..." : "เพิ่มผู้จำหน่าย"}
            </button>
          </form>
        </AdminSectionCard>
      )}

      <AdminTableSection title={`รายการผู้จำหน่าย (${suppliers.length} ราย)`}>
        {suppliers.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ยังไม่มีผู้จำหน่าย</p>
        ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="w-24 px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อผู้จำหน่าย</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อผู้ติดต่อ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เบอร์โทรศัพท์</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขผู้เสียภาษี</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เครดิตเทอม</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ที่อยู่</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <EditableRow
                    key={supplier.id}
                    supplier={supplier}
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

export default SuppliersClient;
