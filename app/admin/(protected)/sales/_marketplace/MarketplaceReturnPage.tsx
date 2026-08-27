import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionCustomers } from "@/lib/transaction-options";
import { DocStatus } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";
import {
  getMarketplaceChannelConfig,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import { getMarketplaceChannelSetting } from "@/lib/marketplace/queries";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import CreditNoteForm from "../../credit-notes/new/CreditNoteForm";
import { getSaleDetail } from "../../credit-notes/actions";

/** จำนวนใบขายล่าสุดที่ยกมาให้เลือกเมื่อยังไม่ระบุ saleId */
const RECENT_SALE_LIMIT = 60;

const money = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MarketplaceReturnPage({
  channel,
  saleId,
}: {
  channel: ManualMarketplaceChannel;
  saleId?: string;
}) {
  await requirePermission("credit_notes.create");
  await requirePermission("marketplace.manage");
  const config = getMarketplaceChannelConfig(channel);
  const setting = await getMarketplaceChannelSetting(channel);

  const backLink = (
    <Link
      href={`/admin/sales/${config.slug}/settlements`}
      className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400"
    >
      <ChevronLeft size={16} /> กระทบยอดรับเงิน {config.label}
      <LinkPendingIndicator />
    </Link>
  );

  if (!setting) {
    return (
      <div className="space-y-6">
        {backLink}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          ยังไม่ได้ตั้งค่าบัญชีพักเงินและลูกค้าเริ่มต้นของ {config.label} — กรุณาตั้งค่าที่หน้ากระทบยอดรับเงินก่อน
        </div>
      </div>
    );
  }

  const selectedSale = saleId
    ? await db.sale.findFirst({
        where: { id: saleId, channel, status: DocStatus.ACTIVE },
        select: { id: true, saleNo: true, saleDate: true, channelRefNo: true, netAmount: true },
      })
    : null;

  // ยังไม่ได้เลือกใบขาย → ให้เลือกจากรายการก่อน เพื่อบังคับว่าใบคืนต้องผูกใบขายเสมอ
  // (ยอดคืนจึงหักออกจากช่องทางเดียวกันได้ และรอบรับเงินหยิบไปหักได้ถูกใบ)
  if (!selectedSale) {
    const sales = await db.sale.findMany({
      where: { channel, status: DocStatus.ACTIVE },
      orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
      take: RECENT_SALE_LIMIT,
      select: { id: true, saleNo: true, saleDate: true, channelRefNo: true, netAmount: true },
    });

    return (
      <div className="space-y-6">
        {backLink}
        <div>
          <h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">
            เลือกใบขายที่ลูกค้าคืน — {config.label}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ใบคืนสินค้าต้องอ้างอิงใบขายเสมอ ระบบจะใช้ต้นทุนของใบขายนั้นในการคำนวณกำไร และหักยอดคืนออกจากรอบรับเงินให้เอง
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#101b2e]">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="p-3 text-left">ใบขาย</th>
                <th className="p-3 text-left">{config.orderRefLabel}</th>
                <th className="p-3 text-left">วันที่ขาย</th>
                <th className="p-3 text-right">ยอดขาย</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-400">
                    ยังไม่มีใบขาย {config.label} ในระบบ
                  </td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-3 font-mono text-sky-700 dark:text-sky-300">{sale.saleNo}</td>
                    <td className="p-3">{sale.channelRefNo ?? "-"}</td>
                    <td className="p-3">{formatDateThai(sale.saleDate)}</td>
                    <td className="p-3 text-right tabular-nums">{money(Number(sale.netAmount))}</td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/sales/${config.slug}/returns/new?saleId=${sale.id}`}
                        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-rose-600 hover:text-rose-700 dark:text-rose-300"
                      >
                        รับคืนใบนี้
                        <LinkPendingIndicator />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const [customers, siteConfig, accounts, saleDetail] = await Promise.all([
    getTransactionCustomers(),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
    // ดึงรายการของใบขายต้นทางจากฝั่ง server เลย ผู้ใช้จะเห็นรายการพร้อมแก้ทันที
    // ที่หน้าโหลดเสร็จ ไม่ต้องรอ round-trip ตอน mount
    getSaleDetail(selectedSale.id),
  ]);

  return (
    <div className="space-y-6">
      {backLink}
      <h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">
        บันทึกคืนสินค้า {config.label}
      </h1>
      <CreditNoteForm
        products={[]}
        customers={customers}
        cashBankAccounts={accounts}
        defaultVatType={siteConfig.vatType}
        defaultVatRate={siteConfig.vatRate}
        marketplacePreset={{
          channelLabel: config.label,
          channelSlug: config.slug,
          saleId: selectedSale.id,
          saleNo: selectedSale.saleNo,
          orderRefLabel: config.orderRefLabel,
          orderRefNo: selectedSale.channelRefNo ?? "-",
          customerId: setting.defaultCustomerId,
          customerName: setting.defaultCustomerName,
          cashBankAccountId: setting.settlementCashBankAccountId,
          holdingAccountLabel: setting.holdingAccountLabel,
          items: (saleDetail?.items ?? []).map((item) => ({ ...item, lotItems: [] })),
          products: saleDetail?.products ?? [],
          vatType: saleDetail?.vatType ?? siteConfig.vatType,
          vatRate: saleDetail?.vatRate ?? siteConfig.vatRate,
        }}
      />
    </div>
  );
}
