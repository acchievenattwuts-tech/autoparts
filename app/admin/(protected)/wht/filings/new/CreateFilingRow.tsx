"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFiling } from "../actions";

interface Props {
  formType: "PND3" | "PND53";
  taxMonth: number;
  taxYear: number;
  disabled?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20";

/** ปุ่มสร้างรอบยื่นของแต่ละกลุ่มเดือนภาษี พร้อมตัวเลือกยื่นปกติ/ยื่นเพิ่มเติมและเงินเพิ่ม */
const CreateFilingRow = ({ formType, taxMonth, taxYear, disabled }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [submissionType, setSubmissionType] = useState<"NORMAL" | "ADDITIONAL">("NORMAL");
  const [additionalSeq, setAdditionalSeq] = useState(1);
  const [surchargeAmount, setSurchargeAmount] = useState(0);

  const submit = () => {
    setError("");
    const formData = new FormData();
    formData.set("formType", formType);
    formData.set("taxMonth", String(taxMonth));
    formData.set("taxYear", String(taxYear));
    formData.set("submissionType", submissionType);
    formData.set("additionalSeq", String(submissionType === "ADDITIONAL" ? additionalSeq : 0));
    formData.set("surchargeAmount", String(surchargeAmount));

    startTransition(async () => {
      const result = await createFiling(formData);
      if (result.success && result.filingId) {
        router.push(`/admin/wht/filings/${result.filingId}`);
        return;
      }
      setError(result.error ?? "สร้างรอบยื่นไม่สำเร็จ");
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={submissionType}
          disabled={disabled || isPending}
          onChange={(event) => setSubmissionType(event.target.value as "NORMAL" | "ADDITIONAL")}
          className={`${inputClass} w-32`}
        >
          <option value="NORMAL">ยื่นปกติ</option>
          <option value="ADDITIONAL">ยื่นเพิ่มเติม</option>
        </select>
        {submissionType === "ADDITIONAL" && (
          <input
            type="number"
            min={1}
            max={99}
            value={additionalSeq}
            disabled={disabled || isPending}
            onChange={(event) => setAdditionalSeq(Math.max(1, Number(event.target.value) || 1))}
            className={`${inputClass} w-20`}
            title="ครั้งที่"
          />
        )}
        <input
          type="number"
          step="0.01"
          min={0}
          value={surchargeAmount}
          disabled={disabled || isPending}
          onChange={(event) => setSurchargeAmount(Math.max(0, Number(event.target.value) || 0))}
          className={`${inputClass} w-24`}
          title="เงินเพิ่ม (ถ้ามี)"
          placeholder="เงินเพิ่ม"
        />
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={submit}
          className="whitespace-nowrap rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
        >
          {isPending ? "กำลังสร้าง..." : "สร้างรอบยื่น"}
        </button>
      </div>
      {error && <p className="text-right text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
};

export default CreateFilingRow;
