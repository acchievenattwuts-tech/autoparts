export const dynamic = "force-dynamic";
export const maxDuration = 200;

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionCustomers, getTransactionSuppliers } from "@/lib/transaction-options";
import SaleForm from "../../new/SaleForm";
import ManualShopeeSetupForm from "../ManualShopeeSetupForm";

export default async function NewShopeeSalePage() {
  await requirePermission("sales.create");
  await requirePermission("marketplace.manage");
  const [shop, customers, config, suppliers, accounts] = await Promise.all([
    db.shopeeShop.findFirst({ where: { manualMode: true }, orderBy: { createdAt: "asc" } }),
    getTransactionCustomers(),
    getSiteConfig(),
    getTransactionSuppliers(),
    getActiveCashBankAccountOptions(),
  ]);
  const ready = Boolean(shop?.settlementCashBankAccountId && shop.defaultCustomerId);

  return <div className="space-y-6">
    <Link href="/admin/sales?channel=SHOPEE" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-orange-600 dark:text-slate-400"><ChevronLeft size={16}/> รายการขาย Shopee</Link>
    <div><h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">บันทึกขาย Shopee</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">ใช้เมื่อออเดอร์ขึ้นสถานะพร้อมจัดส่งและ Seller SKU ตรงกับรหัสสินค้าในระบบ</p></div>
    {!ready ? <ManualShopeeSetupForm
      accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} — ${account.name}` }))}
      customers={customers.map((customer) => ({ id: customer.id, label: `${customer.code ? `${customer.code} — ` : ""}${customer.name}` }))}
      initialAccountId={shop?.settlementCashBankAccountId ?? ""}
      initialCustomerId={shop?.defaultCustomerId ?? ""}
    /> : <SaleForm
      products={[]}
      suppliers={suppliers}
      cashBankAccounts={accounts}
      customers={customers.map((customer) => ({ ...customer, priceTier: customer.customerType?.priceTier ?? "RETAIL" }))}
      defaultVatType={config.vatType}
      defaultVatRate={config.vatRate}
      channel="SHOPEE"
      defaultCustomerId={shop!.defaultCustomerId!}
      defaultCashBankAccountId={shop!.settlementCashBankAccountId!}
    />}
  </div>;
}
