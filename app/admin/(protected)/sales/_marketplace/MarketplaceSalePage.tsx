import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionCustomers, getTransactionSuppliers } from "@/lib/transaction-options";
import {
  getMarketplaceChannelConfig,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import { getMarketplaceChannelSetting } from "@/lib/marketplace/queries";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import SaleForm from "../new/SaleForm";
import MarketplaceSetupForm from "./MarketplaceSetupForm";

export default async function MarketplaceSalePage({
  channel,
}: {
  channel: ManualMarketplaceChannel;
}) {
  await requirePermission("sales.create");
  await requirePermission("marketplace.manage");
  const config = getMarketplaceChannelConfig(channel);

  const [setting, customers, siteConfig, suppliers, accounts] = await Promise.all([
    getMarketplaceChannelSetting(channel),
    getTransactionCustomers(),
    getSiteConfig(),
    getTransactionSuppliers(),
    getActiveCashBankAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/sales?channel=${channel}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400"
      >
        <ChevronLeft size={16} /> รายการขาย {config.label}
        <LinkPendingIndicator />
      </Link>
      <div>
        <h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">
          บันทึกขาย {config.label}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ใช้เมื่อคำสั่งซื้อขึ้นสถานะพร้อมจัดส่งและรหัสสินค้าตรงกับในระบบ — คีย์ยอดตามที่ลูกค้าจ่ายจริงทั้งใบ
          รวมค่าจัดส่งที่ลูกค้าจ่าย เพื่อให้ยอดตรงกับรายงานของแพลตฟอร์ม
        </p>
      </div>
      {!setting ? (
        <MarketplaceSetupForm
          channel={channel}
          channelLabel={config.label}
          holdingAccountLabel={config.holdingAccountLabel}
          accounts={accounts.map((account) => ({
            id: account.id,
            label: `${account.code} — ${account.name}`,
          }))}
          customers={customers.map((customer) => ({
            id: customer.id,
            label: `${customer.code ? `${customer.code} — ` : ""}${customer.name}`,
          }))}
        />
      ) : (
        <SaleForm
          products={[]}
          suppliers={suppliers}
          cashBankAccounts={accounts}
          customers={customers.map((customer) => ({
            ...customer,
            priceTier: customer.customerType?.priceTier ?? "RETAIL",
          }))}
          defaultVatType={siteConfig.vatType}
          defaultVatRate={siteConfig.vatRate}
          channel={channel}
          channelLabel={config.label}
          orderRefLabel={config.orderRefLabel}
          defaultCustomerId={setting.defaultCustomerId}
          defaultCashBankAccountId={setting.settlementCashBankAccountId}
        />
      )}
    </div>
  );
}
