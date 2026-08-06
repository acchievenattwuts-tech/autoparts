export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: must match createSale tx timeout (180s) + response time

import { getSiteConfig } from "@/lib/site-config";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import SaleForm from "./SaleForm";
import { getTransactionCustomers, getTransactionSuppliers } from "@/lib/transaction-options";

const NewSalePage = async () => {
  await requirePermission("sales.create");
  const { role, permissions } = await getSessionPermissionContext();
  const canPrint = hasPermissionAccess(role, permissions, "sales.view");

  const [customers, config, suppliers, cashBankAccounts] = await Promise.all([
    getTransactionCustomers(),
    getSiteConfig(),
    getTransactionSuppliers(),
    getActiveCashBankAccountOptions(),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/sales"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการขายทั้งหมด
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">บันทึกการขายใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">บันทึกการขายสินค้า</h1>
      <SaleForm
        products={[]}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        customers={customers.map((c) => ({ ...c, priceTier: c.customerType?.priceTier ?? "RETAIL" }))}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        canPrint={canPrint}
      />
    </div>
  );
};

export default NewSalePage;
