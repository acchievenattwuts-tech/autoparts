"use client";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

/**
 * ช่องกรอกภาษีเงินได้หัก ณ ที่จ่ายฝั่งที่ "เราถูกหัก"
 * ใช้ร่วมกันระหว่างฟอร์มใบเสร็จรับเงินและฟอร์มบันทึกการขาย (ขายสด)
 *
 * ค่าเริ่มต้นคือปิดอยู่ — เปิดเมื่อใบนั้นถูกลูกค้าหักจริงเท่านั้น
 * เมื่อปิด ผู้เรียกจะไม่ส่งฟิลด์ `wht` ไปที่ Server Action และเอกสารพิมพ์จะไม่มีบรรทัดนี้
 */

export interface WhtIncomeTypeOption {
  id: string;
  code: string;
  label: string;
  defaultRate: number;
}

export interface WhtReceivedFormValue {
  incomeTypeId: string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  certNo: string;
  certDate: string;
}

interface Props {
  incomeTypes: WhtIncomeTypeOption[];
  value: WhtReceivedFormValue | null;
  onChange: (value: WhtReceivedFormValue | null) => void;
  /** ยอดเอกสารที่ใช้เป็นฐานภาษีเริ่มต้น */
  documentTotal: number;
  disabled?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-slate-200";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateWhtTaxAmount = (baseAmount: number, rate: number) =>
  round2((baseAmount * rate) / 100);

const WhtReceivedFields = ({ incomeTypes, value, onChange, documentTotal, disabled }: Props) => {
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
      taxAmount: calculateWhtTaxAmount(base, rate),
      certNo: "",
      certDate: "",
    });
  };

  const patch = (next: Partial<WhtReceivedFormValue>) => {
    if (!value) return;
    onChange({ ...value, ...next });
  };

  const changeIncomeType = (incomeTypeId: string) => {
    if (!value) return;
    const selected = incomeTypes.find((type) => type.id === incomeTypeId);
    const rate = selected?.defaultRate ?? value.rate;
    onChange({
      ...value,
      incomeTypeId,
      rate,
      taxAmount: calculateWhtTaxAmount(value.baseAmount, rate),
    });
  };

  const changeBaseAmount = (baseAmount: number) => {
    if (!value) return;
    onChange({ ...value, baseAmount, taxAmount: calculateWhtTaxAmount(baseAmount, value.rate) });
  };

  const changeRate = (rate: number) => {
    if (!value) return;
    onChange({ ...value, rate, taxAmount: calculateWhtTaxAmount(value.baseAmount, rate) });
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
            ลูกค้าหักภาษี ณ ที่จ่าย
          </span>
          <span className="block text-xs text-gray-400 dark:text-slate-500">
            ยอดหนี้ยังปิดเต็มจำนวน แต่เงินที่รับจริงจะลดลงตามยอดภาษีที่ถูกหัก
          </span>
        </span>
      </label>

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
            <label className={labelClass}>ยอดภาษีที่ถูกหัก (บาท) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.taxAmount}
              disabled={disabled}
              onChange={(event) => patch({ taxAmount: Math.max(0, Number(event.target.value) || 0) })}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              แก้ได้ถ้าหนังสือรับรองที่ลูกค้าออกมาปัดเศษไม่ตรงกับที่ระบบคำนวณ
            </p>
          </div>
          <div>
            <label className={labelClass}>เลขที่หนังสือรับรอง 50 ทวิ</label>
            <input
              type="text"
              maxLength={50}
              value={value.certNo}
              disabled={disabled}
              onChange={(event) => patch({ certNo: event.target.value })}
              className={inputClass}
              placeholder="เว้นว่างได้ถ้ายังไม่ได้รับใบ"
            />
          </div>
          <div>
            <label className={labelClass}>วันที่ในหนังสือรับรอง</label>
            <input
              type="date"
              value={value.certDate}
              disabled={disabled}
              onChange={(event) => patch({ certDate: event.target.value })}
              className={inputClass}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WhtReceivedFields;
