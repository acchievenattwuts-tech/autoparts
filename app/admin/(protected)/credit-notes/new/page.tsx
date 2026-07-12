export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: must match createCreditNote tx timeout (180s) + response time

import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import CreditNoteForm from "./CreditNoteForm";
import { getCreditNoteProductOptions, getTransactionCustomers } from "@/lib/transaction-options";

const NewCreditNotePage = async () => {
  await requirePermission("credit_notes.create");

  const [products, customers, config, cashBankAccounts] = await Promise.all([
    getCreditNoteProductOptions(),
    getTransactionCustomers(),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/credit-notes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการ Credit Note
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">สร้าง CN ใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">สร้างใบลดหนี้ (Credit Note)</h1>
      <CreditNoteForm
        products={products}
        customers={customers}
        cashBankAccounts={cashBankAccounts}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
      />
    </div>
  );
};

export default NewCreditNotePage;
