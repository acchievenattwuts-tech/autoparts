"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { createSupplier, updateSupplier, deleteSupplier } from "./actions";
import { Supplier } from "@/lib/generated/prisma";

interface SuppliersClientProps {
  suppliers: Supplier[];
}

interface SupplierFormFields {
  name: string;
  contactName: string;
  phone: string;
  address: string;
}

const emptyFields: SupplierFormFields = {
  name: "",
  contactName: "",
  phone: "",
  address: "",
};

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          ชื่อผู้จำหน่าย <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="name"
          defaultValue={defaultValues.name}
          placeholder="ชื่อบริษัท / ร้านค้า"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อผู้ติดต่อ</label>
        <input
          type="text"
          name="contactName"
          defaultValue={defaultValues.contactName}
          placeholder="ชื่อผู้ติดต่อ"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">เบอร์โทรศัพท์</label>
        <input
          type="tel"
          name="phone"
          defaultValue={defaultValues.phone}
          placeholder="0xx-xxx-xxxx"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">ที่อยู่</label>
        <input
          type="text"
          name="address"
          defaultValue={defaultValues.address}
          placeholder="ที่อยู่"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
      </div>
    </div>
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
      >
        <Check size={15} />
        {isPending ? "กำลังบันทึก..." : submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          <X size={15} />
          ยกเลิก
        </button>
      )}
    </div>
  </form>
);

const EditableRow = ({ supplier }: { supplier: Supplier }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");

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

  const handleDelete = () => {
    if (!confirm(`ต้องการลบผู้จำหน่าย "${supplier.name}" ใช่หรือไม่?`)) return;
    startTransition(async () => {
      await deleteSupplier(supplier.id);
    });
  };

  if (isEditing) {
    return (
      <tr className="border-b border-gray-100 bg-blue-50">
        <td colSpan={6} className="py-4 px-4">
          {error && (
            <p className="text-red-500 text-xs mb-2">{error}</p>
          )}
          <SupplierFormRow
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            defaultValues={{
              name: supplier.name,
              contactName: supplier.contactName ?? "",
              phone: supplier.phone ?? "",
              address: supplier.address ?? "",
            }}
            submitLabel="บันทึกการแก้ไข"
            isPending={isPending}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4">
        {supplier.code ? (
          <span className="font-mono text-xs font-medium text-[#1e3a5f] bg-blue-50 px-2 py-0.5 rounded">
            {supplier.code}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">-</span>
        )}
      </td>
      <td className="py-3 px-4 text-gray-800 font-medium">{supplier.name}</td>
      <td className="py-3 px-4 text-gray-600">{supplier.contactName ?? "-"}</td>
      <td className="py-3 px-4 text-gray-600">{supplier.phone ?? "-"}</td>
      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{supplier.address ?? "-"}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setIsEditing(true)}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] hover:bg-[#163055] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            <Pencil size={12} />
            แก้ไข
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            <Trash2 size={12} />
            ลบ
          </button>
        </div>
      </td>
    </tr>
  );
};

const SuppliersClient = ({ suppliers }: SuppliersClientProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createSupplier(formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Add Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">เพิ่มผู้จำหน่ายใหม่</h2>
        {error && (
          <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
        <form ref={formRef} action={handleCreate}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                ชื่อผู้จำหน่าย <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                placeholder="ชื่อบริษัท / ร้านค้า"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อผู้ติดต่อ</label>
              <input
                type="text"
                name="contactName"
                placeholder="ชื่อผู้ติดต่อ"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">เบอร์โทรศัพท์</label>
              <input
                type="tel"
                name="phone"
                placeholder="0xx-xxx-xxxx"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ที่อยู่</label>
              <input
                type="text"
                name="address"
                placeholder="ที่อยู่"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            <Plus size={16} />
            {isPending ? "กำลังบันทึก..." : "เพิ่มผู้จำหน่าย"}
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">
          รายการผู้จำหน่าย ({suppliers.length} ราย)
        </h2>
        {suppliers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">ยังไม่มีผู้จำหน่าย</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 font-medium text-gray-600 w-24">รหัส</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อผู้จำหน่าย</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อผู้ติดต่อ</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">เบอร์โทรศัพท์</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ที่อยู่</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <EditableRow key={supplier.id} supplier={supplier} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuppliersClient;
