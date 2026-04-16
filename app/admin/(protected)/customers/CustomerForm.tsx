"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import TaxIdInput from "@/components/shared/TaxIdInput";
import { createCustomer, updateCustomer } from "./actions";

interface CustomerFormProps {
  customer?: {
    id: string;
    code: string | null;
    name: string;
    phone: string | null;
    address: string | null;
    shippingAddress: string | null;
    taxId: string | null;
    note: string | null;
    creditTerm: number | null;
  };
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const CustomerForm = ({ customer }: CustomerFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isEdit = Boolean(customer);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = isEdit
        ? await updateCustomer(customer!.id, formData)
        : await createCustomer(formData);

      if (result.error) {
        setError(result.error);
      } else if (isEdit) {
        setSuccess("บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว");
      } else {
        router.push("/admin/customers");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลลูกค้า
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {customer?.code && (
            <div>
              <label className={labelCls}>รหัสลูกค้า</label>
              <div className="inline-flex items-center px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-[#1e3a5f] font-medium">
                {customer.code}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>
              ชื่อลูกค้า <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              maxLength={100}
              defaultValue={customer?.name ?? ""}
              className={inputCls}
              placeholder="ชื่อ-นามสกุล หรือชื่อบริษัท"
            />
          </div>

          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input
              type="tel"
              name="phone"
              maxLength={20}
              defaultValue={customer?.phone ?? ""}
              className={inputCls}
              placeholder="0xx-xxx-xxxx"
            />
          </div>

          <div>
            <label className={labelCls}>เครดิต (วัน)</label>
            <input
              type="number"
              name="creditTerm"
              min={0}
              max={365}
              defaultValue={customer?.creditTerm ?? 0}
              onBlur={(e) => {
                if (e.target.value.trim() === "") {
                  e.target.value = "0";
                }
              }}
              className={inputCls}
              placeholder="0 = เงินสด"
            />
            <p className="mt-1 text-xs text-gray-400">
              จำนวนวันเครดิตสำหรับลูกค้า (ว่างไว้ = ไม่กำหนด)
            </p>
          </div>

          <div>
            <label className={labelCls}>เลขผู้เสียภาษี</label>
            <TaxIdInput
              name="taxId"
              defaultValue={customer?.taxId ?? ""}
              className={inputCls}
              placeholder="13 หลัก"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ที่อยู่</label>
            <textarea
              name="address"
              rows={3}
              maxLength={300}
              defaultValue={customer?.address ?? ""}
              className={inputCls}
              placeholder="ที่อยู่สำหรับออกเอกสาร"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ที่อยู่จัดส่ง</label>
            <textarea
              name="shippingAddress"
              rows={3}
              maxLength={500}
              defaultValue={customer?.shippingAddress ?? ""}
              className={inputCls}
              placeholder="ที่อยู่จัดส่งสินค้า (ถ้าต่างจากที่อยู่ปกติ)"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <textarea
              name="note"
              rows={2}
              maxLength={500}
              defaultValue={customer?.note ?? ""}
              className={inputCls}
              placeholder="หมายเหตุเพิ่มเติม"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              กำลังบันทึก...
            </span>
          ) : isEdit ? (
            "บันทึกการแก้ไข"
          ) : (
            "เพิ่มลูกค้า"
          )}
        </button>
      </div>
    </form>
  );
};

export default CustomerForm;
