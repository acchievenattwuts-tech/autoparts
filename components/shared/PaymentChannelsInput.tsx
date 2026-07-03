"use client";

import { Plus, Trash2 } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

export interface PaymentChannelRow {
  cashBankAccountId: string;
  amount: number;
}

export interface PaymentChannelAccount {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Reusable split-payment editor: one or more rows of (account, amount) that
 * must sum to `targetAmount`. Controlled — the parent owns the rows state and
 * is responsible for serializing them into the form submission.
 */
const PaymentChannelsInput = ({
  accounts,
  value,
  onChange,
  targetAmount,
  label = "ช่องทางจ่ายเงิน",
  placeholder = "โปรดระบุบัญชี",
}: {
  accounts: PaymentChannelAccount[];
  value: PaymentChannelRow[];
  onChange: (rows: PaymentChannelRow[]) => void;
  targetAmount: number;
  label?: string;
  placeholder?: string;
}) => {
  const rows = value.length > 0 ? value : [{ cashBankAccountId: "", amount: 0 }];
  const paymentsTotal = round2(rows.reduce((sum, row) => sum + (row.amount || 0), 0));
  const remaining = round2(targetAmount - paymentsTotal);
  const balanced = Math.abs(remaining) <= 0.005;

  const updateAccount = (index: number, accountId: string) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, cashBankAccountId: accountId } : row)));
  };
  const updateAmount = (index: number, amount: number) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, amount: Math.max(0, amount) } : row)));
  };
  const fillRemaining = (index: number) => {
    onChange(
      rows.map((row, i) =>
        i === index ? { ...row, amount: round2(Math.max(0, (row.amount || 0) + remaining)) } : row,
      ),
    );
  };
  const addRow = () => {
    onChange([...rows, { cashBankAccountId: "", amount: round2(Math.max(0, remaining)) }]);
  };
  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">
          {label} <span className="text-red-500">*</span>
        </label>
        <span
          className={`text-xs font-medium ${
            balanced ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"
          }`}
        >
          คงเหลือที่ต้องระบุ {remaining.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <SearchableSelect
                options={accounts.map((account): SelectOption => ({
                  id: account.id,
                  label: account.name,
                  sublabel:
                    [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo]
                      .filter(Boolean)
                      .join(" | ") || undefined,
                }))}
                value={row.cashBankAccountId}
                onChange={(accountId) => updateAccount(index, accountId)}
                placeholder={placeholder}
              />
            </div>
            <div className="flex items-center gap-2">
              <AdminNumberInput
                min={0}
                step={0.01}
                value={row.amount}
                onValueChange={(amount) => updateAmount(index, amount)}
                className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => fillRemaining(index)}
                className="whitespace-nowrap rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
              >
                เติมยอดที่เหลือ
              </button>
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={rows.length <= 1}
                className="rounded-lg border border-gray-200 p-2 text-gray-400 transition-colors hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:text-slate-400 dark:hover:border-red-400/50 dark:hover:text-red-400"
                aria-label="ลบช่องทาง"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
      >
        <Plus size={14} /> เพิ่มช่องทาง
      </button>
    </div>
  );
};

export default PaymentChannelsInput;
