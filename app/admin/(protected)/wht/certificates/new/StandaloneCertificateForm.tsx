"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { WhtIncomeTypeOption } from "@/components/shared/WhtReceivedFields";
import type { WhtPayConditionValue } from "@/components/shared/WhtIssuedFields";
import { getThailandDateKey } from "@/lib/th-date";
import { createStandaloneCertificate } from "../actions";

export interface StandalonePayeeOption {
  id: string;
  code: string | null;
  name: string;
}

interface Props {
  payees: StandalonePayeeOption[];
  incomeTypes: WhtIncomeTypeOption[];
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-slate-200";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** ออกหนังสือรับรอง 50 ทวิ แบบเดี่ยว สำหรับการจ่ายเงินที่ไม่ได้คีย์เป็นเอกสารในระบบ */
const StandaloneCertificateForm = ({ payees, incomeTypes }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [payDate, setPayDate] = useState(getThailandDateKey());
  const [incomeTypeId, setIncomeTypeId] = useState(incomeTypes[0]?.id ?? "");
  const [baseAmount, setBaseAmount] = useState(0);
  const [rate, setRate] = useState(incomeTypes[0]?.defaultRate ?? 0);
  const [taxAmount, setTaxAmount] = useState(0);
  const [payCondition, setPayCondition] = useState<WhtPayConditionValue>("WITHHELD");
  const [note, setNote] = useState("");

  const changeIncomeType = (nextId: string) => {
    setIncomeTypeId(nextId);
    const selected = incomeTypes.find((type) => type.id === nextId);
    const nextRate = selected?.defaultRate ?? rate;
    setRate(nextRate);
    setTaxAmount(round2((baseAmount * nextRate) / 100));
  };

  const changeBaseAmount = (value: number) => {
    setBaseAmount(value);
    setTaxAmount(round2((value * rate) / 100));
  };

  const changeRate = (value: number) => {
    setRate(value);
    setTaxAmount(round2((baseAmount * value) / 100));
  };

  const submit = () => {
    setError("");
    setSuccess("");

    if (!supplierId) { setError("กรุณาเลือกผู้ถูกหักภาษี"); return; }
    if (!incomeTypeId) { setError("กรุณาเลือกประเภทเงินได้"); return; }
    if (baseAmount <= 0) { setError("จำนวนเงินที่จ่ายต้องมากกว่า 0"); return; }
    if (taxAmount <= 0) { setError("ยอดภาษีที่หักต้องมากกว่า 0"); return; }
    if (taxAmount > baseAmount + 0.005) { setError("ยอดภาษีที่หักมากกว่าจำนวนเงินที่จ่าย"); return; }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("payDate", payDate);
    formData.set("incomeTypeId", incomeTypeId);
    formData.set("baseAmount", String(baseAmount));
    formData.set("rate", String(rate));
    formData.set("taxAmount", String(taxAmount));
    formData.set("payCondition", payCondition);
    formData.set("note", note);

    startTransition(async () => {
      const result = await createStandaloneCertificate(formData);
      if (result.success && result.certificateId) {
        setSuccess(`ออกหนังสือรับรองเลขที่ ${result.certNo} สำเร็จ`);
        router.push(`/admin/wht/certificates/${result.certificateId}`);
        return;
      }
      setError(result.error ?? "บันทึกไม่สำเร็จ");
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-400/30 dark:bg-green-500/10 dark:text-green-400">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>ผู้ถูกหักภาษี *</label>
          <SearchableSelect
            options={payees.map((payee): SelectOption => ({
              id: payee.id,
              label: payee.name,
              sublabel: payee.code ?? undefined,
            }))}
            value={supplierId}
            onChange={setSupplierId}
            placeholder="เลือกผู้ถูกหักภาษี"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            แสดงเฉพาะรายที่กรอกข้อมูลภาษีไว้แล้ว
          </p>
        </div>
        <div>
          <label className={labelClass}>วันที่จ่ายเงิน *</label>
          <input
            type="date"
            value={payDate}
            disabled={isPending}
            onChange={(event) => setPayDate(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>ประเภทเงินได้ *</label>
          <SearchableSelect
            options={incomeTypes.map((type): SelectOption => ({
              id: type.id,
              label: type.label,
              sublabel: `อัตรา ${type.defaultRate.toLocaleString("th-TH", { minimumFractionDigits: 2 })}%`,
            }))}
            value={incomeTypeId}
            onChange={changeIncomeType}
            placeholder="เลือกประเภทเงินได้"
          />
        </div>
        <div>
          <label className={labelClass}>จำนวนเงินที่จ่าย (บาท) *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={baseAmount}
            disabled={isPending}
            onChange={(event) => changeBaseAmount(Math.max(0, Number(event.target.value) || 0))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>อัตราภาษี (%)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            disabled={isPending}
            onChange={(event) => changeRate(Math.max(0, Number(event.target.value) || 0))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ภาษีที่หักและนำส่ง (บาท) *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={taxAmount}
            disabled={isPending}
            onChange={(event) => setTaxAmount(Math.max(0, Number(event.target.value) || 0))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>เงื่อนไขการหักภาษี *</label>
          <select
            value={payCondition}
            disabled={isPending}
            onChange={(event) => setPayCondition(event.target.value as WhtPayConditionValue)}
            className={inputClass}
          >
            <option value="WITHHELD">หัก ณ ที่จ่าย</option>
            <option value="PAID_ONCE">ออกให้ครั้งเดียว</option>
            <option value="PAID_ALWAYS">ออกให้ตลอดไป</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            type="text"
            maxLength={500}
            value={note}
            disabled={isPending}
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น จ่ายค่าจ้างทำของหน้างาน ไม่ได้คีย์ใบค่าใช้จ่าย"
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
      >
        {isPending ? "กำลังบันทึก..." : "ออกหนังสือรับรอง"}
      </button>
    </div>
  );
};

export default StandaloneCertificateForm;
