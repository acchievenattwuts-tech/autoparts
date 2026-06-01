export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput } from "@/lib/th-date";
import CashBankAccountManager, { type CashBankAccountRow } from "./CashBankAccountManager";

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function CashBankPage() {
  await requirePermission("cash_bank.view");
  const { role, permissions } = await getSessionPermissionContext();

  const canManage = hasPermissionAccess(role, permissions, "cash_bank.manage");
  const canViewLedger = hasPermissionAccess(role, permissions, "cash_bank.view");
  const canViewTransfers = hasPermissionAccess(role, permissions, "cash_bank.transfers.view");
  const canViewAdjustments = hasPermissionAccess(role, permissions, "cash_bank.adjustments.view");

  const accountMovementSelect = {
    orderBy: [{ txnDate: "desc" as const }, { sorder: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { balanceAfter: true },
  };

  const managerAccountsRaw = canManage
    ? await db.cashBankAccount.findMany({
        orderBy: [{ type: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          bankName: true,
          accountNo: true,
          promptPayId: true,
          isPrimaryTransferAccount: true,
          openingBalance: true,
          openingDate: true,
          isActive: true,
          lowBalanceThreshold: true,
          movements: accountMovementSelect,
        },
      })
    : [];

  const summaryAccountsRaw = canManage
    ? managerAccountsRaw
    : await db.cashBankAccount.findMany({
        orderBy: [{ type: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          bankName: true,
          accountNo: true,
          openingBalance: true,
          isActive: true,
          movements: accountMovementSelect,
        },
      });

  const accounts: CashBankAccountRow[] = managerAccountsRaw.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    bankName: account.bankName,
    accountNo: account.accountNo,
    promptPayId: account.promptPayId,
    isPrimaryTransferAccount: account.isPrimaryTransferAccount,
    openingBalance: Number(account.openingBalance),
    openingDate: formatDateOnlyForInput(account.openingDate),
    isActive: account.isActive,
    lowBalanceThreshold: Number(account.lowBalanceThreshold),
  }));

  const summaryCards = summaryAccountsRaw
    .map((account) => ({
      ...account,
      currentBalance: Number(account.movements[0]?.balanceAfter ?? account.openingBalance),
    }))
    .filter((account) => account.isActive || Math.round(account.currentBalance * 100) !== 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">Cash / Bank Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ติดตามเงินเข้า เงินออก และยอดคงเหลือรายบัญชีจาก ledger จริง พร้อมลิงก์ย้อนกลับไปยังเอกสารต้นทาง
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewLedger ? (
          <Link href="/admin/cash-bank/ledger" className="inline-flex h-10 items-center rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
            ดู ledger เต็ม
          </Link>
          ) : null}
          {canViewTransfers ? (
          <Link href="/admin/cash-bank/transfers" className="inline-flex h-10 items-center rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
            โอนเงิน
          </Link>
          ) : null}
          {canViewAdjustments ? (
          <Link href="/admin/cash-bank/adjustments" className="inline-flex h-10 items-center rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
            ปรับยอดเงิน
          </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((account) => (
          <div key={account.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">{account.code}</p>
                <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{account.name}</h2>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${account.type === "BANK" ? "bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>
                {account.type}
              </span>
            </div>
            <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
              {[account.bankName, account.accountNo].filter(Boolean).join(" | ") || "เงินสด / ไม่มีรายละเอียดธนาคาร"}
            </p>
            <p className="mt-4 font-kanit text-2xl font-bold text-[#1e3a5f] dark:text-sky-300">{formatCurrency(account.currentBalance)}</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{account.isActive ? "บัญชีนี้เปิดใช้งานอยู่" : "บัญชีนี้ปิดใช้งานแล้ว"}</p>
          </div>
        ))}
      </div>

      <CashBankAccountManager accounts={accounts} canManage={canManage} />

      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/10">
        <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-amber-100">คู่มือการใช้งานสำหรับพนักงาน</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-amber-100">1. ตั้งบัญชีให้พร้อมก่อนใช้งาน</p>
            <p className="text-sm text-gray-600 dark:text-amber-200/80">สร้างบัญชีเงินสดหน้าร้าน เงินสดย่อย และบัญชีธนาคารที่ใช้งานจริง พร้อมยอดยกมาและวันที่เริ่มต้น</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-amber-100">2. เอกสารที่รับหรือจ่ายเงินจริงต้องเลือกบัญชี</p>
            <p className="text-sm text-gray-600 dark:text-amber-200/80">ขายสด รับชำระหนี้ ซื้อที่จ่ายแล้ว ค่าใช้จ่าย และเครดิตโน้ตคืนเงินสด ต้องผูกบัญชีเงินให้ถูกต้องทุกครั้ง</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-amber-100">3. โอนเงินและปรับยอดให้ใช้เมนูเฉพาะ</p>
            <p className="text-sm text-gray-600 dark:text-amber-200/80">ห้ามใช้เอกสารอื่นแทนการโอนเงินหรือปรับยอด ถ้าต้องย้ายเงินระหว่างบัญชีให้ใช้เมนูโอนเงิน และถ้าเป็นเงินเกินขาดหรือค่าธรรมเนียมให้ใช้ปรับยอด</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-amber-100">4. ตรวจยอดจาก ledger ไม่ใช่จากการจำ</p>
            <p className="text-sm text-gray-600 dark:text-amber-200/80">ก่อนปิดวันให้ดูยอดคงเหลือจากหน้า ledger หรือ summary เสมอ และเปิดเอกสารต้นทางจากแต่ละ movement เมื่อต้องไล่หาสาเหตุ</p>
          </div>
        </div>
      </div>
    </div>
  );
}
