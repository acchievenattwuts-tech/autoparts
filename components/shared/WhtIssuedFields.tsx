"use client";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { WhtIncomeTypeOption } from "@/components/shared/WhtReceivedFields";

/**
 * ช่องกรอกภาษีหัก ณ ที่จ่ายฝั่งที่ "เราหักผู้รับเงิน" แล้วออกหนังสือรับรอง 50 ทวิ
 * ไม่มีช่องเลขที่หนังสือรับรอง เพราะระบบออกให้จากเลขที่เอกสารต้นทางอัตโนมัติ
 */

export type WhtPayConditionValue = "WITHHELD" | "PAID_ALWAYS" | "PAID_ONCE";

export interface WhtIssuedFormValue {
  incomeTypeId: string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  payCondition: WhtPayConditionValue;
}

interface Props {
  incomeTypes: WhtIncomeTypeOption[];
  value: WhtIssuedFormValue | null;
  onChange: (value: WhtIssuedFormValue | null) => void;
  /** ยอดเอกสารที่ใช้เป็นฐานภาษีเริ่มต้น */
  documentTotal: number;
  /** ผู้รับเงินยังไม่มีข้อมูลภาษี — ออกหนังสือรับรองไม่ได้จนกว่าจะกรอก */
  payeeMissingTaxProfile?: boolean;
  disabled?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-slate-200";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const calculateTax = (baseAmount: number, rate: number) => round2((baseAmount * rate) / 100);

const WhtIssuedFields = ({
  incomeTypes,
  value,
  onChange,
  documentTotal,
  payeeMissingTaxProfile = false,
  disabled,
}: Props) => {
  const enabled = value !== null;

  const options: SelectOption[] = incomeTypes.map((type) => ({
    id: type.id,
    label: type.label,
    sublabel: `อัตรา ${type.defaultRate.toLocaleString("th-TH", { minimumFractionDigits: 2 })}%`,
  }));

  const toggle = (next: boolean) => {
    if (!next) {
      onChange(null);
      return;
    }
    const firstType = incomeTypes[0];
    const base = round2(Math.max(0, documentTotal));
    const rate = firstType?.defaultRate ?? 0;
    onChange({
      incomeTypeId: firstType?.id ?? "",
      baseAmount: base,
      rate,
      taxAmount: calculateTax(base, rate),
      payCondition: "WITHHELD",
    });
  };

  const patch = (next: Partial<WhtIssuedFormValue>) => {
    if (!value) return;
    onChange({ ...value, ...next });
  };

  const changeIncomeType = (incomeTypeId: string) => {
    if (!value) return;
    const selected = incomeTypes.find((type) => type.id === incomeTypeId);
    const rate = selected?.defaultRate ?? value.rate;
    onChange({ ...value, incomeTypeId, rate, taxAmount: calculateTax(value.baseAmount, rate) });
  };

  const changeBaseAmount = (baseAmount: number) => {
    if (!value) return;
    onChange({ ...value, baseAmount, taxAmount: calculateTax(baseAmount, value.rate) });
  };

  const changeRate = (rate: number) => {
    if (!value) return;
    onChange({ ...value, rate, taxAmount: calculateTax(value.baseAmount, rate) });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/5">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f] dark:border-white/20"
        />
        <span>
          <span className="block font-kanit font-semibold text-gray-800 dark:text-slate-100">
            หักภาษี ณ ที่จ่ายผู้รับเงิน
          </span>
          <span className="block text-xs text-gray-400 dark:text-slate-500">
            ยอดค่าใช้จ่ายยังเต็มจำนวน แต่เงินที่จ่ายออกจริงจะลดลง และระบบจะออกหนังสือรับรอง 50 ทวิ ให้อัตโนมัติ
          </span>
        </span>
      </label>

      {enabled && payeeMissingTaxProfile && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300">
          ผู้รับเงินรายนี้ยังไม่มีข้อมูลภาษี — กรอกที่เมนู &ldquo;ข้อมูลภาษีผู้ถูกหัก&rdquo; ก่อน จึงจะบันทึกได้
        </p>
      )}

      {enabled && value && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelClass}>ประเภทเงินได้ *</label>
            <SearchableSelect
              options={options}
              value={value.incomeTypeId}
              onChange={changeIncomeType}
              disabled={disabled}
              placeholder="เลือกประเภทเงินได้"
            />
          </div>
          <div>
            <label className={labelClass}>ฐานภาษี (บาท)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.baseAmount}
              disabled={disabled}
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
              value={value.rate}
              disabled={disabled}
              onChange={(event) => changeRate(Math.max(0, Number(event.target.value) || 0))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>ยอดภาษีที่หักไว้ (บาท) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.taxAmount}
              disabled={disabled}
              onChange={(event) => patch({ taxAmount: Math.max(0, Number(event.target.value) || 0) })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>เงื่อนไขการหักภาษี *</label>
            <select
              value={value.payCondition}
              disabled={disabled}
              onChange={(event) => patch({ payCondition: event.target.value as WhtPayConditionValue })}
              className={inputClass}
            >
              <option value="WITHHELD">หัก ณ ที่จ่าย</option>
              <option value="PAID_ONCE">ออกให้ครั้งเดียว</option>
              <option value="PAID_ALWAYS">ออกให้ตลอดไป</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhtIssuedFields;
