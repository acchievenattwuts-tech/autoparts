export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionCustomers } from "@/lib/transaction-options";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";
import ManualShopeeSetupForm from "../ManualShopeeSetupForm";
import SettlementManager from "./SettlementManager";

export default async function ShopeeSettlementsPage() {
  await requirePermission("marketplace.manage");
  const { role, permissions } = await getSessionPermissionContext();
  const [shop, accounts, customers] = await Promise.all([
    db.shopeeShop.findFirst({ where: { manualMode: true }, orderBy: { createdAt: "asc" } }), getActiveCashBankAccountOptions(), getTransactionCustomers(),
  ]);
  const ready = Boolean(shop?.settlementCashBankAccountId && shop.defaultCustomerId);
  const [sales, recent] = ready ? await Promise.all([
    db.sale.findMany({ where: { channel: "SHOPEE", status: "ACTIVE", shopeeSettlementLines: { none: { activeSaleId: { not: null } } } }, orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }], take: 200, select: { id: true, saleNo: true, channelRefNo: true, saleDate: true, netAmount: true } }),
    db.shopeeSettlement.findMany({ orderBy: [{ settlementDate: "desc" }, { settlementNo: "desc" }], take: 30, select: { id: true, settlementNo: true, payoutRef: true, settlementDate: true, salesAmount: true, feeAmount: true, payoutAmount: true, status: true } }),
  ]) : [[], []];
  const canCancel = hasPermissionAccess(role, permissions, "expenses.cancel") && hasPermissionAccess(role, permissions, "cash_bank.transfers.cancel");
  const destinationAccounts = accounts.filter(
    (account) => account.type === "BANK" && account.id !== shop?.settlementCashBankAccountId,
  );
  return <div className="space-y-6"><Link href="/admin/sales?channel=SHOPEE" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-orange-600 dark:text-slate-400"><ChevronLeft size={16}/> รายการขาย Shopee</Link><div><h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">กระทบยอดรับเงิน Shopee</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">รวมหลายออเดอร์ได้ตามรอบถอนเงินจริง และเก็บค่าธรรมเนียมแยกประเภท</p></div>{!ready ? <ManualShopeeSetupForm accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} — ${account.name}` }))} customers={customers.map((customer) => ({ id: customer.id, label: customer.name }))} initialAccountId={shop?.settlementCashBankAccountId ?? ""} initialCustomerId={shop?.defaultCustomerId ?? ""}/> : <SettlementManager today={getThailandDateKey()} canCancel={canCancel} accounts={destinationAccounts.map((account) => ({ id: account.id, label: `${account.code} — ${account.name}` }))} sales={sales.map((sale) => ({ id: sale.id, saleNo: sale.saleNo, orderNo: sale.channelRefNo ?? "-", date: formatDateThai(sale.saleDate), amount: Number(sale.netAmount) }))} recent={recent.map((row) => ({ id: row.id, no: row.settlementNo, ref: row.payoutRef, date: formatDateThai(row.settlementDate), sales: Number(row.salesAmount), fees: Number(row.feeAmount), payout: Number(row.payoutAmount), status: row.status }))}/>}</div>;
}
