"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { saveWhtPayeeProfile } from "./actions";

export interface WhtPayeeProfileValue {
  payeeType: "INDIVIDUAL" | "JURISTIC";
  taxId13: string;
  taxId10: string;
  titleName: string;
  firstName: string;
  lastName: string;
  branchNo: string;
  addrNo: string;
  addrRoad: string;
  addrSubdistrict: string;
  addrDistrict: string;
  addrProvince: string;
  addrPostcode: string;
  isActive: boolean;
}

interface Props {
  supplierId: string;
  supplierName: string;
  supplierTaxId: string | null;
  profile: WhtPayeeProfileValue | null;
  canEdit: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";

const emptyProfile = (supplierName: string, supplierTaxId: string | null): WhtPayeeProfileValue => ({
  payeeType: "JURISTIC",
  taxId13: supplierTaxId ?? "",
  taxId10: "",
  titleName: "",
  firstName: supplierName,
  lastName: "",
  branchNo: "000000",
  addrNo: "",
  addrRoad: "",
  addrSubdistrict: "",
  addrDistrict: "",
  addrProvince: "",
  addrPostcode: "",
  isActive: true,
});

/** ฟอร์มข้อมูลภาษีของผู้ถูกหัก — ใช้พิมพ์ 50 ทวิ และสร้างไฟล์นำส่งกรมสรรพากร */
const WhtPayeeEditor = ({ supplierId, supplierName, supplierTaxId, profile, canEdit }: Props) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WhtPayeeProfileValue>(
    profile ?? emptyProfile(supplierName, supplierTaxId),
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const patch = (next: Partial<WhtPayeeProfileValue>) => setForm((prev) => ({ ...prev, ...next }));

  const submit = () => {
    setError("");
    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("payeeType", form.payeeType);
    formData.set("taxId13", form.taxId13);
    formData.set("taxId10", form.taxId10);
    formData.set("titleName", form.titleName);
    formData.set("firstName", form.firstName);
    formData.set("lastName", form.lastName);
    formData.set("branchNo", form.branchNo);
    formData.set("addrNo", form.addrNo);
    formData.set("addrRoad", form.addrRoad);
    formData.set("addrSubdistrict", form.addrSubdistrict);
    formData.set("addrDistrict", form.addrDistrict);
    formData.set("addrProvince", form.addrProvince);
    formData.set("addrPostcode", form.addrPostcode);
    formData.set("isActive", form.isActive ? "true" : "false");

    startTransition(async () => {
      const result = await saveWhtPayeeProfile(formData);
      if (result.success) {
        setOpen(false);
        return;
      }
      setError(result.error ?? "บันทึกไม่สำเร็จ");
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
      >
        {profile ? <Pencil size={12} /> : <Plus size={12} />}
        {profile ? "แก้ไขข้อมูลภาษี" : "เพิ่มข้อมูลภาษี"}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-kanit text-sm font-semibold text-slate-800 dark:text-slate-100">
          ข้อมูลภาษี — {supplierName}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelClass}>ประเภทผู้ถูกหัก *</label>
          <select
            value={form.payeeType}
            disabled={isPending}
            onChange={(event) => patch({ payeeType: event.target.value as "INDIVIDUAL" | "JURISTIC" })}
            className={inputClass}
          >
            <option value="JURISTIC">นิติบุคคล (ยื่น ภ.ง.ด.53)</option>
            <option value="INDIVIDUAL">บุคคลธรรมดา (ยื่น ภ.ง.ด.3)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>เลขประจำตัวผู้เสียภาษี 13 หลัก *</label>
          <input
            value={form.taxId13}
            inputMode="numeric"
            maxLength={13}
            disabled={isPending}
            onChange={(event) => patch({ taxId13: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ลำดับที่สาขา</label>
          <input
            value={form.branchNo}
            inputMode="numeric"
            maxLength={6}
            disabled={isPending}
            onChange={(event) => patch({ branchNo: event.target.value })}
            placeholder="สำนักงานใหญ่ = 000000"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>คำนำหน้าชื่อ</label>
          <input
            value={form.titleName}
            maxLength={20}
            disabled={isPending}
            onChange={(event) => patch({ titleName: event.target.value })}
            placeholder={form.payeeType === "INDIVIDUAL" ? "นาย / นาง / นางสาว" : "บริษัท / ห้างหุ้นส่วน"}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            {form.payeeType === "INDIVIDUAL" ? "ชื่อ *" : "ชื่อผู้ถูกหักภาษี *"}
          </label>
          <input
            value={form.firstName}
            maxLength={200}
            disabled={isPending}
            onChange={(event) => patch({ firstName: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>นามสกุล</label>
          <input
            value={form.lastName}
            maxLength={200}
            disabled={isPending}
            onChange={(event) => patch({ lastName: event.target.value })}
            placeholder={form.payeeType === "JURISTIC" ? "นิติบุคคลไม่ต้องระบุ" : ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>บ้านเลขที่ / อาคาร</label>
          <input value={form.addrNo} maxLength={100} disabled={isPending} onChange={(event) => patch({ addrNo: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>ถนน</label>
          <input value={form.addrRoad} maxLength={100} disabled={isPending} onChange={(event) => patch({ addrRoad: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>ตำบล / แขวง</label>
          <input value={form.addrSubdistrict} maxLength={100} disabled={isPending} onChange={(event) => patch({ addrSubdistrict: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>อำเภอ / เขต</label>
          <input value={form.addrDistrict} maxLength={100} disabled={isPending} onChange={(event) => patch({ addrDistrict: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>จังหวัด</label>
          <input value={form.addrProvince} maxLength={100} disabled={isPending} onChange={(event) => patch({ addrProvince: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>รหัสไปรษณีย์</label>
          <input value={form.addrPostcode} inputMode="numeric" maxLength={5} disabled={isPending} onChange={(event) => patch({ addrPostcode: event.target.value })} className={inputClass} />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึกข้อมูลภาษี"}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={isPending}
            onChange={(event) => patch({ isActive: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f] dark:border-white/20"
          />
          ใช้งานอยู่
        </label>
      </div>
    </div>
  );
};

export default WhtPayeeEditor;
