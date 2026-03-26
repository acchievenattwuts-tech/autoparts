"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpense } from "../actions";

const CATEGORY_LABELS: Record<string, string> = {
  RENT:        "ค่าเช่า",
  UTILITIES:   "ค่าสาธารณูปโภค",
  SALARY:      "เงินเดือน/ค่าจ้าง",
  TRANSPORT:   "ค่าขนส่ง",
  MARKETING:   "ค่าการตลาด",
  MAINTENANCE: "ค่าซ่อมบำรุง",
  OTHER:       "อื่นๆ",
};

const VAT_TYPES = [
  { value: "NO_VAT",        label: "ไม่มีภาษี" },
  { value: "EXCLUDING_VAT", label: "ราคาไม่รวม VAT" },
  { value: "INCLUDING_VAT", label: "ราคารวม VAT" },
];

interface Props {
  defaultVatType: string;
  defaultVatRate: number;
}

const NewExpenseForm = ({ defaultVatType, defaultVatRate }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vatType, setVatType] = useState(defaultVatType);
  const [vatRate, setVatRate] = useState(defaultVatRate);
  const [amount, setAmount] = useState(0);

  const showVat = vatType !== "NO_VAT" && vatRate > 0;
  const vatAmt  = vatType === "EXCLUDING_VAT"
    ? amount * vatRate / 100
    : vatType === "INCLUDING_VAT"
    ? amount * vatRate / (100 + vatRate)
    : 0;
  const netAmt  = vatType === "EXCLUDING_VAT" ? amount + vatAmt : amount;
  const subAmt  = vatType === "INCLUDING_VAT"  ? amount - vatAmt : amount;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createExpense(fd);
      if (res.error) { setError(res.error); return; }
      router.push("/admin/expenses");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            วันที่ <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="expenseDate"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ประเภทค่าใช้จ่าย <span className="text-red-500">*</span>
          </label>
          <select
            name="category"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
          >
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          รายละเอียด <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="description"
          placeholder="ระบุรายละเอียดค่าใช้จ่าย"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
        />
      </div>

      {/* Amount + VAT */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            จำนวนเงิน (บาท) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            name="amount"
            min="0.01"
            step="0.01"
            required
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท VAT</label>
          <select
            name="vatType"
            value={vatType}
            onChange={(e) => setVatType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
          >
            {VAT_TYPES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">อัตรา VAT (%)</label>
          <input
            type="number"
            name="vatRate"
            min="0"
            max="100"
            step="0.01"
            value={vatRate}
            onChange={(e) => setVatRate(Number(e.target.value))}
            disabled={vatType === "NO_VAT"}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
      </div>

      {/* VAT Summary */}
      {showVat && amount > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>ยอดก่อนภาษี</span>
            <span>{subAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>VAT {vatRate}%</span>
            <span>{vatAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-900 border-t border-blue-200 pt-1">
            <span>ยอดสุทธิ</span>
            <span>{netAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</span>
          </div>
        </div>
      )}

      {/* Note */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
        <textarea
          name="note"
          rows={2}
          placeholder="หมายเหตุ (ถ้ามี)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2 bg-[#1e3a5f] hover:bg-[#163055] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึกค่าใช้จ่าย"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/expenses")}
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
};

export default NewExpenseForm;
