"use client";

import { useState } from "react";
import Link from "next/link";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { paymentSlipStatusLabel } from "@/lib/line-payment-slip-display";

type PaymentSlipGalleryFilterBarProps = {
  banks: string[];
  current: {
    from: string;
    to: string;
    status: string;
    bank: string;
    sender: string;
    reference: string;
    amount: string;
  };
};

const statusOptions = Object.values(PaymentSlipVerificationStatus);

const inputClass =
  "h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

const PaymentSlipGalleryFilterBar = ({ banks, current }: PaymentSlipGalleryFilterBarProps) => {
  const [bank, setBank] = useState(current.bank);

  const bankOptions: SelectOption[] = banks.map((name) => ({ id: name, label: name }));

  return (
    <AdminSearchForm
      action="/admin/line-payment-slips/gallery"
      className="flex flex-wrap items-end gap-2 space-y-0"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        จากวันที่
        <input type="date" name="from" defaultValue={current.from} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        ถึงวันที่
        <input type="date" name="to" defaultValue={current.to} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        สถานะ
        <select name="status" defaultValue={current.status} className={inputClass}>
          <option value="">ทั้งหมด</option>
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {paymentSlipStatusLabel[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        ธนาคาร
        <div className="w-44">
          <SearchableSelect
            options={bankOptions}
            value={bank}
            onChange={setBank}
            placeholder="ทุกธนาคาร"
          />
        </div>
        <input type="hidden" name="bank" value={bank} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        ผู้โอน
        <input
          type="text"
          name="sender"
          defaultValue={current.sender}
          placeholder="ชื่อผู้โอน"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        เลขอ้างอิง
        <input
          type="text"
          name="reference"
          defaultValue={current.reference}
          placeholder="เลขอ้างอิงในสลิป"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
        จำนวนเงิน
        <input
          type="number"
          name="amount"
          defaultValue={current.amount}
          placeholder="ยอดเป๊ะ"
          step="0.01"
          min="0"
          className={`${inputClass} w-28`}
        />
      </label>
      <AdminSearchSubmitButton className="h-10 rounded-md">กรอง</AdminSearchSubmitButton>
      <Link
        href="/admin/line-payment-slips/gallery"
        className="inline-flex h-10 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
      >
        ล้าง
      </Link>
    </AdminSearchForm>
  );
};

export default PaymentSlipGalleryFilterBar;
