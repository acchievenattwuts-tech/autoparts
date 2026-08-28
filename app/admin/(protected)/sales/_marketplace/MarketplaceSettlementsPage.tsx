import Link from "next/link";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionCustomers } from "@/lib/transaction-options";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";
import {
  getMarketplaceChannelConfig,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import {
  getChannelCashHealth,
  getMarketplaceChannelSetting,
  getPendingSettlementDocuments,
} from "@/lib/marketplace/queries";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import MarketplaceSetupForm from "./MarketplaceSetupForm";
import SettlementManager from "./SettlementManager";

const RECENT_SETTLEMENT_LIMIT = 30;

const money = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MarketplaceSettlementsPage({
  channel,
}: {
  channel: ManualMarketplaceChannel;
}) {
  await requirePermission("marketplace.manage");
  const config = getMarketplaceChannelConfig(channel);
  const { role, permissions } = await getSessionPermissionContext();

  const [setting, accounts, customers] = await Promise.all([
    getMarketplaceChannelSetting(channel),
    getActiveCashBankAccountOptions(),
    getTransactionCustomers(),
  ]);
  const setupCustomers = customers
    .filter(
      (customer) =>
        customer.customerType?.priceList?.isActive &&
        customer.customerType.priceList.channel === channel,
    )
    .map((customer) => ({ id: customer.id, label: customer.name }));
  const activeSetting =
    setting && setupCustomers.some((customer) => customer.id === setting.defaultCustomerId)
      ? setting
      : null;

  const [pending, history, cashHealth] = activeSetting
    ? await Promise.all([
        getPendingSettlementDocuments(channel, activeSetting.settlementCashBankAccountId),
        db.marketplaceSettlement.findMany({
          where: { channel },
          orderBy: [{ settlementDate: "desc" }, { settlementNo: "desc" }],
          take: RECENT_SETTLEMENT_LIMIT,
          select: {
            id: true,
            settlementNo: true,
            payoutRef: true,
            settlementDate: true,
            salesAmount: true,
            returnAmount: true,
            feeAmount: true,
            incomeAmount: true,
            payoutAmount: true,
            status: true,
          },
        }),
        getChannelCashHealth(channel, activeSetting.settlementCashBankAccountId),
      ])
    : [{ sales: [], creditNotes: [] }, [], null];

  const canCancel =
    hasPermissionAccess(role, permissions, "expenses.cancel") &&
    hasPermissionAccess(role, permissions, "cash_bank.transfers.cancel");
  const destinationAccounts = accounts.filter(
    (account) => account.type === "BANK" && account.id !== activeSetting?.settlementCashBankAccountId,
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/sales?channel=${channel}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400"
      >
        <ChevronLeft size={16} /> รายการขาย {config.label}
        <LinkPendingIndicator />
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">
            กระทบยอดรับเงิน {config.label}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            รวมได้หลายออเดอร์ตามรอบโอนเงินจริง หักใบคืนสินค้าและค่าธรรมเนียม แล้วโอนยอดสุทธิเข้าบัญชีธนาคาร
          </p>
        </div>
        {activeSetting ? (
          <Link
            href={`/admin/sales/${config.slug}/returns/new`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            <RotateCcw size={16} /> บันทึกคืนสินค้า
            <LinkPendingIndicator />
          </Link>
        ) : null}
      </div>

      {!activeSetting ? (
        <MarketplaceSetupForm
          channel={channel}
          channelLabel={config.label}
          holdingAccountLabel={config.holdingAccountLabel}
          accounts={accounts.map((account) => ({
            id: account.id,
            label: `${account.code} — ${account.name}`,
          }))}
          customers={setupCustomers}
          initialAccountId={setting?.settlementCashBankAccountId ?? ""}
        />
      ) : (
        <>
          {cashHealth ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  คงเหลือในบัญชีพักเงิน
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  ฿{money(cashHealth.holdingBalance)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{activeSetting.holdingAccountLabel}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
                <p className="text-sm text-slate-500 dark:text-slate-400">ยอดขายรอรับเงิน</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  ฿{money(cashHealth.pendingSaleAmount)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{cashHealth.pendingSaleCount} ออเดอร์</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-400/30 dark:bg-rose-500/10">
                <p className="text-sm text-rose-700 dark:text-rose-200">ยอดคืนรอหักออก</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-rose-900 dark:text-rose-100">
                  ฿{money(cashHealth.pendingReturnAmount)}
                </p>
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
                  จะถูกหักในรอบรับเงินถัดไป
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
                <p className="text-sm text-slate-500 dark:text-slate-400">ออเดอร์เก่าสุดที่ยังไม่ได้เงิน</p>
                <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {cashHealth.oldestPendingSaleDate
                    ? formatDateThai(cashHealth.oldestPendingSaleDate)
                    : "—"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  ถ้าค้างนานผิดปกติ ให้ตรวจสอบสถานะการโอนในระบบของแพลตฟอร์ม
                </p>
              </div>
            </div>
          ) : null}

          <SettlementManager
            channel={channel}
            channelLabel={config.label}
            orderRefLabel={config.orderRefLabel}
            today={getThailandDateKey()}
            canCancel={canCancel}
            accounts={destinationAccounts.map((account) => ({
              id: account.id,
              label: `${account.code} — ${account.name}`,
            }))}
            sales={pending.sales.map((sale) => ({
              id: sale.id,
              saleNo: sale.saleNo,
              orderNo: sale.orderRefNo,
              date: formatDateThai(sale.saleDate),
              amount: sale.amount,
            }))}
            creditNotes={pending.creditNotes.map((creditNote) => ({
              id: creditNote.id,
              cnNo: creditNote.cnNo,
              saleNo: creditNote.saleNo,
              date: formatDateThai(creditNote.cnDate),
              amount: creditNote.amount,
            }))}
            history={history.map((row) => ({
              id: row.id,
              no: row.settlementNo,
              ref: row.payoutRef,
              date: formatDateThai(row.settlementDate),
              sales: Number(row.salesAmount),
              returns: Number(row.returnAmount),
              fees: Number(row.feeAmount),
              income: Number(row.incomeAmount),
              payout: Number(row.payoutAmount),
              status: row.status,
            }))}
          />
        </>
      )}
    </div>
  );
}
