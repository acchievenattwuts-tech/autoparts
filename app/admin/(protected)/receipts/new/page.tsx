export const dynamic = "force-dynamic";

import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ReceiptForm from "./ReceiptForm";
import { getReceiptCustomerOptions } from "../customer-options";

const NewReceiptPage = async () => {
  await requirePermission("receipts.create");

  const [customers, cashBankAccounts] = await Promise.all([
    getReceiptCustomerOptions(),
    getActiveCashBankAccountOptions(),
  ]);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/receipts"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> ใบเสร็จรับเงิน
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้างใบเสร็จใหม่</span>
      </div>

      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบเสร็จรับเงิน</h1>

      <ReceiptForm customers={customers} cashBankAccounts={cashBankAccounts} />
    </div>
  );
};

export default NewReceiptPage;
